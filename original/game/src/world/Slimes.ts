import { reducedMotion as prefersReducedMotion } from '../ui/reducedMotion';
import { SLIME_HAPTICS, phoneVibrationAllowed, phoneVibrationPattern } from './slimeHaptics';
import { causticBase, SlimeCaustics } from './SlimeCaustics';
import { PersistentSplatter } from './PersistentSplatter';
import { SplatterRenderer } from './SplatterRenderer';
import population from '../../../pipeline/sr/schema/slime-population.json' with { type: 'json' };
import { roundSlimeScale, slimeScale, slimeGroundFraction } from './slimeShape';
import { createSlimeBody, removeSlimeBody, slimeContact, slimeHull, type SlimeBody } from './SlimePhysics';
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ExplosionEffects } from './Explosions';
import type { SlimeSound, SlimeSoundPhase } from '../audio/Audio';
import type { Car, CarInput } from '../physics/Car';
import type { CarCollision, PhysicsWorld } from '../physics/PhysicsWorld';
import type { Spline } from '../track/Spline';
import type { TimeOfDay } from '../track/types';
import { Progress, projectOnSample } from '../track/Progress';
import type { SlimeTarget } from '../bot/SlimeDriving';
import { QUALITY_LIMITS, type QualityLimits } from './quality';
import { GroundMarkPool } from './GroundMarkPool';
import type { VehicleModel } from '../vehicles/VehicleModel';

export const SLIME_KINDS = ['popper', 'slick', 'burst', 'boost', 'colossus'] as const;
export type SlimeKind = (typeof SLIME_KINDS)[number];

/**
 * A repeatable pseudo-random number in [-1, 1] for piece `index` of break-up `seed`. Hashed
 * rather than Math.random so a test, a replay and a screenshot see the same droplets.
 */
export function pieceJitter(seed: number, index: number, channel: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35) ^ Math.imul(channel + 7, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 0xffffffff * 2 - 1;
}

/**
 * How one droplet or split-off ball differs from its siblings: size within
 * about 10 %, speed within about 20 % and inversely tied to size -- the small ones fly fastest -- and a
 * little sideways turn so they do not leave in a fan of identical rays.
 */
export function pieceVariation(seed: number, index: number): { size: number; speed: number; yaw: number } {
  const size = 1 + .1 * pieceJitter(seed, index, 0);
  const speed = THREE.MathUtils.clamp((1 + .08 * pieceJitter(seed, index, 1)) / (size * size), .75, 1.3);
  return { size, speed, yaw: .24 * pieceJitter(seed, index, 2) };
}

/** Turn a velocity about the vertical axis. */
function yawed(v: THREE.Vector3, yaw: number): THREE.Vector3 {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  return v.set(v.x * c - v.z * sn, v.y, v.x * sn + v.z * c);
}

/** How much bigger than the base fireball a bomb of this cube-root size bursts. */
export function burstSparkScale(effectScale: number): number {
  // Never below the old square-root curve, and linear with size once it overtakes it.
  return THREE.MathUtils.clamp(Math.max(effectScale / 1.4, Math.sqrt(effectScale / 2) * 1.08), .6, 3.5);
}

export function burstCrossedCentre(previous: number, current: number): boolean {
  return (previous <= 0 && current >= 0) || (previous >= 0 && current <= 0)
    || (Math.abs(previous) <= .03 && Math.abs(current) <= .03);
}

export function burstSignedDistance(centre: THREE.Vector3, point: THREE.Vector3,
  approachAxis: THREE.Vector3): number {
  return point.clone().sub(centre).dot(approachAxis);
}

export function burstImpulse(scale: readonly number[], centre: THREE.Vector3,
  vehicleCentreOfMass: THREE.Vector3, share = 1): THREE.Vector3 {
  const radius = Math.cbrt(scale[0]! * scale[1]! * scale[2]!);
  const vertical = 4200 * radius * share;
  const away = vehicleCentreOfMass.clone().sub(centre).setY(0);
  // The blast originates at the slime's centre of mass. A centred crossing therefore launches
  // almost straight up, while a side-swipe receives a visibly larger radial shove. Scaling by the
  // offset inside the body avoids inventing a sideways direction for a dead-centre hit.
  const lateralShare = THREE.MathUtils.clamp(away.length() / Math.max(radius, .001), 0, 1);
  if (away.lengthSq() > 1e-6) away.normalize().multiplyScalar(vertical * .22 * lateralShare);
  return away.setY(vertical);
}

export interface SlimeSpawn {
  kind: SlimeKind;
  s: number;
  position: [number, number, number];
  scale: [number, number, number];
  yaw: number;
  scenery?: boolean;
}

export type TileSlimeSpawn = Omit<SlimeSpawn, 's'>;

export interface SlimeStats {
  spawned: number;
  active: number;
  byKind: Record<SlimeKind, number>;
  colossi: number;
  colossusContacts: number;
  colossusTransit: boolean;
  colossusEntries: number;
  colossusExits: number;
  colossusFloatHeight: number;
  colossusForwardSpeed: number;
  colossusMinUpright: number;
  colossusDrop: number;
  colossusBubbles: number;
  colossusCausticOpacity: number;
  colossusCausticSurfaces: number;
  colossusSplashes: number;
  colossusWetMarks: number;
  colossusRippleSurfaceError: number;
  colossusSprayForward: number;
  boostActive: boolean;
  boostEntries: number;
  boostSpeedGain: number;
  groundEffects: number;
  particles: number;
  bounceHits: number;
  splitEvents: number;
  splitChildren: number;
  /** Hits on the smallest splitter that bounced it instead of splitting it (381). */
  smallestBounces: number;
  elasticDeforming: number;
  elasticPeak: number;
  physicalFragments: number;
  fragmentLandings: number;
  puddles: number;
  falling: number;
  fallingLandings: number;
  fallingSurvivors: number;
  fallingRoadLandings: number;
  fallingOffroadLandings: number;
  fallingBounces: number;
  fallingExplosions: number;
  nearestFallingLanding: number | null;
  feedback: {
    hits: Record<SlimeKind, number>;
    cameraShake: boolean;
    windshield: boolean;
    vibrationAttempts: number;
    phoneVibrations: number;
    cameraShakeMs: number;
    windshieldMs: number;
    windshieldCoverage: number;
    underwater: boolean;
    bubbles: number;
    causticOpacity: number;
    causticTime: number;
    boundarySplashes: number;
  };
}

const KINDS: readonly SlimeKind[] = SLIME_KINDS;
export const SLIME_COLORS: Readonly<Record<SlimeKind, number>> = {
  popper: 0x63ff35,
  slick: 0x9b5cff,
  burst: 0x07090d,
  boost: 0xf51d24,
  colossus: 0x168cff,
};
const COLOR = SLIME_COLORS;
/**
 * Whether breaking this kind leaves colour behind -- on the road, on the body, on the glass. A bomb is
 * fire, not liquid; the red rocket read as blood, so its droplets fly and are gone.
 */
export const leavesSplatter = (kind: SlimeKind): boolean => kind !== 'burst' && kind !== 'boost';
export const SLIME_BODY_OPACITY = 0.84;
export const SLIME_DROPLET_OPACITY = 0.48;
export const MIN_SPLIT_RADIUS = 0.42;
/** The smallest purple splitter no longer splits or vanishes: it only bounces away, scoring every hit. */
export function isSmallestSplitter(scale: readonly number[]): boolean {
  return Math.max(scale[0]!, scale[2]!) <= MIN_SPLIT_RADIUS * 1.45;
}

export function directionalSplashVelocity(impactVelocity: THREE.Vector3, ordinal: number,
  effectScale = 2): THREE.Vector3 {
  const direction = impactVelocity.clone();
  const impactSpeed = direction.length();
  if (impactSpeed > 1e-4) direction.multiplyScalar(1 / impactSpeed);
  const angle = ordinal * 2.399963;
  const spread = (1.35 + ordinal % 7 * .18)
    * THREE.MathUtils.clamp(Math.sqrt(effectScale / 2), .55, 1.6);
  const forward = Math.min(13, impactSpeed * .74) * (.78 + ordinal % 5 * .055);
  return direction.multiplyScalar(forward).add(new THREE.Vector3(
    Math.cos(angle) * spread, 2.4 + ordinal % 7 * .42, Math.sin(angle) * spread));
}

export function collisionSplashVelocity(event: Pick<CarCollision, 'normal' | 'closingSpeed'>,
  bodyVelocity: THREE.Vector3): THREE.Vector3 {
  const normal = new THREE.Vector3(event.normal.x, event.normal.y, event.normal.z);
  if (normal.lengthSq() < 1e-6) return bodyVelocity.clone();
  normal.normalize().multiplyScalar(-Math.max(event.closingSpeed, 1));
  const tangent = bodyVelocity.clone().addScaledVector(normal,
    -bodyVelocity.dot(normal) / Math.max(normal.lengthSq(), 1e-6));
  return normal.addScaledVector(tangent, .22);
}

/** How much wider than its sphere a giant is drawn at a normalized height; the vertex shader flares the same skirt. */
function colossusSkirt(normalizedY: number): number {
  const t = THREE.MathUtils.clamp(0.15 - normalizedY, 0, 1);
  return 1 + t * t * (3 - 2 * t) * 0.22;
}

/** The giant's widest horizontal half-extent over its unit sphere, skirt included. */
export const COLOSSUS_WIDEST = (() => {
  let widest = 1;
  for (let i = 0; i <= 2000; i++) {
    const y = -1 + i / 1000;
    widest = Math.max(widest, Math.sqrt(Math.max(0, 1 - y * y)) * colossusSkirt(y));
  }
  return widest;
})();

function colossusField(spawn: SlimeSpawn, point: THREE.Vector3, margin = 1): number {
  const [x, y, z] = spawn.position;
  const [sx, sy, sz] = spawn.scale;
  const dx = point.x - x;
  const dz = point.z - z;
  const c = Math.cos(spawn.yaw);
  const s = Math.sin(spawn.yaw);
  const localX = c * dx - s * dz;
  const localZ = s * dx + c * dz;
  const localY = point.y - y;
  const radial = colossusSkirt(localY / sy);
  return (localX / (sx * radial * margin)) ** 2 + (localY / (sy * margin)) ** 2
    + (localZ / (sz * radial * margin)) ** 2;
}

export function colossusSurfacePoint(spawn: SlimeSpawn, outsidePoint: THREE.Vector3): {
  point: THREE.Vector3; normal: THREE.Vector3; error: number;
} {
  const centre = new THREE.Vector3(...spawn.position);
  const direction = outsidePoint.clone().sub(centre);
  if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
  let low = 0;
  let high = 1;
  while (colossusField(spawn, centre.clone().addScaledVector(direction, high)) <= 1) high *= 2;
  for (let i = 0; i < 36; i++) {
    const mid = (low + high) * .5;
    if (colossusField(spawn, centre.clone().addScaledVector(direction, mid)) <= 1) low = mid;
    else high = mid;
  }
  const point = centre.clone().addScaledVector(direction, (low + high) * .5);
  const epsilon = Math.max(...spawn.scale) * .0005;
  const normal = new THREE.Vector3(
    colossusField(spawn, point.clone().add(new THREE.Vector3(epsilon, 0, 0)))
      - colossusField(spawn, point.clone().add(new THREE.Vector3(-epsilon, 0, 0))),
    colossusField(spawn, point.clone().add(new THREE.Vector3(0, epsilon, 0)))
      - colossusField(spawn, point.clone().add(new THREE.Vector3(0, -epsilon, 0))),
    colossusField(spawn, point.clone().add(new THREE.Vector3(0, 0, epsilon)))
      - colossusField(spawn, point.clone().add(new THREE.Vector3(0, 0, -epsilon))),
  ).normalize();
  const error = Math.abs(colossusField(spawn, point) - 1);
  return { point, normal, error };
}

/** Upper membrane directly above an interior point, using the same field as entry/exit. */
export function colossusCeiling(spawn: SlimeSpawn, point: THREE.Vector3): number | null {
  if (colossusField(spawn, point) > 1) return null;
  let low = point.y, high = spawn.position[1] + spawn.scale[1];
  const sample = point.clone();
  for (let i = 0; i < 24; i++) {
    sample.y = (low + high) * .5;
    if (colossusField(spawn, sample) <= 1) low = sample.y;
    else high = sample.y;
  }
  return (low + high) * .5;
}

export function elasticDeformation(strength: number, age: number): { along: number; across: number } {
  const wave = THREE.MathUtils.clamp(strength, 0, 1) * Math.exp(-Math.max(0, age) * 2.25)
    * Math.cos(Math.max(0, age) * 15.5);
  return { along: 1 - wave * .46, across: 1 + wave * .24 };
}
/** Stable individual rhythm; animation never moves a spawn along the road. */
export function slimeLife(seed: number, time: number): { breath: number; yaw: number; gazeX: number; gazeY: number } {
  const phase = seed * 0.000001 + 1.7;
  return {
    breath: 1 + Math.sin(time * (1.45 + (seed % 13) * .035) + phase) * .035,
    yaw: phase + Math.sin(time * .31 + phase * .7) * .48,
    gazeX: Math.sin(time * .83 + phase * 1.3) * .045,
    gazeY: Math.sin(time * .57 - phase) * .035,
  };
}

/** Fluid thrust inside the giant, m/s^2; only ever climbs back to the viscous limit. */
const COLOSSUS_THRUST = 2.5;
/** How fast speed above the viscous limit bleeds away, 1/s. */
const COLOSSUS_VISCOSITY = 2.4;
/**
 * Buoyancy inside the giant: every rig rises at this acceleration from the step it
 * enters, whatever it weighs, until its origin is COLOSSUS_FLOAT_HEIGHT above the giant's ground,
 * and starts to fall the step it leaves.
 */
export const COLOSSUS_LIFT = 6;
export const COLOSSUS_FLOAT_HEIGHT = 4;
/** Slowest the slime lets a car drift, so even a stopped car still comes out the other side. */
const COLOSSUS_CRAWL = 4.5;

/**
 * Speed the giant's glue settles a car to: a fraction of its arrival speed, so never faster than
 * it came in except at a crawl. Heavier rigs carry a little more momentum (mobility .8..1.6 ->
 * 50%..65% retained).
 */
export function colossusSpeedLimit(entrySpeed: number, mobility: number): number {
  const retained = .5 + .15 * THREE.MathUtils.clamp((mobility - .8) / .8, 0, 1);
  return Math.max(COLOSSUS_CRAWL, entrySpeed * retained);
}

/** The gameplay volume follows the same broadened skirt the colossus vertex shader draws. */
/** Is any of this body inside the giant -- its centre or any of its six chassis extremes?
 *
 * A car's centre sits about half a metre up, so on a giant whose underside rests on the road the
 * centre can be outside the body while the car is visibly in it. Every question about being in a
 * giant -- buoyancy, thrust, sound, and the ground ripple -- asks it this way; only the
 * margin differs, and that difference is deliberate (143: transit lets go late so it cannot flicker).
 */
export function bodyInColossus(spawn: SlimeSpawn, body: { position: THREE.Vector3;
  quaternion: THREE.Quaternion; tuning: { chassisHalf: readonly number[] } }, margin = 1): boolean {
  if (colossusContains(spawn, body.position, margin)) return true;
  const [x = 0, y = 0, z = 0] = body.tuning.chassisHalf as number[];
  return [[x, 0, 0], [-x, 0, 0], [0, y, 0], [0, -y, 0], [0, 0, z], [0, 0, -z]]
    .some(point => colossusContains(spawn,
      new THREE.Vector3(...point).applyQuaternion(body.quaternion).add(body.position), margin));
}

export function colossusContains(spawn: SlimeSpawn, point: THREE.Vector3, margin = 1): boolean {
  return colossusField(spawn, point, margin) <= 1;
}

/**
 * The measured prototype ratio, now rounded onto seventy-two default instances.
 * A deterministic shuffle keeps every kind in the opening minute without making screenshots flaky.
 */
export function prototypeSlimeSpawns(spline: Spline, count = 72): SlimeSpawn[] {
  const counts = Object.fromEntries(KINDS.map(kind => [kind,
    kind === 'colossus' ? Math.max(2, Math.round(count * population[kind] / 100))
      : Math.round(count * population[kind] / 100)])) as Record<SlimeKind, number>;
  counts.popper += count - Object.values(counts).reduce((sum, value) => sum + value, 0);
  const bag = KINDS.flatMap((kind) => Array<SlimeKind>(counts[kind]).fill(kind));
  let seed = 0x51_1a_3e;
  for (let i = bag.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [bag[i], bag[j]] = [bag[j]!, bag[i]!];
  }
  // Force one of each into the first six encounters; the displaced kinds stay in the bag, so the
  // requested denominator and starting ratios remain intact.
  for (let i = 0; i < KINDS.length; i++) {
    const at = bag.indexOf(KINDS[i]!, i);
    [bag[i], bag[at]] = [bag[at]!, bag[i]!];
  }

  return bag.map((kind, i) => {
    const s = (i + 2) * spline.length / (bag.length + 4);
    const at = spline.indexAt(s);
    const p = spline.point(at);
    const r = spline.right(at);
    const width = spline.halfWidth[at] ?? 6;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const scale = slimeScale(kind, seed / 0x100000000);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const offset = kind === 'colossus' ? 0
      : (2 * seed / 0x100000000 - 1) * Math.max(0, width - scale[0] - .2);
    return {
      kind, s,
      position: [p[0] + r[0] * offset, p[1] + scale[1] * slimeGroundFraction(kind), p[2] + r[2] * offset],
      scale: [...scale],
      yaw: Math.atan2(-spline.tangent(at)[0], -spline.tangent(at)[2]),
    };
  });
}

interface LiveSlime {
  key: string;
  tile: string;
  spawn: SlimeSpawn;
  index: number;
  active: boolean;
  collider: RAPIER.Collider | null;
  motion: SlimeBody | null;
  lastLaunch: number;
  burstApproach: Map<Car, { axis: THREE.Vector3; distance: number }>;
  elasticHit: { direction: THREE.Vector3; strength: number; at: number } | null;
  pendingSplit: { velocity: THREE.Vector3; at: number } | null;
  /** Hits taken; the smallest splitter scores each one under its own key. */
  hits: number;
  /**
   * A giant's body as drawn this frame: centre, the half-extents of its scaled sphere and its yaw.
   * The road caustic under it follows this outline, not the spawn.
   */
  outline?: SlimeSpawn;
}

interface ColossusTransit {
  live: LiveSlime;
  elapsed: number;
  gurgleClock: number;
  groundY: number;
  forward: THREE.Vector3;
  speed: number;
  /** Viscous ceiling for the fluid thrust: always below the speed the car arrived with. */
  limit: number;
  revision: number;
  bodyOffsets: number[];
  bodies: readonly Car[];
  ceiling: number | null;
}

interface SlimeAudioTransit {
  live: LiveSlime;
  kind: SlimeKind;
  centre: THREE.Vector3;
  scale: readonly [number, number, number];
  yaw: number;
  enteredAt: number;
  strength: number;
  revision: number;
}

interface FallingSlime {
  motion: SlimeBody;
  scale: [number, number, number];
  slot: number;
  kind: 'popper' | 'slick' | 'burst';
  elapsed: number;
  duration: number;
  height: number;
  start: THREE.Vector3;
  landing: THREE.Vector3;
  normal: THREE.Vector3;
  right: THREE.Vector3;
  road: boolean;
  contacted: boolean;
  touching: boolean;
  bounces: number;
  settledFrames: number;
  trailClock: number;
}

const MAX_STATIC_SLIMES = Math.max(...Object.values(QUALITY_LIMITS).map(limits => limits.slimes));
const MAX_COLOSSI = Math.max(...Object.values(QUALITY_LIMITS).map(limits => limits.colossi));
const MAX_FALLING_SLIMES = Math.max(...Object.values(QUALITY_LIMITS).map(limits => limits.fallingSlimes));
const FALLING_INSTANCE_START = MAX_STATIC_SLIMES;
const FALLING_SAFE_RADIUS = 7;
const FALLING_INTERVAL_SECONDS = 14;
const COLOSSUS_PANELS_PER_BODY = 6;
const COLOSSUS_WHEELS_PER_BODY = 4;
const COLOSSUS_SEATS_PER_BODY = 2;
// A puddle is a pool left on a floor, never a decal on a barrier. This still accepts every road
// grade and steep embankments while rejecting the near-vertical face of a guardrail or wall.
const MIN_PUDDLE_UP_DOT = 0.5;

class SlimeEffects {
  readonly particles: THREE.InstancedMesh;
  readonly puddles: THREE.InstancedMesh;
  /** Wet prints from the giant's water, kept for the race like every road mark. */
  readonly wetMarks: GroundMarkPool;
  private readonly particleBorn: Float32Array;
  private readonly particleOrigin: THREE.InstancedBufferAttribute;
  private readonly particleVelocity: THREE.InstancedBufferAttribute;
  private readonly particleSize: THREE.InstancedBufferAttribute;
  private readonly particleMist: THREE.InstancedBufferAttribute;
  private readonly particleTime = { value: 0 };
  private readonly puddleBorn: Float64Array;
  private readonly puddleEffectBorn: THREE.InstancedBufferAttribute;
  private readonly puddleLifetime: THREE.InstancedBufferAttribute;
  private clock = 0;
  private puddleSerial = 0;
  private particleLimit: number;
  private puddleLimit: number;
  private nextParticle = 0;
  /** Counts break-ups, the seed of each one's piece variation. */
  private breakups = 0;
  private nextPuddle = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly circleNormal = new THREE.Vector3(0, 0, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly scale = new THREE.Vector3();

  constructor(limits: Readonly<QualityLimits>, private readonly persistent: PersistentSplatter) {
    const maxParticles = 2000;
    const maxPuddles = 300;
    this.particleLimit = limits.particles;
    this.puddleLimit = limits.puddles;
    this.particleBorn = new Float32Array(maxParticles).fill(-100);
    this.puddleBorn = new Float64Array(maxPuddles).fill(-1);
    this.puddleEffectBorn = new THREE.InstancedBufferAttribute(new Float32Array(maxPuddles), 1);
    this.puddleLifetime = new THREE.InstancedBufferAttribute(new Float32Array(maxPuddles), 1);

    const particleGeometry = new THREE.IcosahedronGeometry(0.045, 0);
    this.particleOrigin = new THREE.InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3);
    this.particleVelocity = new THREE.InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3);
    this.particleSize = new THREE.InstancedBufferAttribute(new Float32Array(maxParticles), 1);
    this.particleMist = new THREE.InstancedBufferAttribute(new Float32Array(maxParticles), 1);
    const particleBorn = new THREE.InstancedBufferAttribute(this.particleBorn, 1);
    particleGeometry.setAttribute('effectOrigin', this.particleOrigin);
    particleGeometry.setAttribute('effectVelocity', this.particleVelocity);
    particleGeometry.setAttribute('effectBorn', particleBorn);
    particleGeometry.setAttribute('effectSize', this.particleSize);
    particleGeometry.setAttribute('effectMist', this.particleMist);
    this.particles = new THREE.InstancedMesh(
      particleGeometry,
      new THREE.ShaderMaterial({
        uniforms: { uEffectTime: this.particleTime },
        transparent: true,
        depthWrite: false,
        vertexShader: `
          uniform float uEffectTime;
          attribute vec3 effectOrigin;
          attribute vec3 effectVelocity;
          attribute float effectBorn;
          attribute float effectSize;
          attribute float effectMist;
          varying vec3 vEffectColor;
          varying float vEffectAlpha;
          varying float vEffectSparkle;
          varying float vEffectMist;
          void main() {
            float age = uEffectTime - effectBorn;
            float alive = step(0.0, age) * (1.0 - step(0.9, age));
            float fade = max(0.0, 1.0 - age / 0.9) * alive;
            float sparkle = 1.0 - step(0.0, effectSize);
            float mist = step(0.5, effectMist);
            float twinkle = 0.52 + 0.48 * sin(uEffectTime * 24.0
              + dot(effectOrigin, vec3(1.7, 2.3, 1.1)));
            vec3 gravity = vec3(0.0, mix(mix(-6.0 * age * age, 0.45 * age, sparkle),
              0.2 * age, mist), 0.0);
            vec3 centre = effectOrigin + effectVelocity * age + gravity;
            float ordinarySize = abs(effectSize) * fade * mix(1.0, 0.38 + twinkle, sparkle);
            float mistSize = abs(effectSize) * (0.34 + age * 2.4) * fade;
            float size = mix(ordinarySize, mistSize, mist);
            vec3 transformed = centre + position * size;
            vEffectColor = instanceColor * mix(mix(1.0, 1.7 + twinkle * 1.5, sparkle), 1.25, mist);
            vEffectAlpha = fade * mix(${SLIME_DROPLET_OPACITY.toFixed(2)}, 0.18, mist);
            vEffectSparkle = sparkle;
            vEffectMist = mist;
            gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(transformed, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vEffectColor;
          varying float vEffectAlpha;
          varying float vEffectSparkle;
          varying float vEffectMist;
          void main() {
            if (vEffectAlpha <= 0.001) discard;
            vec3 colour = mix(mix(vEffectColor, vEffectColor + vec3(0.8, 0.55, 1.0),
              vEffectSparkle), vEffectColor + vec3(0.18, 0.06, 0.02), vEffectMist);
            gl_FragColor = vec4(colour, vEffectAlpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
      maxParticles,
    );
    this.particles.name = 'slime-particles';
    this.particles.frustumCulled = false;
    const puddleGeometry = new THREE.CircleGeometry(1, 48);
    const outline = puddleGeometry.getAttribute('position');
    for (let i = 1; i < outline.count; i++) {
      const angle = Math.atan2(outline.getY(i), outline.getX(i));
      const radius = .73 + .18 * Math.sin(angle * 7 + .4) + .09 * Math.cos(angle * 13);
      outline.setXYZ(i, outline.getX(i) * radius, outline.getY(i) * radius, 0);
    }
    puddleGeometry.setAttribute('effectBorn', this.puddleEffectBorn);
    puddleGeometry.setAttribute('effectLifetime', this.puddleLifetime);
    this.puddles = new THREE.InstancedMesh(
      puddleGeometry,
      new THREE.ShaderMaterial({
        uniforms: { uEffectTime: this.particleTime },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: `
          uniform float uEffectTime;
          attribute float effectBorn;
          attribute float effectLifetime;
          varying vec3 vPuddleColor;
          varying float vPuddleAlpha;
          void main() {
            vPuddleColor = instanceColor;
            vPuddleAlpha = effectLifetime <= 0.0 ? 1.0
              : clamp(effectBorn + effectLifetime - uEffectTime, 0.0, 1.0);
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vPuddleColor;
          varying float vPuddleAlpha;
          void main() {
            if (vPuddleAlpha <= 0.001) discard;
            gl_FragColor = vec4(vPuddleColor, 0.55 * vPuddleAlpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
      maxPuddles,
    );
    this.puddles.name = 'slime-puddles';
    this.puddles.frustumCulled = false;
    const wetGeometry = new THREE.PlaneGeometry(1, 1);
    wetGeometry.rotateX(-Math.PI / 2);
    const wetMaterial = new THREE.MeshBasicMaterial({ color: 0x20343a, transparent: true,
      opacity: .42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
      side: THREE.DoubleSide });
    wetMaterial.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWetUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWetUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWetUv;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
          float wetSide = 1.0 - smoothstep(0.32 + 0.025 * sin(vWetUv.y * 25.0),
            0.49, abs(vWetUv.x - 0.5));
          float wetEnds = smoothstep(0.0, 0.12, vWetUv.y)
            * smoothstep(0.0, 0.12, 1.0 - vWetUv.y);
          if (wetSide * wetEnds <= 0.01) discard;
          vec4 diffuseColor = vec4(diffuse, opacity * wetSide * wetEnds);`);
    };
    wetMaterial.customProgramCacheKey = () => 'colossus-wet-wheel-marks-v2';
    this.wetMarks = new GroundMarkPool('colossus-wet-wheel-marks', wetGeometry, wetMaterial, 1024, 1 << 15);
    // Allocate instanceColor before the first renderer compile. Collisions happen later; creating
    // the attribute on first impact would leave the already-compiled material colour-blind.
    this.puddles.setColorAt(0, new THREE.Color(COLOR.popper));
    this.matrix.identity();
    for (let i = 0; i < maxParticles; i++) this.particles.setMatrixAt(i, this.matrix);
    this.particles.setColorAt(0, new THREE.Color(COLOR.popper));
    this.particles.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.particles.count = this.particleLimit;
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < maxPuddles; i++) this.puddles.setMatrixAt(i, this.matrix);
    this.puddles.count = this.puddleLimit;
    this.hideUnused();
  }

  setLimits(limits: Readonly<QualityLimits>): void {
    this.particleLimit = limits.particles;
    this.nextParticle %= this.particleLimit;
    this.particles.count = this.particleLimit;
    this.resizePuddles(limits.puddles);
    this.hideUnused();
  }

  emit(kind: SlimeKind, position: THREE.Vector3, groundPoint: THREE.Vector3,
    groundNormal: THREE.Vector3, puddleSeconds = 0, impactVelocity?: THREE.Vector3,
    effectScale = 2, groundVelocity = impactVelocity): void {
    const color = new THREE.Color(COLOR[kind]);
    // A bomb is fire, not liquid -- no black droplets, no black puddle, only sparks.
    const baseCount = kind === 'colossus' ? 90 : kind === 'burst' ? 0 : kind === 'popper' ? 48 : 24;
    const count = Math.round(baseCount * THREE.MathUtils.clamp(effectScale / 2, .45, 2));
    // Varies the popper's droplets only; every other
    // splash keeps its look. The old sizes and forward speeds both rose with n % 5, so bigger droplets
    // flew faster: the speed now follows the droplet's final size inversely instead.
    const varied = kind === 'popper', seed = varied ? ++this.breakups : 0;
    for (let n = 0; n < count; n++) {
      const baseSize = 0.75 + (n % 5) * 0.13;
      const velocity = directionalSplashVelocity(impactVelocity ?? new THREE.Vector3(), n, effectScale);
      if (!varied) { this.writeParticle(position, velocity.x, velocity.y, velocity.z, baseSize, color); continue; }
      const piece = pieceVariation(seed, n);
      const size = baseSize * piece.size;
      // Undo the forward factor's own rise with n % 5, then scale by how small this droplet is.
      const sizeSpeed = THREE.MathUtils.clamp((1.01 / size) ** 1.2 * (.89 / (.78 + (n % 5) * .055)), .7, 1.5);
      yawed(velocity, piece.yaw).multiplyScalar(sizeSpeed * (1 + .08 * pieceJitter(seed, n, 1)));
      this.writeParticle(position, velocity.x, velocity.y, velocity.z, size, color);
    }
    if (kind === 'burst') {
      // The fireball grows with the body in proportion, not by square root, and is larger than before
      // at every size; the old curve topped out at 1.6x.
      const sparkleScale = burstSparkScale(effectScale);
      const sparkleCount = Math.round(28 * THREE.MathUtils.clamp(effectScale / 1.4, .7, 2.5));
      for (let i = 0; i < sparkleCount; i++) {
        const angle = i * 2.399963;
        const speed = (7 + (i % 9) * 1.7) * sparkleScale;
        this.writeParticle(position, Math.cos(angle) * speed, (2 + (i % 8) * 1.5) * sparkleScale,
          Math.sin(angle) * speed, -(1.2 + (i % 3) * .65) * sparkleScale,
          new THREE.Color(i % 3 ? 0xffb347 : 0xffe28a));
      }
      // The white core sparkle gave way to the fireball's own flash.
      const mistCount = Math.round(36 * THREE.MathUtils.clamp(effectScale / 1.4, .7, 2.5));
      for (let i = 0; i < mistCount; i++) {
        const angle = i * 2.399963 + .35;
        const speed = (3.6 + (i % 7) * .72) * sparkleScale;
        this.writeParticle(position, Math.cos(angle) * speed,
          (.25 + (i % 5) * .18) * sparkleScale, Math.sin(angle) * speed,
          (4.2 + (i % 4) * .75) * sparkleScale,
          new THREE.Color(i % 3 ? 0xff4a2e : 0xffa24b), true);
      }
    }
    if (leavesSplatter(kind)) this.splat(kind, groundPoint, groundNormal,
      (kind === 'colossus' ? 1.1 : 1) * effectScale, puddleSeconds, groundVelocity);
    this.particleOrigin.needsUpdate = true;
    this.particleVelocity.needsUpdate = true;
    (this.particles.geometry.getAttribute('effectBorn') as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.particleSize.needsUpdate = true;
    this.particleMist.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }

  /** A bomb's burn on the ground; kept for the race like every other ground mark. */
  scorch(groundPoint: THREE.Vector3, groundNormal: THREE.Vector3, radius: number): void {
    if (groundNormal.clone().normalize().y < MIN_PUDDLE_UP_DOT) return;
    this.persistent.scorch(groundPoint, groundNormal.clone().normalize(), radius);
  }

  splat(kind: SlimeKind, groundPoint: THREE.Vector3, groundNormal: THREE.Vector3,
    radius: number, seconds = 0, velocity = new THREE.Vector3()): void {
    const normal = groundNormal.clone().normalize();
    if (normal.y < MIN_PUDDLE_UP_DOT) return;
    if (seconds <= 0) {
      this.persistent.add(groundPoint, normal, velocity, new THREE.Color(COLOR[kind]), radius);
      return;
    }
    const p = this.nextPuddle;
    this.nextPuddle = (this.nextPuddle + 1) % this.puddleLimit;
    const serial = this.puddleSerial++;
    this.puddleBorn[p] = serial;
    this.puddleEffectBorn.setX(p, this.clock);
    this.puddleLifetime.setX(p, seconds);
    this.puddles.setColorAt(p, new THREE.Color(COLOR[kind]));
    this.rotation.setFromUnitVectors(this.circleNormal, normal);
    this.rotation.multiply(new THREE.Quaternion().setFromAxisAngle(this.circleNormal,
      (serial * 2.399963) % (Math.PI * 2)));
    const stretch = .68 + (serial * .371 % 1) * .64;
    this.matrix.compose(groundPoint.clone().addScaledVector(normal, .025), this.rotation,
      this.scale.set(radius * stretch, radius * (1.55 - stretch), radius));
    this.puddles.setMatrixAt(p, this.matrix);
    this.puddleEffectBorn.needsUpdate = true;
    this.puddleLifetime.needsUpdate = true;
    if (this.puddles.instanceColor) this.puddles.instanceColor.needsUpdate = true;
    this.puddles.instanceMatrix.needsUpdate = true;
  }

  /** A narrow dark wet print; kept for the race like the road splats. */
  wetMark(position: THREE.Vector3, forward: THREE.Vector3, width: number, length: number): void {
    const direction = forward.clone().setY(0);
    if (direction.lengthSq() < 1e-5) direction.set(0, 0, -1);
    direction.normalize();
    const yaw = Math.atan2(-direction.x, -direction.z);
    this.rotation.setFromAxisAngle(this.up, yaw);
    this.matrix.compose(position.clone().addScaledVector(this.up, .022), this.rotation,
      this.scale.set(Math.max(.08, width), 1, Math.max(.28, length)));
    this.wetMarks.add(this.matrix);
    this.wetMarks.flush();
  }

  emitTrail(kind: SlimeKind, position: THREE.Vector3): void {
    const color = new THREE.Color(COLOR[kind]);
    const origin = position.clone(); origin.y += .09;
    this.writeParticle(origin, 0.18, 1.2, -0.12, -6.0, color);
    this.writeParticle(origin, -0.16, .9, 0.14, -4.4, color);
    this.writeParticle(origin, 0.08, .65, 0.06, -3.2, color);
    this.writeParticle(origin, -0.06, .45, -0.08, -2.4, color);
    this.particleOrigin.needsUpdate = true;
    this.particleVelocity.needsUpdate = true;
    (this.particles.geometry.getAttribute('effectBorn') as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.particleSize.needsUpdate = true;
    this.particleMist.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }

  /** Two red-orange exhaust plumes attached to the rear only during rocket boost. */
  emitBoostTrail(position: THREE.Vector3, forward: THREE.Vector3, rear: number, halfWidth: number): void {
    const red = new THREE.Color(COLOR.boost);
    const orange = new THREE.Color(0xff7b16);
    const white = new THREE.Color(0xfffde8);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    for (let i = 0; i < 8; i++) {
      const nozzle = i % 2 === 0 ? -1 : 1;
      const side = nozzle * Math.max(.22, halfWidth * .58);
      const origin = position.clone().addScaledVector(right, side)
        .addScaledVector(forward, -rear - (i % 4) * .18);
      origin.y += 0.18 + (i % 3) * 0.10;
      this.writeParticle(origin,
        -forward.x * (3.2 + i * 0.18) + right.x * nozzle * .22,
        0.12 + (i % 3) * .16,
        -forward.z * (3.2 + i * 0.18) + right.z * nozzle * .22,
        -(3.4 + (i % 4) * 1.05), i % 4 === 0 ? white : i % 3 === 0 ? orange : red);
    }
    this.particleOrigin.needsUpdate = true;
    this.particleVelocity.needsUpdate = true;
    (this.particles.geometry.getAttribute('effectBorn') as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.particleSize.needsUpdate = true;
    this.particleMist.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }

  private writeParticle(position: THREE.Vector3, vx: number, vy: number, vz: number,
    size: number, color: THREE.Color, mist = false): void {
    const i = this.nextParticle;
    this.nextParticle = (this.nextParticle + 1) % this.particleLimit;
    this.particleOrigin.setXYZ(i, position.x, position.y, position.z);
    this.particleVelocity.setXYZ(i, vx, vy, vz);
    this.particleBorn[i] = this.clock;
    this.particleSize.setX(i, size);
    this.particleMist.setX(i, mist ? 1 : 0);
    this.particles.setColorAt(i, color);
  }

  update(dt: number): void {
    this.clock += dt;
    this.particleTime.value = this.clock;
  }

  get liveParticles(): number {
    let live = 0;
    for (let i = 0; i < this.particleLimit; i++) {
      const age = this.clock - this.particleBorn[i]!;
      if (age >= 0 && age < 0.9) live++;
    }
    return live;
  }

  get livePuddles(): number {
    let live = 0;
    for (let i = 0; i < this.puddleLimit; i++) {
      const lifetime = this.puddleLifetime.getX(i);
      if (this.puddleBorn[i]! >= 0 && (lifetime <= 0
        || this.clock - this.puddleEffectBorn.getX(i) < lifetime)) live++;
    }
    return live + this.persistent.count;
  }

  private resizePuddles(limit: number): void {
    const active: { born: number; effectBorn: number; lifetime: number;
      matrix: THREE.Matrix4; color: THREE.Color }[] = [];
    for (let i = 0; i < this.puddleLimit; i++) {
      if (this.puddleBorn[i]! < 0) continue;
      const lifetime = this.puddleLifetime.getX(i);
      if (lifetime > 0 && this.clock - this.puddleEffectBorn.getX(i) >= lifetime) continue;
      const matrix = new THREE.Matrix4();
      const color = new THREE.Color();
      this.puddles.getMatrixAt(i, matrix);
      if (this.puddles.instanceColor) this.puddles.getColorAt(i, color);
      active.push({ born: this.puddleBorn[i]!, effectBorn: this.puddleEffectBorn.getX(i),
        lifetime, matrix, color });
    }
    active.sort((a, b) => a.born - b.born);
    const keep = active.slice(-limit);
    this.puddleBorn.fill(-1);
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < this.puddleBorn.length; i++) this.puddles.setMatrixAt(i, this.matrix);
    keep.forEach((item, i) => {
      this.puddleBorn[i] = item.born;
      this.puddleEffectBorn.setX(i, item.effectBorn);
      this.puddleLifetime.setX(i, item.lifetime);
      this.puddles.setMatrixAt(i, item.matrix);
      this.puddles.setColorAt(i, item.color);
    });
    this.puddleLimit = limit;
    this.nextPuddle = keep.length % limit;
    this.puddles.count = limit;
    if (this.puddles.instanceColor) this.puddles.instanceColor.needsUpdate = true;
    this.puddleEffectBorn.needsUpdate = true;
    this.puddleLifetime.needsUpdate = true;
    this.puddles.instanceMatrix.needsUpdate = true;
  }

  private hideUnused(): void {
    this.matrix.makeScale(0, 0, 0);
    for (let i = this.particleLimit; i < this.particleBorn.length; i++) this.particleBorn[i] = -100;
    for (let i = this.puddleLimit; i < this.puddleBorn.length; i++) this.puddles.setMatrixAt(i, this.matrix);
    (this.particles.geometry.getAttribute('effectBorn') as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.puddles.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.particles.geometry.dispose();
    (this.particles.material as THREE.Material).dispose();
    this.puddles.geometry.dispose();
    (this.puddles.material as THREE.Material).dispose();
    this.wetMarks.dispose();
  }
}

interface SlimeVibrationActuator {
  playEffect(type: string, effect: Record<string, number>): Promise<unknown>;
  reset?(): Promise<unknown>;
}

class SlimeFeedback {
  private remaining = 0;
  private duration = 1;
  private amplitude = 0;
  private elapsed = 0;
  private smearRemaining = 0;
  private smearDuration = .6;
  private flashRemaining = 0;
  private coverage = 1;
  private vibrationAttempts = 0;
  private phoneVibrations = 0;
  private vibrationGeneration = 0;
  private immersed = false;
  private immersionTime = 0;
  private readonly activeActuators = new Set<SlimeVibrationActuator>();
  private readonly hits = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<SlimeKind, number>;
  private readonly bubbleNodes: HTMLSpanElement[] = [];
  readonly overlay: HTMLDivElement;
  readonly immersion: HTMLDivElement;
  readonly bubbles: HTMLDivElement;
  readonly flash: HTMLDivElement;

  constructor(host: HTMLElement, private readonly haptics = true, _timeOfDay: TimeOfDay = 'day') {
    this.overlay = document.createElement('div');
    this.overlay.className = 'slime-windshield';
    this.overlay.setAttribute('aria-hidden', 'true');
    Object.assign(this.overlay.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '8', opacity: '0',
      background: 'radial-gradient(ellipse at 52% 38%, rgba(140,255,70,.76) 0 8%, rgba(40,170,40,.48) 15%, transparent 42%), radial-gradient(ellipse at 18% 64%, rgba(80,230,45,.5), transparent 28%)',
      mixBlendMode: 'screen', transition: 'opacity 40ms linear',
    });
    this.immersion = document.createElement('div');
    this.immersion.className = 'slime-immersion';
    this.immersion.setAttribute('aria-hidden', 'true');
    Object.assign(this.immersion.style, { position: 'absolute', inset: '0', pointerEvents: 'none',
      zIndex: '7', opacity: '0', backgroundColor: new THREE.Color(COLOR.colossus).getStyle(),
      mixBlendMode: 'multiply', transition: 'opacity 90ms linear' });
    this.bubbles = document.createElement('div');
    this.bubbles.className = 'slime-bubbles';
    this.bubbles.setAttribute('aria-hidden', 'true');
    Object.assign(this.bubbles.style, { position: 'absolute', inset: '0', pointerEvents: 'none',
      overflow: 'hidden', zIndex: '8', opacity: '0', transition: 'opacity 90ms linear' });
    for (let i = 0; i < 18; i++) {
      const bubble = document.createElement('span');
      const size = 7 + i % 6 * 3;
      Object.assign(bubble.style, { position: 'absolute', width: `${size}px`, height: `${size}px`,
        borderRadius: '50%', border: `${i % 3 === 0 ? 2 : 1}px solid rgba(220,252,255,.82)`,
        background: 'radial-gradient(circle at 30% 24%, rgba(255,255,255,.72), rgba(95,205,255,.10) 38%, transparent 68%)',
        boxShadow: 'inset -2px -2px 4px rgba(19,101,181,.26), 0 0 5px rgba(188,245,255,.42)',
        opacity: '0', willChange: 'transform,opacity' });
      this.bubbles.append(bubble);
      this.bubbleNodes.push(bubble);
    }
    this.flash = document.createElement('div');
    this.flash.className = 'slime-burst-flash';
    this.flash.setAttribute('aria-hidden', 'true');
    Object.assign(this.flash.style, { position: 'absolute', inset: '0', pointerEvents: 'none',
      zIndex: '9', opacity: '0', background: 'radial-gradient(ellipse, #fff4d4, #ff3838)', mixBlendMode: 'screen' });
    host.append(this.immersion, this.bubbles, this.overlay, this.flash);
  }

  enterImmersion(): void {
    this.immersed = true;
    this.immersionTime = 0;
    this.immersion.style.opacity = '.55';
  }

  exitImmersion(): void {
    this.immersed = false;
    this.immersion.style.opacity = '0';
    this.bubbles.style.opacity = '0';
  }

  cancelImmersion(): void {
    this.immersed = false;
    this.immersion.style.opacity = this.bubbles.style.opacity = '0';
  }

  hit(kind: SlimeKind, coverage = 1): void {
    const heavy = kind === 'burst' || kind === 'colossus';
    this.duration = heavy ? 0.25 : 0.06;
    // The giant communicates its boundary with a splash at the membrane. Keep the promised
    // underwater view steady instead of stacking the old impact shake on top of that transition.
    this.remaining = kind === 'colossus' ? 0 : this.duration;
    this.elapsed = 0;
    this.coverage = leavesSplatter(kind) ? THREE.MathUtils.clamp(coverage, 0, 1) : 0;
    this.smearDuration = kind === 'popper' ? 1.2 : .6;
    this.smearRemaining = this.coverage > .001 ? this.smearDuration : 0;
    if (kind === 'burst') { this.flashRemaining = .2; this.flash.style.opacity = '.86'; }
    this.amplitude = kind === 'colossus' ? 0 : heavy ? 0.10 : 0.03;
    this.hits[kind]++;
    const smear = {
      popper: ['rgba(140,255,70,.76)', 'rgba(40,170,40,.48)'],
      slick: ['rgba(174,112,255,.88)', 'rgba(92,34,190,.62)'],
      burst: ['transparent', 'transparent'],
      boost: ['transparent', 'transparent'],
      colossus: ['rgba(52,157,255,.74)', 'rgba(16,73,210,.50)'],
    }[kind];
    this.overlay.style.background = `radial-gradient(ellipse at 52% 38%, ${smear[0]} 0 8%, `
      + `${smear[1]} 15%, transparent 42%), radial-gradient(ellipse at 18% 64%, `
      + `${smear[0]}, transparent 28%)`;
    this.overlay.style.opacity = String((heavy ? .92 : .72) * this.coverage);
    this.overlay.style.maskImage = 'none';
    this.overlay.style.webkitMaskImage = 'none';
    this.vibrate(kind);
  }

  nearbyImpact(strength: number): void {
    if (strength <= 0) return;
    const duration = 0.12;
    const amplitude = 0.018 * Math.min(1, strength);
    if (this.remaining > 0 && this.amplitude >= amplitude) return;
    this.duration = duration;
    this.remaining = duration;
    this.elapsed = 0;
    this.amplitude = amplitude;
  }

  update(dt: number, camera: THREE.Camera): void {
    const reducedMotion = prefersReducedMotion();
    if (this.immersed) {
      this.immersionTime += reducedMotion ? 0 : dt;
      this.immersion.style.opacity = '.55';
      this.bubbles.style.opacity = reducedMotion ? '.36' : '1';
      const motionTime = reducedMotion ? 0 : this.immersionTime;
      this.bubbleNodes.forEach((bubble, index) => {
        const cycle = (motionTime * (.22 + index % 4 * .018) + index * .137) % 1;
        const x = 50 + Math.sin(index * 2.13 + motionTime * .61) * (8 + index % 5 * 2.4);
        const y = 82 - cycle * 72;
        const wobble = Math.sin(motionTime * 2.1 + index) * 5;
        bubble.style.transform = `translate(calc(-50% + ${wobble}px),-50%) scale(${.58 + cycle * .72})`;
        bubble.style.left = `${x}%`;
        bubble.style.top = `${y}%`;
        bubble.style.opacity = String(Math.sin(Math.PI * cycle) * (.46 + index % 3 * .16));
      });
    } else {
      this.immersion.style.opacity = this.bubbles.style.opacity = '0';
      for (const bubble of this.bubbleNodes) bubble.style.opacity = '0';
    }
    this.flashRemaining = Math.max(0, this.flashRemaining - dt);
    this.flash.style.opacity = String(this.flashRemaining / .2 * .86);
    this.elapsed += dt;
    if (this.remaining > 0) {
      this.remaining = Math.max(0, this.remaining - dt);
      const fade = this.remaining / this.duration;
      camera.position.x += this.noise(this.elapsed * 31, 7.1) * this.amplitude * fade;
      camera.position.y += this.noise(this.elapsed * 27, 19.7) * this.amplitude * 0.45 * fade;
    }
    if (this.smearRemaining > 0) {
      this.smearRemaining = Math.max(0, this.smearRemaining - dt);
      const wipe = 1 - this.smearRemaining / this.smearDuration;
      this.overlay.style.opacity = String(Math.max(0, (1 - wipe) * 0.82 * this.coverage));
      // A growing transparent sector, pivoted below the windscreen, is the path of one wiper arm.
      // The six-degree feather keeps the blade edge from looking like a hard UI wipe.
      const sweep = wipe * 110;
      const mask = `conic-gradient(from 305deg at 50% 112%, transparent 0deg ${sweep.toFixed(1)}deg, `
        + `#000 ${(sweep + 6).toFixed(1)}deg 360deg)`;
      this.overlay.style.maskImage = mask;
      this.overlay.style.webkitMaskImage = mask;
    } else {
      this.overlay.style.opacity = '0';
    }
  }

  get stats(): SlimeStats['feedback'] {
    return {
      hits: { ...this.hits },
      cameraShake: this.remaining > 0,
      windshield: this.smearRemaining > 0,
      vibrationAttempts: this.vibrationAttempts,
      phoneVibrations: this.phoneVibrations,
      cameraShakeMs: Math.round(this.remaining * 1000),
      windshieldMs: Math.round(this.smearRemaining * 1000),
      windshieldCoverage: this.coverage,
      underwater: this.immersed,
      bubbles: this.immersed ? this.bubbleNodes.length : 0,
      // The base opacity only; how bright the world is gets applied by SlimeCaustics.prepare, and
      // the layer reports that final value as colossusCausticOpacity.
      causticOpacity: this.immersed ? causticBase() : 0,
      causticTime: this.immersionTime,
      boundarySplashes: 0,
    };
  }

  private noise(value: number, salt: number): number {
    const cell = Math.floor(value);
    const fraction = value - cell;
    const smooth = fraction * fraction * (3 - 2 * fraction);
    const sample = (at: number) => {
      const raw = Math.sin((at + salt) * 12.9898) * 43758.5453;
      return (raw - Math.floor(raw)) * 2 - 1;
    };
    return sample(cell) * (1 - smooth) + sample(cell + 1) * smooth;
  }

  private vibrate(kind: SlimeKind): void {
    if (!this.haptics || typeof navigator === 'undefined') return;
    this.stopVibration();
    this.vibratePhone(kind);
    if (!navigator.getGamepads) return;
    const generation = this.vibrationGeneration;
    const pulses = SLIME_HAPTICS[kind];
    try {
      for (const pad of navigator.getGamepads()) {
        const actuator = (pad as (Gamepad & { vibrationActuator?: SlimeVibrationActuator }) | null)
          ?.vibrationActuator;
        if (!actuator) continue;
        const play = ({ duration, magnitude }: (typeof pulses)[number]): Promise<unknown> => {
          if (generation !== this.vibrationGeneration) return Promise.resolve();
          this.vibrationAttempts++;
          return actuator.playEffect('dual-rumble', {
            duration, startDelay: 0, weakMagnitude: magnitude, strongMagnitude: magnitude * 0.72,
          });
        };
        this.activeActuators.add(actuator);
        let sequence: Promise<unknown> = play(pulses[0]!);
        for (const pulse of pulses.slice(1)) sequence = sequence.then(() => play(pulse));
        void sequence.catch(() => undefined).finally(() => {
          if (generation === this.vibrationGeneration) this.activeActuators.delete(actuator);
        });
      }
    } catch { /* capability detection is intentionally silent */ }
  }

  /**
   * Phones have no gamepad, so the hit reaches the hand through `navigator.vibrate`.
   * Reduced motion silences it like the shake; Safari has no such API and is skipped silently. A
   * new pattern replaces the previous one by specification, so nothing is cancelled first.
   */
  private vibratePhone(kind: SlimeKind): void {
    if (!phoneVibrationAllowed(navigator) || prefersReducedMotion()) return;
    try {
      if (navigator.vibrate(phoneVibrationPattern(kind))) this.phoneVibrations++;
    } catch { /* capability detection is intentionally silent */ }
  }

  private stopVibration(): void {
    this.vibrationGeneration++;
    for (const actuator of this.activeActuators) void actuator.reset?.().catch(() => undefined);
    this.activeActuators.clear();
  }

  dispose(): void {
    this.stopVibration();
    this.overlay.remove();
    this.immersion.remove();
    this.bubbles.remove();
    this.flash.remove();
  }
}

interface SlimeDriver {
  feedback: SlimeFeedback;
  model?: VehicleModel;
  transit: ColossusTransit | null;
  releaseY: number | null;
  landingUntil: number;
  settledFor: number;
  boostUntil: number;
  wetUntil: number;
  wetTrailClock: number;
  audible: Map<string, SlimeAudioTransit>;
}

/** One-track vertical slice. replaces the prototype spawn source with pipeline data. */
export class SlimeLayer {
  /** The same in-a-giant predicate the layer itself uses, reachable from a browser test so a spec can
   * ask the question the code asks instead of keeping its own copy of the giant's shape. */
  static readonly bodyInColossus = bodyInColossus;

  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  readonly colossusDebris: THREE.InstancedMesh;
  readonly colossusWheels: THREE.InstancedMesh;
  readonly colossusSeatBacks: THREE.InstancedMesh;
  readonly colossusSeatCushions: THREE.InstancedMesh;
  readonly colossusEyes: THREE.InstancedMesh;
  readonly colossusPupils: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly lives: LiveSlime[] = [];
  private readonly liveByKey = new Map<string, LiveSlime>();
  private readonly consumed = new Set<string>();
  private readonly tileSpawns = new Map<string, readonly TileSlimeSpawn[]>();
  private readonly splitSpawns: TileSlimeSpawn[] = [];
  private readonly freeIndices = Array.from({ length: MAX_STATIC_SLIMES },
    (_, i) => MAX_STATIC_SLIMES - 1 - i);
  private readonly byCollider = new Map<number, LiveSlime>();
  private readonly shrinking = new Map<LiveSlime, number>();
  /** Fireball, smoke and ground glow of every bomb. */
  readonly explosions: ExplosionEffects;
  private readonly falling: FallingSlime[] = [];
  private readonly fragments: { motion: SlimeBody; kind: SlimeKind; radius: number; born: number }[] = [];
  private fragmentBreakups = 0;
  readonly fragmentMesh: THREE.InstancedMesh;
  private bounceHits = 0;
  private splitEvents = 0;
  private splitChildren = 0;
  private bounceOnly = 0;
  private splitSerial = 0;
  private surfaceSplashCount = 0;
  private surfaceRippleError = 0;
  private surfaceSprayForward = 0;
  private fragmentLandings = 0;
  private readonly effects: SlimeEffects;
  private shaderTime: { value: number } | null = null;
  private clock = 0;
  private colossusContacts = 0;
  private colossusEntries = 0;
  private colossusExits = 0;
  private colossusFloatHeight = 0;
  private colossusForwardSpeed = 0;
  private colossusMinUpright = 1;
  private colossusDrop = 0;
  private colossusWetMarks = 0;
  private readonly drivers = new Map<Car, SlimeDriver>();
  private readonly defaultDriver: SlimeDriver;
  private boostEntries = 0;
  private boostSpeedGain = 0;
  private fallingClock = 0;
  private fallingSerial = 0;
  private landedSerial = 0;
  private readonly landedKeys = new WeakMap<TileSlimeSpawn, string>();
  private fallingLandings = 0;
  private fallingSurvivors = 0;
  private fallingRoadLandings = 0;
  private fallingOffroadLandings = 0;
  private fallingBounces = 0;
  private fallingExplosions = 0;
  private nearestFallingLanding = Infinity;
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly deformation = new THREE.Matrix4();
  private readonly deformationInverse = new THREE.Matrix4();
  private readonly hitAlign = new THREE.Quaternion();
  private readonly inverseRotation = new THREE.Quaternion();
  private readonly hitLocal = new THREE.Vector3();
  private readonly hitAxis = new THREE.Vector3(0, 0, 1);
  private surfaceCar: Car | null = null;
  private slimeLimit: number;
  private colossusLimit: number;
  private surfaceLimit: number;
  private fallingLimit: number;
  readonly caustics = new SlimeCaustics();
  private causticSweep = 0;
  readonly splatterGenerator = new SplatterRenderer();
  readonly groundSplatter: PersistentSplatter;
  private readonly burstSideGrace = new Map<Car, number>();
  private readonly slimeVelocityCaps = new Map<Car,
    { until: number; verticalUntil: number; progress: Progress }>();
  onHit: (key: string, scale: readonly number[], car?: Car, kind?: SlimeKind) => void = () => undefined;
  readonly querySurface = (_x: number, _z: number) => ({ slick: 0 });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly spline: Spline,
    host: HTMLElement,
    limits: Readonly<QualityLimits>,
    initialSpawns: readonly SlimeSpawn[] = prototypeSlimeSpawns(spline, limits.slimes),
    private readonly onSound: (kind: SlimeSound, strength: number, phase?: SlimeSoundPhase) => void = () => undefined,
    windshieldModel?: VehicleModel,
    private readonly timeOfDay: TimeOfDay = 'day',
  ) {
    this.slimeLimit = limits.slimes;
    this.colossusLimit = limits.colossi;
    this.surfaceLimit = limits.groundEffects;
    this.fallingLimit = limits.fallingSlimes;
    this.shaderTime = { value: 0 };
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      // Keep the depth buffer useful when a dense splash sits behind a slime. The giant's real
      // interior parts opt out of depth testing and render one pass later, so they remain visible
      // through the blue shell without making every hidden particle shade through every body.
      depthWrite: true,
      side: THREE.FrontSide,
      uniforms: { uSlimeTime: this.shaderTime },
      vertexShader: `
        uniform float uSlimeTime;
        attribute float slimeKind;
        attribute vec2 slimeHitDirection;
        attribute float slimeHitStrength;
        attribute float slimeHitAge;
        varying vec3 vSlimeColor;
        varying vec3 vWorldPosition;
        varying vec3 vViewNormal;
        varying vec3 vViewPosition;
        varying vec3 vLocalPosition;
        varying float vSlimeKind;
        void main() {
          float phase = dot(instanceMatrix[3].xyz, vec3(0.071, 0.113, 0.053));
          float slow = slimeKind > 3.5 ? 1.55 : 3.2;
          float roundedBody = 1.0 - step(3.5, slimeKind);
          float jelly = 0.0;
          if (roundedBody < 0.5) {
            jelly = sin(uSlimeTime * slow + position.y * 4.0 + position.x * 2.1 + phase) * 0.055;
            jelly += sin(uSlimeTime * slow * 0.63 + position.z * 5.2 - phase) * 0.025;
          }
          // Popper and burst bodies stay cohesive like a liquid drop under surface tension.
          // Their sphere does not bend into a crooked cartoon character.
          vec3 transformed = position + normal * jelly;
          if (slimeKind > 0.5 && slimeKind < 1.5 && slimeHitAge < 1.8) {
            vec2 radial = normalize(position.xz + vec2(0.0001));
            float contact = smoothstep(-0.18, 0.82, dot(radial, -slimeHitDirection));
            float envelope = slimeHitStrength * exp(-slimeHitAge * 2.4);
            float wobble = 0.72 + 0.28 * cos(slimeHitAge * 18.0);
            transformed -= normal * contact * envelope * wobble * 0.72;
            transformed += normal * (1.0 - contact) * envelope
              * sin(slimeHitAge * 18.5 + position.y * 3.0) * 0.24;
          }
          if (roundedBody > 0.5) {
            float base = smoothstep(0.10, -0.82, position.y);
            transformed.xz *= 1.0 + base * 0.24;
          }
          if (slimeKind > 3.5) {
            float base = smoothstep(0.15, -0.85, position.y);
            transformed.xz *= 1.0 + base * 0.22;

          }
          vec3 instanceScaleSquared = vec3(dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz),
            dot(instanceMatrix[1].xyz, instanceMatrix[1].xyz),
            dot(instanceMatrix[2].xyz, instanceMatrix[2].xyz));
          vec3 worldNormal = normalize(mat3(instanceMatrix)
            * (normal / max(instanceScaleSquared, vec3(0.0001))));
          vec4 worldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vSlimeColor = instanceColor;
          vWorldPosition = worldPosition.xyz;
          vec4 viewPosition = viewMatrix * worldPosition;
          vViewNormal = normalize(mat3(viewMatrix) * worldNormal);
          vViewPosition = viewPosition.xyz;
          vLocalPosition = transformed;
          vSlimeKind = slimeKind;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform float uSlimeTime;
        varying vec3 vSlimeColor;
        varying vec3 vWorldPosition;
        varying vec3 vViewNormal;
        varying vec3 vViewPosition;
        varying vec3 vLocalPosition;
        varying float vSlimeKind;

        void main() {
          vec3 viewNormal = normalize(vViewNormal);
          float fresnel = pow(1.0 - clamp(dot(viewNormal, normalize(-vViewPosition)), 0.0, 1.0), 2.4);
          float diffuse = 0.55 + 0.45 * max(dot(viewNormal,
            normalize(mat3(viewMatrix) * vec3(-0.35, 0.82, 0.44))), 0.0);

          float isSlick = step(0.5, vSlimeKind) * (1.0 - step(1.5, vSlimeKind));
          float isBurst = step(1.5, vSlimeKind) * (1.0 - step(2.5, vSlimeKind));
          float isBoost = step(2.5, vSlimeKind) * (1.0 - step(3.5, vSlimeKind));
          float isColossus = step(3.5, vSlimeKind);

          vec3 colour = vSlimeColor * diffuse;
          if (isSlick > 0.5) {
            // Purple jelly keeps its body colour through deformation. The old black-elastic
            // treatment lived here rather than in the palette, so changing instanceColor alone
            // silently left the rendered body black.
            colour = vSlimeColor * (0.72 + diffuse * 0.28);
            colour += vec3(0.42, 0.16, 0.72) * fresnel * 0.38;
          }

          float pulse = 0.5;
          if (isBurst > 0.5) {
            pulse += 0.5 * sin(uSlimeTime * 5.4 + dot(vLocalPosition, vec3(3.0)));
            float burstCore = (1.0 - fresnel) * (0.12 + pulse * 0.88);
            colour = vec3(0.006, 0.008, 0.012) * diffuse;
            colour += vec3(0.025, 0.030, 0.040) * burstCore * (0.18 + pulse * 0.20);
            colour += vec3(0.15, 0.17, 0.21) * fresnel * 0.72;
          }
          if (isBoost > 0.5) {
            float band = 0.5 + 0.5 * sin(vLocalPosition.z * 13.0 - uSlimeTime * 10.0);
            colour = mix(colour, vec3(1.45, 0.16, 0.018), 0.14 + band * 0.18);
            colour += vec3(1.0, 0.24, 0.025) * fresnel * 0.58;
          }
          vec3 rimColour = vec3(0.10, 0.72, 0.16);
          rimColour = mix(rimColour, vec3(0.72, 0.34, 1.0), isSlick);
          rimColour = mix(rimColour, vec3(0.15, 0.17, 0.21), isBurst);
          rimColour = mix(rimColour, vec3(1.0, 0.24, 0.025), isBoost);
          float rimStrength = mix(0.48 + isColossus * 0.22, 0.34, isSlick);
          colour += rimColour * fresnel * rimStrength;

          float opacity = ${SLIME_BODY_OPACITY.toFixed(2)};
          opacity = mix(opacity, 1.0, isSlick);
          opacity = mix(opacity, 0.78 + pulse * 0.08, isBurst);
          opacity = mix(opacity, 0.90, isBoost);
          opacity = mix(opacity, 0.32 + fresnel * 0.20, isColossus);
          gl_FragColor = vec4(colour, opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    // The denser outline keeps ordinary bodies round under rain lighting and gives the purple body
    // enough vertices for a local impact dent instead of a whole-object squash.
    const geometry = new THREE.SphereGeometry(1, 32, 24);
    const instanceCapacity = MAX_STATIC_SLIMES + MAX_FALLING_SLIMES;
    geometry.setAttribute('slimeKind', new THREE.InstancedBufferAttribute(new Float32Array(instanceCapacity), 1));
    geometry.setAttribute('slimeHitDirection',
      new THREE.InstancedBufferAttribute(new Float32Array(instanceCapacity * 2), 2));
    geometry.setAttribute('slimeHitStrength',
      new THREE.InstancedBufferAttribute(new Float32Array(instanceCapacity), 1));
    geometry.setAttribute('slimeHitAge',
      new THREE.InstancedBufferAttribute(new Float32Array(instanceCapacity).fill(99), 1));
    this.mesh = new THREE.InstancedMesh(geometry, this.material, instanceCapacity);
    this.mesh.name = 'slimes';
    this.mesh.renderOrder = 2;
    // Tile streaming changes every instance after Three has first computed this mesh's bounds.
    // InstancedMesh does not invalidate those bounds when setMatrixAt writes later matrices, so a
    // camera cut could cull a nearby slime using an empty or stale startup population. This stays
    // one draw either way; skip object-level culling for the continuously changing population.
    this.mesh.frustumCulled = false;
    // The whole population is one visible pass. Casting the same 200-instance mesh into the sun's
    // shadow map would silently turn the promised one draw into two; the soft translucent bodies
    // read from their contact with the road and the shader's rim instead.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = instanceCapacity;
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < instanceCapacity; i++) this.mesh.setMatrixAt(i, this.matrix);
    // Allocate the colour attribute before the first frame. Streamed tiles may arrive after the
    // renderer compiles this custom shader, and the shader always reads instanceColor.
    this.mesh.setColorAt(0, new THREE.Color(COLOR.popper));
    this.mesh.count = 0;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;

    const decorationCapacity = MAX_COLOSSI * COLOSSUS_PANELS_PER_BODY;
    this.colossusDebris = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.95, 0.16, 0.58),
      new THREE.MeshStandardMaterial({ color: 0x93e7ff, emissive: 0x174d72,
        roughness: 0.34, metalness: 0.56 }),
      decorationCapacity,
    );
    this.colossusDebris.name = 'colossus-floating-body-panels';
    this.colossusDebris.renderOrder = 1;
    this.colossusDebris.frustumCulled = false;
    this.colossusWheels = new THREE.InstancedMesh(
      new THREE.TorusGeometry(0.66, 0.25, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.82, metalness: 0.08 }),
      MAX_COLOSSI * COLOSSUS_WHEELS_PER_BODY,
    );
    this.colossusWheels.name = 'colossus-floating-car-wheels';
    this.colossusWheels.renderOrder = 1;
    this.colossusWheels.frustumCulled = false;
    const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x39424d, roughness: 0.74,
      metalness: 0.06 });
    this.colossusSeatBacks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.86, 1.18, 0.22),
      seatMaterial, MAX_COLOSSI * COLOSSUS_SEATS_PER_BODY);
    this.colossusSeatBacks.name = 'colossus-floating-car-seat-backs';
    this.colossusSeatBacks.renderOrder = 1;
    this.colossusSeatBacks.frustumCulled = false;
    this.colossusSeatCushions = new THREE.InstancedMesh(new THREE.BoxGeometry(0.86, 0.22, 0.72),
      seatMaterial.clone(), MAX_COLOSSI * COLOSSUS_SEATS_PER_BODY);
    this.colossusSeatCushions.name = 'colossus-floating-car-seat-cushions';
    this.colossusSeatCushions.renderOrder = 1;
    this.colossusSeatCushions.frustumCulled = false;
    const faceCapacity = instanceCapacity * 2;
    this.colossusEyes = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 16),
      new THREE.MeshBasicMaterial({ color: 0xf4f6dc, side: THREE.DoubleSide }), faceCapacity);
    this.colossusEyes.name = 'colossus-eyes';
    this.colossusEyes.renderOrder = 4;
    this.colossusEyes.frustumCulled = false;
    this.colossusPupils = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12),
      new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.DoubleSide }), faceCapacity);
    this.colossusPupils.name = 'slime-pupils';
    this.colossusPupils.renderOrder = 4;
    this.colossusPupils.frustumCulled = false;
    this.colossusPupils.count = 0;
    this.colossusDebris.count = this.colossusWheels.count = this.colossusSeatBacks.count
      = this.colossusSeatCushions.count = this.colossusEyes.count = 0;
    this.fragmentMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ roughness: .22, metalness: .08, transparent: true,
        opacity: SLIME_DROPLET_OPACITY, depthWrite: false }), 96);
    this.fragmentMesh.name = 'physical-slime-splashes';
    this.fragmentMesh.frustumCulled = false;
    this.fragmentMesh.count = 0;
    this.fragmentMesh.setColorAt(0, new THREE.Color(COLOR.popper));   // allocate before the first compile, like the puddles
    this.group.name = 'slime-actors';
    this.group.add(this.fragmentMesh);
    this.groundSplatter = new PersistentSplatter(physics);
    this.group.add(this.groundSplatter.group);
    this.effects = new SlimeEffects(limits, this.groundSplatter);
    this.explosions = new ExplosionEffects();
    this.defaultDriver = { feedback: new SlimeFeedback(host, true, this.timeOfDay), model: windshieldModel,
      transit: null, releaseY: null, landingUntil: 0, settledFor: 0, boostUntil: 0,
      wetUntil: 0, wetTrailClock: 0, audible: new Map() };
    this.group.add(this.mesh, this.colossusDebris, this.colossusWheels, this.colossusSeatBacks,
      this.colossusSeatCushions, this.colossusEyes, this.colossusPupils, this.effects.particles,
      this.effects.puddles, this.effects.wetMarks.root, this.explosions.group);
    this.scene.add(this.group);
    // New surfaces get their caustic variant before their first compile; the periodic sweep catches deeper adds.
    this.scene.addEventListener('childadded', this.patchAdded);
    this.groundSplatter.group.addEventListener('childadded', this.patchAdded);
    if (initialSpawns.length) {
      this.tileSpawns.set('__initial__', initialSpawns.map(({ kind, position, scale, yaw }) =>
        ({ kind, position: [...position], scale: [...scale], yaw })) as TileSlimeSpawn[]);
      this.syncPopulation();
    }
  }

  addTile(file: string, spawns: readonly TileSlimeSpawn[]): void {
    if (this.tileSpawns.has(file)) this.removeTile(file);
    this.tileSpawns.set(file, spawns);
    this.syncPopulation();
  }

  removeTile(file: string): void {
    this.tileSpawns.delete(file);
    for (const live of [...this.lives]) if (live.tile === file) this.retire(live, false);
    this.syncPopulation();
  }

  setLimits(limits: Readonly<QualityLimits>): void {
    this.effects.setLimits(limits);
    this.slimeLimit = limits.slimes;
    this.colossusLimit = limits.colossi;
    this.surfaceLimit = limits.groundEffects;
    this.fallingLimit = limits.fallingSlimes;
    while (this.fragments.length > this.fragmentLimit) removeSlimeBody(this.physics, this.fragments.shift()!.motion);
    while (this.falling.length > this.fallingLimit) this.removeFalling(this.falling[0]!);
    this.syncPopulation();
  }

  registerDriver(car: Car, host: HTMLElement, model: VehicleModel, haptics: boolean): void {
    const first = this.drivers.size === 0;
    const driver = first ? this.defaultDriver : { feedback: new SlimeFeedback(host, haptics, this.timeOfDay),
      model, transit: null, releaseY: null, landingUntil: 0, settledFor: 0, boostUntil: 0,
      wetUntil: 0, wetTrailClock: 0,
      audible: new Map() };
    if (first) {
      // Replace the legacy full-canvas feedback before the first rendered frame.
      driver.feedback.dispose();
      driver.feedback = new SlimeFeedback(host, haptics, this.timeOfDay);
      driver.model = model;
    }
    this.drivers.set(car, driver);
  }

  private driver(car: Car): SlimeDriver {
    if (!this.drivers.has(car)) this.drivers.set(car, this.drivers.size === 0 ? this.defaultDriver : {
      feedback: new SlimeFeedback(document.createElement('div'), false, this.timeOfDay),
      transit: null, releaseY: null, landingUntil: 0, settledFor: 0, boostUntil: 0,
      wetUntil: 0, wetTrailClock: 0,
      audible: new Map(),
    });
    return this.drivers.get(car)!;
  }

  /** Connect the car to the shared spatial index; the four wheel rays do the actual queries. */
  prepareCar(car: Car, trailer?: Car): void {
    this.surfaceCar ??= car;
    this.driver(car);
    const query = (x: number, z: number) => this.querySurface(x, z);
    car.setSurfaceQuery(query);
    trailer?.setSurfaceQuery(query);
  }

  /** Bound solver separation while a car is inside a physical slime interaction. */
  finishPhysicsStep(): void {
    for (const [car, driver] of this.drivers) {
      const transit = driver.transit;
      if (!transit || transit.ceiling === null || transit.revision !== car.poseRevision) continue;
      const over = car.position.y - transit.ceiling;
      if (over <= 0) continue;
      // One vertical correction for the connected assembly keeps the hitch intact. The ceiling
      // was sampled before this step: horizontal motion may still carry a car out through a side.
      for (const body of transit.bodies) {
        const p = body.position;
        this.physics.setBodyPosition(body.body, { x: p.x, y: p.y - over, z: p.z });
        const v = body.body.linvel();
        body.body.setLinvel({ x: v.x, y: Math.min(0, v.y), z: v.z }, true);
      }
    }
    for (const [body, cap] of this.slimeVelocityCaps) {
      if (this.clock <= cap.until) this.capSlimeVelocity(body, cap.progress,
        this.clock <= cap.verticalUntil);
      else this.slimeVelocityCaps.delete(body);
    }
  }

  private armVelocityCap(body: Car, seconds: number, verticalSeconds = seconds): void {
    const existing = this.slimeVelocityCaps.get(body);
    if (existing) {
      existing.until = Math.max(existing.until, this.clock + seconds);
      existing.verticalUntil = Math.max(existing.verticalUntil, this.clock + verticalSeconds);
      return;
    }
    const progress = new Progress(this.spline);
    progress.reacquire(body.position.x, body.position.z);
    this.slimeVelocityCaps.set(body,
      { until: this.clock + seconds, verticalUntil: this.clock + verticalSeconds, progress });
  }

  private capSlimeVelocity(body: Car, progress: Progress, capVertical = true): void {
    const velocity = body.body.linvel();
    const position = body.position;
    const road = progress.update(position.x, position.z);
    const tangent = this.spline.tangent(road.index), right = this.spline.right(road.index);
    const horizontal = Math.hypot(tangent[0], tangent[2]) || 1;
    const tx = tangent[0] / horizontal, tz = tangent[2] / horizontal;
    const rx = right[0], rz = right[2];
    let along = velocity.x * tx + velocity.z * tz;
    let lateral = THREE.MathUtils.clamp(velocity.x * rx + velocity.z * rz, -2, 2);
    const roadHalf = this.spline.halfWidth[road.index] ?? 6;
    // Mandatory elastic and burst hits may kick sideways, but must not carry a vehicle over the
    // reset boundary while it is airborne. Once it reaches the outer road, retain inward motion
    // and remove only the outward component; the launch and forward momentum remain visible.
    if (this.clock >= (this.burstSideGrace.get(body) ?? -Infinity)
      && Math.abs(road.lateral) > roadHalf * .6 && lateral * road.lateral > 0) lateral = 0;
    const planar = Math.hypot(along, lateral);
    if (planar > body.tuning.maxSpeed) {
      const scale = body.tuning.maxSpeed / planar;
      along *= scale; lateral *= scale;
    }
    body.body.setLinvel({ x: tx * along + rx * lateral,
      y: capVertical ? THREE.MathUtils.clamp(velocity.y, -2, 24) : velocity.y,
      z: tz * along + rz * lateral }, true);
    // A dynamic slime can overlap the chassis and make Rapier choose the downward separation side.
    // Keep this penetration correction for the whole contact envelope: unlike the one-second
    // downward-speed cap it does nothing to an airborne car, and only repairs a body below solid road.
    const surface = this.physics.surfaceAt(position.x, position.z, position.y + 2, position.y - 3);
    const floorY = surface ? surface.point.y + body.tuning.chassisHalf[1] + .02 : -Infinity;
    if (position.y < floorY) this.physics.setBodyPosition(body.body,
      { x: position.x, y: floorY, z: position.z });
  }

  /** A checkpoint teleport ends every velocity envelope owned by the contact it escaped. */
  resetCar(car: Car, trailer?: Car): void {
    this.slimeVelocityCaps.delete(car);
    this.burstSideGrace.delete(car);
    if (trailer) this.slimeVelocityCaps.delete(trailer);
    const driver = this.drivers.get(car);
    if (driver) {
      driver.transit = null;
      driver.releaseY = null;
      driver.wetUntil = 0;
      driver.feedback.cancelImmersion();
    }
  }

  /** Active physical bodies only; giants remain a mandatory passage rather than an avoidance target. */
  navigationTargets(car: Car): SlimeTarget[] {
    const p = car.position;
    const targets: SlimeTarget[] = [];
    for (const live of this.lives) {
      const spawn = live.spawn;
      if (!live.active || spawn.scenery || spawn.kind === 'colossus'
        || Math.hypot(spawn.position[0] - p.x, spawn.position[2] - p.z) > 120) continue;
      const at = projectOnSample(this.spline, this.spline.indexAt(spawn.s), spawn.position[0], spawn.position[2]);
      const radius = Math.max(spawn.scale[0], spawn.scale[2]);
      targets.push({ driver: `slime:${live.key}`, kind: spawn.kind, s: at.s, lateral: at.lateral,
        halfWidth: radius, halfLength: radius, speed: 0 });
    }
    return targets;
  }

  /** Sweep the actual vehicle hulls toward cohesive purple bodies; sensors and giants are not walls. */
  distanceToHazard(car: Car, distance: number, trailer?: Car): number | null {
    let nearest = Infinity;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(car.quaternion);
    for (const body of trailer ? [car, trailer] : [car]) {
      const hit = this.physics.world.castShape(body.collider.translation(), body.collider.rotation(),
        direction, body.collider.shape, 0, distance, false, undefined, undefined,
        body.collider, body.body, collider => {
          const live = this.byCollider.get(collider.handle);
          return live?.active === true
            && (live.spawn.kind === 'slick' || live.spawn.kind === 'burst');
        });
      if (hit) nearest = Math.min(nearest, hit.time_of_impact);
    }
    return Number.isFinite(nearest) ? nearest : null;
  }

  handleCar(car: Car, input: CarInput = { throttle: 0, brake: 0, steer: 0 }, trailer?: Car): void {
    const driver = this.driver(car);
    const bodies = trailer ? [car, trailer] : [car];
    this.updateAudible(driver, car, bodies);
    this.updateColossusTransit(car, this.physics.timestep, input, bodies);
    this.updateWetTrail(driver, car);
    if (this.clock < driver.boostUntil) this.effects.emitBoostTrail(car.position, car.forward,
      car.tuning.chassisHalf[2] + .24, car.tuning.chassisHalf[0]);
    const contacts = new Map<LiveSlime, { body: Car; event: CarCollision }[]>();
    for (const body of bodies) for (const event of body.collisions) {
      const live = this.byCollider.get(event.other);
      if (!live?.active || live.spawn.kind === 'colossus') continue;
      if (event.started) this.beginAudible(driver, car, live);
      if (live.spawn.kind === 'slick' && event.started) {
        // Elastic contact resolution can keep adding separation speed while the two hulls overlap.
        // Keep the envelope alive long enough for the lighter slime to leave the vehicle body.
        this.armVelocityCap(body, 1);
        const velocity = body.body.linvel();
        const direction = new THREE.Vector3(velocity.x, 0, velocity.z);
        if (direction.lengthSq() < 1e-5) direction.copy(body.forward);
        const contactDirection = new THREE.Vector3(-event.normal.x, -event.normal.y, -event.normal.z).setY(0);
        if (contactDirection.lengthSq() < 1e-5) contactDirection.copy(direction);
        const strength = THREE.MathUtils.clamp(event.closingSpeed / 16, .04, 1);
        live.elasticHit = { direction: contactDirection.normalize(), strength, at: this.clock };
        if (!live.pendingSplit) live.pendingSplit = { velocity: direction, at: this.clock + .48 };
      }
      if (live.spawn.kind === 'burst') {
        if (event.started) {
          const centre = new THREE.Vector3(...live.spawn.position);
          const axis = body.forward.clone().setY(0).normalize();
          const velocity = body.body.linvel();
          const stepped = (velocity.x * axis.x + velocity.z * axis.z) * this.physics.timestep;
          live.burstApproach.set(body, {
            axis, distance: burstSignedDistance(centre, body.position, axis) - stepped,
          });
        } else live.burstApproach.delete(body);
        continue;
      }
      if (!event.started) {
        if (live.spawn.kind === 'slick') this.endAudible(driver, live.key);
        continue;
      }
      const touched = contacts.get(live) ?? [];
      if (!touched.some(contact => contact.body === body)) touched.push({ body, event });
      contacts.set(live, touched);
    }
    for (const live of this.lives) {
      if (!live.active || live.spawn.kind !== 'burst') continue;
      const centre = new THREE.Vector3(...live.spawn.position);
      const aligned = bodies.filter(body => {
        const approach = live.burstApproach.get(body);
        if (!approach) return false;
        const now = burstSignedDistance(centre, body.position, approach.axis);
        const crossed = burstCrossedCentre(approach.distance, now);
        approach.distance = now;
        return crossed;
      });
      if (aligned.length) contacts.set(live, aligned.map(body => ({ body, event: {
        kind: 'slime-burst', started: true, other: live.collider!.handle,
        point: { x: centre.x, y: centre.y, z: centre.z },
        normal: centre.clone().sub(body.position).normalize(), closingSpeed: body.speed,
      } })));
    }
    for (const [live, touched] of contacts) {
      const position = new THREE.Vector3(...live.spawn.position);
      if (live.spawn.kind === 'slick') {
        if (this.clock - live.lastLaunch < .35) continue;
        // Both shells already participated in Rapier's elastic contact. Adding a second launch
        // impulse here would create energy and let the car pass through the dormant sensor.
        live.lastLaunch = this.clock;
        // A race scores each key once; the smallest splitter survives its hits, so each hit is its own key.
        const smallest = isSmallestSplitter(live.spawn.scale);
        this.onHit(smallest ? `${live.key}#${++live.hits}` : live.key, live.spawn.scale, car, live.spawn.kind);
        this.bounceHits++;
        this.onSound('slick', this.soundStrength(live.spawn), 'impact');
        driver.feedback.hit('slick', 0);
        continue;
      }
      this.onHit(live.key, live.spawn.scale, car, live.spawn.kind);
      const at = this.spline.indexAt(live.spawn.s);
      const roadNormal = new THREE.Vector3(...this.spline.normal(at));
      const groundPoint = new THREE.Vector3(live.spawn.position[0],
        live.spawn.position[1] - live.spawn.scale[1], live.spawn.position[2]);
      const strongest = touched.reduce((best, contact) =>
        contact.event.closingSpeed > best.event.closingSpeed ? contact : best, touched[0]!);
      const rawVelocity = strongest.body.body.linvel();
      const velocity = collisionSplashVelocity(strongest.event,
        new THREE.Vector3(rawVelocity.x, rawVelocity.y, rawVelocity.z));
      const effectScale = Math.cbrt(live.spawn.scale[0] * live.spawn.scale[1] * live.spawn.scale[2]);
      if (live.spawn.kind === 'burst') {
        this.detonateBurst(live.spawn, touched.map(({ body }) => ({ body,
          // One consumed blob has one impulse budget, even when connected shells touch it.
          share: body.tuning.ramMultiplier / touched.length })), groundPoint, roadNormal,
        new THREE.Vector3(velocity.x, velocity.y, velocity.z), [car], new THREE.Vector3(rawVelocity.x, rawVelocity.y, rawVelocity.z), bodies);
        this.retire(live, true, true);
        continue;
      }
      this.effects.emit(live.spawn.kind, position, groundPoint, roadNormal,
        0, new THREE.Vector3(velocity.x, velocity.y, velocity.z), effectScale, new THREE.Vector3(rawVelocity.x, rawVelocity.y, rawVelocity.z));
      driver.feedback.hit(live.spawn.kind, this.splashCoverage(car, live.spawn));
      if (driver.model && leavesSplatter(live.spawn.kind)) {
        const local = position.clone().sub(car.position).applyQuaternion(car.quaternion.invert());
        driver.model.splashBody(local, car.speed, new THREE.Color(COLOR[live.spawn.kind]), Math.max(...live.spawn.scale)*1.4);
      }
      this.emitFragments(live.spawn.kind, position, live.spawn.scale,
        new THREE.Vector3(velocity.x, velocity.y, velocity.z));
      if (live.spawn.kind === 'boost') {
        this.boostEntries++;
        driver.boostUntil = this.clock + .6;
        const speedGain = 4 + effectScale * 2;
        for (const { body } of touched) {
          const forward = body.forward.clone().setY(0).normalize();
          const impulse = body.tuning.mass * speedGain;
          body.body.applyImpulse({ x: forward.x * impulse, y: 0, z: forward.z * impulse }, true);
        }
        this.boostSpeedGain = Math.max(this.boostSpeedGain, speedGain);
        this.effects.emitBoostTrail(car.position, car.forward,
          car.tuning.chassisHalf[2] + .24, car.tuning.chassisHalf[0]);
      }
      this.retire(live, true, true);
    }
  }

  /** The one explosion model shared by centre-crossing hits and black airdrop landings. */
  private detonateBurst(spawn: SlimeSpawn, targets: readonly { body: Car; share: number }[],
    groundPoint: THREE.Vector3, groundNormal: THREE.Vector3, impactVelocity: THREE.Vector3,
    feedbackCars: readonly Car[], groundVelocity = impactVelocity, coupledBodies?: readonly Car[]): void {
    const centre = new THREE.Vector3(...spawn.position);
    let impulses = targets.map(({ body, share }) => {
      const massCentre = this.physics.toWorld(body.body.worldCom());
      return { body, impulse: burstImpulse(spawn.scale, centre,
        new THREE.Vector3(massCentre.x, massCentre.y, massCentre.z), share) };
    });
    if (coupledBodies && coupledBodies.length > 1) {
      // A rear-only blast must lift the connected rig, rather than pivot the trailer over its
      // grounded hitch. Preserve the contact's total impulse and give both masses the same delta-v.
      const total = impulses.reduce((sum, hit) => sum.add(hit.impulse), new THREE.Vector3());
      const mass = coupledBodies.reduce((sum, body) => sum + body.body.mass(), 0);
      impulses = coupledBodies.map(body => ({ body,
        impulse: total.clone().multiplyScalar(body.body.mass() / mass) }));
    }
    for (const { body, impulse } of impulses) {
      body.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
      // Solver separation follows handleCar, so the same envelope applies to both sources.
      this.burstSideGrace.set(body, this.clock + .35);
      this.armVelocityCap(body, 4, 1);
      this.capSlimeVelocity(body, this.slimeVelocityCaps.get(body)!.progress);
    }
    const effectScale = Math.cbrt(spawn.scale[0] * spawn.scale[1] * spawn.scale[2]);
    this.effects.emit('burst', centre, groundPoint, groundNormal, 0, impactVelocity, effectScale, groundVelocity);
    this.explosions.spawn(centre, groundPoint, effectScale);
    // No black coat on the car, no black on the windscreen and no black debris: the flash,
    // the shake and the launch are the whole hit. What stays behind is a burn: soot on the
    // road where it went off, and a matte soot patch on the paint nearest the blast.
    const radius = Math.max(...spawn.scale);
    this.effects.scorch(groundPoint, groundNormal, radius);
    for (const car of new Set(feedbackCars)) {
      const driver = this.driver(car);
      driver.feedback.hit('burst', 0);
      driver.model?.scorchBody(centre.clone().sub(car.position).applyQuaternion(car.quaternion.clone().invert()), radius * 1.6);
    }
    this.onSound('burst', this.soundStrength(spawn), 'impact');
  }

  private soundStrength(spawn: SlimeSpawn): number {
    const radius = Math.cbrt(spawn.scale[0] * spawn.scale[1] * spawn.scale[2]);
    return spawn.kind === 'colossus'
      ? THREE.MathUtils.clamp(.58 + radius / 48, .58, 1)
      : THREE.MathUtils.clamp(.26 + radius / 5.4, .28, 1);
  }

  private beginAudible(driver: SlimeDriver, car: Car, live: LiveSlime): void {
    if (driver.audible.has(live.key)) return;
    const transit: SlimeAudioTransit = {
      live,
      kind: live.spawn.kind,
      centre: new THREE.Vector3(...live.spawn.position),
      scale: [...live.spawn.scale],
      yaw: live.spawn.yaw,
      enteredAt: this.clock,
      strength: this.soundStrength(live.spawn),
      revision: car.poseRevision,
    };
    driver.audible.set(live.key, transit);
    this.onSound(transit.kind, transit.strength, 'enter');
  }

  private updateAudible(driver: SlimeDriver, car: Car, bodies: readonly Car[]): void {
    for (const [key, transit] of driver.audible) {
      if (transit.revision !== car.poseRevision) {
        driver.audible.delete(key);
        continue;
      }
      // The elastic body moves under physics. Its collision end event owns the true separation.
      if (transit.kind === 'slick') {
        if (!transit.live.active) driver.audible.delete(key);
        continue;
      }
      if (this.clock - transit.enteredAt < .08) continue;
      const c = Math.cos(transit.yaw);
      const s = Math.sin(transit.yaw);
      const inside = bodies.some(body => {
        const dx = body.position.x - transit.centre.x;
        const dz = body.position.z - transit.centre.z;
        const localX = c * dx - s * dz;
        const localZ = s * dx + c * dz;
        const extent = Math.hypot(body.tuning.chassisHalf[0], body.tuning.chassisHalf[2]) * .72;
        const vertical = body.tuning.chassisHalf[1] * .82;
        return (localX / (transit.scale[0] + extent)) ** 2
          + ((body.position.y - transit.centre.y) / (transit.scale[1] + vertical)) ** 2
          + (localZ / (transit.scale[2] + extent)) ** 2 <= 1;
      });
      if (inside) continue;
      this.endAudible(driver, key);
    }
  }

  private endAudible(driver: SlimeDriver, key: string): void {
    const transit = driver.audible.get(key);
    if (!transit) return;
    this.onSound(transit.kind, transit.strength, 'exit');
    driver.audible.delete(key);
  }

  private get fragmentLimit(): number {
    return Math.min(96, Math.max(24, Math.floor(this.surfaceLimit * 2.4)));
  }

  private emitFragments(kind: SlimeKind, position: THREE.Vector3, scale: readonly number[],
    velocity: THREE.Vector3): void {
    const limit = this.fragmentLimit;
    const radius = Math.cbrt(scale[0]! * scale[1]! * scale[2]!);
    const seed = kind === 'popper' ? ++this.fragmentBreakups : 0;
    for (let i = 0; i < 8; i++) {
      if (this.fragments.length >= limit) removeSlimeBody(this.physics, this.fragments.shift()!.motion);
      const piece = kind === 'popper' ? pieceVariation(seed, i) : { size: 1, speed: 1, yaw: 0 };
      const angle = i * 2.399963 + this.clock;
      const size = radius * (.14 + .035 * (i % 3)) * piece.size;
      const start = position.clone().add(new THREE.Vector3(Math.cos(angle), .2, Math.sin(angle))
        .multiplyScalar(radius * .35));
      const motion = createSlimeBody(this.physics, start, [size, size, size], 'debris');
      const v = yawed(directionalSplashVelocity(velocity, i, Math.max(1, radius * 1.4)), piece.yaw).multiplyScalar(piece.speed);
      motion.body.applyImpulse(v.multiplyScalar(motion.body.mass()), true);
      this.fragments.push({ motion, kind, radius: size, born: this.clock });
    }
  }

  private splitSlime(live: LiveSlime): void {
    const pending = live.pendingSplit;
    if (!pending || !live.active) return;
    if (isSmallestSplitter(live.spawn.scale)) {
      // Bounced by the contact itself; it stays on the road to be hit again.
      live.pendingSplit = null;
      this.bounceOnly++;
      return;
    }
    const parentPosition = new THREE.Vector3(...live.spawn.position);
    const parentScale = [...live.spawn.scale] as [number, number, number];
    const groundY = parentPosition.y - parentScale[1];
    const carried = live.motion?.body.linvel();
    const baseVelocity = carried
      ? new THREE.Vector3(carried.x, carried.y, carried.z) : new THREE.Vector3();
    const direction = pending.velocity.clone().setY(0);
    if (direction.lengthSq() < 1e-5) direction.set(0, 0, -1);
    const impactSpeed = direction.length();
    direction.normalize();
    const side = new THREE.Vector3(-direction.z, 0, direction.x);
    live.pendingSplit = null;
    this.retire(live, true);
    this.splitEvents++;

    const count = 2 + (this.splitSerial++ % 2);
    // Children differ in size by about 10 % while together keeping the 86 % of the parent's
    // volume the split always kept, so a split never grows or loses slime.
    const seed = this.splitSerial * 7919 + 13;
    const pieces = Array.from({ length: count }, (_, i) => pieceVariation(seed, i));
    const volume = pieces.reduce((sum, piece) => sum + piece.size ** 3, 0);
    // Speeds stay relative to each other (small ones faster) but are rescaled so the children carry
    // the parent's momentum exactly, as the split always has.
    const momentum = pieces.reduce((sum, piece) => sum + piece.size ** 3 * piece.speed, 0);
    for (const piece of pieces) piece.speed *= volume / momentum;
    const keys: string[] = [];
    for (let i = 0; i < count; i++) {
      const scaleFactor = Math.cbrt(.86 * pieces[i]!.size ** 3 / volume);
      const scale = parentScale.map(value => value * scaleFactor) as [number, number, number];
      const lateral = (i - (count - 1) / 2) * scale[0] * 1.15;
      const position = parentPosition.clone().addScaledVector(direction, scale[2] * .35)
        .addScaledVector(side, lateral);
      position.y = Math.max(position.y, groundY + scale[1]);
      const spawn: TileSlimeSpawn = { kind: 'slick', position: position.toArray() as [number, number, number],
        scale, yaw: live.spawn.yaw };
      const key = `split:${this.splitSerial}:${i}:${this.clock.toFixed(4)}`;
      this.landedKeys.set(spawn, key);
      this.splitSpawns.push(spawn);
      keys.push(key);
    }
    if (!this.tileSpawns.has('__split__')) this.tileSpawns.set('__split__', this.splitSpawns);
    this.syncPopulation();
    keys.forEach((key, i) => {
      const child = this.liveByKey.get(key);
      if (!child?.motion) return;
      const lateral = (i - (count - 1) / 2) * 1.7;
      const velocity = baseVelocity.clone().multiplyScalar(1 / .86);
      if (velocity.dot(direction) < .5) velocity.copy(direction).multiplyScalar(Math.min(10, impactSpeed * .62));
      velocity.addScaledVector(side, lateral);
      // Along the hit, as before, but each ball at its own pace: the smaller, the faster.
      velocity.multiplyScalar(pieces[i]!.speed);
      child.motion.body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
    });
    this.splitChildren += count;
  }

  private updateFragments(): void {
    let at = 0;
    for (const item of [...this.fragments]) {
      const contact = slimeContact(this.physics, item.motion);
      if (contact || this.clock - item.born > 6) {
        if (contact) {
          if (leavesSplatter(item.kind)) this.effects.splat(item.kind, contact.point, contact.normal, item.radius * 3.5);
          this.fragmentLandings++;
        }
        removeSlimeBody(this.physics, item.motion);
        this.fragments.splice(this.fragments.indexOf(item), 1);
        continue;
      }
      const p = this.physics.bodyPosition(item.motion.body);
      this.matrix.compose(this.position.set(p.x, p.y, p.z),
        this.rotation.copy(item.motion.body.rotation()), this.scale.setScalar(item.radius));
      this.fragmentMesh.setMatrixAt(at, this.matrix);
      this.fragmentMesh.setColorAt(at++, new THREE.Color(COLOR[item.kind]));
    }
    this.fragmentMesh.count = at;
    this.fragmentMesh.instanceMatrix.needsUpdate = true;
    if (this.fragmentMesh.instanceColor) this.fragmentMesh.instanceColor.needsUpdate = true;
  }

  private splashCoverage(car: Car, spawn: SlimeSpawn): number {
    const model = this.driver(car).model;
    if (!model) return 1; // Legacy physics-only fixtures have no glazing asset.
    if (spawn.kind === 'colossus') return 1;
    const local = new THREE.Vector3(...spawn.position).sub(car.position)
      .applyQuaternion(car.quaternion.invert());
    return model.splashCoverage(local, 1.4);
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.shaderTime) this.shaderTime.value = this.clock;
    for (const live of [...this.lives]) {
      if (live.pendingSplit && this.clock >= live.pendingSplit.at) this.splitSlime(live);
    }
    for (const [live, elapsed] of [...this.shrinking]) {
      const next = elapsed + dt;
      if (next >= 0.1) {
        this.retire(live, true);
      } else {
        this.shrinking.set(live, next);
        this.writeInstance(live, 1 - next / 0.1);
        this.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const live of this.lives) {
      if (live.motion) {
        const p = this.physics.bodyPosition(live.motion.body);
        live.spawn.position = [p.x, p.y, p.z];
      }
      this.writeInstance(live);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    this.updateFragments();
    this.effects.update(dt);
    this.explosions.update(dt);
    this.updateFalling(dt);
    this.updateSlimeDecorations();
  }

  updateCamera(dt: number, camera: THREE.Camera, car?: Car): void {
    (car ? this.driver(car) : this.defaultDriver).feedback.update(dt, camera);
  }

  transferRenderer(previous: THREE.WebGLRenderer, next: THREE.WebGLRenderer): void {
    this.groundSplatter.transferRenderer(previous, next);
    for (const driver of this.drivers.values()) driver.model?.bodyCoat.transferRenderer(previous, next);
  }

  /** Compile-time preparation for the loading screen: caustic variants of every surface and the caustic pass itself. */
  prepareGpu(renderer: THREE.WebGLRenderer): void {
    this.caustics.attach(this.scene);
    this.caustics.render(renderer, this.scene, this.clock);
    this.groundSplatter.prepareGpu(renderer, this.splatterGenerator);
  }

  private readonly patchAdded = (event: { child: THREE.Object3D }) => this.caustics.attach(event.child);

  renderEffects(renderer: THREE.WebGLRenderer): void {
    // Streamed tiles bring new materials; patch them while they are still far ahead.
    if (++this.causticSweep % 30 === 0) this.caustics.attach(this.scene);
    this.groundSplatter.render(renderer, this.splatterGenerator);
    for (const driver of this.drivers.values()) driver.model?.bodyCoat.render(renderer, this.splatterGenerator);
    if ([...this.drivers.values()].some(driver => driver.transit)) this.caustics.render(renderer, this.scene, this.clock);
  }

  /** Live giants nearest a point, as drawn this frame (outline, or spawn before the first draw). */
  nearestColossi(point: THREE.Vector3, count = 4): SlimeSpawn[] {
    const giants: SlimeSpawn[] = [];
    for (const live of this.liveByKey.values())
      if (live.active && live.spawn.kind === 'colossus') giants.push(live.outline ?? live.spawn);
    const distance = (g: SlimeSpawn) => (g.position[0] - point.x) ** 2 + (g.position[1] - point.y) ** 2 + (g.position[2] - point.z) ** 2;
    return giants.sort((a, b) => distance(a) - distance(b)).slice(0, count);
  }

  /**
   * Each viewport gets only its own giant volume. `strengthScale` is how bright the world is (task
   * 448: `Sky.daylight`), so the ripple fades with dusk and weather instead of glowing the same at
   * midnight in the rain as at noon.
   */
  prepareView(car: Car, strengthScale = 1): void {
    const transit = this.driver(car).transit;
    const live = transit?.live;
    const body = live ? live.outline ?? live.spawn : null;
    // The ripple
    // follows the body the player can see, not the transit state. Transit deliberately lets go late --
    // it leaves at 1.12 of the ellipsoid so a car riding the edge does not flicker in and out of
    // buoyancy (143) -- and the ripple inherited that hysteresis, so the road stayed lit for about
    // three metres after the car was out in the open. Buoyancy, thrust and sound keep their margin.
    // The whole rig counts, not the tow: a pickup's trailer is six metres behind it and a giant holds
    // the rig to about 7 m/s, so asking only about the car went dark for most of a second while the
    // screen was still green and the trailer still submerged.
    const rig = transit?.bodies?.length ? transit.bodies : [car];
    const lit = body && rig.some(part => bodyInColossus(body, part, 1));
    this.caustics.prepare(lit ? body : null, strengthScale);
  }

  driverStats(car: Car) {
    const driver = this.driver(car);
    return { colossusTransit: driver.transit !== null, boostActive: this.clock < driver.boostUntil,
      wetTrail: this.clock < driver.wetUntil, feedback: driver.feedback.stats };
  }

  get stats(): SlimeStats {
    const byKind = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<SlimeKind, number>;
    for (const live of this.lives) if (live.active) byKind[live.spawn.kind]++;
    const feedback = this.defaultDriver.feedback.stats;
    return {
      spawned: Math.min([...this.tileSpawns.values()].reduce((sum, items) => sum + items.length, 0),
        this.slimeLimit),
      active: this.lives.filter((live) => live.active).length,
      byKind,
      colossi: byKind.colossus,
      colossusContacts: this.colossusContacts,
      colossusTransit: this.defaultDriver.transit !== null,
      colossusEntries: this.colossusEntries,
      colossusExits: this.colossusExits,
      colossusFloatHeight: this.colossusFloatHeight,
      colossusForwardSpeed: this.colossusForwardSpeed,
      colossusMinUpright: this.colossusMinUpright,
      colossusDrop: this.colossusDrop,
      colossusBubbles: feedback.bubbles,
      // What the shader is actually multiplying by right now, daylight included -- not a second
      // guess at it.
      colossusCausticOpacity: feedback.underwater ? this.caustics.opacity : 0,
      colossusCausticSurfaces: this.caustics.surfaces,
      colossusSplashes: this.surfaceSplashCount,
      colossusWetMarks: this.colossusWetMarks,
      colossusRippleSurfaceError: this.surfaceRippleError,
      colossusSprayForward: this.surfaceSprayForward,
      boostActive: this.clock < this.defaultDriver.boostUntil,
      boostEntries: this.boostEntries,
      boostSpeedGain: this.boostSpeedGain,
      groundEffects: 0,
      particles: this.effects.liveParticles,
      bounceHits: this.bounceHits, splitEvents: this.splitEvents, splitChildren: this.splitChildren, smallestBounces: this.bounceOnly,
      physicalFragments: this.fragments.length,
      elasticDeforming: this.lives.filter(live => live.active && live.elasticHit !== null
        && this.clock - live.elasticHit.at < 2.2).length,
      elasticPeak: this.lives.reduce((peak, live) => Math.max(peak,
        live.elasticHit ? live.elasticHit.strength : 0), 0),
      fragmentLandings: this.fragmentLandings,
      puddles: this.effects.livePuddles,
      falling: this.falling.length,
      fallingLandings: this.fallingLandings,
      fallingSurvivors: this.fallingSurvivors,
      fallingRoadLandings: this.fallingRoadLandings,
      fallingOffroadLandings: this.fallingOffroadLandings,
      fallingBounces: this.fallingBounces,
      fallingExplosions: this.fallingExplosions,
      nearestFallingLanding: Number.isFinite(this.nearestFallingLanding)
        ? this.nearestFallingLanding : null,
      feedback,
    };
  }

  get surfaceKind(): string { return this.surfaceCar?.surfaceState.kind ?? 'dry'; }


  private writeInstance(live: LiveSlime, factor?: number): void {
    const { position, scale, yaw } = live.spawn;
    const elapsed = this.shrinking.get(live);
    const size = factor ?? (elapsed === undefined ? 1 : Math.max(0, 1 - elapsed / 0.1));
    const life = slimeLife(this.hash(live.key), this.clock);
    if (live.motion) this.rotation.copy(live.motion.body.rotation());
    else this.rotation.setFromAxisAngle(this.up, yaw);
    this.rotation.multiply(new THREE.Quaternion().setFromAxisAngle(this.up, life.yaw));
    this.position.set(...position);
    this.position.y += scale[1] * (life.breath - 1) * slimeGroundFraction(live.spawn.kind);
    this.matrix.compose(this.position, this.rotation,
      this.scale.set(scale[0] * size, scale[1] * size * life.breath, scale[2] * size));
    const hitDirection = this.mesh.geometry.getAttribute('slimeHitDirection') as THREE.InstancedBufferAttribute;
    const hitStrength = this.mesh.geometry.getAttribute('slimeHitStrength') as THREE.InstancedBufferAttribute;
    const hitAge = this.mesh.geometry.getAttribute('slimeHitAge') as THREE.InstancedBufferAttribute;
    hitDirection.setXY(live.index, 0, 1);
    hitStrength.setX(live.index, 0);
    hitAge.setX(live.index, 99);
    if (live.elasticHit) {
      const age = this.clock - live.elasticHit.at;
      if (age < 2.2) {
        const shape = elasticDeformation(live.elasticHit.strength, age);
        this.hitLocal.copy(live.elasticHit.direction)
          .applyQuaternion(this.inverseRotation.copy(this.rotation).invert()).setY(0);
        if (this.hitLocal.lengthSq() < 1e-5) this.hitLocal.copy(this.hitAxis);
        this.hitAlign.setFromUnitVectors(this.hitAxis, this.hitLocal.normalize());
        this.deformation.makeRotationFromQuaternion(this.hitAlign)
          .scale(this.scale.set(shape.across, shape.across, shape.along));
        this.deformationInverse.makeRotationFromQuaternion(this.hitAlign.clone().invert());
        this.deformation.multiply(this.deformationInverse);
        this.matrix.multiply(this.deformation);
        hitDirection.setXY(live.index, this.hitLocal.x, this.hitLocal.z);
        hitStrength.setX(live.index, live.elasticHit.strength);
        hitAge.setX(live.index, age);
      }
    }
    if (live.spawn.kind === 'colossus') {
      // Column lengths are the sphere's half-extents as drawn (spawn scale, breath); the skirt the
      // vertex shader flares makes the widest ring COLOSSUS_WIDEST times that. The caustic covers it.
      const e = this.matrix.elements;
      live.outline = { kind: live.spawn.kind, s: live.spawn.s, position: [e[12]!, e[13]!, e[14]!],
        scale: [Math.hypot(e[0]!, e[1]!, e[2]!) * COLOSSUS_WIDEST, Math.hypot(e[4]!, e[5]!, e[6]!),
          Math.hypot(e[8]!, e[9]!, e[10]!) * COLOSSUS_WIDEST],
        yaw: Math.atan2(-e[2]!, e[0]!) };
    }
    this.mesh.setMatrixAt(live.index, this.matrix);
    (this.mesh.geometry.getAttribute('slimeKind') as THREE.InstancedBufferAttribute)
      .setX(live.index, KINDS.indexOf(live.spawn.kind));
    hitDirection.needsUpdate = hitStrength.needsUpdate = hitAge.needsUpdate = true;
  }

  private createPhysics(live: LiveSlime): void {
    const { kind, position, scale, yaw } = live.spawn;
    // Only the giant remains a geometric transit volume; ordinary live bodies are collision encounters.
    if (kind === 'colossus') return;
    if (kind === 'slick') {
      live.motion = createSlimeBody(this.physics, new THREE.Vector3(...position), scale, 'elastic', yaw);
      live.collider = live.motion.collider;
      this.byCollider.set(live.collider.handle, live);
      return;
    }
    const half = yaw / 2;
    const desc = slimeHull(this.physics, scale)
      .setTranslation(position[0], position[1], position[2])
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
      .setSensor(true);
    // Consumable bodies use sensors; cohesive black bodies were created above as solid hulls.
    const collider = this.physics.createCollider(desc);
    this.physics.registerCollider(collider, kind === 'burst' ? 'slime-burst' : 'slime-popper');
    live.collider = collider;
    this.byCollider.set(collider.handle, live);
  }

  private retire(live: LiveSlime, consumed: boolean, animate = false): void {
    live.active = false;
    if (live.collider) {
      this.byCollider.delete(live.collider.handle);
      this.physics.unregisterCollider(live.collider);
      if (live.motion) this.physics.world.removeRigidBody(live.motion.body);
      else this.physics.world.removeCollider(live.collider, true);
    }
    live.motion = null;
    live.collider = null;
    this.liveByKey.delete(live.key);
    if (consumed && live.tile === '__split__') {
      const splitIndex = this.splitSpawns.findIndex(spawn => this.landedKeys.get(spawn) === live.key);
      if (splitIndex >= 0) this.splitSpawns.splice(splitIndex, 1);
    } else if (consumed) this.consumed.add(live.key);
    if (animate) {
      this.shrinking.set(live, 0);
      return;
    }
    this.shrinking.delete(live);
    this.matrix.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(live.index, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    const at = this.lives.indexOf(live);
    if (at >= 0) this.lives.splice(at, 1);
    this.freeIndices.push(live.index);
    this.refreshMeshCount();
  }

  private nearestS(position: readonly number[]): number {
    let best = 0;
    let distance = Infinity;
    for (let i = 0; i < this.spline.count; i++) {
      const p = this.spline.point(i);
      const d = (p[0] - position[0]!) ** 2 + (p[2] - position[2]!) ** 2;
      if (d < distance) { best = i; distance = d; }
    }
    return this.spline.s[best] ?? 0;
  }

  private selectPopulation(
    wanted: readonly { key: string; tile: string; spawn: TileSlimeSpawn }[],
  ): { key: string; tile: string; spawn: TileSlimeSpawn }[] {
    const selected: { key: string; tile: string; spawn: TileSlimeSpawn }[] = [];
    let colossi = 0;
    // Map and spawn arrays retain insertion order. Walking newest-first makes every cap recycle its
    // oldest member while preserving the per-quality colossus ceiling.
    for (let i = wanted.length - 1; i >= 0 && selected.length < this.slimeLimit; i--) {
      const item = wanted[i]!;
      if (item.spawn.kind === 'colossus' && colossi >= this.colossusLimit) continue;
      selected.push(item);
      if (item.spawn.kind === 'colossus') colossi++;
    }
    return selected.reverse();
  }

  private compactInstances(): void {
    const vacated = this.lives.reduce((highest, live) => Math.max(highest, live.index + 1), 0);
    for (let i = 0; i < this.lives.length; i++) {
      this.lives[i]!.index = i;
      this.writeInstance(this.lives[i]!);
      this.mesh.setColorAt(i, new THREE.Color(COLOR[this.lives[i]!.spawn.kind]));
    }
    // Slots the move left behind still hold their old matrix. They are drawn whenever a sky slime
    // is falling, because its slot sits above them, as bodiless slimes, so empty them.
    this.matrix.makeScale(0, 0, 0);
    for (let i = this.lives.length; i < vacated; i++) this.mesh.setMatrixAt(i, this.matrix);
    this.freeIndices.splice(0, this.freeIndices.length,
      ...Array.from({ length: MAX_STATIC_SLIMES - this.lives.length },
        (_, i) => MAX_STATIC_SLIMES - 1 - i));
    this.refreshMeshCount();
    (this.mesh.geometry.getAttribute('slimeKind') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  private syncPopulation(): void {
    const wanted: { key: string; tile: string; spawn: TileSlimeSpawn }[] = [];
    for (const [tile, spawns] of this.tileSpawns) {
      for (let i = 0; i < spawns.length; i++) wanted.push({ key: this.landedKeys.get(spawns[i]!) ?? `${tile}:${i}`, tile, spawn: spawns[i]! });
    }
    wanted.sort((a, b) => Number(!!b.spawn.scenery) - Number(!!a.spawn.scenery));
    const selected = this.selectPopulation(wanted.filter(item => !this.consumed.has(item.key)));
    const keys = new Set(selected.map((item) => item.key));
    for (const live of [...this.lives]) {
      if (!keys.has(live.key) && !this.shrinking.has(live)) this.retire(live, false);
    }
    for (const item of selected) {
      if (this.liveByKey.has(item.key) || this.consumed.has(item.key)) continue;
      const index = this.freeIndices.pop();
      if (index === undefined) break;
      const spawn: SlimeSpawn = { ...item.spawn, s: this.nearestS(item.spawn.position),
        position: [...item.spawn.position] as [number, number, number],
        scale: [...item.spawn.scale] as [number, number, number] };
      const live: LiveSlime = { key: item.key, tile: item.tile, spawn, index, active: true,
        collider: null, motion: null, lastLaunch: -Infinity, burstApproach: new Map(),
        elasticHit: null, pendingSplit: null, hits: 0 };
      this.lives.push(live);
      this.liveByKey.set(item.key, live);
      this.writeInstance(live);
      this.mesh.setColorAt(index, new THREE.Color(COLOR[spawn.kind]));
      this.createPhysics(live);
    }
    this.compactInstances();
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.geometry.getAttribute('slimeKind') as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.updateSlimeDecorations();
  }

  private updateFalling(dt: number): void {
    const car = this.surfaceCar;
    if (!car) return;
    this.fallingClock -= dt;
    if (this.fallingClock <= 0 && this.falling.length < this.fallingLimit) {
      const drivers = [...this.drivers.keys()];
      this.spawnFalling(drivers[this.fallingSerial % drivers.length] ?? car);
      // A falling blob is an occasional source cue, never the visible population. Quality changes
      // pool capacity, not how hard it rains.
      this.fallingClock = (FALLING_INTERVAL_SECONDS + (this.fallingSerial % 5) * 1.7) / 1.2;
    }
    for (const falling of [...this.falling]) {
      falling.elapsed += dt;
      const airborne = this.physics.bodyPosition(falling.motion.body);
      const fallingVelocity = falling.motion.body.linvel();
      const unsafe = [...this.drivers.keys()].some(car => {
      const carVelocity = car.body.linvel();
      const lookAhead = .35;
      const dx = airborne.x + fallingVelocity.x * lookAhead - car.position.x - carVelocity.x * lookAhead;
      const dz = airborne.z + fallingVelocity.z * lookAhead - car.position.z - carVelocity.z * lookAhead;
      const bottom = airborne.y + fallingVelocity.y * lookAhead
        + this.physics.world.gravity.y * lookAhead * lookAhead * .5 - falling.scale[1];
      const safe = Math.max(FALLING_SAFE_RADIUS,
        Math.max(falling.scale[0], falling.scale[2]) + Math.hypot(car.tuning.chassisHalf[0], car.tuning.chassisHalf[2]) + 1);
      return bottom < car.position.y + 3 && Math.hypot(dx, dz) < safe;
      });
      if (unsafe) {
        // Cancel an incidental background fall before contact; never steer or teleport its physics trajectory.
        this.removeFalling(falling);
        continue;
      }
      const rawContact = slimeContact(this.physics, falling.motion);
      // A bomb can brush a wall or guardrail while it is still falling. Only an upward-facing
      // ground contact is its landing; side contact must not turn the wall into an early fuse.
      const contact = falling.kind === 'burst' && rawContact
        && (rawContact.role !== 'ground' || rawContact.normal.y < .35) ? null : rawContact;
      if (contact) {
        falling.landing.copy(contact.point);
        falling.normal.copy(contact.normal);
        if (!falling.touching) {
          this.fallingBounces++;
          falling.bounces++;
          if (!falling.contacted) this.beginFallingLanding(falling, car);
          if (falling.kind === 'burst') {
            this.explodeFalling(falling);
            continue;
          }
          if (falling.bounces === 3 && falling.kind !== 'slick') {
            falling.motion.collider.setRestitution(.08);
            falling.motion.collider.setFriction(.92);
            falling.motion.body.setLinearDamping(1.2);
            falling.motion.body.setAngularDamping(3);
          }
        }
        falling.contacted = falling.touching = true;
        const velocity = falling.motion.body.linvel();
        const angular = falling.motion.body.angvel();
        const quiet = Math.hypot(velocity.x, velocity.y, velocity.z) < .48
          && Math.hypot(angular.x, angular.y, angular.z) < .65;
        falling.settledFrames = quiet ? falling.settledFrames + 1 : 0;
        if (falling.settledFrames >= 12) {
          this.settleFalling(falling);
          continue;
        }
      } else {
        falling.touching = false;
        falling.settledFrames = 0;
      }
      if (falling.contacted && falling.motion.body.isSleeping()) {
        this.settleFalling(falling);
        continue;
      }
      if (falling.elapsed > 10 && !falling.contacted) {
        this.removeFalling(falling);
        continue;
      }
      const p = this.physics.bodyPosition(falling.motion.body);
      this.position.set(p.x, p.y, p.z);
      const life = slimeLife(this.hash(`falling:${falling.slot}:${falling.start.x}`), this.clock);
      this.rotation.copy(falling.motion.body.rotation())
        .multiply(new THREE.Quaternion().setFromAxisAngle(this.up, life.yaw));
      this.matrix.compose(this.position, this.rotation,
        this.scale.set(falling.scale[0], falling.scale[1] * life.breath, falling.scale[2]));
      this.mesh.setMatrixAt(FALLING_INSTANCE_START + falling.slot, this.matrix);
      falling.trailClock += dt;
      if (falling.trailClock >= 0.06) {
        falling.trailClock %= 0.06;
        this.effects.emitTrail(falling.kind, this.position);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.refreshMeshCount();
  }

  private spawnFalling(car: Car): void {
    const serial = ++this.fallingSerial;
    const used = new Set(this.falling.map((item) => item.slot));
    const slot = Array.from({ length: this.fallingLimit }, (_, i) => i).find((i) => !used.has(i));
    if (slot === undefined) return;
    const carPosition = car.position;
    const carS = this.nearestS([carPosition.x, carPosition.y, carPosition.z]);
    const carForward = car.forward.clone().setY(0);
    if (carForward.lengthSq() < 0.5) carForward.set(...this.spline.tangent(this.spline.indexAt(carS)));
    carForward.setY(0).normalize();
    const road = serial % 8 === 0;
    let landing: THREE.Vector3 | null = null;
    let normal: THREE.Vector3 | null = null;
    let right: THREE.Vector3 | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const ahead = 35 + (this.hash(`fall-ahead:${serial}:${attempt}`) % 56);
      const at = this.spline.indexAt(carS + ahead);
      const p = this.spline.point(at);
      const r = this.spline.right(at);
      const candidateRight = new THREE.Vector3(...r);
      const side = (serial + attempt) % 2 === 0 ? 1 : -1;
      const width = this.spline.halfWidth[at] ?? 6;
      const offset = road
        ? side * width * (0.18 + (this.hash(`fall-road:${serial}:${attempt}`) % 40) / 100)
        : side * (width + 4 + (this.hash(`fall-offroad:${serial}:${attempt}`) % 13));
      const x = p[0] + r[0] * offset;
      const z = p[2] + r[2] * offset;
      const surface = this.physics.surfaceAt(x, z);
      if (!surface) continue;
      const candidate = new THREE.Vector3(surface.point.x, surface.point.y, surface.point.z);
      const toward = candidate.clone().sub(carPosition).setY(0);
      if (toward.lengthSq() < 1 || toward.normalize().dot(carForward) < 0.2) continue;
      const candidateNormal = new THREE.Vector3(surface.normal.x, surface.normal.y, surface.normal.z)
        .normalize();
      if (candidateNormal.y < 0.35) continue;
      landing = candidate;
      normal = candidateNormal;
      right = candidateRight;
      break;
    }
    if (!landing || !normal || !right) return;
    const height = 22 + serial % 7;
    const fraction = this.hash(`fall-size:${serial}`) / 0x100000000;
    const radius = 3.6 + fraction * .9;
    const kind: FallingSlime['kind'] = serial % 6 === 0 ? 'burst' : serial % 3 === 0 ? 'slick' : 'popper';
    const scale = kind === 'slick' ? slimeScale('slick', fraction) : roundSlimeScale(radius);
    const flight = Math.sqrt(2 * (height - scale[1]) / Math.abs(this.physics.world.gravity.y || -19.6));
    const velocity = car.body.linvel();
    const predicted = carPosition.clone().add(new THREE.Vector3(velocity.x, 0, velocity.z)
      .multiplyScalar(flight));
    this.keepPointClear(landing, right, predicted, serial % 2 === 0 ? 1 : -1);
    const start = landing.clone().setY(landing.y + height);
    const motion = createSlimeBody(this.physics, start, scale, kind === 'slick' ? 'elastic' : 'settling');
    // Initial velocity and gravity determine the flight; there is no per-frame position animation.
    motion.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const falling: FallingSlime = { motion, scale, slot, kind, elapsed: 0, duration: flight,
      height, start, landing, normal, right, road, contacted: false, touching: false,
      bounces: 0, settledFrames: 0, trailClock: 0 };
    this.falling.push(falling);
    this.mesh.setColorAt(FALLING_INSTANCE_START + slot, new THREE.Color(COLOR[kind]));
    const slimeKind = this.mesh.geometry.getAttribute('slimeKind') as THREE.InstancedBufferAttribute;
    slimeKind.setX(FALLING_INSTANCE_START + slot, KINDS.indexOf(kind));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    (this.mesh.geometry.getAttribute('slimeKind') as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.refreshMeshCount();
  }

  private keepPointClear(point: THREE.Vector3, right: THREE.Vector3, carPosition: THREE.Vector3,
    side: number): void {
    const dx = point.x - carPosition.x;
    const dz = point.z - carPosition.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= FALLING_SAFE_RADIUS) return;
    const awayX = distance > 1e-5 ? dx / distance : right.x * side;
    const awayZ = distance > 1e-5 ? dz / distance : right.z * side;
    point.x = carPosition.x + awayX * (FALLING_SAFE_RADIUS + 0.5);
    point.z = carPosition.z + awayZ * (FALLING_SAFE_RADIUS + 0.5);
  }

  private beginFallingLanding(falling: FallingSlime, car: Car): void {
    const dx = car.position.x - falling.landing.x;
    const dz = car.position.z - falling.landing.z;
    const distance = Math.hypot(dx, dz);
    this.nearestFallingLanding = Math.min(this.nearestFallingLanding, distance);
    this.fallingLandings++;
    if (falling.road) this.fallingRoadLandings++;
    else this.fallingOffroadLandings++;
    for (const car of this.drivers.keys()) {
    const dx = car.position.x - falling.landing.x, dz = car.position.z - falling.landing.z;
    const distance = Math.hypot(dx, dz);
    const audible = Math.max(0, 1 - distance / 45);
    if (audible > 0) this.onSound('fall', audible);
    if (distance < 12) {
      const strength = Math.max(0, Math.min(1, (12 - distance) / (12 - FALLING_SAFE_RADIUS)));
      const planar = new THREE.Vector3(dx, 0, dz).normalize();
      const impulse = car.tuning.mass * 0.12 * strength;
      car.body.applyImpulse({ x: planar.x * impulse, y: 0, z: planar.z * impulse }, true);
      this.driver(car).feedback.nearbyImpact(strength);
    }
    }
  }

  private explodeFalling(falling: FallingSlime): void {
    const p = this.physics.bodyPosition(falling.motion.body);
    const centre = new THREE.Vector3(p.x, p.y, p.z);
    const velocity = falling.motion.body.linvel();
    const radius = Math.max(...falling.scale) * 3;
    const targets: { body: Car; share: number }[] = [];
    for (const car of this.drivers.keys()) {
      const distance = car.position.distanceTo(centre);
      if (distance >= radius) continue;
      targets.push({ body: car, share: THREE.MathUtils.clamp(1 - distance / radius, 0, .45) });
    }
    const spawn: SlimeSpawn = { kind: 'burst', s: this.nearestS([centre.x, centre.y, centre.z]),
      position: [centre.x, centre.y, centre.z], scale: falling.scale, yaw: 0 };
    this.detonateBurst(spawn, targets, falling.landing, falling.normal,
      new THREE.Vector3(velocity.x, velocity.y, velocity.z), targets.map(target => target.body));
    this.fallingExplosions++;
    this.removeFalling(falling);
  }

  private settleFalling(falling: FallingSlime): void {
    this.fallingSurvivors++;
    falling.motion.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    falling.motion.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.spawnLandedSlime(falling);
    this.removeFalling(falling);
  }

  private spawnLandedSlime(falling: FallingSlime): void {
    const scale = falling.scale;
    const spawn: TileSlimeSpawn = { kind: falling.kind,
      position: [falling.landing.x, falling.landing.y + scale[1], falling.landing.z],
      scale: [...scale], yaw: 0 };
    this.landedKeys.set(spawn, `landed:${++this.landedSerial}`);
    const prior = this.tileSpawns.get('__falling__') ?? [];
    this.tileSpawns.set('__falling__', [...prior.slice(-31), spawn]);
    this.syncPopulation();
    const live = this.lives.find(item => item.tile === '__falling__'
      && item.spawn.position[0] === spawn.position[0] && item.spawn.position[2] === spawn.position[2]);
    if (live?.motion) {
      this.physics.setBodyPosition(live.motion.body, this.physics.bodyPosition(falling.motion.body));
      live.motion.body.setLinvel(falling.motion.body.linvel(), true);
      live.motion.body.setAngvel(falling.motion.body.angvel(), true);
      live.motion.body.setRotation(falling.motion.body.rotation(), true);
    }
  }

  private removeFalling(falling: FallingSlime): void {
    removeSlimeBody(this.physics, falling.motion);
    this.matrix.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(FALLING_INSTANCE_START + falling.slot, this.matrix);
    const at = this.falling.indexOf(falling);
    if (at >= 0) this.falling.splice(at, 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.refreshMeshCount();
  }

  private refreshMeshCount(): void {
    let highest = this.lives.reduce((value, item) => Math.max(value, item.index + 1), 0);
    for (const falling of this.falling) {
      highest = Math.max(highest, FALLING_INSTANCE_START + falling.slot + 1);
    }
    this.mesh.count = highest;
  }

  dispose(): void {
    for (const live of [...this.lives]) this.retire(live, false);
    for (const falling of [...this.falling]) this.removeFalling(falling);
    for (const fragment of this.fragments) removeSlimeBody(this.physics, fragment.motion);
    this.fragments.length = 0;
    this.scene.remove(this.group);
    this.group.clear();
    this.fragmentMesh.geometry.dispose();
    (this.fragmentMesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    for (const mesh of [this.colossusDebris, this.colossusWheels, this.colossusSeatBacks,
      this.colossusSeatCushions, this.colossusEyes, this.colossusPupils]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.effects.dispose();
    this.explosions.dispose();
    this.groundSplatter.dispose();
    this.scene.removeEventListener('childadded', this.patchAdded);
    this.groundSplatter.group.removeEventListener('childadded', this.patchAdded);
    this.caustics.dispose();
    this.splatterGenerator.dispose();
    for (const driver of new Set([this.defaultDriver, ...this.drivers.values()])) driver.feedback.dispose();
    this.drivers.clear();
    this.slimeVelocityCaps.clear();
    this.burstSideGrace.clear();
    this.byCollider.clear();
    this.shrinking.clear();
    this.liveByKey.clear();
    this.tileSpawns.clear();
    this.consumed.clear();
  }

  private emitSurfaceExit(spawn: SlimeSpawn, car: Car): void {
    const velocity = car.body.linvel();
    const travel = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
    if (travel.lengthSq() < 1e-4) travel.copy(car.forward).multiplyScalar(Math.max(4, car.speed));
    const forward = travel.clone().setY(0);
    if (forward.lengthSq() < 1e-4) forward.copy(car.forward).setY(0);
    forward.normalize();
    const nose = car.position.clone().addScaledVector(forward, car.tuning.chassisHalf[2]);
    const surface = colossusSurfacePoint(spawn, nose);
    // The splash stays on the real membrane; the expanding ripple rings were removed.
    this.surfaceRippleError = Math.max(this.surfaceRippleError, surface.error);
    this.effects.emit('colossus', surface.point, surface.point, surface.normal, 0, travel, 3.6);
    this.surfaceSplashCount++;
    const first = directionalSplashVelocity(travel, 0, 3.6).setY(0);
    this.surfaceSprayForward = forward.dot(first.normalize());
  }

  /** The liquid steadies pitch and roll both inside and during the brief wet landing. */
  private levelSlimeBody(body: Car, wanted: THREE.Quaternion): void {
    const error = wanted.clone().multiply(body.quaternion.invert());
    if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w);
    const angular = body.body.angvel(), mass = body.tuning.mass;
    body.body.addTorque({ x: (error.x * 40 - angular.x * 6) * mass,
      y: (error.y * 20 - angular.y * 5) * mass,
      z: (error.z * 40 - angular.z * 6) * mass }, true);
  }

  private updateColossusTransit(car: Car, dt: number, input: CarInput, bodies: readonly Car[]): void {
    const driver = this.driver(car);
    const carPosition = car.position;
    if (driver.transit && driver.transit.revision !== car.poseRevision) {
      driver.transit = null; driver.releaseY = null; driver.feedback.cancelImmersion();
    }
    if (driver.releaseY !== null && !driver.transit) {
      this.colossusDrop = Math.max(this.colossusDrop, driver.releaseY - carPosition.y);
      if (this.clock < driver.landingUntil) {
        const settled = bodies.every(body => body.grounded && body.upright > .9
          && Math.abs(body.body.linvel().y) < 1);
        driver.settledFor = settled ? driver.settledFor + dt : 0;
        if (driver.settledFor >= .5) driver.landingUntil = 0;
        else for (const body of bodies) {
          const velocity = body.body.linvel();
          if (velocity.y < -8) body.body.addForce({x:0,
            y:(-8 - velocity.y) * 10 * body.tuning.mass, z:0}, true);
          const yaw = Math.atan2(-body.forward.x, -body.forward.z);
          this.levelSlimeBody(body, new THREE.Quaternion().setFromAxisAngle(this.up, yaw));
        }
      }
    }

    const inside = (live: LiveSlime, margin: number): boolean =>
      bodies.some(body => bodyInColossus(live.spawn, body, margin));
    const mobility = THREE.MathUtils.clamp(Math.sqrt(
      bodies.reduce((mass, body) => mass + body.tuning.mass, 0) / 1250), .8, 1.6);

    if (driver.transit && (!driver.transit.live.active || !inside(driver.transit.live, 1.12))) {
      this.emitSurfaceExit(driver.transit.live.spawn, car);
      this.colossusExits++;
      driver.releaseY = carPosition.y;
      // Out of the slime the buoyancy is gone at once: no upward momentum carries the rig higher (368).
      for (const body of bodies) {
        const velocity = body.body.linvel();
        if (velocity.y > 0) body.body.setLinvel({ x: velocity.x, y: 0, z: velocity.z }, true);
      }
      driver.landingUntil = this.clock + 8; driver.settledFor = 0;
      this.onSound('colossus', this.soundStrength(driver.transit.live.spawn), 'exit');
      driver.feedback.exitImmersion();
      driver.wetUntil = this.clock + 4.5;
      driver.wetTrailClock = this.clock;
      driver.transit = null;
    }
    if (!driver.transit) {
      const live = this.lives.find((item) => item.active && item.spawn.kind === 'colossus'
        && inside(item, 1));
      if (!live) return;
      const velocity = car.body.linvel();
      const forward = new THREE.Vector3(velocity.x, 0, velocity.z);
      if (forward.lengthSq() < 4) forward.copy(car.forward).setY(0);
      forward.normalize();
      const entrySpeed = Math.hypot(velocity.x, velocity.z);
      driver.transit = { live, elapsed: 0, gurgleClock: 0,
        groundY: live.spawn.position[1] - live.spawn.scale[1] * slimeGroundFraction('colossus'), forward,
        speed: entrySpeed, limit: colossusSpeedLimit(entrySpeed, mobility),
        revision: car.poseRevision, bodyOffsets: bodies.map(body => body.position.y - carPosition.y),
        bodies, ceiling: null };
      this.onHit(live.key, live.spawn.scale, car, live.spawn.kind);
      this.colossusContacts++;
      this.colossusEntries++;
      driver.releaseY = null;
      driver.feedback.hit('colossus', this.splashCoverage(car, live.spawn));
      driver.feedback.enterImmersion();
      this.onSound('colossus', this.soundStrength(live.spawn), 'enter');
    }

    const transit = driver.transit;
    if (!transit) return;
    transit.elapsed += dt;
    transit.gurgleClock -= dt;
    if (transit.gurgleClock <= 0) {
      this.onSound('gurgle', 0.42 + Math.min(transit.elapsed / 3, 0.35));
      transit.gurgleClock = 0.58;
    }

    let roof = Infinity;
    bodies.forEach((body, index) => {
      const ceiling = colossusCeiling(transit.live.spawn, body.position);
      if (ceiling === null) return;
      const half = body.tuning.chassisHalf;
      const rotation = new THREE.Matrix4().makeRotationFromQuaternion(body.quaternion).elements;
      const top = Math.abs(rotation[1]!) * half[0] + Math.abs(rotation[5]!) * half[1]
        + Math.abs(rotation[9]!) * half[2];
      roof = Math.min(roof, ceiling - top - .12 - transit.bodyOffsets[index]!);
    });
    // A falling roof caused by forward travel is the side of the dome, not a command to drag a
    // floating car down. Stop adding height there and let horizontal travel release it naturally.
    transit.ceiling = Number.isFinite(roof) ? Math.max(carPosition.y, roof) : null;
    // Rise at one acceleration for every rig, easing so it stops exactly at the float height (or
    // under the membrane of a low dome); a car already above that height is held, not dragged down.
    const floatY = Math.min(transit.groundY + COLOSSUS_FLOAT_HEIGHT, Number.isFinite(roof) ? roof : Infinity);
    const gap = floatY - carPosition.y;
    const ascent = gap > 0
      ? Math.min(Math.max(0, car.body.linvel().y) + COLOSSUS_LIFT * dt, Math.sqrt(2 * COLOSSUS_LIFT * gap)) : 0;
    // The tyres are clear of the road, so the slime itself turns the driver's steer/throttle/brake
    // into fluid thrust. Neutral keeps the entry vector while the glue bleeds speed; inputs bend
    // or change it continuously instead of the body snapping to the route's authored direction.
    transit.forward.applyAxisAngle(this.up, -THREE.MathUtils.clamp(input.steer, -1, 1) * dt * 0.78);
    // The giant is sticky: it bleeds off what the car carried in above its viscous limit, and
    // throttle only pushes back up to that limit, never past the arrival speed.
    if (transit.speed > transit.limit) {
      transit.speed = transit.limit + (transit.speed - transit.limit) * Math.exp(-dt * COLOSSUS_VISCOSITY);
    } else {
      transit.speed = Math.min(transit.limit,
        transit.speed + THREE.MathUtils.clamp(input.throttle, 0, 1) * COLOSSUS_THRUST * dt);
    }
    transit.speed = Math.max(COLOSSUS_CRAWL,
      transit.speed - THREE.MathUtils.clamp(input.brake, 0, 1) * 7.5 * dt);
    const wantedYaw = Math.atan2(-transit.forward.x, -transit.forward.z);
    const wanted = new THREE.Quaternion().setFromAxisAngle(this.up, wantedYaw);
    // A connected rig floats as one assembly. Forces and torques leave the joint solver in
    // charge; rotating either shell directly would move its hitch out from under the other.
    bodies.forEach((body, index) => {
      const velocity = body.body.linvel();
      const desiredY = ascent + (carPosition.y + transit.bodyOffsets[index]! - body.position.y) * 2.7;
      const mass = body.tuning.mass;
      const acceleration = (target: number, actual: number, gain: number) =>
        (target - actual) * (1 - Math.exp(-dt * gain)) / dt;
      // Vertical speed is set outright each step, so the climb is the same for a pod and a bus.
      body.body.addForce({ x: acceleration(transit.forward.x * transit.speed, velocity.x, 4.2) * mass,
        y: ((desiredY - velocity.y) / dt - this.physics.world.gravity.y) * mass,
        z: acceleration(transit.forward.z * transit.speed, velocity.z, 4.2) * mass }, true);
      this.levelSlimeBody(body, wanted);
    });

    this.colossusFloatHeight = Math.max(this.colossusFloatHeight, carPosition.y - transit.groundY);
    this.colossusForwardSpeed = Math.max(this.colossusForwardSpeed,
      car.forwardSpeed);
    if (transit.elapsed >= 0.3) {
      this.colossusMinUpright = Math.min(this.colossusMinUpright,
        ...bodies.map(body => body.upright));
    }
  }

  private updateWetTrail(driver: SlimeDriver, car: Car): void {
    if (this.clock >= driver.wetUntil || this.clock < driver.wetTrailClock || car.speed < 1.1) return;
    driver.wetTrailClock = this.clock + .09;
    const wheels = car.wheels.length >= 4 ? car.wheels.slice(-2) : car.wheels;
    for (const wheel of wheels) {
      if (!wheel.grounded) continue;
      this.effects.wetMark(wheel.contact, car.forward, car.tuning.wheelRadius * .48,
        THREE.MathUtils.clamp(car.speed * .105, .42, 1.5));
      this.colossusWetMarks++;
    }
  }

  private updateSlimeDecorations(): void {
    const faces = this.lives.filter((live) => live.active)
      .slice(0, MAX_STATIC_SLIMES + MAX_FALLING_SLIMES);
    let debrisAt = 0;
    let wheelAt = 0;
    let seatAt = 0;
    let faceAt = 0;
    const local = new THREE.Vector3();
    const world = new THREE.Vector3();
    const size = new THREE.Vector3();
    const spin = new THREE.Quaternion();
    for (const live of faces) {
      const centre = new THREE.Vector3(...live.spawn.position);
      const life = slimeLife(this.hash(live.key), this.clock);
      centre.y += live.spawn.scale[1] * (life.breath - 1) * slimeGroundFraction(live.spawn.kind);
      const bodyRotation = live.motion
        ? new THREE.Quaternion().copy(live.motion.body.rotation())
        : new THREE.Quaternion().setFromAxisAngle(this.up, live.spawn.yaw);
      bodyRotation.multiply(new THREE.Quaternion().setFromAxisAngle(this.up, life.yaw));
      const [sx, height, sz] = live.spawn.scale;
      const sy = height * life.breath;
      const put = (mesh: THREE.InstancedMesh, index: number, at: THREE.Vector3,
        scale: THREE.Vector3, rotation = bodyRotation): void => {
        world.copy(at).applyQuaternion(bodyRotation).add(centre);
        this.matrix.compose(world, rotation, scale);
        mesh.setMatrixAt(index, this.matrix);
      };
      if (live.spawn.kind === 'colossus') {
        for (let i = 0; i < COLOSSUS_PANELS_PER_BODY; i++) {
          const phase = i * 2.399963 + this.clock * (0.28 + (i % 4) * 0.05);
          local.set(Math.sin(i * 1.73) * sx * 0.54,
            Math.sin(phase * 0.73) * sy * 0.50,
            Math.cos(i * 2.11 + this.clock * 0.19) * sz * 0.50);
          spin.setFromEuler(new THREE.Euler(phase * 0.7, phase, phase * 0.4));
          const rotation = bodyRotation.clone().multiply(spin);
          put(this.colossusDebris, debrisAt++, local,
            size.setScalar(0.7 + (i % 5) * 0.16), rotation);
        }
        for (let i = 0; i < COLOSSUS_WHEELS_PER_BODY; i++) {
          const phase = i * 1.91 + this.clock * (0.18 + i * 0.025);
          local.set(Math.sin(i * 2.07 + 0.4) * sx * 0.48,
            Math.sin(phase * 0.81) * sy * 0.43,
            Math.cos(i * 1.63 + 0.7) * sz * 0.42);
          spin.setFromEuler(new THREE.Euler(phase * 0.31, phase, phase * 0.47));
          const rotation = bodyRotation.clone().multiply(spin);
          put(this.colossusWheels, wheelAt++, local, size.setScalar(0.78), rotation);
        }
        for (let i = 0; i < COLOSSUS_SEATS_PER_BODY; i++) {
          const phase = i * 3.07 + this.clock * (0.12 + i * 0.03);
          local.set(Math.sin(i * 2.43 + 1.2) * sx * 0.40,
            Math.sin(phase * 0.66) * sy * 0.36,
            Math.cos(i * 2.18 + 0.5) * sz * 0.36);
          spin.setFromEuler(new THREE.Euler(Math.sin(phase) * 0.22, phase * 0.43,
            Math.cos(phase * 0.7) * 0.18));
          const rotation = bodyRotation.clone().multiply(spin);
          const back = local.clone().add(new THREE.Vector3(0, 0.42, -0.18).applyQuaternion(spin));
          const cushion = local.clone().add(new THREE.Vector3(0, -0.16, 0.22).applyQuaternion(spin));
          put(this.colossusSeatBacks, seatAt, back, size.setScalar(0.88), rotation);
          put(this.colossusSeatCushions, seatAt++, cushion, size.setScalar(0.88), rotation);
        }
      }
      const giant = live.spawn.kind === 'colossus';
      for (const side of [-1, 1]) {
        put(this.colossusEyes, faceAt,
          local.set(side * sx * (giant ? 0.18 : 0.25), sy * (giant ? -0.02 : 0.02),
            sz * 1.015),
          giant ? size.set(sx * 0.06, sy * 0.10, 0.30)
            : size.set(sx * 0.11, sy * 0.16, Math.max(0.03, sz * 0.07)));
        put(this.colossusPupils, faceAt,
          local.set(side * sx * (giant ? .18 : .25) + sx * life.gazeX * (giant ? .5 : 1),
            sy * (giant ? -.02 : .02) + sy * life.gazeY, sz * 1.015 + .015),
          giant ? size.set(sx * .03, sy * .055, 1) : size.set(sx * .055, sy * .085, 1));
        faceAt++;
      }
    }
    for (const falling of this.falling) {
      const p = this.physics.bodyPosition(falling.motion.body);
      const life = slimeLife(this.hash(`falling:${falling.slot}:${falling.start.x}`), this.clock);
      const orientation = new THREE.Quaternion().copy(falling.motion.body.rotation())
        .multiply(new THREE.Quaternion().setFromAxisAngle(this.up, life.yaw));
      const sy = falling.scale[1] * life.breath;
      for (const side of [-1, 1]) {
        local.set(side * falling.scale[0] * .25, sy * .02, falling.scale[2] * 1.015)
          .applyQuaternion(orientation).add(new THREE.Vector3(p.x, p.y, p.z));
        this.matrix.compose(local, orientation,
          size.set(falling.scale[0] * .11, sy * .16, .1));
        this.colossusEyes.setMatrixAt(faceAt, this.matrix);
        local.add(new THREE.Vector3(falling.scale[0] * life.gazeX, sy * life.gazeY, .015)
          .applyQuaternion(orientation));
        this.matrix.compose(local, orientation, size.set(falling.scale[0] * .055, sy * .085, 1));
        this.colossusPupils.setMatrixAt(faceAt++, this.matrix);
      }
    }
    this.colossusDebris.count = debrisAt;
    this.colossusWheels.count = wheelAt;
    this.colossusSeatBacks.count = this.colossusSeatCushions.count = seatAt;
    this.colossusEyes.count = this.colossusPupils.count = faceAt;
    for (const mesh of [this.colossusDebris, this.colossusWheels, this.colossusSeatBacks,
      this.colossusSeatCushions, this.colossusEyes, this.colossusPupils]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private hash(value: string): number {
    let out = 2166136261;
    for (let i = 0; i < value.length; i++) out = Math.imul(out ^ value.charCodeAt(i), 16777619);
    return out >>> 0;
  }
}
