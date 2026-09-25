import type { Spline } from './Spline';

export interface Projection {
  /** arc length along the track, meters */
  s: number;
  /** distance from the centreline; positive is the right-hand side of travel */
  lateral: number;
  /** index of the nearest spline sample */
  index: number;
}

const SEARCH = 90;   // samples either side of the last position: 180 m of track at 2 m spacing

/**
 * Where the car is on the track.
 *
 * The search is deliberately local. On a hairpin the two legs of the road are twenty meters apart in
 * space and four hundred meters apart along the track, so a global nearest-point search jumps between
 * them, and every checkpoint and lap counter reading off it fires at the wrong moment. Searching near
 * where the car was last frame cannot make that mistake; the only time a global search is right is
 * after a reset, when there is no "last frame" to trust.
 */
export class Progress {
  private index = 0;
  private current: Projection = { s: 0, lateral: 0, index: 0 };

  constructor(private readonly spline: Spline) {}

  get value(): Projection {
    return this.current;
  }

  /** Re-acquire the car's position from scratch. Use after a reset or a teleport, not per frame. */
  reacquire(x: number, z: number): Projection {
    this.index = this.nearest(x, z, 0, this.spline.count);
    return this.compute(x, z);
  }

  update(x: number, z: number): Projection {
    this.index = this.nearest(x, z, this.index - SEARCH, this.index + SEARCH + 1);
    return this.compute(x, z);
  }

  private nearest(x: number, z: number, from: number, to: number): number {
    let best = this.index;
    let bestD = Infinity;
    for (let k = from; k < to; k++) {
      const i = this.spline.wrapIndex(k);
      const p = this.spline.point(i);
      const d = (p[0] - x) ** 2 + (p[2] - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  private compute(x: number, z: number): Projection {
    this.current = projectOnSample(this.spline, this.index, x, z);
    this.current.s = this.spline.wrapS(this.current.s);
    return this.current;
  }
}

/** Project a body near an already acquired route sample without jumping to another hairpin leg. Open-road runout remains measurable. */
export function projectOnSample(spline: Spline, index: number, x: number, z: number): Projection {
  const p = spline.point(index), t = spline.tangent(index), r = spline.right(index);
  const dx = x - p[0], dz = z - p[2];
  // x/z locate the car on the road, but s measures the full 3-D centreline. A 3-D unit tangent's
  // horizontal components are shorter on a grade, so divide by their squared length to turn the
  // horizontal projection back into distance along the sloped segment.
  const horizontal2 = t[0] * t[0] + t[2] * t[2];
  const along = spline.s[index]! + (horizontal2 > 1e-9 ? (dx * t[0] + dz * t[2]) / horizontal2 : 0);
  return { s: spline.closed ? spline.wrapS(along) : along,
    lateral: dx * r[0] + dz * r[2], index };
}

/** Signed distance from `a` to `b` along the track, taking the short way round a loop. */
export function delta(a: number, b: number, length: number, closed: boolean): number {
  const d = b - a;
  if (!closed || length <= 0) return d;
  const half = length / 2;
  return d > half ? d - length : d < -half ? d + length : d;
}
