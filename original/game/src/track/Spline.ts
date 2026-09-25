import type { TrackData, Vec3 } from './types';
import type { TrimeshCollider } from '../physics/colliders';

/**
 * The track centreline: a polyline sampled every two meters, with the width and curvature the
 * pipeline measured at each point. Everything that needs to know where the car is on the track
 * goes through here.
 */
export class Spline {
  readonly points: Float64Array;      // x, y, z per sample
  readonly s: Float64Array;           // arc length at each sample
  readonly halfWidth: Float64Array;
  readonly curvature: Float64Array;
  /** Signed horizontal turns for steering reversals; exported curvature is an unsigned magnitude. */
  readonly turnCurvature: Float64Array;
  readonly closed: boolean;
  readonly length: number;
  readonly count: number;

  constructor(track: TrackData) {
    const pts = track.spline.points;
    this.count = pts.length;
    this.points = new Float64Array(this.count * 3);
    this.s = track.spline.s ? Float64Array.from(track.spline.s) : new Float64Array(this.count);
    this.halfWidth = Float64Array.from(track.spline.halfWidth);
    this.curvature = Float64Array.from(track.spline.curvature ?? new Array(this.count).fill(0));
    this.closed = track.spline.closed;

    let acc = 0;
    for (let i = 0; i < this.count; i++) {
      const p = pts[i]!;
      this.points[i * 3] = p[0]; this.points[i * 3 + 1] = p[1]; this.points[i * 3 + 2] = p[2];
      if (i > 0) {
        const q = pts[i - 1]!;
        acc += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      }
      if (!track.spline.s) this.s[i] = acc;
    }
    // Legacy tracks without spline.s keep their authored total length so old records and behaviour
    // do not move. New pipeline data has a validated s/length pair and uses it directly.
    this.length = track.spline.length;
    this.turnCurvature = new Float64Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const before = this.tangent(i - 1);
      const after = this.tangent(i + 1);
      this.turnCurvature[i] = this.curvature[i]! * Math.sign(before[0] * after[2] - before[2] * after[0]);
    }
  }

  point(i: number): Vec3 {
    const k = this.wrapIndex(i) * 3;
    return [this.points[k]!, this.points[k + 1]!, this.points[k + 2]!];
  }

  /** Unit forward direction at a sample, from its neighbours. */
  tangent(i: number): Vec3 {
    const a = this.point(this.wrapIndex(i - 1));
    const b = this.point(this.wrapIndex(i + 1));
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const n = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / n, d[1] / n, d[2] / n];
  }

  /** Unit right-hand direction on the ground plane. Facing north, this points east. */
  right(i: number): Vec3 {
    const t = this.tangent(i);          // right = forward x up, with up = (0, 1, 0)
    const n = Math.hypot(t[2], t[0]) || 1;
    return [-t[2] / n, 0, t[0] / n];
  }

  /** Unit road-plane normal, shared by every effect that lies on the sampled ribbon. */
  normal(i: number): Vec3 {
    const t = this.tangent(i);
    const n = Math.hypot(t[0] * t[1], t[0] * t[0] + t[2] * t[2], t[2] * t[1]) || 1;
    return [-t[0] * t[1] / n, (t[0] * t[0] + t[2] * t[2]) / n, -t[2] * t[1] / n];
  }

  wrapIndex(i: number): number {
    if (this.closed) return ((i % this.count) + this.count) % this.count;
    return Math.min(Math.max(i, 0), this.count - 1);
  }

  /** Sample index nearest a given arc length. */
  indexAt(s: number): number {
    const distance = this.wrapS(s);
    let low = 0, high = this.count - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.s[middle]! < distance) low = middle + 1;
      else high = middle;
    }
    if (this.closed && distance > this.s[this.count - 1]!
      && this.length - distance < distance - this.s[this.count - 1]!) return 0;
    return low > 0 && distance - this.s[low - 1]! < this.s[low]! - distance ? low - 1 : low;
  }

  wrapS(s: number): number {
    if (!this.closed || this.length <= 0) return Math.min(Math.max(s, 0), this.length);
    return ((s % this.length) + this.length) % this.length;
  }
}

/**
 * A ribbon under the road built straight from the spline, added once and never streamed.
 *
 * Tiles can be slow or fail, and a hole in the ground is the one failure a driving game cannot
 * absorb: the car falls out of the world and the run is over. This sits a little below the real
 * surface and slightly wider, so it is invisible while tiles are present and catches the car when
 * they are not.
 */
/**
 * The drop has to stay under what the car can climb. It exists only so the real road wins the depth
 * test where the two overlap, and the road sits 0.06 m above the terrain, so a few centimetres is
 * enough. A deeper step than the wheels can ride over turns the net from a rescue into a trap: the
 * car drops off the edge of the tarmac and then sits there with the throttle open.
 */
export const SAFETY_NET_DROP = 0.12;

export function buildSafetyNet(spline: Spline, drop = SAFETY_NET_DROP, widen = 2.0,
  startApron = 15.0, finishApron = 132.0): TrimeshCollider {
  const n = spline.count;
  const rows: { p: Vec3; r: Vec3; w: number }[] = [];
  const row = (i: number, lead = 0): { p: Vec3; r: Vec3; w: number } => {
    const j = spline.wrapIndex(i);
    const p = spline.point(j);
    const t = spline.tangent(j);
    // A ribbon wider than the corner it is going round folds over itself on the inside, and the
    // crease behaves like a step in the road. Capping the width against the local radius keeps the
    // surface flat everywhere, at the cost of a narrower verge through the tightest bends.
    const curvature = Math.abs(spline.curvature[j] ?? 0);
    const limit = curvature > 1e-5 ? 0.7 / curvature : Infinity;
    return {
      p: [p[0] + t[0] * lead, p[1] + t[1] * lead, p[2] + t[2] * lead],
      r: spline.right(j),
      w: Math.min(spline.halfWidth[j]! + widen, limit),
    };
  };
  // A sprint starts and ends on an open edge, and a body sitting on that edge hangs half off it and
  // slips through. Extending the strip past both ends gives the car ground to spawn on and to run
  // out onto; this is why the start line needs an apron and a lap does not.
  if (!spline.closed && startApron > 0) rows.push(row(0, -startApron));
  for (let i = 0; i < (spline.closed ? n + 1 : n); i++) rows.push(row(i));
  // Finished AI cars now remain in the world. The far apron supports one collision-safe row for
  // every AI in the complete nine-car roster while the visible street still comes from the pipeline.
  if (!spline.closed && finishApron > 0) rows.push(row(n - 1, finishApron));

  const vertices = new Float32Array(rows.length * 6);
  for (let i = 0; i < rows.length; i++) {
    const { p, r, w } = rows[i]!;
    const k = i * 6;
    vertices[k] = p[0] - r[0] * w; vertices[k + 1] = p[1] - drop; vertices[k + 2] = p[2] - r[2] * w;
    vertices[k + 3] = p[0] + r[0] * w; vertices[k + 4] = p[1] - drop; vertices[k + 5] = p[2] + r[2] * w;
  }
  const quads = rows.length - 1;
  const indices = new Uint32Array(quads * 6);
  for (let i = 0; i < quads; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    const k = i * 6;
    indices[k] = a; indices[k + 1] = c; indices[k + 2] = b;
    indices[k + 3] = b; indices[k + 4] = c; indices[k + 5] = d;
  }
  return { vertices, indices };
}
