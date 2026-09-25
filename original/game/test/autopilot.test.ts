import * as THREE from 'three';
import { SlimeLayer, type SlimeSpawn } from '../src/world/Slimes';
import { QUALITY_LIMITS } from '../src/world/quality';
import { Trailer } from '../src/physics/Trailer';
import { IdealRace } from '../src/bot/IdealRace';
import { projectOnSample } from '../src/track/Progress';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from '../e2e/evidence';
import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { FINISH_ROLLOUT_DISTANCE, PARKING_FIRST_ROW_DISTANCE } from '../src/app/Racer';
import { Autopilot, autopilotSettingsFor } from '../src/bot/Autopilot';
import { AI_DIFFICULTIES, aiSettingsFor, type AiDifficulty } from '../src/bot/difficulty';
import { Car } from '../src/physics/Car';
import { defaultVehicle, VEHICLES, vehicleFor, vehicleTuning } from '../src/vehicles/catalogue';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { Race } from '../src/track/Race';
import type { TrimeshCollider } from '../src/physics/colliders';
import { Spline, buildSafetyNet } from '../src/track/Spline';
import { parseTrack } from '../src/track/schema';
import type { TrackData } from '../src/track/types';
import { BUILT } from '../src/app/tracks';
import { directedTrack, raceKey } from '../src/track/Direction';
import { AI_PACE, AI_PACE_DIFFICULTY, AI_PACE_ESTIMATES } from '../src/track/aiPace';

let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); }, 60_000);

function loadBuilt(id: string): TrackData | null {
  const path = resolve(process.cwd(), `public/tracks/${id}/track.json`);
  return existsSync(path) ? parseTrack(JSON.parse(readFileSync(path, 'utf-8'))) : null;
}

/**
 * Drive a track with only the spline's own safety net for ground.
 *
 * This deliberately leaves the tiles out. It answers one question and answers it cheaply: can the
 * driver follow this racing line and clear every gate. Whether the scenery loads in time is a
 * different question, and it belongs in a real browser.
 */
/** The collision-bearing beam of the production guardrail, without its decorative posts. */
function testRails(spline: Spline, bottom = 0.28, top = 0.60, offset = 0.3, step = 3): TrimeshCollider {
  const v: number[] = [];
  const idx: number[] = [];
  // Production removes only the transverse end caps. These two independent side strips are
  // already open forwards/backwards, so every sample belongs to the collision-bearing rail.
  const lo = 0;
  const hi = spline.count;
  const keep: number[] = [];
  for (let i = lo; i < hi; i += step) keep.push(i);
  if (keep.at(-1) !== hi - 1) keep.push(hi - 1);
  for (let side = -1; side <= 1; side += 2) {
    const base = v.length / 3;
    const edge = keep.map((i) => {
      const p = spline.point(i);
      const r = spline.right(i);
      const w = (spline.halfWidth[i] ?? 6) + offset;
      return [p[0] + r[0] * side * w, p[2] + r[2] * side * w] as [number, number];
    });
    // On the inside of a bend, the nearest centre sample is not always the one that placed this
    // rail vertex. Production owns the exact buffered boundary; this cheap physics fixture keeps
    // the same minimum clearance without loading tile meshes into every robot-driver unit test.
    for (let pass = 0; pass < 3; pass++) {
      for (const point of edge) {
        let nearest = 0;
        let distance = Infinity;
        for (let j = 0; j < spline.count; j++) {
          const p = spline.point(j);
          const d = Math.hypot(point[0] - p[0], point[1] - p[2]);
          if (d < distance) { distance = d; nearest = j; }
        }
        const need = (spline.halfWidth[nearest] ?? 6) + offset - distance;
        if (need > 1e-3 && distance > 0) {
          const p = spline.point(nearest);
          point[0] += (point[0] - p[0]) / distance * need;
          point[1] += (point[1] - p[2]) / distance * need;
        }
      }
    }
    for (let row = 0; row < keep.length; row++) {
      const p = spline.point(keep[row]!);
      v.push(edge[row]![0], p[1] + bottom, edge[row]![1], edge[row]![0], p[1] + top, edge[row]![1]);
    }
    const rows = keep.length;
    const segments = spline.closed ? rows : rows - 1;
    for (let k = 0; k < segments; k++) {
      const a = base + 2 * k;
      const b = base + 2 * ((k + 1) % rows);
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // This fixture isolates the driver's line choice and keeps the rail as an ordinary solid wall;
  // Car's angle-sensitive guardrail breakout has its own collision tests and real-tile browser test.
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx), role: 'wall' };
}

function driveOnTheNet(track: TrackData, seconds = 900,
  vehicle = defaultVehicle(track), settings?: ReturnType<typeof autopilotSettingsFor>, spawns?: SlimeSpawn[], difficulty?: AiDifficulty) {
  const spline = new Spline(track);
  const tuning = vehicleTuning(vehicle, vehicle.tuning as TrackData['car']);
  const physics = new PhysicsWorld(api, tuning.gravity);
  // Wider than the road on purpose: running wide should put the car on the verge, where the race's
  // own off-track rule can pick it up, not into the void where nothing can. The beam matches the
  // production rail's collision-bearing height; posts and scenery belong to the browser drive.
  physics.add('net', { trimeshes: [buildSafetyNet(spline, undefined, 10)], boxes: [] });
  physics.add('rails', { trimeshes: [testRails(spline)], boxes: [] });
  const car = new Car(physics, tuning, track.start);
  const layer=spawns?new SlimeLayer(new THREE.Scene(),physics,spline,document.createElement('div'),QUALITY_LIMITS.low,spawns):null;
  if(layer)(layer as any).fallingLimit=0;
  const hits={popper:0,slick:0,burst:0,boost:0,colossus:0};
  if(layer)layer.onHit=(_key,_scale,_car,kind)=>{if(kind)hits[kind]++;};
  const trailer = vehicle.trailer ? new Trailer(physics, car, vehicle) : null;
  const race = new Race(track, spline);
  const ideal = difficulty ? new IdealRace(spline, track, vehicle) : null;
  const bot = new Autopilot(spline, difficulty ? aiSettingsFor(tuning, difficulty) : settings ?? autopilotSettingsFor(tuning));
  race.start();

  const dt = physics.timestep;
  let airborne = 0;
  let resets = 0;
  const resetAt: number[] = [];
  let steps = 0;
  const limit = Math.round(seconds / dt);
  for (; steps < limit && race.state !== 'finished'; steps++) {
    const p = car.position;
    const q = car.quaternion;
    // heading on the ground: the car's local -Z turned by its yaw
    const hx = 2 * (q.x * q.z + q.w * q.y);
    const hz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const view = { raceTime: race.time, lap: race.lap, x: p.x, z: p.z, speed: car.speed, forwardSpeed: car.forwardSpeed, gripping: car.gripping,
                   headingX: -hx, headingZ: -hz, slimeAhead:layer?.distanceToHazard(car,420),
                   steeringTransitionSpeed: (from: number, to: number, distance: number) => car.steeringTransitionSpeed(from, to, distance),
                   steeringSpeedLimit: (curvature: number, distance: number) => car.steeringSpeedLimit(curvature, distance),
                   steeringInputForCurvature: (curvature: number) => car.steeringInputForCurvature(curvature) };
    const delivery = race.distanceToStop(), finish = race.distanceToFinish();
    const stopAhead = finish === null ? delivery : Math.min(delivery ?? Infinity,
      finish + (difficulty ? PARKING_FIRST_ROW_DISTANCE : FINISH_ROLLOUT_DISTANCE));
    const own = [car, ...(trailer ? [trailer.car] : [])].map(body => ({ driver: 'driver',
      ...projectOnSample(spline, race.progress.value.index, body.position.x, body.position.z),
      halfWidth: body.tuning.chassisHalf[0], halfLength: body.tuning.chassisHalf[2], speed: body.forwardSpeed }));
    const input = bot.drive(dt, view, race.progress.value, stopAhead,
      difficulty ? {own, bodies: own, slimes: layer?.navigationTargets(car)} : undefined);
    physics.step(dt,h=>{layer?.prepareCar(car,trailer?.car);car.update(h,input);trailer?.update(h);layer?.handleCar(car,input,trailer?.car);},5,()=>layer?.finishPhysicsStep());
    layer?.update(dt);
    if (!car.grounded) airborne++;
    race.update(dt, view);
    const put = race.takeReset();
    if (put) {
      resetAt.push(race.progress.value.s);
      car.reset(put.pos, put.yaw);
      race.reacquire(put.pos[0], put.pos[2]);
      bot.reset();
      resets++;
    }
  }
  const result = {
    idealSeconds: ideal?.seconds, hits, finished: race.state === 'finished',
    time: race.time,
    wallSteps: steps,
    resets,
    resetAt,
    airbornePct: (airborne / Math.max(steps, 1)) * 100,
    sReached: race.progress.value.s,
    length: spline.length,
    lap: race.lap,
  };
  layer?.dispose();trailer?.dispose();physics.dispose();
  return result;
}

describe('Autopilot', () => {
  const golden = loadBuilt('goldengate');
  const loop = loadBuilt('synth-loop');
  const sprint = loadBuilt('synth-p2p');
  const stops = loadBuilt('synth-stops');
  const lombard = loadBuilt('lombard');

  it('calibrates both difficulties once and every vehicle at strong against physical finish time', () => {
    expect(sprint).not.toBeNull();
    const cases = [
      ...AI_DIFFICULTIES.map(difficulty => ({vehicle: defaultVehicle(sprint!), difficulty})),
      ...VEHICLES.filter(vehicle => vehicle.id !== defaultVehicle(sprint!).id).map(vehicle => ({vehicle, difficulty: 'rush' as const})),
    ];
    const results = cases.map(({vehicle,difficulty}) => {
      const run = driveOnTheNet(sprint!, 300, vehicle, undefined, undefined, difficulty);
      const ratio = run.time / run.idealSeconds!;
      expect.soft(run.finished, vehicle.id).toBe(true);
      expect.soft(run.resets, vehicle.id).toBe(0);
      // Hard leans on the whole car -- within 12 % of the physical bound for every vehicle.
      if (difficulty === 'rush') expect.soft(ratio, `${vehicle.id}/${difficulty}`).toBeLessThanOrEqual(1.12);
      return {vehicle:vehicle.id, difficulty, ratio, ...run};
    });
    const tier=(d:AiDifficulty)=>results.find(r=>r.vehicle===defaultVehicle(sprint!).id&&r.difficulty===d)!.time;
    // Hard's catch-up needs a player ahead, and there is none here: this is its plain driving.
    expect(tier('rush')).toBeLessThan(tier('relaxed'));
    const out=evidencePath('ai');mkdirSync(out,{recursive:true});
    writeFileSync(resolve(out,'after-dry.json'),JSON.stringify(results,null,2));
    console.info('AI physical time ratios', JSON.stringify(results));
    const before=JSON.parse(readFileSync(resolve('test/fixtures/ai-before.json'),'utf8'));
    const sport=results.find(r=>r.vehicle==='sports-car')!;
    expect(sport.time).toBeLessThan(before.dry.find((r:{track:string;vehicle:string})=>r.track==='synth-p2p'&&r.vehicle==='sports-car').time*.95);
  }, 120_000);

  it('avoids harmful slimes and collects boosts on the same measured road',()=>{
    const before=JSON.parse(readFileSync(resolve('test/fixtures/ai-before.json'),'utf8'));
    const {track,spawns,result:old}=before.slimes;
    const result=driveOnTheNet(parseTrack(track),180,vehicleFor('sports-car')!,undefined,spawns,'rush');
    const harmful=(hits:typeof result.hits)=>hits.popper+hits.slick+hits.burst;
    expect.soft(result.finished).toBe(true);expect.soft(result.resets).toBe(0);
    expect.soft(harmful(result.hits)).toBeLessThan(harmful(old.hits));
    expect.soft(result.hits.boost).toBeGreaterThan(old.hits.boost);
    expect.soft(result.time, 'No slowing for slimes, so the slime road finishes faster').toBeLessThan(old.time);
    const out=evidencePath('ai');mkdirSync(out,{recursive:true});
    writeFileSync(resolve(out,'after-slimes.json'),JSON.stringify(result,null,2));
    console.info('AI slime choices', JSON.stringify(result));
  },120_000);

  it('never slows the AI for a slime ahead while the acceptance driver still does', () => {
    const data = loadBuilt('synth-p2p')!;
    const spline = new Spline(data), index = 40, point = spline.point(index), tangent = spline.tangent(index);
    const vehicle = vehicleFor('sports-car')!, tuning = vehicleTuning(vehicle, vehicle.tuning as TrackData['car']);
    const view = (slimeAhead: number | null) => ({ x: point[0], z: point[2], speed: 25, forwardSpeed: 25,
      headingX: tangent[0], headingZ: tangent[2], slimeAhead });
    const at = { index, s: spline.s[index]!, lateral: 0 };
    const ai = new Autopilot(spline, aiSettingsFor(tuning, 'rush')).drive(1 / 60, view(3), at);
    const acceptance = new Autopilot(spline, autopilotSettingsFor(tuning)).drive(1 / 60, view(3), at);
    expect(ai.brake).toBe(0);
    expect(acceptance.brake).toBe(1);
  });

  it('keeps a bus moving through gentle same-side sampling changes while checking its actual pursuit arc', () => {
    const data = structuredClone(loadBuilt('synth-p2p')!);
    data.spline.points = Array.from({ length: 101 }, (_, i) =>
      [100 * Math.sin(i * .02), 0, 100 * (1 - Math.cos(i * .02))]);
    data.spline.curvature = Array.from({ length: 101 }, (_, i) => i % 2 ? .014 : .006);
    data.spline.halfWidth = Array(101).fill(6);
    data.spline.closed = false; data.spline.length = 200;
    const spline = new Spline(data), index = 20, point = spline.point(index), tangent = spline.tangent(index);
    const vehicle = vehicleFor('school-bus')!, tuning = vehicleTuning(vehicle, vehicle.tuning as TrackData['car']);
    const physics = new PhysicsWorld(api, tuning.gravity);
    try {
      const car = new Car(physics, tuning, { pos: point, yaw: Math.atan2(-tangent[0], -tangent[2]) });
      car.body.setLinvel({ x: tangent[0] * 14, y: 0, z: tangent[2] * 14 }, true);
      const drive = (slimeAhead: number | null) => new Autopilot(spline, autopilotSettingsFor(tuning)).drive(1 / 60, {
        x: point[0], z: point[2], speed: 14, forwardSpeed: 14, headingX: tangent[0], headingZ: tangent[2],
        slimeAhead,
        steeringTransitionSpeed: (from, to, distance) => car.steeringTransitionSpeed(from, to, distance),
        steeringInputForCurvature: curvature => car.steeringInputForCurvature(curvature),
        steeringSpeedLimit: (curvature, distance) => car.steeringSpeedLimit(curvature, distance),
      }, { index, s: spline.s[index]!, lateral: 0 });
      expect(drive(null).brake).toBe(0);
      expect(drive(0).brake).toBe(1);
    } finally { physics.dispose(); }
  });

  it.skipIf(!lombard)('lets the school bus use its calibrated steering through the Lombard hairpin', () => {
    const spline = new Spline(lombard!);
    const index = spline.indexAt(1238), point = spline.point(index), tangent = spline.tangent(index);
    const vehicle = vehicleFor('school-bus')!, tuning = vehicleTuning(vehicle, vehicle.tuning as TrackData['car']);
    const physics = new PhysicsWorld(api, tuning.gravity);
    try {
      const car = new Car(physics, tuning, { pos: point, yaw: Math.atan2(-tangent[0], -tangent[2]) });
      car.body.setLinvel({ x: tangent[0] * 4, y: tangent[1] * 4, z: tangent[2] * 4 }, true);
      const bot = new Autopilot(spline, autopilotSettingsFor(tuning));
      const input = bot.drive(1 / 60, {
        x: point[0], z: point[2], speed: car.speed, forwardSpeed: 4,
        headingX: tangent[0], headingZ: tangent[2],
        steeringInputForCurvature: curvature => car.steeringInputForCurvature(curvature),
        steeringSpeedLimit: (curvature, distance) => car.steeringSpeedLimit(curvature, distance),
      }, { index, s: spline.s[index]!, lateral: 0 });
      // The bus's own calibration for this bend, not a fixed fraction: a bigger lock needs less wheel.
      const calibrated = Math.min(1, Math.abs(car.steeringInputForCurvature(spline.curvature[index]!)));
      expect(calibrated).toBeGreaterThan(.5);
      expect(Math.abs(input.steer)).toBeGreaterThan(calibrated * .9);
      expect(Math.abs(input.steer)).toBeLessThanOrEqual(1);
      expect(input.brake).toBe(1);
    } finally { physics.dispose(); }
  });

  it.skipIf(!lombard)('The AI tiers get the school bus round the Lombard hairpins', () => {
    // The tight-bend steering reserve (`tightSteeringSpeedFraction`) only exists below a 22.9 m bend
    // radius, and the calibration above runs synth-p2p, whose tightest bend is 66.7 m -- so nothing
    // in this file reached that branch, and 457 could be retuned with every test still green. Lombard
    // has 120 samples inside it and the school bus is the longest thing that has to get round them.
    for (const difficulty of ['relaxed', 'rush'] as const) {
      const run = driveOnTheNet(lombard!, 900, vehicleFor('school-bus')!, undefined, undefined, difficulty);
      expect.soft(run.finished, `${difficulty}: stopped at ${run.sReached.toFixed(0)} of ${run.length.toFixed(0)} m`).toBe(true);
      expect.soft(run.resets, `${difficulty}: rescues`).toBe(0);
    }
  }, 120_000);

  it.skipIf(!lombard)('A school bus facing down Lombard\'s 15% climb reverses back up it', () => {
    /* */
    const spline = new Spline(lombard!);
    const at = 1010, index = spline.indexAt(at), point = spline.point(index), tangent = spline.tangent(index);
    const downhill = Math.atan2(-tangent[0], -tangent[2]) + Math.PI;
    const vehicle = vehicleFor('school-bus')!, tuning = vehicleTuning(vehicle, vehicle.tuning as TrackData['car']);
    for (const turn of [0, Math.PI / 6, -Math.PI / 6]) {
      const physics = new PhysicsWorld(api, tuning.gravity);
      try {
        physics.add('net', { trimeshes: [buildSafetyNet(spline, undefined, 10)], boxes: [] });
        physics.add('rails', { trimeshes: [testRails(spline)], boxes: [] });
        const car = new Car(physics, tuning, { pos: [point[0], point[1] + 1.2, point[2]], yaw: downhill + turn });
        for (let i = 0; i < 30; i++) { car.update(1 / 60, { throttle: 0, brake: 1, steer: 0, parkingBrake: true }); physics.world.step(); }
        for (let i = 0; i < 6 * 60; i++) { car.update(1 / 60, { throttle: 0, brake: 1, steer: 0 }); physics.world.step(); }
        const reached = projectOnSample(spline, index, car.position.x, car.position.z).s;
        expect.soft(reached - at, `turned ${(turn * 180 / Math.PI).toFixed(0)} degrees: metres reversed uphill in 6 s`).toBeGreaterThan(5);
      } finally { physics.dispose(); }
    }
  });

  it('moffett-field forward: the AI gets round the base-road corners without a rescue', () => {
    /* */
    const moffett = loadBuilt('moffett-field');
    expect(moffett, 'build moffett-field: python3 tools/assets.py ensure').not.toBeNull();
    for (const [id, seconds] of [['sports-car', 180], ['school-bus', 355]] as const) {
      const run = driveOnTheNet(moffett!, 600, vehicleFor(id)!, undefined, undefined, 'rush');
      expect.soft(run.finished, `${id}: stopped at ${run.sReached.toFixed(0)} of ${run.length.toFixed(0)} m`).toBe(true);
      expect.soft(run.resets, `${id}: rescues`).toBe(0);
      expect.soft(run.time, `${id}: seconds`).toBeLessThan(seconds);
    }
  }, 120_000);

  it.skipIf(!loop)('drives the synthetic loop to the chequered flag', () => {
    const run = driveOnTheNet(loop!, 600);
    expect(run.finished, `stopped at ${run.sReached.toFixed(0)} of ${run.length.toFixed(0)} m, `
      + `lap ${run.lap}, ${run.resets} resets`).toBe(true);
    expect(run.lap).toBe(loop!.laps);
    expect(run.airbornePct).toBeLessThan(10);
    expect(run.resets, 'the version-gate loop must not need recovery').toBe(0);
  }, 120_000);

  it.skipIf(!stops)('stops at every delivery point on the multistop track', () => {
    const run = driveOnTheNet(stops!, 600);
    expect(run.finished, `stopped at ${run.sReached.toFixed(0)} of ${run.length.toFixed(0)} m`).toBe(true);
  }, 120_000);

  it.skipIf(!sprint)('drives the synthetic sprint end to end', () => {
    const run = driveOnTheNet(sprint!, 400);
    expect(run.finished).toBe(true);
    expect(run.time).toBeGreaterThan(10);
  }, 120_000);

  it.skipIf(!golden)('drives the whole of Golden Gate without getting stuck', () => {
    const run = driveOnTheNet(golden!, 1200);
    expect(run.finished, `stopped at ${run.sReached.toFixed(0)} of ${run.length.toFixed(0)} m`).toBe(true);
    expect(run.time).toBeGreaterThan(60);
    expect(run.time).toBeLessThan(600);
    expect(run.resets).toBeLessThan(25);
  }, 300_000);
});

describe('disturbance recovery', () => {
  const straight = loadBuilt('synth-p2p');

  it.skipIf(!straight)('coasts and steers a disturbed car back from the road edge, including calibrated steering advice', () => {
    const spline = new Spline(straight!);
    const index = spline.indexAt(100);
    const heading = spline.tangent(index);
    const point = spline.point(index);
    const right = spline.right(index);
    const view = (lateral: number) => ({
      x: point[0] + right[0] * lateral, z: point[2] + right[2] * lateral,
      speed: 40, forwardSpeed: 40,
      headingX: heading[0], headingZ: heading[2],
    });
    const centre = new Autopilot(spline).drive(1 / 60, view(0), { s: 100, lateral: 0, index });
    const halfWidth = spline.halfWidth[index]!;
    const edge = new Autopilot(spline).drive(1 / 60, { ...view(halfWidth * 0.8), steeringSpeedLimit: () => 10 },
      { s: 100, lateral: halfWidth * 0.8, index });
    expect(centre.brake).toBe(0);
    expect(edge.brake).toBe(0);
    const recovering = new Autopilot(spline).drive(1 / 60,
      { ...view(0), gripping: false, steeringSpeedLimit: () => 10 }, { s: 100, lateral: 0, index });
    expect(recovering.brake).toBe(0);
    expect(recovering.throttle).toBe(0);
    const manoeuvring = new Autopilot(spline).drive(1 / 60,
      { ...view(halfWidth * .8), speed: 8, forwardSpeed: 8, gripping: false, steeringSpeedLimit: () => 5 },
      { s: 100, lateral: halfWidth * .8, index });
    expect(manoeuvring.brake).toBe(1);
    expect(edge.throttle).toBe(0);
    expect(edge.steer, 'positive road offset must steer left toward the centre').toBeLessThan(0);
  });
});

/**
 * Pulling up at a delivery point, as arithmetic on one call.
 *
 * The brake pedal is also reverse below walking pace, so "brake until stopped" walks straight
 * through the standstill and comes out the other side: the car creeps backwards out of the gate,
 * which never counts as arriving, drives back in, and does it again until the clock runs out. It
 * cost two runs in three on the synthetic stops track and it is invisible in any test that only
 * asks whether the driver finished, because sometimes it does.
 */
describe('the driver pulling up at a delivery point', () => {
  const straightTrack = (): TrackData => {
    const points: number[][] = [];
    const n = 201;
    for (let i = 0; i < n; i++) points.push([0, 0, -i * 2]);
    return {
      id: 't', version: 1, editions: ['full'], category: 'race', mode: 'multistop', laps: 1,
      name: { zh: '', en: '' }, blurb: { zh: '', en: '' },
      origin: { lat: 0, lon: 0 }, timeOfDay: 'day', car: 'sedan',
      spline: { points, halfWidth: new Array(n).fill(6), curvature: new Array(n).fill(0),
                closed: false, length: (n - 1) * 2 },
      start: { pos: [0, 0, 0], yaw: 0 }, checkpoints: [], tiles: [], attribution: [],
    } as unknown as TrackData;
  };
  const spline = () => new Spline(straightTrack());
  const at = { s: 100, lateral: 0, index: 50 };
  const view = (forwardSpeed: number) => ({
    x: 0, z: -100, speed: Math.abs(forwardSpeed), forwardSpeed, headingX: 0, headingZ: -1,
  });

  it('backs into an overshot delivery with real tyres and clears the original stop gate', () => {
    const track = straightTrack();
    track.start.pos = [1, .55, -134];
    track.checkpoints = [
      { s: 0, pos: [0, 0, 0], dir: [0, 0, -1], halfWidth: 6 },
      { s: 100, pos: [0, 0, -100], dir: [0, 0, -1], halfWidth: 6, stop: true },
      { s: 200, pos: [0, 0, -200], dir: [0, 0, -1], halfWidth: 6 },
    ];
    const result = driveOnTheNet(track, 120);
    expect(result.finished).toBe(true);
    expect(result.resets).toBe(0);
  });

  it('lets go of the brake once the car is slow enough to count as stopped', () => {
    const bot = new Autopilot(spline());
    expect(bot.drive(1 / 60, view(4), at, 3).brake, 'still rolling in: brake').toBe(1);
    expect(bot.drive(1 / 60, view(0.3), at, 3).brake, 'stopped: off the brake').toBe(0);
  });

  it('never brakes a car that is already going backwards', () => {
    const bot = new Autopilot(spline());
    // speed alone cannot tell this from creeping forwards, which is the whole bug
    expect(bot.drive(1 / 60, view(-1.5), at, 3).brake).toBe(0);
    expect(bot.drive(1 / 60, view(-1.5), at, 3).throttle).toBe(0);
  });
});


/* */
const AI_PACE_ESTIMATED: string[] = [];

describe('AI pace table', () => {
  const directed = (id: string, direction: 'forward' | 'reverse') => directedTrack(loadBuilt(id)!, direction);
  const measure = (id: string, direction: 'forward' | 'reverse', vehicle: typeof VEHICLES[number]) => {
    const run = driveOnTheNet(directed(id, direction), 3600, vehicle, undefined, undefined, AI_PACE_DIFFICULTY);
    return run.finished ? Math.round(run.time * 10) / 10 : null;
  };
  const ideal = (id: string, direction: 'forward' | 'reverse', vehicle: typeof VEHICLES[number]) => {
    const track = directed(id, direction);
    return new IdealRace(new Spline(track), track, vehicle).seconds;
  };

  it('AI pace covers every built route, direction and vehicle and still matches the driver', () => {
    if (process.env.SR_UPDATE_AI_PACE) {
      const seconds: Record<string, Record<string, number>> = {};
      const estimated: string[] = [];
      for (const id of [...BUILT].sort()) {
        const measured = Object.fromEntries((['forward', 'reverse'] as const).map(direction =>
          [direction, Object.fromEntries(VEHICLES.map(vehicle => [vehicle.id, measure(id, direction, vehicle)]))]));
        for (const direction of ['forward', 'reverse'] as const) {
          const other = direction === 'forward' ? 'reverse' : 'forward';
          seconds[raceKey(id, direction)] = Object.fromEntries<number>(VEHICLES.map(vehicle => {
            const own = measured[direction]![vehicle.id] ?? null;
            if (own !== null) return [vehicle.id, own] as const;
            const opposite = measured[other]![vehicle.id];
            expect(opposite, `${id}: ${vehicle.id} finishes neither direction`).not.toBeNull();
            estimated.push(`${raceKey(id, direction)}/${vehicle.id}`);
            return [vehicle.id, Math.round(opposite! * ideal(id, direction, vehicle) / ideal(id, other, vehicle) * 10) / 10] as const;
          }));
        }
      }
      writeFileSync(resolve('src/track/aiPace.json'), JSON.stringify({ seconds, estimated: estimated.sort() }, null, 1) + '\n');
      return;
    }
    for (const id of BUILT) for (const direction of ['forward', 'reverse'] as const) {
      for (const vehicle of VEHICLES) expect(AI_PACE[raceKey(id, direction)]?.[vehicle.id], `${id}/${direction}/${vehicle.id}`).toBeGreaterThan(0);
    }
    expect(AI_PACE_ESTIMATES).toEqual(AI_PACE_ESTIMATED);
    // One short route, every vehicle: a handling or driver change that moves the AI shows up here
    // and means the table must be measured again.
    for (const vehicle of VEHICLES) {
      expect(Math.abs((measure('lombard', 'forward', vehicle) ?? Infinity) / AI_PACE.lombard![vehicle.id]! - 1),
        `lombard/${vehicle.id}: regenerate with SR_UPDATE_AI_PACE=1`).toBeLessThan(.02);
    }
  }, 1_800_000);
});
