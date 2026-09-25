import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW, distanceToBounds, planStreaming } from '../src/world/streaming';
import { parseTrack } from '../src/track/schema';
import type { TrackData } from '../src/track/types';
import { checkMaximum } from '../test-support/resource-limit';

// built by `npm run synth` / `sr build sydney`; a fresh clone has no tracks yet. sydney is
// goldengate's replacement (mapping table): the showcase route, a long bridge deck over water.
const TRACK_PATH = resolve(process.cwd(), 'public/tracks/sydney/track.json');
const HAS_TRACK = existsSync(TRACK_PATH);
const track: TrackData = HAS_TRACK
  ? parseTrack(JSON.parse(readFileSync(TRACK_PATH, 'utf-8')))
  : (undefined as unknown as TrackData);

/** Walk the real track, applying the plan each step, exactly as the streamer does. */
function traverse(stride: number, there = true, back = true) {
  const loaded = new Set<string>();
  const w = { ...DEFAULT_WINDOW, closed: track.spline.closed, length: track.spline.length };
  const peak = { loaded: 0 };
  let loads = 0;
  let unloads = 0;
  const stops: number[] = [];
  if (there) for (let s = 0; s <= track.spline.length; s += stride) stops.push(s);
  if (back) for (let s = track.spline.length; s >= 0; s -= stride) stops.push(s);

  for (const s of stops) {
    const i = Math.min(Math.round(s / 2), track.spline.points.length - 1);
    const p = track.spline.points[i]!;
    const plan = planStreaming(track.tiles, loaded, s, p[0], p[2], w);
    for (const t of plan.load) { loaded.add(t.name); loads++; }
    for (const f of plan.unload) { loaded.delete(f); unloads++; }
    peak.loaded = Math.max(peak.loaded, loaded.size);
  }
  return { loaded, loads, unloads, peak: peak.loaded, stops: stops.length };
}

describe.skipIf(!HAS_TRACK)('streaming the real Sydney track', () => {
  it('has tiles, and the off-route ones carry no arc-length interval', () => {
    // 50 since the route loops round the Opera House: the lap folds back on itself, so it
    // needs fewer tiles than a straight run of the same length.
    expect(track.tiles.length).toBeGreaterThan(40);
    const withRanges = track.tiles.filter((t) => t.sRanges.length > 0);
    // most tiles are on the route; the rest are the water and hillside either side of it. The share
    // is lower on a short route than on a long one, because the corridor's width does not shrink
    // with its length.
    expect(withRanges.length).toBeGreaterThan(track.tiles.length * 0.5);
  });

  it('keeps the working set bounded end to end and back', () => {
    const run = traverse(25);
    // The window is 300 m behind, 1500 m ahead and a kilometre either side, so on sydney's 3.1 km
    // route it legitimately covers most of the track: what has to stay bounded is the count, not
    // its share.
    checkMaximum(run.peak, 'max_loaded_tiles', 'Sydney streaming working set');
    expect(run.peak).toBeGreaterThan(5);
    expect(run.loads).toBeGreaterThan(40);
    // most of what was loaded is let go again, and the set the car ends holding is no bigger than
    // the biggest it ever was. Comparing unloads against loads minus the peak only worked while the
    // route was long enough that the car finished a long way from most of what it had loaded.
    expect(run.unloads).toBeGreaterThan(run.loads * 0.3);
    expect(run.loaded.size).toBeLessThanOrEqual(run.peak);
  });

  it('settles: driving the route twice loads no more than driving it once', () => {
    const once = traverse(25);
    const twice = traverse(12.5);
    expect(twice.peak).toBeLessThanOrEqual(once.peak + 2);
  });

  it('never leaves the car without the tile it is standing on', () => {
    const w = { ...DEFAULT_WINDOW, closed: track.spline.closed, length: track.spline.length };
    const loaded = new Set<string>();
    for (let s = 0; s <= track.spline.length; s += 25) {
      const i = Math.min(Math.round(s / 2), track.spline.points.length - 1);
      const p = track.spline.points[i]!;
      const plan = planStreaming(track.tiles, loaded, s, p[0], p[2], w);
      for (const t of plan.load) loaded.add(t.name);
      for (const f of plan.unload) loaded.delete(f);
      const here = track.tiles.filter((t) => distanceToBounds(t.bounds, p[0], p[2]) === 0);
      for (const t of here) expect(loaded.has(t.name), `at s=${s}, missing ${t.name}`).toBe(true);
    }
  });

  it('drops every tile that is neither ahead on the road nor near the car', () => {
    const w = { ...DEFAULT_WINDOW, closed: false, length: track.spline.length };
    const mid = track.spline.length / 2;
    const loaded = new Set(track.tiles.map((t) => t.name));
    // the car sits at mid-track but far off the map, so only the arc-length window can justify a tile
    const plan = planStreaming(track.tiles, loaded, mid, 500_000, 500_000, w);
    const kept = new Set(track.tiles.map((t) => t.name));
    for (const f of plan.unload) kept.delete(f);
    for (const file of kept) {
      const tile = track.tiles.find((t) => t.name === file)!;
      const near = tile.sRanges.some(([a, b]) => b >= mid - (w.behind + w.hysteresis) && a <= mid + w.ahead + w.hysteresis);
      expect(near, `${file} kept with no interval near s=${mid}`).toBe(true);
    }
    // the window reaches 1500 m ahead and 300 m back = 1800 m, which on sydney's 3274 m route is
    // 55% of it, so under half the track is dropped rather than the majority a longer route drops.
    // Measured: 17 of 50 tiles (34%) at mid-track -- less than 1 - 1800/3274 = 45%, because the lap
    // round the Opera House comes back beside Macquarie Street and shares its tiles.
    expect(plan.unload.length).toBeGreaterThan(track.tiles.length * 0.3);
  });
});
