/**
 * The maps from what the car is doing to what it sounds like.
 *
 * These live apart from the audio graph on purpose. They are the half of the sound that is a design
 * decision rather than a wiring detail, and they are the half a headless test can inspect: an
 * AudioParam under jsdom is whatever the fake says it is, but a frequency in hertz is a number
 * either way.
 */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Road speed at which each gear reaches the limiter, m/s.
 *
 * Six of them, the last one deliberately past the sedan's 62 m/s top speed so a long straight ends
 * with the note still climbing rather than pinned flat against the redline.
 */
export { GEAR_TOPS } from '../physics/Powertrain';
import { gearIndexAt, roadRevFraction } from '../physics/Powertrain';

export const IDLE_HZ = 52;
export const REDLINE_HZ = 190;

/** Where in its rev range a fresh gear starts, which is exactly how big the drop on an upshift is. */
/**
 * Hertz added per m/s of road speed, on top of the gear model.
 *
 * A real gearbox reaches the same redline note in every gear, and modelled honestly that way sixth
 * sounds identical to second. This tilt is the lie that makes fast feel fast, and it is small
 * enough that the upshift is still plainly a drop.
 */
const SPEED_LIFT = 0.55;

/** Off the throttle the same road speed sits a little lower, which is what makes a lift audible. */
const OVERRUN = 0.94;

/** Which gear the car would be in at this speed. Reversing sounds like first, hence the abs. */
export function gearAt(speed: number): number {
  return gearIndexAt(speed);
}

/** How far up the rev range the engine is, 0 at idle and 1 at the limiter. */
export function revFraction(speed: number): number {
  return roadRevFraction(speed);
}

/** The engine note for this road speed and throttle, in hertz. */
export function engineHz(speed: number, throttle: number): number {
  const revs = IDLE_HZ + (REDLINE_HZ - IDLE_HZ) * revFraction(speed);
  const load = OVERRUN + (1 - OVERRUN) * clamp(throttle, 0, 1);
  return (revs + SPEED_LIFT * Math.abs(speed)) * load;
}

/** Slip angle at which the tyres start to complain, and where they are as loud as they get. */
const SCRUB_START = 0.09;
const SCRUB_FULL = 0.55;

/** Road speed at which a slide is at full voice. A car shoved sideways at walking pace is quiet. */
const SCRUB_SPEED = 8;

/**
 * How loud the tyres are, 0..1.
 *
 * Slip angle rather than sideways speed, because that is the number that says the car is sliding
 * regardless of how fast it is going, and it is what the driver is being told about.
 */
export function scrubLevel(slip: number, speed: number, grounded: boolean): number {
  if (!grounded) return 0;
  const angle = Math.abs(slip);
  if (angle <= SCRUB_START) return 0;
  const amount = clamp((angle - SCRUB_START) / (SCRUB_FULL - SCRUB_START), 0, 1);
  return amount * clamp(Math.abs(speed) / SCRUB_SPEED, 0, 1);
}

/** Straight-line braking has no slip angle, but the loaded contact patch still scrubs the road. */
export function brakeLevel(brake: number, speed: number, grounded: boolean): number {
  if (!grounded) return 0;
  const pedal = clamp(brake, 0, 1);
  if (pedal <= 0.05) return 0;
  const moving = clamp((Math.abs(speed) - 1.5) / 14, 0, 1);
  return pedal * moving;
}

/** Exponential approach: the fraction of the remaining distance to cover in dt with time constant tau. */
export function approach(dt: number, tau: number): number {
  return dt <= 0 ? 0 : 1 - Math.exp(-dt / tau);
}
