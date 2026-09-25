import { expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from '../e2e/evidence';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { Car } from '../src/physics/Car';
import { Race, OFF_TRACK_SECONDS, RAIL_OFFSET } from '../src/track/Race';
import { Spline } from '../src/track/Spline';
import type { TrackData } from '../src/track/types';
import { vehicleFor, vehicleTuning } from '../src/vehicles/catalogue';

// The Moffett rail fixture is the generator's own mesh (beam 0.16-0.48 m, at x = 30.8). Lifting it
// 0.24 m gives the ordinary 0.40-0.72 m rail every other route uses, the one on the Big Tech Rooftop roof.
const moffett = JSON.parse(readFileSync('test/fixtures/moffett-rail.json', 'utf8'));
const ordinary = { vertices: moffett.vertices.map((v: number, i: number) => i % 3 === 1 ? v + .24 : v), indices: moffett.indices };
const RAIL_X = 30.8;

type Row = { side: number; speed: number; degrees: number; escaped: boolean; flipped: boolean; maxX: number; minUpright: number };
async function strikes(id: string, rail: { vertices: number[]; indices: number[] }, speeds: number[]) {
  const api = await initPhysics();
  const vehicle = vehicleFor(id)!;
  const tuning = vehicleTuning(vehicle, vehicle.tuning as any);
  const rows: Row[] = [];
  for (const side of [-1, 1]) for (const speed of speeds) for (const degrees of [5, 15, 30, 60]) {
    const physics = new PhysicsWorld(api, tuning.gravity);
    physics.add('ground', { boxes: [{ center: [0, -.5, 0], half: [100, .5, 500], yaw: 0 }], trimeshes: [] });
    physics.add('rails', { boxes: [], trimeshes: [{ vertices: new Float32Array(rail.vertices), indices: new Uint32Array(rail.indices), role: 'wall' }] });
    const angle = degrees * Math.PI / 180;
    const car = new Car(physics, tuning, { pos: [side * (RAIL_X - 4.8), 1.4, 0], yaw: -side * angle });
    for (let i = 0; i < 120; i++) { car.update(1 / 60, { throttle: 0, steer: 0, brake: 0 }); physics.world.step(); }
    car.body.setLinvel({ x: side * Math.sin(angle) * speed, y: 0, z: -Math.cos(angle) * speed }, true);
    let maxX = side * car.position.x; let minUpright = 1;
    for (let i = 0; i < 300; i++) {
      car.update(1 / 60, { throttle: 0, steer: 0, brake: 0 }); physics.world.step();
      maxX = Math.max(maxX, side * car.position.x); minUpright = Math.min(minUpright, car.upright);
    }
    rows.push({ side, speed, degrees, escaped: maxX > RAIL_X + tuning.chassisHalf[0], flipped: minUpright < .35, maxX, minUpright });
    physics.dispose();
  }
  return { id, trials: rows.length, escaped: rows.filter(r => r.escaped).length, flipped: rows.filter(r => r.flipped).length, rows };
}

it('tall rigs bounce off guardrails while a low sports car keeps its Moffett breaches', async () => {
  const bus = await strikes('school-bus', ordinary, [10, 18, 26]);
  const busLow = await strikes('school-bus', moffett, [10, 18, 26]);
  const monster = await strikes('monster-truck', moffett, [15, 25, 35]);
  const jeep = await strikes('jeep', moffett, [15, 25, 35]);
  const van = await strikes('retro-van', moffett, [15, 25, 35]);
  const sports = await strikes('sports-car', moffett, [15, 25, 35, 45, 55]);
  const out = evidencePath('rail-tall'); mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'strikes.json'), JSON.stringify({ bus, busLow, monster, jeep, van, sports }, null, 2));
  const summary = JSON.stringify([bus, busLow, monster, jeep, van, sports].map(({ id, trials, escaped, flipped }) => ({ id, trials, escaped, flipped })));
  expect(bus.trials).toBe(24);
  expect(bus.escaped + bus.flipped, summary).toBeLessThanOrEqual(2);
  expect(busLow.escaped, summary).toBeLessThanOrEqual(2);
  expect(jeep.escaped + jeep.flipped, summary).toBe(0);
  expect(van.escaped + van.flipped, summary).toBe(0);
  // the player withdrew the monster-truck rail shortcut: it is contained like every tall rig.
  expect(monster.escaped + monster.flipped, summary).toBe(0);
  // Own conditions: 31 of 40 with the 0.6-scale car on a 0.48 m rail's 0.7-scale
  // car on the raised 0.50 m rail gives 30, the same breakout share the player accepted.
  expect(sports.trials).toBe(40);
  expect(sports.escaped, summary).toBe(30);
}, 30_000);   // 160 simulated strikes: ~2.5 s alone, past vitest's 5 s default under a full parallel run

function raceOn(bodyHalfWidth: number) {
  const points = Array.from({ length: 101 }, (_, i) => [0, 0, -i * 2] as [number, number, number]);
  const track = { id: 't', spline: { points, halfWidth: Array(101).fill(8), closed: false, length: 200 },
    start: { pos: [0, 0, -20], yaw: 0 }, checkpoints: [], mode: 'p2p', laps: 1 } as unknown as TrackData;
  return new Race(track, new Spline(track), bodyHalfWidth);
}
function hold(race: Race, x: number, seconds: number) {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    events.push(...race.update(1 / 60, { x, z: -100, speed: 3, headingX: 0, headingZ: -1 }));
  }
  return events.filter(event => event.type === 'reset');
}

it('rescues a car whose whole body is past the rail line on the ordinary clock', () => {
  // Bus half width .708: centre 8 + .3 + .708 is the rail line with the body wholly outside it.
  expect(hold(raceOn(.708), 8 + RAIL_OFFSET + .708 + .1, OFF_TRACK_SECONDS + .1)).toHaveLength(1);
  // Straddling the rail is not past it.
  expect(hold(raceOn(.708), 8 + RAIL_OFFSET + .3, 5)).toHaveLength(0);
  // The monster truck no longer has a 32 m shortcut boundary: 20 m out is rescued like anyone.
  expect(hold(raceOn(.94), 8 + 20, OFF_TRACK_SECONDS + .1)).toHaveLength(1);
});

it('uses the rail offset the pipeline builds rails at', () => {
  const roads = readFileSync('../pipeline/sr/roads.py', 'utf8');
  expect(Number(/^RAIL_OFFSET = ([\d.]+)/m.exec(roads)![1])).toBe(RAIL_OFFSET);
});
