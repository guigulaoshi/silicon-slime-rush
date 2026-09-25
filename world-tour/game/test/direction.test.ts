import { Autopilot } from '../src/bot/Autopilot';
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { directedTrack, raceKey } from '../src/track/Direction';
import { Spline } from '../src/track/Spline';

it('reverse travel swaps the outward scenery roads without pointing them back into the race', () => {
  const source = JSON.parse(readFileSync('public/tracks/synth-p2p/track.json', 'utf8')) as TrackData;
  const road = (points: [number, number, number][]): TrackData['spline'] =>
    ({points, halfWidth: [6, 6], closed: false, length: 30});
  source.endRoads = {start: road([[0, 0, 0], [-30, 0, 0]]), finish: road([[100, 0, 0], [130, 0, 0]])};
  const reversed = directedTrack(source, 'reverse');
  expect(reversed.endRoads?.finish).toEqual(source.endRoads.start);
  expect(reversed.endRoads?.start).toEqual(source.endRoads.finish);
});
import { Progress } from '../src/track/Progress';
import { Race } from '../src/track/Race';
import { CATALOGUE, SYNTHETIC } from '../src/app/tracks';
import type { TrackData } from '../src/track/types';
import { Save } from '../src/app/Save';
import { routeName } from '../src/ui/routeName';
import { I18n } from '../src/ui/i18n';

for (const id of [...SYNTHETIC, ...CATALOGUE.map(t => t.id)]) it(id + ' reverses the same physical road, gates and streaming ranges without mutating the source', () => {
  const source: TrackData = JSON.parse(readFileSync('public/tracks/' + id + '/track.json', 'utf8'));
  const snapshot = JSON.stringify(source);
  // The old swapped-direction special case (twin-peaks: 'forward' meant reversed) is gone --
  // SWAPPED_ROUTES is now empty (src/track/Direction.ts) because twin-peaks was deleted with the
  // rest of the Bay Area set, so every route takes the plain identity/reverse pair below.
  const reverse = directedTrack(source, 'reverse');
  expect(directedTrack(source)).toBe(source);
  expect(reverse.spline.points).toEqual(source.spline.closed
    ? [source.spline.points[0], ...source.spline.points.slice(1).reverse()]
    : [...source.spline.points].reverse());
  expect(reverse.checkpoints[0]!.s).toBe(0);
  expect(reverse.checkpoints.map(c => c.s)).toEqual([...reverse.checkpoints.map(c => c.s)].sort((a,b)=>a-b));
  expect(reverse.tiles.map(t => [t.name,t.offset,t.length,t.bounds])).toEqual(source.tiles.map(t => [t.name,t.offset,t.length,t.bounds]));
  for (let i = 0; i < source.tiles.length; i++) {
    const ranges = reverse.tiles[i]!.sRanges;
    for (const [a,b] of ranges) {expect(a).toBeGreaterThanOrEqual(-.001);expect(b).toBeLessThanOrEqual(reverse.spline.length+.001);expect(a).toBeLessThanOrEqual(b);}
    expect(ranges).toHaveLength(source.tiles[i]!.sRanges.length);
  }
  const spline = new Spline(reverse), race = new Race(reverse, spline);
  const tangent = spline.tangent(0);
  expect(-Math.sin(reverse.start.yaw) * tangent[0] - Math.cos(reverse.start.yaw) * tangent[2]).toBeGreaterThan(.9);
  expect(reverse.start.pos[0]).toBe(reverse.spline.points[0]![0]);
  if (!spline.closed) {
    const finish = reverse.checkpoints[reverse.checkpoints.length - 1]!;
    expect(new Progress(spline).reacquire(finish.pos[0],finish.pos[2]).s).toBeCloseTo(finish.s, 1);
  }
  race.start();
  // Sample-driven gate test, separate from the required real-physics browser bot runs.
  for (let k=1; k < spline.count * race.totalLaps + 10 && race.state !== 'finished'; k++) {
    const index=spline.wrapIndex(k), p=spline.point(index), t=spline.tangent(index);
    if (!spline.closed && k >= spline.count) { p[0] += t[0]*5; p[2] += t[2]*5; }
    race.update(.1,{x:p[0],z:p[2],speed:20,headingX:t[0],headingZ:t[2]});
    if (race.distanceToStop() !== null && race.distanceToStop()! < 5) {
      for(let dwell=0;dwell<15;dwell++) race.update(.1,{x:p[0],z:p[2],speed:0,headingX:t[0],headingZ:t[2]});
    }
  }
  expect(race.state).toBe('finished');
  expect(JSON.stringify(source)).toBe(snapshot);
});

it('keeps short reversed end segments from corrupting distance lookups', () => {
  const source: TrackData = JSON.parse(readFileSync('public/tracks/synth-p2p/track.json', 'utf8'));
  source.spline.points = [[0,0,0],[2,0,0],[4,0,0],[4.1,0,0]];
  source.spline.halfWidth = [4,4,4,4]; source.spline.length = 4.1;
  const spline = new Spline(directedTrack(source,'reverse'));
  expect(spline.point(spline.indexAt(2.1))[0]).toBe(2);
  expect(spline.point(spline.indexAt(4.1))[0]).toBe(0);
});
it('separates grades and best times while preserving legacy forward keys and localized names', () => {
  const save = new Save(null);
  save.record('synth-loop',120); save.recordRating('synth-loop',5);
  save.record(raceKey('synth-loop','reverse'),150); save.recordRating(raceKey('synth-loop','reverse'),1);
  expect(save.best('synth-loop')).toBe(120);
  expect(save.best('synth-loop:reverse')).toBe(150);
  expect(save.all.ratings).toEqual({'synth-loop':5,'synth-loop:reverse':1});
  for (const lang of ['zh','en'] as const) {
    const t=new I18n(lang);
    expect(routeName(t,'synth-loop','reverse')).toContain(t.t('direction.reverse'));
    expect(routeName(t,'synth-loop')).toBe(t.t('track.synth-loop.name'));
  }
});

it('maps horizontal asset intervals through the same three-dimensional road arc as reverse progress', () => {
  const source: TrackData = JSON.parse(readFileSync('public/tracks/synth-p2p/track.json','utf8'));
  source.spline={points:[[0,0,0],[3,4,0],[6,4,0]],s:[0,5,8],halfWidth:[3,4,5],closed:false,length:8};
  source.start={pos:[0,.55,0],yaw:-Math.PI/2};
  source.checkpoints=[{s:0,pos:[0,0,0],dir:[1,0,0],halfWidth:3},{s:8,pos:[6,4,0],dir:[1,0,0],halfWidth:5}];
  source.tiles=[{name:'slope',sRanges:[[0,5]],bounds:[[0,0,-5],[3,4,5]]}];
  source.wind={sRange:[5,8],gustN:10,periodS:2};
  source.traffic={density:1,lanes:[{offset:2,dir:1}],speedKmh:[20,30],oncoming:false};
  const reverse=directedTrack(source,'reverse');
  expect(reverse.spline.length).toBe(8);
  expect(reverse.tiles[0]!.sRanges).toEqual([[3,8]]);
  expect(reverse.wind!.sRange).toEqual([0,3]);
  expect(reverse.spline.halfWidth).toEqual([5,4,3]);
  expect(reverse.traffic!.lanes).toEqual([{offset:-2,dir:-1}]);
  expect(reverse.checkpoints.map(c=>c.s)).toEqual([0,8]);
});

it('a short first segment does not change the driver horizon hundreds of metres later', () => {
  const original: TrackData = JSON.parse(readFileSync('public/tracks/synth-p2p/track.json','utf8'));
  const short = structuredClone(original);
  short.spline.points[0] = original.spline.points[0]!.map((v,i) => v + .95*(original.spline.points[1]![i]! - v)) as [number,number,number];
  const drive = (data: TrackData) => {
    const spline=new Spline(data), index=100, p=spline.point(index),t=spline.tangent(index);
    return new Autopilot(spline).drive(1/60, {x:p[0],z:p[2],speed:20,forwardSpeed:20,headingX:t[0],headingZ:t[2]},
      {s:spline.s[index]!,index,lateral:0});
  };
  const a=drive(original),b=drive(short);
  expect(b.steer).toBeCloseTo(a.steer,8);
  expect(b.throttle).toBe(a.throttle);expect(b.brake).toBe(a.brake);
});
