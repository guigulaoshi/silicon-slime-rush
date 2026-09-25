import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, it, vi } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Car } from '../src/physics/Car';
import { Trailer } from '../src/physics/Trailer';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { VEHICLES, vehicleTuning, type VehicleDefinition } from '../src/vehicles/catalogue';
import { autopilotSettingsFor } from '../src/bot/Autopilot';
import { I18n } from '../src/ui/i18n';
import type { CarKind } from '../src/track/types';
import { evidencePath } from '../e2e/evidence';
import type { DriveType } from '../src/physics/CarTuning';
import { WEATHER_GRIP, type Weather } from '../src/world/Sky';

let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); });
const idle = { throttle: 0, brake: 0, steer: 0 };
function fixture(vehicle: VehicleDefinition) {
  const world = new PhysicsWorld(api);
  world.add('ground', { trimeshes: [], boxes: [
    { center: [0, -.5, 0], half: [20000, .5, 20000], yaw: 0, role: 'ground' },
  ] });
  const car = new Car(world, vehicleTuning(vehicle, vehicle.tuning as CarKind),
    { pos: [0, 1.2, 0], yaw: 0 });
  const trailer = vehicle.trailer ? new Trailer(world, car, vehicle) : null;
  const step = (input = idle) => {
    world.step(1 / 60, h => { car.update(h, input); trailer?.update(h); });
  };
  for (let i = 0; i < 120; i++) step();
  return { world, car, trailer, step };
}

it('makes rain braking longer than dry road and snow longer than rain', () => {
  const vehicle = VEHICLES.find(candidate => candidate.id === 'sports-car')!;
  const rows = (['clear', 'rain', 'snow'] as Weather[]).map(weather => {
    const rig = fixture(vehicle);
    rig.car.setWeatherGrip(WEATHER_GRIP[weather]);
    rig.car.body.setLinvel({ x: 0, y: 0, z: -25 }, true);
    const start = rig.car.position.clone();
    let seconds = 0;
    while (seconds < 12 && rig.car.forwardSpeed > .5) {
      rig.step({ throttle: 0, brake: 1, steer: 0 });
      seconds += 1 / 60;
    }
    const distance = rig.car.position.distanceTo(start);
    const curveLimit = rig.car.steeringSpeedLimit(.08, 80);
    rig.world.dispose();
    return { weather, distance, curveLimit };
  });
  expect(rows[0]!.distance).toBeLessThan(rows[1]!.distance);
  expect(rows[1]!.distance).toBeLessThan(rows[2]!.distance);
  expect(rows[0]!.curveLimit).toBeGreaterThan(rows[1]!.curveLimit);
  expect(rows[1]!.curveLimit).toBeGreaterThan(rows[2]!.curveLimit);
});

it('reports hard-brake skid on every playable body but keeps dry coasting clean', () => {
  for (const vehicle of VEHICLES) {
    const rig = fixture(vehicle);
    rig.car.body.setLinvel({ x: 0, y: 0, z: -25 }, true);
    let coast = 0;
    for (let i = 0; i < 12; i++) {
      rig.step(); coast = Math.max(coast, ...rig.car.wheels.map(wheel => wheel.skid));
    }
    expect(coast, `${vehicle.id} coasting`).toBeLessThan(.18);
    let braking = 0;
    for (let i = 0; i < 12; i++) {
      rig.step({ throttle: 0, brake: 1, steer: 0 });
      braking = Math.max(braking, ...rig.car.wheels.map(wheel => wheel.skid));
    }
    expect(braking, `${vehicle.id} braking`).toBeGreaterThan(.18);
    rig.world.dispose();
  }
});

it('records distinct same-car corner exits when only the driven axle changes', () => {
  const source = VEHICLES.find(vehicle => vehicle.id === 'sports-car')!;
  const rows = (['fwd', 'rwd', 'awd'] as DriveType[]).map(drive => {
    const vehicle = structuredClone(source);
    vehicle.handling = { ...vehicle.handling, drive, gripFront: 6.5, gripRear: 6.5 };
    const rig = fixture(vehicle);
    rig.car.body.setLinvel({ x: 0, y: 0, z: -18 }, true);
    let peakSlip = 0;
    for (let frame = 0; frame < 120; frame++) {
      rig.step({ throttle: 1, brake: 0, steer: .42 });
      peakSlip = Math.max(peakSlip, Math.abs(rig.car.slipAngle));
    }
    const row = { drive, x: rig.car.position.x, z: rig.car.position.z,
      heading: Math.atan2(rig.car.forward.x, -rig.car.forward.z),
      exitSpeed: rig.car.forwardSpeed, peakSlip };
    rig.world.dispose();
    return row;
  });
  const out = evidencePath('drivetrain'); mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'same-car-corner.json'), JSON.stringify({
    conditions: 'same sports-car geometry and neutral 6.5/6.5 lateral grip; 18m/s entry; 2s full throttle and 0.42 steering; only driven axle changes',
    rows,
  }, null, 2) + '\n');
  const spread = Math.max(...rows.map(row => row.x)) - Math.min(...rows.map(row => row.x));
  expect(spread).toBeGreaterThan(.2);
  expect(new Set(rows.map(row => `${row.heading.toFixed(3)}:${row.peakSlip.toFixed(3)}`)).size).toBe(3);
});

it('measures every complete vehicle under identical acceleration, braking, turning and roll inputs', () => {
  const rows = VEHICLES.map(vehicle => {
    const s = fixture(vehicle);
    let accelerationSeconds = Infinity; let topSpeed = 0;
    for (let i = 0; i < 40 * 60; i++) {
      s.step({ throttle: 1, brake: 0, steer: 0 });
      if (!Number.isFinite(accelerationSeconds) && s.car.forwardSpeed >= 20) accelerationSeconds = (i + 1) / 60;
      if (i >= 35 * 60) topSpeed += s.car.forwardSpeed / (5 * 60);
    }
    s.world.dispose();
    const brake = fixture(vehicle);
    brake.car.body.setLinvel({ x: 0, y: 0, z: -25 }, true);
    brake.trailer?.car.body.setLinvel({ x: 0, y: 0, z: -25 }, true);
    const start = brake.car.position.clone();
    let stopSeconds = 0;
    for (; stopSeconds < 10 && brake.car.forwardSpeed > .5; stopSeconds += 1 / 60) {
      brake.step({ throttle: 0, brake: 1, steer: 0 });
    }
    const brakingMetres = brake.car.position.distanceTo(start);
    brake.world.dispose();
    const turn = fixture(vehicle);
    turn.car.body.setLinvel({ x: 0, y: 0, z: -15 }, true);
    turn.trailer?.car.body.setLinvel({ x: 0, y: 0, z: -15 }, true);
    let minUpright = 1; let turnDistance = 0; let previous = turn.car.position.clone();
    for (let i = 0; i < 120; i++) {
      turn.step({ throttle: .2, brake: 0, steer: .3 });
      minUpright = Math.min(minUpright, turn.car.upright, turn.trailer?.car.upright ?? 1);
      turnDistance += turn.car.position.distanceTo(previous); previous.copy(turn.car.position);
    }
    const headingChange = Math.abs(Math.atan2(turn.car.forward.x, -turn.car.forward.z));
    turn.world.dispose();
    // Controlled airborne disturbance, not evidence of a real curb collision. The scan ceiling
    // limits experiment cost; it is not a requirement that every body roll at the same input.
    let rollRateThreshold = Infinity;
    for (let rate = 1; rate <= 64; rate += .5) {
      const roll = fixture(vehicle);
      roll.car.body.setLinvel({ x: 0, y: 3, z: 0 }, true);
      roll.trailer?.car.body.setLinvel({ x: 0, y: 3, z: 0 }, true);
      roll.car.body.setAngvel({ x: 0, y: 0, z: rate }, true);
      let reachedSide = false;
      for (let i = 0; i < 180; i++) { roll.step(); if (roll.car.upright < 0) reachedSide = true; }
      if (reachedSide) {
        rollRateThreshold = rate;
        roll.car.reset([0, 1.2, 0], 0); roll.trailer?.syncReset();
        for (let i = 0; i < 120; i++) roll.step({ throttle: .4, brake: 0, steer: 0 });
        expect(roll.car.upright).toBeGreaterThan(.9);
        expect(roll.car.forwardSpeed).toBeGreaterThan(1);
      }
      roll.world.dispose();
      if (reachedSide) break;
    }
    return { id: vehicle.id, massKg: vehicleTuning(vehicle).mass,
      accelerationSeconds, topSpeedKmh: topSpeed * 3.6, brakingMetres, stopSeconds,
      headingChange, turnDistance, minUpright, rollRateThreshold,
      lastNonRollingRate: Number.isFinite(rollRateThreshold) ? rollRateThreshold - .5 : 64 };
  });
  console.table(rows);
  const directory = evidencePath('performance'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'driving-metrics.json'), JSON.stringify({
    conditions: '60 Hz; flat dry road; full combination; 0–20 m/s; 40s full throttle; 25m/s braking; 15m/s turn at .3 input; synthetic 3m/s lift plus roll-rate pulse in .5rad/s steps, scan ceiling 64rad/s',
    rows: rows.map(row => ({ ...row, rollRateThreshold: Number.isFinite(row.rollRateThreshold) ? row.rollRateThreshold : 'not measured within scan range' })),
  }, null, 2) + '\n');
  for (const row of rows) {
    // Real utility and vintage vehicles no longer have sports-car launch times (183).
    expect(row.accelerationSeconds, row.id).toBeLessThan(35);
    expect(row.stopSeconds, row.id).toBeLessThan(10);
    expect(row.brakingMetres, `${row.id}: dry 90 km/h stop`).toBeGreaterThan(27);
    expect(row.brakingMetres, `${row.id}: dry 90 km/h stop`).toBeLessThan(52);
    expect(row.minUpright, `${row.id}: ordinary corner`).toBeGreaterThan(.6);
    expect(Number.isFinite(row.rollRateThreshold), `${row.id}: experiment must find a roll boundary`).toBe(true);
  }
  const byId = Object.fromEntries(rows.map(row => [row.id, row]));
  // Re-measured corrected contact velocities to use the actual offset COM, and again
  // sized every body at 0.7 of its real counterpart (wider track and taller shells for
  // the eight uniformly scaled cars; the monster truck is shorter, wider and lower on smaller wheels).
  expect(rows.filter(row => !['city-pod', 'lightweight-sports'].includes(row.id))
    .map(row => [row.id, row.lastNonRollingRate, row.rollRateThreshold])).toEqual([
    ['micro-hatch', 10, 10.5], ['sports-car', 15, 15.5], ['jeep', 8.5, 9],
    ['pickup-travel-trailer', 9.5, 10], ['monster-truck', 35.5, 36],
    ['school-bus', 9.5, 10], ['retro-van', 7, 7.5],
  ]);
  const small = byId['micro-hatch']!; const sports = byId['sports-car']!;
  const bus = byId['school-bus']!; const van = byId['retro-van']!;
  expect(sports.topSpeedKmh).toBe(Math.max(...rows.map(row => row.topSpeedKmh)));
  expect(van.topSpeedKmh).toBeLessThan(small.topSpeedKmh);
  expect(sports.topSpeedKmh).toBeGreaterThan(small.topSpeedKmh + 45);
  expect(vehicleTuning(VEHICLES.find(vehicle => vehicle.id === 'sports-car')!).enginePower!)
    .toBeGreaterThan(vehicleTuning(VEHICLES.find(vehicle => vehicle.id === 'micro-hatch')!).enginePower! * 1.5);
  expect(bus.brakingMetres).toBeGreaterThan(small.brakingMetres * 1.15);
  expect(bus.headingChange).toBeLessThan(small.headingChange);
  expect(van.rollRateThreshold).toBe(Math.min(...rows.map(row => row.rollRateThreshold)));
}, 120_000);

it('gives the lightweight sports car a tighter same-speed line than the high-performance car', () => {
  const measure = (id: string) => {
    const rig = fixture(VEHICLES.find(vehicle => vehicle.id === id)!);
    let distance = 0, rotation = 0, heading = 0, maxSlip = 0;
    const start = rig.car.position.clone();
    rig.car.body.setLinvel({ x: 0, y: 0, z: -18 }, true);
    for (let i = 0; i < 180; i++) {
      rig.step({ throttle: .35, brake: 0, steer: .45 });
      const next = Math.atan2(rig.car.forward.x, -rig.car.forward.z);
      rotation += Math.atan2(Math.sin(next - heading), Math.cos(next - heading));
      heading = next;
      maxSlip = Math.max(maxSlip, Math.abs(rig.car.slipAngle));
      distance += rig.car.position.distanceTo(start);
      start.copy(rig.car.position);
    }
    const result = { id, radius: distance / Math.abs(rotation), headingChange: Math.abs(rotation),
      maxSlip,
      massKg: rig.car.tuning.mass, topSpeedKmh: rig.car.tuning.maxSpeed * 3.6,
      steeringRate: rig.car.tuning.steerRate, maxLateralAccel: rig.car.tuning.maxLateralAccel };
    rig.world.dispose();
    return result;
  };
  const highPerformance = measure('sports-car');
  const lightweight = measure('lightweight-sports');
  const directory = evidencePath('lightweight-sports'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'handling.json'), JSON.stringify({
    conditions: '60 Hz flat dry road; both cars start at 18 m/s, then use 0.35 throttle and 0.45 steering for 3 s without velocity correction',
    highPerformance, lightweight,
  }, null, 2) + '\n');
  expect(lightweight.massKg).toBeLessThan(highPerformance.massKg * .85);
  expect(lightweight.topSpeedKmh).toBeLessThan(highPerformance.topSpeedKmh - 40);
  expect(lightweight.radius).toBeLessThan(highPerformance.radius * .95);
  expect(lightweight.headingChange).toBeGreaterThan(highPerformance.headingChange * 1.05);
  expect(lightweight.maxSlip).toBeLessThan(5 * Math.PI / 180);
});

it.each(VEHICLES)('$id stops applying recovery torque beyond its recoverable lean', vehicle => {
  const world = new PhysicsWorld(api);
  const tuning = vehicleTuning(vehicle, vehicle.tuning as CarKind);
  const car = new Car(world, tuning, { pos: [0, 20, 0], yaw: 0 });
  const torque = vi.spyOn(car.body, 'addTorque');
  for (const [angle, enabled] of [[tuning.uprightRecoveryLimit - .05, true],
    [tuning.uprightRecoveryLimit + .05, false]] as const) {
    car.body.setRotation({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) }, true);
    torque.mockClear(); car.update(1 / 60, idle);
    const recovery = torque.mock.calls.filter(([value]) => Math.abs(value.z) > 1);
    expect(recovery.length > 0).toBe(enabled);
  }
  torque.mockRestore(); world.dispose();
});

it('can trip a high van over a solid roadside obstacle without injecting rotation', () => {
  const rig = fixture(VEHICLES.find(vehicle => vehicle.id === 'retro-van')!);
  const rampBody = rig.world.world.createRigidBody(api.RigidBodyDesc.fixed());
  const ramp = rig.world.world.createCollider(api.ColliderDesc.cuboid(2, .1, 20)
    .setTranslation(2.5, 1.05, 0)
    .setRotation({ x: 0, y: 0, z: Math.sin(.6 / 2), w: Math.cos(.6 / 2) }), rampBody);
  rig.world.registerCollider(ramp, 'ground');
  rig.car.body.setLinvel({ x: 60, y: 0, z: -15 }, true);
  let minUpright = 1;
  for (let i = 0; i < 300; i++) {
    rig.step(); minUpright = Math.min(minUpright, rig.car.upright);
  }
  expect(minUpright).toBeLessThan(0);
  rig.car.reset([0, 1.2, 0], 0);
  for (let i = 0; i < 120; i++) rig.step({ throttle: .4, brake: 0, steer: 0 });
  expect(rig.car.upright).toBeGreaterThan(.9);
  expect(rig.car.forwardSpeed).toBeGreaterThan(1);
  rig.world.dispose();
});


it('small steering inputs produce small front-wheel angles instead of full cornering authority', () => {
  for (const vehicle of VEHICLES) {
    const angles = [.04, .12].map(steer => {
      const rig = fixture(vehicle);
      rig.car.body.setLinvel({ x: 0, y: 0, z: -15 }, true);
      rig.trailer?.car.body.setLinvel({ x: 0, y: 0, z: -15 }, true);
      for (let i = 0; i < 30; i++) rig.step({ throttle: 0, brake: 0, steer });
      const angle = Math.abs(rig.car.wheelSteeringAngle);
      rig.world.dispose();
      return angle;
    });
    expect(angles[0], vehicle.id).toBeGreaterThan(.001);
    expect(angles[0], `${vehicle.id}: small input must not request full lock`)
      .toBeLessThan(angles[1]! * .65);
  }
});

it('measures rolling wheel contact speed around each body\'s offset centre of mass', () => {
  const rig = fixture(VEHICLES.find(v => v.trailer)!);
  for (const car of [rig.car, rig.trailer!.car]) {
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 2 }, true);
    const com = car.body.worldCom();
    car.update(1 / 60, idle);
    const grounded = car.wheels.filter(w => w.grounded);
    expect(grounded.length).toBeGreaterThan(0);
    for (const wheel of grounded) {
      expect(wheel.slip).toBeCloseTo(-2 * (wheel.contact.y - com.y), 4);
    }
  }
  rig.world.dispose();
});

it('measures believable straight-line performance and the physical towing penalty', () => {
  const rows = [...VEHICLES, { ...VEHICLES.find(v => v.trailer)!, trailer: undefined }]
    .map((vehicle, index) => {
      const rig = fixture(vehicle);
      let to50: number | null = null; let to60Mph: number | null = null; let to100: number | null = null;
      let lastZ = rig.car.position.z; let distanceLast5 = 0;
      let top = 0; let airborneFrames = 0;
      for (let i = 0; i < 120 * 60; i++) {
        rig.step({ throttle: 1, brake: 0, steer: 0 });
        const kmh = rig.car.forwardSpeed * 3.6;
        if (!rig.car.grounded) airborneFrames++;
        if (to50 === null && kmh >= 50) to50 = (i + 1) / 60;
        if (to60Mph === null && kmh >= 96.56064) to60Mph = (i + 1) / 60;
        if (to100 === null && kmh >= 100) to100 = (i + 1) / 60;
        if (i >= 115 * 60) { top += kmh / 300; distanceLast5 += Math.abs(rig.car.position.z - lastZ); }
        lastZ = rig.car.position.z;
      }
      rig.world.dispose();
      return { id: index === VEHICLES.length ? 'pickup-solo' : vehicle.id, to50, to60Mph, to100, topKmh: top, distanceSpeedKmh: distanceLast5 / 5 * 3.6, airborneFrames };
    });
  const bounds: Record<string, [number, number, number, number]> = {
    'micro-hatch': [177, 183, 7, 10],
    // the player set 90, 220, 180 and 80 mph for these four; power was raised to reach them,
    // and with that power the city pod reaches 100 km/h in about 8 s rather than its old 10.3-12.7.
    'city-pod': [141, 148, 7, 12.7],
    'sports-car': [349, 359, 3.5, 5.5],
    'lightweight-sports': [285, 294, 3, 5],
    jeep: [175, 183, 6, 9],
    'pickup-travel-trailer': [115, 145, 11, 25],
    'monster-truck': [160, 174, 5, 13],
    // Reaching 80 mph needs about 210 kW; with that power 0-100 km/h cannot stay above 20 s.
    'school-bus': [124, 133, 10, 55],
    'retro-van': [100, 108, 30, 80],
    'pickup-solo': [156, 164, 7, 11],
  };
  const directory = evidencePath('performance'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'performance.json'),
    JSON.stringify({ conditions: '60Hz dry flat ground; 120s full throttle; last5s average; no speed injection', rows }, null, 2) + '\n');
  console.table(rows);
  for (const row of rows) {
    const [low, high, fast, slow] = bounds[row.id]!;
    expect(row.airborneFrames, row.id).toBe(0);
    expect(Math.abs(row.distanceSpeedKmh - row.topKmh), `${row.id}: actual travel agrees with speed`).toBeLessThan(0.2);
    expect(row.topKmh, row.id).toBeGreaterThan(low);
    expect(row.topKmh, row.id).toBeLessThan(high);
    expect(row.to100, row.id).not.toBeNull();
    expect(row.to100!, row.id).toBeGreaterThan(fast);
    expect(row.to100!, row.id).toBeLessThan(slow);
  }
  const solo = rows.at(-1)!; const towing = rows.find(r => r.id === 'pickup-travel-trailer')!;
  const sports = rows.find(r => r.id === 'sports-car')!;
  const nextFastest = Math.max(...rows.filter(r => r.id !== 'sports-car').map(r => r.topKmh));
  expect(sports.topKmh).toBeGreaterThan(nextFastest + 45);
  expect(towing.to100!).toBeGreaterThan(solo.to100! * 1.3);
  expect(towing.topKmh).toBeLessThan(solo.topKmh * .9);
}, 120_000);


it('builds bus keyboard steering progressively and releases it progressively', () => {
  const rig = fixture(VEHICLES.find(v => v.id === 'school-bus')!);
  const samples: number[] = [];
  for (let i = 0; i < 120; i++) {
    rig.step({ throttle: 0, brake: 0, steer: 1 });
    if ([5, 29, 119].includes(i)) samples.push(rig.car.steeringAngle);
  }
  expect(samples[0]!).toBeLessThan(.04);
  expect(samples[1]!).toBeGreaterThan(samples[0]! * 3);
  expect(samples[2]!).toBeGreaterThan(samples[1]! * 2);
  expect(samples[2]!).toBeLessThan(.5);
  rig.step();
  expect(rig.car.steeringAngle).toBeGreaterThan(samples[2]! * .9);
  for (let i = 0; i < 180; i++) rig.step();
  expect(rig.car.steeringAngle).toBe(0);
  rig.world.dispose();
});

it('measures all low-speed turns and high-speed full-lock limits', () => {
  const rows = VEHICLES.flatMap(vehicle => [5, 25].map(speed => {
    const rig = fixture(vehicle);
    let minUpright = 1; let distance = 0; let rotation = 0;
    let previous = rig.car.position.clone(); let heading = 0;
    for (let i = 0; i < 360; i++) {
      // Controlled comparable speed isolates steering geometry from engine acceleration.
      const forward = rig.car.forward;
      const velocity = rig.car.body.linvel();
      rig.car.body.setLinvel({ x: forward.x * speed, y: velocity.y, z: forward.z * speed }, true);
      rig.step({ throttle: 0, brake: 0, steer: 1 });
      const next = Math.atan2(rig.car.forward.x, -rig.car.forward.z);
      rotation += Math.atan2(Math.sin(next - heading), Math.cos(next - heading)); heading = next;
      distance += rig.car.position.distanceTo(previous); previous.copy(rig.car.position);
      minUpright = Math.min(minUpright, rig.car.upright, rig.trailer?.car.upright ?? 1);
    }
    rig.world.dispose();
    return { id: vehicle.id, speed, radius: distance / Math.abs(rotation), minUpright };
  }));
  console.table(rows);
  const directory = evidencePath('performance'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'steering.json'), JSON.stringify(rows, null, 2) + '\n');
  for (const vehicle of VEHICLES) {
    const low = rows.find(r => r.id === vehicle.id && r.speed === 5)!;
    const high = rows.find(r => r.id === vehicle.id && r.speed === 25)!;
    expect(low.radius, vehicle.id).toBeLessThan(25);
    expect(low.minUpright, vehicle.id).toBeGreaterThan(.6);
    expect(high.radius, vehicle.id).toBeGreaterThan(low.radius * 2);
  }
});


it('converts robot path curvature using each car current steering range', () => {
  for (const vehicle of VEHICLES) {
    const rig = fixture(vehicle);
    const tuning = rig.car.tuning;
    const wheelbase = Math.abs(tuning.wheels[0]![2] - tuning.wheels[2]![2]);
    for (const speed of [5, 25]) {
      rig.car.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
      const input = rig.car.steeringInputForCurvature(.003);
      for (let i = 0; i < 180; i++) rig.car.update(1 / 60, { throttle: 0, brake: 0, steer: input });
      expect(Math.abs(rig.car.wheelSteeringAngle), `${vehicle.id} at ${speed}`)
        .toBeCloseTo(Math.atan(.003 * wheelbase), 5);
    }
    rig.world.dispose();
  }
});

it('slows for wheels still facing the previous bend and respects the yaw budget after alignment', () => {
  const s = fixture(VEHICLES.find(vehicle => vehicle.id === 'school-bus')!);
  try {
    for (let i = 0; i < 300; i++) s.step({ ...idle, steer: s.car.steeringInputForCurvature(.12) });
    const before = s.car.steeringSpeedLimit(-.12, 2);
    expect(before).toBeLessThan(1);
    for (let i = 0; i < 300; i++) s.step({ ...idle, steer: s.car.steeringInputForCurvature(-.12) });
    const after = s.car.steeringSpeedLimit(-.12, 2);
    expect(after).toBeGreaterThan(before * 2);
    expect(after * .12).toBeLessThanOrEqual(s.car.tuning.maxYawRate);
    expect(after * after * .12).toBeLessThanOrEqual(s.car.tuning.maxLateralAccel);
  } finally { s.world.dispose(); }
});

it('plans curvature transitions against the same wheel slew used by real cars', () => {
  const limits: Record<string, number> = {};
  for (const id of ['school-bus', 'sports-car']) {
    const s = fixture(VEHICLES.find(vehicle => vehicle.id === id)!);
    const curvature = .12;
    const seconds = 2 / s.car.steeringTransitionSpeed(0, curvature, 2);
    limits[id] = seconds;
    const command = s.car.steeringInputForCurvature(curvature);
    const wheelbase = Math.abs(s.car.tuning.wheels[0]![2] - s.car.tuning.wheels[2]![2]);
    const needed = Math.atan(curvature * wheelbase);
    for (let i = 0; i < Math.ceil(seconds * 60); i++) s.step({ throttle: 0, brake: 0, steer: command });
    expect(s.car.steeringAngle).toBeCloseTo(needed, 2);
    expect(s.car.steeringTransitionSpeed(curvature, curvature, 2)).toBe(Infinity);
    s.world.dispose();
  }
  expect(limits['school-bus']!).toBeGreaterThan(limits['sports-car']!);
});

 it('plans stops within each vehicle brake budget and converts the actual measured speed', () => {
  for (const vehicle of VEHICLES) {
    const tuning = vehicleTuning(vehicle, vehicle.tuning as CarKind);
    const bot = autopilotSettingsFor(tuning);
    expect(bot.brakingAccel).toBeLessThanOrEqual(tuning.brakeForce / tuning.mass * .5);
    expect(bot.stopDecel).toBeLessThanOrEqual(tuning.brakeForce / tuning.mass * .5);
  }
  expect(new I18n('en').speed(249.44832)).toEqual({ value: 155, unit: 'mph' });
  expect(new I18n('zh').speed(249.44832)).toEqual({ value: 249, unit: 'km/h' });
});


it('reports lost grip before the body reaches the edge after a side impact', () => {
  const s = fixture(VEHICLES.find(vehicle => vehicle.id === 'pickup-travel-trailer')!);
  try {
    for (let i = 0; i < 120; i++) s.step(idle);
    s.car.body.setLinvel({ x: 0, y: 0, z: -10 }, true);
    expect(s.car.gripping).toBe(true);
    s.car.body.setLinvel({ x: 5, y: 0, z: -10 }, true);
    expect(s.car.gripping).toBe(true);
    s.car.body.setLinvel({ x: 10, y: 0, z: -10 }, true);
    expect(s.car.gripping).toBe(false);
    s.car.reset([0, 20, 0], 0);
    s.step(idle);
    expect(s.car.gripping).toBe(false);
  } finally { s.world.dispose(); }
});
