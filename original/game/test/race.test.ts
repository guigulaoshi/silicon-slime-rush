import { describe, expect, it } from 'vitest';
import { Autopilot } from '../src/bot/Autopilot';
import { Progress, delta } from '../src/track/Progress';
import { CLEAN_CORNER_POINTS, OFF_TRACK_MARGIN, RESCUE_BACK_M, RESCUE_REPEAT_BACK_M, OFF_TRACK_SECONDS, OFF_TRACK_WARNING_SECONDS, Race,
  cleanCornerMap, slimePoints, WRONG_WAY_SECONDS, formatTime, type CarSample, comboMultiplier, COMBO_WINDOW_SECONDS } from '../src/track/Race';
import { Spline } from '../src/track/Spline';
import type { Checkpoint, TrackData, Vec3 } from '../src/track/types';

function trackFrom(points: Vec3[], opts: Partial<TrackData> = {}): TrackData {
  const n = points.length;
  const length = points.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - points[i]![0], p[2] - points[i]![2]), 0);
  return {
    id: 't', version: 1, editions: ['full'], category: 'race', mode: 'p2p', laps: 1,
    name: { zh: '', en: '' }, blurb: { zh: '', en: '' },
    origin: { lat: 0, lon: 0 }, timeOfDay: 'day', car: 'sedan',
    spline: { points, halfWidth: new Array(n).fill(4), closed: false, length },
    start: { pos: [points[0]![0], points[0]![1], points[0]![2]], yaw: 0 },
    checkpoints: [], tiles: [], attribution: [], ...opts,
  } as TrackData;
}

/** A straight run east, 2 m samples. */
function straight(n = 251): TrackData {
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) pts.push([i * 2, 0, 0]);
  return trackFrom(pts);
}

/** Two parallel legs 20 m apart joined by a turn: the shape that breaks a global nearest search. */
function hairpin(): TrackData {
  const pts: Vec3[] = [];
  for (let i = 0; i < 100; i++) pts.push([i * 2, 0, 0]);
  for (let a = 1; a < 16; a++) {
    const th = (a / 16) * Math.PI;
    pts.push([198 + Math.sin(th) * 10, 0, 10 - Math.cos(th) * 10]);
  }
  for (let i = 0; i < 100; i++) pts.push([198 - i * 2, 0, 20]);
  return trackFrom(pts);
}

const gate = (s: number, extra: Partial<Checkpoint> = {}): Checkpoint =>
  ({ s, pos: [s, 0, 0], dir: [1, 0, 0], halfWidth: 5, ...extra });

const sample = (x: number, z: number, speed = 20, hx = 1, hz = 0): CarSample =>
  ({ x, z, speed, headingX: hx, headingZ: hz });

it('rescues a racer driving into endpoint scenery, while circuits and finished parking remain open', () => {
  for (const x of [-14, 514]) {
    const track = straight(), race = new Race(track, new Spline(track));
    race.start(); race.reacquire(x, 0);
    const events = race.update(1 / 60, sample(x, 0));
    expect(events.some(event => event.resetReason === 'off-track')).toBe(true);
    expect(race.takeReset()).not.toBeNull();
  }
  const track = straight(); track.spline.closed = true; track.mode = 'loop';
  const circuit = new Race(track, new Spline(track)); circuit.start();
  circuit.reacquire(-14, 0); circuit.update(1 / 60, sample(-14, 0));
  expect(circuit.takeReset()).toBeNull();
  const open = straight(), finished = new Race(open, new Spline(open));
  finished.state = 'finished'; finished.reacquire(530, 0); finished.update(1 / 60, sample(530, 0));
  expect(finished.takeReset()).toBeNull();
});

it('an idle human is not wedged, while attempted driving and off-road rescue still work', () => {
  const track = straight(), race = new Race(track, new Spline(track));
  race.start();
  const idle = { ...sample(20, 0, 0), tryingToMove: false };
  for (let i = 0; i < 120; i++) race.update(1, idle);
  expect(race.takeReset()).toBeNull();
  const events = [];
  for (let i = 0; i < 120; i++) events.push(...race.update(1, { ...idle, tryingToMove: true }));
  expect(events.some(event => event.resetReason === 'wedged')).toBe(true);
  race.takeReset();
  const offRoad = race.update(OFF_TRACK_SECONDS + 1, { ...idle, z: 30 });
  expect(offRoad.some(event => event.resetReason === 'off-track')).toBe(true);
});

describe('delta', () => {
  it('is a plain difference on a sprint and the short way round a loop', () => {
    expect(delta(10, 40, 100, false)).toBe(30);
    expect(delta(95, 5, 100, true)).toBe(10);
    expect(delta(5, 95, 100, true)).toBe(-10);
  });
});

describe('Progress', () => {
  it('reads arc length and signed offset from the centreline', () => {
    const p = new Progress(new Spline(straight()));
    const a = p.reacquire(100, 0);
    expect(a.s).toBeCloseTo(100, 1);
    expect(a.lateral).toBeCloseTo(0, 6);
    const b = p.update(150, 3);
    expect(b.s).toBeCloseTo(150, 1);
    expect(b.lateral).toBeCloseTo(3, 6);   // heading east, +z is the right-hand side
  });

  it('stays on the leg it is driving when the other one is closer in space', () => {
    const spline = new Spline(hairpin());
    const p = new Progress(spline);
    p.reacquire(20, 0);
    let last = p.value.s;
    for (let x = 20; x < 190; x += 4) {
      const now = p.update(x, 0).s;
      expect(now).toBeGreaterThanOrEqual(last - 0.001);
      last = now;
    }
    // 20 m away in space from the outbound leg, but hundreds of meters further along the track
    expect(p.update(150, 0).s).toBeLessThan(spline.length / 2);
  });

  it('reacquire is the way back after a teleport', () => {
    const spline = new Spline(hairpin());
    const p = new Progress(spline);
    p.reacquire(20, 0);
    const stale = p.update(60, 20).s;          // jumped to the far leg: the local search cannot see it
    const fresh = p.reacquire(60, 20).s;
    expect(fresh).toBeGreaterThan(stale + 100);
  });
});

describe('Race', () => {
  function drive(race: Race, from: number, to: number, opts: { z?: number; speed?: number; step?: number } = {}) {
    const z = opts.z ?? 0, speed = opts.speed ?? 20, step = opts.step ?? 2;
    const events = [];
    const dir = Math.sign(to - from) || 1;
    for (let x = from; dir > 0 ? x <= to : x >= to; x += step * dir) {
      events.push(...race.update(step / speed, sample(x, z, speed, dir, 0)));
    }
    return events;
  }

  it('clears gates in order and finishes a sprint', () => {
    const track = straight();
    track.checkpoints = [gate(0), gate(100), gate(200), gate(400)];
    const race = new Race(track, new Spline(track));
    race.start();
    const events = drive(race, 0, 460);
    // gate zero is the start line: the car begins on it, so it is cleared rather than driven through
    expect(events.filter((e) => e.type === 'checkpoint').map((e) => e.index)).toEqual([1, 2, 3]);
    expect(events.some((e) => e.type === 'finish')).toBe(true);
    expect(race.state).toBe('finished');
    expect(race.time).toBeGreaterThan(0);
  });

  it('only exposes the finish approach after the final gate becomes next', () => {
    const track = straight();
    track.checkpoints = [gate(0), gate(100), gate(400)];
    const race = new Race(track, new Spline(track));
    race.start();
    expect(race.distanceToFinish()).toBeNull();
    drive(race, 0, 120);
    expect(race.distanceToFinish()).toBeCloseTo(280, 1);
    drive(race, 120, 360);
    expect(race.distanceToFinish()).toBeCloseTo(40, 1);
    drive(race, 360, 420);
    expect(race.distanceToFinish()).toBeNull();
  });

  it('does not clear a gate the car reverses back over', () => {
    const track = straight();
    track.checkpoints = [gate(0), gate(100), gate(200)];
    const race = new Race(track, new Spline(track));
    race.start();
    drive(race, 0, 120);
    expect(race.checkpointsCleared).toBe(2);
    const back = drive(race, 120, 60, { speed: 10 });
    expect(back.filter((e) => e.type === 'checkpoint')).toEqual([]);
    expect(race.checkpointsCleared).toBe(2);
    // and driving forward again does not double-count the one already cleared
    const again = drive(race, 60, 130, { speed: 10 });
    expect(again.filter((e) => e.type === 'checkpoint')).toEqual([]);
  });

  it('counts laps and finishes the last one', () => {
    const pts: Vec3[] = [];
    for (let i = 0; i < 200; i++) {
      const th = (i / 200) * Math.PI * 2;
      pts.push([Math.cos(th) * 100, 0, Math.sin(th) * 100]);
    }
    const track = trackFrom(pts, { mode: 'loop', laps: 2 });
    track.spline.closed = true;
    track.spline.length = 2 * Math.PI * 100;
    track.checkpoints = [gate(0), gate(200), gate(400)];
    const spline = new Spline(track);
    const race = new Race(track, spline);
    race.start();
    const events = [];
    for (let k = 0; k < 900; k++) {
      const i = spline.wrapIndex(k);
      const p = spline.point(i);
      const t = spline.tangent(i);
      events.push(...race.update(0.05, sample(p[0], p[2], 20, t[0], t[2])));
    }
    expect(events.filter((e) => e.type === 'lap').map((e) => e.lap)).toEqual([2]);
    expect(events.some((e) => e.type === 'finish')).toBe(true);
  });

  it('does not brake for a circuit finish until the final lap and final sector', () => {
    const points: Vec3[] = [];
    for (let i = 0; i < 200; i++) {
      const th = (i / 200) * Math.PI * 2;
      points.push([Math.cos(th) * 100, 0, Math.sin(th) * 100]);
    }
    const track = trackFrom(points, { mode: 'loop', laps: 2 });
    track.spline.closed = true; track.spline.length = 2 * Math.PI * 100;
    track.checkpoints = [gate(0), gate(200), gate(400)];
    const race = new Race(track, new Spline(track)); race.start();
    race.nextCheckpoint = 0;
    expect(race.distanceToFinish()).toBeNull();
    race.lap = 2; race.reacquire(points[180]![0], points[180]![2]);
    expect(race.distanceToFinish()).toBeGreaterThan(40);
    expect(race.distanceToFinish()).toBeLessThan(100);
  });

  it('requires a full stop at a delivery point, and only counts it once', () => {
    const track = straight();
    track.mode = 'multistop';
    track.checkpoints = [gate(0), gate(100, { stop: true }), gate(200)];
    const race = new Race(track, new Spline(track));
    race.start();
    drive(race, 0, 98);
    expect(race.checkpointsCleared).toBe(1);
    // rolling through at speed does not count
    const through = drive(race, 98, 104, { speed: 20 });
    expect(through.some((e) => e.type === 'checkpoint')).toBe(false);
    expect(through.some((e) => e.type === 'stop-required')).toBe(true);
    // stopping there does
    const parked = [];
    for (let i = 0; i < 30; i++) parked.push(...race.update(0.05, sample(100, 0, 0.5)));
    expect(parked.filter((e) => e.type === 'checkpoint').map((e) => e.index)).toEqual([1]);
    expect(race.checkpointsCleared).toBe(2);
  });

  it('notices the car is facing back down the track', () => {
    const track = straight();
    track.checkpoints = [gate(0), gate(400)];
    const race = new Race(track, new Spline(track));
    race.start();
    for (let i = 0; i < WRONG_WAY_SECONDS / 0.1 + 2; i++) race.update(0.1, sample(200, 0, 20, -1, 0));
    expect(race.wrongWay).toBe(true);
    for (let i = 0; i < 5; i++) race.update(0.1, sample(200, 0, 20, 1, 0));
    expect(race.wrongWay).toBe(false);
  });

  it('puts the car back at the last gate after it has been off the road for a while', () => {
    const track = straight();
    track.checkpoints = [gate(0), gate(100), gate(200)];
    const race = new Race(track, new Spline(track));
    race.start();
    drive(race, 0, 120);
    const far = 4 + OFF_TRACK_MARGIN + 5;
    let events = [];
    for (let i = 0; i < OFF_TRACK_SECONDS / 0.1 + 2; i++) events.push(...race.update(0.1, sample(130, far, 10)));
    expect(events.some((e) => e.type === 'reset')).toBe(true);
    expect(events.find((e) => e.type === 'reset')).toMatchObject({
      resetReason: 'off-track', lateral: far, halfWidth: 4, speed: 10,
    });
    const put = race.takeReset()!;
    expect(put).not.toBeNull();
    //Not all the way back to gate one (100) -- just behind where it left the road (120).
    expect(put.pos[0]).toBeGreaterThan(100);
    expect(Math.abs(put.pos[0] - (120 - RESCUE_BACK_M))).toBeLessThanOrEqual(2);
    expect(race.takeReset()).toBeNull();
  });

  it('rescues from where the car last drove properly, never past a gate it has not cleared', () => {
    const track = straight();
    track.checkpoints = [gate(0), gate(100), gate(400)];
    const race = new Race(track, new Spline(track));
    race.start();
    drive(race, 0, 180);
    // Off the road, then back onto it far ahead: a cut, which moves the rescue spot nowhere.
    for (let i = 0; i < 5; i++) race.update(0.1, sample(185, 4 + OFF_TRACK_MARGIN + 5, 20));
    race.update(0.1, sample(260, 0, 20));
    race.requestReset();
    const put = race.takeReset()!;
    expect(Math.abs(put.pos[0] - (180 - RESCUE_BACK_M))).toBeLessThanOrEqual(2);
    // And a gate still ahead bounds it: driving on to 390 and rescuing never lands past gate 400.
    drive(race, put.pos[0], 398);
    race.requestReset();
    expect(race.takeReset()!.pos[0]).toBeLessThan(400);
  });

  it('a cut does not freeze the rescue spot: after driving on properly, a rescue lands just behind the car again', () => {
    const track = straight();
    track.checkpoints = [gate(0), gate(20), gate(490)];
    const race = new Race(track, new Spline(track));
    race.start();
    drive(race, 0, 60);
    for (let i = 0; i < 5; i++) race.update(0.1, sample(70, 4 + OFF_TRACK_MARGIN + 5, 20));
    drive(race, 150, 350);
    race.requestReset();
    expect(Math.abs(race.takeReset()!.pos[0] - (350 - RESCUE_BACK_M))).toBeLessThanOrEqual(2);
  });

  it('backs off further each time a rescue lands on the same spot, but never behind the last cleared gate', () => {
    const track = straight();
    track.checkpoints = [gate(0), gate(100), gate(400)];
    const race = new Race(track, new Spline(track));
    race.start();
    drive(race, 0, 300);
    const spots: number[] = [];
    for (let i = 0; i < 6; i++) {
      race.requestReset();
      spots.push(race.takeReset()!.pos[0]);
      drive(race, spots.at(-1)!, spots.at(-1)! + 16, { step: 2 });
    }
    expect(spots[1]!).toBeLessThan(spots[0]! - RESCUE_REPEAT_BACK_M + 5);
    expect(spots.every(x => x >= 100 - 2)).toBe(true);
    expect(spots.at(-1)!).toBeCloseTo(100, -1);
  });

  it('on a loop, a rescue after the start gate lands just behind the car, not a whole sector back', () => {
    const pts: Vec3[] = [];
    const radius = 500 / Math.PI;
    for (let i = 0; i < 500; i++) { const a = i / 500 * Math.PI * 2; pts.push([Math.cos(a) * radius, 0, Math.sin(a) * radius]); }
    const track = trackFrom(pts, { mode: 'loop', laps: 1 });
    track.spline.closed = true;
    const spline = new Spline(track);
    track.checkpoints = [0, 1 / 3, 2 / 3].map(f => ({ s: f * spline.length, pos: [0, 0, 0], dir: [1, 0, 0], halfWidth: 5 } as Checkpoint));
    const race = new Race(track, spline);
    race.start();
    let before: number[] = [];
    for (let i = 1; i <= 250; i++) {
      const a = i / 500 * Math.PI * 2;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      race.update(0.1, sample(x, z, 20, -Math.sin(a), Math.cos(a)));
      before = [x, z];
    }
    race.requestReset();
    const put = race.takeReset()!;
    expect(race.lap).toBe(1);
    expect(Math.hypot(put.pos[0] - before[0]!, put.pos[2] - before[1]!)).toBeLessThan(RESCUE_BACK_M + 10);
  });

  it('a brief excursion is not a reset', () => {
    const track = straight();
    track.checkpoints = [gate(0), gate(200)];
    const race = new Race(track, new Spline(track));
    race.start();
    let events = [];
    // brief now means brief: with a rail at the road edge, a second spent twenty metres off it is
    // not an excursion, it is a crash
    for (let i = 0; i < 4; i++) events.push(...race.update(0.1, sample(100, 20, 20)));
    for (let i = 0; i < 10; i++) events.push(...race.update(0.1, sample(110, 0, 20)));
    expect(events.some((e) => e.type === 'reset')).toBe(false);
  });

  it('warns an ordinary car before rescue and cancels the warning when it returns', () => {
    const track = straight(), race = new Race(track, new Spline(track));
    race.start();
    const far = 4 + OFF_TRACK_MARGIN + 5;
    expect(race.update(OFF_TRACK_WARNING_SECONDS, sample(100, far, 10))).toEqual([]);
    expect(race.rescueWarning).toBe(true);
    race.update(.1, sample(105, 0, 10));
    expect(race.rescueWarning).toBe(false);
    expect(race.takeReset()).toBeNull();
    const events = race.update(OFF_TRACK_SECONDS, sample(110, far, 10));
    expect(events).toEqual([expect.objectContaining({ type: 'reset', resetReason: 'off-track' })]);
    const request = race.takeReset()!;
    expect(request).toMatchObject({ resetReason: 'off-track', lateral: far, halfWidth: 4, speed: 10 });
    race.requestReset(request); // a busy recovery spot retries the same request on the next frame
    expect(race.rescueWarning).toBe(true);
    expect(race.takeReset()).toEqual(request);
  });

  it('a manual reset goes to the start line before any gate is cleared', () => {
    const track = straight();
    track.checkpoints = [gate(0), gate(100)];
    const race = new Race(track, new Spline(track));
    race.requestReset();
    const put = race.takeReset()!;
    expect(put.pos[0]).toBeCloseTo(track.start.pos[0], 6);
  });
});

describe('formatTime', () => {
  it('reads as a lap time', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(9.5)).toBe('0:09.50');
    expect(formatTime(125.25)).toBe('2:05.25');
  });
});


describe('slow slime traversal versus a stopped car', () => {
  for (const speed of [0, .6]) it(`handles ${speed} m/s consistently in the driver and rescue`, () => {
    const track = straight();
    const spline = new Spline(track);
    const race = new Race(track, spline);
    const bot = new Autopilot(spline);
    race.start(); race.reacquire(100, 0);
    let reverse = 0, resets = 0;
    for (let i = 0; i < 600; i++) {
      const car = sample(100 + speed * i / 60, 0, speed);
      const input = bot.drive(1 / 60, { ...car, forwardSpeed: speed }, race.progress.value);
      if (input.brake) reverse++;
      resets += race.update(1 / 60, car).filter(event => event.type === 'reset').length;
    }
    if (speed === 0) { expect(reverse).toBeGreaterThan(0); expect(resets).toBeGreaterThan(0); }
    else { expect(reverse).toBe(0); expect(resets).toBe(0); }
  });
});


describe('slime scoring for one run', () => {
  it('rewards body size and counts each identity once, only while racing', () => {
    const track = straight(); const race = new Race(track, new Spline(track));
    race.hitSlime('a', [2, 2, 2]); expect(race.score).toBe(0);
    race.start();
    race.hitSlime('a', [2, 2, 2]);
    for (let i = 0; i < 120; i++) race.hitSlime('a', [2, 2, 2]);
    race.requestReset(); race.takeReset(); race.hitSlime('a', [2, 2, 2]);
    expect(race.score).toBe(200); expect(race.slimeHits).toBe(1);
    // The second slime lands inside the 4 s window: a 2-combo pays 1.25x.
    race.hitSlime('b', [4, 4, 4]); expect(race.score).toBe(700);
    expect(race.slimeHits).toBe(2);
    expect(race.scoreAwards).toEqual([
      {id:1, points:200, total:200, source:'slime', combo:1, at:0},
      {id:2, points:500, total:700, source:'slime', combo:2, at:0},
    ]);
    expect(race.ratingScore, 'stars read the score without the combo bonus').toBe(600);
    race.state = 'finished'; race.hitSlime('c', [20, 20, 20]); expect(race.score).toBe(700);
    const retry = new Race(track, new Spline(track)); retry.start();
    retry.hitSlime('a', [2, 2, 2]); expect(retry.score).toBe(200);
  });
  it('multiplies slime points by the combo inside a 4 s window, capped at 3x, and keeps stars on the base score', () => {
    expect([1, 2, 3, 5, 9, 20].map(comboMultiplier)).toEqual([1, 1.25, 1.5, 2, 3, 3]);
    const track = straight(); const race = new Race(track, new Spline(track)); race.start();
    const combos: number[] = [];
    for (let i = 0; i < 10; i++) { race.time = i * 3.9; race.hitSlime(`chain-${i}`, [1, 1, 1]); combos.push(race.scoreAwards.at(-1)!.combo!); }
    expect(combos).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(race.maxCombo).toBe(10);
    // 100 base points each: 100 + 125 + 150 + ... capped at 300 from the ninth slime on.
    expect(race.scoreAwards.map(a => a.points)).toEqual([100, 125, 150, 175, 200, 225, 250, 275, 300, 300]);
    expect(race.ratingScore).toBe(1000);
    expect(race.score - race.ratingScore).toBe(race.comboBonus);
    // A gap longer than the window starts over at 1.
    race.time += COMBO_WINDOW_SECONDS + .01; race.hitSlime('late', [1, 1, 1]);
    expect(race.scoreAwards.at(-1)).toMatchObject({ combo: 1, points: 100 });
    expect(race.maxCombo).toBe(10);
  });
  it('accounts for all body dimensions instead of only the widest one', () => {
    expect(slimePoints([2, 2, 2])).toBe(200);
    expect(slimePoints([2, 4, 2])).toBeGreaterThan(200);
    expect(slimePoints([20, 20, 20])).toBeGreaterThan(slimePoints([4, 4, 4]));
  });
});

describe('clean corner scoring', () => {
  function cornerTrack(): TrackData {
    const track = straight(80);
    track.spline.curvature = Array.from({length: 80}, (_, index) => index >= 10 && index <= 29 ? .015 : 0);
    return track;
  }

  it('turns authored curvature into one stable, non-farmable corner', () => {
    const spline = new Spline(cornerTrack());
    const map = cleanCornerMap(spline);
    expect(new Set([...map].filter(id => id >= 0))).toEqual(new Set([0]));
    expect([...map].filter(id => id === 0)).toHaveLength(20);
  });

  it('awards a full clean pass, rejects a solid hit, and keeps ordinary slime hits compatible', () => {
    const clean = new Race(cornerTrack(), new Spline(cornerTrack())); clean.start();
    const events = [];
    for (let x = 0; x <= 80; x += 2) {
      if (x === 30) clean.hitSlime('ordinary', [1, 1, 1], 'popper');
      events.push(...clean.update(.1, {...sample(x, 0), hardCollision: false}));
    }
    expect(events.filter(event => event.type === 'clean-corner')).toEqual([
      {type: 'clean-corner', points: CLEAN_CORNER_POINTS},
    ]);
    expect(clean.cleanCorners).toBe(1);
    expect(clean.score).toBe(100 + CLEAN_CORNER_POINTS);
    expect(clean.scoreAwards.map(award => award.source)).toEqual(['slime', 'clean-corner']);
    for (let x = 80; x >= 0; x -= 2) clean.update(.1, sample(x, 0, 20, -1));
    for (let x = 0; x <= 80; x += 2) clean.update(.1, sample(x, 0));
    expect(clean.cleanCorners).toBe(1);

    const hit = new Race(cornerTrack(), new Spline(cornerTrack())); hit.start();
    for (let x = 0; x <= 80; x += 2)
      hit.update(.1, {...sample(x, 0), hardCollision: x === 30});
    expect(hit.cleanCorners).toBe(0);
    expect(hit.score).toBe(0);
  });
});

it('combos count distinct hits inside four race seconds, freeze when time does, and reset with a new race', () => {
  const track = straight(), race = new Race(track, new Spline(track));
  race.hitSlime('before', [1, 1, 1]);
  expect(race.maxCombo).toBe(0);
  race.start();
  race.hitSlime('green', [1, 1, 1]);
  race.time = 4;
  race.hitSlime('yellow', [1, 1, 1]);
  race.hitSlime('yellow', [1, 1, 1]);
  expect(race.maxCombo).toBe(2);
  race.hitSlime('paused-clock', [1, 1, 1]);
  expect(race.maxCombo).toBe(3);
  race.time = 8.01;
  race.hitSlime('late', [1, 1, 1]);
  expect(race.maxCombo).toBe(3);
  race.state = 'finished';
  race.hitSlime('after', [1, 1, 1]);
  expect(race.slimeHits).toBe(4);
  expect(new Race(track, new Spline(track)).maxCombo).toBe(0);
});

it('records deduplicated hit colors and time-weighted speed only during the race', () => {
  const track = straight(), race = new Race(track, new Spline(track));
  race.update(1, sample(10, 0, 10));
  expect(race.sections.every(section => section.seconds === 0)).toBe(true);
  race.start();
  race.hitSlime('a', [1, 1, 1], 'burst');
  race.hitSlime('a', [1, 1, 1], 'burst');
  race.hitSlime('b', [1, 1, 1], 'slick');
  expect(race.impactKinds).toEqual({burst: 1, slick: 1});
  race.update(2, sample(20, 0, 5));
  race.update(1, sample(30, 0, 20));
  expect(race.sections[0]).toEqual({seconds: 3, distance: 30});
  race.reacquire(450, 0);
  race.update(1, sample(450, 0, 0));
  expect(race.sections[7]).toEqual({seconds: 1, distance: 0});
  race.state = 'finished';
  race.update(10, sample(450, 0, 20));
  race.hitSlime('c', [1, 1, 1], 'boost');
  expect(race.sections[7]).toEqual({seconds: 1, distance: 0});
  expect(race.impactKinds).toEqual({burst: 1, slick: 1});
});
