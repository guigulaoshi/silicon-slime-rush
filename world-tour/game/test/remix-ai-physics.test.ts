import { describe, expect, it } from 'vitest';
import { autopilotSettingsFor } from '../src/bot/Autopilot';
import { aiSettingsFor } from '../src/bot/difficulty';
import { tuningFor } from '../src/physics/CarTuning';

describe('remix fixes to the AI plan', () => {
  it('plans braking with the towed mass in the divisor', () => {
    const t = tuningFor('sedan');
    const alone = aiSettingsFor(t, 'rush');
    const towing = aiSettingsFor(t, 'rush', t.mass);
    expect(towing.brakingAccel).toBeCloseTo(alone.brakingAccel / 2, 5);
    expect(autopilotSettingsFor(t, t.mass).stopDecel).toBeLessThanOrEqual(autopilotSettingsFor(t).stopDecel);
    expect(aiSettingsFor(t, 'rush', 0)).toEqual(alone);   // no trailer: nothing changes
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Autopilot } from '../src/bot/Autopilot';
import { Spline } from '../src/track/Spline';
import { parseTrack } from '../src/track/schema';
import { vehicleFor, vehicleTuning } from '../src/vehicles/catalogue';
import type { TrackData } from '../src/track/types';

const synth = (): TrackData | null => {
  const path = resolve(process.cwd(), 'public/tracks/synth-p2p/track.json');
  return existsSync(path) ? parseTrack(JSON.parse(readFileSync(path, 'utf-8'))) : null;
};

describe('remix fixes to the AI driving', () => {
  it('crawls when only geometry holds a stopped car back', () => {
    const data = synth();
    if (!data) return;
    const spline = new Spline(data), index = 40, point = spline.point(index), tangent = spline.tangent(index);
    const vehicle = vehicleFor('sports-car')!, tuning = vehicleTuning(vehicle, vehicle.tuning as TrackData['car']);
    const view = { x: point[0], z: point[2], speed: 0, forwardSpeed: 0, headingX: tangent[0], headingZ: tangent[2],
      steeringSpeedLimit: () => 0 };                 // the geometry says zero, and goes on saying it
    const at = { index, s: spline.s[index]!, lateral: 0 };
    const input = new Autopilot(spline, autopilotSettingsFor(tuning)).drive(1 / 60, view, at);
    expect(input.throttle).toBeGreaterThan(0);
    // A real stop still holds.
    const held = new Autopilot(spline, autopilotSettingsFor(tuning)).drive(1 / 60, view, at, 1);
    expect(held.throttle).toBe(0);
  });

  it('brakes earlier for a corner at the bottom of a descent', () => {
    const data = synth();
    if (!data) return;
    // A straight 200 m run into a 20 m-radius corner; the same run again as a 10 % descent.
    const n = 130;
    const build = (grade: number) => {
      const track = structuredClone(data);
      track.spline.points = Array.from({ length: n }, (_, i) => [0, i < 100 ? (100 - i) * 2 * grade : 0, -i * 2]);
      track.spline.s = Array.from({ length: n }, (_, i) => i * 2);
      track.spline.curvature = Array.from({ length: n }, (_, i) => (i >= 100 && i < 115 ? .05 : 0));
      track.spline.halfWidth = Array.from({ length: n }, () => 6);
      return track;
    };
    const flat = build(0), hill = build(.10);
    const vehicle = vehicleFor('sports-car')!, tuning = vehicleTuning(vehicle, vehicle.tuning as TrackData['car']);
    // The slowest speed at which the driver already brakes 120 m before the corner.
    const brakesFrom = (track: TrackData) => {
      const spline = new Spline(track);
      for (let v = 5; v < 80; v += .5) {
        const view = { x: spline.point(40)[0], z: spline.point(40)[2], speed: v, forwardSpeed: v, headingX: 0, headingZ: -1 };
        if (new Autopilot(spline, autopilotSettingsFor(tuning)).drive(1 / 60, view,
          { index: 40, s: spline.s[40]!, lateral: 0 }).brake) return v;
      }
      return Infinity;
    };
    expect(brakesFrom(hill)).toBeLessThan(brakesFrom(flat));
  });
});

import { SKY_PRESETS, presetForLatitude } from '../src/world/Sky';
describe('the sun by latitude', () => {
  it('keeps the Bay Area exactly, stands higher in the tropics and swings north in the south', () => {
    expect(presetForLatitude('day', 37.8)).toEqual(SKY_PRESETS.day);
    expect(presetForLatitude('day', -2.7).elevation).toBeGreaterThan(SKY_PRESETS.day.elevation + 15);
    expect(presetForLatitude('day', 48.9).elevation).toBeLessThan(SKY_PRESETS.day.elevation);
    const sydney = presetForLatitude('day', -33.9).azimuth;
    expect(sydney > 270 || sydney < 90).toBe(true);          // the afternoon sun is in the north-west
    expect(presetForLatitude('night', -33.9)).toEqual({ ...SKY_PRESETS.night, elevation: presetForLatitude('night', -33.9).elevation });
  });
});

import { ALL_VEHICLES, VEHICLES, forTrack, slotOf, vehicleFor as findVehicle } from '../src/vehicles/catalogue';
import { raceRoster } from '../src/app/roster';
describe('a local car stands in its slot only on its own track', () => {
  it('keeps nine garage slots everywhere and swaps only what drives out of one', () => {
    expect(VEHICLES.every(v => !v.homeTrack)).toBe(true);
    const locals = ALL_VEHICLES.filter(v => v.homeTrack);
    for (const local of locals) {
      const slot = findVehicle(local.replaces)!;
      expect(forTrack(slot, local.homeTrack)).toBe(local);
      expect(forTrack(slot, 'somewhere-else')).toBe(slot);
      expect(slotOf(local)).toBe(slot);
      const roster = raceRoster([findVehicle('micro-hatch')!], true, Infinity, () => undefined, local.homeTrack);
      expect(roster.some(entry => entry.vehicle === local)).toBe(true);
      expect(roster.some(entry => entry.vehicle === slot)).toBe(false);
    }
    expect(raceRoster([findVehicle('micro-hatch')!], true).length).toBe(VEHICLES.length);
  });
});
