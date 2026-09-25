import type { CarTuning } from '../physics/CarTuning';
import { autopilotSettingsFor, type AutopilotSettings } from './Autopilot';

/** Easy and hard; "no AI" is the menu's third choice and lives outside the tier. */
export const AI_DIFFICULTIES = ['relaxed', 'rush'] as const;
export type AiDifficulty = typeof AI_DIFFICULTIES[number];
/**
 * Retired the middle tier. A save that still says `standard` lands on hard,
 * which drove exactly the same plan and differs only by the catch-up; anything unreadable lands on
 * easy, the tier a new player starts on.
 */
export function aiDifficulty(value: unknown): AiDifficulty {
  if (value === 'standard') return 'rush';
  return AI_DIFFICULTIES.includes(value as AiDifficulty) ? value as AiDifficulty : 'relaxed';
}

/**
 * Difficulty is how hard the driver leans on the same car, never a speed schedule.
 *
 * Hard leans on the whole car and is the only tier with the hidden
 * catch-up (`catchUpAssist`), the only thing that ever gets more from a car than a real driver would;
 * easy holds back on grip, brakes and top speed. The middle tier left between them drove
 * exactly as hard minus the catch-up, and retired it. Driving hard differently was measured and dropped: a later
 * edge recovery and wider lane changes made the sports car slower on each of fishermans-wharf, lombard
 * and twin-peaks while holding passing lanes that blocked the grid; later braking ran wide; a shorter
 * headway deadlocked four cars at 880 m of fishermans-wharf.
 */
export const AI_EFFORT = {
  relaxed: { grip: .8, brakes: .7, top: .92 },
  rush: { grip: 1, brakes: .9, top: 1 },
} as const;

const SKILL = { relaxed: .7, rush: 1 } as const;
const LANE_CHANGE_GRIP_METRES = { relaxed: 60, rush: 140 } as const;

export function aiSettingsFor(tuning: CarTuning, difficulty: AiDifficulty): AutopilotSettings {
  const skill = SKILL[difficulty];
  const effort = AI_EFFORT[difficulty];
  return { ...autopilotSettingsFor(tuning),
    topSpeed: tuning.maxSpeed * effort.top,
    passingSpeed: tuning.maxSpeed * effort.top,
    corneringAccel: tuning.maxLateralAccel * effort.grip,
    steeringSpeedFraction: .95,
    // 65 was more reserve than the tight bends need, but it is not waste. The limit it
    // scales is physical only at the instant the car reaches its aim point -- `Car.steeringSpeedLimit`
    // asks whether the wheels can be *there* by then -- and a hairpin goes on tightening afterwards,
    // so the reserve buys the time to keep turning. How much can be given back is set by the longest
    // thing that has to get round Lombard: at .80 the school bus wedges itself at 1247 m and takes 24
    // rescues, at .85 it needs one at relaxed. .75 is the fastest value the bus still gets round at
    // both tiers, and the test below is what says so.
    tightSteeringSpeedFraction: .75,
    brakingAccel: tuning.brakeForce / tuning.mass * effort.brakes,
    stopDecel: tuning.brakeForce / tuning.mass * .9,
    brakeMargin: 1.015,
    // Lane changes for overtakes slow only as much as the change itself needs (measured: the sports car
    // spent 40 % of fishermans-wharf following slower cars at the pre cap).
    avoidSpeed: Math.min(tuning.maxSpeed, Math.sqrt(tuning.maxLateralAccel * LANE_CHANGE_GRIP_METRES[difficulty])),
    railAvoidSpeed: Math.min(tuning.maxSpeed, Math.sqrt(tuning.maxLateralAccel * 28)),
    trafficHeadway: 1.5 - .75 * skill,
    slimeSkill: skill,
    keepSpeedForSlimes: true,
  };
}

/** Metres behind the leading player at which hard's catch-up reaches its ceiling. */
export const CATCH_UP_FULL_GAP_M = 400;
/** The most hard's catch-up adds to engine force, top speed and grip. */
export const CATCH_UP_MAX = .2;

/** Hard only. Level or ahead is 1; the further behind the leading player, the more help. */
export function catchUpAssist(difficulty: AiDifficulty, metresBehindLeader: number): number {
  if (difficulty !== 'rush') return 1;
  return 1 + CATCH_UP_MAX * Math.min(1, Math.max(0, metresBehindLeader) / CATCH_UP_FULL_GAP_M);
}

/** What `applyCatchUp` needs from a racer; `Racer` satisfies it. */
export interface CatchUpRacer {
  readonly role: 'human' | 'ai';
  readonly difficulty: AiDifficulty;
  readonly race: { readonly state: string };
  raceDistance(): number;
  setAssist(assist: number): void;
}

/** Once per fixed step, each AI still racing gets hard's catch-up against the leading player;
 * everyone else -- players, finished cars, any step outside the race -- is back at 1. */
export function applyCatchUp(racers: readonly CatchUpRacer[], racing: boolean): void {
  const leader = Math.max(...racers.filter(racer => racer.role !== 'ai').map(racer => racer.raceDistance()));
  for (const racer of racers) racer.setAssist(racer.role === 'ai' && racing && racer.race.state === 'racing'
    ? catchUpAssist(racer.difficulty, leader - racer.raceDistance()) : 1);
}
