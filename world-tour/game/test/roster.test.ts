import { expect, it } from 'vitest';
import { MOBILE_AI_RIVALS, raceRoster } from '../src/app/roster';
import { VEHICLES } from '../src/vehicles/catalogue';

it('takes every unselected formal model exactly once, including same-model human pairs', () => {
  let cases = 0;
  for (const first of VEHICLES) for (const second of [undefined, ...VEHICLES]) {
    const humans = second ? [first, second] : [first];
    const selected = new Set(humans.map(vehicle => vehicle.id));
    const off = raceRoster(humans, false), on = raceRoster(humans, true);
    expect(off.map(entry => entry.vehicle)).toEqual(humans);
    expect(off.every(entry => entry.role === 'human')).toBe(true);
    expect(on.filter(entry => entry.role === 'human').map(entry => entry.vehicle)).toEqual(humans);
    const ai = on.filter(entry => entry.role === 'ai');
    expect(ai.map(entry => entry.vehicle.id)).toEqual(VEHICLES.filter(v => !selected.has(v.id)).map(v => v.id));
    expect(new Set(on.map(entry => entry.id)).size).toBe(on.length);
    expect(ai).toHaveLength(VEHICLES.length - selected.size);
    expect(on.filter(entry => entry.vehicle.trailer)).toHaveLength(humans.filter(v => v.trailer).length
      + (selected.has('pickup-travel-trailer') ? 0 : 1));
    cases++;
  }
  expect(cases).toBe(VEHICLES.length * (VEHICLES.length + 1));
});

// A phone lines up a short field spread across the route's pace.
it('a capped field keeps that many distinct rivals spread from fast to slow, never a player car', () => {
  const pace: Record<string, number> = Object.fromEntries(VEHICLES.map((vehicle, index) => [vehicle.id, 100 + 10 * index]));
  for (const player of VEHICLES) {
    const full = raceRoster([player], true).filter(entry => entry.role === 'ai');
    for (const limit of [1, 2, MOBILE_AI_RIVALS, full.length, full.length + 3]) {
      const on = raceRoster([player], true, limit, vehicle => pace[vehicle.id]);
      const ai = on.filter(entry => entry.role === 'ai');
      expect(on[0]).toMatchObject({ role: 'human', vehicle: player });
      expect(ai).toHaveLength(Math.min(limit, full.length));
      expect(new Set(ai.map(entry => entry.id)).size).toBe(ai.length);
      expect(ai.some(entry => entry.vehicle.id === player.id)).toBe(false);
      if (limit >= 2 && limit < full.length) {
        const ranks = ai.map(entry => full.map(e => e.vehicle.id).sort((a, b) => pace[a]! - pace[b]!).indexOf(entry.vehicle.id));
        // neither all the fast end nor all the slow end
        expect(Math.min(...ranks)).toBeLessThan(full.length / 2);
        expect(Math.max(...ranks)).toBeGreaterThanOrEqual(full.length / 2);
      }
    }
    expect(raceRoster([player], false, MOBILE_AI_RIVALS)).toHaveLength(1);
  }
  // No measured pace (the synthetic routes): still a full, distinct capped field.
  expect(raceRoster([VEHICLES[0]!], true, MOBILE_AI_RIVALS).filter(entry => entry.role === 'ai')).toHaveLength(MOBILE_AI_RIVALS);
});
