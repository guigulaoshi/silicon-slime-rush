import { beforeAll, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GRID_LANE_WIDTH, PARKING_FIRST_ROW_DISTANCE, Racer, racerSpawns } from '../src/app/Racer';
import { AI_PACE } from '../src/track/aiPace';
import { raceRoster } from '../src/app/roster';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { Progress, projectOnSample } from '../src/track/Progress';
import { Spline } from '../src/track/Spline';
import type { TrackData } from '../src/track/types';
import { VEHICLES, vehicleFor } from '../src/vehicles/catalogue';
import type { VehicleModel } from '../src/vehicles/VehicleModel';
import { CATALOGUE } from '../src/app/tracks';

let api: Awaited<ReturnType<typeof initPhysics>>;
beforeAll(async () => { api = await initPhysics(); });
const loadTrack = (id: string): TrackData => JSON.parse(readFileSync(`public/tracks/${id}/track.json`, 'utf8'));
const model = () => ({ group: new THREE.Group(), update: vi.fn(), setBrakeLights: vi.fn(),
  dispose: vi.fn() }) as unknown as VehicleModel;

it('a finisher follows the curved continuation to its berth instead of cutting across scenery', () => {
  const track = loadTrack('synth-p2p');
  track.spline = {points: [[-60,0,0],[-30,0,0],[0,0,0]], halfWidth:[6,6,6], closed:false, length:60};
  const points: [number,number,number][] = [];
  for(let i=0;i<=50;i++){const a=i/50*Math.PI/2;points.push([50*Math.sin(a),0,50*(1-Math.cos(a))]);}
  for(let z=52;z<=200;z+=2)points.push([50,0,z]);
  const s=[0];for(let i=1;i<points.length;i++)s.push(s[i-1]!+Math.hypot(points[i]![0]-points[i-1]![0],points[i]![2]-points[i-1]![2]));
  const road={points,s,halfWidth:points.map(()=>6),closed:false,length:s.at(-1)!};
  track.endRoads={start:road,finish:road};
  const guide=new Spline({...track,spline:road}), progress=new Progress(guide);
  const physics=new PhysicsWorld(api), scene=new THREE.Scene();
  physics.add('floor',{trimeshes:[],boxes:[{center:[0,-.5,0],half:[500,.5,500],yaw:0,role:'ground'}]});
  const racer=new Racer('curved-parking',vehicleFor('school-bus')!,model(),null,physics,scene,
    track,new Spline(track),{pos:[-3,1,0],yaw:-Math.PI/2},'ai');
  racer.race.state='finished';racer.beginParking(6);
  let maximumLateral=0;progress.reacquire(-3,0);
  try{
    for(let i=0;i<60*60&&!racer.parkingState!.stopped;i++){
      physics.step(1/60,dt=>{
        const own=racer.trafficBodies(racer.parkingPath);
        racer.car.update(dt,racer.parkingInput({own,bodies:own},dt));
      });
      const p=racer.car.position;maximumLateral=Math.max(maximumLateral,Math.abs(progress.update(p.x,p.z).lateral));
    }
    expect(racer.parkingState!.stopped,JSON.stringify(racer.parkingState)).toBe(true);
    expect(maximumLateral).toBeLessThan(6);
    const body=racer.trafficBodies(racer.parkingPath)[0]!;
    expect(body.s).toBeCloseTo(progress.value.s, 1);
    expect(body.halfLength).toBeGreaterThan(body.halfWidth*2);
  }finally{racer.dispose();physics.dispose();}
});

it('all formal two-car combinations start with disjoint chassis and trailer volumes', () => {
  let pairs = 0;
  for (const route of CATALOGUE) {
    const track = loadTrack(route.id), spline = new Spline(track);
    for (const first of VEHICLES) for (const second of VEHICLES) {
      const physics = new PhysicsWorld(api), scene = new THREE.Scene();
      const vehicles = [first, second];
      const spawns = racerSpawns(track, spline, vehicles);
      expect(spawns[0]).toEqual(track.start);
      const racers = vehicles.map((vehicle, i) => new Racer(String(i), vehicle, model(),
        vehicle.trailer ? model() : null, physics, scene, track, spline, spawns[i]!));
      physics.world.propagateModifiedBodyPositionsToColliders();
      for (const a of [racers[0]!.car, racers[0]!.trailer?.car].filter(Boolean)) {
        for (const b of [racers[1]!.car, racers[1]!.trailer?.car].filter(Boolean)) {
          const ca = a!.collider, cb = b!.collider;
          expect(ca.shape.intersectsShape(ca.translation(), ca.rotation(), cb.shape, cb.translation(), cb.rotation()), `${route.id} ${first.id}/${second.id}: ${JSON.stringify(spawns)}; ${JSON.stringify([ca.translation(),cb.translation()])}`).toBe(false);
        }
      }
      racers.forEach(racer => racer.dispose()); physics.dispose(); pairs++;
    }
  }
  expect(pairs).toBe(CATALOGUE.length * VEHICLES.length ** 2);
});

it('two moving rigs reset and dispose independently in one physical world', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  physics.add('floor', { trimeshes: [], boxes: [{ center: [0, -.5, 0], half: [5000, .5, 5000], yaw: 0 }] });
  const baseline = physics.world.bodies.len();
  const vehicle = vehicleFor('pickup-travel-trailer')!;
  const racers = [0, 1].map(i => new Racer(String(i), vehicle, model(), model(), physics, scene,
    track, spline, { pos: [i * 12, 1, 0], yaw: 0 }));
  for (let i = 0; i < 120; i++) physics.step(1 / 60, h => {
    for (const racer of racers) { racer.car.update(h, { throttle: .5, brake: 0, steer: 0 }); racer.trailer!.update(h); }
  }, 5, () => racers.forEach(racer => racer.advancePose()));
  expect(racers.every(racer => racer.car.position.z < -1)).toBe(true);
  expect(physics.world.bodies.len()).toBe(baseline + 4);
  const other = racers[1]!.car.position.clone();
  const otherRace = racers[1]!.race;
  for (let i = 0; i < 4; i++) {
    racers[0]!.reset(); racers.forEach(racer => racer.render(.5, 1 / 60));
    expect(racers[0]!.trailer!.hitchGap).toBeLessThan(.001);
    expect(racers[1]!.car.position.distanceTo(other)).toBe(0);
    expect(racers[1]!.race).toBe(otherRace);
    expect(physics.world.impulseJoints.len()).toBe(2);
  }
  racers[0]!.dispose(); racers[0]!.dispose();
  expect(physics.world.bodies.len()).toBe(baseline + 2);
  expect(physics.world.impulseJoints.len()).toBe(1);
  expect(scene.children).toHaveLength(2);
  racers[1]!.dispose();
  expect(physics.world.bodies.len()).toBe(baseline);
  expect(physics.world.impulseJoints.len()).toBe(0);
  expect(scene.children).toHaveLength(0);
  physics.dispose();
});


it('an occupied rescue spot looks behind first and never puts the car past the next gate', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  const vehicle = vehicleFor('micro-hatch')!;
  const racers = [0, 1].map(i => new Racer(String(i), vehicle, model(), model(), physics, scene,
    track, spline, racerSpawns(track, spline, [vehicle, vehicle])[i]!));
  const [other, me] = racers as [Racer, Racer];
  me.race.start();
  const gateS = track.checkpoints[me.race.nextCheckpoint]!.s;
  const at = (s: number) => { const i = spline.indexAt(s), p = spline.point(i), t = spline.tangent(i);
    return { pos: [p[0], p[1] + .8, p[2]] as TrackData['start']['pos'], yaw: Math.atan2(-t[0], -t[2]) }; };
  const target = at(gateS - 10);
  other.car.reset(target.pos, target.yaw);
  const spot = me.clearResetSpot(target, racers)!;
  expect(spot).not.toBeNull();
  const s = new Progress(spline).reacquire(spot.pos[0], spot.pos[2]).s;
  expect(s, 'behind the gate, not past it').toBeLessThan(gateS);
  expect(s, 'behind the occupied spot rather than ahead of it').toBeLessThan(gateS - 10);
  racers.forEach(racer => racer.dispose()); physics.dispose();
});

it('an occupied reset chooses clear space for both tow and trailer without moving the other driver', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  const vehicle = vehicleFor('pickup-travel-trailer')!;
  const racers = [0, 1].map(i => new Racer(String(i), vehicle, model(), model(), physics, scene,
    track, spline, racerSpawns(track, spline, [vehicle, vehicle])[i]!));
  const spot = racers[1]!.clearResetSpot(track.start, racers)!;
  expect(spot).not.toBeNull();
  expect(spot.pos).not.toEqual(track.start.pos);
  const original = racers[0]!.car.position.clone();
  racers[1]!.car.reset(spot.pos, spot.yaw); racers[1]!.trailer!.syncReset();
  for (let i = 0; i < 30; i++) physics.step(1 / 60);
  expect(Math.hypot(racers[0]!.car.position.x - original.x, racers[0]!.car.position.z - original.z)).toBeLessThan(.01);
  expect(racers[0]!.clearResetSpot(track.start, [racers[0]!])).toEqual(track.start);
  racers.forEach(racer => racer.dispose()); physics.dispose();
});


it('holds an entire rig while road data is missing and releases it when ready', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  const vehicle = vehicleFor('pickup-travel-trailer')!;
  const racer = new Racer('0', vehicle, model(), model(), physics, scene, track, spline, { pos: [0, 2, 0], yaw: 0 });
  racer.car.body.setLinvel({ x: 4, y: -3, z: 12 }, true);
  racer.setRoadReady(false, true);
  const positions = [racer.car.position.clone(), racer.trailer!.car.position.clone()];
  for (let i = 0; i < 60; i++) physics.step(1 / 60);
  expect(racer.car.position.distanceTo(positions[0]!)).toBeLessThan(.001);
  expect(racer.trailer!.car.position.distanceTo(positions[1]!)).toBeLessThan(.001);
  racer.setRoadReady(true, true);
  physics.step(1 / 60);
  expect(racer.car.position.y).toBeLessThan(positions[0]!.y);
  racer.dispose(); physics.dispose();
});

it('keeps both distant rigs near the shared origin without breaking their joints', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api, 0), scene = new THREE.Scene();
  const vehicle = vehicleFor('pickup-travel-trailer')!;
  const racers = [-32000, 32000].map((x, i) => new Racer(String(i), vehicle, model(), model(),
    physics, scene, track, spline, { pos: [x, 1, 0], yaw: 0 }));
  for (const racer of racers) for (const car of [racer.car, racer.trailer!.car]) {
    car.body.setLinearDamping(0);
    car.body.setLinvel({ x: 0, y: 0, z: -13.7 }, true);
  }
  for (let i = 0; i < 180; i++) physics.step(1 / 60);
  for (const racer of racers) {
    expect(Math.abs(racer.car.body.translation().x)).toBeLessThan(33000);
    expect(Math.abs(racer.car.position.z + 41.1)).toBeLessThan(.25);
    expect(racer.trailer!.hitchGap).toBeLessThan(.08);
    racer.dispose();
  }
  physics.dispose();
});

it('parking brake stops a completed trailer combination without driving it backwards', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  physics.add('floor', { trimeshes: [], boxes: [{ center: [0, -.5, 0], half: [5000, .5, 5000], yaw: 0 }] });
  const vehicle = vehicleFor('pickup-travel-trailer')!;
  const racer = new Racer('parked', vehicle, model(), model(), physics, scene, track, spline,
    { pos: [0, 1.3, 0], yaw: 0 });
  const step = (throttle: number, park: boolean) => physics.step(1 / 60, h => {
    racer.car.update(h, { throttle, brake: park ? 1 : 0, steer: 0, parkingBrake: park });
    racer.trailer!.update(h);
  });
  for (let i = 0; i < 300; i++) step(1, false);
  expect(racer.car.speed).toBeGreaterThan(5);
  for (let i = 0; i < 600; i++) step(0, true);
  expect(racer.car.speed).toBeLessThan(.1);
  const positions = [racer.car.position, racer.trailer!.car.position];
  for (let i = 0; i < 600; i++) step(0, true);
  expect(racer.car.position.distanceTo(positions[0]!)).toBeLessThan(.15);
  expect(racer.trailer!.car.position.distanceTo(positions[1]!)).toBeLessThan(.15);
  expect(racer.trailer!.hitchGap).toBeLessThan(.1);
  racer.dispose(); physics.dispose();
});


it('grids AI fastest first ahead of the players, alternating sides of the centre line', () => {
  const track = loadTrack('goldengate'), spline = new Spline(track);
  const humans = [vehicleFor('micro-hatch')!, vehicleFor('jeep')!];
  const roster = raceRoster(humans, true);
  const seconds = AI_PACE.goldengate!;
  const spawns = racerSpawns(track, spline, roster.map(entry => entry.vehicle), roster.map(entry => entry.role),
    vehicle => seconds[vehicle.id]);
  const along = (pos: readonly number[]) => projectOnSample(spline, spline.indexAt(0), pos[0]!, pos[2]!).s;
  const byPosition = roster.map((entry, i) => ({ entry, s: along(spawns[i]!.pos), pos: spawns[i]!.pos }))
    .sort((a, b) => a.s - b.s);
  expect(spawns[0]).toEqual(track.start);
  expect(byPosition.slice(0, 2).map(item => item.entry.role)).toEqual(['human', 'human']);
  const ai = byPosition.slice(2).map(item => seconds[item.entry.vehicle.id]!);
  expect(ai, 'the slowest AI starts right in front of the players, the fastest at the head').toEqual([...ai].sort((a, b) => b - a));
  for (let i = 1; i < byPosition.length; i++) {
    const a = byPosition[i - 1]!.pos, b = byPosition[i]!.pos;
    const at = spline.indexAt(byPosition[i]!.s), right = spline.right(at);
    const sideways = Math.abs((b[0]! - a[0]!) * right[0] + (b[2]! - a[2]!) * right[2]);
    expect(sideways, `${byPosition[i]!.entry.id} is not in the lane of the car behind it`).toBeGreaterThan(GRID_LANE_WIDTH * .8);
  }
  for (const item of byPosition.slice(1)) {
    const at = spline.indexAt(item.s), centre = spline.point(at), right = spline.right(at);
    const lateral = (item.pos[0]! - centre[0]) * right[0] + (item.pos[2]! - centre[2]) * right[2];
    expect(Math.abs(lateral), `${item.entry.id} straddles the centre line`).toBeGreaterThan(GRID_LANE_WIDTH / 2);
  }
  for (const [i, entry] of roster.entries()) {
    const at = spline.indexAt(along(spawns[i]!.pos)), centre = spline.point(at), right = spline.right(at);
    const lateral = Math.abs((spawns[i]!.pos[0] - centre[0]) * right[0] + (spawns[i]!.pos[2] - centre[2]) * right[2]);
    expect(lateral + entry.vehicle.size[0]! / 2, `${entry.id} fits the road`).toBeLessThanOrEqual(spline.halfWidth[at]! + .05);
  }
});

it('every full AI roster starts without overlapping complete combinations on every formal route', () => {
  let cases = 0;
  for (const route of CATALOGUE) {
    const track = loadTrack(route.id), spline = new Spline(track);
    for (const first of VEHICLES) for (const second of [undefined, ...VEHICLES]) {
      const roster = raceRoster(second ? [first, second] : [first], true);
      const physics = new PhysicsWorld(api), scene = new THREE.Scene();
      const spawns = racerSpawns(track, spline, roster.map(entry => entry.vehicle), roster.map(entry => entry.role));
      const racers = roster.map((entry, i) => new Racer(entry.id, entry.vehicle, model(),
        entry.vehicle.trailer ? model() : null, physics, scene, track, spline, spawns[i]!, entry.role));
      physics.world.propagateModifiedBodyPositionsToColliders();
      for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) {
        for (const a of [racers[i]!.car, racers[i]!.trailer?.car].filter(Boolean))
          for (const b of [racers[j]!.car, racers[j]!.trailer?.car].filter(Boolean)) {
            const ca = a!.collider, cb = b!.collider;
            expect(ca.shape.intersectsShape(ca.translation(), ca.rotation(), cb.shape, cb.translation(), cb.rotation()),
              route.id + ' ' + first.id + '/' + second?.id + ' ' + i + '/' + j).toBe(false);
          }
      }
      racers.forEach(racer => racer.dispose());
      expect(physics.world.impulseJoints.len()).toBe(0);
      expect(physics.world.bodies.len()).toBe(0);
      physics.dispose(); cases++;
    }
  }
  expect(cases).toBe(CATALOGUE.length * VEHICLES.length * (VEHICLES.length + 1));
}, 15_000);


it('traffic snapshots include the full sideways chassis and trailer footprint', () => {
  const track = loadTrack('synth-p2p');
  track.spline.points = Array.from({ length: 251 }, (_, i) => [0, 0, -i * 2]);
  track.spline.halfWidth = Array(251).fill(6); track.spline.curvature = Array(251).fill(0); delete track.spline.s;
  track.spline.length = 500;
  const spline = new Spline(track), physics = new PhysicsWorld(api), scene = new THREE.Scene();
  const vehicle = vehicleFor('pickup-travel-trailer')!;
  const racer = new Racer('ai-rig', vehicle, model(), model(), physics, scene, track, spline,
    { pos: [0, 1, -100], yaw: Math.PI / 2 }, 'ai');
  const bodies = racer.trafficBodies();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]!.s).toBeCloseTo(100, 5);
  expect(bodies[0]!.halfWidth).toBeCloseTo(racer.car.tuning.chassisHalf[2], 5);
  expect(bodies[0]!.halfLength).toBeCloseTo(racer.car.tuning.chassisHalf[0], 5);
  expect(Math.abs(bodies[1]!.lateral - bodies[0]!.lateral)).toBeGreaterThan(3);
  expect(bodies.every(body => body.driver === 'ai-rig')).toBe(true);
  racer.dispose(); physics.dispose();
});

it('difficulty changes only AI intentions and gives human and AI racers identical vehicle physics', async () => {
  const { AI_DIFFICULTIES } = await import('../src/bot/difficulty');
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  for (const vehicle of VEHICLES) {
    const human = new Racer('human', vehicle, model(), vehicle.trailer ? model() : null,
      physics, scene, track, spline, track.start, 'human', 'rush');
    for (const difficulty of AI_DIFFICULTIES) {
      const ai = new Racer('ai', vehicle, model(), vehicle.trailer ? model() : null,
        physics, scene, track, spline, track.start, 'ai', difficulty);
      expect(ai.car.tuning).toEqual(human.car.tuning);
      expect(ai.trailer?.car.tuning).toEqual(human.trailer?.car.tuning);
      ai.dispose();
    }
    const standard = new Racer('human-standard', vehicle, model(), vehicle.trailer ? model() : null,
      physics, scene, track, spline, track.start, 'human');
    expect(human.bot.settings).toEqual(standard.bot.settings);
    human.dispose(); standard.dispose();
  }
  physics.dispose();
});

it('completed AI rigs take distinct post-finish spaces and remain visible solid traffic', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  const vehicle = vehicleFor('pickup-travel-trailer')!;
  const makeModel = () => ({ group: new THREE.Group(), update: vi.fn(), dispose: vi.fn() }) as unknown as VehicleModel;
  const human = new Racer('human', vehicle, makeModel(), makeModel(), physics, scene, track, spline, track.start);
  const ai = [5, 4].map((slot, index) => {
    const racer = new Racer(`ai-${index}`, vehicle, makeModel(), makeModel(), physics, scene,
      track, spline, track.start, 'ai');
    racer.race.state = 'finished'; racer.race.time = 42 + index; racer.beginParking(slot);
    return racer;
  });
  const spots = ai.map(racer => racer.parkingState!);
  const end = spline.count - 1;
  expect(Math.abs(projectOnSample(spline, end, spots[0]!.target[0], spots[0]!.target[2]).s
    - projectOnSample(spline, end, spots[1]!.target[0], spots[1]!.target[2]).s)).toBeGreaterThan(10);
  expect(Math.hypot(spots[0]!.target[0] - spots[1]!.target[0],
    spots[0]!.target[2] - spots[1]!.target[2])).toBeGreaterThan(3);
  for (const racer of ai) {
    const spot = racer.parkingState!;
    const tangent = spline.tangent(end);
    racer.car.reset([spot.target[0], spot.target[1] + 1, spot.target[2]],
      Math.atan2(-tangent[0], -tangent[2]));
    racer.trailer!.syncReset();
    expect(racer.parkingInput(undefined, 1 / 60)).toMatchObject({ parkingBrake: true, brake: 1 });
    expect(racer.parkingState!.stopped).toBe(true);
    expect(racer.car.body.isEnabled()).toBe(true);
    expect(racer.trailer!.car.body.isEnabled()).toBe(true);
    expect(racer.trafficBodies()).toHaveLength(2);
    expect(racer.mesh.visible).toBe(true); expect(racer.trailerModel!.group.visible).toBe(true);
  }
  const occupied = { pos: spots[0]!.target, yaw: track.start.yaw };
  expect(human.clearResetSpot(occupied, [human, ...ai])).not.toEqual(occupied);
  const recovering = ai[0]!;
  recovering.reset(); recovering.race.state = 'finished'; recovering.beginParking(5);
  const recoverySpot = recovering.parkingState!;
  const tangent = spline.tangent(spline.count - 1);
  recovering.car.reset([recoverySpot.target[0] + tangent[0] * 20, recoverySpot.target[1] + 1,
    recoverySpot.target[2] + tangent[2] * 20], Math.atan2(-tangent[0], -tangent[2]));
  recovering.trailer!.syncReset();
  recovering.race.reacquire(recovering.car.position.x, recovering.car.position.z);
  const recoveryInput = recovering.parkingInput(undefined, 1 / 60);
  expect(recoveryInput.brake).toBe(1); expect(recoveryInput.parkingBrake).not.toBe(true);
  expect(recovering.parkingState!.stopped).toBe(false);

  const queued = ai[1]!;
  queued.reset(); queued.race.state = 'finished'; queued.beginParking(4);
  const queueSpot = queued.parkingState!;
  queued.car.reset([queueSpot.target[0] - tangent[0] * 10, queueSpot.target[1] + 1,
    queueSpot.target[2] - tangent[2] * 10], Math.atan2(-tangent[0], -tangent[2]));
  queued.trailer!.syncReset();
  queued.race.reacquire(queued.car.position.x, queued.car.position.z);
  const own = queued.trafficBodies();
  const blocker = { ...own[0]!, driver: 'parked-human', s: own[0]!.s + 6, speed: 0 };
  expect(queued.parkingInput({ own, bodies: [...own, blocker] }, 1 / 60))
    .toMatchObject({ throttle: 0, brake: 1, parkingBrake: true });
  // A minute queueing behind a parker that is still manoeuvring is waiting, not stalling...
  const manoeuvring = { ...blocker, speed: 1.5 };
  for (let t = 0; t < 60; t += .5) queued.parkingInput({ own, bodies: [...own, manoeuvring] }, .5);
  expect(queued.parkingRescue([queued])).toBeNull();
  // ...but sitting behind one that is parked for good is the original deadlock, and gets rescued.
  for (let t = 0; t < 30; t += .5) queued.parkingInput({ own, bodies: [...own, blocker] }, .5);
  expect(queued.parkingRescue([queued])).not.toBeNull();
  expect(queued.parkingState!.stopped).toBe(false);
  ai[0]!.reset(); expect(ai[0]!.parkingState).toBeNull();
  expect(ai[0]!.race.time).toBe(0);
  human.dispose(); ai.forEach(racer => racer.dispose());
  expect(physics.world.impulseJoints.len()).toBe(0); physics.dispose();
});

// In a two-player race the player home first drove no further than the line and stood there,
// solid, in the partner's and the AI's way. A player's car now takes a berth past the line like the AI's.
it('a finished player car drives on to its berth instead of holding the line', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  physics.add('parking-ground', { trimeshes: [], boxes: [
    { center: [0, -.5, 0], half: [500, .5, 500], yaw: 0, role: 'ground' },
  ] });
  const end = spline.count - 1, tangent = spline.tangent(end), line = spline.point(end);
  const racer = new Racer('player-1', vehicleFor('micro-hatch')!, model(), null, physics, scene,
    track, spline, { pos: [line[0], 1, line[2]], yaw: Math.atan2(-tangent[0], -tangent[2]) });
  expect(racer.role).toBe('human');
  racer.race.state = 'finished'; racer.beginParking(0);
  try {
    expect(racer.parkingState).not.toBeNull();
    expect(racer.parkingInput(undefined, 1 / 60).parkingBrake).not.toBe(true);
    for (let i = 0; i < 60 * 60 && !racer.parkingState!.stopped; i++) {
      physics.step(1 / 60, dt => racer.car.update(dt, racer.parkingInput(undefined, dt)));
    }
    expect(racer.parkingState!.stopped, JSON.stringify(racer.parkingState)).toBe(true);
    expect(racer.parkingState!.rescued).toBe(false);
    expect(Math.hypot(racer.car.position.x - line[0], racer.car.position.z - line[2])).toBeGreaterThan(PARKING_FIRST_ROW_DISTANCE - 6);
  } finally { racer.dispose(); physics.dispose(); }
});

it.each(['approach', 'side', 'captured'] as const)('physically parks a school bus from a %s offset', start => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  physics.add('parking-ground', { trimeshes: [], boxes: [
    { center: [0, -.5, 0], half: [500, .5, 500], yaw: 0, role: 'ground' },
  ] });
  const vehicle = vehicleFor('school-bus')!;
  const racer = new Racer('parking-bus', vehicle, model(), null, physics, scene,
    track, spline, track.start, 'ai');
  racer.race.state = 'finished'; racer.beginParking(0);
  const spot = racer.parkingState!.target, tangent = spline.tangent(spline.count - 1);
  const yaw = Math.atan2(-tangent[0], -tangent[2]);
  racer.car.reset(start === 'approach' ? [-3.94, 1, -149.95]
    : start === 'captured' ? [18.6418, 1, -175.4312]
      : [spot[0] + tangent[2] * 8, 1, spot[2] - tangent[0] * 8],
    start === 'captured' ? 2 * Math.atan2(-.52549, .8508) : yaw);
  racer.race.reacquire(racer.car.position.x, racer.car.position.z);
  try {
    for (let i = 0; i < 60 * 60 && !racer.parkingState!.stopped; i++) {
      physics.step(1 / 60, dt => racer.car.update(dt, racer.parkingInput(undefined, dt)));
    }
    expect(racer.parkingState!.stopped, JSON.stringify(racer.parkingState)).toBe(true);
    expect(racer.parkingState!.distance).toBeLessThan(3);
  } finally { racer.dispose(); physics.dispose(); }
});

// On lombard finishers that needed to back up to line into a berth held the brake behind a
// car forever, and a few wedged on the run-out; nothing ever got them out.
it('turns forward instead of holding the brake when backing out would hit the car behind', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  const bus = new Racer('bus', vehicleFor('school-bus')!, model(), null, physics, scene, track, spline, track.start, 'ai');
  try {
    bus.race.state = 'finished'; bus.beginParking(0);
    const spot = bus.parkingState!.target, tangent = spline.tangent(spline.count - 1);
    // Level with the berth, a few metres to the side: only a reverse or a forward loop reaches it.
    bus.car.reset([spot[0] + tangent[2] * 5, spot[1] + 1, spot[2] - tangent[0] * 5], Math.atan2(-tangent[0], -tangent[2]));
    bus.race.reacquire(bus.car.position.x, bus.car.position.z);
    const own = bus.trafficBodies(bus.parkingPath);
    const behind = { ...own[0]!, driver: 'parked-behind', s: own[0]!.s - own[0]!.halfLength * 2 - 1, speed: 0 };
    const free = bus.parkingInput({ own, bodies: own }, 1 / 60);
    expect(free.throttle).toBe(0);
    // A moment's block is waited out, as before...
    expect(bus.parkingInput({ own, bodies: [...own, behind] }, 1)).toMatchObject({ throttle: 0, parkingBrake: true });
    // ...a reverse blocked for seconds turns forward instead of holding the brake forever.
    for (let t = 0; t < 3; t++) bus.parkingInput({ own, bodies: [...own, behind] }, 1);
    const blocked = bus.parkingInput({ own, bodies: [...own, behind] }, 1);
    expect(blocked.parkingBrake).not.toBe(true);
    expect(blocked.throttle).toBe(1);
  } finally { bus.dispose(); physics.dispose(); }
});

// On the hard tier a trailer rig swung past its berth beside a parked jeep. It needed to back
// up, but a parked car ahead made it "follow" with no speed left, and that early brake came before the
// reverse was even considered, so it waited 30 s for a car that never moves and was dropped in by the rescue.
it('backs up past a parked car ahead instead of queueing behind it when the berth is behind', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  const rig = new Racer('rig', vehicleFor('pickup-travel-trailer')!, model(), model(), physics, scene, track, spline, track.start, 'ai');
  try {
    rig.race.state = 'finished'; rig.beginParking(1);
    const spot = rig.parkingState!.target, tangent = spline.tangent(spline.count - 1);
    // Overshot: a few metres past the berth, on its line, facing on.
    rig.car.reset([spot[0] + tangent[0] * 6, spot[1] + 1, spot[2] + tangent[2] * 6], Math.atan2(-tangent[0], -tangent[2]));
    rig.trailer!.syncReset();
    rig.race.reacquire(rig.car.position.x, rig.car.position.z);
    const own = rig.trafficBodies(rig.parkingPath);
    const lead = own.reduce((front, body) => body.s > front.s ? body : front);
    const parked = { ...lead, driver: 'parked-ahead', s: lead.s + lead.halfLength * 2 + .3, speed: 0 };
    let input = rig.parkingInput({ own, bodies: [...own, parked] }, 1 / 60);
    for (let t = 0; t < 6; t += .5) input = rig.parkingInput({ own, bodies: [...own, parked] }, .5);
    expect(input, 'the way out is behind; the parked car ahead is not a queue to wait in').toMatchObject({ throttle: 0, brake: 1 });
    expect(input.parkingBrake).not.toBe(true);
  } finally { rig.dispose(); physics.dispose(); }
});

// The rescue dropped a rig from spawn height, and holding it parked every frame made the drop
// take a second; for that second it reported "stopped" while still moving at about 1 km/h.
it('a rescued parker lands at rest in its berth', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  const ground = spline.point(spline.count - 1)[1];
  physics.add('floor', { trimeshes: [], boxes: [{ center: [0, ground - .5, 0], half: [5000, .5, 5000], yaw: 0 }] });
  const rig = new Racer('rig', vehicleFor('pickup-travel-trailer')!, model(), model(), physics, scene, track, spline, track.start, 'ai');
  const step = () => physics.step(1 / 60, h => {
    const input = rig.parkingInput(undefined, h);
    rig.car.update(h, input); rig.trailer!.update(h);
  });
  try {
    rig.race.state = 'finished'; rig.beginParking(1);
    const spot = rig.parkingState!.target, tangent = spline.tangent(spline.count - 1);
    rig.car.reset([spot[0] + tangent[2] * 9, ground + 1, spot[2] - tangent[0] * 9], Math.atan2(-tangent[0], -tangent[2]));
    rig.trailer!.syncReset();
    rig.race.reacquire(rig.car.position.x, rig.car.position.z);
    // Standing still beside its berth long enough for the rescue.
    for (let i = 0; i < 120; i++) physics.step(1 / 60, h => { rig.car.update(h, { throttle: 0, brake: 1, steer: 0, parkingBrake: true }); rig.trailer!.update(h); });
    for (let t = 0; t < 31; t += .5) rig.parkingInput(undefined, .5);
    // A deck overhead, like an overpass above the run-out, must not be taken for the ground under either.
    const car = rig.car.position;
    physics.add('deck', { trimeshes: [], boxes: [{ center: [car.x, ground + 7, car.z], half: [3, .3, 3], yaw: 0, role: 'ground' }] });
    physics.step(1 / 60, h => { rig.car.update(h, { throttle: 0, brake: 1, steer: 0, parkingBrake: true }); rig.trailer!.update(h); });
    const berth = rig.parkingRescue([rig]);
    expect(berth).not.toBeNull();
    expect(berth!.pos[1], 'the berth height ignores a deck over the stalled car').toBeGreaterThan(ground - .5); expect(berth!.pos[1]).toBeLessThan(ground + 1.5);
    rig.car.reset(berth!.pos, berth!.yaw); rig.trailer!.syncReset(); rig.settleInBerth();
    for (let i = 0; i < 3; i++) step();
    expect(rig.parkingState).toMatchObject({ stopped: true, rescued: true });
    expect(rig.car.speed * 3.6, 'a parked rig is at rest').toBeLessThan(1);
    expect(rig.parkingState!.distance).toBeLessThan(3);
  } finally { rig.dispose(); physics.dispose(); }
});

it('places a parker that stopped closing on its berth there after the rescue delay, unless the berth is taken', () => {
  const track = loadTrack('synth-p2p'), spline = new Spline(track);
  const physics = new PhysicsWorld(api), scene = new THREE.Scene();
  const stuck = new Racer('stuck', vehicleFor('micro-hatch')!, model(), null, physics, scene, track, spline, track.start, 'ai');
  const squatter = new Racer('squatter', vehicleFor('micro-hatch')!, model(), null, physics, scene, track, spline, track.start, 'ai');
  try {
    stuck.race.state = 'finished'; stuck.beginParking(3);
    const spot = stuck.parkingState!.target;
    squatter.car.reset([spot[0], spot[1] + 1, spot[2]], 0);
    for (let t = 0; t < 29.5; t += .5) stuck.parkingInput(undefined, .5);
    expect(stuck.parkingRescue([stuck])).toBeNull();
    for (let t = 0; t < 1; t += .5) stuck.parkingInput(undefined, .5);
    expect(stuck.parkingRescue([stuck, squatter])).toBeNull();
    const berth = stuck.parkingRescue([stuck]);
    expect(berth?.pos[0]).toBeCloseTo(spot[0]); expect(berth?.pos[2]).toBeCloseTo(spot[2]);
    stuck.settleInBerth();
    expect(stuck.parkingState).toMatchObject({ stopped: true, rescued: true });
  } finally { stuck.dispose(); squatter.dispose(); physics.dispose(); }
});
