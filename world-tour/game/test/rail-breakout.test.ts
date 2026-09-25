import { describe, expect, it } from 'vitest';
import { GUARDED_WALL_CLOSING_SPEED, RAIL_BREAKOUT_INCIDENCE_DEG, railBreakout } from '../src/physics/Car';

const kmh = (v: number) => v / 3.6;
/** Closing speed for a strike at `speed` coming in `deg` off the rail line. */
const closing = (speed: number, deg: number) => speed * Math.sin(deg * Math.PI / 180);

describe('what it takes to breach a guardrail', () => {
  it('needs the angle as well as the speed', () => {
    //This case has to be one the speed bar alone
    // would let through, or it proves nothing about the angle: 200 m/s at ten degrees puts 34.7 m/s
    // through the beam, over the closing-speed bar, and is still refused because ten degrees is a graze.
    const fastGraze = closing(200, 10);
    expect(fastGraze).toBeGreaterThan(GUARDED_WALL_CLOSING_SPEED);
    expect(railBreakout(200, fastGraze)).toBe(false);
    // and the same closing speed aimed squarely does go through, so it is the angle doing the work
    expect(railBreakout(fastGraze, fastGraze)).toBe(true);
  });

  it('lets nothing shallower than sixty degrees out at any speed at all', () => {
    expect(RAIL_BREAKOUT_INCIDENCE_DEG).toBe(60);
    for (const speed of [10, 30, 60, 120, 400]) {
      for (const angle of [1, 10, 30, 45, 59]) {
        expect(railBreakout(speed, closing(speed, angle)), `${speed} m/s at ${angle}deg`).toBe(false);
      }
    }
  });

  it('still lets a hard direct hit through, so the rail is not an invisible wall', () => {
    expect(railBreakout(GUARDED_WALL_CLOSING_SPEED, GUARDED_WALL_CLOSING_SPEED)).toBe(true);
    expect(railBreakout(kmh(120), closing(kmh(120), 60.5))).toBe(true);
  });

  it('holds an ordinary crash: slow however square, or fast at forty-five degrees', () => {
    expect(railBreakout(kmh(80), kmh(80))).toBe(false);
    expect(railBreakout(kmh(150), closing(kmh(150), 45))).toBe(false);
  });

  it('is monotonic: more speed or more angle never turns a breach back into containment', () => {
    for (const angle of [60.5, 75, 90]) {
      let seen = false;
      for (let speed = 0; speed <= 80; speed += 0.5) {
        const out = railBreakout(speed, closing(speed, angle));
        if (out) seen = true;
        expect(out || !seen, `${speed} m/s at ${angle}deg went back to contained`).toBe(true);
      }
      expect(seen, `${angle}deg never breaches at any speed`).toBe(true);
    }
  });
});
