import { expect, it } from 'vitest';
import { standingSnapshot, type StandingRacer } from '../src/app/Standings';

const racer = (id: string, role: 'human' | 'ai', vehicle: string, state: 'racing' | 'finished',
  time: number, progress: number, lap = 1): StandingRacer => ({
  id, role, vehicle: {id: vehicle}, race: {state, time, lap, spline: {length: 1000}, progress: {value: {s: progress}}},
});

it('ranks every finisher by actual time, then unfinished cars by race progress', () => {
  const p1 = racer('player-1', 'human', 'jeep', 'finished', 92, 1000);
  const p2 = racer('player-2', 'human', 'sports-car', 'racing', 92, 850);
  const ai1 = racer('ai-bus', 'ai', 'school-bus', 'finished', 88, 1000);
  const ai2 = racer('ai-van', 'ai', 'retro-van', 'racing', 92, 940);
  expect(standingSnapshot([p1, p2, ai1, ai2], [p1, p2])).toEqual([
    {id:'ai-bus', role:'ai', vehicleId:'school-bus', finished:true, time:88},
    {id:'player-1', role:'human', vehicleId:'jeep', player:0, finished:true, time:92},
    {id:'ai-van', role:'ai', vehicleId:'retro-van', finished:false, time:null},
    {id:'player-2', role:'human', vehicleId:'sports-car', player:1, finished:false, time:null},
  ]);
});


it('updates the same field order immediately when either driver overtakes', () => {
  const player = racer('player-1', 'human', 'jeep', 'racing', 10, 100);
  const opponent = racer('ai-bus', 'ai', 'school-bus', 'racing', 10, 110);
  const order = () => standingSnapshot([player, opponent], [player]).map(row => row.id);
  expect(order()).toEqual(['ai-bus', 'player-1']);
  player.race.progress.value.s = 120;
  expect(order()).toEqual(['player-1', 'ai-bus']);
  opponent.race.progress.value.s = 130;
  expect(order()).toEqual(['ai-bus', 'player-1']);
});

it('keeps a completed lap ahead and preserves finisher times as the live field moves', () => {
  const player = racer('player-1', 'human', 'jeep', 'racing', 40, 20, 2);
  const opponent = racer('ai-bus', 'ai', 'school-bus', 'racing', 40, 990);
  const field = [player, opponent];
  expect(standingSnapshot(field, [player])[0]!.id).toBe('player-1');
  opponent.race.state = 'finished'; opponent.race.time = 50;
  player.race.state = 'finished'; player.race.time = 49;
  const frozen = standingSnapshot(field, [player]);
  player.race.progress.value.s = 0; opponent.race.progress.value.s = 500;
  expect(standingSnapshot(field, [player])).toEqual(frozen);
});
