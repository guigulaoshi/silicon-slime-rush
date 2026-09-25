import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Sky, WEATHERS, type Weather } from '../src/world/Sky';
import type { TimeOfDay } from '../src/track/types';

/**
 * The giants' ground ripple is scaled by how bright the world itself is, so this pins the
 * one number that decides it. The e2e films three conditions; this covers every
 * weather and both hours, which is cheaper than eight browser runs.
 */
const daylightOf = (timeOfDay: TimeOfDay, weather: Weather) =>
  new Sky(new THREE.Scene(), timeOfDay, 90, 2100, weather).daylight;

describe('how bright the world is', () => {
  it('is 1 at a clear noon and drops for every weather and for night', () => {
    expect(daylightOf('day', 'clear')).toBe(1);
    const day = Object.fromEntries(WEATHERS.map(w => [w, daylightOf('day', w)]));
    expect(day.fog!).toBeCloseTo(.52, 4);
    expect(day.rain!).toBeCloseTo(.34, 4);
    expect(day.snow!).toBeCloseTo(.30, 4);
    // Overcast sits between a clear day and night, which is the whole ask.
    for (const weather of ['fog', 'rain', 'snow'] as const) {
      expect(day[weather]!, `${weather} is dimmer than a clear day`).toBeLessThan(1);
      expect(day[weather]!, `${weather} is brighter than a clear night`).toBeGreaterThan(daylightOf('night', 'clear'));
    }
  });

  it('keeps night faint in every weather, and never leaves the 0..1 range', () => {
    for (const weather of WEATHERS) {
      const night = daylightOf('night', weather);
      expect(night, `night ${weather} is nearly dark`).toBeLessThan(.15);
      expect(night, `night ${weather} still shows something`).toBeGreaterThan(0);
    }
    for (const timeOfDay of ['day', 'night'] as const) for (const weather of WEATHERS) {
      const value = daylightOf(timeOfDay, weather);
      expect(value, `${timeOfDay}/${weather} stays a fraction of a clear day`).toBeLessThanOrEqual(1);
    }
  });
});
