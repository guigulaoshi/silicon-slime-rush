import type { ResultStanding } from '../ui/screens';
import type { DriverRole } from './roster';

export interface StandingRacer {
  id?: string;
  role?: DriverRole;
  vehicle?: { id: string };
  race: { state: 'ready' | 'racing' | 'finished'; time: number; lap: number;
    spline: { length: number }; progress: { value: { s: number } } };
}

/** One field order for the live HUD and the frozen result screen. */
export function standingSnapshot(racers: readonly StandingRacer[], humans: readonly StandingRacer[]): ResultStanding[] {
  return racers.map((racer, order) => {
    const player = humans.indexOf(racer);
    const role = racer.role ?? (player >= 0 ? 'human' : 'ai');
    return {
    id: racer.id ?? `racer-${order}`, role, vehicleId: racer.vehicle?.id ?? 'sedan',
    ...(role === 'human' ? { player } : {}),
    finished: racer.race.state === 'finished',
    time: racer.race.state === 'finished' ? racer.race.time : null,
    progress: (racer.race.lap - 1) * racer.race.spline.length + racer.race.progress.value.s,
    order,
  }; }).sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return (a.time ?? Infinity) - (b.time ?? Infinity) || a.order - b.order;
    return b.progress - a.progress || a.order - b.order;
  }).map(({progress: _progress, order: _order, ...racer}) => racer);
}
