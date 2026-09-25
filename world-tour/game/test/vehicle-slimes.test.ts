import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Car, NO_INPUT } from '../src/physics/Car';
import { Trailer } from '../src/physics/Trailer';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { VEHICLES, modelPath, vehicleTuning, type VehicleDefinition } from '../src/vehicles/catalogue';
import { VehicleModel } from '../src/vehicles/VehicleModel';
import { Spline } from '../src/track/Spline';
import type { CarKind, TrackData } from '../src/track/types';
import { SlimeLayer, burstImpulse, type TileSlimeSpawn } from '../src/world/Slimes';
import { QUALITY_LIMITS } from '../src/world/quality';
import { evidencePath } from '../e2e/evidence';

let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); });

const spline = new Spline({ spline: { points: [[0, 0, 50], [0, 0, 0], [0, 0, -50], [0, 0, -100]],
  halfWidth: [10, 10, 10, 10], closed: false, length: 150 } } as TrackData);
function fixture(vehicle: VehicleDefinition, model?: VehicleModel) {
  const physics = new PhysicsWorld(api);
  physics.add('ground', { trimeshes: [], boxes: [
    { center: [0, -.5, 0], half: [200, .5, 200], yaw: 0, role: 'ground' },
  ] });
  const car = new Car(physics, vehicleTuning(vehicle, vehicle.tuning as CarKind), { pos: [0, 1.2, 0], yaw: 0 });
  const trailer = vehicle.trailer ? new Trailer(physics, car, vehicle) : null;
  for (let i = 0; i < 120; i++) {
    car.update(1 / 60, NO_INPUT); trailer?.update(1 / 60); physics.world.step();
  }
  const layer = new SlimeLayer(new THREE.Scene(), physics, spline, document.createElement('div'),
    QUALITY_LIMITS.low, [], () => undefined, model);
  const step = (input = NO_INPUT) => physics.step(1 / 60, h => {
    layer.prepareCar(car, trailer?.car); car.update(h, input); trailer?.update(h);
    layer.handleCar(car, input, trailer?.car);
  }, 5, h => layer.update(h));
  const dispose = () => { layer.dispose(); trailer?.dispose(); physics.dispose(); };
  return { physics, car, trailer, layer, step, dispose };
}
async function loadModel(vehicle: VehicleDefinition): Promise<VehicleModel> {
  const bytes = readFileSync(resolve('public', modelPath(vehicle)));
  const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  return new VehicleModel(gltf.scene, vehicle);
}

async function measureVehicle(vehicle: VehicleDefinition) {
  const model = await loadModel(vehicle);
  expect(model.windshield.isEmpty(), `${vehicle.id}: actual glazing sampled`).toBe(false);
  // One ray per windshield patch: a bevelled pane's hundreds of triangles cost 8 ms a slime hit.
  expect((model as any).glassSamples.length, `${vehicle.id}: pooled glass samples`).toBeLessThanOrEqual(20);
  const impacts = { burstVerticalSpeed: 0, popperRemainingSpeed: 0, popperCoverage: 0, burstCoverage: 0 };
  for (const kind of ['popper', 'burst', 'boost'] as const) {
    const rig = fixture(vehicle, model);
    const p = rig.car.position;
    rig.car.body.setLinvel({ x: 0, y: 0, z: -20 }, true);
    rig.trailer?.car.body.setLinvel({ x: 0, y: 0, z: -20 }, true);
    rig.layer.addTile('hit', [{ kind, position: [0, p.y, p.z - rig.car.tuning.chassisHalf[2]],
      scale: [.7, .7, .7], yaw: 0 }]);
    let peakY = 0;
    const coatsBefore = (model as any).bodyCoat.stats.impacts;
    for (let i = 0; i < 15; i++) { rig.step(); peakY = Math.max(peakY, rig.car.body.linvel().y); }
    expect(rig.layer.stats.feedback.hits[kind]).toBe(1);
    // A bomb leaves no splash coat on the body: it leaves a soot burn instead.
    // The red rocket leaves nothing on the body or the glass at all.
    expect((model as any).bodyCoat.stats.impacts - coatsBefore, `${vehicle.id} ${kind} body coat`).toBe(kind === 'boost' ? 0 : 1);
    if (kind === 'boost') {
      expect(rig.layer.stats.feedback.windshieldCoverage, `${vehicle.id}: no red smear on the glass`).toBe(0);
      rig.dispose(); continue;
    }
    expect((model as any).bodyCoat.stats.soot, `${vehicle.id} ${kind}: soot only from a bomb`).toBe(kind === 'burst');
    impacts[kind === 'burst' ? 'burstVerticalSpeed' : 'popperRemainingSpeed'] =
      kind === 'burst' ? peakY : rig.car.forwardSpeed;
    impacts[`${kind}Coverage`] = rig.layer.stats.feedback.windshieldCoverage;
    rig.dispose();
  }
  const speeds: number[] = [];
  const lateralSpeeds: number[] = [];
  for (const surface of ['dry', 'slick'] as const) {
    const rig = fixture(vehicle);
    const query = () => ({ slick: surface === 'slick' ? 1 : 0 });
    rig.car.setSurfaceQuery(query); rig.trailer?.car.setSurfaceQuery(query);
    rig.car.body.setLinvel({ x: 8, y: 0, z: -20 }, true);
    rig.trailer?.car.body.setLinvel({ x: 8, y: 0, z: -20 }, true);
    for (let i = 0; i < 20; i++) {
      rig.car.update(1 / 60, NO_INPUT); rig.trailer?.update(1 / 60); rig.physics.world.step();
    }
    speeds.push(surface === 'slick' ? Math.abs(rig.car.body.linvel().x) : rig.car.speed);
    lateralSpeeds.push(Math.abs(rig.car.body.linvel().x));
    rig.dispose();
  }
  const centre = model.windshield.getCenter(new THREE.Vector3());
  const front = model.splashCoverage(centre.clone().add(new THREE.Vector3(0, 0, -1)), 1.4);
  const behind = model.splashCoverage(centre.clone().add(new THREE.Vector3(0, 0, 2)), 1.4);
  expect(front, `${vehicle.id}: front ${front}, behind ${behind}; windshield ${centre.toArray()}`).toBeGreaterThan(behind);
  const giant = fixture(vehicle);
  giant.layer.addTile('giant', [{ kind: 'colossus', position: [0, 3.6, -15], scale: [5, 3.6, 20], yaw: 0 }]);
  giant.car.body.setLinvel({ x: 0, y: 0, z: -25 }, true);
  giant.trailer?.car.body.setLinvel({ x: 0, y: 0, z: -25 }, true);
  for (let i = 0; i < 60; i++) giant.step();
  expect(giant.layer.stats.colossusEntries).toBe(1);
  expect(giant.layer.stats.colossusTransit).toBe(true);
  const giantRemainingSpeed = giant.car.forwardSpeed;
  giant.dispose();
  const boost = fixture(vehicle);
  boost.layer.addTile('boost', [{ kind: 'boost', position: boost.car.position.toArray() as [number, number, number], scale: [2, 1.5, 3], yaw: 0 }]);
  for (let i = 0; i < 30; i++) boost.step();
  expect(boost.layer.stats.boostEntries).toBe(1);
  expect(boost.car.forwardSpeed).toBeGreaterThan(2);
  const boostSpeed = boost.car.forwardSpeed;
  boost.dispose();
  const row = { id: vehicle.id, ...impacts,
    slickLateralSpeed: speeds[1]!, slickPenalty: lateralSpeeds[1]! - lateralSpeeds[0]!,
    giantRemainingSpeed, boostSpeed, windshieldCentre: centre.toArray(), frontCoverage: front, rearCoverage: behind };
  model.update(0, 0, [], 0, 0);
  const splashOrigin = centre.clone().add(new THREE.Vector3(0, 0, -2));
  const priorCoats=model.bodyCoat.stats.impacts;
  model.splashBody(splashOrigin, 20);
  expect(model.bodyCoat.stats).toMatchObject({impacts:priorCoats+1,pending:true});
  model.group.position.set(20,3,-10);model.group.rotation.y=.7;
  model.update(0,0,[],0,1);
  expect(model.bodyCoat.stats).toMatchObject({opacity:0,pending:false});
  model.dispose();
  return row;
}

const rows: Awaited<ReturnType<typeof measureVehicle>>[] = [];
it.each(VEHICLES)('measures $id body, glazing, blast response and wet-road costs', async vehicle => {
  rows.push(await measureVehicle(vehicle));
});

it('retains complete cross-vehicle response comparisons', () => {
  expect(rows).toHaveLength(VEHICLES.length);
  const directory = evidencePath('vehicles'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'slime-metrics.json'), JSON.stringify({ conditions:
    '60Hz; actual GLBs/full rigs; same .7m blob at front bumper; 20m/s entry; wet-road probe 20 steps at [8,0,-20]; giant 25m/s entry sampled at 1s; boost from rest for .5s', rows }, null, 2) + '\n');
  const byId = Object.fromEntries(rows.map(row => [row.id, row]));
  // The new 650kg two-seater is lighter and more blast-sensitive than the Sedan.
  expect(byId['city-pod']!.burstVerticalSpeed).toBe(Math.max(...rows.map(row => row.burstVerticalSpeed!)));
  expect(byId['city-pod']!.burstVerticalSpeed).toBeGreaterThan(byId['micro-hatch']!.burstVerticalSpeed!);
  expect(byId['city-pod']!.burstVerticalSpeed).toBeLessThan(8);
  expect(byId['school-bus']!.burstVerticalSpeed).toBe(Math.min(...rows.map(row => row.burstVerticalSpeed!)));
  expect(rows.every(row => row.popperRemainingSpeed! > 15)).toBe(true);
  expect(byId['sports-car']!.slickPenalty).toBe(Math.max(...rows.map(row => row.slickPenalty)));
  expect(byId['city-pod']!.giantRemainingSpeed).toBe(Math.min(...rows.map(row => row.giantRemainingSpeed)));
  expect(byId['city-pod']!.giantRemainingSpeed).toBeLessThan(byId['micro-hatch']!.giantRemainingSpeed);
  expect(new Set(rows.map(row => row.popperCoverage!.toFixed(3))).size).toBeGreaterThan(2);
});

it.each(['tractor', 'trailer', 'both'] as const)('consumes one burst once when %s touches it', mode => {
  const rig = fixture(VEHICLES.find(vehicle => vehicle.trailer)!);
  const rear = rig.trailer!.car;
  const a = vi.spyOn(rig.car.body, 'applyImpulse'); const b = vi.spyOn(rear.body, 'applyImpulse');
  const position = mode === 'tractor' ? rig.car.position : mode === 'trailer' ? rear.position
    : rig.car.position.add(rear.position).multiplyScalar(.5);
  if (mode !== 'both') position.z -= 1;
  const scale = mode === 'both' ? 4 : 2;
  const height = scale * .82;
  rig.layer.addTile('blast', [{ kind: 'burst', position: position.toArray() as [number, number, number],
    scale: [scale, height, scale], yaw: 0 }]);
  rig.car.body.setLinvel({ x: 0, y: 0, z: -10 }, true);
  rear.body.setLinvel({ x: 0, y: 0, z: -10 }, true);
  for (let i = 0; i < 15; i++) rig.step();
  // One blast is shared by both coupled masses, whichever hull crosses first.
  expect(a.mock.calls.length).toBe(1);
  expect(b.mock.calls.length).toBe(1);
  expect(a.mock.calls[0]![0].y / rig.car.body.mass())
    .toBeCloseTo(b.mock.calls[0]![0].y / rear.body.mass(), 5);
  const total = [...a.mock.calls, ...b.mock.calls].reduce((sum, [impulse]) => sum + impulse.y, 0);
  const multiplier = mode === 'tractor' ? rig.car.tuning.ramMultiplier : rear.tuning.ramMultiplier;
  expect(total).toBeGreaterThan(0);
  // The game's own blast (burstImpulse), for the hull that touched: a copy of its formula here went stale.
  const toucher = mode === 'tractor' ? rig.car : rear;
  const expected = burstImpulse([scale, height, scale], new THREE.Vector3(), new THREE.Vector3(), multiplier, toucher.body.mass()).y;
  expect(total).toBeCloseTo(expected, 4);
  expect(rig.layer.stats.feedback.hits.burst).toBe(1);
  for (let i = 0; i < 150; i++) rig.step();
  expect(rig.trailer!.hitchGap).toBeLessThan(.15);
  rig.dispose();
});

it('keeps the whole rig connected through giant entry, floating, exit and reset', () => {
  const rig = fixture(VEHICLES.find(vehicle => vehicle.trailer)!);
  rig.layer.addTile('giant', [{ kind: 'colossus', position: [0, 3.6, -7], scale: [5, 3.6, 8], yaw: 0 }]);
  rig.car.body.setLinvel({ x: 0, y: 0, z: -12 }, true);
  rig.trailer!.car.body.setLinvel({ x: 0, y: 0, z: -12 }, true);
  let peakGap = 0; let rearLift = 0; let peakState = {};
  for (let i = 0; i < 360; i++) {
    rig.step({ throttle: 1, brake: 0, steer: 0 });
    if (rig.trailer!.hitchGap > peakGap) {
      peakGap = rig.trailer!.hitchGap;
      peakState = { step: i, transit: rig.layer.stats.colossusTransit, tractor: rig.car.position.toArray(),
        trailer: rig.trailer!.car.position.toArray(), upright: [rig.car.upright, rig.trailer!.car.upright] };
    }
    rearLift = Math.max(rearLift, rig.trailer!.car.position.y);
  }
  expect(rig.layer.stats.colossusEntries).toBe(1); expect(rig.layer.stats.colossusExits).toBe(1);
  expect(rearLift).toBeGreaterThan(3); expect(peakGap, JSON.stringify(peakState)).toBeLessThan(.15);
  expect(rig.layer.stats.colossusDrop).toBeGreaterThan(1);
  const directory = evidencePath('vehicles'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'giant-trailer.json'), JSON.stringify({ peakGap, peakState,
    rearLift, entries: rig.layer.stats.colossusEntries, exits: rig.layer.stats.colossusExits,
    drop: rig.layer.stats.colossusDrop }, null, 2) + '\n');
  rig.car.reset([0, 1, -7], 0); rig.trailer!.syncReset(); rig.step();
  expect(rig.layer.stats.colossusTransit).toBe(true);
  rig.car.reset([50, 1, 0], 0); rig.trailer!.syncReset(); rig.step();
  expect(rig.layer.stats.colossusTransit).toBe(false);
  rig.dispose();
});

it('applies one rear-only boost impulse, then clears the timed boost', () => {
  const rig = fixture(VEHICLES.find(vehicle => vehicle.trailer)!);
  const rear = rig.trailer!.car;
  const position = rear.position;
  const spawn = (kind: TileSlimeSpawn['kind']): TileSlimeSpawn => ({ kind,
    position: [position.x, position.y, position.z], scale: [1, 1, 1], yaw: 0 });
  rig.layer.addTile('boost', [spawn('boost')]);
  const a = vi.spyOn(rig.car.body, 'applyImpulse'); const b = vi.spyOn(rear.body, 'applyImpulse');
  for (let i = 0; i < 3; i++) rig.step();
  expect(rig.layer.stats.boostActive).toBe(true);
  expect(a).not.toHaveBeenCalled();
  expect(b).toHaveBeenCalledOnce();
  const impulse = b.mock.calls[0]![0];
  expect(Math.hypot(impulse.x, impulse.z)).toBeCloseTo(rear.tuning.mass * 6, 4);
  expect(impulse.z).toBeLessThan(0);
  expect(impulse.y).toBe(0);
  rig.car.reset([50, 1, 0], 0); rig.trailer!.syncReset();
  for (let i = 0; i < 150; i++) rig.step();
  expect(rig.layer.stats.boostActive).toBe(false);
  expect(rig.car.speed).toBeLessThan(.2);
  rig.dispose();
});
