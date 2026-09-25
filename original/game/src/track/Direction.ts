import { Progress } from './Progress';
import { Spline } from './Spline';
import type { TrackData } from './types';

export type RaceDirection = 'forward' | 'reverse';

/** Routes whose player-facing forward label deliberately starts at the authored finish. */
const SWAPPED_ROUTES = new Set(['twin-peaks']);

export function travelDirection(id: string, selected: RaceDirection): RaceDirection {
  if (!SWAPPED_ROUTES.has(id)) return selected;
  return selected === 'forward' ? 'reverse' : 'forward';
}

/** Legacy forward keys stay byte-for-byte unchanged. */
export function raceKey(id: string, direction: RaceDirection = 'forward'): string {
  return direction === 'reverse' ? id + ':reverse' : id;
}

/** Reverse travel only; geometry, tile identities and world positions remain unchanged. */
export function directedTrack(source: TrackData, direction: RaceDirection = 'forward'): TrackData {
  if (travelDirection(source.id, direction) === 'forward') return source;
  const closed = source.spline.closed;
  const original = new Spline(source);
  const end = original.point(original.count - 1), start = original.point(0);
  const length = original.s[original.count - 1]! + (closed ? Math.hypot(...end.map((v,i) => v - start[i]!)) : 0);
  // Source arc ranges follow the pipeline's horizontal route; runtime projection follows its
  // three-dimensional samples. Interpolate between the same samples before reversing either.
  const horizontal = new Float64Array(original.count);
  for (let i = 1; i < original.count; i++) {
    const a = original.point(i - 1), b = original.point(i);
    horizontal[i] = horizontal[i - 1]! + Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  const horizontalLength = horizontal[original.count - 1]! + (closed ? Math.hypot(end[0]-start[0],end[2]-start[2]) : 0);
  const sourceArc = source.spline.s ? (value: number) => value : (value: number): number => {
    const target = value / source.spline.length * horizontalLength;
    let low = 0, high = original.count - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (horizontal[middle]! < target) low = middle + 1;
      else high = middle;
    }
    const right = target > horizontal[low]! ? original.count : low, left = Math.max(0, right - 1);
    const a = horizontal[left]!, b = right === original.count ? horizontalLength : horizontal[right]!;
    const x = original.s[left]!, y = right === original.count ? length : original.s[right]!;
    return x + (b > a ? (target - a) / (b - a) * (y - x) : 0);
  };
  const indices = Array.from({length: source.spline.points.length}, (_, i) =>
    closed ? (source.spline.points.length - i) % source.spline.points.length : source.spline.points.length - 1 - i);
  const points = indices.map(i => [...source.spline.points[i]!] as [number, number, number]);
  const reversedS = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) reversedS[i] = reversedS[i - 1]! + Math.hypot(...points[i]!.map((v, k) => v - points[i - 1]![k]!));
  const boundedSourceArc = (value: number) => Math.min(length, Math.max(0, sourceArc(value)));
  const s = (value: number) => closed && value === 0 ? 0 : length - boundedSourceArc(value);
  const track: TrackData = {
    ...source,
    ...(source.endRoads ? {endRoads: {start: source.endRoads.finish, finish: source.endRoads.start}} : {}),
    spline: {...source.spline, length,
      points,
      s: reversedS,
      halfWidth: indices.map(i => source.spline.halfWidth[i]!),
      ...(source.spline.curvature ? {curvature: indices.map(i => source.spline.curvature![i]!)} : {}),
    },
    checkpoints: source.checkpoints.map(cp => ({...cp, s: s(cp.s), pos: [...cp.pos] as [number, number, number],
      dir: cp.dir.map(value => -value) as [number, number, number]})).sort((a, b) => a.s - b.s),
    tiles: source.tiles.map(tile => ({...tile, sRanges: tile.sRanges.map(([a, b]) => [length - boundedSourceArc(b), length - boundedSourceArc(a)])})),
    ...(source.wind ? {wind: {...source.wind, sRange: [length - boundedSourceArc(source.wind.sRange[1]), length - boundedSourceArc(source.wind.sRange[0])]}} : {}),
    ...(source.traffic ? {traffic: {...source.traffic,
      lanes: source.traffic.lanes.map(lane => ({...lane, offset: -lane.offset, dir: -lane.dir as 1 | -1}))}} : {}),
  };
  const spline = new Spline(track);
  const progress = new Progress(spline);
  track.checkpoints = track.checkpoints.map((cp, i) => ({...cp,
    s: i === 0 ? 0 : !closed && i === track.checkpoints.length - 1 ? length : progress.reacquire(cp.pos[0], cp.pos[2]).s,
  })).sort((a,b) => a.s - b.s);
  const tangent = spline.tangent(0), pos = spline.point(0);
  pos[1] += source.start.pos[1] - source.spline.points[0]![1];
  track.start = {pos, yaw: Math.atan2(-tangent[0], -tangent[2])};
  return track;
}
