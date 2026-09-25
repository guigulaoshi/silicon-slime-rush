import { expect, it } from 'vitest';
import { GhostRecorder, MAX_GHOST_SAMPLES } from '../src/app/Ghost';
import { indexedDbGhostStore } from '../src/app/GhostStore';
import { recordKey, Save, SAVE_KEY } from '../src/app/Save';
import { VEHICLES } from '../src/vehicles/catalogue';
import { memoryGhostStore } from './ghostStoreFake';

// Replays leave the localStorage save for a store that holds every car on every route.
const disk = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
const replay = (vehicle: string, duration: number, samples = 2) => {
  const trailer = !!VEHICLES.find(v => v.id === vehicle)!.trailer;
  const recorder = new GhostRecorder(vehicle, trailer);
  const pose = (x: number) => ({ position: { x, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });
  for (let i = 0; i < samples; i++) recorder.sample(i * duration / (samples - 1), pose(i), 0, trailer ? pose(i - 5) : null, true);
  return recorder.finish(duration)!;
};

it('keeps a full-length replay for all sixteen route directions in every car, and the JSON save stays small', async () => {
  const storage = disk(), store = memoryGhostStore(), save = new Save(storage, store);
  const cars = VEHICLES.map(v => v.id);
  expect(cars.length).toBeGreaterThanOrEqual(9);
  for (const car of cars) {
    const run = replay(car, 300, MAX_GHOST_SAMPLES);
    for (let route = 0; route < 16; route++) expect(save.record(recordKey(`route-${route}`, car), 300, run)).toBe(true);
  }
  await new Promise(resolve => setTimeout(resolve));
  expect(store.rows.size).toBe(cars.length * 16);
  expect(storage.values.get(SAVE_KEY)!.length).toBeLessThan(20_000);
  const reloaded = new Save(storage, store); await reloaded.ghostsReady;
  for (const car of cars) expect(reloaded.ghost(recordKey('route-15', car))?.vehicle).toBe(car);
  expect(Object.keys(reloaded.all.ghosts)).toHaveLength(cars.length * 16);
});

it('moves replays from an older JSON save into the store, and keeps them in the JSON while the store refuses', async () => {
  // goldengate is literal old-save data being migrated (a real id from before the Bay Area set
  // was deleted), not a reference to a live track -- left as-is on purpose.
  const run = replay('sports-car', 90);
  const legacy = JSON.stringify({ version: 14, best: { 'goldengate@sports-car': 90 }, ghosts: { 'goldengate@sports-car': run } });

  const refused = disk(); refused.values.set(SAVE_KEY, legacy);
  const offline = new Save(refused, memoryGhostStore(true)); await offline.ghostsReady;
  expect(offline.ghost('goldengate@sports-car')).toEqual(run);
  offline.update({ muted: true });
  expect(JSON.parse(refused.values.get(SAVE_KEY)!).ghosts['goldengate@sports-car']).toEqual(run);

  const storage = disk(), store = memoryGhostStore(); storage.values.set(SAVE_KEY, legacy);
  const save = new Save(storage, store); await save.ghostsReady;
  await new Promise(resolve => setTimeout(resolve));
  expect(store.rows.get('goldengate@sports-car')!.ghost).toEqual(run);
  expect(JSON.parse(storage.values.get(SAVE_KEY)!).ghosts).toBeUndefined();
  const reloaded = new Save(storage, store); await reloaded.ghostsReady;
  expect(reloaded.ghost('goldengate@sports-car')).toEqual(run);
});

it('with no store at all a finish still replays for this page load, and a slow load never overwrites a newer run', async () => {
  const save = new Save(disk(), null);
  expect(save.record('synth-p2p@micro-hatch', 10, replay('micro-hatch', 10))).toBe(true);
  expect(save.ghost('synth-p2p@micro-hatch')).not.toBeNull();
  expect(indexedDbGhostStore(undefined)).toBeNull();

  const storage = disk(), store = memoryGhostStore();
  const old = replay('micro-hatch', 12), newer = replay('micro-hatch', 11);
  store.rows.set('synth-p2p@micro-hatch', { key: 'synth-p2p@micro-hatch', ghost: old, at: 1 });
  store.rows.set('stale@micro-hatch', { key: 'stale@micro-hatch', ghost: old, at: 1 });
  storage.values.set(SAVE_KEY, JSON.stringify({ version: 15, best: { 'synth-p2p@micro-hatch': 12 } }));
  const racing = new Save(storage, store);
  racing.record('synth-p2p@micro-hatch', 11, newer);
  await racing.ghostsReady;
  expect(racing.ghost('synth-p2p@micro-hatch')).toEqual(newer);
  // A replay with no matching best time is not offered, and is cleared from the store.
  expect(racing.ghost('stale@micro-hatch')).toBeNull();
  await new Promise(resolve => setTimeout(resolve));
  expect(store.rows.has('stale@micro-hatch')).toBe(false);
});
