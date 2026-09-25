import type { CarInput } from '../physics/Car';
import type { CarTuning } from '../physics/CarTuning';
import type { Spline } from '../track/Spline';
import { delta, type Projection } from '../track/Progress';
import { WEDGED_SPEED } from '../track/Race';
import { slimeLane, type SlimeTarget } from './SlimeDriving';
import { planTraffic, REVERSE_SPEED_MS, TRAFFIC_HEADWAY, type TrafficBody } from './Traffic';

export interface AutopilotSettings {
  slimeSkill?: number;
  /**
   * AI racers never slow down for a slime -- the player wants the fastest finish, not the
   * fewest hits. They still take a clear lane around a harmful one, because that measured faster than
   * driving through it (800 m slime road: 20.2 s dodging, 41.6 s straight through bursts and poppers).
   * The acceptance autopilot keeps its slow approach, so route tests stay boring.
   */
  keepSpeedForSlimes?: boolean;
  trafficHeadway: number;
  /** how far ahead to aim, in seconds of travel, and never less than this many meters */
  lookAheadSeconds: number;
  minLookAhead: number;
  /** steering gain applied to the sideways error to the aim point */
  steerGain: number;
  /** the driver never asks for more lock than this; full lock is left for getting unstuck */
  maxSteerInput: number;
  /** cornering budget in m/s^2; the speed target comes from this and the curvature ahead */
  corneringAccel: number;
  /** fraction of the vehicle's measured steering-transition speed the driver is willing to use */
  steeringSpeedFraction: number;
  /** Response reserve for arcs tighter than the normal pursuit horizon. */
  tightSteeringSpeedFraction: number;
  topSpeed: number;
  /** brake once travelling this much faster than the target */
  brakeMargin: number;
  /** braking the driver counts on when planning, m/s^2; below what the car can actually do */
  brakingAccel: number;
  /** hard cap on how far ahead the speed profile looks, meters */
  maxScan: number;
  /** the target speed never falls below this, so the driver always keeps moving */
  minSpeed: number;
  /** deceleration budget when pulling up at a delivery point, m/s^2 */
  stopDecel: number;
  /** let go of the brake at a delivery point once the car is slower than this, m/s */
  stopRelease: number;
  /** below this speed for this long counts as stuck */
  stuckSpeed: number;
  stuckSeconds: number;
  /** Space left before braking for a solid elastic slime. */
  avoidClearance: number;
  /** Maximum traffic-lane target movement per second, metres. */
  avoidShiftRate: number;
  /** Deliberately dull speed while changing lanes or approaching elastic slime, m/s. */
  avoidSpeed: number;
  /**
   * Edge recovery speed: the pace near a rail and the threshold for recovering grip first. Defaults to
   * avoidSpeed raised the hard overtaking speed without raising this (at the raised value a
   * hard jeep reached the start-grid rail).
   */
  railAvoidSpeed?: number;
  /** Speed allowed after the body has aligned with a clear passing lane. */
  passingSpeed: number;
}

/** Inside this distance of its stop point a driven car holds still (ceiling 0) instead of creeping on. */
export const STOP_HOLD_DISTANCE = 6;

export type SpeedLimit = 'top' | 'corner' | 'steering' | 'pursuit' | 'lane' | 'recovery' | 'edge' | 'traffic' | 'stop' | 'slime';

/** Heading error from the road above which the pursuit aims closer, radians (25 degrees). */
export const ALIGN_ERROR_RAD = 25 * Math.PI / 180;
/** Share of the minimum look-ahead used while that error lasts. */
export const ALIGN_LOOKAHEAD_SHARE = .5;

export const AUTOPILOT: AutopilotSettings = {
  trafficHeadway: TRAFFIC_HEADWAY,
  lookAheadSeconds: 0.95,
  minLookAhead: 12,
  steerGain: 1.8,
  maxSteerInput: 0.8,
  // An acceptance driver needs margin for rail contacts, elevation and streamed collider timing.
  // Planning at roughly 1 g keeps it boring; the previous 2 g target intermittently left the
  // 12-metre Mission Peak road at 125 km/h even though the same run often happened to survive.
  corneringAccel: 10,
  steeringSpeedFraction: .5,
  tightSteeringSpeedFraction: .5,
  topSpeed: 72,
  minSpeed: 7,
  stopDecel: 6,
  stopRelease: 1.0,
  brakeMargin: 1.05,
  // Plan on the braking that is still available while turning, not the four-tyre straight-line
  // maximum. On San Tomas the old 15 m/s² promise delayed braking until the 90-degree ramp; the
  // tyres then spent their grip turning and the car arrived at the rail at more than 120 km/h.
  brakingAccel: 8,
  maxScan: 420,
  stuckSeconds: 2.5,
  stuckSpeed: WEDGED_SPEED,
  avoidClearance: 0.9,
  avoidShiftRate: 1.5,
  avoidSpeed: 20,
  passingSpeed: 20,
};

/** Plan below the selected vehicle's physical limits, including avoidance lane changes. */
export function autopilotSettingsFor(tuning: CarTuning): AutopilotSettings {
  const avoidSpeed = Math.min(AUTOPILOT.avoidSpeed, Math.sqrt(tuning.maxLateralAccel * 20));
  return { ...AUTOPILOT,
    topSpeed: Math.min(AUTOPILOT.topSpeed, tuning.maxSpeed),
    // Leave braking margin for bends and downhill approaches after per-car brake calibration.
    brakingAccel: Math.min(AUTOPILOT.brakingAccel, tuning.brakeForce / tuning.mass * .5),
    stopDecel: Math.min(AUTOPILOT.stopDecel, tuning.brakeForce / tuning.mass * .5),
    corneringAccel: Math.min(AUTOPILOT.corneringAccel, tuning.maxLateralAccel * .5),
    avoidSpeed, passingSpeed: avoidSpeed,
    minSpeed: 4,
  };
}

export interface CarView {
  raceTime?: number;
  lap?: number;
  x: number;
  z: number;
  speed: number;
  /** speed along the nose, signed: negative means the car is going backwards */
  forwardSpeed: number;
  /** unit heading on the ground */
  headingX: number;
  headingZ: number;
  gripping?: boolean;
  /** The weather's tyre grip, 1 dry; the plan brakes and corners on what the road actually gives. */
  weatherGrip?: number;
  slimeAhead?: number | null;
  steeringTransitionSpeed?: (from: number, to: number, distance: number) => number;
  steeringInputForCurvature?: (curvature: number) => number;
  steeringSpeedLimit?: (curvature: number, distance: number) => number;
}

/**
 * A driver good enough to prove the track is finishable.
 *
 * Pure pursuit plus a speed target read from the curvature ahead. It is not meant to be fast, it is
 * meant to be boring and repeatable: every version gate asks whether a car can still get from the
 * start to the finish, and a human answering that by hand would answer it differently every time.
 */
export class Autopilot {
  private stuckFor = 0;
  private reversing = 0;
  private avoidOffset = 0;
  waitingForTraffic = false;
  trafficWaitSeconds = 0;
  trafficFollowing = false;
  /** Which speed ceiling decided this frame's throttle. */
  limit: SpeedLimit = 'top';
  /** Catch-up for a car whose physics carries the same `Car.assist`; plans on the extra pace. */
  assist = 1;
  private trafficManeuver = false;

  constructor(
    private readonly spline: Spline,
    readonly settings: AutopilotSettings = AUTOPILOT,
  ) {}

  get stuck(): boolean {
    return this.stuckFor >= this.settings.stuckSeconds;
  }

  reset(): void {
    this.stuckFor = 0;
    this.reversing = 0;
    this.avoidOffset = 0;
    this.waitingForTraffic = false;
    this.trafficWaitSeconds = 0;
    this.trafficFollowing = false;
    this.trafficManeuver = false;
  }

  /**
   * @param stopAhead distance to the next delivery point, or null when there is not one next.
   */
  drive(
    dt: number,
    car: CarView,
    at: Projection,
    stopAhead: number | null = null,
    traffic?: { own: readonly TrafficBody[]; bodies: readonly TrafficBody[]; slimes?: readonly SlimeTarget[] },
  ): CarInput {
    // Catch-up scales pace and grip plans braking and cornering on the grip the weather
    // leaves (planning on dry numbers in Lombard snow, grip .62, ran the 0.7-scale sedan 11 m wide).
    const a = this.assist, grip = Math.min(1, car.weatherGrip ?? 1), base = this.settings;
    const s = a === 1 && grip === 1 ? base : { ...base, topSpeed: base.topSpeed * a, passingSpeed: base.passingSpeed * a,
      avoidSpeed: base.avoidSpeed * a, corneringAccel: base.corneringAccel * a * grip,
      brakingAccel: base.brakingAccel * a * grip, stopDecel: base.stopDecel * grip };
    const sampleDistance = (index: number): number => {
      const a = this.spline.wrapIndex(index), b = this.spline.wrapIndex(index + 1);
      return Math.max(0, delta(this.spline.s[a]!, this.spline.s[b]!, this.spline.length, this.spline.closed));
    };

    const preferred = traffic && s.slimeSkill && traffic.slimes
      ? slimeLane(this.spline, at, traffic.own, traffic.bodies, traffic.slimes,
        car.speed, s.brakingAccel, this.avoidOffset, s.slimeSkill) : 0;
    const trafficPlan = traffic ? planTraffic(this.spline, at, traffic.own, traffic.bodies,
      car.speed, s.brakingAccel, this.avoidOffset, preferred, s.trafficHeadway) : null;
    // At walking pace, a twelve-metre aim point cannot turn around a car six metres ahead.
    // Keep normal pursuit at speed; a slow passing manoeuvre uses a nearby point in its free lane.
    if (trafficPlan?.reverse) this.trafficManeuver = true;
    if (!trafficPlan?.following) this.trafficManeuver = false;
    const closePass = this.trafficManeuver && trafficPlan && car.speed < 5
      && Math.abs(trafficPlan.offset - at.lateral) > .5;
    // Far off the road's direction, a twelve-metre aim point asks for too gentle an arc: leaving the
    // reverse Moffett median gap 64 degrees across the road, the 0.7-scale sports car steered at half
    // lock and crossed 6.7 m of road before it was straight. Aim closer while the heading
    // error is large, so the same pursuit law turns the car back before it reaches the edge.
    const roadTangent = this.spline.tangent(at.index);
    const headingError = Math.acos(clamp(car.headingX * roadTangent[0] + car.headingZ * roadTangent[2], -1, 1));
    const aimShrink = headingError > ALIGN_ERROR_RAD ? ALIGN_LOOKAHEAD_SHARE : 1;
    const lookAhead = Math.max(closePass ? Math.max(4, 2 * Math.max(...traffic!.own.map(body => body.halfLength))) : s.minLookAhead * aimShrink, car.speed * s.lookAheadSeconds);
    // A distant point across a right-angle bend aims through its inner guardrail. Limit the
    // accumulated bend in the pursuit horizon, while the independent braking scan stays long.
    // Keep half the low-speed horizon: a single two-metre sample can sit beneath the enlarged
    // chassis at a hairpin, delaying steering until the car has already crossed the outer rail.
    let targetSteps = 0, targetDistance = 0, bend = 0;
    const maxPursuitBend = Math.PI / 6;
    for (let k = 1; k < this.spline.count; k++) {
      const segment = sampleDistance(at.index + k - 1);
      if (!segment) break;
      targetSteps = k;
      targetDistance += segment;
      bend += Math.abs(this.spline.curvature[this.spline.wrapIndex(at.index + k)] ?? 0) * segment;
      if (targetDistance >= lookAhead || (bend > maxPursuitBend && targetDistance >= s.minLookAhead / 2)) break;
    }
    const targetIndex = this.spline.wrapIndex(at.index + targetSteps);
    const target = this.spline.point(targetIndex);
    // Other vehicles may need a passing lane. Colossi deliberately stay on the racing line: the
    // apocalypse route is authored so entering a giant slime is part of the drive, not an obstacle
    // the robot is allowed to bypass.
    const desiredOffset = trafficPlan?.offset ?? 0;
    const avoiding = Math.abs(desiredOffset) > 1e-6;
    const shift = s.avoidShiftRate * dt;
    this.avoidOffset += clamp(desiredOffset - this.avoidOffset, -shift, shift);
    const targetRight = this.spline.right(targetIndex);
    target[0] += targetRight[0] * this.avoidOffset;
    target[2] += targetRight[2] * this.avoidOffset;

    // sideways error to the aim point, in the car's own frame: positive means it lies to the right
    const dx = target[0] - car.x;
    const dz = target[2] - car.z;
    const len = Math.hypot(dx, dz) || 1;
    const rightX = -car.headingZ;
    const rightZ = car.headingX;
    const lateral = (dx * rightX + dz * rightZ) / len;
    const pursuitCurvature = 2 * lateral / len;
    // The vehicle already limits its calibrated wheel angle. Applying the generic 80% cap again
    // prevents long-wheelbase vehicles from following physically reachable hairpins.
    const steer = car.steeringInputForCurvature
      ? clamp(car.steeringInputForCurvature(pursuitCurvature), -1, 1)
      : clamp(lateral * s.steerGain, -s.maxSteerInput, s.maxSteerInput);

    // The speed comes from a braking profile, not from the corner underfoot. For every point within
    // stopping distance, work out how fast the car may be going there, then how fast it may be going
    // *here* and still shed the difference in time. Choosing on the current corner alone means
    // arriving at every corner too fast, braking inside it, and either spinning or crawling out.
    const stopping = Math.min(s.maxScan, (car.speed * car.speed) / (2 * s.brakingAccel) + 40);
    let scanDistance = 0;
    // No elapsed-time schedule: the corner, braking and steering ceilings below are the plan.
    let ceiling = s.topSpeed;
    let limit: SpeedLimit = 'top';
    const cap = (value: number, why: SpeedLimit) => { if (value < ceiling) { ceiling = value; limit = why; } };
    // Route curvature alone misses wheels still turned into the previous half of an S-bend.
    // Use the driver's wheel/yaw response reserve. The difficulty's corneringAccel already owns
    // the separate lateral-grip budget; do not halve that speed a second time.
    // A tight pursuit arc needs the established half-response reserve, especially for a bus.
    // Use the same bend threshold as the horizon and early wheel-slew scan below.
    const tightPursuit = Math.abs(pursuitCurvature) * s.minLookAhead > maxPursuitBend;
    const steeringFraction = tightPursuit ? s.tightSteeringSpeedFraction : s.steeringSpeedFraction;
    const pursuitCeiling = Math.min(s.topSpeed,
      (car.steeringSpeedLimit?.(pursuitCurvature, len) ?? Infinity) * steeringFraction,
      Math.abs(pursuitCurvature) > 1e-6 ? Math.sqrt(s.corneringAccel / Math.abs(pursuitCurvature)) : Infinity);
    let steeringCeiling = s.topSpeed;
    for (let k = 0; k < this.spline.count; k++) {
      const step = k ? sampleDistance(at.index + k - 1) : sampleDistance(at.index);
      if (k && !step) break;
      if (k) scanDistance += step;
      if (scanDistance > stopping && k >= 4) break;
      const signed = this.spline.turnCurvature[this.spline.wrapIndex(at.index + k)] ?? 0;
      const previous = this.spline.turnCurvature[this.spline.wrapIndex(at.index + k - 1)] ?? 0;
      // Gentle same-side sampling kinks are already covered by actual pursuit alignment.
      // Reversals and bends too tight for the normal pursuit horizon still need early wheel slew.
      const sharp = Math.max(Math.abs(previous), Math.abs(signed)) * s.minLookAhead > maxPursuitBend;
      const steeringSpeed = previous * signed < 0 || sharp
        ? car.steeringTransitionSpeed?.(previous, signed, step) ?? Infinity : Infinity;
      steeringCeiling = Math.min(steeringCeiling,
        Math.sqrt(steeringSpeed * steeringSpeed + 2 * s.brakingAccel * scanDistance));
      const curve = Math.abs(this.spline.curvature[this.spline.wrapIndex(at.index + k)] ?? 0);
      const there = curve > 1e-4 ? Math.sqrt(s.corneringAccel / curve) : s.topSpeed;
      if (there >= ceiling) continue;
      const here = Math.sqrt(there * there + 2 * s.brakingAccel * scanDistance);
      cap(here, 'corner');
    }
    // Limit the actual lane change, not the whole time spent in an overtaking lane. The target
    // settling is not enough: the body must also reach that lane before restoring road pace.
    const changingLane = (avoiding || Math.abs(this.avoidOffset) > .05)
      && (Math.abs(desiredOffset - this.avoidOffset) > .05 || Math.abs(this.avoidOffset - at.lateral) > .35);
    if (avoiding || Math.abs(this.avoidOffset) > .05) {
      cap(changingLane ? s.avoidSpeed : s.passingSpeed, 'lane');
    }
    /* */
    const recovery = Math.max(s.minSpeed, ceiling * (1 - 0.25 * clamp((Math.abs(lateral) - 0.5) / 0.5, 0, 1)));
    if (recovery < ceiling) limit = 'recovery';
    ceiling = recovery;

    // A minimum cruising speed cannot override the physical time needed to turn the wheels.
    const roadHalfWidth = Math.max(1, this.spline.halfWidth[at.index] ?? 6);
    // The ramp starts later (.70 rather than.55) so a car merely running wide is not
    // slowed while it still has road left; it saturates at the same .90 as before, so the deep edge
    // -- where this exists to save the car -- is untouched.
    const edgeOut = Math.abs(at.lateral) / roadHalfWidth;
    const edgeUse = clamp((edgeOut - 0.70) / 0.20, 0, 1);
    // Below the existing manoeuvring pace, a hairpin still needs brakes to wait for its wheels.
    // At road speed a collision-induced correction must recover grip before adding braking.
    const edgeSpeed = s.railAvoidSpeed ?? s.avoidSpeed;
    /* */
    const recoveringAtSpeed = car.speed > edgeSpeed && (edgeOut > 0.55 || car.gripping === false);
    cap(steeringCeiling, 'steering');
    if (!recoveringAtSpeed) cap(pursuitCeiling, 'pursuit');

    if (car.slimeAhead != null && !s.keepSpeedForSlimes) {
      // Slimes are mandatory encounters. Approach elastic bodies, bursts and grip loss slowly
      // enough to enter them on the racing line without turning their response into a rescue.
      const encounterSpeed = Math.min(s.avoidSpeed, 12);
      cap(Math.sqrt(encounterSpeed * encounterSpeed
        + 2 * s.brakingAccel * Math.max(0, car.slimeAhead - s.avoidClearance)), 'slime');
    }

    if (stopAhead !== null) {
      // how fast the car may still be going and still pull up in the distance left
      const room = Math.max(stopAhead - 4, 0);
      cap(Math.sqrt(2 * s.stopDecel * room), 'stop');
      if (stopAhead < STOP_HOLD_DISTANCE) { ceiling = 0; limit = 'stop'; }
    }
    // Edge recovery only closes the throttle. Using this lower ceiling for the brake decision made
    // a recoverable slide on synth-loop into a four-wheel lock and sent the car 15 m off the road.
    // Corners, giants and stops still brake against the normal planned ceiling above.
    if (trafficPlan) cap(trafficPlan.speed, 'traffic');
    this.trafficFollowing = trafficPlan?.following ?? false;
    this.waitingForTraffic = this.trafficFollowing && ceiling < .2;
    this.trafficWaitSeconds = this.waitingForTraffic ? this.trafficWaitSeconds + dt : 0;
    const brakeCeiling = ceiling;
    cap(pursuitCeiling, 'pursuit');
    if (edgeUse > 0) cap(s.minSpeed + (edgeSpeed - s.minSpeed) * (1 - edgeUse), 'edge');
    this.limit = limit;
    const throttle = car.speed < ceiling ? 1 : 0;
    // Come off the brake as soon as the car is slow enough to count as stopped.
    //
    // Below walking pace the brake is reverse -- that is how a car with two pedals gets out of a
    // wall -- and `speed` has no sign, so a driver that holds the brake "until stopped" holds it
    // through the standstill and out the other side. The car creeps backwards out of the delivery
    // point, which never counts as arriving, then drives back in, and repeats until the clock runs
    // out. Judge it on the speed along the nose, and let go well above the point where the pedal
    // changes meaning.
    const pulling = ceiling === 0 && car.forwardSpeed > s.stopRelease;
    const brake = pulling || (brakeCeiling > 0
      && car.speed > Math.max(brakeCeiling, 0.1) * s.brakeMargin)
      ? 1 : 0;

    /* */
    if (stopAhead !== null && stopAhead < -6) {
      this.stuckFor = 0;
      this.reversing = 0;
      const back = this.spline.point(this.spline.indexAt(at.s - Math.min(-stopAhead, 12)));
      const bx = back[0] - car.x, bz = back[2] - car.z;
      const curvature = 2 * (bx * rightX + bz * rightZ) / Math.max(1, bx * bx + bz * bz);
      const backSteer = car.steeringInputForCurvature
        ? clamp(car.steeringInputForCurvature(curvature), -1, 1)
        : clamp(curvature * 3, -s.maxSteerInput, s.maxSteerInput);
      const hold = car.forwardSpeed > s.stopRelease || car.forwardSpeed < -3
        || (trafficPlan !== null && !trafficPlan.reverseSafe);
      return { throttle: 0, brake: 1, steer: backSteer, parkingBrake: hold };
    }
    if (stopAhead !== null && stopAhead < 0 && car.forwardSpeed < -.05)
      return { throttle: 0, brake: 1, steer: 0, parkingBrake: true };

    // Backing up is the planner's best way on (Traffic.ts): reverse the metres it chose, at walking pace,
    // then plan again. Room behind is rechecked every step and ends the reverse at once when it closes.
    // The plan may pick reverse at any speed -- going back is scored like every other way on. Engaging it
    // is what waits for the car to be nearly stopped: rolling forward, the same knot is a braking problem,
    // and a reverse begun mid-pass would hold the brakes down with the wheel straight through a bend.
    if (trafficPlan?.reverse && this.reversing <= 0 && car.forwardSpeed < REVERSE_SPEED_MS)
      this.reversing = Math.min(3, (trafficPlan.reverseMetres ?? 6) / 2);
    if (trafficPlan && !trafficPlan.reverseSafe) this.reversing = 0;
    if (this.reversing > 0) {
      this.reversing -= dt;
      this.waitingForTraffic = false;
      // Back out the way a driver does: wheel turned so the nose swings toward the line the plan chose,
      // which going backwards means steering away from it. Reversing dead straight left the whole
      // sideways move to be made going forward, in road the car had just used up.
      const swing = trafficPlan ? clamp((at.lateral - trafficPlan.offset) / 2, -1, 1) : -steer;
      if (trafficPlan && car.forwardSpeed <= -3)
        return { throttle: 0, brake: 1, steer: swing, parkingBrake: true };
      return { throttle: 0, brake: 1, steer: swing };
    }

    // Arrest backward motion before steering along a forward pursuit arc. Engine thrust alone
    // can take tens of metres on a slope; the ordinary brake pedal would accelerate reverse.
    if (trafficPlan && car.forwardSpeed < -.5)
      return { throttle: 0, brake: 1, steer: 0, parkingBrake: true };

    // A queue is an intentional stop. Hold it without entering the low-speed reverse pedal mode.
    if (this.waitingForTraffic) {
      this.stuckFor = 0; this.reversing = 0;
      return { throttle: 0, brake: 1, steer, parkingBrake: true };
    }

    // standing still on purpose at a delivery point is not being stuck
    this.stuckFor = car.speed < s.stuckSpeed && ceiling > 0 ? this.stuckFor + dt : 0;
    // being wedged against something is the one failure a pure-pursuit driver cannot steer out of,
    // so back up briefly with the wheel turned the other way and try again
    if (this.stuck) {
      this.stuckFor = 0;
      this.reversing = 1.2;
      return { throttle: 0, brake: 1, steer: -steer };
    }

    return { throttle, brake, steer };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
