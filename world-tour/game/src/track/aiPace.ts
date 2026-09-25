import table from './aiPace.json' with { type: 'json' };
import { IdealRace } from '../bot/IdealRace';
import { vehicleFor, type VehicleDefinition } from '../vehicles/catalogue';
import type { AiDifficulty } from '../bot/difficulty';
import type { Spline } from './Spline';
import type { TrackData } from './types';

/**
 * How long the AI takes to finish a route in a given vehicle: the yardstick a player's time is rated
 * against, so a school bus and a sports car driven equally well earn the same stars
 *:.
 *
 * The table is measured, not derived: the hard AI (which drives exactly like the old normal one when no
 * player is ahead) drives every route, direction and vehicle on a slime-free road
 * (`SR_UPDATE_AI_PACE=1 npx vitest run test/autopilot.test.ts -t "AI pace"`), and that test also fails
 * when handling changes leave it stale. Pairings it cannot finish there are listed in `estimated`.
 */
export const AI_PACE_DIFFICULTY: AiDifficulty = 'rush';
export const AI_PACE: Readonly<Record<string, Readonly<Record<string, number>>>> = table.seconds;
export const AI_PACE_ESTIMATES: readonly string[] = table.estimated;

/** A route outside the table (the synthetic test tracks) falls back to the physical bound over the AI's typical share of it. */
export const AI_SHARE_OF_IDEAL = .9;

export function aiReferenceSeconds(key: string, vehicle: Pick<VehicleDefinition, 'id'>, spline: Spline, track: TrackData): number {
  const measured = AI_PACE[key]?.[vehicle.id];
  if (measured) return measured;
  const known = vehicleFor(vehicle.id);
  return known ? new IdealRace(spline, track, known).seconds / AI_SHARE_OF_IDEAL : NaN;
}
