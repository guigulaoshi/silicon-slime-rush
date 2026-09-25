import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Game } from '../src/app/Game';
import { recordKey, Save } from '../src/app/Save';
import { Race } from '../src/track/Race';
import { Spline } from '../src/track/Spline';
import type { TrackData } from '../src/track/types';
import { I18n } from '../src/ui/i18n';
import { MenuList } from '../src/ui/Ui';

function fixture(count: number) {
  const track = JSON.parse(readFileSync('public/tracks/synth-p2p/track.json', 'utf8')) as TrackData;
  const spline = new Spline(track);
  const racers = Array.from({ length: count }, () => ({ race: new Race(track, spline),
    car: { speed: 20, stuckUpsideDown: false }, input: { throttle: 1, brake: 0, steer: 0 },
    trailer: null, notice: '', noticeUntil: 0, vehicle: { id: 'micro-hatch' },
    parkingState: null, beginParking: vi.fn() }));
  const game = Object.create(Game.prototype) as any;
  Object.assign(game, { phase: 'racing', session: { track, racers, humans: racers, race: racers[0]!.race,
    world: { cameras: new Array(count) }, gates: { setCleared: vi.fn() } },
    audio: { ui: vi.fn() }, i18n: new I18n('en'), save: new Save(null),
    // Rolling recorder: this fake never records, and the results must not offer a clip.
    video: { supported: false, available: false, recording: false, seconds: 0, start: vi.fn(), stop: vi.fn(), frame: vi.fn() },
    resultList: new MenuList([]), start: { render: vi.fn() }, show: vi.fn((phase: string) => { game.phase = phase; }) });
  const drive = (index: number) => {
    const racer = racers[index]!; racer.race.start();
    for (let i = 0; i < spline.s.length; i++) {
      const p = spline.point(i), t = spline.tangent(i);
      game.advanceRace(1 / 60, false, new THREE.Vector3(...p),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-t[0], -t[2])), racer);
    }
    // Cross the finish plane: rounded transport points can end millimetres before its authored s.
    const end = spline.point(spline.count - 1), tangent = spline.tangent(spline.count - 1);
    game.advanceRace(1 / 60, false, new THREE.Vector3(...end).addScaledVector(new THREE.Vector3(...tangent), 4),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-tangent[0], -tangent[2])), racer);
  };
  return { game, racers, drive, track };
}

it.each([0, 1])('finishing driver %i cannot end or mutate the other race, and dual results never write single best', first => {
  const { game, racers, drive, track } = fixture(2);
  game.save.record(recordKey(track.id, racers[0]!.vehicle.id), 9999);
  drive(first);
  expect(racers[first]!.race.state).toBe('finished');
  expect(game.phase).toBe('racing');
  expect(racers[1 - first]!.race.state).toBe('ready');
  const time = racers[first]!.race.time;
  game.advanceRace(5, true, new THREE.Vector3(90000, 0, 90000), new THREE.Quaternion(), racers[first]);
  expect(racers[first]!.race.time).toBe(time);
  expect(racers[first]!.race.takeReset()).toBeNull();
  // The first one home drives on to a berth instead of standing on the line; the last one ends the race.
  expect(racers[first]!.beginParking).toHaveBeenCalledTimes(1);
  drive(1 - first);
  expect(racers[1 - first]!.beginParking).not.toHaveBeenCalled();
  expect(game.phase).toBe('results');
  expect(game.save.best(recordKey(track.id, racers[0]!.vehicle.id))).toBe(9999);
  expect(game.lastResult.players).toHaveLength(2);
  expect(game.lastResult.isBest).toBe(false);
  expect(game.resultList.items.map((item: { id: string }) => item.id)).toContain('share');
});

it('single finish still records the actual timed best and offers sharing', () => {
  const { game, racers, drive, track } = fixture(1);
  drive(0);
  expect(game.phase).toBe('results');
  expect(game.save.best(recordKey(track.id, racers[0]!.vehicle.id))).toBe(racers[0]!.race.time);
  expect(game.lastResult.isBest).toBe(true);
  expect(game.lastResult.players).toBeUndefined();
  expect(game.resultList.items.map((item: { id: string }) => item.id)).toContain('share');
});

it('an AI finishing first neither ends the human race nor writes its time to the human save', () => {
  const { game, racers, drive, track } = fixture(2);
  game.session.humans = [racers[0]];
  drive(1);
  expect(game.phase).toBe('racing');
  expect(game.save.best(recordKey(track.id, racers[0]!.vehicle.id))).toBeNull();
  drive(0);
  expect(game.phase).toBe('results');
  expect(game.save.best(recordKey(track.id, racers[0]!.vehicle.id))).toBe(racers[0]!.race.time);
  expect(game.lastResult.players).toBeUndefined();
});


it('human and AI finish events in one physics step settle a new record only once', () => {
  const { game, racers, drive, track } = fixture(2);
  game.session.humans = [racers[0]];
  const record = vi.spyOn(game.save, 'record');
  drive(0);
  expect(game.lastResult.isBest).toBe(true);
  drive(1);
  expect(racers[1]!.race.state).toBe('finished');
  expect(record).toHaveBeenCalledTimes(1);
  expect(game.lastResult.isBest).toBe(true);
  expect(game.lastResult.best).toBeNull();
  expect(game.save.best(recordKey(track.id, racers[0]!.vehicle.id))).toBe(racers[0]!.race.time);
});

it('a finish files best and stars under the car driven, and only that car gets its ghost back', () => {
  const { game, racers, drive, track } = fixture(1);
  racers[0]!.vehicle = { id: 'monster-truck' };
  game.session.vehicle = { id: 'monster-truck' };
  game.save.record(recordKey(track.id, 'sports-car'), 1);
  game.save.recordRating(recordKey(track.id, 'sports-car'), 5);
  drive(0);
  expect(game.lastResult.isBest).toBe(true);
  expect(game.lastResult.best).toBeNull();
  expect(game.save.best(recordKey(track.id, 'monster-truck'))).toBe(racers[0]!.race.time);
  expect(game.save.best(recordKey(track.id, 'sports-car'))).toBe(1);
  expect(game.save.all.ratings[recordKey(track.id, 'sports-car')]).toBe(5);
  expect(game.lastResult.bestRating).toBe(game.save.all.ratings[recordKey(track.id, 'monster-truck')]);
  const session = { humans: [racers[0]], track, direction: 'forward', vehicle: { id: 'monster-truck' } };
  const sportsGhost = { version: 1, vehicle: 'sports-car', duration: 1, trailer: false, samples: 2, data: '' };
  game.save.all.ghosts[recordKey(track.id, 'sports-car')] = sportsGhost;
  game.save.all.showGhost = true; // off by default; this checks which car's ghost comes back
  expect(game.ghostData(session)).toBeNull();
  expect(game.ghostData({ ...session, vehicle: { id: 'sports-car' } })).toBe(sportsGhost);
});
