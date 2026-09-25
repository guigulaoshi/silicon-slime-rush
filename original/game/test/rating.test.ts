import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILT } from '../src/app/tracks';
import { PACE_TARGETS, raceRating, starGlyphs } from '../src/track/Rating';
import { aiReferenceSeconds } from '../src/track/aiPace';
import { Spline } from '../src/track/Spline';
import { parseTrack } from '../src/track/schema';
import { VEHICLES } from '../src/vehicles/catalogue';
import { Save, SAVE_KEY, migrate } from '../src/app/Save';
import { shareLines } from '../src/ui/ShareDialog';
import { I18n } from '../src/ui/i18n';

it('requires both personal pace and earned points for every high star', () => {
  // Reference 100 s: the AI's time for this route in this vehicle.
  expect([300, 200, 150, 125, 110].map(seconds => raceRating(1800, seconds, 10800, 100))).toEqual([1, 2, 3, 4, 5]);
  expect([0, 900, 2700, 6300, 10800].map(score => raceRating(1800, 110, score, 100))).toEqual([1, 2, 3, 4, 5]);
  expect(raceRating(3600, 110, 21600, 100)).toBe(5);
  expect(raceRating(1800, 1, 0, 100)).toBe(1);
  expect(raceRating(1800, 300, 100000, 100)).toBe(1);
  expect(starGlyphs(3)).toBe('★★★☆☆');
});
it('keeps each threshold exact', () => {
  for (const [star, pace, points] of [[2, PACE_TARGETS[3], .5], [3, PACE_TARGETS[2], 1.5], [4, PACE_TARGETS[1], 3.5], [5, PACE_TARGETS[0], 6]]) {
    expect(raceRating(2400, 100 / pace!, 2400 * points!, 100)).toBe(star);
    expect(raceRating(2400, 100 / pace! + .01, 2400 * points!, 100)).toBeLessThan(star!);
    expect(raceRating(2400, 100 / pace!, 2400 * points! - 1, 100)).toBeLessThan(star!);
  }
  for (const invalid of [0, -1, NaN, Infinity]) {
    expect(raceRating(invalid, 100, 6000, 100)).toBe(1);
    expect(raceRating(2400, invalid, 6000, 100)).toBe(1);
    expect(raceRating(2400, 100, 6000, invalid)).toBe(1);
  }
});
it('rates every vehicle alike when each drives like the AI in it, on every route', () => {

  for (const id of BUILT) {
    const track = parseTrack(JSON.parse(readFileSync(`public/tracks/${id}/track.json`, 'utf8')));
    const spline = new Spline(track);
    const distance = spline.length * (track.mode === 'loop' ? track.laps : 1);
    const stars = VEHICLES.map(vehicle => {
      const reference = aiReferenceSeconds(id, vehicle, spline, track);
      // Matching the AI, and 50 % slower than it, with the same points per metre.
      return [raceRating(distance, reference, distance * 6, reference),
        raceRating(distance, reference * 1.5, distance * 6, reference)].join();
    });
    expect([...new Set(stars)], id).toEqual(['5,3']);
  }
});
it('retains the best stars independently of best time, including reload and legacy saves', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const save = new Save(storage);
  save.record('route', 80);
  save.recordRating('route', 4);
  expect(save.record('route', 120)).toBe(false);
  save.recordRating('route', 5);
  expect(new Save(storage).all.ratings.route).toBe(5);
  expect(save.recordRating('route', 2)).toBe(5);
  expect(new Save(storage).best('route')).toBe(80);
  expect(migrate({version: 8, ratings: {route: 'A'} as never}).ratings).toEqual({'route@micro-hatch': 4});
  values.set(SAVE_KEY, JSON.stringify({ratings: {route: 'Z'}}));
  expect(new Save(storage).all.ratings).toEqual({});
  expect(new Save(null).all.ratings).toEqual({});
});
it('shares each player star result in both languages', () => {
  for (const lang of ['zh', 'en'] as const) {
    const i18n = new I18n(lang);
    const result = {trackId: 'synthetic-p2p', time: 120, best: null, isBest: false, score: 2700, slimeHits: 4,
      players: [{time: 120, score: 2700, slimeHits: 4, rating: 4 as const, maxCombo: 4, cleanCorners: 2, bestRating: 4 as const},
        {time: 180, score: 0, slimeHits: 0, rating: 1 as const, maxCombo: 0, cleanCorners: 0, bestRating: 4 as const}]};
    const lines = shareLines(i18n, result, null);
    expect(lines).toContain(i18n.t('results.rating', {stars: '★★★★☆', combo: 4, corners: 2, best: '★★★★☆'}));
    expect(lines).toContain(i18n.t('results.rating', {stars: '★☆☆☆☆', combo: 0, corners: 0, best: '★★★★☆'}));
  }
});
