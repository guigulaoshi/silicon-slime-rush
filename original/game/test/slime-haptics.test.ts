import { describe, expect, it } from 'vitest';
import { SLIME_HAPTICS, phoneVibrationAllowed, phoneVibrationPattern } from '../src/world/slimeHaptics';
import { SLIME_KINDS } from '../src/world/Slimes';

/** Every slime kind reaches the phone, the kinds are told apart, and one table feeds both outputs. */
describe('slime haptics', () => {
  it('gives every kind a non-empty pattern of positive milliseconds taken from the shared table', () => {
    for (const kind of SLIME_KINDS) {
      const pattern = phoneVibrationPattern(kind);
      expect(pattern, kind).toEqual(SLIME_HAPTICS[kind].map((p) => p.duration));
      expect(pattern.length, kind).toBeGreaterThan(0);
      for (const ms of pattern) expect(ms, kind).toBeGreaterThan(0);
    }
  });
  it('orders weight splitter < popper < boost < burst, with a three-pulse colossus', () => {
    const on = (kind: (typeof SLIME_KINDS)[number]) =>
      phoneVibrationPattern(kind).filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
    expect(on('slick')).toBeLessThan(on('popper'));
    expect(on('popper')).toBeLessThan(on('boost'));
    expect(on('boost')).toBeLessThan(on('burst'));
    expect(phoneVibrationPattern('colossus').length).toBe(3);
    const strength = (kind: (typeof SLIME_KINDS)[number]) => Math.max(...SLIME_HAPTICS[kind].map((p) => p.magnitude));
    expect(strength('slick')).toBeLessThan(strength('popper'));
    expect(strength('burst')).toBeGreaterThan(strength('boost'));
  });
  it('only asks a browser that has the API and has seen a real tap', () => {
    const nav = (vibrate: unknown, userActivation?: { hasBeenActive: boolean }) =>
      ({ vibrate, userActivation }) as unknown as Navigator;
    expect(phoneVibrationAllowed(nav(undefined))).toBe(false);
    expect(phoneVibrationAllowed(nav(() => true))).toBe(true);
    expect(phoneVibrationAllowed(nav(() => true, { hasBeenActive: false }))).toBe(false);
    expect(phoneVibrationAllowed(nav(() => true, { hasBeenActive: true }))).toBe(true);
  });
});
