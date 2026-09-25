import { expect, it } from 'vitest';
import { AI_DIFFICULTIES, AI_EFFORT, aiDifficulty, aiSettingsFor, CATCH_UP_FULL_GAP_M, CATCH_UP_MAX, applyCatchUp, catchUpAssist } from '../src/bot/difficulty';
import { VEHICLES, vehicleTuning } from '../src/vehicles/catalogue';
import type { CarKind } from '../src/track/types';
import { Save, SAVE_VERSION, migrate } from '../src/app/Save';

it('changes intent without changing vehicle physics or compounding speed discounts', () => {
  for(const vehicle of VEHICLES) {
    const tuning=vehicleTuning(vehicle,vehicle.tuning as CarKind),original=structuredClone(tuning);
    const plans=AI_DIFFICULTIES.map(d=>aiSettingsFor(tuning,d));
    for(const plan of plans) {
      expect(plan.topSpeed).toBeLessThanOrEqual(tuning.maxSpeed);
      expect(plan.corneringAccel).toBeLessThanOrEqual(tuning.maxLateralAccel);
      expect(plan.brakingAccel).toBeLessThanOrEqual(tuning.brakeForce/tuning.mass);
      expect(plan.keepSpeedForSlimes).toBe(true);   // No tier slows down for slimes
    }
    // Hard drives the whole car; easy holds back. left only these two tiers.
    const [easy, hard] = plans as [typeof plans[0], typeof plans[0]];
    expect(hard.topSpeed).toBe(tuning.maxSpeed);
    expect(hard.corneringAccel).toBe(tuning.maxLateralAccel);
    for (const key of ['topSpeed','corneringAccel','brakingAccel'] as const) expect(easy[key]).toBeLessThan(hard[key]);
    expect(easy.trafficHeadway).toBeGreaterThan(hard.trafficHeadway);
    expect(easy.slimeSkill).toBeLessThan(hard.slimeSkill!);
    expect(tuning).toEqual(original);
  }
  expect(AI_DIFFICULTIES).toEqual(['relaxed', 'rush']);
  expect(AI_EFFORT.relaxed).toEqual({ grip: .8, brakes: .7, top: .92 });
  expect(AI_EFFORT.rush).toEqual({ grip: 1, brakes: .9, top: 1 });
});

it('only hard gets catch-up, growing with the gap behind the leading player', () => {
  expect(catchUpAssist('relaxed', 1000)).toBe(1);
  expect(catchUpAssist('rush', -50)).toBe(1);
  expect(catchUpAssist('rush', 0)).toBe(1);
  expect(catchUpAssist('rush', CATCH_UP_FULL_GAP_M / 2)).toBeCloseTo(1 + CATCH_UP_MAX / 2);
  expect(catchUpAssist('rush', CATCH_UP_FULL_GAP_M * 3)).toBeCloseTo(1 + CATCH_UP_MAX);
});

it('older and invalid preferences land on easy, the retired middle tier on hard, and valid choices persist', () => {
  const old = migrate({ version: 5, best: { route: 65 }, language: 'zh' });
  expect(old).toMatchObject({ version: SAVE_VERSION, aiDifficulty: 'relaxed', best: { 'route@micro-hatch': 65 }, language: 'zh' });
  expect(aiDifficulty('impossible')).toBe('relaxed');
  expect(migrate({ aiDifficulty: 'impossible' as never }).aiDifficulty).toBe('relaxed');
  expect(aiDifficulty('standard')).toBe('rush');
  expect(migrate({ aiDifficulty: 'standard' as never }).aiDifficulty).toBe('rush');
  // shoreline is gone with the rest of the Bay Area set; lhasa stands in (mapping table: an open flat route).
  expect(migrate({ lastRace: { trackId: 'lhasa', direction: 'forward', playerCount: 1, playerVehicles: ['jeep'],
    timeOfDay: 'day', weather: 'clear', slimeDensity: 'many', ai: true, aiDifficulty: 'standard' as never } }).lastRace?.aiDifficulty,
    'a remembered start choice follows the same rule').toBe('rush');
  let value = JSON.stringify(old);
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
  for (const difficulty of AI_DIFFICULTIES) {
    new Save(storage).update({ aiDifficulty: difficulty });
    expect(new Save(storage).all).toMatchObject({ aiDifficulty: difficulty, best: { 'route@micro-hatch': 65 } });
  }
});

it('Only hard AI still racing behind the leading player gets the catch-up', () => {
  const racer = (role: 'human' | 'ai', difficulty: 'relaxed' | 'rush', distance: number, state = 'racing') =>
    ({ role, difficulty, race: { state }, assist: 0, raceDistance: () => distance, setAssist(a: number) { this.assist = a; } });
  const player = racer('human', 'rush', 900), second = racer('human', 'rush', 500);
  const hard = racer('ai', 'rush', 500), easy = racer('ai', 'relaxed', 100), ahead = racer('ai', 'rush', 1200);
  const done = racer('ai', 'rush', 100, 'finished');
  const field = [player, second, hard, easy, ahead, done];
  applyCatchUp(field, true);
  expect(hard.assist).toBeCloseTo(catchUpAssist('rush', 400));
  expect(hard.assist).toBeGreaterThan(1);
  for (const other of [player, second, easy, ahead, done]) expect(other.assist).toBe(1);
  applyCatchUp(field, false);
  expect(hard.assist).toBe(1);
});
