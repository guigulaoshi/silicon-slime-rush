import { delta, type Projection } from '../track/Progress';
import type { Spline } from '../track/Spline';
import { planTraffic, type TrafficBody } from './Traffic';

export interface SlimeTarget extends TrafficBody { kind: 'popper' | 'slick' | 'burst' | 'boost' }

/** Slimes are optional lane choices, never solid traffic that may stop a race indefinitely. */
export function slimeLane(spline: Spline, at: Projection, own: readonly TrafficBody[],
  traffic: readonly TrafficBody[], slimes: readonly SlimeTarget[], speed: number,
  braking: number, previous: number, skill: number): number {
  const horizon = Math.min(100, Math.max(35, speed * (1.5 + skill * 2)));
  const ahead = slimes.map(body => ({ body, d: delta(at.s, body.s, spline.length, spline.closed) }))
    .filter(({body, d}) => d + body.halfLength > -4 && d < horizon).sort((a,b) => a.d-b.d);
  const bad = ahead.filter(({body})=>body.kind !== 'boost').map(({body})=>body);
  const obstacles = [...traffic, ...bad];
  const boost = ahead.find(({body,d})=>body.kind === 'boost' && d > 0
    && Math.abs(body.lateral-at.lateral) <= (2 + skill * 6));
  if(boost) {
    const choice = planTraffic(spline, at, own, obstacles, speed, braking, previous, boost.body.lateral);
    // A constrained lane or a real car takes precedence over a boost.
    if(Math.abs(choice.offset - boost.body.lateral) < .2 && choice.laneClear) return choice.offset;
  }
  if(bad.length) {
    const choice = planTraffic(spline, at, own, obstacles, speed, braking, previous);
    if(choice.laneClear) return choice.offset;
  }
  return 0;
}
