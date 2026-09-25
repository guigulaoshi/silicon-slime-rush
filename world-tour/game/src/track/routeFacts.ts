import type { TrackData } from './types';
import { AI_PACE } from './aiPace';

/**
 * Whole drive, including every lap; heights are the same samples that define the road.
 * `minutes` is how long the race takes, from the AI pace table when the route is in it: the
 * fastest to the slowest car of its garage, measured. A 45-90 km/h estimate told players "2-4 minutes"
 * for races the cars finish in one or two; it remains only for routes outside the table (test tracks).
 */
export function routeFacts(track: TrackData) {
  const laps = track.mode === 'loop' ? track.laps : 1;
  const points = track.spline.points;
  let ascent = 0;
  for (let i = 1; i < points.length; i++) ascent += Math.max(0, points[i]![1] - points[i - 1]![1]);
  if (track.spline.closed) ascent += Math.max(0, points[0]![1] - points[points.length - 1]![1]);
  const km = track.spline.length * laps / 1000;
  const measured = Object.values(AI_PACE[track.id] ?? {});
  const minutes = measured.length
    ? [Math.max(1, Math.ceil(Math.min(...measured) / 60)), Math.max(1, Math.ceil(Math.max(...measured) / 60))]
    : [Math.max(1, Math.ceil(km / 90 * 60)), Math.max(1, Math.ceil(km / 45 * 60))];
  return { km, ascent: Math.round(ascent * laps), laps, minutes };
}

/**
 * How long a race lasts for the middle car of the garage, in whole seconds. The brief
 * caps it at 140; the floor stays the hyper-casual 60,
 * because the routes near 85 s are drawn round their landmarks and a longer one would only add road
 * without them.
 */
export const RACE_SECONDS = [60, 140] as const;
/**
 * Routes allowed past the cap, each with why. sydney (142 s for the middle car): the lap round the
 * Opera House on the promenade is what the player asked for, and it is slow road -- tight,
 * narrow, beside the water. The bridge start cannot move north (no node between the pylon and the far
 * end), and finishing at the northern tip saves about 3 s but loses the run back along the east side.
 * lhasa (146 s): the stretch across the palace square straight at the Potala's front, which the player
 * asked for, is slow road -- a pedestrian square with tight corners -- and the start was
 * already moved one junction nearer to pay for it.
 */
export const RACE_SECONDS_EXCEPTIONS: Readonly<Record<string, number>> = { sydney: 145, lhasa: 150 };
export function middleCarSeconds(trackId: string): number | undefined {
  const times = Object.values(AI_PACE[trackId] ?? {}).sort((a, b) => a - b);
  if (!times.length) return undefined;
  const mid = times.length / 2;
  return times.length % 2 ? times[Math.floor(mid)]! : (times[mid - 1]! + times[mid]!) / 2;
}
