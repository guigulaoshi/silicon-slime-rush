import * as THREE from 'three';
import type { VehicleDefinition } from '../vehicles/catalogue';

export interface ChaseSettings {
  distance: number;
  height: number;
  lookAhead: number;
  lookHeight?: number;
  /** how quickly the camera catches up, per second */
  stiffness: number;
  /** vertical field of view, degrees. Vertical: on a 16:9 screen the horizontal angle is far wider
   *  (58 vertical is about 89 horizontal, 98 vertical is about 128, which is a fisheye). Past about
   *  80 the car shrinks to a few percent of the screen and the road ahead becomes a thread -- it
   *  reads as fast for a second and then it is unplayable. */
  fovLow: number;
  fovHigh: number;
  /** speed at which the field of view reaches fovHigh, m/s */
  fovSpeed: number;
  /** how far the camera swings toward where the car is actually going while it slides */
  driftLead: number;
  /** Vehicle-aware positions for the two alternate views. */
  closeDistance: number;
  closeHeight: number;
  hoodForward: number;
  hoodHeight: number;
}

export const CAMERA_MODES = ['chase', 'close', 'hood'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export interface CameraMotion {
  grounded?: boolean;
  boost?: boolean;
  reducedMotion?: boolean;
}

export interface CameraFeedback {
  mode: CameraMode;
  speed: number;
  boost: number;
  shake: number;
}

export const CHASE: ChaseSettings = {
  distance: 3.6,
  height: 1.35,
  lookAhead: 8,
  stiffness: 8.5,
  fovLow: 58,
  fovHigh: 76,
  fovSpeed: 70,
  driftLead: 0.55,
  closeDistance: 2.35,
  closeHeight: 1.08,
  hoodForward: 1.45,
  hoodHeight: 1.05,
};

/** Reserve space behind the entire combination, even before the trailer joint is installed. */
export function vehicleChase(vehicle: VehicleDefinition, trackHeight = 0): ChaseSettings {
  const trailer = vehicle.trailer;
  const rear = trailer
    ? vehicle.hitch![2]! - trailer.hitch![2]! + trailer.size[2]! / 2
    : vehicle.size[2]! / 2;
  const height = Math.max(vehicle.size[1]!, trailer?.size[1] ?? 0);
  return { ...CHASE, distance: Math.max(CHASE.distance, rear + height * 2.4 + 1), lookHeight: 0,
    height: Math.max(CHASE.height, trackHeight, height * 1.25 + (trailer ? 1 : 0)),
    closeDistance: Math.max(CHASE.closeDistance, rear + height * 1.15 + .45),
    closeHeight: Math.max(CHASE.closeHeight, height * .92 + (trailer ? .5 : 0)),
    hoodForward: Math.max(.7, vehicle.size[2]! * .43),
    hoodHeight: Math.max(.72, vehicle.size[1]! * .58) };
}

const UP = new THREE.Vector3(0, 1, 0);
// Below walking speed the velocity direction is mostly collision-solver noise. Fade it in over a
// useful range instead of switching it on at one exact speed: a crashed car can hover either side
// of any threshold for minutes.
const DRIFT_DIRECTION_START = 2;
const DRIFT_DIRECTION_FULL = 8;

/**
 * Spring chase camera.
 *
 * Two details do most of the work. The field of view opens up with speed, which is most of why a
 * game feels fast. And while the car is sideways the camera leans toward the direction of travel
 * rather than the direction the nose points, so a drift reads as a drift instead of as the world
 * swinging around.
 */
export class ChaseCamera {
  private readonly position = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly desiredDirection = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly turnStep = new THREE.Quaternion();
  private readonly shakenPosition = new THREE.Vector3();
  private readonly shakenTarget = new THREE.Vector3();
  private started = false;
  private impactAge = 0;
  private impactDuration = 0;
  private impactStrength = 0;
  private impactCount = 0;
  private mode: CameraMode = 'chase';
  private boostAmount = 0;
  private wasGrounded = true;
  private hardestFall = 0;
  private shakeAmount = 0;

  constructor(readonly settings: ChaseSettings = CHASE) {}

  /** Snap behind the car, for a race start or after a reset. */
  reset(): void {
    this.started = false;
    this.impactAge = this.impactDuration = this.impactStrength = 0;
    this.speedAmount = this.boostAmount = this.hardestFall = this.shakeAmount = 0;
    this.wasGrounded = true;
  }

  get cameraMode(): CameraMode { return this.mode; }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // A deliberate cut is clearer than dragging the old spring through the car body.
    this.started = false;
  }

  cycleMode(): CameraMode {
    this.setMode(CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]!);
    return this.mode;
  }

  get feedback(): CameraFeedback {
    return { mode: this.mode, speed: this.speedAmount, boost: this.boostAmount,
      shake: this.shakeAmount };
  }

  private speedAmount = 0;

  /** Queue one short camera kick; repeated contacts only replace it when the new hit is harder. */
  hit(strength: number): void {
    if (strength < 0.035) return;
    if (this.impactAge < this.impactDuration && strength <= this.impactStrength) return;
    this.impactStrength = THREE.MathUtils.clamp(strength, 0, 1);
    this.impactDuration = 0.11 + this.impactStrength * 0.16;
    this.impactAge = 0;
    this.impactCount++;
  }

  get hits(): number { return this.impactCount; }

  update(
    camera: THREE.PerspectiveCamera,
    carPos: THREE.Vector3,
    carQuat: THREE.Quaternion,
    velocity: THREE.Vector3,
    dt: number,
    motion: CameraMotion = {},
  ): void {
    const s = this.settings;
    this.forward.set(0, 0, -1).applyQuaternion(carQuat);
    const speed = velocity.length();
    const reduced = motion.reducedMotion ?? false;
    const grounded = motion.grounded ?? true;

    // Launch and landing are inferred from the same body motion every view consumes. A popper can
    // lift the car without generating a rigid-body wall impact, so collision events alone cannot
    // provide this feedback. The hardest downward speed while airborne makes the landing scale.
    if (!grounded) {
      if (this.wasGrounded && velocity.y > 4 && !reduced) this.hit(.24 + Math.min(velocity.y / 28, .56));
      this.hardestFall = Math.max(this.hardestFall, Math.max(0, -velocity.y));
    } else if (!this.wasGrounded) {
      if (this.hardestFall > 3 && !reduced) this.hit(Math.min(1, this.hardestFall / 18));
      this.hardestFall = 0;
    }
    this.wasGrounded = grounded;
    const feedbackK = 1 - Math.exp(-dt * (motion.boost ? 13 : 5));
    this.boostAmount += ((motion.boost && !reduced ? 1 : 0) - this.boostAmount) * feedbackK;
    this.speedAmount += ((reduced ? 0 : THREE.MathUtils.smoothstep(speed, 22, 55)) - this.speedAmount)
      * (1 - Math.exp(-dt * 5));

    const distance = this.mode === 'chase' ? s.distance
      : this.mode === 'close' ? s.closeDistance : -s.hoodForward;
    const height = this.mode === 'chase' ? s.height
      : this.mode === 'close' ? s.closeHeight : s.hoodHeight;
    const lookAhead = this.mode === 'chase' ? s.lookAhead : this.mode === 'close' ? 7 : 15;
    const lookHeight = this.mode === 'hood' ? s.hoodHeight * .75 : s.lookHeight ?? 1.2;

    // Blend the nose direction toward the travel direction while sliding. Both the amount and the
    // resulting direction are continuous: the old hard `speed > 4` branch made a car left nearly
    // sideways after a crash flip the camera by almost forty degrees whenever its speed wandered a
    // few centimetres per second either side of 4 m/s. The whole view shook although the chassis
    // itself was stable.
    this.desiredDirection.copy(this.forward);
    if (this.mode !== 'hood' && speed > DRIFT_DIRECTION_START) {
      this.look.copy(velocity).setY(0).normalize();
      const amount = THREE.MathUtils.smoothstep(
        speed, DRIFT_DIRECTION_START, DRIFT_DIRECTION_FULL,
      ) * Math.min(s.driftLead, 1);
      this.desiredDirection.lerp(this.look, amount).normalize();
    }

    const k = 1 - Math.exp(-s.stiffness * dt);
    if (this.mode === 'hood') {
      // The body moves almost a metre per frame at road speed. A chase spring may trail that move,
      // but a camera bolted to the bonnet may not: lag puts the camera inside the cabin and the car
      // suddenly fills the lower half of the supposedly first-person view.
      this.direction.copy(this.forward);
      this.desired.copy(carPos).addScaledVector(this.direction, s.hoodForward).addScaledVector(UP, height);
      this.position.copy(this.desired);
      this.started = true;
    } else if (!this.started) {
      this.direction.copy(this.desiredDirection);
      this.desired.copy(carPos).addScaledVector(this.direction, -distance).addScaledVector(UP, height);
      this.position.copy(this.desired);
      this.started = true;
    } else {
      // The same frame-rate-independent spring follows both position and look direction. Direction
      // smoothing matters most immediately after a hit, where velocity can change axis in one
      // physics step even though a camera should not.
      // Spherical rotation, not normalized lerp: opposite directions are reachable here because
      // the car can reverse above DRIFT_DIRECTION_FULL. Lerp of D and -D with k < 0.5 normalizes
      // straight back to D forever, then jumps when numerical noise finally picks a side.
      this.turn.setFromUnitVectors(this.direction, this.desiredDirection);
      this.turnStep.identity().slerp(this.turn, k);
      this.direction.applyQuaternion(this.turnStep).normalize();
      this.desired.copy(carPos).addScaledVector(this.direction, -distance).addScaledVector(UP, height);
      this.position.lerp(this.desired, k);
    }
    this.back.copy(this.direction);
    this.target.copy(carPos).addScaledVector(this.direction, lookAhead).addScaledVector(UP, lookHeight);

    this.shakenPosition.copy(this.position);
    this.shakenTarget.copy(this.target);
    this.shakeAmount = 0;
    if (this.impactAge < this.impactDuration) {
      this.impactAge = Math.min(this.impactDuration, this.impactAge + dt);
      const envelope = 1 - this.impactAge / this.impactDuration;
      if (!reduced) {
        const kick = Math.sin(this.impactAge * 92) * envelope * this.impactStrength * 0.13;
        this.shakeAmount = envelope * this.impactStrength;
        this.shakenPosition.addScaledVector(UP, kick);
        this.shakenTarget.addScaledVector(UP, -kick * 0.45);
      }
    }
    camera.position.copy(this.shakenPosition);
    camera.lookAt(this.shakenTarget);
    const t = THREE.MathUtils.clamp(speed / s.fovSpeed, 0, 1);
    const modeFov = this.mode === 'chase' ? 0 : this.mode === 'close' ? 4 : 7;
    const fov = THREE.MathUtils.lerp(s.fovLow + modeFov, s.fovHigh + modeFov, t)
      + (reduced ? 0 : this.boostAmount * 8);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}
