import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { createSlimeBody, elasticSlimeMass, removeSlimeBody, slimeContact } from '../src/world/SlimePhysics';
import { roundSlimeScale, slimeScale } from '../src/world/slimeShape';
import { elasticDeformation, SLIME_COLORS, SlimeLayer } from '../src/world/Slimes';
import { Spline } from '../src/track/Spline';
import type { TrackData } from '../src/track/types';
import { QUALITY_LIMITS } from '../src/world/quality';
import { Car, NO_INPUT } from '../src/physics/Car';
import { tuningFor } from '../src/physics/CarTuning';
import { minimumVehicleMass } from '../src/vehicles/catalogue';
import { readTile } from '../src/world/tileContent';
import { MaterialLibrary } from '../src/world/materials';
let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); });

function floor(physics: PhysicsWorld): void {
  const c = physics.world.createCollider(api.ColliderDesc.cuboid(500, .1, 500)
    .setTranslation(0, -.1, 0));
  physics.registerCollider(c, 'ground');
}

it('samples uniform linear radii with one ordinary ratio and a taller growing colossus', () => {
  for (const kind of ['popper', 'slick', 'burst', 'boost', 'colossus'] as const) {
    const radii = Array.from({ length: 101 }, (_, i) => slimeScale(kind, i / 100));
    const step = radii[1]![0] - radii[0]![0];
    for (let i = 1; i < radii.length; i++) {
      const a = radii[i - 1]!; const b = radii[i]!;
      expect(b[0] - a[0]).toBeCloseTo(step, 10);
      const aRatio = a[1] / Math.max(a[0], a[2]);
      const bRatio = b[1] / Math.max(b[0], b[2]);
      if (kind === 'colossus') expect(bRatio).toBeGreaterThan(aRatio);
      else expect(bRatio).toBeCloseTo(.82, 10);
    }
  }
  expect(slimeScale('slick', 0)[0]).toBe(.75);
  expect(slimeScale('slick', 1)[0]).toBe(1.75);
  expect(SLIME_COLORS).toMatchObject({ burst: 0x07090d, slick: 0x9b5cff, boost: 0xf51d24 });
});

it('makes same-sized elastic slime one sixth as heavy as the former black body and damps every deformation wave', () => {
  const former = roundSlimeScale(.875);
  const newMaximum = slimeScale('slick', 1);
  expect(elasticSlimeMass(former)).toBeCloseTo(minimumVehicleMass() * .35 / 6, 5);
  expect(elasticSlimeMass(newMaximum) / elasticSlimeMass(former)).toBeCloseTo(8, 4);
  const hit = elasticDeformation(1, 0);
  expect(hit.along).toBeCloseTo(.54);
  expect(hit.across).toBeCloseTo(1.24);
  const envelopes = Array.from({ length: 9 }, (_, i) => i * Math.PI / 14).map(age => {
    const shape = elasticDeformation(1, age);
    return Math.max(Math.abs(shape.along - 1) / .46, Math.abs(shape.across - 1) / .24);
  });
  for (let i = 0; i < envelopes.length; i++)
    expect(envelopes[i]).toBeLessThanOrEqual(Math.exp(-i * Math.PI / 14 * 2.25) + 1e-8);
  expect(envelopes.at(-1)).toBeLessThan(.025);
});

it('resolves a solid elastic contact without adding launch energy or passing through', () => {
  const physics = new PhysicsWorld(api, 0);
  const source = physics.createRigidBody(api.RigidBodyDesc.dynamic().setTranslation(-5, 0, 0).setCcdEnabled(true));
  const carCollider = physics.createCollider(api.ColliderDesc.ball(1).setMass(650).setRestitution(0), source);
  physics.registerCollider(carCollider, 'car');
  const scale = slimeScale('slick', 1);
  const blob = createSlimeBody(physics, new THREE.Vector3(0, 0, 0), scale, 'elastic');
  const mass = source.mass(), blobMass = blob.body.mass(), speed = 20;
  const energy = .5 * mass * speed * speed;
  source.setLinvel({ x: speed, y: 0, z: 0 }, true);
  for (let i = 0; i < 30; i++) physics.step(1 / 60);
  const a = source.linvel(), b = blob.body.linvel();
  expect(blob.collider.isSensor()).toBe(false);
  expect(source.translation().x).toBeLessThan(blob.body.translation().x);
  expect(b.x).toBeGreaterThan(speed * .7);
  expect((mass * a.x + blobMass * b.x) / (mass * speed)).toBeGreaterThan(.9);
  expect((mass * a.x + blobMass * b.x) / (mass * speed)).toBeLessThanOrEqual(1.01);
  const after = .5 * mass * (a.x*a.x+a.y*a.y+a.z*a.z) + .5 * blobMass * (b.x*b.x+b.y*b.y+b.z*b.z);
  expect(after / energy).toBeGreaterThan(.35);
  expect(after / energy).toBeLessThan(.9);
  removeSlimeBody(physics, blob); physics.world.removeRigidBody(source); physics.dispose();
});

it('loses height on every physical elastic bounce and eventually comes to rest', () => {
  const physics = new PhysicsWorld(api);
  floor(physics);
  const scale = slimeScale('slick', 0);
  const blob = createSlimeBody(physics, new THREE.Vector3(0, 6, 0), scale, 'elastic');
  const peaks: number[] = [];
  let previousVy = blob.body.linvel().y;
  let touched = false;
  for (let i = 0; i < 1800 && !blob.body.isSleeping(); i++) {
    physics.step(1 / 60);
    touched ||= slimeContact(physics, blob) !== null;
    const velocity = blob.body.linvel();
    if (touched && previousVy > .05 && velocity.y <= .05
      && blob.body.translation().y > scale[1] + .1) peaks.push(blob.body.translation().y);
    previousVy = velocity.y;
  }
  expect(peaks.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < Math.min(5, peaks.length); i++) expect(peaks[i]).toBeLessThan(peaks[i - 1]! - .01);
  expect(blob.body.isSleeping() || Math.abs(blob.body.linvel().y) < .03).toBe(true);
  removeSlimeBody(physics, blob); physics.dispose();
});

it('records a real fragment wall contact, not an assumed ground-plane landing', () => {
  const physics = new PhysicsWorld(api, 0);
  const wall = physics.world.createCollider(api.ColliderDesc.cuboid(.2, 8, 8).setTranslation(4, 4, 0));
  physics.registerCollider(wall, 'wall');
  const fragment = createSlimeBody(physics, new THREE.Vector3(0, 3, 0), [.3, .3, .3], 'debris');
  fragment.body.setLinvel({ x: 20, y: 0, z: 0 }, true);
  let contact: ReturnType<typeof slimeContact> = null;
  for (let i = 0; i < 60 && !contact; i++) {
    physics.step(1 / 60);
    contact = slimeContact(physics, fragment);
  }
  expect(contact).not.toBeNull();
  expect(contact!.role).toBe('wall');
  expect(contact!.point.x).toBeCloseTo(3.8, 1);
  expect(contact!.normal.x).toBeLessThan(-.9);
  removeSlimeBody(physics, fragment);
  physics.dispose();
});

it('keeps a struck yellow body intact while it deforms, then replaces it with split children', () => {
  const physics = new PhysicsWorld(api);
  floor(physics);
  const spline = new Spline({ spline: { points: [[0, 0, 0], [200, 0, 0]], halfWidth: [10, 10],
    closed: false, length: 200 } } as TrackData);
  const scale = roundSlimeScale(1.2);
  const layer = new SlimeLayer(new THREE.Scene(), physics, spline, document.createElement('div'),
    QUALITY_LIMITS.low, [{ kind: 'slick', s: 20, position: [20, scale[1], 0], scale, yaw: 0 }]);
  const car = new Car(physics, tuningFor('sedan'), { pos: [14, .8, 0], yaw: -Math.PI / 2 });
  const step = () => {
    physics.step(1 / 60, h => {
      layer.prepareCar(car); car.update(h, NO_INPUT); layer.handleCar(car);
    }, 5, () => layer.finishPhysicsStep());
    layer.update(1 / 60);
  };
  car.body.setLinvel({ x: 15, y: 0, z: 0 }, true);
  for (let i = 0; i < 90 && layer.stats.bounceHits < 1; i++) step();
  expect(layer.stats.bounceHits).toBe(1);
  expect(layer.stats.elasticPeak).toBeGreaterThan(.2);
  expect(layer.stats.elasticDeforming).toBe(1);
  expect(car.position.y).toBeGreaterThan(-.5);
  car.reset([0, .8, 30], -Math.PI / 2);
  for (let i = 0; i < 600; i++) step();
  expect(layer.stats.elasticDeforming).toBe(0);
  expect(layer.stats.splitEvents).toBe(1);
  expect(layer.stats.splitChildren).toBeGreaterThanOrEqual(2);
  expect(layer.stats.active).toBeGreaterThanOrEqual(2);
  expect(layer.stats.puddles).toBe(0);
  expect(layer.stats.physicalFragments).toBe(0);
  layer.dispose(); physics.world.removeRigidBody(car.body);
  expect(physics.world.bodies.len()).toBe(0);
  physics.dispose();
});

it('routes scenery through the same living body and eye renderer, and removes it in no-slime mode', () => {
  for (const density of ['normal', 'many', 'none'] as const) {
    const scene = new THREE.Scene();
    const node = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
    node.name = 'scenery_slime';
    node.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(20, 2, 30),
      new THREE.Quaternion(), new THREE.Vector3(3, 2, 3)));
    scene.add(node);
    const extra = node.clone();
    extra.name = 'scenery_slime_many';
    extra.setMatrixAt(0, new THREE.Matrix4().makeTranslation(70, 2, 30));
    scene.add(extra);
    const content = readTile(scene, new MaterialLibrary(), density);
    if (density === 'none') { expect(content.slimes).toHaveLength(0); continue; }
    const count = density === 'many' ? 2 : 1;
    expect(content.slimes).toHaveLength(count);
    expect(content.slimes[0]).toMatchObject({ kind: 'popper', scenery: true, scale: [3, 2, 3] });
    expect(content.slimes.every(spawn => spawn.scenery)).toBe(true);
    expect(content.group.children[0]!.visible).toBe(false);
    const physics = new PhysicsWorld(api);
    const spline = new Spline({ spline: { points: [[0, 0, 0], [100, 0, 0]], halfWidth: [6, 6],
      closed: false, length: 100 } } as TrackData);
    const layer = new SlimeLayer(new THREE.Scene(), physics, spline, document.createElement('div'),
      QUALITY_LIMITS.low, []);
    layer.addTile('scenery', content.slimes);
    expect(layer.mesh.count).toBe(count);
    expect(layer.colossusEyes.count).toBe(count * 2);
    layer.removeTile('scenery');
    expect(layer.mesh.count).toBe(0);
    expect(physics.world.colliders.len()).toBe(0);
    layer.dispose(); physics.dispose();
  }
});


it('cancels a background fall before a moving car reaches its actual physical landing', () => {
  const physics = new PhysicsWorld(api);
  floor(physics);
  const spline = new Spline({ spline: { points: Array.from({length:101},(_,i)=>[i*2,0,0]), halfWidth:new Array(101).fill(8),
    closed:false,length:200 } } as TrackData);
  const layer = new SlimeLayer(new THREE.Scene(),physics,spline,document.createElement('div'),
    QUALITY_LIMITS.low,[]);
  const car = new Car(physics,tuningFor('sedan'),{pos:[0,.8,0],yaw:-Math.PI/2});
  car.update(1/60,NO_INPUT); physics.step(1/60);
  expect(physics.surfaceAt(50,0)).not.toBeNull();
  layer.prepareCar(car); layer.update(.01);
  const drops = (layer as unknown as {falling:{motion:ReturnType<typeof createSlimeBody>}[]}).falling;
  expect(drops).toHaveLength(1);
  /* */
  const p = drops[0]!.motion.body.translation();
  drops[0]!.motion.body.setTranslation({x:p.x,y:4,z:p.z},true);
  drops[0]!.motion.body.setLinvel({x:0,y:-8,z:0},true);
  car.reset([p.x-7,.8,p.z],-Math.PI/2);
  car.body.setLinvel({x:20,y:0,z:0},true);
  layer.update(1/60);
  expect(layer.stats.falling).toBe(0);
  expect(layer.stats.fallingLandings).toBe(0);
  expect(layer.stats.puddles).toBe(0);
  expect(layer.stats.physicalFragments).toBe(0);
  layer.dispose();physics.world.removeRigidBody(car.body);physics.dispose();
});

it('bounces an airdropped slime repeatedly, then leaves the intact body at its landing', () => {
  const physics = new PhysicsWorld(api);
  floor(physics);
  const spline = new Spline({ spline: { points: Array.from({ length: 101 }, (_, i) => [i * 2, 0, 0]),
    halfWidth: new Array(101).fill(8), closed: false, length: 200 } } as TrackData);
  const layer = new SlimeLayer(new THREE.Scene(), physics, spline, document.createElement('div'),
    QUALITY_LIMITS.low, []);
  const car = new Car(physics, tuningFor('sedan'), { pos: [0, .8, 0], yaw: -Math.PI / 2 });
  car.update(1 / 60, NO_INPUT);
  physics.step(1 / 60);
  layer.prepareCar(car);
  layer.update(.01);
  const state = layer as unknown as { fallingClock: number; falling: {
    motion: ReturnType<typeof createSlimeBody>; scale: [number, number, number];
    landing: THREE.Vector3;
  }[]; lives: { tile: string; spawn: { position: [number, number, number] } }[] };
  expect(state.falling).toHaveLength(1);
  state.fallingClock = 999;
  const drop = state.falling[0]!;
  const intended = drop.landing.clone();
  const productionStart = physics.bodyPosition(drop.motion.body);
  expect(Math.hypot(productionStart.x - intended.x, productionStart.z - intended.z)).toBeLessThan(.01);
  expect(Math.hypot(drop.motion.body.linvel().x, drop.motion.body.linvel().z)).toBeLessThan(.01);
  let upwardArcs = 0;
  let rising = false;
  let settledAt = Infinity;
  for (let i = 0; i < 600 && layer.stats.fallingSurvivors === 0; i++) {
    physics.step(1 / 60);
    layer.update(1 / 60);
    const live = state.falling[0];
    const vy = live?.motion.body.linvel().y ?? 0;
    if (vy > .5 && !rising) { upwardArcs++; rising = true; }
    if (vy < -.5) rising = false;
    if (layer.stats.fallingSurvivors > 0) settledAt = i / 60;
  }
  expect(layer.stats.fallingBounces).toBeGreaterThanOrEqual(3);
  expect(upwardArcs).toBeGreaterThanOrEqual(2);
  expect(settledAt).toBeLessThan(9);
  expect(layer.stats).toMatchObject({ falling: 0, fallingLandings: 1,
    fallingSurvivors: 1, physicalFragments: 0, puddles: 0 });
  const landed = state.lives.find(live => live.tile === '__falling__');
  expect(landed).toBeDefined();
  expect(Math.hypot(landed!.spawn.position[0] - intended.x,
    landed!.spawn.position[2] - intended.z)).toBeLessThan(1);
  layer.dispose();
  physics.world.removeRigidBody(car.body);
  physics.dispose();
});

it('detonates a black airdrop on its first real ground contact using the shared burst effect', () => {
  const physics = new PhysicsWorld(api);
  floor(physics);
  const spline = new Spline({ spline: { points: Array.from({ length: 101 }, (_, i) => [i * 2, 0, 0]),
    halfWidth: new Array(101).fill(8), closed: false, length: 200 } } as TrackData);
  const sound: [string, number, string?][] = [];
  const layer = new SlimeLayer(new THREE.Scene(), physics, spline, document.createElement('div'),
    QUALITY_LIMITS.low, [], (kind, strength, phase) => sound.push([kind, strength, phase]));
  const car = new Car(physics, tuningFor('sedan'), { pos: [0, .8, 0], yaw: -Math.PI / 2 });
  car.update(1 / 60, NO_INPUT); physics.step(1 / 60); layer.prepareCar(car);
  const state = layer as unknown as { fallingSerial: number; fallingClock: number; falling: {
    kind: string; motion: ReturnType<typeof createSlimeBody>; landing: THREE.Vector3 }[] };
  state.fallingSerial = 5; state.fallingClock = 0; layer.update(.01);
  expect(state.falling[0]!.kind).toBe('burst');
  const drop = state.falling[0]!;
  const wall = physics.world.createCollider(api.ColliderDesc.cuboid(.2, 8, 8)
    .setTranslation(drop.landing.x, 8, drop.landing.z));
  physics.registerCollider(wall, 'wall');
  drop.motion.body.setTranslation({ x: drop.landing.x - 3, y: 8, z: drop.landing.z }, true);
  drop.motion.body.setLinvel({ x: 14, y: 0, z: 0 }, true);
  for (let i = 0; i < 30; i++) { physics.step(1 / 60); layer.update(1 / 60); }
  expect(layer.stats.fallingExplosions).toBe(0);
  physics.unregisterCollider(wall); physics.world.removeCollider(wall, false);
  drop.motion.body.setTranslation({ x: drop.landing.x, y: drop.landing.y + 3, z: drop.landing.z }, true);
  drop.motion.body.setLinvel({ x: 0, y: -12, z: 0 }, true);
  for (let i = 0; i < 120 && layer.stats.fallingExplosions === 0; i++) {
    physics.step(1 / 60); layer.update(1 / 60);
  }
  expect(layer.stats).toMatchObject({ fallingExplosions: 1, fallingSurvivors: 0, falling: 0 });
  expect(sound.some(([kind, , phase]) => kind === 'burst' && phase === 'impact')).toBe(true);
  // A bomb bursts into sparks only; it no longer throws black debris.
  expect(layer.stats.physicalFragments).toBe(0);
  // The landing bomb leaves one burn on the road.
  expect((layer as any).effects.persistent.stats.scorches).toBe(1);
  layer.dispose(); physics.world.removeRigidBody(car.body); physics.dispose();
});


it('recognizes geometric contacts on the same seam-corrected triangle road used by shipped tracks', () => {
  const physics = new PhysicsWorld(api);
  physics.add('road', { boxes: [], trimeshes: [{ vertices: new Float32Array([
    -20,3,-20,20,3,-20,20,3,20,-20,3,20]), indices:new Uint32Array([0,2,1,0,3,2]), role:'ground' }] });
  const fragment = createSlimeBody(physics,new THREE.Vector3(0,5,0),[.3,.3,.3],'debris');
  let contact: ReturnType<typeof slimeContact> = null;
  for(let i=0;i<120&&!contact;i++){physics.step(1/60);contact=slimeContact(physics,fragment);}
  expect(contact).not.toBeNull();
  expect(contact!.point.y).toBeCloseTo(3,3);
  expect(contact!.normal.y).toBeGreaterThan(.99);
  removeSlimeBody(physics,fragment);physics.dispose();
});
