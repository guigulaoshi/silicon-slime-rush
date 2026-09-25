import type { TrackData } from './types';

/** Whole drive, including every lap; heights are the same samples that define the road. */
export function routeFacts(track: TrackData) {
  const laps = track.mode === 'loop' ? track.laps : 1;
  const points = track.spline.points;
  let ascent = 0;
  for (let i = 1; i < points.length; i++) ascent += Math.max(0, points[i]![1] - points[i - 1]![1]);
  if (track.spline.closed) ascent += Math.max(0, points[0]![1] - points[points.length - 1]![1]);
  const km = track.spline.length * laps / 1000;
  // A planning range at 45–90 km/h, not a best-time target or a promise about traffic and stops.
  const minutes = [Math.max(1, Math.ceil(km / 90 * 60)), Math.max(1, Math.ceil(km / 45 * 60))];
  return { km, ascent: Math.round(ascent * laps), laps, minutes };
}
