import type { CarKind } from '../track/types';
import { VEHICLES, forTrack, slotOf, vehicleTuning, type VehicleDefinition } from '../vehicles/catalogue';

export type DriverRole = 'human' | 'ai';
export interface RosterEntry { id: string; role: DriverRole; vehicle: VehicleDefinition }

/**
 * AI rivals a phone lines up. The whole garage (eight rivals) held a Pixel 7 Pro at 10–13 fps on Golden Gate:
 * each rival costs about 1 ms of every physics step and 2 ms of drawing, and a slow frame runs more steps to
 * catch up, so the cost snowballs. Measured on that phone, two rivals ran as fast as none (25–37 fps against
 * 27–35), three already fell to 19–28. A computer still gets every car.
 */
export const MOBILE_AI_RIVALS = 2;

/**
 * How fast a car is on this route, lower is faster: its measured seconds, or for a route without one (the
 * synthetic tracks) a ranking by top speed. The grid order and the phone's short field both read this.
 */
export function paceSeconds(vehicle: VehicleDefinition,
  pace: (vehicle: VehicleDefinition) => number | undefined): number {
  return pace(vehicle) ?? 1e6 / vehicleTuning(vehicle, vehicle.tuning as CarKind).maxSpeed;
}

/**
 * The formal garage owns the set; a selected model is removed once even when both humans choose it.
 * With `limit` below the number of rivals, the ones kept are spread across the route's pace (lower is
 * faster), so a short field still has cars to chase and cars to pass.
 */
export function raceRoster(humans: readonly VehicleDefinition[], ai: boolean, limit = Infinity,
  pace: (vehicle: VehicleDefinition) => number | undefined = () => undefined, trackId?: string): RosterEntry[] {
  const selected = new Set(humans.map(vehicle => slotOf(vehicle).id));
  let rivals = ai ? VEHICLES.filter(vehicle => !selected.has(vehicle.id)).map(vehicle => forTrack(vehicle, trackId)) : [];
  if (rivals.length > limit) {
    const seconds = (vehicle: VehicleDefinition) => paceSeconds(vehicle, pace);
    const byPace = [...rivals].sort((a, b) => seconds(a) - seconds(b));
    const kept = new Set(Array.from({ length: Math.max(0, limit) },
      (_, i) => byPace[Math.min(byPace.length - 1, Math.floor((i + .5) * byPace.length / limit))]!));
    rivals = rivals.filter(vehicle => kept.has(vehicle));
  }
  return [
    ...humans.map((vehicle, index) => ({ id: `player-${index + 1}`, role: 'human' as const, vehicle })),
    ...rivals.map(vehicle => ({ id: `ai-${vehicle.id}`, role: 'ai' as const, vehicle })),
  ];
}
