import * as THREE from 'three';
import { Autopilot, autopilotSettingsFor, STOP_HOLD_DISTANCE } from '../bot/Autopilot';
import { Car, type CarInput } from '../physics/Car';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Trailer } from '../physics/Trailer';
import { Race } from '../track/Race';
import { Progress, projectOnSample, delta } from '../track/Progress';
import { Spline } from '../track/Spline';
import type { CarKind, TrackData } from '../track/types';
import { trailerRestOffset, vehicleTuning, type VehicleDefinition } from '../vehicles/catalogue';
import { VehicleModel } from '../vehicles/VehicleModel';
import { ChaseCamera, vehicleChase } from '../world/ChaseCamera';
import { RenderPose } from './RenderPose';
import { paceSeconds, type DriverRole } from './roster';
import { planTraffic, type TrafficBody } from '../bot/Traffic';
import { aiSettingsFor, type AiDifficulty } from '../bot/difficulty';

export interface ResetRecord {
  reason: 'off-track' | 'wedged' | 'upside-down' | 'manual' | 'unknown';
  progress: number;
  time: number;
  lateral?: number;
  halfWidth?: number;
  speedKmh?: number;
}

export interface ParkingState {
  slot: number;
  target: [number, number, number];
  distance: number;
  stopped: boolean;
  /** Placed in the berth after stalling, rather than driven there. */
  rescued: boolean;
}

export const PARKING_FIRST_ROW_DISTANCE = 24;
/** A finished AI standing without closing on its berth this long (three times as long while still manoeuvring) is placed in it. */
export const PARKING_RESCUE_SECONDS = 30;
/** How long a blocked reverse is waited out before the parker turns forward instead. */
export const PARKING_REVERSE_WAIT_SECONDS = 3;
/**
 * Where a driven player car (the robot) aims to stand after the line. It has to lie beyond the autopilot's
 * hold distance: at 5.5 m the hold began 0.5 m before the line, and a slow car creeping up could come to
 * rest there and never finish (0.8 version gate: the retro-van stood 1 m short on Fisherman's Wharf for
 * 4810 s of race time).
 */
export const FINISH_ROLLOUT_DISTANCE = STOP_HOLD_DISTANCE + 2.5;

/** A vehicle combination belongs to one driver; the scene, clock and road belong to the session. */
export class Racer {
  readonly car: Car;
  autopilot = false;
  waitingForRoad = false;
  readonly resetLog: ResetRecord[] = [];
  notice = '';
  noticeUntil = 0;
  input: CarInput = { throttle: 0, brake: 0, steer: 0 };
  readonly trailer: Trailer | null;
  bot: Autopilot;
  race: Race;
  readonly chase: ChaseCamera;
  readonly renderPose: RenderPose;
  readonly trailerPose: RenderPose | null;
  private disposed = false;
  private parking: { slot: number; target: THREE.Vector3; tangent: THREE.Vector3;
    lateral: number; stopped: boolean; repositioning: boolean;
    guide: Spline | null; progress: Progress | null; distance: number;
    closest: number; stalled: number; rescued: boolean; reverseBlocked: number } | null = null;

  constructor(readonly id: string, readonly vehicle: VehicleDefinition,
    readonly model: VehicleModel, readonly trailerModel: VehicleModel | null,
    private readonly physics: PhysicsWorld, private readonly scene: THREE.Scene,
    private readonly track: TrackData, private readonly spline: Spline,
    readonly spawn: TrackData['start'], readonly role: DriverRole = 'human',
    readonly difficulty: AiDifficulty = 'rush', private readonly night = false) {
    const tuning = vehicleTuning(vehicle, vehicle.tuning as CarKind);
    this.car = new Car(physics, tuning, spawn);
    this.trailer = vehicle.trailer ? new Trailer(physics, this.car, vehicle) : null;
    this.race = new Race(track, spline, tuning.chassisHalf[0]);
    this.race.reacquire(spawn.pos[0], spawn.pos[2]);
    this.bot = new Autopilot(spline, role === 'ai' ? aiSettingsFor(tuning, difficulty, this.towedMass)
      : autopilotSettingsFor(tuning, this.towedMass));
    this.chase = new ChaseCamera(vehicleChase(vehicle, track.camera?.heightM));
    this.renderPose = new RenderPose(this.car);
    this.trailerPose = this.trailer ? new RenderPose(this.trailer.car) : null;
    scene.add(model.group);
    if (trailerModel) scene.add(trailerModel.group);
  }

  get mesh(): THREE.Group { return this.model.group; }

  /** What the tractor's brakes also have to stop: the trailer's mass, or 0 without one. */
  get towedMass(): number { return this.trailer?.car.tuning.mass ?? 0; }

  get parkingState(): ParkingState | null {
    if (!this.parking) return null;
    const p = this.car.position;
    return { slot: this.parking.slot, target: this.parking.target.toArray() as [number, number, number],
      distance: Math.hypot(p.x - this.parking.target.x, p.z - this.parking.target.z),
      stopped: this.parking.stopped, rescued: this.parking.rescued };
  }

  /**
   * Earlier finishers take the far spots, so nobody has to drive through an already parked car.
   * Alternating shoulders leave the centre open; one row per finisher keeps buses and trailers apart.
   * A player who finishes while a partner is still racing parks too: braked on the line,
   * the car stood solid in front of everyone still coming.
   */
  beginParking(slot: number): void {
    if (this.parking) return;
    const distance = PARKING_FIRST_ROW_DISTANCE + slot * 12;
    const guide = this.track.endRoads && !this.spline.closed
      ? new Spline({...this.track, spline: this.track.endRoads.finish}) : null;
    const path = guide ?? this.spline;
    const index = guide || this.spline.closed ? path.indexAt(distance) : path.count - 1;
    const point = path.point(index);
    const tangent = new THREE.Vector3(...path.tangent(index)).normalize();
    if (!this.spline.closed && !guide) {
      point[0] += tangent.x * distance;
      point[1] += tangent.y * distance;
      point[2] += tangent.z * distance;
    }
    const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const roadHalf = path.halfWidth[index] ?? 6;
    const room = Math.max(0, roadHalf - this.car.tuning.chassisHalf[0] - .8);
    const lateral = Math.min(Math.max(1.6, roadHalf * .52), room) * (slot % 2 ? -1 : 1);
    const target = new THREE.Vector3(...point).addScaledVector(right, lateral);
    const progress = guide ? new Progress(guide) : null;
    progress?.reacquire(this.car.position.x, this.car.position.z);
    this.parking = { slot, target, tangent, lateral, stopped: false, repositioning: false,
      guide, progress, distance, closest: Infinity, stalled: 0, rescued: false, reverseBlocked: 0 };
    this.waitingForRoad = false;
  }

  /** Continue beyond the finish, pull into the assigned lane, then hold the real physics body. */
  parkingInput(traffic: { own: readonly TrafficBody[]; bodies: readonly TrafficBody[] } | undefined, dt: number): CarInput {
    if (this.race.state !== 'finished' || !this.parking) {
      return { throttle: 0, brake: 1, steer: 0, parkingBrake: true };
    }
    if (this.parking.stopped) return this.holdParked();
    const p = this.car.position;
    const dx = this.parking.target.x - p.x, dz = this.parking.target.z - p.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 2.5) {
      this.parking.stopped = true;
      return this.holdParked();
    }
    const closer = distance < this.parking.closest - 1;
    if (closer) { this.parking.closest = distance; this.parking.stalled = 0; }
    const path = this.parkingPath;
    const index = this.parking.progress?.update(p.x, p.z).index ?? this.race.progress.value.index;
    const projection = projectOnSample(path, index, p.x, p.z);
    const trafficPlan = traffic ? planTraffic(path, projection, traffic.own, traffic.bodies,
      this.car.speed, this.bot.settings.brakingAccel, this.parking.lateral,
      this.parking.lateral, this.bot.settings.trafficHeadway) : null;
    let aim = this.parking.target;
    let aimTangent = this.parking.tangent;
    if (this.parking.guide && this.parking.progress && distance > 5) {
      const at = this.parking.progress.update(p.x, p.z).s;
      const index = this.parking.guide.indexAt(Math.min(this.parking.distance, Math.max(0, at) + 10));
      aimTangent = new THREE.Vector3(...this.parking.guide.tangent(index));
      aim = new THREE.Vector3(...this.parking.guide.point(index))
        .addScaledVector(new THREE.Vector3(-aimTangent.z, 0, aimTangent.x).normalize(), this.parking.lateral);
    }
    const right = new THREE.Vector3(-aimTangent.z, 0, aimTangent.x).normalize();
    const offset = (trafficPlan?.offset ?? this.parking.lateral) - this.parking.lateral;
    const aimX = aim.x + right.x * offset;
    const aimZ = aim.z + right.z * offset;
    const aimDx = aimX - p.x, aimDz = aimZ - p.z;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.car.quaternion);
    const length = Math.max(Math.hypot(aimDx, aimDz), 1);
    const sideways = (aimDx * -forward.z + aimDz * forward.x) / length;
    const curvature = 2 * sideways / length;
    const steer = this.car.steeringInputForCurvature(curvature);
    // A berth beside the car is still far away: longitudinal distance alone can drop
    // the speed ceiling to zero while a large lateral error remains.
    const room = Math.max(distance - 1.2, 0);
    // Queueing behind a parker that is still moving is waiting, not being stuck: it does not advance the
    // rescue clock. Following a body that will never move again (already parked) still counts.
    const queueMoving = !!trafficPlan?.following && !!traffic?.bodies.some(body => body.driver !== this.id
      && Math.abs(body.speed) > .3 && Math.abs(body.s - projection.s) < 40);
    // A car still manoeuvring (backing and filling) gets three times as long as one standing still.
    if (!closer && !queueMoving) this.parking.stalled += this.car.speed < 1 ? dt : dt / 3;
    // Parking keeps the careful manoeuvring speed; the hard tier's faster overtaking change is not for berths.
    const ceiling = Math.min(this.bot.settings.railAvoidSpeed ?? this.bot.settings.avoidSpeed,
      Math.sqrt(2 * this.bot.settings.stopDecel * room), trafficPlan?.speed ?? Infinity);
    const ahead = aimDx * forward.x + aimDz * forward.z;
    // A target inside a long vehicle's minimum turning circle cannot be reached by circling
    // it. Back straight to make room, then approach again with an achievable steering angle.
    if (Math.abs(steer) > .95) this.parking.repositioning = true;
    else if (ahead > 2.5 && Math.abs(steer) < .6) this.parking.repositioning = false;
    const reversing = this.parking.repositioning || ahead < -1.2;
    // Queue behind the car in front only when the way on is forward. A car that has to back up is not
    // held by what stands ahead of it.
    if (!reversing && trafficPlan?.following && ceiling < .2 && this.car.speed < .35) {
      return { throttle: 0, brake: 1, steer: 0, parkingBrake: true };
    }
    // Backing up is the way out only while the space behind is free. A car behind usually moves on
    // within a moment; one that has blocked the reverse for seconds makes holding the brake a deadlock,
    // so turn forward on full lock instead.
    const reverseBlocked = trafficPlan !== null && !trafficPlan.reverseSafe;
    this.parking.reverseBlocked = reversing && reverseBlocked ? this.parking.reverseBlocked + dt : 0;
    if (reversing && this.parking.reverseBlocked < PARKING_REVERSE_WAIT_SECONDS) {
      return { throttle: 0, brake: 1, steer: this.parking.repositioning ? 0 : steer,
        parkingBrake: this.car.forwardSpeed < -Math.min(3, ceiling) || reverseBlocked };
    }
    const brake = this.car.forwardSpeed > Math.max(ceiling, .5) ? 1 : 0;
    const throttle = brake ? 0 : this.car.speed < ceiling * .95 ? 1 : 0;
    // Pure pursuit uses the same wheel angle in reverse; reversing already changes yaw sign.
    return { throttle, brake, steer };
  }

  /** The berth to place a stalled parker in, once it is due and nobody stands on it. */
  parkingRescue(racers: readonly Racer[]): TrackData['start'] | null {
    if (!this.parking || this.parking.stopped || this.parking.stalled < PARKING_RESCUE_SECONDS) return null;
    const { target, tangent } = this.parking;
    // Land at the ride height the stalled car is standing at, not the spawn height: holding a parked car
    // still every frame turns a 0.2 m drop into a second of reported "stopped" at ~1 km/h.
    const p = this.car.position;
    // Probe only around each height, so a bridge deck or landmark overhead is not mistaken for the road.
    const under = this.physics.surfaceAt(p.x, p.z, p.y + 1, p.y - 4);
    const floor = this.physics.surfaceAt(target.x, target.z, target.y + 2, target.y - 3);
    const y = under && floor ? floor.point.y + p.y - under.point.y : target.y + .8;
    const berth = { pos: [target.x, y, target.z] as TrackData['start']['pos'],
      yaw: Math.atan2(-tangent.x, -tangent.z) };
    return this.spotClear(berth, racers) ? berth : null;
  }

  settleInBerth(): void {
    if (!this.parking) return;
    this.parking.stopped = true;
    this.parking.rescued = true;
    this.holdParked();
  }

  private holdParked(): CarInput {
    // The parking brake settles ordinary motion, but a late neighbour contact can leave a tiny
    // velocity between physics steps. A finished racer owns this berth, so keep its connected
    // bodies at rest instead of letting the final grid creep after it has reported "stopped".
    for (const car of [this.car, ...(this.trailer ? [this.trailer.car] : [])]) {
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    return { throttle: 0, brake: 1, steer: 0, parkingBrake: true };
  }

  reset(): void {
    this.parking = null;
    this.resetLog.length = 0;
    this.notice = ''; this.noticeUntil = 0;
    this.car.reset([...this.spawn.pos], this.spawn.yaw);
    this.trailer?.syncReset();
    this.bot.reset();
    this.chase.reset();
    this.race = new Race(this.track, this.spline, this.car.tuning.chassisHalf[0]);
    this.race.reacquire(this.spawn.pos[0], this.spawn.pos[2]);
    this.input = { throttle: 0, brake: 0, steer: 0 };
    this.renderPose.snap(this.car);
    if (this.trailer) this.trailerPose?.snap(this.trailer.car);
  }

  get parkingPath(): Spline { return this.parking?.guide ?? this.spline; }

  trafficBodies(path = this.spline): TrafficBody[] {
    const index = path === this.spline ? this.race.progress.value.index
      : new Progress(path).reacquire(this.car.position.x, this.car.position.z).index;
    const tangent = path.tangent(index), right = path.right(index);
    return [this.car, ...(this.trailer ? [this.trailer.car] : [])].map(car => {
      const p = car.position, q = car.quaternion, half = car.tuning.chassisHalf;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const across = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const extent = (axis: readonly number[]) => Math.abs(forward.x * axis[0]! + forward.z * axis[2]!) * half[2]
        + Math.abs(across.x * axis[0]! + across.z * axis[2]!) * half[0];
      const projection = projectOnSample(path, index, p.x, p.z), velocity = car.body.linvel();
      return { driver: this.id,
        pose: { x: p.x, z: p.z, headingX: forward.x, headingZ: forward.z,
          halfWidth: half[0], halfLength: half[2] },
        s: projection.s, lateral: projection.lateral, halfWidth: extent(right), halfLength: extent(tangent),
        speed: velocity.x * tangent[0] + velocity.z * tangent[2] };
    });
  }

  /** Leave another driver's whole rig undisturbed when the safe checkpoint is occupied. */
  clearResetSpot(target: TrackData['start'], racers: readonly Racer[]): TrackData['start'] | null {
    const others = racers.filter(racer => racer !== this)
      .flatMap(racer => [racer.car, ...(racer.trailer ? [racer.trailer.car] : [])]);
    if (!others.length) return target;
    const origin = new Progress(this.spline).reacquire(target.pos[0], target.pos[2]).s;
    // Back first: a spot behind costs a few metres, one ahead gains them. Forward never reaches the next gate
    // not yet cleared, which a rescue now can land close to -- put past it, the car could never clear it.
    const gate = this.race.state === 'racing' ? this.race.track.checkpoints[this.race.nextCheckpoint] : undefined;
    const room = gate ? delta(origin, gate.s, this.spline.length, this.spline.closed) - 6 : Infinity;
    const offsets = [0, ...Array.from({ length: 16 }, (_, i) => -4 * (i + 1)),
      ...Array.from({ length: 16 }, (_, i) => 4 * (i + 1)).filter(offset => offset <= room)];
    for (const offset of offsets) {
      const index = this.spline.indexAt(origin + offset);
      const tangent = this.spline.tangent(index);
      const road = this.spline.point(index);
      const candidate = offset === 0 ? target
        : { pos: [road[0], road[1] + .8, road[2]] as TrackData['start']['pos'],
          yaw: Math.atan2(-tangent[0], -tangent[2]) };
      if (this.spotClear(candidate, racers)) return candidate;
    }
    return null;
  }

  private spotClear(candidate: TrackData['start'], racers: readonly Racer[]): boolean {
    const others = racers.filter(racer => racer !== this)
      .flatMap(racer => [racer.car, ...(racer.trailer ? [racer.trailer.car] : [])]);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), candidate.yaw);
    const bodies = [{ position: new THREE.Vector3(...candidate.pos), car: this.car }];
    if (this.trailer) bodies.push({ position: new THREE.Vector3(...trailerRestOffset(this.vehicle))
      .applyQuaternion(q).add(bodies[0]!.position), car: this.trailer.car });
    return bodies.every(body => others.every(other => {
      const a = body.car.tuning.chassisHalf, b = other.tuning.chassisHalf;
      const clearance = Math.hypot(a[0], a[2]) + Math.hypot(b[0], b[2]) + 1;
      return Math.hypot(body.position.x - other.position.x, body.position.z - other.position.z) >= clearance;
    }));
  }

  get isWaitingForRoad(): boolean { return this.waitingForRoad; }

  setRoadReady(ready: boolean, driving: boolean): void {
    const changed = ready !== !this.waitingForRoad;
    this.waitingForRoad = !ready;
    for (const car of [this.car, ...(this.trailer ? [this.trailer.car] : [])]) {
      if (!ready) {
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      if (changed) {
        car.body.setEnabledTranslations(ready && driving, ready, ready && driving, true);
        car.body.setEnabledRotations(ready, ready, ready, true);
      }
    }
  }

  advancePose(): void {
    this.renderPose.advance(this.car);
    if (this.trailer) this.trailerPose?.advance(this.trailer.car);
  }

  render(alpha: number, dt: number): void {
    const pose = this.renderPose.sample(this.car, alpha);
    this.mesh.position.copy(pose.position);
    this.mesh.quaternion.copy(pose.quaternion);
    this.model.update(this.car.forwardSpeed, this.car.wheelSteeringAngle,
      this.car.wheels.map(wheel => wheel.compression), dt, this.car.poseRevision);
    this.model.setBrakeLights(this.car.braking > .04, this.night);
    if (this.trailer && this.trailerModel && this.trailerPose) {
      this.trailer.syncReset();
      const car = this.trailer.car;
      const trailerPose = this.trailerPose.sample(car, alpha);
      this.trailerModel.group.position.copy(trailerPose.position);
      this.trailerModel.group.quaternion.copy(trailerPose.quaternion);
      this.trailerModel.update(car.forwardSpeed, 0, car.wheels.map(wheel => wheel.compression), dt, car.poseRevision);
      this.trailerModel.setBrakeLights(car.braking > .04, this.night);
    }
  }

  /** Replace this car's automatic driver with an AI tier's plan. */
  driveAs(tier: AiDifficulty): void {
    this.bot = new Autopilot(this.spline, aiSettingsFor(this.car.tuning, tier, this.towedMass));
  }

  /** Distance covered along the race, laps included; the same measure the standings sort by. */
  raceDistance(): number {
    return (this.race.lap - 1) * this.spline.length + this.race.progress.value.s;
  }

  /** The hard AI's hidden catch-up, applied to its physics and its driver's plan together. */
  setAssist(assist: number): void {
    this.car.assist = assist;
    this.bot.assist = assist;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.trailer?.dispose();
    this.physics.unregisterCollider(this.car.collider);
    this.physics.takeCarCollisions(this.car.collider);
    this.physics.world.removeRigidBody(this.car.body);
    this.scene.remove(this.mesh);
    if (this.trailerModel) this.scene.remove(this.trailerModel.group);
    this.model.dispose();
    this.trailerModel?.dispose();
  }
}

/** Width a grid lane needs; a road narrower than two of these starts single file. */
export const GRID_LANE_WIDTH = 3.5;

/**
 * Starting grid.
 *
 * Humans keep the back of the grid, the first on the authored start. AI cars go ahead of them fastest
 * first, ranked by `pace` (seconds for this route; lower is faster) and otherwise by top speed. AI cars
 * alternate between the two halves of the road, so the grid is staggered rather than a column; the
 * along-route spacing is unchanged, so no two bodies can overlap whatever the lanes.
 */
export function racerSpawns(track: TrackData, spline: Spline,
  vehicles: readonly VehicleDefinition[], roles?: readonly DriverRole[],
  pace: (vehicle: VehicleDefinition) => number | undefined = () => undefined): TrackData['start'][] {
  const human = (index: number) => (roles?.[index] ?? (index ? 'ai' : 'human')) === 'human';
  const speed = (vehicle: VehicleDefinition) => paceSeconds(vehicle, pace);
  const order = vehicles.map((_, index) => index).sort((a, b) =>
    Number(human(b)) - Number(human(a)) || (human(a) ? a - b : speed(vehicles[b]!) - speed(vehicles[a]!)));
  const spawns: TrackData['start'][] = new Array(vehicles.length);
  let distance = 0;
  order.forEach((index, rank) => {
    const vehicle = vehicles[index]!;
    if (rank) {
      const previous = vehicles[order[rank - 1]!]!;
      const back = vehicle.trailer
        ? trailerRestOffset(vehicle)[2] + vehicle.trailer.size[2]! / 2 : vehicle.size[2]! / 2;
      distance += previous.size[2]! / 2 + back + 5;
    }
    if (!rank) { spawns[index] = { pos: [...track.start.pos], yaw: track.start.yaw }; return; }
    const at = spline.indexAt(distance);
    const pos = spline.point(at);
    const tangent = spline.tangent(at), right = spline.right(at);
    const half = spline.halfWidth[at] ?? 0;
    // Two grid lanes, the middle of each half of the road, alternating right and left: the centre line
    // is a two-way street's double yellow and the players' own start, so no AI car stands on it.
    if (2 * half >= 2 * GRID_LANE_WIDTH) {
      const lateral = (rank % 2 ? 1 : -1) * half / 2;
      pos[0] += right[0] * lateral; pos[2] += right[2] * lateral;
    }
    pos[1] += track.start.pos[1] - spline.point(0)[1];
    spawns[index] = { pos, yaw: Math.atan2(-tangent[0], -tangent[2]) };
  });
  return spawns;
}
