/**
 * Every number that decides how the car feels.
 *
 * These are not simulation constants, they are design. Grip is the thing to reach for first: the
 * gap between front and rear lateral grip decides how readily the car rotates, and peakSlip with
 * slideGrip decides what happens once it does.
 */
export type DriveType = 'fwd' | 'rwd' | 'awd';

export function isPoweredWheel(drive: DriveType, wheelIndex: number): boolean {
  return drive === 'awd' || (drive === 'fwd' ? wheelIndex < 2 : wheelIndex >= 2);
}

export function poweredWheelCount(drive: DriveType, wheelCount: number): number {
  return drive === 'awd' ? wheelCount : Math.min(2, wheelCount);
}

export interface CarTuning {
  /** Wheels that receive engine torque. Brakes still act on every wheel. */
  drive: DriveType;
  mass: number;
  /** Uniform geometry scaling changes rotational inertia by its square at fixed mass. */
  inertiaScale?: number;
  /** Scale applied to finite slime impact impulses before dividing by body mass. */
  ramMultiplier: number;
  slickGripMultiplier: number;
  /** half extents of the chassis collider, meters. The whole car is built at half the size of a
   *  real one: a 1.8 m car on a real street fills a quarter of it, and no amount of widening the
   *  road fixed how tight that reads. The chase camera is pulled in to match, so the car keeps its
   *  size on screen and the road is what got wider. */
  chassisHalf: [number, number, number];
  /** centre of mass offset from the chassis centre; lower is more stable */
  /** centre of mass in body space. Sunk well below the floor on purpose: at a realistic height a
   *  1.6 m track rolls over at about 1.8 g, which is inside the cornering the game asks for, and the
   *  car lies down on its side instead of drifting. Sinking it also calms the pitch under power. */
  centreOfMass: [number, number, number];
  /** wheel anchor positions in chassis space: front-left, front-right, rear-left, rear-right */
  /** wheel anchors in body space, front axle first. The car faces -z, so the front pair is the one
   *  with the negative z: listing them the other way round steers the rear wheels, which is stable
   *  at walking pace and spins the car at any real speed. */
  wheels: [number, number, number][];
  wheelRadius: number;
  suspensionRest: number;
  suspensionTravel: number;
  suspensionStiffness: number;
  suspensionDamping: number;
  /** forward force per unit throttle at a standstill, newtons */
  engineForce: number;
  /** Wheel power in watts; caps drive force as road speed rises. */
  enginePower?: number;
  /** Tachometer redline. Gear road speeds scale with maxSpeed. */
  redlineRpm?: number;
  /** Horizontal drag coefficient in N / (m/s)^2, including a trailer's frontal area. */
  airResistance?: number;
  brakeForce: number;
  reverseForce: number;
  /** how fast the car will back up, m/s */
  maxReverseSpeed: number;
  /** top speed the engine will push to, m/s */
  maxSpeed: number;
  /** steering angle at rest, radians, and how much of it survives once up to speed */
  maxSteer: number;
  steerAtSpeed: number;
  /** the speed by which the steering has fallen off to steerAtSpeed, m/s.
   *  Absolute, not a fraction of top speed: tying it to top speed means raising the top speed
   *  quietly leaves the wheel near full lock at a hundred kilometres an hour, and it spins. */
  steerFalloffSpeed: number;
  steerRate: number;
  /** Fraction of steering slew rate retained at steerFalloffSpeed. */
  steerRateAtSpeed?: number;
  /** how fast a wheel kills sideways speed, per second. Higher is grippier; rear below front oversteers */
  gripFront: number;
  gripRear: number;
  /** friction coefficient: no wheel pulls harder than its load times this */
  gripLimit: number;
  /** slip angle at which a tyre is at its best, rad; past it grip fades toward slideGrip */
  peakSlip: number;
  /** share of gripLimit a fully sideways tyre still has, 0..1 */
  slideGrip: number;
  gripLongitudinal: number;
  /** share of longitudinal grip still available with the tyre fully committed sideways, 0..1;
   *  a real tyre would have none, and a car that cannot power out of a slide is no fun */
  gripReserve: number;
  /** how hard the car may be turned, m/s^2; the steering cannot ask for more than this */
  maxLateralAccel: number;
  /** how much of the steering past that ceiling still reaches the wheels, 0..1 */
  steerOverdrive: number;
  /** absolute ceiling on how fast the car may rotate, rad/s */
  maxYawRate: number;
  /** how hard the car is pushed toward the rate of turn the steering asks for, N·m per kg per rad/s.
   *  These scale with the car's yaw inertia, which goes as its length squared: halving the size of
   *  the car quartered it, and the numbers tuned for the full-size one spun it on the spot. */
  yawAssist: number;
  /** ceiling on that help, N·m per kg */
  yawAssistMax: number;
  /* */
  yawAssistBuild: number;
  /** the drift angle the car will hold, radians. Past it the nose is pushed back toward the
   *  direction of travel, which is what makes a slide a drift rather than a spin. */
  maxSlipAngle: number;
  /** how hard it is pushed back, N·m per kg per radian */
  slipRecover: number;
  /** how hard a slip angle that is still growing past the limit is damped, N·m per kg per rad/s */
  slipDamp: number;
  /** downforce coefficient, newtons per (m/s)^2. Keep it well under the car's own weight at top
   *  speed: enough to crush the suspension solid rests the chassis on the ground, and a car sitting
   *  on its floor cannot steer at all. */
  downforce: number;
  linearDamping: number;
  angularDamping: number;
  /** anti-roll torque coupling the two sides of an axle */
  antiRoll: number;
  /** tilt away from upright the car is left to get on with, radians; past it it is pushed back */
  uprightLimit: number;
  /** Assistance stops beyond this tilt: a severe curb trip can still roll a tall vehicle. */
  uprightRecoveryLimit: number;
  /** how hard it is pushed back on the ground and in the air, N·m per kg per radian */
  uprightGround: number;
  uprightAir: number;
  /** damping on that push, N·m per kg per rad/s */
  uprightDamp: number;
  /** share of the sideways speed taken out on the frame after hitting something, 0..1 */
  /** how much of the speed *into* a wall survives the step. 0 means the car never bounces. */
  scrapeAbsorb: number;
  /** and share of the spin, which is what turns a hit into a roll */
  /** how much of the spin a wall imparts survives. 0 means a wall never turns the car. */
  scrapeSpin: number;
  /** how hard sliding along a wall slows the car, as a fraction of speed per second */
  scrapeDrag: number;
  /** fastest the rail may straighten the car out along itself, rad/s. It only ever turns the car
   *  towards the way the rail runs, never away, so this helps the driver and cannot spin them. */
  scrapeAlign: number;
  gravity: number;
}

export const SEDAN: CarTuning = {
  drive: 'awd',
  mass: 1250,
  ramMultiplier: 1,
  slickGripMultiplier: 1,
  chassisHalf: [0.45, 0.25, 1.05],
  centreOfMass: [0, -0.31, 0],
  wheels: [[-0.39, -0.23, -0.7], [0.39, -0.23, -0.7], [-0.39, -0.23, 0.68], [0.39, -0.23, 0.68]],
  wheelRadius: 0.17,
  suspensionRest: 0.23,
  suspensionTravel: 0.14,
  suspensionStiffness: 120000,
  suspensionDamping: 8500,
  engineForce: 27000,
  brakeForce: 26000,
  reverseForce: 7000,
  maxReverseSpeed: 9,
  maxSpeed: 80,
  maxSteer: 0.62,
  steerAtSpeed: 0.28,
  steerFalloffSpeed: 45,
  steerRate: 6.5,
  gripFront: 6.0,
  gripRear: 4.1,
  gripLimit: 2.5,
  peakSlip: 0.18,
  slideGrip: 0.5,
  gripLongitudinal: 2.4,
  gripReserve: 0.25,
  maxLateralAccel: 34,
  steerOverdrive: 0.35,
  maxYawRate: 1.9,
  yawAssist: 1.8,
  yawAssistMax: 3.4,
  yawAssistBuild: 0.18,
  maxSlipAngle: 0.5,
  slipRecover: 26,
  slipDamp: 6.5,
  downforce: 2.4,
  linearDamping: 0.06,
  angularDamping: 0.9,
  antiRoll: 18000,
  uprightLimit: 0.35,
  uprightRecoveryLimit: Math.PI,
  uprightGround: 42,
  uprightAir: 14,
  uprightDamp: 5,
  scrapeAbsorb: 1.0,
  scrapeSpin: 1.0,
  scrapeDrag: 0.55,
  scrapeAlign: 0.8,
  gravity: -19.6,
};

export const SUPER: CarTuning = {
  ...SEDAN,
  mass: 1180,
  chassisHalf: [0.48, 0.21, 1.1],
  engineForce: 36000,
  maxSpeed: 112,
  gripFront: 6.6,
  gripRear: 5.6,
  maxLateralAccel: 39,
  downforce: 1.4,
  yawAssist: 1.3,
};

export const CONVERTIBLE: CarTuning = {
  ...SEDAN,
  mass: 1320,
  engineForce: 29000,
  maxSpeed: 94,
  gripFront: 5.7,
  gripRear: 4.7,
  maxLateralAccel: 32,
  downforce: 1.5,
  yawAssist: 1.1,
};

export const HATCH: CarTuning = {
  ...SEDAN,
  mass: 1080,
  chassisHalf: [0.43, 0.28, 0.93],
  wheels: [[-0.36, -0.23, -0.6], [0.36, -0.23, -0.6], [-0.36, -0.23, 0.58], [0.36, -0.23, 0.58]],
  engineForce: 21000,
  maxSpeed: 76,
  gripFront: 5.4,
  gripRear: 4.6,
  maxLateralAccel: 30,
  downforce: 1.3,
  yawAssist: 1.05,
};

export const TUNINGS = { sedan: SEDAN, super: SUPER, convertible: CONVERTIBLE, hatch: HATCH } as const;

export function tuningFor(car: keyof typeof TUNINGS): CarTuning {
  return structuredClone(TUNINGS[car] ?? SEDAN);
}
