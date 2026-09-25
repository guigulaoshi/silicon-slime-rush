import { describe, expect, it } from 'vitest';
import { Save, SAVE_KEY, SAVE_VERSION, type Storage } from '../src/app/Save';
import { VEHICLES } from '../src/vehicles/catalogue';
import { CARS } from '../src/ui/StartScreen';

class Memory implements Storage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('local progression', () => {
  it('lists the garage in catalogue order with nothing locked', () => {
    expect(CARS).toEqual(VEHICLES.map(vehicle => vehicle.id));
    const save = new Save(new Memory());
    expect(save.recordFinish(false)).toEqual([]);
    expect(JSON.stringify(save.all)).not.toMatch(/unlocked/i);
  });

  it('migrates an old save that still carries the retired route-lock field', () => {
    // goldengate/bayshore-101 are literal old-save data (real ids from before the Bay Area set
    // was deleted), not references to a live track -- left as-is on purpose.
    const store = new Memory();
    store.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION - 1, totalSlimeHits: 2,
      legacyUnlockedTracks: ['goldengate', 'bayshore-101'] }));
    const save = new Save(store);
    expect(save.all.version).toBe(SAVE_VERSION);
    expect(save.all.totalSlimeHits).toBe(2);
    expect('legacyUnlockedTracks' in save.all, 'the field is dropped on load').toBe(false);
  });

  it('earns the three small achievements and keeps them locally', () => {
    const store = new Memory(); const save = new Save(store);
    for (let runHits = 1; runHits <= 25; runHits++) save.recordSlimeHit(runHits);
    expect(save.recordFinish(true)).toEqual(['no-rescue']);
    expect(new Save(store).all).toMatchObject({ totalSlimeHits: 25, bestRunSlimeHits: 25,
      achievements: ['slime-run-15', 'slime-total-25', 'no-rescue'] });
  });

  it('loads a save that still carries the retired garage-lock fields', () => {
    const store = new Memory();
    store.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION - 1, totalSlimeHits: 3,
      unlockedEverything: false, unlockedVehicles: ['retro-van'] }));
    const save = new Save(store);
    expect(save.all.totalSlimeHits).toBe(3);
    expect(JSON.stringify(save.all), 'the fields are dropped on load').not.toMatch(/unlocked/i);
  });
});
