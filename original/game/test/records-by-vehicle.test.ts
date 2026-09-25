import { expect, it } from 'vitest';
import { GhostRecorder } from '../src/app/Ghost';
import { migrate, recordKey, Save, SAVE_VERSION } from '../src/app/Save';


const ghost = (vehicle: string, duration: number) => {
  const recorder = new GhostRecorder(vehicle, false);
  const pose = (x: number) => ({ position: { x, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });
  recorder.sample(0, pose(0), 0, null, true); recorder.sample(duration, pose(1), 0, null, true);
  return recorder.finish(duration)!;
};
const sports = recordKey('goldengate', 'sports-car'), truck = recordKey('goldengate', 'monster-truck');

it('keeps a separate best, rating and ghost for each car on the same route and direction', () => {
  const save = new Save(null);
  expect(save.record(sports, 100, ghost('sports-car', 100))).toBe(true);
  save.recordRating(sports, 5);
  expect(save.ghost(truck)).toBeNull();
  expect(save.best(truck)).toBeNull();
  // Slower than the sports car, faster than the truck's own last run: the truck's record and ghost.
  expect(save.record(truck, 160, ghost('monster-truck', 160))).toBe(true);
  expect(save.record(truck, 150, ghost('monster-truck', 150))).toBe(true);
  save.recordRating(truck, 3);
  expect(save.best(sports)).toBe(100);
  expect(save.best(truck)).toBe(150);
  expect(save.ghost(sports)!.vehicle).toBe('sports-car');
  expect(save.ghost(truck)!.vehicle).toBe('monster-truck');
  expect(save.all.ratings).toEqual({ [sports]: 5, [truck]: 3 });
  expect(save.best(recordKey('goldengate:reverse', 'sports-car'))).toBeNull();
});

it('files a route-only record from an older save under the car that most likely set it, losing nothing', () => {
  const run = ghost('sports-car', 90);
  const old = migrate({ version: 13,
    best: { goldengate: 90, lombard: 70, 'lombard:reverse': 80, shoreline: 60 },
    ratings: { goldengate: 5, lombard: 2, 'lombard:reverse': 4, shoreline: 3 },
    ghosts: { goldengate: run },
    vehicles: { goldengate: 'monster-truck', lombard: 'school-bus' },
    lastRace: { trackId: 'shoreline', direction: 'forward', playerCount: 1, playerVehicles: ['jeep'],
      timeOfDay: 'day', weather: 'clear', slimeDensity: 'many', ai: true, aiDifficulty: 'relaxed' } });
  expect(old.version).toBe(SAVE_VERSION);
  // The ghost is the record run itself, so its car wins over the car last started there.
  expect(old.best).toEqual({ 'goldengate@sports-car': 90, 'lombard@school-bus': 70,
    'lombard:reverse@school-bus': 80, 'shoreline@jeep': 60 });
  expect(old.ghosts).toEqual({ 'goldengate@sports-car': run });
  expect(old.ratings).toEqual({ 'goldengate@sports-car': 5, 'lombard@school-bus': 2,
    'lombard:reverse@school-bus': 4, 'shoreline@jeep': 3 });
  // Nothing known about the car: the catalogue's fallback car keeps it.
  expect(migrate({ version: 13, best: { twin: 50 } }).best).toEqual({ 'twin@micro-hatch': 50 });
  // Migrating twice does not move anything again.
  expect(migrate(old)).toMatchObject({ best: old.best, ghosts: old.ghosts, ratings: old.ratings });
});

it('keeps every route direction for two cars before evicting, where the old cap held sixteen replays in all', () => {
  const save = new Save(null);
  // About 55 kB is a typical three-minute replay (two thousand samples at 28 bytes, base64).
  const run = { ...ghost('sports-car', 180), data: 'A'.repeat(55_000) };
  for (const car of ['sports-car', 'monster-truck'])
    for (let route = 0; route < 16; route++) save.all.ghosts[recordKey(`route-${route}`, car)] = run;
  expect(save.record(recordKey('route-0', 'jeep'), 180, ghost('jeep', 180))).toBe(true);
  expect(Object.keys(save.all.ghosts)).toHaveLength(33);
});
