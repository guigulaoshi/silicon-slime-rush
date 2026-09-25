import type {CarTuning} from './CarTuning';
/** Road speed at each upshift, in metres per second. */
export const GEAR_TOPS = [9, 18, 28, 39, 50, 66] as const;
export const IDLE_RPM = 900;
export const REDLINE_RPM = 7200;
const SHIFT_DROP = 0.42;
const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

export interface PowertrainState {
  /** One based forward gear, suitable for the instrument display. */
  gear: number;
  rpm: number;
  /** Position between idle and redline. */
  rpmFraction: number;
}

function gearScale(maxSpeed: number): number {
  return Math.max(maxSpeed, 12) / GEAR_TOPS.at(-1)!;
}

export function gearIndexAt(speed: number, maxSpeed: number = GEAR_TOPS.at(-1)!): number {
  const roadSpeed = Math.abs(speed);
  const scale = gearScale(maxSpeed);
  for (let index = 0; index < GEAR_TOPS.length; index++) {
    if (roadSpeed < GEAR_TOPS[index]! * scale) return index;
  }
  return GEAR_TOPS.length - 1;
}

export function roadRevFraction(speed: number, maxSpeed: number = GEAR_TOPS.at(-1)!): number {
  const roadSpeed = Math.abs(speed);
  const scale = gearScale(maxSpeed);
  const index = gearIndexAt(roadSpeed, maxSpeed);
  const bottom = index === 0 ? 0 : GEAR_TOPS[index - 1]! * scale;
  const top = GEAR_TOPS[index]! * scale;
  const through = clamp((roadSpeed - bottom) / (top - bottom), 0, 1);
  const floor = index === 0 ? 0 : SHIFT_DROP;
  return floor + (1 - floor) * through;
}

export function powertrainTarget(speed: number, throttle: number, maxSpeed: number,
                                 grounded: boolean, redlineRpm = REDLINE_RPM): PowertrainState {
  const pedal = clamp(throttle, 0, 1);
  const road = roadRevFraction(speed, maxSpeed);
  // At low speed the clutch or motor controller lets the engine rise before road speed catches up.
  const launch = pedal * .52 * (1 - clamp(Math.abs(speed) / 4, 0, 1));
  // Lifting at a fixed road speed unloads the engine without inventing another audio-only curve.
  let rpmFraction = Math.max(road * (.86 + .14 * pedal), launch);
  if (!grounded) rpmFraction = Math.max(rpmFraction, pedal * .95);
  return { gear: gearIndexAt(speed, maxSpeed) + 1,
    rpm: Math.round(IDLE_RPM + (redlineRpm - IDLE_RPM) * rpmFraction), rpmFraction };
}

export function updatePowertrain(previous: PowertrainState, speed: number, throttle: number,
                                 maxSpeed: number, grounded: boolean, dt: number,
                                 redlineRpm = REDLINE_RPM): PowertrainState {
  const target = powertrainTarget(speed, throttle, maxSpeed, grounded, redlineRpm);
  const rate = target.rpmFraction > previous.rpmFraction ? 10 : 6;
  const blend = 1 - Math.exp(-Math.max(dt, 0) * rate);
  const rpmFraction = previous.rpmFraction + (target.rpmFraction - previous.rpmFraction) * blend;
  return { gear: target.gear,
    rpm: Math.round(IDLE_RPM + (redlineRpm - IDLE_RPM) * rpmFraction), rpmFraction };
}

/** Wheel force before the driven tyres apply their shared friction budget. */
export function engineDriveForce(tuning: CarTuning, speed: number): number {
  return Math.min(tuning.engineForce, (tuning.enginePower ?? Infinity) / Math.max(Math.abs(speed), 1));
}
/** Longitudinal tyre budget left after cornering, shared by physics and the ideal road model. */
export function longitudinalGrip(load: number, coefficient: number, weather: number, lateralUse: number, reserve: number): number {
  return load * coefficient * weather * Math.max(Math.sqrt(1 - lateralUse * lateralUse), reserve);
}
