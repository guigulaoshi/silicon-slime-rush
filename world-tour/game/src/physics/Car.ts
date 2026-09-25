import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { isPoweredWheel, poweredWheelCount, type CarTuning } from './CarTuning';
import { COLLISION_GROUPS, type CarCollision, type PhysicsWorld } from './PhysicsWorld';
import type { WeatherContact } from '../world/WeatherSurface';
import type { SurfaceSample } from '../world/SurfaceGrid';
import { engineDriveForce, longitudinalGrip, powertrainTarget, updatePowertrain, type PowertrainState } from './Powertrain';

export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 left .. 1 right */
  steer: number;
  /** Hold the brakes without turning the low-speed pedal into reverse. */
  parkingBrake?: boolean;
}

export const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0 };

export interface WheelState {
  grounded: boolean;
  compression: number;
  load: number;
  /** sideways speed at the contact patch, m/s; this is what "sliding" means */
  slip: number;
  /** 0..1 combined lateral slide and longitudinal force saturation at this contact patch. */
  skid: number;
  contact: THREE.Vector3;
  weather?: WeatherContact;
}

export interface CarImpact {
  kind: 'vehicle' | 'barrier';
  strength: number;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

export type SurfaceQuery = (x: number, z: number) => SurfaceSample;

const UP = new THREE.Vector3(0, 1, 0);
// Dot of the car's up against world up below which it counts as tipped, and how long it has to stay
// there. Waiting for the car to be stationary as well is what made a roll unrecoverable: over the
// rail there is nothing to come to rest on, so the car keeps sliding, never counts as tipped, and
// the player is left watching it go. The wait is longer than the upright assist needs to roll the
// car back onto its wheels on flat ground, so an ordinary spill costs a second and not a teleport;
// a car that has gone over the rail is picked up by the off-track rule long before this.
const UPRIGHT_LIMIT = 0.35;     // about seventy degrees over
const UPRIGHT_SECONDS = 1.2;
// A shallow rub may never switch sides. Once the speed aimed straight through the beam reaches
// this, it is a deliberate high-energy breach and the guardrail gets no arcade containment help.
// Breakout is based on velocity into the rail, not total speed. The original let 10 m/s through
// (about 36 km/h across the rail: 80 km/h at 27 degrees), which on old-town corners meant every
// ordinary mistake left the course. Now only a racing-speed, nearly head-on strike goes through:
// 100 km/h at 60 degrees is 27.8 * sin(60) = 24 m/s into the rail.
//
// Speed alone cannot tell a deliberate hit from a fast graze, so the angle has a bar of its own as
// well: nothing shallower than `RAIL_BREAKOUT_INCIDENCE_DEG` goes through at any speed. Both have to
// be met (the first World Tour's owner:, then
// 「保留函数，门槛大幅提高」). A direct hit at racing speed still goes through on purpose -- a rail
// nothing can cross is an invisible wall. Climbing over the beam at low speed is closed in the
// geometry instead, by the invisible `guardrail_shield` above every rail.
export const GUARDED_WALL_CLOSING_SPEED = 24;
export const RAIL_BREAKOUT_INCIDENCE_DEG = 60;
const RAIL_BREAKOUT_SIN_INCIDENCE = Math.sin(RAIL_BREAKOUT_INCIDENCE_DEG * Math.PI / 180);

/**
 * Whether a strike breaches a guardrail rather than being contained by it.
 *
 * `closingSpeed` is the part of the velocity aimed through the rail, so `closingSpeed / speed` is the
 * sine of the incidence angle: 1 is straight in, 0 is parallel to the beam.
 */
/**
 * Every place a car is put down -- the grid (road + 0.6 m), a reset (+ 0.8 m), a parking berth -- is
 * authored for a chassis about this tall (half height, metres). A taller body put there starts with
 * its floor under the road: a double-deck bus (half height 1.07 m) began 0.47 m below the surface and
 * the solver pushed it out through the underside, so it fell for ever from the grid. Anything taller
 * is lifted by the difference when it is spawned or reset.
 */
export const SPAWN_CHASSIS_HALF = 0.55;
export function spawnLift(tuning: Pick<CarTuning, 'chassisHalf'>): number {
  return Math.max(0, tuning.chassisHalf[1] - SPAWN_CHASSIS_HALF);
}

export function railBreakout(speed: number, closingSpeed: number): boolean {
  return closingSpeed >= GUARDED_WALL_CLOSING_SPEED
    && closingSpeed >= speed * RAIL_BREAKOUT_SIN_INCIDENCE;
}
/** Closing speed, m/s, above which the damper adds no more force (its blow-off valve). */
export const DAMPER_BLOW_OFF = 6;
// Rails are built by height above the road: 0.40-0.72 m, and 0.16-0.48 m at Moffett. A car whose
// centre of mass rides above the lowest of those tops pivots over a beam instead of being stopped by
// it, so its contact probes are taken at rail height instead of through empty air above the beam.
const RAIL_TRIP_COM_HEIGHT = 0.45;
// A rail strike compresses the suspension; a tall rig must not drop back to a low car mid-hit.
const RAIL_TRIP_RELEASE_HEIGHT = 0.3;
const RAIL_PROBE_HEIGHTS = [0.3, 0.58] as const;
const WALL_SIDE_GRACE_SECONDS = 0.3;
const WALL_SIDE_GRACE_DISTANCE = 3;

/**
 * An arcade car built on raycasts, not on Rapier's vehicle controller.
 *
 * Rapier ships a raycast vehicle, but it models a fairly realistic tyre and the whole point here is a
 * car that rotates further than it should, holds the slide, and comes back when you lift. That lives
 * in the grip clamps below: each wheel can only pull as hard as its share of the weight allows, and
 * the rear pair simply gets less grip than the front, so power and braking rotate the car.
 */
export class Car {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly wheels: WheelState[] = [];
  private powertrain: PowertrainState = powertrainTarget(0, 0, 66, true);

  private steerAngle = 0;
  private wheelYaw = 0;
  private lastSlip = 0;
  private readonly lastVel = new THREE.Vector3();
  private readonly lastPosition = new THREE.Vector3();
  /** how hard the car hit something on this step, 0..1; only non-zero on the frame of a hit */
  impact = 0;
  /** One metal-body impact, available only on the fixed step that consumes its contact event. */
  impactFeedback: CarImpact | null = null;
  /** 0..1 actual forward braking effort; zero once the same pedal has become reverse drive. */
  braking = 0;
  /** Pedals off, or the parking brake on: a car at a standstill in this state stays where it stopped. */
  parked = false;
  /** Classified contacts emitted by Rapier on this step, including slime kinds. */
  collisions: readonly CarCollision[] = [];
  /** Solid contacts remain true between Rapier's start and end events, including across a whole bend. */
  private readonly hardContacts = new Set<number>();
  get hardContact(): boolean { return this.hardContacts.size > 0; }
  private surfaceQuery: SurfaceQuery | null = null;
  /** Global road grip, composed with local slick patches instead of replacing their query. */
  private weatherGrip = 1;
  /**
   * The hard AI's hidden catch-up, 1 when level with or ahead of the leading player. It scales
   * engine force, top speed and tyre grip together; no human car ever has it above 1.
   */
  assist = 1;
  private weatherQuery: ((point: THREE.Vector3) => WeatherContact) | null = null;
  setWeatherQuery(query: (point: THREE.Vector3) => WeatherContact): void { this.weatherQuery = query; }
  private readonly wheelSurfaces: SurfaceSample[] = [];
  private surfaceSlick = 0;
  /**
   * Where the car is currently rubbing along something and how hard, or null.
   *
   * Read by the renderer to throw sparks and by the audio to scrape. It is a world point rather
   * than a flag because a spark that does not come off the place the car is touching is worse than
   * no spark at all.
   */
  scrape: { x: number; y: number; z: number; intensity: number } | null = null;
  private wallContact = false;
  private wallSideGrace = 0;
  private readonly wallSideNormal = new THREE.Vector3();
  private readonly wallSidePoint = new THREE.Vector3();
  private tippedFor = 0;
  /** Changes only when the body teleports, allowing render history to collapse around the jump. */
  private resetRevision = 0;
  private readonly api: typeof RAPIER;

  // scratch, reused every step so a 60 Hz loop allocates nothing
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly ang = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly tmp4 = new THREE.Vector3();
  /** scratch result for findWall, which runs every step and must not allocate */
  private readonly wall = { point: new THREE.Vector3(), normal: new THREE.Vector3() };
  private readonly ray: RAPIER.Ray;
  private readonly anchor = new THREE.Vector3();

  /** Metres a tall body is raised above where it is put down (SPAWN_CHASSIS_HALF). */
  private readonly lift: number;

  constructor(
    private readonly physics: PhysicsWorld,
    readonly tuning: CarTuning,
    spawn: { pos: [number, number, number]; yaw: number },
    private readonly passive = false,
  ) {
    this.api = physics.api;
    const [hx, hy, hz] = tuning.chassisHalf;
    this.lift = passive ? 0 : spawnLift(tuning);
    const desc = this.api.RigidBodyDesc.dynamic()
      .setTranslation(spawn.pos[0], spawn.pos[1] + this.lift, spawn.pos[2])
      .setRotation(yawQuat(spawn.yaw))
      .setLinearDamping(tuning.linearDamping)
      .setAngularDamping(tuning.angularDamping)
      .setCcdEnabled(true);
    this.body = this.physics.createRigidBody(desc);
    // the collider contributes no mass: setAdditionalMassProperties below is the single source of it,
    // and setting both makes the car quietly twice as heavy as its tuning says
    // No friction and no bounce on the shell. Every bit of grip the car has comes from the four
    // raycast wheels; the shell is only here to stop it passing through things. Left rough, the
    // solver treats a rail the car is leaning on as a brake -- a tenth of a metre per second into
    // the wall was enough to scrub ten metres per second off along it, which reads as hitting an
    // invisible wall every few seconds. The cost of rubbing is scrapeDrag, and only scrapeDrag.
    const cd = this.api.ColliderDesc.cuboid(hx, hy, hz)
      .setMass(0)
      .setFriction(0.0)
      .setRestitution(0.0);
    this.collider = this.physics.createCollider(cd, this.body);
    physics.registerCollider(this.collider, 'car');
    this.ray = new this.api.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const inertia = tuning.mass * (tuning.inertiaScale ?? 1);
    this.body.setAdditionalMassProperties(
      tuning.mass,
      { x: tuning.centreOfMass[0], y: tuning.centreOfMass[1], z: tuning.centreOfMass[2] },
      { x: inertia * 0.6, y: inertia * 0.9, z: inertia * 0.4 },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
    for (let i = 0; i < tuning.wheels.length; i++) {
      this.wheelSurfaces.push({ slick: 0 });
      this.wheels.push({ grounded: false, compression: 0, load: 0, slip: 0, skid: 0,
        contact: new THREE.Vector3() });
    }
    this.lastPosition.set(spawn.pos[0], spawn.pos[1] + this.lift, spawn.pos[2]);
  }

  get speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  private get availableSteeringAngle(): number {
    const t = this.tuning;
    const factor = THREE.MathUtils.clamp(this.speed / t.steerFalloffSpeed, 0, 1);
    return THREE.MathUtils.lerp(t.maxSteer, t.maxSteer * t.steerAtSpeed, factor);
  }

  private get wheelbase(): number {
    const wheels = this.tuning.wheels;
    return Math.abs(wheels[0]![2] - (wheels[2]?.[2] ?? wheels[0]![2])) || 2.5;
  }

  private get availableSteeringRate(): number {
    const t = this.tuning;
    const factor = THREE.MathUtils.clamp(this.speed / t.steerFalloffSpeed, 0, 1);
    return t.steerRate * THREE.MathUtils.lerp(1, t.steerRateAtSpeed ?? 1, factor);
  }

  /** Speed at which the wheels can follow a change of route curvature over this distance. */
  steeringTransitionSpeed(from: number, to: number, distance: number): number {
    const turn = Math.abs(Math.atan(to * this.wheelbase) - Math.atan(from * this.wheelbase));
    return turn > 1e-6 ? distance * this.availableSteeringRate / turn : Infinity;
  }

  /** Follow the requested arc without outrunning wheel alignment or the physical yaw limits. */
  steeringSpeedLimit(curvature: number, distance: number): number {
    const target = this.steeringInputForCurvature(curvature) * this.availableSteeringAngle;
    const turn = Math.abs(target - this.steerAngle);
    const alignment = turn > 1e-6 ? distance * this.availableSteeringRate / turn : Infinity;
    const curve = Math.abs(curvature);
    const grip = Math.min(this.weatherGrip, ...this.wheels.filter(w => w.grounded).map(w => w.weather?.grip ?? this.weatherGrip));
    const weatherLimit = grip < 1 && curve > 1e-6
      ? Math.sqrt(this.tuning.maxLateralAccel * grip / curve) : Infinity;
    return curve > 1e-6 ? Math.min(alignment, this.tuning.maxYawRate / curve, weatherLimit) : alignment;
  }

  setWeatherGrip(scale: number): void {
    this.weatherGrip = THREE.MathUtils.clamp(scale, .4, 1);
  }

  get weatherGripScale(): number { return this.weatherGrip; }

  /**
   * The grip the AI plans on: the weather's, or ice under a grounded wheel when there is some.
   * Ice is the only cliff edge -- snow plans at .62 and the car still arrives on .43 ice. Puddles and
   * slime trails are a few points off their weather and stay out of the long plan: feeding every
   * surface in slowed rain laps until the AI could no longer push a giant slime aside.
   */
  get planningGrip(): number {
    const ice = this.wheels.filter(w => w.grounded && w.weather?.kind === 'ice').map(w => w.weather!.grip);
    return Math.min(this.weatherGrip, ...ice);
  }

  /** Convert a path's rightward curvature to the same steering input a human supplies. */
  steeringInputForCurvature(curvature: number): number {
    return THREE.MathUtils.clamp(Math.atan(curvature * this.wheelbase) / this.availableSteeringAngle, -1, 1);
  }

  get steeringAngle(): number { return this.steerAngle; }
  /** Actual front-wheel local Y rotation, after physical steering limits and sign conversion. */
  get wheelSteeringAngle(): number { return this.wheelYaw; }

  /** Signed speed along the car's nose: negative means reversing. */
  /** Where the nose points, in world space. Read by the sparks, which spray backwards along it. */
  get forward(): THREE.Vector3 {
    return this.fwd;
  }

  get forwardSpeed(): number {
    this.readTransform();
    const v = this.body.linvel();
    return this.fwd.dot(this.tmp.set(v.x, v.y, v.z));
  }

  get gear(): number { return this.powertrain.gear; }
  get rpm(): number { return this.powertrain.rpm; }
  get rpmFraction(): number { return this.powertrain.rpmFraction; }

  get grounded(): boolean {
    return this.wheels.some((w) => w.grounded);
  }

  /** All tyres loaded with slip inside the vehicle's existing controlled-drift limit. */
  get gripping(): boolean {
    return this.wheels.every(wheel => wheel.load > 0) && Math.abs(this.slipAngle) <= this.tuning.maxSlipAngle;
  }

  /** Set once by the ground-effect owner; each grounded wheel calls it at its ray contact. */
  setSurfaceQuery(query: SurfaceQuery | null): void { this.surfaceQuery = query; }

  get surfaceState(): Readonly<{ slick: number; kind: 'dry' | 'slick' }> {
    return { slick: this.surfaceSlick, kind: this.surfaceSlick > 0.05 ? 'slick' : 'dry' };
  }

  /**
   * Angle between where the car points and where it is going, in radians.
   *
   * This is what drifting is, and unlike a sideways speed it does not change just because the car
   * is going faster, so it is the number to tune against and to show the player.
   */
  get slipAngle(): number {
    this.readTransform();
    const v = this.body.linvel();
    this.tmp.set(v.x, 0, v.z);
    if (this.tmp.lengthSq() < 1) return 0;
    const forward = this.fwd.dot(this.tmp);
    const lateral = this.right.dot(this.tmp);
    return Math.atan2(lateral, Math.abs(forward));
  }

  /** How sideways the car is travelling, in m/s, averaged over the wheels that are down. */
  get slip(): number {
    const down = this.wheels.filter((w) => w.grounded);
    if (!down.length) return 0;
    return down.reduce((a, w) => a + Math.abs(w.slip), 0) / down.length;
  }

  /** Current position. A fresh vector: the internal one is scratch and changes mid-step. */
  get position(): THREE.Vector3 {
    const t = this.physics.bodyPosition(this.body);
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** Current orientation, likewise a fresh object. */
  get quaternion(): THREE.Quaternion {
    const r = this.body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  get poseRevision(): number { return this.resetRevision; }

  /** Position without allocating, for the hot path. Valid until the next physics step. */
  private get positionRef(): THREE.Vector3 {
    const t = this.physics.bodyPosition(this.body);
    return this.pos.set(t.x, t.y, t.z);
  }

  /**
   * The wall the car is rubbing against, as a point and the normal pointing back at the car.
   *
   * Found with short rays out of the chassis sides, the same way the wheels find the ground: this
   * build of Rapier will not hand over its contact points, and a spark has to come off the place
   * the car is actually touching.
   *
   * Three rays from each of all four faces, not just the sides. Side-only probes made a straight-on
   * approach invisible until the low beam was already under the chassis: even at 4 m/s a sedan
   * could then roll through. The front probes see that same rail early, while the closing-speed
   * rule below still lets a sufficiently direct, hard hit break out.
   */
  private findWall(t: CarTuning, dt: number): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    // The full length, not most of it: a rail met at a shallow angle touches the front corner
    // first, and a ray that starts short of the bumper still reads clear while the corner is
    // already in the wall -- which hands that hit back to the solver as a dead stop.
    let best: number | null = null;
    // A tall rig's centre is a metre up, over the top of every rail, so its probes are taken at rail
    // height above the road its wheels stand on.
    const road = this.tripsOverRails ? this.roadHeight : null;
    const heights = road === null ? [null] : RAIL_PROBE_HEIGHTS;
    const faces = [
      { direction: this.right, extent: t.chassisHalf[0], offset: this.fwd,
        spread: t.chassisHalf[2], guardrailOnly: false },
      { direction: this.fwd, extent: t.chassisHalf[2], offset: this.right,
        spread: t.chassisHalf[0], guardrailOnly: true },
    ];
    for (const face of faces) for (const side of [1, -1]) {
      const dir = this.tmp2.copy(face.direction).multiplyScalar(side);
      const closing = this.vel.dot(dir);
      const reach = face.extent + 0.35 + Math.max(0, closing) * dt * 2;
      for (const height of heights) for (const across of [face.spread, 0, -face.spread]) {
        // A little above the chassis centre: the rail beam sits between 0.40 and 0.72 m over the
        // road and a low car's centre is right on its bottom edge, so a ray out of the middle grazes it.
        const from = this.tmp.copy(this.positionRef)
          .addScaledVector(this.up, 0.12).addScaledVector(face.offset, across);
        if (height !== null) from.y = road! + height + face.offset.y * across;
        // one ray object, reused across all faces
        this.ray.origin.x = from.x; this.ray.origin.y = from.y; this.ray.origin.z = from.z;
        this.ray.dir.x = dir.x; this.ray.dir.y = dir.y; this.ray.dir.z = dir.z;
        const hit = this.physics.castRayAndGetNormal(
          this.ray, reach, true, this.api.QueryFilterFlags.EXCLUDE_SENSORS,
          COLLISION_GROUPS.car, undefined, this.body, collider => {
            // Rail corrections can translate this body directly. Applying them to a moving
            // slime or another car tears a ball hitch apart before the solver pulls it back.
            const role = this.physics.collisionRole(collider);
            return role === 'guardrail'
              || (!face.guardrailOnly && (role === 'wall' || role === 'ground'));
          });
        if (!hit) continue;
        const toi = (hit as unknown as { timeOfImpact?: number; toi?: number }).timeOfImpact
          ?? (hit as unknown as { toi: number }).toi;
        if (toi > reach) continue;
        const nrm = (hit as unknown as { normal: { x: number; y: number; z: number } }).normal;
        const normal = this.tmp4.set(nrm.x, nrm.y, nrm.z);
        // a ray out of the side can still catch the road under a kerb; only walls count
        if (Math.abs(normal.y) > 0.7) continue;
        normal.normalize();
        if (normal.dot(dir) > 0) normal.multiplyScalar(-1);   // point it back at the car
        // Not the nearest wall: the one the car is driving into hardest. Rails are polylines, and
        // sliding along one segment while the next angles into the car's path is the normal case,
        // not a corner case. The segment being leant on is always nearer than the one about to be
        // hit, so picking by distance answers with the wall that is not the problem, and the front
        // corner meets the other one at full speed with the solver in charge.
        const into = normal.dot(this.vel);
        if (best !== null && into >= best) continue;
        best = into;
        this.wall.point.copy(from).addScaledVector(dir, toi);
        this.wall.normal.copy(normal);
      }
    }
    return best === null ? null : this.wall;
  }

  /** Cross only a guardrail, never a building, when the velocity meets it at a hard enough angle. */
  private tryGuardrailBreakout(t: CarTuning, dt: number): boolean {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    // The closing speed can never exceed the speed, so this is the cheap half of `railBreakout`.
    if (speed < GUARDED_WALL_CLOSING_SPEED) return false;
    const direction = this.tmp2.set(this.vel.x / speed, 0, this.vel.z / speed);
    const road = this.roadHeight;
    const origin = this.tmp.copy(this.positionRef);
    origin.y = road === null ? origin.y + .12 : road + RAIL_PROBE_HEIGHTS[1];
    const reach = Math.max(t.chassisHalf[0], t.chassisHalf[2]) + .35 + speed * dt * 2;
    this.ray.origin.x = origin.x; this.ray.origin.y = origin.y; this.ray.origin.z = origin.z;
    this.ray.dir.x = direction.x; this.ray.dir.y = 0; this.ray.dir.z = direction.z;
    const hit = this.physics.castRayAndGetNormal(
      this.ray, reach, true, this.api.QueryFilterFlags.EXCLUDE_SENSORS,
      COLLISION_GROUPS.car, undefined, this.body,
      collider => this.physics.collisionRole(collider) === 'guardrail',
    );
    if (!hit) return false;
    const toi = (hit as unknown as { timeOfImpact?: number; toi?: number }).timeOfImpact
      ?? (hit as unknown as { toi: number }).toi;
    const raw = (hit as unknown as { normal: { x: number; y: number; z: number } }).normal;
    const normal = this.tmp4.set(raw.x, raw.y, raw.z).normalize();
    const normalTravel = Math.abs(normal.dot(direction));
    const closingSpeed = speed * normalTravel;
    if (Math.abs(normal.y) > .7 || !railBreakout(speed, closingSpeed)) return false;
    if (normal.dot(direction) > 0) normal.multiplyScalar(-1);

    const point = this.tmp3.copy(origin).addScaledVector(direction, toi);
    const support = Math.abs(normal.dot(this.right)) * t.chassisHalf[0]
      + Math.abs(normal.dot(this.fwd)) * t.chassisHalf[2];
    const beyond = this.tmp.copy(point).addScaledVector(direction, (support + .03) / normalTravel);
    beyond.y = this.positionRef.y;
    this.physics.setBodyPosition(this.body, beyond);
    const strength = Math.min(closingSpeed / 18, 1);
    this.impact = Math.max(this.impact, strength);
    this.impactFeedback = { kind: 'barrier', strength,
      point: { x: point.x, y: point.y, z: point.z },
      normal: { x: normal.x, y: normal.y, z: normal.z } };
    this.wallSideGrace = 0;
    this.wallContact = false;
    return true;
  }

  /** Mean height of the grounded wheel contacts from the last step, or null when airborne. */
  private get roadHeight(): number | null {
    let sum = 0; let count = 0;
    for (const wheel of this.wheels) if (wheel.grounded) { sum += wheel.contact.y; count++; }
    return count ? sum / count : null;
  }

  /** Centre of mass high enough above the road to pivot over a guardrail beam. */
  get tripsOverRails(): boolean {
    const road = this.roadHeight;
    if (road === null) return this.lastTripsOverRails;
    const com = this.positionRef.y + this.up.y * this.tuning.centreOfMass[1];
    const height = com - road;
    return this.lastTripsOverRails = this.lastTripsOverRails
      ? height >= RAIL_TRIP_RELEASE_HEIGHT : height >= RAIL_TRIP_COM_HEIGHT;
  }
  private lastTripsOverRails = false;

  /** One fixed physics step of driving. Call this immediately before world.step(). */
  update(dt: number, input: CarInput): void {
    const t = this.tuning;
    // Rapier's addForce is a standing force, not a one-shot: without this the suspension
    // accumulates every step and launches the car
    this.body.resetForces(false);
    this.body.resetTorques(false);
    this.readTransform();
    const v = this.body.linvel();
    this.vel.set(v.x, v.y, v.z);
    const a = this.body.angvel();
    this.ang.set(a.x, a.y, a.z);

    const speed = this.vel.length();
    const forwardSpeed = this.fwd.dot(this.vel);
    this.braking = input.parkingBrake || forwardSpeed > 0.5 ? input.brake : 0;
    this.parked = input.throttle === 0 && (input.brake === 0 || !!input.parkingBrake);

    this.collisions = this.physics.takeCarCollisions(this.collider);
    for (const event of this.collisions) {
      if (!['car', 'wall', 'guardrail', 'slime-bounce', 'slime-colossus'].includes(event.kind)) continue;
      if (event.started) this.hardContacts.add(event.other); else this.hardContacts.delete(event.other);
    }
    this.impactFeedback = null;
    this.impact = 0;
    for (const event of this.collisions) {
      if (!event.started) continue;
      const strength = event.kind === 'slime-popper' ? 0.3
        : event.kind === 'slime-slick' ? 0.15
          : event.kind === 'slime-burst' ? 0.8 : Math.min(event.closingSpeed / 18, 1);
      if ((event.kind === 'car' || event.kind === 'wall' || event.kind === 'guardrail')
        && (!this.impactFeedback || strength > this.impactFeedback.strength)) {
        this.impactFeedback = { kind: event.kind === 'car' ? 'vehicle' : 'barrier', strength,
          point: event.point, normal: event.normal };
      }
      this.impact = Math.max(this.impact, strength);
    }

    // Slide along the rail instead of bouncing off it.
    //
    // The solver's job is to stop the car passing through the wall, and it does that by pushing it
    // back out: the car crosses the road and starts spinning, and two hits later it is over the
    // rail on the far side. That is a punishment most players cannot read -- they do not know what
    // just happened -- so it is removed rather than softened. All the speed into the wall goes, the
    // speed along it stays and bleeds off, and the wall is not allowed to turn the car at all: yaw
    // is clamped to what the driver's own steering asks for, so the only thing that ever changes
    // where the nose points is the steering wheel.
    //
    // Contact is measured, not inferred. The speed-loss heuristic above only fires on the frame of
    // the first hit -- while the car is actually sliding along the rail it loses less than a tyre
    // could, so the heuristic says nothing and the car was left to the solver for the whole rub,
    // which is where the spin came back. Short rays out of the sides answer the question directly.
    this.scrape = null;
    const brokeRail = this.tryGuardrailBreakout(t, dt);
    const wall = brokeRail ? null : this.findWall(t, dt);
    this.wallSideGrace = Math.max(0, this.wallSideGrace - dt);
    let nextWallContact = false;
    if (wall) {
      const n = wall.normal;
      const sameLightContact = this.wallSideGrace > 0 && (this.wallContact
        || wall.point.distanceToSquared(this.wallSidePoint) < WALL_SIDE_GRACE_DISTANCE ** 2);
      if (!sameLightContact && this.tmp3.copy(this.lastPosition).sub(wall.point).dot(n) < 0) {
        n.multiplyScalar(-1);
      }
      const rawInto = n.dot(this.vel);
      const rawClosingSpeed = Math.max(0, -rawInto);
      const guardedClosingSpeed = sameLightContact
        ? Math.max(0, -this.wallSideNormal.dot(this.vel)) : rawClosingSpeed;
      const hardBreach = !this.tripsOverRails && guardedClosingSpeed >= GUARDED_WALL_CLOSING_SPEED;
      if (sameLightContact && !hardBreach && n.dot(this.wallSideNormal) < 0) n.multiplyScalar(-1);
      if (!hardBreach && (sameLightContact || rawClosingSpeed < GUARDED_WALL_CLOSING_SPEED)) {
        if (!sameLightContact) this.wallSideNormal.copy(n);
        else this.wallSideNormal.lerp(n, .2).normalize();
        this.wallSidePoint.copy(wall.point);
        this.wallSideGrace = WALL_SIDE_GRACE_SECONDS;
      } else {
        this.wallSideGrace = 0;
      }
      const into = n.dot(this.vel);
      const closingSpeed = Math.max(0, -into);
      nextWallContact = this.wallContact || closingSpeed > 0.25;
      if (!this.wallContact && closingSpeed > 0) {
        const strength = Math.min(closingSpeed / 18, 1);
        this.impact = Math.max(this.impact, strength);
        this.impactFeedback = { kind: 'barrier', strength,
          point: { x: wall.point.x, y: wall.point.y, z: wall.point.z },
          normal: { x: n.x, y: n.y, z: n.z } };
      } else if (this.wallContact && this.impactFeedback?.kind === 'barrier') {
        // Rapier may report its collision start one step after the predictive rail contact. The
        // player already heard that hit; the continuing contact is the scrape below, not a second.
        this.impactFeedback = null;
      }
      const signedSide = this.tmp3.copy(this.positionRef).sub(wall.point).dot(n);
      const support = Math.abs(n.dot(this.right)) * t.chassisHalf[0]
        + Math.abs(n.dot(this.fwd)) * t.chassisHalf[2];
      // Rapier resolves a deeply overlapping thin mesh toward whichever side the chassis centre
      // happens to be on. A low-angle rub that penetrates just past the centre can therefore be
      // expelled outside. Preserve the side on which that light contact began and put the whole
      // chassis back there. Hard impacts never arm this correction.
      if (this.wallSideGrace > 0 && signedSide < 0) {
        const corrected = this.tmp3.copy(this.positionRef)
          .addScaledVector(n, support + .03 - signedSide);
        this.physics.setBodyPosition(this.body, corrected);
      }
      if (into < 0) this.vel.addScaledVector(n, -into * t.scrapeAbsorb);
      // drag along the wall, so rubbing costs time -- that is the whole penalty now
      const along = this.tmp3.copy(this.vel).addScaledVector(n, -n.dot(this.vel));
      this.vel.addScaledVector(along, -Math.min(t.scrapeDrag * dt, 1));
      this.body.setLinvel({ x: this.vel.x, y: this.vel.y, z: this.vel.z }, true);

      // A wall may not out-turn the driver -- but it may straighten the car out along itself.
      //
      // Pinning the heading outright was worse than it sounds. Rails follow the road, the road
      // bends, and a car whose nose cannot move ends up ploughing along the rail more and more
      // sideways, down to walking pace. So the yaw the car is allowed is the band between what the
      // driver's own steering asks for and what would line the car up with the rail: the rail can
      // guide, at a limited rate, and anything outside that band -- every kick, every spin -- is
      // clipped away.
      const tan = this.tmp2.copy(this.fwd).addScaledVector(n, -n.dot(this.fwd));
      tan.y = 0;
      let align = 0;
      if (tan.lengthSq() > 1e-4) {
        tan.normalize();
        const err = Math.atan2(this.fwd.z * tan.x - this.fwd.x * tan.z, this.fwd.dot(tan));
        align = THREE.MathUtils.clamp(err / 0.25, -t.scrapeAlign, t.scrapeAlign);
      }
      // the driver's own steering, as a rate, either way round: the sign convention for yaw is not
      // worth guessing at, and letting the driver turn is never the failure being guarded against
      const wheelbase = Math.abs(t.wheels[0]![2] - (t.wheels[2]?.[2] ?? t.wheels[0]![2])) || 1.5;
      const driver = Math.abs(this.steerAngle) * Math.abs(this.fwd.dot(this.vel)) / wheelbase;
      const yaw = THREE.MathUtils.clamp(this.ang.y, Math.min(-driver, align), Math.max(driver, align));
      const spin = 1 - t.scrapeSpin;
      this.ang.set(this.ang.x * spin, yaw, this.ang.z * spin);
      if (!this.passive) this.body.setAngvel({ x: this.ang.x, y: this.ang.y, z: this.ang.z }, true);

      this.scrape = {
        x: wall.point.x, y: wall.point.y, z: wall.point.z,
        intensity: Math.min(Math.abs(this.fwd.dot(this.vel)) / 30, 1),
      };
    }
    this.wallContact = nextWallContact;
    this.lastVel.copy(this.vel);
    // How far the nose is from where the car is actually going, and how fast that is growing. Both
    // are tracked every step, airborne included, so that landing sideways does not read as a sudden
    // jump in slip angle and fire the stability torque at full strength for one frame.
    const slipAngle = Math.atan2(this.right.dot(this.vel), Math.max(Math.abs(forwardSpeed), 1));
    const slipRate = dt > 0 ? (slipAngle - this.lastSlip) / dt : 0;
    this.lastSlip = slipAngle;

    // steering authority falls off with speed, or the car becomes undriveable past 100 km/h
    const maxSteer = this.availableSteeringAngle;
    const target = this.passive ? 0 : THREE.MathUtils.clamp(input.steer, -1, 1) * maxSteer;
    const steerRate = this.availableSteeringRate;
    this.steerAngle += THREE.MathUtils.clamp(target - this.steerAngle, -steerRate * dt, steerRate * dt);

    // How hard the car may be turned at this speed, and therefore how far the wheels actually point.
    // Turning the wheels further than this only saturates the front tyres: the nose swings in, the
    // car keeps going straight, and the slip angle runs away. Deriving the wheel angle from the same
    // ceiling as the yaw assist keeps steering, grip and stability telling one story.
    const wheelbase = this.wheelbase;
    const yawCeiling = t.maxLateralAccel * this.weatherGrip * this.assist;
    // Also cap the rate outright. Dividing a lateral-acceleration ceiling by forward speed means the
    // ceiling rises as the car goes sideways and slows, so a car that has started to spin is allowed
    // to spin faster the further round it gets, and the limiter never engages.
    const maxYaw = Math.min(
      yawCeiling / Math.max(Math.abs(forwardSpeed), 1),
      t.maxYawRate,
    );
    // positive yaw about +y turns left, and positive steer turns right, hence the sign
    const geometricYaw = -forwardSpeed * Math.tan(this.steerAngle) / wheelbase;
    const wantedYaw = THREE.MathUtils.clamp(geometricYaw, -maxYaw, maxYaw);
    // Overdrive is a share of the grip budget, not a share of the steering angle. Expressed as an
    // angle it means something different at every speed -- huge at fifty, negligible at three
    // hundred -- so the same input spins the car at town speed and does nothing at all flat out.
    const excess = THREE.MathUtils.clamp(Math.abs(geometricYaw) / Math.max(maxYaw, 1e-6) - 1, 0, 1);
    const appliedYaw = wantedYaw * (1 + excess * t.steerOverdrive);
    const appliedSteer = Math.sign(this.steerAngle) *
      Math.atan(Math.abs(appliedYaw) * wheelbase / Math.max(Math.abs(forwardSpeed), 1));
    this.wheelYaw = this.passive ? 0 : -appliedSteer;

    const wheelCount = t.wheels.length;
    const restLength = t.suspensionRest;
    const rayLength = restLength + t.suspensionTravel;
    const compressions: number[] = [];
    const contactVels: THREE.Vector3[] = [];
    const groundNormals: THREE.Vector3[] = [];
    const wheelDirs: { fwd: THREE.Vector3; right: THREE.Vector3 }[] = [];
    let groundedCount = 0;
    let totalLoad = 0;

    // Pass one: find the ground and hold the car up. Loads have to be known for every wheel before
    // any of them can be given grip, because grip is shared out in proportion to load.
    for (let i = 0; i < wheelCount; i++) {
      const w = this.wheels[i]!;
      const local = t.wheels[i]!;
      this.anchor.set(local[0], local[1], local[2]).applyQuaternion(this.q).add(this.positionRef);
      const down = this.tmp.copy(this.up).multiplyScalar(-1);
      const ray = new this.api.Ray(
        { x: this.anchor.x, y: this.anchor.y, z: this.anchor.z },
        { x: down.x, y: down.y, z: down.z },
      );
      const hit = this.physics.castRayAndGetNormal(
        ray, rayLength, true, this.api.QueryFilterFlags.EXCLUDE_SENSORS,
        COLLISION_GROUPS.car, undefined, this.body);
      const toi = hit ? ((hit as unknown as { timeOfImpact?: number; toi?: number }).timeOfImpact
        ?? (hit as unknown as { toi: number }).toi) : Infinity;

      // steerAngle is positive when the driver steers right, and a right turn is a negative rotation
      // about +y, so the wheels take the opposite sign. Only the front pair steers.
      const steer = i < 2 ? this.wheelYaw : 0;
      wheelDirs.push({
        fwd: this.fwd.clone().applyAxisAngle(this.up, steer).normalize(),
        right: this.right.clone().applyAxisAngle(this.up, steer).normalize(),
      });

      if (!hit || toi > rayLength) {
        w.grounded = false; w.compression = 0; w.load = 0; w.slip = 0; w.skid = 0;
        this.blendSurface(i, { slick: 0 }, dt);
        compressions.push(0);
        contactVels.push(new THREE.Vector3());
        groundNormals.push(this.up.clone());
        continue;
      }
      groundedCount++;
      w.grounded = true;
      w.compression = Math.max(restLength - toi, 0);
      compressions.push(w.compression);
      w.contact.copy(this.up).multiplyScalar(-toi).add(this.anchor);
      w.weather = this.weatherQuery?.(w.contact);
      this.blendSurface(i, this.surfaceQuery?.(w.contact.x, w.contact.z)
        ?? { slick: 0 }, dt);

      const contactVel = this.contactVelocity(w.contact);
      contactVels.push(contactVel);
      // suspension: a spring against compression, damped by how fast the wheel is closing on the ground.
      // Measure that closing speed against the ground, not against the car's own up axis: a car
      // pitched nose-up projects part of its forward speed onto its up axis, the damper reads it as
      // the ground rushing at the wheel, and the extra load pitches the car up further. At a hundred
      // metres a second that runs away and the car climbs off the road and lands on its roof.
      const n = (hit as unknown as { normal?: { x: number; y: number; z: number } }).normal;
      // A wheel ray can land on the face of a guardrail rather than on the road. That surface is
      // vertical, so damping against it would read the car's forward speed as the ground arriving;
      // anything that steep is a wall, and a wall is not something to stand the car on.
      const normal = n ? this.tmp2.set(n.x, n.y, n.z).normalize() : this.up;
      if (normal.dot(this.up) < 0.5) normal.copy(this.up);
      groundNormals.push(normal.clone());
      const closingSpeed = -contactVel.dot(normal);
      // A real damper has a blow-off valve: past a piston speed it stops adding force. Without one a
      // 22 m/s landing asked a single wheel to carry twelve g and heavy vehicles bounced off kerbs.
      // The speed is limited, not the force -- clamping the force rolled the minibus.
      const damperSpeed = Math.min(closingSpeed, DAMPER_BLOW_OFF);
      const load = Math.max(w.compression * t.suspensionStiffness + damperSpeed * t.suspensionDamping, 0);
      w.load = load;
      totalLoad += load;
      this.addForceAt(this.tmp.copy(this.up).multiplyScalar(load), w.contact);
    }
    this.surfaceSlick = this.wheelSurfaces.reduce((sum, item) => sum + item.slick, 0) / wheelCount;

    const gravityAlongGround = new THREE.Vector3(), springLean = new THREE.Vector3();
    // A trailer holds sideways whenever it stands still, and along its length only while the car
    // towing it is parked: its wheels roll free, the towing car's brakes hold the rig.
    const holdAcross = this.passive || this.parked;
    const holdAlong = this.passive ? !!input.parkingBrake : this.parked;
    // Pass two: grip. Each wheel pulls in proportion to the load it carries, so a wheel in the air
    // contributes nothing and a loaded outside wheel does most of the work through a corner.
    for (let i = 0; i < wheelCount; i++) {
      const w = this.wheels[i]!;
      if (!w.grounded) continue;
      const share = totalLoad > 0 ? w.load / totalLoad : 0;
      const dirs = wheelDirs[i]!;
      const contactVel = contactVels[i]!;
      const latVel = dirs.right.dot(contactVel);
      const longVel = dirs.fwd.dot(contactVel);
      w.slip = latVel;

      const weatherGrip = (w.weather?.grip ?? this.weatherGrip) * this.assist;
      const rear = i >= 2;
      const slickGrip = THREE.MathUtils.lerp(1, Math.min(1, (rear ? 0.38 : 0.62)
        * t.slickGripMultiplier), this.wheelSurfaces[i]!.slick);
      const rate = (rear ? t.gripRear : t.gripFront) * slickGrip * weatherGrip;
      // A tyre gives its best grip at a small slip angle and noticeably less once it is properly
      // sliding. A ceiling that never falls off is what turned every corner into a spin: sideways,
      // the front pair kept making the full yaw moment that put the car there and no correction
      // torque could out-pull it, while the same force scrubbed all the speed off. The falloff is
      // also what makes a drift catchable, because wheels steered into the slide slip less than the
      // rears and so keep more grip than them.
      const wheelSlip = Math.atan2(latVel, Math.max(Math.abs(longVel), 2));
      const sliding = THREE.MathUtils.clamp(
        (Math.abs(wheelSlip) - t.peakSlip) / (Math.PI / 2 - t.peakSlip), 0, 1);
      const mu = t.gripLimit * slickGrip * weatherGrip * (1 - sliding * (1 - t.slideGrip));
      // the friction circle: however hard grip wants to pull, a tyre cannot exceed its load times mu
      const cap = w.load * mu;
      // The pull above answers sideways *speed* only, so a car standing across a hill had to creep
      // downhill to earn the force that holds it: 0.5-0.75 m/s across an 18% grade in clear weather,
      // for ever. A tyre that is not
      // sliding also carries what pushes along the road surface across it, inside the same friction
      // circle: the downhill share of the weight it bears, and its spring while the body leans a few
      // degrees downhill with the hill. By the load it bears, not the body's mass: a trailer's tongue
      // weight rests on the towing car, and holding all of it at the trailer's own axle swung the
      // trailer round the hitch. A body tipped well over is not leaning with a hill -- holding its
      // springs' sideways push there tripped a landing car onto its roof.
      // Only for a car standing still with its pedals off (or its parking brake on), and a trailer:
      // moving, the same creep is a slip angle nobody sees; and pressed against a hairpin rail with the
      // throttle down, the hold fought the AI's shuffle off it -- the city pod never finished Lombard.
      // The AI pace table and the roll limits were measured on the handling as it was.
      // A hill is a road: up to 20 degrees, none past 25. A wheel resting on a slime's body or a kerb
      // is not standing on a hill, and holding against that surface shoved the car off it.
      const normal = groundNormals[i]!;
      const road = THREE.MathUtils.clamp((normal.y - .906) / .034, 0, 1);
      const lean = springLean.copy(this.up).addScaledVector(normal, -this.up.dot(normal));
      const pull = gravityAlongGround.set(0, t.gravity / Math.max(Math.abs(t.gravity * normal.y), 1e-6), 0)
        .addScaledVector(lean, THREE.MathUtils.clamp((.12 - lean.length()) / .06, 0, 1))
        .multiplyScalar(w.load * road);
      pull.addScaledVector(normal, -pull.dot(normal));
      const standstill = THREE.MathUtils.clamp((2.5 - Math.abs(longVel)) / 1.5, 0, 1);
      const slopeHold = holdAcross ? -pull.dot(dirs.right) * (1 - sliding) * standstill : 0;
      const latForce = THREE.MathUtils.clamp(-latVel * rate * t.mass * share + slopeHold, -cap, cap);
      this.addForceAt(this.tmp.copy(dirs.right).multiplyScalar(latForce), w.contact);

      let drive = 0;
      const powered = isPoweredWheel(t.drive, i);
      const drivenCount = poweredWheelCount(t.drive, wheelCount);
      if (!this.passive && powered && input.throttle > 0 && forwardSpeed < t.maxSpeed * this.assist) {
        drive += input.throttle * engineDriveForce(t, forwardSpeed) * this.assist / drivenCount;
      }
      if (input.brake > 0) {
        // Below walking pace the brake becomes reverse, which is how a car with two pedals gets out
        // of a wall. It has to stop pushing somewhere: uncapped, holding the brake on a phone -- the
        // only control there is -- quietly reverses the car up the road at a hundred and twenty.
        if (this.passive || input.parkingBrake) drive += -Math.sign(longVel) * Math.min(
          input.brake * t.brakeForce * weatherGrip / wheelCount,
          Math.abs(longVel) * t.mass / wheelCount / dt);
        else if (forwardSpeed > 0.5) {
          drive += -input.brake * t.brakeForce * weatherGrip / wheelCount;
        }
        else if (forwardSpeed > -t.maxReverseSpeed) {
          // Reverse is a gear on the same engine, so it pulls as hard as the car's own
          // low-speed drive does. A fixed 7000 N for every body left a bus, the monster truck and the
          // trailer rig rolling downhill with reverse held -- the only way off a rail on Lombard.
          if (powered) drive += -input.brake * Math.max(t.reverseForce, t.engineForce) / drivenCount;
        } else {
          /* */
          drive += input.brake * Math.min(t.brakeForce * weatherGrip / wheelCount,
            (-t.maxReverseSpeed - forwardSpeed) * t.mass / wheelCount / dt);
        }
      }
      if (input.throttle === 0 && input.brake === 0) {
        // A passive trailer has rolling resistance but no engine to brake its wheels.
        drive += this.passive
          ? -Math.tanh(longVel) * t.mass * Math.abs(t.gravity) * .015 / wheelCount
          : -longVel * 60;
      }
      if (holdAlong) {
        // The same hold along the tyre, so a car stopped at any angle on a hill stays stopped instead of
        // rolling off the lateral hold's speed band and sliding again: a real car at rest in gear or on
        // its brakes does not roll down Lombard. The speed term takes out the few centimetres a second
        // the slope term misses. A car already rolling faster than a walk keeps coasting, as before.
        // Only on a real hill (none below 2%, all from 6%). On the flat a slime or another car still
        // shoves a parked car exactly as before, and a stopped trailer rig still eases forward the way it
        // always has -- the AI queuing behind a parked car is only ever released by that movement, and
        // held dead still it waited for ever (ai-driving.spec, the rig behind a parked human).
        const onHill = THREE.MathUtils.clamp((Math.sqrt(1 - normal.y * normal.y) - .02) / .04, 0, 1) * road;
        drive -= (pull.dot(dirs.fwd) + longVel * 8 * t.mass * share) * standstill * onHill;
      }
      // One tyre, one budget. Grip spent sideways is not available for driving or braking, so a
      // wheel already at its lateral limit can only put a little power down. Without this the rear
      // can hold full cornering force and full drive at the same time, and a slide that starts under
      // power never decays: the car tracks permanently sideways down a straight.
      const used = cap > 0 ? Math.min(Math.abs(latForce) / cap, 1) : 0;
      const longLimit = longitudinalGrip(w.load, t.gripLongitudinal, weatherGrip, used, t.gripReserve);
      // This physics does not keep a separate wheel angular velocity. A longitudinal mark therefore
      // requires both a hard pedal and measurable use of the actual contact's force budget; lateral
      // sliding joins the same signal. Light braking, rolling resistance and coasting stay clean.
      const forceUse = Math.abs(drive) / Math.max(longLimit, 1);
      const deliberateForce = input.brake > .55 || (powered && input.throttle > .7);
      const longitudinal = deliberateForce
        ? THREE.MathUtils.clamp((forceUse - .08) / .22, 0, 1) : 0;
      w.skid = Math.max(sliding, longitudinal);
      this.addForceAt(
        this.tmp.copy(dirs.fwd).multiplyScalar(THREE.MathUtils.clamp(drive, -longLimit, longLimit)),
        w.contact,
      );
    }

    // Aerodynamic resistance belongs to each body, so an attached trailer adds real load
    // through its hitch even when the towing car's engine is unchanged.
    if (t.airResistance) {
      this.tmp.copy(this.vel); this.tmp.y = 0;
      this.addForce(this.tmp.multiplyScalar(-t.airResistance * this.tmp.length()));
    }

    this.applyAntiRoll(compressions);

    if (groundedCount > 0 && !this.passive) {
      // downforce is what keeps a fast car planted without making a slow one feel heavy
      this.addForce(this.tmp.copy(this.up).multiplyScalar(-t.downforce * speed * speed));

      // Steering assist: push the car toward the rate of turn the steering angle actually asks for.
      // Without it the car either spins on full lock or has to be given so little grip that it never
      // rotates. With it, the rear pair having less grip than the front produces a drift that holds
      // its angle instead of becoming a spin.
      // The assist is a limiter, not a driver. Turning is the front tyres' job; all this does is
      // refuse to let the car rotate faster than the steering asked for, which is what stops a spin.
      // Driving the yaw rate directly instead makes the car pivot without changing direction.
      const excess = Math.abs(this.ang.y) - Math.abs(wantedYaw);
      const raw = excess > 0
        ? -Math.sign(this.ang.y) * excess * t.yawAssist
        : (wantedYaw - this.ang.y) * t.yawAssist * t.yawAssistBuild;
      const limit = t.yawAssistMax * t.mass;
      let torque = THREE.MathUtils.clamp(raw * t.mass, -limit, limit);
      // Hold the drift at an angle instead of letting it become a spin. The yaw limiter above caps
      // how fast the car rotates; this caps how far the nose gets away from where the car is going,
      // which is the thing a driver actually feels and the thing that decides spin or drift.
      // Damped as well as sprung: under braking the front tyres carry more load than the rears and
      // make a yaw moment into the corner that a proportional term alone answers too late.
      if (speed > 4) {
        const cap = t.maxSlipAngle;
        const over = Math.abs(slipAngle) - cap;
        if (over > 0) {
          const growing = Math.max(Math.sign(slipAngle) * slipRate, 0);
          torque -= Math.sign(slipAngle) * (over * t.slipRecover + growing * t.slipDamp) * t.mass;
        }
      }
      this.body.addTorque({ x: 0, y: torque * (groundedCount / wheelCount), z: 0 }, true);
    }

    // Assist a recoverable lean, but stop beyond the body's recovery limit: a severe impact
    // can still overturn the vehicle, leaving the explicit reset to restore it.
    const tilt = Math.acos(THREE.MathUtils.clamp(this.up.dot(UP), -1, 1));
    if (tilt > t.uprightLimit && tilt < t.uprightRecoveryLimit) {
      const axis = this.tmp3.crossVectors(this.up, UP);
      const len = axis.length();
      if (len > 1e-4) {
        axis.divideScalar(len);
        const gain = groundedCount > 0 ? t.uprightGround : t.uprightAir;
        const push = ((tilt - t.uprightLimit) * gain - axis.dot(this.ang) * t.uprightDamp) * t.mass;
        this.body.addTorque({ x: axis.x * push, y: axis.y * push, z: axis.z * push }, true);
      }
    }

    this.trackTipping(dt);
    this.powertrain = updatePowertrain(this.powertrain, forwardSpeed, input.throttle,
      t.maxSpeed, groundedCount > 0, dt, t.redlineRpm);
    this.lastPosition.copy(this.positionRef);
    this.physics.recordCarVelocity(this.collider, this.body.linvel());
  }

  /** Put the car back on the road facing the right way, with no momentum. */
  reset(pos: [number, number, number], yaw: number): void {
    pos = [pos[0], pos[1] + this.lift, pos[2]];
    this.physics.setBodyPosition(this.body, { x: pos[0], y: pos[1], z: pos[2] });
    this.body.setRotation(yawQuat(yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.lastVel.set(0, 0, 0);
    this.collisions = [];
    this.hardContacts.clear();
    this.surfaceSlick = 0;
    for (const state of this.wheelSurfaces) state.slick = 0;
    this.physics.takeCarCollisions(this.collider);
    this.impact = 0;
    this.impactFeedback = null;
    this.wallContact = false;
    this.wallSideGrace = 0;
    this.lastPosition.set(...pos);
    this.braking = 0;
    this.powertrain = powertrainTarget(0, 0, this.tuning.maxSpeed, true, this.tuning.redlineRpm);
    this.steerAngle = 0;
    this.wheelYaw = 0;
    for (const wheel of this.wheels) {
      wheel.grounded = false; wheel.compression = 0; wheel.load = 0; wheel.slip = 0; wheel.skid = 0;
    }
    this.tippedFor = 0;
    this.resetRevision++;
  }

  private blendSurface(index: number, target: SurfaceSample, dt: number): void {
    const state = this.wheelSurfaces[index]!;
    const tau = target.slick > state.slick ? 0.04 : 0.18;
    const alpha = 1 - Math.exp(-dt / tau);
    state.slick += (target.slick - state.slick) * alpha;
  }

  /** How level the car is: 1 upright, 0 on its side, -1 on its roof. */
  get upright(): number {
    return this.up.dot(UP);
  }

  /** True once the car has been upside down long enough that it will not recover on its own. */
  get stuckUpsideDown(): boolean {
    return this.tippedFor >= UPRIGHT_SECONDS;
  }

  private trackTipping(dt: number): void {
    const upright = this.up.dot(UP);
    this.tippedFor = upright < UPRIGHT_LIMIT ? this.tippedFor + dt : 0;
  }

  private applyAntiRoll(compressions: number[]): void {
    const t = this.tuning;
    for (let l = 0; l + 1 < this.wheels.length; l += 2) {
      const r = l + 1;
      const diff = (compressions[l] ?? 0) - (compressions[r] ?? 0);
      if (diff === 0) continue;
      const force = diff * t.antiRoll;
      const wl = this.wheels[l]!;
      const wr = this.wheels[r]!;
      if (wl.grounded) this.addForceAt(this.tmp.copy(this.up).multiplyScalar(-force), wl.contact);
      if (wr.grounded) this.addForceAt(this.tmp.copy(this.up).multiplyScalar(force), wr.contact);
    }
  }

  private readTransform(): void {
    const r = this.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    const p = this.physics.bodyPosition(this.body);
    this.pos.set(p.x, p.y, p.z);
    this.fwd.set(0, 0, -1).applyQuaternion(this.q);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
  }

  /** Velocity of the point on the body at `point`, including rotation. */
  private contactVelocity(point: THREE.Vector3): THREE.Vector3 {
    const v = this.body.velocityAtPoint(this.physics.toLocal(point));
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  private addForceAt(force: THREE.Vector3, point: THREE.Vector3): void {
    this.body.addForceAtPoint({ x: force.x, y: force.y, z: force.z }, this.physics.toLocal(point), true);
  }

  private addForce(force: THREE.Vector3): void {
    this.body.addForce({ x: force.x, y: force.y, z: force.z }, true);
  }
}

export function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
