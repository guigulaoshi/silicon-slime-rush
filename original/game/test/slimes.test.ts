import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sky } from '../src/world/Sky';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Trailer } from '../src/physics/Trailer';
import { Car, NO_INPUT } from '../src/physics/Car';
import { tuningFor } from '../src/physics/CarTuning';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Spline } from '../src/track/Spline';
import type { TrackData, Vec3 } from '../src/track/types';
import { slimeScale, slimeGroundFraction } from '../src/world/slimeShape';
import { createSlimeBody, elasticSlimeMass, removeSlimeBody, type SlimeBody } from '../src/world/SlimePhysics';
import { MIN_SPLIT_RADIUS, isSmallestSplitter, SLIME_BODY_OPACITY, SLIME_COLORS, SLIME_DROPLET_OPACITY,
  SlimeLayer, burstCrossedCentre, burstImpulse, burstSparkScale, pieceVariation, burstSignedDistance, colossusContains,
  colossusSurfacePoint, collisionSplashVelocity, directionalSplashVelocity,
  leavesSplatter, prototypeSlimeSpawns, type SlimeKind,
  type TileSlimeSpawn } from '../src/world/Slimes';
import { readTile } from '../src/world/tileContent';
import { MaterialLibrary } from '../src/world/materials';
import { QUALITY_LIMITS } from '../src/world/quality';
import { vehicleFor, vehicleTuning } from '../src/vehicles/catalogue';

let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); }, 60_000);

function prototypeSpline(): Spline {
  const points: Vec3[] = [];
  for (let i = 0; i <= 750; i++) points.push([i * 2, 0, 0]);
  return new Spline({
    id: 'synth-loop', version: 1, editions: ['full'], category: 'race', mode: 'loop', laps: 3,
    name: { zh: '', en: '' }, blurb: { zh: '', en: '' }, origin: { lat: 0, lon: 0 },
    timeOfDay: 'day', car: 'sedan',
    spline: { points, halfWidth: new Array(points.length).fill(8), closed: true, length: 1500 },
    start: { pos: [0, 0.8, 0], yaw: 0 }, checkpoints: [], tiles: [], attribution: [],
  } as TrackData);
}

it('previews only solid bouncing collisions using both actual vehicle hulls', () => {
  const physics = new PhysicsWorld(api, 0);
  const layer = new SlimeLayer(new THREE.Scene(), physics, prototypeSpline(), document.createElement('div'),
    QUALITY_LIMITS.low, [{ kind: 'slick', s: 30, position: [30, 2, 0], scale: [3, 3, 3], yaw: 0 },
      { kind: 'popper', s: 15, position: [15, 2, 0], scale: [3, 3, 3], yaw: 0 }]);
  const car = new Car(physics, tuningFor('sedan'), { pos: [0, 2, 0], yaw: -Math.PI / 2 });
  const rear = new Car(physics, tuningFor('sedan'), { pos: [-10, 2, 0], yaw: -Math.PI / 2 });
  try {
    physics.step(1 / 60, () => undefined);
    expect(layer.distanceToHazard(car, 100)).toBeGreaterThan(20);
    expect(layer.distanceToHazard(car, 100)).toBeLessThan(30);
    expect(layer.distanceToHazard(car, 10)).toBeNull();
    car.reset([0, 2, 20], -Math.PI / 2);
    physics.step(1 / 60, () => undefined);
    expect(layer.distanceToHazard(car, 100)).toBeNull();
    expect(layer.distanceToHazard(car, 100, rear)).not.toBeNull();
    car.reset([60, 2, 0], -Math.PI / 2);
    physics.step(1 / 60, () => undefined);
    expect(layer.distanceToHazard(car, 100)).toBeNull();
  } finally { layer.dispose(); physics.dispose(); }
});

describe('prototype slime population', () => {
  it('puts all five kinds into seventy-two larger risk lines with the starting mix', () => {
    const spline = prototypeSpline();
    const spawns = prototypeSlimeSpawns(spline);
    const counts = Object.fromEntries(['popper', 'slick', 'burst', 'boost', 'colossus']
      .map((kind) => [kind, spawns.filter((spawn) => spawn.kind === kind).length]));
    expect(spawns).toHaveLength(72);
    expect(counts).toEqual({ popper: 28, slick: 15, burst: 10, boost: 17, colossus: 2 });
    expect(new Set(spawns.slice(0, 5).map((spawn) => spawn.kind)).size).toBe(5);
    for (const spawn of spawns.filter((item) => item.kind !== 'colossus')) {
      expect(Math.abs(spawn.position[2]) + spawn.scale[0]).toBeLessThanOrEqual(8);
    }
    const giant = spawns.find((spawn) => spawn.kind === 'colossus')!;
    expect(giant.scale[0] * 2).toBeGreaterThanOrEqual(9);
    expect(giant.scale[1] * 2).toBeGreaterThanOrEqual(6);
    expect(giant.scale[2] * 2).toBeGreaterThanOrEqual(14.4);
    expect(giant.position[2]).toBe(0);
    expect(giant.scale[2]).toBeLessThanOrEqual(21.6);
    expect(colossusContains(giant, new THREE.Vector3(giant.position[0], .8, 0))).toBe(true);
    const boost = spawns.find((spawn) => spawn.kind === 'boost')!;
    const offsets = spawns.filter(item => item.kind !== 'colossus').map(item => item.position[2]);
    expect(offsets.some(offset => Math.abs(offset) < .5)).toBe(true);
    expect(Math.min(...offsets)).toBeLessThan(-3);
    expect(Math.max(...offsets)).toBeGreaterThan(3);
    expect(boost.scale[2]).toBeGreaterThanOrEqual(slimeScale('boost', 0)[2]);
    expect(boost.scale[2]).toBeLessThanOrEqual(slimeScale('boost', 1)[2]);
    expect(prototypeSlimeSpawns(spline, 200)).toHaveLength(200);
  });

  it('covers every racing lane at car height and keeps one ordinary height ratio', () => {
    const small = slimeScale('popper', 0), giant = slimeScale('colossus', 1);
    expect(small[0] * 2).toBeCloseTo(1);
    expect(giant[0] * 2).toBeCloseTo(24 * 1.8);
    expect(small[1] / small[0]).toBeCloseTo(.82);
    expect(slimeScale('popper', 1)[1] / slimeScale('popper', 1)[0]).toBeCloseTo(.82);
    const spawn = prototypeSlimeSpawns(prototypeSpline()).find(item => item.kind === 'colossus')!;
    for (let lateral = -6; lateral <= 6; lateral += .25) {
      expect(colossusContains(spawn, new THREE.Vector3(spawn.position[0], .8, lateral))).toBe(true);
    }
  });

  it('uses the visible colossus skirt as the transit boundary', () => {
    const spawn = prototypeSlimeSpawns(prototypeSpline()).find((item) => item.kind === 'colossus')!;
    const [x, y, z] = spawn.position;
    const atLocalX = (amount: number) => new THREE.Vector3(
      x + Math.cos(spawn.yaw) * amount, y - spawn.scale[1] * 0.7,
      z - Math.sin(spawn.yaw) * amount);
    expect(colossusContains(spawn, atLocalX(spawn.scale[0] * 0.82))).toBe(true);
    expect(colossusContains(spawn, atLocalX(spawn.scale[0] * 0.94))).toBe(false);
    const surface = colossusSurfacePoint(spawn, atLocalX(spawn.scale[0] * 2));
    const outward = surface.point.clone().sub(new THREE.Vector3(...spawn.position)).normalize();
    expect(surface.error).toBeLessThan(1e-8);
    expect(colossusContains(spawn, surface.point.clone().addScaledVector(outward, -.02))).toBe(true);
    expect(colossusContains(spawn, surface.point.clone().addScaledVector(outward, .02))).toBe(false);
  });

  it('aims spray from the measured contact while retaining a little tangential motion', () => {
    const velocity = collisionSplashVelocity({ normal: { x: 0, y: 0, z: -1 }, closingSpeed: 5 },
      new THREE.Vector3(10, 0, 5));
    expect(velocity.z).toBeCloseTo(5);
    expect(velocity.x).toBeCloseTo(2.2);
    expect(velocity.z).toBeGreaterThan(velocity.x);
  });

  function fixture(kind: SlimeKind, ramMultiplier = 1,
    onSound: ConstructorParameters<typeof SlimeLayer>[6] = () => undefined) {
    const spline = prototypeSpline();
    const spawns = prototypeSlimeSpawns(spline);
    const spawn = spawns.find((candidate) => candidate.kind === kind)!;
    const physics = new PhysicsWorld(api, 0);
    const scene = new THREE.Scene();
    const host = document.createElement('div');
    const layer = new SlimeLayer(scene, physics, spline, host, QUALITY_LIMITS.low,
      spawns, onSound);
    const floorBody = physics.world.createRigidBody(api.RigidBodyDesc.fixed());
    const floor = physics.world.createCollider(api.ColliderDesc.cuboid(1000, 0.1, 1000)
      .setTranslation(0, -0.1, 0), floorBody);
    physics.registerCollider(floor, 'ground');
    physics.world.propagateModifiedBodyPositionsToColliders();
    const tuning = tuningFor('sedan');
    tuning.ramMultiplier = ramMultiplier;
    const car = new Car(physics, tuning, { pos: [spawn.position[0], .8, spawn.position[2]], yaw: 0 });
    return { spawn, physics, scene, host, layer, car };
  }

  it('keeps two drivers giant transit, reset revision and windshield feedback separate', () => {
    const f = fixture('colossus');
    const other = new Car(f.physics, tuningFor('sedan'), { pos: [0, 1, 100], yaw: 0 });
    f.layer.prepareCar(other); f.layer.prepareCar(f.car);
    f.layer.handleCar(f.car); f.layer.handleCar(other);
    expect(f.layer.driverStats(f.car).colossusTransit).toBe(true);
    expect(f.layer.driverStats(other).colossusTransit).toBe(false);
    expect(f.layer.driverStats(f.car).feedback.hits.colossus).toBe(1);
    expect(f.layer.driverStats(other).feedback.hits.colossus).toBe(0);
    const left = new THREE.PerspectiveCamera(), right = new THREE.PerspectiveCamera();
    f.layer.updateCamera(.01, left, other); f.layer.updateCamera(.01, right, f.car);
    expect(left.position.length()).toBe(0); expect(right.position.length()).toBe(0);
    other.reset([...f.spawn.position], 0);
    f.layer.handleCar(other);
    expect(f.layer.driverStats(other).colossusTransit).toBe(true);
    f.car.reset([0, 1, 100], 0); f.layer.handleCar(f.car);
    expect(f.layer.driverStats(f.car).colossusTransit).toBe(false);
    expect(f.layer.driverStats(other).colossusTransit).toBe(true);
    f.layer.dispose(); f.physics.dispose();
  });

  function collide(kind: 'popper' | 'slick' | 'burst' | 'colossus', speed = 0) {
    const f = fixture(kind);
    if (speed) f.car.body.setLinvel({ x: speed, y: 0, z: 0 }, true);
    for (let i = 0; i < 3; i++) {
      f.physics.step(f.physics.timestep, (h) => {
        f.layer.prepareCar(f.car);
        f.car.update(h, NO_INPUT);
        f.layer.handleCar(f.car);
      });
    }
    return f;
  }

  function dispose(f: ReturnType<typeof fixture>): void {
    f.layer.dispose();
    f.physics.dispose();
  }

  it.each(['popper', 'slick', 'burst', 'boost', 'colossus'] as const)('reports the actual %s body on contact', kind => {
    const f = fixture(kind); const hits: { key: string; scale: readonly number[] }[] = [];
    f.layer.onHit = (key, scale) => hits.push({ key, scale: [...scale] });
    for (let i = 0; i < 4; i++) f.physics.step(f.physics.timestep, h => {
      f.layer.prepareCar(f.car); f.car.update(h, NO_INPUT); f.layer.handleCar(f.car);
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.scale).toEqual(f.spawn.scale);
    expect(new Set(hits.map(hit => hit.key)).size).toBe(1);
    dispose(f);
  });

  it.each(['popper', 'slick', 'burst', 'boost', 'colossus'] as const)(
    'plays one %s entry at the body and a separate exit after the car clears it', kind => {
      const sound = vi.fn();
      const f = fixture(kind, 1, sound);
      for (let i = 0; i < 5; i++) f.physics.step(f.physics.timestep, h => {
        f.layer.prepareCar(f.car); f.car.update(h, NO_INPUT); f.layer.handleCar(f.car); f.layer.update(h);
      });
      expect(sound.mock.calls.filter(([heard, , phase]) => heard === kind && phase === 'enter'))
        .toHaveLength(1);
      f.physics.setBodyPosition(f.car.body, { x: f.spawn.position[0] + 80, y: .8,
        z: f.spawn.position[2] + 80 });
      f.layer.update(.1);
      for (let i = 0; i < 3; i++) f.physics.step(f.physics.timestep, h => {
        f.layer.prepareCar(f.car); f.car.update(h, NO_INPUT); f.layer.handleCar(f.car);
      });
      expect(sound.mock.calls.filter(([heard, , phase]) => heard === kind && phase === 'exit'))
        .toHaveLength(1);
      dispose(f);
    },
  );

  it('keeps landed identities stable when the 32-body history evicts its first item', () => {
    const f = fixture('slick');
    const layer = f.layer as unknown as {
      spawnLandedSlime(value: unknown): void;
      tileSpawns: Map<string, unknown[]>;
      landedKeys: WeakMap<object, string>;
    };
    for (let i = 0; i < 32; i++) layer.spawnLandedSlime({ kind: 'slick', scale: [1, 1, 1],
      landing: new THREE.Vector3(i * 4, 0, 0), motion: { body: f.car.body } });
    const old = layer.tileSpawns.get('__falling__')!;
    const keys = old.map(spawn => layer.landedKeys.get(spawn as object));
    layer.spawnLandedSlime({ kind: 'slick', scale: [1, 1, 1],
      landing: new THREE.Vector3(128, 0, 0), motion: { body: f.car.body } });
    const next = layer.tileSpawns.get('__falling__')!;
    expect(next).toHaveLength(32);
    expect(next.slice(0, 31).map(spawn => layer.landedKeys.get(spawn as object))).toEqual(keys.slice(1));
    expect(keys).not.toContain(layer.landedKeys.get(next[31] as object));
    dispose(f);
  });

  it('uses one mesh and keeps pooled effects and surface zones inside low-tier caps', () => {
    const spline = prototypeSpline();
    const physics = new PhysicsWorld(api, 0);
    const scene = new THREE.Scene();
    const host = document.createElement('div');
    const layer = new SlimeLayer(scene, physics, spline, host, QUALITY_LIMITS.high,
      prototypeSlimeSpawns(spline, 200));

    expect(layer.mesh.count).toBe(200);
    expect(scene.getObjectByName('slimes')).toBe(layer.mesh);
    expect(scene.children).toEqual([layer.group]);
    expect(layer.colossusEyes.parent).toBe(layer.group);
    expect(layer.stats).toMatchObject({ spawned: 200, active: 200, colossi: 4, groundEffects: 0 });
    layer.updateCamera(1 / 60, new THREE.PerspectiveCamera());
    expect(host.querySelector<HTMLElement>('.slime-windshield')?.style.opacity).toBe('0');
    layer.setLimits(QUALITY_LIMITS.low);
    expect(layer.stats.groundEffects).toBe(0);
    expect(layer.stats.active).toBe(200);
    expect(Object.values(layer.stats.byKind).reduce((sum, count) => sum + count, 0)).toBe(200);
    expect(layer.stats.colossi).toBeLessThanOrEqual(QUALITY_LIMITS.low.colossi);
    expect(layer.mesh.count).toBe(200);
    const kinds = layer.mesh.geometry.getAttribute('slimeKind') as THREE.InstancedBufferAttribute;
    expect(new Set(Array.from({ length: layer.mesh.count }, (_, i) => kinds.getX(i))))
      .toEqual(new Set([0, 1, 2, 3, 4]));
    const triangles = (layer.mesh.geometry.index?.count
      ?? layer.mesh.geometry.getAttribute('position').count) / 3;
    expect(triangles).toBeGreaterThan(1400);
    expect(triangles).toBeLessThan(1600);
    expect((layer.mesh.material as THREE.ShaderMaterial).transparent).toBe(true);
    expect((layer.mesh.material as THREE.ShaderMaterial).depthWrite).toBe(true);
    expect(layer.mesh.castShadow).toBe(false);
    expect(layer.mesh.frustumCulled).toBe(false);
    expect(layer.colossusDebris.frustumCulled).toBe(false);
    expect(layer.colossusWheels.frustumCulled).toBe(false);
    expect(layer.colossusSeatBacks.frustumCulled).toBe(false);
    expect(layer.colossusSeatCushions.frustumCulled).toBe(false);
    expect(layer.colossusEyes.frustumCulled).toBe(false);
    expect(scene.getObjectByName('colossus-eye-highlights')).toBeUndefined();
    expect(scene.getObjectByName('colossus-blush')).toBeUndefined();

    layer.dispose();
    physics.dispose();
  });

  it('moves the fixed particle pool in the shader and leaves the instance matrices static', () => {
    const f = collide('popper');
    const particles = f.scene.getObjectByName('slime-particles') as THREE.InstancedMesh;
    const geometry = particles.geometry;
    const material = particles.material as THREE.ShaderMaterial;
    expect(material.vertexShader).toContain('effectVelocity * age');
    expect(material.vertexShader).toContain('-6.0 * age * age');
    expect(geometry.getAttribute('effectOrigin')).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(geometry.getAttribute('effectVelocity')).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(geometry.getAttribute('effectBorn')).toBeInstanceOf(THREE.InstancedBufferAttribute);
    const version = particles.instanceMatrix.version;
    const before = new THREE.Matrix4();
    particles.getMatrixAt(0, before);
    f.layer.update(0.25);
    const after = new THREE.Matrix4();
    particles.getMatrixAt(0, after);
    expect(after.elements).toEqual(before.elements);
    expect(particles.instanceMatrix.version).toBe(version);
    expect(material.uniforms.uEffectTime?.value).toBeCloseTo(0.25);
    dispose(f);
  });

  it('carries measured impact direction into the splash instead of spraying a context-free circle', () => {
    const f = fixture('popper');
    f.physics.setBodyPosition(f.car.body, { x: f.spawn.position[0] - 3, y: .8,
      z: f.spawn.position[2] });
    f.car.body.setLinvel({ x: 20, y: 0, z: 0 }, true);
    for (let i = 0; i < 12 && !f.layer.stats.feedback.hits.popper; i++) {
      f.physics.step(f.physics.timestep, h => {
        f.layer.prepareCar(f.car); f.car.update(h, NO_INPUT); f.layer.handleCar(f.car);
      });
    }
    expect(f.layer.stats.feedback.hits.popper).toBe(1);
    const particles = f.scene.getObjectByName('slime-particles') as THREE.InstancedMesh;
    const velocity = particles.geometry.getAttribute('effectVelocity') as THREE.InstancedBufferAttribute;
    const meanX = Array.from({ length: 24 }, (_, i) => velocity.getX(i))
      .reduce((sum, value) => sum + value, 0) / 24;
    expect(meanX).toBeGreaterThan(2.5);
    dispose(f);
  });

  it('aligns decorative puddles to the road normal, raises them and recycles the oldest slot', () => {
    const spline = prototypeSpline();
    const physics = new PhysicsWorld(api, 0);
    const scene = new THREE.Scene();
    const limits = { ...QUALITY_LIMITS.low, particles: 200, puddles: 3 };
    const layer = new SlimeLayer(scene, physics, spline, document.createElement('div'), limits, []);
    const effects = (layer as unknown as { effects: {
      emit(kind: SlimeKind, position: THREE.Vector3, ground: THREE.Vector3,
        normal: THREE.Vector3, seconds?: number): void;
      particles: THREE.InstancedMesh;
      puddles: THREE.InstancedMesh;
    } }).effects;
    expect(effects.puddles.instanceColor).not.toBeNull();
    const normal = new THREE.Vector3(0, 1, 1).normalize();
    const ground = new THREE.Vector3(4, 2, 6);
    effects.emit('popper', new THREE.Vector3(4, 3, 6), ground, normal, 10);
    // The red rocket leaves no puddle, so the purple one fills the middle slot.
    effects.emit('slick', new THREE.Vector3(8, 3, 6), ground, normal, 10);
    effects.emit('colossus', new THREE.Vector3(12, 3, 6), ground, normal, 10);

    expect(layer.stats).toMatchObject({ puddles: 3, groundEffects: 0 });
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    effects.puddles.getMatrixAt(2, matrix);
    matrix.decompose(position, rotation, scale);
    expect(position.distanceTo(ground.clone().addScaledVector(normal, 0.025))).toBeLessThan(1e-5);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).angleTo(normal)).toBeLessThan(1e-5);
    expect(scale.x).toBeGreaterThan(1.2);
    expect(scale.x).toBeLessThan(3.4);
    const colour = new THREE.Color();
    effects.puddles.getColorAt(2, colour);
    expect(colour.getHex()).toBe(SLIME_COLORS.colossus);
    effects.particles.getColorAt(0, colour);
    expect(colour.getHex()).toBe(0x63ff35);
    effects.particles.getColorAt(48, colour);
    expect(colour.getHex()).toBe(SLIME_COLORS.slick);
    effects.particles.getColorAt(72, colour);
    expect(colour.getHex()).toBe(SLIME_COLORS.colossus);

    layer.setLimits({ ...limits, puddles: 2 });
    effects.emit('popper', new THREE.Vector3(16, 3, 6), ground, normal, 10);
    effects.puddles.getColorAt(0, colour);
    expect(colour.getHex()).toBe(0x63ff35);
    effects.puddles.getColorAt(1, colour);
    expect(colour.getHex()).toBe(SLIME_COLORS.colossus);

    for (const quality of Object.values(QUALITY_LIMITS)) {
      layer.setLimits(quality);
      expect(effects.particles.count).toBe(quality.particles);
      expect(effects.puddles.count).toBe(quality.puddles);
    }
    layer.dispose();
    physics.dispose();
  });

  it('varies each droplet and split ball in size by about 10 % and speed by about 20 %, the smaller flying faster', () => {
    const pieces = Array.from({ length: 400 }, (_, i) => pieceVariation(42, i));
    const sizes = pieces.map(p => p.size), speeds = pieces.map(p => p.speed), yaws = pieces.map(p => p.yaw);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(.9); expect(Math.max(...sizes)).toBeLessThanOrEqual(1.1);
    expect(Math.max(...sizes) - Math.min(...sizes), 'sizes actually spread').toBeGreaterThan(.15);
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(.75); expect(Math.max(...speeds)).toBeLessThanOrEqual(1.3);
    expect(Math.max(...speeds) - Math.min(...speeds), 'speeds actually spread').toBeGreaterThan(.3);
    expect(Math.max(...yaws.map(Math.abs))).toBeLessThanOrEqual(.24);
    // Smaller pieces fly faster: size and speed are strongly anti-correlated.
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const [ms, mv] = [mean(sizes), mean(speeds)];
    const cov = mean(sizes.map((v, i) => (v - ms) * (speeds[i]! - mv)));
    const corr = cov / Math.sqrt(mean(sizes.map(v => (v - ms) ** 2)) * mean(speeds.map(v => (v - mv) ** 2)));
    expect(corr).toBeLessThan(-.8);
    expect(pieceVariation(42, 7)).toEqual(pieceVariation(42, 7));
    expect(pieceVariation(43, 7)).not.toEqual(pieceVariation(42, 7));

    // The live splash: one popper's droplets no longer share a size or a speed.
    const physics = new PhysicsWorld(api);
    const layer = new SlimeLayer(new THREE.Scene(), physics, prototypeSpline(), document.createElement('div'),
      { ...QUALITY_LIMITS.high, particles: 2000 }, []);
    const effects = (layer as any).effects;
    const before = effects.nextParticle;
    effects.emit('popper', new THREE.Vector3(0, 1, 0), new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0, new THREE.Vector3(0, 0, -12), 2);
    const sameOrdinal: number[] = [], speedsSeen: number[] = [];
    for (let i = before; i < effects.nextParticle; i++) {
      if ((i - before) % 5 === 0) sameOrdinal.push(effects.particleSize.getX(i));
      speedsSeen.push(Math.hypot(effects.particleVelocity.getX(i), effects.particleVelocity.getZ(i)));
    }
    expect(new Set(sameOrdinal.map(v => v.toFixed(4))).size, 'droplets with the same base size now differ').toBeGreaterThan(sameOrdinal.length / 2);
    expect(new Set(speedsSeen.map(v => v.toFixed(3))).size).toBe(speedsSeen.length);
    // Over many splashes, a droplet's final size and its speed are anti-correlated: small ones fly faster.
    const finalSizes: number[] = [], finalSpeeds: number[] = [];
    for (let splash = 0; splash < 30; splash++) {
      const start = effects.nextParticle;
      effects.emit('popper', new THREE.Vector3(0, 1, 0), new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0, new THREE.Vector3(0, 0, -12), 2);
      for (let i = start; i < effects.nextParticle; i++) {
        finalSizes.push(effects.particleSize.getX(i));
        finalSpeeds.push(Math.hypot(effects.particleVelocity.getX(i), effects.particleVelocity.getY(i), effects.particleVelocity.getZ(i)));
      }
    }
    const [fs, fv] = [mean(finalSizes), mean(finalSpeeds)];
    const splashCorr = mean(finalSizes.map((v, i) => (v - fs) * (finalSpeeds[i]! - fv)))
      / Math.sqrt(mean(finalSizes.map(v => (v - fs) ** 2)) * mean(finalSpeeds.map(v => (v - fv) ** 2)));
    expect(splashCorr, 'small droplets fly faster in the real splash').toBeLessThan(-.3);
    // Other kinds keep their splash exactly.
    const boostStart = effects.nextParticle;
    effects.emit('boost', new THREE.Vector3(0, 1, 0), new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0, new THREE.Vector3(0, 0, -12), 2);
    expect(effects.particleSize.getX(boostStart)).toBeCloseTo(.75, 6);
    layer.dispose(); physics.dispose();
  });

  it('bursts a bomb into sparks only, sized by the body: no black droplet, no puddle, no black coat', () => {
    const physics = new PhysicsWorld(api);
    const scene = new THREE.Scene();
    const layer = new SlimeLayer(scene, physics, prototypeSpline(), document.createElement('div'),
      { ...QUALITY_LIMITS.high, particles: 2000, puddles: 8 }, []);
    const effects = (layer as any).effects;
    const ground = new THREE.Vector3(0, 0, 0), up = new THREE.Vector3(0, 1, 0);
    const sparks = (effectScale: number) => {
      const before = effects.nextParticle;
      const persistentBefore = effects.persistent.count;
      effects.emit('burst', new THREE.Vector3(0, 1, 0), ground, up, 0, new THREE.Vector3(0, 0, -10), effectScale);
      const written = effects.nextParticle - before;
      const colour = new THREE.Color(); let black = 0, largest = 0;
      for (let i = before; i < effects.nextParticle; i++) {
        effects.particles.getColorAt(i, colour);
        if (colour.getHex() === SLIME_COLORS.burst) black++;
        largest = Math.max(largest, Math.abs(effects.particleSize.getX(i)));
      }
      expect(black, 'no black droplets').toBe(0);
      expect(effects.persistent.count, 'no black puddle').toBe(persistentBefore);
      return { written, largest };
    };
    const small = sparks(.8), big = sparks(4);
    expect(big.written).toBeGreaterThan(small.written);
    expect(big.largest).toBeGreaterThan(small.largest * 2.5);
    // Larger than the old fireball at the same size (old scale at effectScale 2 was 1).
    const old = (e: number) => THREE.MathUtils.clamp(Math.sqrt(e / 2), .55, 1.6);
    for (let e = .45; e <= 4.6; e += .01) expect(burstSparkScale(e), `effect scale ${e.toFixed(2)}`).toBeGreaterThan(old(e));
    for (let e = .5; e < 4.5; e += .25) expect(burstSparkScale(e + .25)).toBeGreaterThan(burstSparkScale(e));
    layer.dispose(); physics.dispose();
  });

  it('leaves no red stain on the road when a rocket breaks, while a green one still splats', () => {
    const physics = new PhysicsWorld(api);
    const layer = new SlimeLayer(new THREE.Scene(), physics, prototypeSpline(), document.createElement('div'),
      { ...QUALITY_LIMITS.high, particles: 2000, puddles: 8 }, []);
    const effects = (layer as any).effects;
    const up = new THREE.Vector3(0, 1, 0);
    const stains = (kind: SlimeKind) => {
      const before = effects.persistent.count;
      effects.emit(kind, new THREE.Vector3(0, 1, 0), new THREE.Vector3(), up, 0, new THREE.Vector3(0, 0, -12), 2);
      return effects.persistent.count - before;
    };
    expect(leavesSplatter('boost')).toBe(false);
    expect(stains('popper'), 'positive control: green still marks the road').toBeGreaterThan(0);
    const before = effects.persistent.count;
    effects.emit('boost', new THREE.Vector3(0, 1, 0), new THREE.Vector3(), up, 0, new THREE.Vector3(0, 0, -12), 2);
    expect(effects.persistent.count, 'no red road stain').toBe(before);
    layer.dispose(); physics.dispose();
  });

  it('does not turn a fragment impact on a guardrail into a vertical slime decal', () => {
    const physics = new PhysicsWorld(api, 0);
    const layer = new SlimeLayer(new THREE.Scene(), physics, prototypeSpline(),
      document.createElement('div'), QUALITY_LIMITS.low, []);
    const effects = (layer as unknown as { effects: {
      splat(kind: SlimeKind, point: THREE.Vector3, normal: THREE.Vector3, radius: number): void;
    } }).effects;

    effects.splat('popper', new THREE.Vector3(4, 1, 6), new THREE.Vector3(1, 0, 0), 1.2);
    expect(layer.stats.puddles, 'a wall impact must not paint a vertical puddle through the rail').toBe(0);
    effects.splat('popper', new THREE.Vector3(4, 0, 6), new THREE.Vector3(0, 1, 0), 1.2);
    expect(layer.stats.puddles, 'the same effect must still leave its road splat').toBe(1);

    layer.dispose();
    physics.dispose();
  });

  it('leaves no picture behind in a slot the live slimes moved out of', () => {
    //
    // compacting the live slimes down the instance list left their old slots holding the last matrix.
    // Those slots are drawn whenever a sky slime is falling (the count reaches past them), as purple
    // blobs with no body, one per compaction.
    const physics = new PhysicsWorld(api);
    const layer = new SlimeLayer(new THREE.Scene(), physics, prototypeSpline(), document.createElement('div'),
      QUALITY_LIMITS.high, []);
    const row = (x: number): TileSlimeSpawn[] => [0, 1, 2].map(i => ({ kind: 'slick',
      position: [x, 1.4, i * 6], scale: [1.4, 1.4, 1.4], yaw: 0 }));
    layer.addTile('first', row(30));
    layer.addTile('second', row(60));
    layer.removeTile('first');
    const internals = layer as unknown as { lives: { index: number }[] };
    const held = new Set(internals.lives.map(live => live.index));
    expect(held.size).toBe(3);
    const matrix = new THREE.Matrix4();
    const size = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      if (held.has(i)) continue;
      layer.mesh.getMatrixAt(i, matrix);
      expect(size.setFromMatrixScale(matrix).length(), `slot ${i} still draws a slime nobody owns`).toBe(0);
    }
    layer.dispose();
    physics.dispose();
  });

  it('drops physical sky slimes onto the world and keeps skyfall occasional', () => {
    const physics = new PhysicsWorld(api);
    const layer = new SlimeLayer(new THREE.Scene(), physics, prototypeSpline(), document.createElement('div'),
      QUALITY_LIMITS.low, []);
    const floor = physics.world.createCollider(api.ColliderDesc.cuboid(1000, .1, 1000)
      .setTranslation(0, -.1, 0));
    physics.registerCollider(floor, 'ground');
    const car = new Car(physics, tuningFor('sedan'), { pos: [0, .8, 0], yaw: -Math.PI / 2 });
    car.update(1 / 60, NO_INPUT);
    physics.step(1 / 60);
    expect(physics.surfaceAt(50, 0)).not.toBeNull();
    layer.prepareCar(car);
    layer.update(.01);
    const internals = layer as unknown as { falling: { motion: SlimeBody }[] };
    expect(internals.falling).toHaveLength(1);
    const drop = internals.falling[0]!.motion;
    const start = drop.body.translation().y;
    const fallingMatrix = new THREE.Matrix4();
    layer.mesh.getMatrixAt(layer.mesh.count - 1, fallingMatrix);
    const initialHeight = new THREE.Vector3().setFromMatrixScale(fallingMatrix).y;
    for (let i = 0; i < 20; i++) { physics.step(1 / 60); layer.update(1 / 60); }
    expect(drop.body.translation().y).toBeLessThan(start - .5);
    layer.mesh.getMatrixAt(layer.mesh.count - 1, fallingMatrix);
    expect(new THREE.Vector3().setFromMatrixScale(fallingMatrix).y).not.toBeCloseTo(initialHeight, 5);
    expect(layer.colossusPupils.count).toBe(2);
    for (let i = 0; i < 600 && layer.stats.fallingSurvivors === 0; i++) {
      physics.step(1 / 60);
      layer.update(1 / 60);
    }
    expect(layer.stats.fallingLandings).toBe(1);
    expect(layer.stats.nearestFallingLanding).toBeGreaterThanOrEqual(7);
    expect(layer.stats.fallingBounces).toBeGreaterThanOrEqual(3);
    expect(layer.stats.fallingSurvivors).toBe(1);
    expect(layer.stats.physicalFragments).toBe(0);
    expect(layer.stats.puddles).toBe(0);
    expect(layer.stats.falling).toBe(0);
    for (let i = 0; i < 600; i++) { physics.step(1 / 60); layer.update(1 / 60); }
    expect(layer.stats.falling).toBe(1);
    layer.dispose();
    physics.world.removeRigidBody(car.body);
    expect(physics.world.bodies.len()).toBe(0);
    physics.dispose();
  });

  it('creates rigid bodies only for purple elastic encounters, the car and floor', () => {
    const f = fixture('popper');
    expect(f.physics.world.bodies.len(), 'fifteen purple bodies + car + floor').toBe(17);
    const shapes: number[] = [];
    f.physics.world.forEachCollider((collider) => shapes.push(collider.shapeType()));
    expect(shapes.filter((shape) => shape === api.ShapeType.ConvexPolyhedron)).toHaveLength(70);
    expect(shapes.filter((shape) => shape === api.ShapeType.Cuboid)).toHaveLength(2);
    dispose(f);
  });

  it('reaches a phone through navigator.vibrate, kind by kind, unless motion is reduced', () => {
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: undefined });
    const vibrate = vi.fn((_pattern: number | number[]) => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    try {
      const f = collide('popper');
      // No vibrate(0) first: a new pattern replaces the old one, and an idle cancel would be logged
      // as an intervention by desktop Chromium before the first tap.
      expect(vibrate.mock.calls.map(([pattern]) => pattern)).toEqual([[80]]);
      expect(f.layer.stats.feedback.phoneVibrations).toBe(1);
      expect(f.layer.stats.feedback.vibrationAttempts, 'gamepad count stays separate').toBe(0);
      dispose(f);

      vibrate.mockClear();
      const heavy = collide('burst');
      expect(vibrate).toHaveBeenLastCalledWith([300]);
      dispose(heavy);

      vibrate.mockClear();
      document.documentElement.dataset.reducedMotion = 'true';
      const quiet = collide('popper');
      expect(vibrate).not.toHaveBeenCalled();
      expect(quiet.layer.stats.feedback.phoneVibrations).toBe(0);
      dispose(quiet);

      delete document.documentElement.dataset.reducedMotion;
      Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { hasBeenActive: false } });
      const untouched = collide('popper');
      expect(vibrate, 'a document nobody has tapped is not asked').not.toHaveBeenCalled();
      dispose(untouched);
    } finally {
      delete document.documentElement.dataset.reducedMotion;
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'userActivation', { configurable: true, value: undefined });
    }
  });

  it('proves popper collision, camera shake, windshield slime and capable gamepad vibration', () => {
    const playEffect = vi.fn((_type: string, _effect: Record<string, number>) => Promise.resolve());
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [{ vibrationActuator: { playEffect } }],
    });
    const f = collide('popper');

    expect(f.layer.stats.active).toBe(71);
    expect(f.layer.stats.particles).toBeGreaterThan(0);
    expect(f.layer.stats.puddles).toBe(1);
    expect((f.layer.fragmentMesh.material as THREE.MeshStandardMaterial).opacity)
      .toBe(SLIME_DROPLET_OPACITY);
    expect(f.layer.stats.feedback).toMatchObject({ cameraShake: true, windshield: true,
      vibrationAttempts: 1, cameraShakeMs: 60, windshieldMs: 1200 });
    expect(f.layer.stats.feedback.hits.popper).toBe(1);
    expect(playEffect).toHaveBeenCalledOnce();
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', expect.objectContaining({ duration: 80 }));
    expect(f.host.querySelector<HTMLElement>('.slime-windshield')?.style.opacity).not.toBe('0');

    const index = prototypeSlimeSpawns(prototypeSpline()).findIndex((spawn) => spawn.kind === 'popper');
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    f.layer.update(0.05);
    // Population compaction can happen while the 100 ms death animation is in flight. It must
    // preserve the half-size matrix instead of flashing the consumed slime back to full size.
    f.layer.setLimits(QUALITY_LIMITS.low);
    f.layer.mesh.getMatrixAt(index, matrix);
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.x).toBeCloseTo(f.spawn.scale[0] * 0.5, 2);
    const camera = new THREE.PerspectiveCamera();
    f.layer.updateCamera(0.3, camera);
    expect(f.layer.stats.feedback).toMatchObject({ cameraShake: false, windshield: true,
      cameraShakeMs: 0, windshieldMs: 900 });
    expect(f.host.querySelector<HTMLElement>('.slime-windshield')?.style.maskImage)
      .toContain('conic-gradient');
    f.layer.update(0.051);
    f.layer.mesh.getMatrixAt(index, matrix);
    expect([matrix.elements[0], matrix.elements[5], matrix.elements[10]]).toEqual([0, 0, 0]);
    f.layer.updateCamera(0.9, camera);
    expect(f.layer.stats.feedback.windshield).toBe(false);
    dispose(f);
  });

  it.each(['popper', 'burst', 'boost'] as const)(
    'consumes a breakable %s body at ordinary driving speed', kind => {
      const f = fixture(kind);
      const before = f.layer.stats.byKind[kind];
      f.car.body.setLinvel({ x: 10, y: 0, z: 0 }, true);
      for (let i = 0; i < 6; i++) f.physics.step(f.physics.timestep, h => {
        f.layer.prepareCar(f.car); f.car.update(h, NO_INPUT); f.layer.handleCar(f.car); f.layer.update(h);
      });
      expect(f.layer.stats.byKind[kind]).toBe(before - 1);
      dispose(f);
    });

  it('cancels the rest of a colossus rumble sequence when the scene is disposed', async () => {
    let finishFirst: (() => void) | undefined;
    const playEffect = vi.fn(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    const reset = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [{ vibrationActuator: { playEffect, reset } }],
    });
    const f = fixture('colossus');
    const feedback = (f.layer as unknown as { defaultDriver: { feedback: { hit(kind: SlimeKind): void } } }).defaultDriver.feedback;
    feedback.hit('colossus');
    expect(playEffect).toHaveBeenCalledOnce();
    dispose(f);
    expect(reset).toHaveBeenCalledOnce();
    finishFirst?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(playEffect).toHaveBeenCalledOnce();
  });

  it('uses contact normal and closing speed for a fast shallow side-swipe dent', () => {
    const f = fixture('slick');
    const live = (f.layer as any).lives.find((item: any) => item.spawn === f.spawn
      || item.spawn.kind === 'slick');
    f.car.body.setLinvel({x:0,y:0,z:-20},true);
    f.car.collisions = [{kind:'slime-bounce',started:true,other:live.collider.handle,
      normal:{x:1,y:0,z:0},closingSpeed:1,point:{x:0,y:0,z:0}}];
    f.layer.handleCar(f.car);
    expect(live.elasticHit.direction.x).toBeCloseTo(-1);
    expect(live.elasticHit.direction.z).toBeCloseTo(0);
    expect(live.elasticHit.strength).toBeCloseTo(1/16);
    dispose(f);
  });

  it('locally deforms a dense purple body, then splits it into smaller forward-moving children', () => {
    const f = fixture('slick');
    const approach = new THREE.Vector3(0, 0, -1);
    f.physics.setBodyPosition(f.car.body, { x: f.spawn.position[0], y: .8,
      z: f.spawn.position[2] + 3 });
    f.car.body.setLinvel({ x: 0, y: 0, z: -12 }, true);
    for (let i = 0; i < 45 && !f.layer.stats.feedback.hits.slick; i++) {
      f.physics.step(f.physics.timestep, h => {
        f.layer.prepareCar(f.car); f.car.update(h, NO_INPUT); f.layer.handleCar(f.car);
      });
    }
    expect(f.layer.stats.feedback.hits.slick).toBe(1);
    expect(f.layer.stats.bounceHits).toBe(1);
    const geometry = f.layer.mesh.geometry;
    expect(geometry.getAttribute('position').count).toBeGreaterThan(300);
    f.layer.update(.1);
    const impacted = (f.layer as any).lives.find((live: any) => live.spawn.kind === 'slick'
      && Math.abs(live.spawn.position[0] - f.spawn.position[0]) < .01);
    expect((geometry.getAttribute('slimeHitStrength') as THREE.InstancedBufferAttribute)
      .getX(impacted.index)).toBeGreaterThan(.2);
    expect((f.layer as any).material.vertexShader).toContain('contact * envelope');
    const parentVelocity = impacted.motion.body.linvel();
    const parentMomentum = impacted.motion.body.mass()
      * new THREE.Vector3(parentVelocity.x, parentVelocity.y, parentVelocity.z).dot(approach);
    f.layer.update(.5);
    expect(f.layer.stats.splitEvents).toBe(1);
    expect(f.layer.stats.splitChildren).toBeGreaterThanOrEqual(2);
    const children = (f.layer as any).lives.filter((live: any) => live.key.startsWith('split:'));
    expect(children).toHaveLength(f.layer.stats.splitChildren);
    expect(children.every((child: any) => child.spawn.scale[0] < f.spawn.scale[0])).toBe(true);
    expect(children.every((child: any) => {
      const velocity = child.motion.body.linvel();
      return new THREE.Vector3(velocity.x, velocity.y, velocity.z).dot(approach) > 0;
    })).toBe(true);
    const childMomentum = children.reduce((sum: number, child: any) => {
      const velocity = child.motion.body.linvel();
      return sum + child.motion.body.mass()
        * new THREE.Vector3(velocity.x, velocity.y, velocity.z).dot(approach);
    }, 0);
    expect(childMomentum).toBeCloseTo(parentMomentum, 2);
    // The balls are not all one size, and the smallest leaves faster than the largest.
    const bySize = [...children].sort((a: any, b: any) => a.spawn.scale[0] - b.spawn.scale[0]);
    expect(bySize.at(-1).spawn.scale[0] / bySize[0].spawn.scale[0]).toBeGreaterThan(1.01);
    const along = (child: any) => { const v = child.motion.body.linvel(); return new THREE.Vector3(v.x, v.y, v.z).dot(approach); };
    expect(along(bySize[0])).toBeGreaterThan(along(bySize.at(-1)));
    expect(MIN_SPLIT_RADIUS).toBeLessThan(children[0].spawn.scale[0]);
    expect(f.layer.stats.puddles).toBe(0);
    dispose(f);
  });

  // User retired "too small, it disappears": the smallest purple splitter only bounces away,
  // stays on the road and scores every hit.
  it('keeps the smallest purple splitter on the road when its split comes due', () => {
    const physics = new PhysicsWorld(api, 0);
    const layer = new SlimeLayer(new THREE.Scene(), physics, prototypeSpline(),
      document.createElement('div'), QUALITY_LIMITS.low, []);
    layer.addTile('tiny', [{ kind: 'slick', position: [20, MIN_SPLIT_RADIUS, 0],
      scale: [MIN_SPLIT_RADIUS, MIN_SPLIT_RADIUS, MIN_SPLIT_RADIUS], yaw: 0 }]);
    const live = (layer as any).lives[0];
    for (let hit = 0; hit < 3; hit++) {
      live.pendingSplit = { velocity: new THREE.Vector3(8, 0, 0), at: (layer as any).clock };
      layer.update(.01);
    }
    expect(layer.stats).toMatchObject({ splitEvents: 0, splitChildren: 0, active: 1, smallestBounces: 3 });
    expect(live.active).toBe(true);
    layer.dispose(); physics.dispose();
  });

  it('splits a purple family down to its smallest members, which then stay put', () => {
    const physics = new PhysicsWorld(api, 0);
    const layer = new SlimeLayer(new THREE.Scene(), physics, prototypeSpline(),
      document.createElement('div'), QUALITY_LIMITS.low, []);
    const fillers: TileSlimeSpawn[] = Array.from({ length: 10 }, (_, i) => ({ kind: 'popper',
      position: [80 + i * 12, 1, 0], scale: [1, 1, 1], yaw: 0 }));
    layer.addTile('family', [{ kind: 'slick', position: [20, 1.4, 0],
      scale: [1.7, 1.4, 1.7], yaw: 0 }, ...fillers]);
    const generation = () => {
      for (const child of (layer as any).lives.filter((live: any) => live.spawn.kind === 'slick')) {
        child.pendingSplit = { velocity: new THREE.Vector3(8, 0, 0), at: (layer as any).clock };
      }
      layer.update(.01);
    };
    for (let i = 0; i < 8; i++) generation();
    const settled = layer.stats.byKind.slick;
    expect(settled).toBeGreaterThan(1);
    expect((layer as any).lives.filter((live: any) => live.spawn.kind === 'slick')
      .every((live: any) => isSmallestSplitter(live.spawn.scale))).toBe(true);
    const splits = layer.stats.splitEvents;
    for (let i = 0; i < 3; i++) generation();
    expect(layer.stats).toMatchObject({ splitEvents: splits, byKind: { popper: 10, slick: settled } });
    layer.dispose(); physics.dispose();
  });

  it('scores every hit on the smallest splitter under its own key, but a larger one once', () => {
    const run = (radius: number) => {
      const physics = new PhysicsWorld(api);
      const layer = new SlimeLayer(new THREE.Scene(), physics, prototypeSpline(),
        document.createElement('div'), QUALITY_LIMITS.low, []);
      const floor = physics.world.createCollider(api.ColliderDesc.cuboid(1000, 0.1, 1000).setTranslation(0, -0.1, 0));
      physics.registerCollider(floor, 'ground');
      layer.addTile('target', [{ kind: 'slick', position: [0, radius, 0], scale: [radius, radius, radius], yaw: 0 }]);
      const keys: string[] = [];
      layer.onHit = (key) => keys.push(key);
      const car = new Car(physics, tuningFor('sedan'), { pos: [0, .8, 8], yaw: 0 });
      for (let attempt = 0; attempt < 3; attempt++) {
        const target = (layer as any).lives.find((live: any) => live.spawn.kind === 'slick' && live.active);
        if (!target) break;
        physics.setBodyPosition(car.body, { x: 50, y: .8, z: 50 }); car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        for (let i = 0; i < 180; i++) { physics.step(physics.timestep, h => { layer.prepareCar(car); car.update(h, NO_INPUT); layer.handleCar(car); }); layer.update(physics.timestep); }
        const at = target.motion ? physics.bodyPosition(target.motion.body) : { x: target.spawn.position[0], y: 0, z: target.spawn.position[2] };
        physics.setBodyPosition(car.body, { x: at.x, y: .8, z: at.z + 6 });
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        car.body.setLinvel({ x: 0, y: 0, z: -12 }, true);
        for (let i = 0; i < 90; i++) {
          physics.step(physics.timestep, h => { layer.prepareCar(car); car.update(h, NO_INPUT); layer.handleCar(car); });
          layer.update(physics.timestep);
        }
      }
      const result = { keys, stats: layer.stats };
      layer.dispose(); physics.dispose();
      return result;
    };
    const small = run(MIN_SPLIT_RADIUS);
    expect(small.keys.length, JSON.stringify(small.keys)).toBeGreaterThanOrEqual(3);
    expect(new Set(small.keys).size).toBe(small.keys.length);
    expect(small.stats).toMatchObject({ splitChildren: 0, byKind: { slick: 1 } });
    const large = run(1.2);
    expect(large.stats.splitChildren).toBeGreaterThanOrEqual(2);
  });

  it('scales the burst launch by body size and lifts every wheel', () => {
    const playEffect = vi.fn((_type: string, _effect: Record<string, number>) => Promise.resolve());
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [{ vibrationActuator: { playEffect } }],
    });
    const sound = vi.fn();
    const burst = fixture('burst', 0.5, sound);
    expect((burst.layer as any).material.fragmentShader)
      .not.toContain('vec3(0.44, 0.008, 0.014)');
    for (let i = 0; i < 5; i++) burst.physics.step(burst.physics.timestep, (h) => {
      burst.layer.prepareCar(burst.car); burst.car.update(h, NO_INPUT); burst.layer.handleCar(burst.car);
    }, 5, () => burst.layer.finishPhysicsStep());
    expect(burst.layer.stats.feedback.hits.burst).toBe(1);
    // The bomb goes off as fire, not only sparks.
    expect(burst.layer.explosions.liveLayers).toEqual(expect.arrayContaining(['flash', 'fire', 'glow']));
    expect(burst.car.body.linvel().y).toBeGreaterThan(.5);
    expect(Math.abs(burst.car.body.linvel().y)).toBeLessThanOrEqual(24);
    expect(Math.hypot(burst.car.body.linvel().x, burst.car.body.linvel().z))
      .toBeLessThanOrEqual(burst.car.tuning.maxSpeed);
    const spline = prototypeSpline(), index = spline.indexAt(burst.spawn.s);
    const road = spline.point(index), right = spline.right(index);
    burst.physics.setBodyPosition(burst.car.body,
      { x: road[0] + right[0] * 7, y: .8, z: road[2] + right[2] * 7 });
    burst.car.body.setLinvel({ x: right[0] * 10, y: 0, z: right[2] * 10 }, true);
    burst.layer.finishPhysicsStep();
    const confined = burst.car.body.linvel();
    expect(confined.x * right[0] + confined.z * right[2]).toBeCloseTo(2);
    burst.layer.update(.36);
    burst.layer.finishPhysicsStep();
    const protectedVelocity = burst.car.body.linvel();
    expect(protectedVelocity.x * right[0] + protectedVelocity.z * right[2]).toBeLessThanOrEqual(0);
    burst.layer.update(1.1);
    burst.car.body.setLinvel({ x: right[0] * 10, y: -10, z: right[2] * 10 }, true);
    burst.layer.finishPhysicsStep();
    const falling = burst.car.body.linvel();
    expect(falling.y).toBeCloseTo(-10);
    expect(falling.x * right[0] + falling.z * right[2]).toBeLessThanOrEqual(0);
    burst.layer.resetCar(burst.car);
    burst.car.body.setLinvel({ x: right[0] * 10, y: 0, z: right[2] * 10 }, true);
    burst.layer.finishPhysicsStep();
    const reset = burst.car.body.linvel();
    expect(reset.x * right[0] + reset.z * right[2]).toBeCloseTo(10);
    expect(burst.car.wheels.every((wheel) => !wheel.grounded)).toBe(true);
    expect(burst.layer.stats.feedback.cameraShakeMs).toBe(250);
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', expect.objectContaining({ duration: 300 }));
    expect(sound).toHaveBeenCalledWith('burst', expect.any(Number), 'enter');
    expect(sound).toHaveBeenCalledWith('burst', expect.any(Number), 'impact');
    expect(Number(burst.host.querySelector<HTMLElement>('.slime-burst-flash')!.style.opacity)).toBeGreaterThan(.5);
    const sparks = (burst.scene.getObjectByName('slime-particles') as THREE.InstancedMesh)
      .geometry.getAttribute('effectSize');
    expect(Array.from({ length: sparks.count }, (_, i) => sparks.getX(i)).filter(size => size < 0).length).toBeGreaterThan(10);
    const mist = (burst.scene.getObjectByName('slime-particles') as THREE.InstancedMesh)
      .geometry.getAttribute('effectMist');
    expect(Array.from({ length: mist.count }, (_, i) => mist.getX(i)).filter(value => value > .5).length)
      .toBeGreaterThan(10);
    burst.layer.updateCamera(.2, new THREE.PerspectiveCamera());
    expect(burst.host.querySelector<HTMLElement>('.slime-burst-flash')!.style.opacity).toBe('0');
    dispose(burst);
  });

  it('bursts a boost into one speed impulse and a short sparkling trail', () => {
    const sound = vi.fn();
    const f = fixture('boost', 1, sound);
    f.car.reset([f.spawn.position[0], 0.45, f.spawn.position[2]], -Math.PI / 2);
    f.car.body.setLinvel({ x: 6, y: 0, z: 0 }, true);
    let sawActive = false;
    for (let i = 0; i < 90; i++) f.physics.step(f.physics.timestep, (h) => {
      f.layer.prepareCar(f.car);
      f.car.update(h, NO_INPUT);
      f.layer.handleCar(f.car);
      f.layer.update(h);
      sawActive ||= f.layer.stats.boostActive;
    });
    expect(sawActive).toBe(true);
    expect(f.layer.stats.boostEntries).toBe(1);
    expect(f.layer.stats.boostSpeedGain).toBeGreaterThan(3);
    expect(SLIME_COLORS.boost).toBe(0xf51d24);
    // This mixed population now includes a giant on the centreline after the boost.
    expect(sound.mock.calls.filter(([kind, , phase]) => kind === 'boost' && phase === 'enter'))
      .toHaveLength(1);
    const sizes = (f.scene.getObjectByName('slime-particles') as THREE.InstancedMesh).geometry
      .getAttribute('effectSize') as THREE.InstancedBufferAttribute;
    expect(Array.from({ length: sizes.count }, (_, i) => sizes.getX(i)).some((size) => size < 0))
      .toBe(true);
    const flame = f.scene.getObjectByName('slime-particles') as THREE.InstancedMesh;
    const colours = flame.instanceColor!;
    expect(Array.from({ length: colours.count }, (_, i) => colours.getX(i))
      .some(red => red > .75)).toBe(true);

    f.car.reset([f.spawn.position[0] + 20, 0.45, f.spawn.position[2] + 20], -Math.PI / 2);
    f.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 30; i++) f.physics.step(f.physics.timestep, (h) => {
      f.layer.prepareCar(f.car); f.car.update(h, NO_INPUT); f.layer.handleCar(f.car);
    });
    expect(f.layer.stats.boostActive).toBe(false);
    expect(f.car.speed).toBeLessThan(0.2);
    dispose(f);
  });

  it('lifts, levels and propels the car through an indestructible colossus, then releases it to fall', () => {
    const playEffect = vi.fn((_type: string, _effect: Record<string, number>) => Promise.resolve());
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [{ vibrationActuator: { playEffect } }],
    });
    const sounds = vi.fn();
    const spline = prototypeSpline();
    const spawn = prototypeSlimeSpawns(spline).find((item) => item.kind === 'colossus')!;
    const physics = new PhysicsWorld(api, -9.8);
    const scene = new THREE.Scene();
    const host = document.createElement('div');
    const layer = new SlimeLayer(scene, physics, spline, host,
      QUALITY_LIMITS.low, prototypeSlimeSpawns(spline), sounds);
    const camera = new THREE.PerspectiveCamera();
    const floorBody = physics.world.createRigidBody(api.RigidBodyDesc.fixed());
    const floor = physics.world.createCollider(api.ColliderDesc.cuboid(1000, 0.1, 1000)
      .setTranslation(0, -0.1, 0), floorBody);
    physics.registerCollider(floor, 'ground');
    const car = new Car(physics, tuningFor('sedan'),
      { pos: [spawn.position[0] - 7, 0.8, spawn.position[2]], yaw: -Math.PI / 2 });
    car.body.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45, -Math.PI / 2, 0.3)), true);
    car.body.setLinvel({ x: 12, y: 0, z: 0 }, true);
    let airborneAtSpeed = false;
    let sawImmersion = false;
    let sawContainedCaustics = false;
    let sawBubbles = false;
    let arrival = 0;
    let rings = 0;
    for (let i = 0; i < 360; i++) physics.step(physics.timestep, (h) => {
      const input = { ...NO_INPUT, throttle: 1, steer: i < 45 ? 0.18 : 0 };
      if (layer.stats.colossusEntries === 0) arrival = car.speed;
      layer.prepareCar(car); car.update(h, input); layer.handleCar(car, input);
      layer.update(h);
      layer.updateCamera(h, camera, car);
      scene.traverse((node) => { if (node.name.includes('ripple')) rings++; });
      airborneAtSpeed ||= !car.grounded && car.speed > 8;
      if (layer.stats.colossusTransit) {
        expect(host.querySelector<HTMLElement>('.slime-immersion')!.style.opacity).toBe('0.55');
        expect(layer.driverStats(car).feedback.cameraShake).toBe(false);
        sawContainedCaustics ||= layer.driverStats(car).feedback.causticOpacity > 0;
        sawBubbles ||= layer.driverStats(car).feedback.bubbles === 18;
        sawImmersion = true;
      }
    });
    expect(layer.stats).toMatchObject({ colossusTransit: false, colossusEntries: 1,
      colossusExits: 1, colossi: 2 });
    expect(layer.stats.colossusFloatHeight).toBeGreaterThan(3.4);
    // The giant is sticky, so flat-out throttle inside never beats the arrival speed.
    expect(arrival).toBeGreaterThan(9);
    expect(layer.stats.colossusForwardSpeed).toBeLessThanOrEqual(arrival + .25);
    expect(layer.stats.colossusMinUpright).toBeGreaterThan(0.92);
    expect(layer.stats.colossusDrop).toBeGreaterThan(1);
    expect(sawImmersion).toBe(true);
    expect(sawContainedCaustics).toBe(true);
    expect(sawBubbles).toBe(true);
    expect(host.querySelector<HTMLElement>('.slime-immersion')!.style.opacity).toBe('0');
    expect(layer.driverStats(car).feedback.causticOpacity).toBe(0);
    // Crossing the membrane leaves a splash and, on no frame, expanding ripple rings.
    expect(rings).toBe(0);
    expect(layer.stats.colossusSplashes).toBe(1);
    expect(layer.stats.colossusRippleSurfaceError).toBeLessThan(1e-6);
    expect(layer.stats.colossusSprayForward).toBeGreaterThan(.7);
    expect(layer.stats.colossusWetMarks).toBeGreaterThan(0);
    // Every wet print is still stored -- none faded out or was recycled by a ring.
    expect((layer as any).effects.wetMarks.count).toBe(layer.stats.colossusWetMarks);
    expect(layer.stats.colossusFloatHeight).toBeLessThan(spawn.scale[1] * (1 + slimeGroundFraction('colossus')));
    expect(airborneAtSpeed, 'airborne wheel rotation keeps following driven speed').toBe(true);
    expect(sounds).toHaveBeenCalledWith('colossus', expect.any(Number), 'enter');
    expect(sounds).toHaveBeenCalledWith('colossus', expect.any(Number), 'exit');
    expect(sounds.mock.calls.map((call) => call[0])).toContain('gurgle');
    expect(layer.colossusDebris.count).toBe(12);
    expect(layer.colossusWheels.count).toBe(8);
    expect(layer.colossusSeatBacks.count).toBe(4);
    expect(layer.colossusSeatCushions.count).toBe(4);
    expect(layer.colossusEyes.count).toBeGreaterThanOrEqual(2);
    expect(layer.stats.feedback.hits.colossus).toBe(1);
    layer.dispose();
    physics.dispose();
  });

  it('projects animated caustics on surfaces while retaining immersion and reduced motion', () => {
    const read = (time: 'day' | 'night', reduced: boolean) => {
      document.documentElement.dataset.reducedMotion = String(reduced);
      const spline = prototypeSpline();
      const spawn = prototypeSlimeSpawns(spline).find((item) => item.kind === 'colossus')!;
      const physics = new PhysicsWorld(api, 0);
      const scene = new THREE.Scene();
      const surfaceMaterial = new THREE.MeshStandardMaterial();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), surfaceMaterial));
      const host = document.createElement('div');
      const layer = new SlimeLayer(scene, physics, spline, host, QUALITY_LIMITS.low, [spawn],
        () => undefined, undefined, time);
      // The game hands the layer how bright the world is, so the harness must too --
      // with the default of 1 the night case reads as bright as noon and proves nothing.
      const daylight = new Sky(new THREE.Scene(), time).daylight;
      const car = new Car(physics, tuningFor('sedan'),
        { pos: [spawn.position[0], spawn.position[1], spawn.position[2]], yaw: -Math.PI / 2 });
      layer.prepareCar(car); layer.handleCar(car);
      const camera = new THREE.PerspectiveCamera();
      layer.updateCamera(.2, camera, car);
      layer.prepareView(car, daylight);
      const first = layer.driverStats(car).feedback.causticTime;
      layer.updateCamera(.4, camera, car);
      layer.prepareView(car, daylight);
      layer.caustics.attach(scene);
      const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <worldpos_vertex>',
        fragmentShader: '#include <common>\n#include <opaque_fragment>' };
      surfaceMaterial.onBeforeCompile(shader as never, {} as never);
      const result = { ...layer.driverStats(car).feedback,
        first, second: layer.driverStats(car).feedback.causticTime,
        surfaceCount: layer.stats.colossusCausticSurfaces,
        litOpacity: layer.stats.colossusCausticOpacity,
        projectedShader: shader.fragmentShader.includes('vSlimeCausticWorld')
          && shader.fragmentShader.includes('slimeCausticBand'),
        sharedUniform: 'uSlimeCausticStrength' in shader.uniforms };
      layer.dispose(); physics.dispose();
      return result;
    };
    const day = read('day', false), night = read('night', false), reduced = read('day', true);
    expect(day).toMatchObject({ underwater: true, bubbles: 18, causticOpacity: .7,
      projectedShader: true, sharedUniform: true });
    expect(day.surfaceCount).toBeGreaterThan(0);
    // The ripple the shader is actually
    // given at night is a fraction of noon. `causticOpacity` is the base before the world's light,
    // so it stays the same; `litOpacity` is what the shader multiplies by.
    expect(night.causticOpacity, 'the base opacity is not what changes').toBe(.7);
    expect(day.litOpacity).toBeCloseTo(.7, 4);
    expect(night.litOpacity, 'night is nearly dark').toBeLessThan(day.litOpacity * .25);
    expect(night.litOpacity, 'but not switched off').toBeGreaterThan(0);
    expect(reduced.causticOpacity).toBe(.08);
    expect(reduced.litOpacity).toBeCloseTo(.08, 4);
    expect(day.second).toBeGreaterThan(day.first);
    expect(reduced.second).toBe(reduced.first);
    document.documentElement.dataset.reducedMotion = 'false';
  });

});

it('uses the slime centre for burst timing and direction with size-proportional force', () => {
  expect(burstCrossedCentre(-.4, -.1)).toBe(false);
  expect(burstCrossedCentre(-.1, .1)).toBe(true);
  expect(burstCrossedCentre(.1, -.1)).toBe(true);
  const centre = new THREE.Vector3();
  const small = burstImpulse([.5, .41, .5], centre, centre.clone());
  const large = burstImpulse([2, 1.64, 2], centre, centre.clone());
  expect(large.y / small.y).toBeCloseTo(4, 5);
  expect(small.x).toBe(0); expect(small.z).toBe(0);
  const left = burstImpulse([1, .82, 1], centre, new THREE.Vector3(-1, 0, 0));
  const right = burstImpulse([1, .82, 1], centre, new THREE.Vector3(1, 0, 0));
  const diagonal = burstImpulse([1, .82, 1], centre, new THREE.Vector3(1, 0, 1));
  expect(left.x).toBeLessThan(0); expect(right.x).toBeGreaterThan(0);
  expect(diagonal.x).toBeGreaterThan(0); expect(diagonal.z).toBeGreaterThan(0);
  const frozenApproach = new THREE.Vector3(1, 0, 0);
  expect(burstSignedDistance(centre, new THREE.Vector3(-1, 0, 0), frozenApproach)).toBe(-1);
  expect(burstSignedDistance(centre, new THREE.Vector3(1, 0, 0), frozenApproach)).toBe(1);
  expect(burstSignedDistance(centre, new THREE.Vector3(-1, 0, 0), frozenApproach)).toBe(-1);
});

it('drives translucent same-colour splash motion from forward, oblique and reverse impacts', () => {
  expect(SLIME_DROPLET_OPACITY).toBeLessThan(SLIME_BODY_OPACITY);
  for (const impact of [new THREE.Vector3(12, 0, 0), new THREE.Vector3(8, 0, -8),
    new THREE.Vector3(-12, 0, 0)]) {
    const direction = impact.clone().normalize();
    const velocities = Array.from({ length: 24 }, (_, i) => directionalSplashVelocity(impact, i));
    const mean = velocities.reduce((sum, velocity) => sum.add(velocity), new THREE.Vector3())
      .multiplyScalar(1 / velocities.length);
    expect(mean.dot(direction)).toBeGreaterThan(impact.length() * .45);
  }
  expect(SLIME_COLORS.burst).toBe(0x07090d);
});

it('projects an exit point and normal onto the giant body surface', () => {
  const spawn = prototypeSlimeSpawns(prototypeSpline()).find(item => item.kind === 'colossus')!;
  const outside = new THREE.Vector3(...spawn.position).add(new THREE.Vector3(30, 3, -8));
  const surface = colossusSurfacePoint(spawn, outside);
  expect(surface.error).toBeLessThan(1e-6);
  expect(surface.normal.dot(outside.clone().sub(surface.point))).toBeGreaterThan(0);
});

it('doubles the yellow elastic upper radius while keeping even the largest lighter than the smallest car', () => {
  const largest = slimeScale('slick', 1);
  expect(largest[0] * 2).toBe(3.5);
  expect(elasticSlimeMass(largest)).toBeLessThan(650);
  expect(elasticSlimeMass(slimeScale('slick', 0))).toBeLessThan(elasticSlimeMass(largest));
});

it('lets the smallest car drive the largest elastic slime away without becoming a roadblock', () => {
  const physics = new PhysicsWorld(api, 0);
  const floor = physics.world.createCollider(api.ColliderDesc.cuboid(100, .1, 100)
    .setTranslation(0, -.1, 0));
  physics.registerCollider(floor, 'ground');
  const scale = slimeScale('slick', 1);
  const slime = createSlimeBody(physics, new THREE.Vector3(5, scale[1], 0), scale, 'elastic');
  const cityPod = vehicleFor('city-pod')!;
  const car = new Car(physics, vehicleTuning(cityPod, 'hatch'), { pos: [0, .8, 0], yaw: -Math.PI / 2 });
  car.body.setLinvel({ x: 16, y: 0, z: 0 }, true);
  for (let i = 0; i < 90; i++) physics.step(1 / 60, h => car.update(h, NO_INPUT));
  expect(slime.body.mass()).toBeLessThan(car.body.mass());
  expect(slime.body.translation().x).toBeGreaterThan(6);
  expect(car.body.linvel().x).toBeGreaterThan(2);
  removeSlimeBody(physics, slime);
  physics.dispose();
});

describe('pipeline tile placement', () => {
  it('removes and disposes GLB slime carriers when the gameplay layer is disabled', () => {
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const disposeGeometry = vi.spyOn(geometry, 'dispose');
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const carrier = new THREE.InstancedMesh(geometry, material, 3);
    carrier.name = 'props_slime_popper';
    scene.add(carrier);

    const content = readTile(scene, new MaterialLibrary(), 'none');
    expect(content.slimes).toHaveLength(0);
    expect(content.group.children).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  });

  it('extracts exactly one authored population for normal and two for many', () => {
    const load = (density: 'none' | 'normal' | 'many') => {
      const scene = new THREE.Scene();
      for (const [name, x] of [['props_slime_popper', 10], ['props_slime_many_slick', 30]] as const) {
        const carrier = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
        carrier.name = name;
        carrier.setMatrixAt(0, new THREE.Matrix4().makeTranslation(x, 1, 0));
        scene.add(carrier);
      }
      return readTile(scene, new MaterialLibrary(), density).slimes;
    };
    expect(load('none')).toHaveLength(0);
    expect(load('normal')).toMatchObject([{ kind: 'popper', position: [10, 1, 0] }]);
    expect(load('many')).toMatchObject([
      { kind: 'popper', position: [10, 1, 0] },
      { kind: 'slick', position: [30, 1, 0] },
    ]);
  });

  it('extracts instance transforms and hides the GLB carrier geometry', () => {
    const scene = new THREE.Scene();
    const carrier = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
    carrier.name = 'props_slime_colossus';
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(12, 3, -7),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6),
      new THREE.Vector3(2.1, 1.42, 1.7));
    carrier.setMatrixAt(0, matrix);
    scene.add(carrier);

    const content = readTile(scene, new MaterialLibrary());
    expect(content.slimes).toHaveLength(1);
    expect(content.slimes[0]).toMatchObject({ kind: 'colossus', position: [12, 3, -7] });
    expect(content.slimes[0]!.scale[0]).toBeCloseTo(2.1);
    expect(content.slimes[0]!.scale[1]).toBeCloseTo(1.42);
    expect(content.slimes[0]!.scale[2]).toBeCloseTo(1.7);
    expect(content.slimes[0]!.yaw).toBeCloseTo(0.6);
    expect(content.group.children[0]!.visible).toBe(false);
    expect(content.materialNames.size).toBe(0);

    const unknownScene = new THREE.Scene();
    const unknown = carrier.clone();
    unknown.name = 'props_slime_future';
    unknown.visible = true;
    unknownScene.add(unknown);
    const fallback = readTile(unknownScene, new MaterialLibrary());
    expect(fallback.slimes).toHaveLength(0);
    expect(fallback.group.children[0]!.visible).toBe(false);
  });

  it('adds and removes exactly the population owned by a streamed tile', () => {
    const spline = prototypeSpline();
    const physics = new PhysicsWorld(api, 0);
    const scene = new THREE.Scene();
    const layer = new SlimeLayer(scene, physics, spline, document.createElement('div'),
      QUALITY_LIMITS.low, []);
    const source = prototypeSlimeSpawns(spline, 20).map(({ kind, position, scale, yaw }) =>
      ({ kind, position, scale, yaw }));

    layer.addTile('t_0_0', source);
    expect(layer.stats).toMatchObject({ spawned: 20, active: 20 });
    layer.removeTile('t_0_0');
    expect(layer.stats).toMatchObject({ spawned: 0, active: 0, groundEffects: 0 });
    layer.addTile('t_0_0', source);
    expect(layer.stats).toMatchObject({ spawned: 20, active: 20 });

    layer.dispose();
    physics.dispose();
  });

  it('does not resurrect a consumed slime when its tile streams out and back in', () => {
    const spline = prototypeSpline();
    const physics = new PhysicsWorld(api, 0);
    const scene = new THREE.Scene();
    const host = document.createElement('div');
    const layer = new SlimeLayer(scene, physics, spline, host, QUALITY_LIMITS.low, []);
    const spawns = prototypeSlimeSpawns(spline);
    const spawn = spawns.find((item) => item.kind === 'popper')!;
    const untouched = spawns.find((item) => item.kind !== 'colossus'
      && Math.abs(item.s - spawn.s) > 30)!;
    const source = [spawn, untouched].map(({ kind, position, scale, yaw }) =>
      ({ kind, position, scale, yaw }));
    layer.addTile('loop', source);
    const car = new Car(physics, tuningFor('sedan'), { pos: [...spawn.position], yaw: spawn.yaw });
    for (let i = 0; i < 3; i++) physics.step(physics.timestep, (h) => {
      layer.prepareCar(car); car.update(h, NO_INPUT); layer.handleCar(car);
    });
    expect(layer.stats.active).toBe(1);
    layer.removeTile('loop');
    layer.addTile('loop', source);
    expect(layer.stats.active).toBe(1);

    layer.dispose();
    physics.dispose();
  });
});


it('uses the visible dimensions for the actual Rapier collision footprint', () => {
 const spline=prototypeSpline();
 const spawn=prototypeSlimeSpawns(spline).find(s=>s.kind==='popper')!;
 const physics=new PhysicsWorld(api,0);
 const layer=new SlimeLayer(new THREE.Scene(),physics,spline,document.createElement('div'),QUALITY_LIMITS.low,[spawn]);
 const matrix=new THREE.Matrix4();layer.mesh.getMatrixAt(0,matrix);
 const size=new THREE.Vector3().setFromMatrixScale(matrix);
 expect(size.x).toBeCloseTo(spawn.scale[0]);expect(size.y / spawn.scale[1]).toBeGreaterThanOrEqual(.965);expect(size.y / spawn.scale[1]).toBeLessThanOrEqual(1.035);expect(size.z).toBeCloseTo(spawn.scale[2]);
 expect(size.x).toBeGreaterThanOrEqual(.5);
 let checked=0;
 physics.world.forEachCollider(collider=>{
  expect(collider.isSensor()).toBe(true);
  expect(collider.shapeType()).toBe(api.ShapeType.ConvexPolyhedron);
  const vertices=collider.vertices()!;
  const xs=Array.from(vertices).filter((_,i)=>i%3===0);
  const ys=Array.from(vertices).filter((_,i)=>i%3===1);
  expect(Math.max(...xs)).toBeCloseTo(size.x);
  expect(Math.max(...ys)).toBeCloseTo(spawn.scale[1]);
  checked++;
 });
 expect(checked).toBe(1);
 layer.dispose();physics.world.free();
});


it('animates separate body rhythms and pupils while leaving spawn positions fixed', () => {
  const physics = new PhysicsWorld(api, 0);
  const scene = new THREE.Scene();
  const spawns = [0, 15].map(x => ({ kind: 'popper' as const, s: x, position: [x, 2, 0] as [number, number, number],
    scale: [2, 2, 2] as [number, number, number], yaw: 0 }));
  const layer = new SlimeLayer(scene, physics, prototypeSpline(), document.createElement('div'), QUALITY_LIMITS.low, spawns);
  const before = new THREE.Matrix4(), after = new THREE.Matrix4(), other = new THREE.Matrix4();
  layer.mesh.getMatrixAt(0, before);
  layer.mesh.getMatrixAt(1, other);
  expect(before.elements[0]).not.toBeCloseTo(other.elements[0], 3);
  const pupil = new THREE.Matrix4(); layer.colossusPupils.getMatrixAt(0, pupil);
  layer.update(1);
  layer.mesh.getMatrixAt(0, after);
  expect(after.elements[5]).not.toBeCloseTo(before.elements[5], 4);
  expect(after.elements[12]).toBe(before.elements[12]);
  expect(after.elements[14]).toBe(before.elements[14]);
  expect(after.elements[13]! - after.elements[5]!).toBeCloseTo(0, 5);
  layer.colossusPupils.getMatrixAt(0, after);
  expect(after.elements).not.toEqual(pupil.elements);
  expect(layer.colossusPupils.count).toBe(4);
  expect(layer.colossusEyes.count).toBe(4);
  layer.dispose(); expect(scene.children).toHaveLength(0); physics.dispose();
});


it('lets red rocket fragments land without staining the road, where green fragments do', () => {
  const landings = (kind: SlimeKind) => {
    const physics = new PhysicsWorld(api);
    physics.add('ground', { trimeshes: [], boxes: [
      { center: [0, -.5, 0], half: [100, .5, 100], yaw: 0, role: 'ground' },
    ] });
    const layer = new SlimeLayer(new THREE.Scene(), physics, prototypeSpline(),
      document.createElement('div'), QUALITY_LIMITS.low, []);
    try {
      const before = layer.groundSplatter.count;
      (layer as any).emitFragments(kind, new THREE.Vector3(0, 1.5, 0), [.8, .8, .8], new THREE.Vector3(0, -3, 0));
      for (let i = 0; i < 180 && layer.stats.fragmentLandings === 0; i++) physics.step(1 / 60, () => {}, 5, h => layer.update(h));
      return { landed: layer.stats.fragmentLandings, stains: layer.groundSplatter.count - before };
    } finally { layer.dispose(); physics.dispose(); }
  };
  const green = landings('popper'), red = landings('boost');
  expect(green.landed, 'positive control: fragments reach the ground').toBeGreaterThan(0);
  expect(green.stains, 'and a green landing marks it').toBeGreaterThan(0);
  expect(red.landed, 'red fragments land the same way').toBeGreaterThan(0);
  expect(red.stains, 'but leave no red mark').toBe(0);
});

it('shares a rear-only burst across the actual ball-hitch rig without creating impulse', () => {
  const physics = new PhysicsWorld(api, 0);
  physics.add('ground', { trimeshes: [], boxes: [
    { center: [0, -.5, 0], half: [500, .5, 500], yaw: 0, role: 'ground' },
  ] });
  const vehicle = vehicleFor('pickup-travel-trailer')!;
  const car = new Car(physics, vehicleTuning(vehicle, 'sedan'),
    { pos: [50, 1, 0], yaw: -Math.PI / 2 });
  const trailer = new Trailer(physics, car, vehicle);
  const layer = new SlimeLayer(new THREE.Scene(), physics, prototypeSpline(),
    document.createElement('div'), QUALITY_LIMITS.low, []);
  try {
    for (let i = 0; i < 120; i++) physics.step(1 / 60, dt => {
      car.update(dt, NO_INPUT); trailer.update(dt);
    });
    const rear = trailer.car;
    const position = rear.position.clone();
    layer.addTile('rear-blast', [{ kind: 'burst',
      position: [position.x - .01, position.y, position.z], scale: [2.2, 1.8, 2.2], yaw: 0 }]);
    const live = (layer as any).lives.find((value: any) => value.spawn.kind === 'burst');
    for (const body of [car, rear]) body.body.setLinvel({ x: 12, y: 0, z: 0 }, true);
    // The real contact path sees the rear hull crossing the mass centre in this physics step.
    rear.collisions = [{ kind: 'slime-burst', started: true, other: live.collider.handle,
      point: { x: position.x, y: position.y, z: position.z },
      normal: { x: -1, y: 0, z: 0 }, closingSpeed: 12 }];
    const expected = burstImpulse(live.spawn.scale, new THREE.Vector3(...live.spawn.position),
      position, rear.tuning.ramMultiplier).y;
    layer.handleCar(car, NO_INPUT, rear);
    expect(layer.stats.feedback.hits.burst).toBe(1);
    expect(car.body.linvel().y).toBeGreaterThan(1);
    expect(car.body.linvel().y).toBeCloseTo(rear.body.linvel().y, 5);
    expect(car.body.mass() * car.body.linvel().y + rear.body.mass() * rear.body.linvel().y)
      .toBeCloseTo(expected, 2);
    let minUp = 1, gap = 0;
    for (let i = 0; i < 300; i++) {
      physics.step(1 / 60, dt => {
        layer.prepareCar(car, rear); car.update(dt, NO_INPUT); trailer.update(dt);
        layer.handleCar(car, NO_INPUT, rear);
      });
      layer.finishPhysicsStep(); layer.update(1 / 60);
      minUp = Math.min(minUp, car.upright, rear.upright);
      gap = Math.max(gap, trailer.hitchGap);
    }
    expect(minUp).toBeGreaterThan(.8);
    expect(gap).toBeLessThan(.08);
  } finally { layer.dispose(); trailer.dispose(); physics.dispose(); }
});
