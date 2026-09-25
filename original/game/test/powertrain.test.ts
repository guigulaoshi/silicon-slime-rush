import { describe, expect, it } from 'vitest';
import { isPoweredWheel, poweredWheelCount } from '../src/physics/CarTuning';
import { GEAR_TOPS, IDLE_RPM, REDLINE_RPM, powertrainTarget, updatePowertrain } from '../src/physics/Powertrain';
import { VEHICLES, vehicleTuning } from '../src/vehicles/catalogue';
import type { CarKind } from '../src/track/types';

describe('drivetrain and powertrain', () => {
  it('sends engine torque only to the selected axle while retaining total engine force', () => {
    expect([0, 1, 2, 3].map(index => isPoweredWheel('fwd', index))).toEqual([true, true, false, false]);
    expect([0, 1, 2, 3].map(index => isPoweredWheel('rwd', index))).toEqual([false, false, true, true]);
    expect([0, 1, 2, 3].map(index => isPoweredWheel('awd', index))).toEqual([true, true, true, true]);
    expect(poweredWheelCount('fwd', 4)).toBe(2);
    expect(poweredWheelCount('rwd', 4)).toBe(2);
    expect(poweredWheelCount('awd', 4)).toBe(4);
  });

  it('derives one gear and RPM state from measured road speed with a visible shift drop', () => {
    expect(powertrainTarget(0, 0, 66, true)).toEqual({ gear: 1, rpm: IDLE_RPM, rpmFraction: 0 });
    const before = powertrainTarget(GEAR_TOPS[0] - 0.01, 1, 66, true);
    const after = powertrainTarget(GEAR_TOPS[0] + 0.01, 1, 66, true);
    expect(before.gear).toBe(1);
    expect(after.gear).toBe(2);
    expect(before.rpm).toBeGreaterThan(REDLINE_RPM - 20);
    expect(after.rpm).toBeLessThan(before.rpm * 0.6);
    expect(powertrainTarget(-20, 1, 66, true)).toEqual(powertrainTarget(20, 1, 66, true));
  });

  it('responds to throttle, lift and airborne wheel load while retaining vehicle-specific ratios', () => {
    const idle = powertrainTarget(0, 0, 50, true);
    const launch = updatePowertrain(idle, 0, 1, 50, true, .5);
    expect(launch.rpm).toBeGreaterThan(IDLE_RPM + 2000);
    const loaded = powertrainTarget(15, 1, 50, true);
    const lifted = powertrainTarget(15, 0, 50, true);
    expect(lifted.rpm).toBeLessThan(loaded.rpm);
    expect(powertrainTarget(15, 1, 86, true).rpm).not.toBe(loaded.rpm);
    expect(powertrainTarget(15, 1, 50, false).rpmFraction).toBeGreaterThan(loaded.rpmFraction);
  });

  it('assigns the intended drive layout to all nine garage vehicles', () => {
    expect(Object.fromEntries(VEHICLES.map(vehicle => [vehicle.id,
      vehicleTuning(vehicle, vehicle.tuning as CarKind).drive]))).toEqual({
      'micro-hatch': 'awd',
      'sports-car': 'rwd',
      'lightweight-sports': 'rwd',
      jeep: 'awd',
      'pickup-travel-trailer': 'awd',
      'monster-truck': 'awd',
      'school-bus': 'rwd',
      'retro-van': 'rwd',
      'city-pod': 'fwd',
    });
  });
});
