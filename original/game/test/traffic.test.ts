import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { planTraffic, type TrafficBody } from '../src/bot/Traffic';
import { Autopilot, AUTOPILOT } from '../src/bot/Autopilot';
import { Spline } from '../src/track/Spline';
import { projectOnSample, Progress } from '../src/track/Progress';
import { Race, WEDGED_SECONDS } from '../src/track/Race';
import type { TrackData } from '../src/track/types';

function fixture(width = 6) {
  const track = JSON.parse(readFileSync('public/tracks/synth-p2p/track.json', 'utf8')) as TrackData;
  track.spline.points = Array.from({ length: 251 }, (_, i) => [0, 0, -i * 2]);
  track.spline.halfWidth = Array(251).fill(width); track.spline.curvature = Array(251).fill(0);
  delete track.spline.s;
  track.spline.length = 500; track.start = { pos: [0, 1, 0], yaw: 0 }; track.checkpoints = [];
  const spline = new Spline(track), at = { s: 100, lateral: 0, index: 50 };
  const own: TrafficBody[] = [{ driver: 'me', s: 100, lateral: 0, halfWidth: 1, halfLength: 2, speed: 15 }];
  const other = (changes: Partial<TrafficBody> = {}): TrafficBody => ({ driver: 'other', s: 125, lateral: 0,
    halfWidth: 1, halfLength: 2, speed: 0, ...changes });
  return { track, spline, at, own, other };
}

it('passes a stopped player through a body-sized clear gap, retaining braking until actually clear', () => {
  const { spline, at, own, other } = fixture();
  const plan = planTraffic(spline, at, own, [...own, other()], 15, 8, 0);
  // Clear of the parked car's side, paint to paint: half-widths 1 + 1, plus the planned scrape gap.
  expect(Math.abs(plan.offset)).toBeGreaterThanOrEqual(2);
  expect(plan.speed).toBeLessThan(20);
  const clear = planTraffic(spline, { ...at, lateral: plan.offset },
    own.map(b => ({ ...b, lateral: plan.offset })), [...own, other()], 15, 8, plan.offset);
  expect(clear.speed).toBe(Infinity);
});
it('narrow roads follow and stop; an oncoming vehicle consumes the same available corridor', () => {
  const { spline, at, own, other } = fixture(2);
  const plan = planTraffic(spline, at, own, [...own, other({ s: 106, speed: -10 })], 15, 8, 0);
  expect(plan.offset).toBe(0); expect(plan.speed).toBe(0);
});
it('cannot merge across an adjacent driver or move the trailer into its occupied lane', () => {
  const { spline, at, own, other } = fixture(4);
  own.push({ ...own[0]!, s: 94, halfLength: 3, halfWidth: 1.2 });
  const plan = planTraffic(spline, at, own, [...own, other(),
    other({ driver: 'side-right', s: 96, lateral: 3 }), other({ driver: 'side-left', s: 96, lateral: -3 })], 15, 8, 0);
  expect(plan.offset).toBe(0); expect(plan.following).toBe(true);
});
it('uses a trailer as an obstacle and narrows the passing corridor before the bend', () => {
  const { spline, at, own, other } = fixture();
  for (let i = 55; i < 65; i++) spline.halfWidth[i] = 2;
  const plan = planTraffic(spline, at, own, [...own, other({ s: 125 }), other({ s: 116, halfLength: 4 })], 20, 8, 0);
  expect(plan.offset).toBe(0); expect(plan.speed).toBeLessThan(15);
});
it('keeps a preferred gap while braking for a vehicle already in that gap', () => {
  const { spline, at, own, other } = fixture();
  const plan = planTraffic(spline, at, own, [...own, other({ s: 107, lateral: 3 })], 10, 8, 0, 3);
  expect(plan.offset).toBe(3); expect(plan.speed).toBe(0);
});
it('a deliberate traffic stop never selects reverse or triggers wedged rescue, but off-road still does', () => {
  const { track, spline, at, own, other } = fixture(2);
  const bot = new Autopilot(spline), race = new Race(track, spline); race.start();
  for (let i = 0; i < (WEDGED_SECONDS + 2) * 60; i++) {
    const input = bot.drive(1 / 60, { x: 0, z: -100, speed: 0, forwardSpeed: 0, headingX: 0, headingZ: -1 },
      at, null, { own, bodies: [...own, other({ s: 106 })] });
    expect(input).toMatchObject({ throttle: 0, brake: 1, parkingBrake: true });
    race.update(1 / 60, { x: 0, z: -100, speed: 0, headingX: 0, headingZ: -1, waitingForTraffic: bot.waitingForTraffic });
    expect(race.takeReset()).toBeNull();
  }
  expect(bot.trafficWaitSeconds).toBeGreaterThan(WEDGED_SECONDS);
  race.update(.2, { x: 30, z: -100, speed: 0, headingX: 0, headingZ: -1, waitingForTraffic: true });
  expect(race.rescueWarning).toBe(true);
  expect(race.takeReset()).toBeNull();
  race.update(1, { x: 30, z: -100, speed: 0, headingX: 0, headingZ: -1, waitingForTraffic: true });
  expect(race.takeReset()).not.toBeNull();
});


it('backs out of a close stop only with a passing lane and room behind the whole rig', () => {
  const { spline, at, own, other } = fixture();
  const blocker = other({ s: 106 });
  expect(planTraffic(spline, at, own, [...own, blocker], 0, 8, 0).reverse).toBe(true);
  expect(planTraffic(spline, at, own, [...own, other({ s: 107.1 })], 0, 8, 0).reverse).toBe(true);
  own.push({ ...own[0]!, s: 94, halfLength: 3 });
  expect(planTraffic(spline, at, own, [...own, blocker, other({ driver: 'behind', s: 88 })], 0, 8, 0).reverse).toBe(false);
});


it('finished cars retain their real distance beyond the finish while race progress stays clamped', () => {
  const { spline } = fixture();
  expect(projectOnSample(spline, 250, 0, -525).s).toBe(525);
  expect(new Progress(spline).reacquire(0, -525).s).toBe(500);
});


it('keeps a swung-out trailer clear of a vehicle behind its own footprint', () => {
  const { spline, at, own, other } = fixture(4);
  own.push({ ...own[0]!, s: 94, lateral: 3, halfLength: 3 });
  const plan = planTraffic(spline, at, own, [...own, other({ s: 107 }), other({ driver: 'behind', s: 91, lateral: 3 })], 0, 8, 0);
  expect(plan.offset).toBe(0);
  expect(plan.reverse).toBe(false);
  expect(plan.reverseSafe).toBe(false);
});


it('lets the tow pull its trailing body around a blocker using the trailer own longitudinal gap', () => {
  const { spline, at, other } = fixture();
  const own = [
    { driver: 'me', s: 100, lateral: -2.48, halfWidth: 1.01, halfLength: 1.65, speed: 0 },
    { driver: 'me', s: 96.62, lateral: -1.16, halfWidth: 1.15, halfLength: 1.49, speed: 0 },
  ];
  const plan = planTraffic(spline, { ...at, lateral: -2.48 }, own,
    [...own, other({ s: 106.12, halfWidth: .516, halfLength: 1.248 })], 0, 8, -2.6);
  expect(plan.speed).toBeGreaterThan(1);
  expect(plan.offset).toBeLessThan(0);
  expect(plan.reverse).toBe(false);
});


it('a parked vehicle drifting slightly backward behind the driver never becomes a front stop', () => {
  const { spline, at, own, other } = fixture();
  const plan = planTraffic(spline, at, own, [...own, other({ s: 90, speed: -.00001 })], 10, 8, 0);
  expect(plan.speed).toBe(Infinity);
  expect(plan.following).toBe(false);
});


it('queues through the real Lombard switchbacks instead of reversing into a parallel passing lane', () => {
  const track = JSON.parse(readFileSync('public/tracks/lombard/track.json', 'utf8')) as TrackData;
  const spline = new Spline(track);
  const at = { s: 1238, lateral: 0, index: spline.indexAt(1238) };
  const own = [{ driver: 'me', s: 1238, lateral: 0, halfWidth: 1, halfLength: 2, speed: 2 }];
  const leader = { ...own[0]!, driver: 'leader', s: 1244, speed: 0 };
  const plan = planTraffic(spline, at, own, [...own, leader], 2, 8, 3);
  expect(plan.offset).toBe(0);
  expect(plan.following).toBe(true);
  expect(plan.speed).toBe(0);
  expect(plan.reverse).toBe(false);
});


it('brakes a reverse manoeuvre at its speed limit and arrests downhill rollback before steering forward', () => {
  const { spline, at, own, other } = fixture();
  const bot = new Autopilot(spline);
  const view = (forwardSpeed: number) => ({ x: 0, z: -100, speed: Math.abs(forwardSpeed),
    forwardSpeed, headingX: 0, headingZ: -1 });
  const traffic = { own, bodies: [...own, other({ s: 106 })] };
  expect(bot.drive(.1, view(0), at, null, traffic)).toMatchObject({ throttle: 0, brake: 1, steer: 0 });
  expect(bot.drive(.1, view(-4), at, null, traffic)).toMatchObject({
    throttle: 0, brake: 1, steer: 0, parkingBrake: true });
  bot.drive(3, view(-1), at, null, { own, bodies: own });
  expect(bot.drive(.1, view(-1), at, null, { own, bodies: own })).toMatchObject({
    throttle: 0, brake: 1, steer: 0, parkingBrake: true });
  expect(bot.drive(.1, view(0), at, null, { own, bodies: own }).throttle).toBe(1);
});


it('accelerates in an aligned clear passing lane but keeps lane-change and slime braking', () => {
  const {spline,at,own,other}=fixture();
  const bot=new Autopilot(spline,{...AUTOPILOT,avoidSpeed:20,passingSpeed:50});
  const leader=other({speed:15});
  const traffic={own,bodies:[...own,leader]};
  const view={x:0,z:-100,speed:25,forwardSpeed:25,headingX:0,headingZ:-1};
  const plan=planTraffic(spline,at,own,traffic.bodies,25,8,0);
  expect(Math.abs(plan.offset)).toBeGreaterThanOrEqual(2);
  expect(bot.drive(3,view,at,null,traffic).throttle).toBe(0);   // 3 s at 1.5 m/s reaches the lane
  const alignedOwn=own.map(body=>({...body,lateral:plan.offset,speed:25}));
  const aligned={...view,x:plan.offset};
  const alignedAt={...at,lateral:plan.offset};
  const clear={own:alignedOwn,bodies:[...alignedOwn,leader]};
  expect(bot.drive(1/60,aligned,alignedAt,null,clear)).toMatchObject({throttle:1,brake:0});
  expect(bot.drive(1/60,{...aligned,slimeAhead:0},alignedAt,null,clear).brake).toBe(1);
  /* */
  expect(bot.drive(1/60,aligned,alignedAt,null,{own:alignedOwn,bodies:alignedOwn})).toMatchObject({throttle:1,brake:0});
});

it('does not reverse a hull into a road edge even when there is no car behind',()=>{
  const {spline,at,own,other}=fixture();
  const angled={...own[0]!,lateral:4,pose:{x:4,z:-100,headingX:-.5,headingZ:-Math.sqrt(.75),halfWidth:1,halfLength:2}};
  const plan=planTraffic(spline,{...at,lateral:4},[angled],[angled,other({s:105,lateral:4})],0,8,4);
  expect(plan.reverse).toBe(false);
  expect(plan.reverseSafe).toBe(false);
  const centred={...own[0]!,pose:{x:0,z:-100,headingX:0,headingZ:-1,halfWidth:1,halfLength:2}};
  expect(planTraffic(spline,at,[centred],[centred,other({s:105})],0,8,0).reverse).toBe(true);
});

it('Passes a slower bus from the side when cars further on are never reached, and keeps that line', () => {
  const { spline, at, other } = fixture(6);
  const own: TrafficBody[] = [{ driver: 'me', s: 100, lateral: 0, halfWidth: 1, halfLength: 2, speed: 30 }];
  const bus = other({ driver: 'bus', s: 120, lateral: 0, halfWidth: 1.3, halfLength: 5.5, speed: 20 });
  const far = [-2.5, 2.5].map((lateral, i) => other({ driver: `far-${i}`, s: 185, lateral, speed: 30 }));
  const plan = planTraffic(spline, at, own, [...own, bus, ...far], 30, 8, 0);
  expect(Math.abs(plan.offset)).toBeCloseTo(2.5);   // bus half-width 1.3 + own 1 + the .2 scrape gap
  // A side whose nearer, slower car gains less over the next seconds than following the bus is not taken.
  const slow = [-2.5, 2.5].map((lateral, i) => other({ driver: `slow-${i}`, s: 135, lateral, speed: 14 }));
  const queued = planTraffic(spline, at, own, [...own, bus, ...slow], 30, 8, 0);
  expect(queued.offset).toBe(0);
  expect(queued.following).toBe(true);
  // Beside the bus in its new lane, it holds that lane rather than swinging back in front of it.
  const passing = { s: 118, lateral: 2.5, index: 59 };
  const beside = planTraffic(spline, passing, [{ ...own[0]!, s: 118, lateral: 3.25 }], [bus], 30, 8, 3.25);
  expect(beside.offset).toBeCloseTo(3.25);
  expect(beside.speed).toBe(Infinity);
});

it('A line is only left for a clearly faster one', () => {
  const { spline, at, other } = fixture(6);
  const own: TrafficBody[] = [{ driver: 'me', s: 100, lateral: 3.18, halfWidth: 1, halfLength: 2, speed: 30 }];
  const leader = other({ driver: 'leader', s: 125, lateral: 3.18, speed: 29 });
  const other2 = other({ driver: 'centre', s: 125, lateral: 0, speed: 30 });
  const plan = planTraffic(spline, { ...at, lateral: 3.18 }, own, [...own, leader, other2], 30, 8, 3.18);
  expect(plan.offset).toBeCloseTo(3.18);
});

it('Backing up is chosen when it is the best way on, and never into a car behind', () => {
  const { spline, at, own, other } = fixture(6);
  own[0] = { ...own[0]!, speed: 0 };
  // Stopped 1 m behind a stopped car: too close to steer onto either side, so going on gains nothing;
  // a few metres back, a side opens.
  const knot = [...own, other({ driver: 'stopped', s: 105, lateral: 0, speed: 0 })];
  const plan = planTraffic(spline, at, own, knot, 0, 8, 0);
  expect(plan.reverse).toBe(true);
  expect(plan.reverseMetres).toBeGreaterThan(0);
  const boxedIn = planTraffic(spline, at, own, [...knot, other({ driver: 'behind', s: 96, lateral: 0 })], 0, 8, 0);
  expect(boxedIn.reverse).toBe(false);
  // Nothing in the way: going on always wins.
  expect(planTraffic(spline, at, own, [...own, other({ s: 140, speed: 15 })], 15, 8, 0).reverse).toBe(false);
});

it('The driver engages a planned reverse only once it is nearly stopped', () => {
  const { spline, at, own, other } = fixture(6);
  const bot = new Autopilot(spline);
  const traffic = { own, bodies: [...own, other({ s: 105, speed: 0 })] };
  const view = (forwardSpeed: number) => ({ x: 0, z: -100, speed: Math.abs(forwardSpeed), forwardSpeed,
    headingX: 0, headingZ: -1 });
  // Rolling into the same knot, the answer is the brakes, not reverse: a reverse begun at speed holds
  // the brakes with the wheel straight for up to three seconds, through whatever comes next.
  bot.drive(1 / 60, view(20), at, null, traffic);
  expect((bot as unknown as { reversing: number }).reversing).toBe(0);
  bot.drive(1 / 60, view(0), at, null, traffic);
  expect((bot as unknown as { reversing: number }).reversing).toBeGreaterThan(0);
});

it('A car that has chosen a clear line beside a parked car may crawl out onto it', () => {
  // ai-driving 185: stopped 3 m behind a parked player, the sports car picked the lane beside it and then
  // held at 0.1 m/s -- the speed its own overlap with the parked car allowed -- so it never steered out.
  const { spline, own, other } = fixture(6);
  const stopped = [{ ...own[0]!, s: 99.7, lateral: .59, halfWidth: .98, halfLength: 1.6, speed: 0 }];
  const plan = planTraffic(spline, { s: 99.7, lateral: .59, index: 50 }, stopped,
    [...stopped, other({ driver: 'parked', s: 106, lateral: 0, halfWidth: .63, halfLength: 1.54, speed: 0 })], 0, 8, .59);
  // Three metres of road is not the four the turn needs, so the way out is back, not a 0.1 m/s crawl.
  expect(plan.reverse).toBe(true);
  const roomy = planTraffic(spline, { s: 97, lateral: .59, index: 50 }, [{ ...stopped[0]!, s: 97 }],
    [{ ...stopped[0]!, s: 97 }, { driver: 'parked', s: 106, lateral: 0, halfWidth: .63, halfLength: 1.54, speed: 0 }], 0, 8, .59);
  expect(roomy.speed).toBeGreaterThanOrEqual(2);
});

it('A rig never waits for a car tucked in beside its tow, and that car does not drive into it', () => {
  // Twin-peaks 670 m: a jeep stopped with its nose beside a pickup's tow body and its tail at the
  // trailer's nose. The trailer took the jeep for a car ahead, the jeep took the tow for one: both
  // waited for the other until the race ended.
  const { spline, other } = fixture(6);
  const tow = { driver: 'pickup', s: 100.5, lateral: 4.1, halfWidth: .9, halfLength: 2.4, speed: 0 };
  const trailer = { driver: 'pickup', s: 95.3, lateral: 4.0, halfWidth: .9, halfLength: 2.2, speed: 0 };
  const jeep = other({ driver: 'jeep', s: 99.5, lateral: 3.0, halfWidth: .85, halfLength: 2.1 });
  const rig = planTraffic(spline, { s: 100.5, lateral: 4.1, index: 50 }, [tow, trailer], [tow, trailer, jeep], 0, 8, 4.1);
  expect(rig.speed).toBeGreaterThan(0);
  const stuck = planTraffic(spline, { s: 99.5, lateral: 3.0, index: 50 }, [jeep], [tow, trailer, jeep], 0, 8, 3.0);
  expect(stuck.speed).toBe(0);
});

it('In any knot of stopped cars the first in right of way is never held by traffic', () => {
  // The property that makes a lock impossible, checked on 400 seeded random knots of cars and rigs
  // rather than on the two twin-peaks locks it was found from.
  const { spline } = fixture(6);
  let seed = 390;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const frontOf = (rig: TrafficBody[], at: number) => Math.max(...rig.map(body => body.s - at + body.halfLength));
  for (let knot = 0; knot < 400; knot++) {
    const rigs = Array.from({ length: 2 + Math.floor(random() * 5) }, (_, i) => {
      const tow = { driver: `car-${i}`, s: 100 + random() * 12, lateral: -4 + random() * 8,
        halfWidth: .5 + random() * .6, halfLength: 1.2 + random() * 2.5, speed: 0 };
      return random() < .3 ? [tow, { ...tow, s: tow.s - tow.halfLength - 2.4, lateral: tow.lateral + random() - .5, halfLength: 2 }] : [tow];
    });
    const bodies = rigs.flat();
    const first = [...rigs].sort((a, b) => frontOf(b, 100) - frontOf(a, 100) || (a[0]!.driver < b[0]!.driver ? -1 : 1))[0]!;
    const plan = planTraffic(spline, { s: first[0]!.s, lateral: first[0]!.lateral, index: spline.indexAt(first[0]!.s) },
      first, bodies, 0, 8, first[0]!.lateral);
    expect(plan.speed, `knot ${knot}`).toBe(Infinity);
  }
});

it('The autopilot brakes for a bend on the grip the weather leaves', () => {
  const track = JSON.parse(readFileSync('public/tracks/lombard/track.json', 'utf8')) as TrackData;
  const spline = new Spline(track);
  // 1447 m on Lombard: a straight run into the 1462-1475 m switchback where the snow run left the road.
  const index = spline.indexAt(1447), point = spline.point(index), tangent = spline.tangent(index);
  const at = { s: 1447, lateral: 0, index };
  const view = (speed: number, weatherGrip?: number) => ({ x: point[0], z: point[2], speed, forwardSpeed: speed,
    headingX: tangent[0], headingZ: tangent[2], weatherGrip });
  const speed = [14, 16, 18, 20].find(v => new Autopilot(spline).drive(1 / 60, view(v), at).brake === 0
    && new Autopilot(spline).drive(1 / 60, view(v, .62), at).brake === 1);
  expect(speed, 'some approach speed is fine dry and too fast in snow').toBeDefined();
});

it('Far off the road direction the pursuit aims closer and turns the car back harder', () => {
  const { spline, at } = fixture(7);
  const angle = 60 * Math.PI / 180;
  const car = { x: 0, z: -100, speed: 5, forwardSpeed: 5, headingX: Math.sin(angle), headingZ: -Math.cos(angle),
    steeringInputForCurvature: (k: number) => Math.max(-1, Math.min(1, k * 2)) };
  const steer = new Autopilot(spline).drive(1 / 60, car, at).steer;
  // A 12 m aim asks for 0.29 of lock here; the 6 m aim used past 25 degrees asks for 0.58.
  expect(Math.abs(steer)).toBeGreaterThan(.45);
});
