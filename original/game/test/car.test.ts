import { beforeAll, describe, expect, it } from 'vitest';
import { Car, NO_INPUT, type CarInput } from '../src/physics/Car';
import { SEDAN, tuningFor } from '../src/physics/CarTuning';

const rad = (deg: number) => (deg * Math.PI) / 180;
import { PhysicsWorld, initPhysics, type CollisionRole } from '../src/physics/PhysicsWorld';
import type RAPIER from '@dimforge/rapier3d-compat';
import { SurfaceGrid, type SurfaceKind } from '../src/world/SurfaceGrid';
import { vehicleFor, vehicleTuning } from '../src/vehicles/catalogue';

let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); }, 60_000);

/** A flat plate of ground, built the way a tile would build it. */
function ground(physics: PhysicsWorld, size = 8000, y = 0) {
  const v = new Float32Array([-size, y, -size, size, y, -size, size, y, size, -size, y, size]);
  const i = new Uint32Array([0, 2, 1, 0, 3, 2]);
  physics.add('ground', { trimeshes: [{ vertices: v, indices: i }], boxes: [] });
}

function drive(car: Car, physics: PhysicsWorld, seconds: number, input: CarInput | ((t: number) => CarInput)) {
  const dt = physics.timestep;
  for (let t = 0; t < seconds; t += dt) {
    car.update(dt, typeof input === 'function' ? input(t) : input);
    physics.world.step();
  }
}

/** Get up to a corner-entry speed. Driving flat out for a fixed time instead puts the car at its
 *  terminal velocity, where no steering angle can ask for a big slide and every cornering assertion
 *  is really a statement about the top speed. */
function accelerateTo(car: Car, physics: PhysicsWorld, speed: number) {
  const dt = physics.timestep;
  for (let i = 0; i < 60 * 30 && car.speed < speed; i++) {
    car.update(dt, { ...NO_INPUT, throttle: 1 });
    physics.world.step();
  }
}

function makeCar(tuning = tuningFor('sedan'), y = 1.2) {
  const physics = new PhysicsWorld(api, tuning.gravity);
  ground(physics);
  const car = new Car(physics, tuning, { pos: [0, y, 0], yaw: 0 });
  return { physics, car };
}

function surfaceAhead(car: Car, kind: SurfaceKind, radius: number): SurfaceGrid {
  const grid = new SurfaceGrid(10);
  grid.add({ key: kind, tile: 'test', source: 'dynamic', kind,
    x: car.position.x, z: car.position.z - 5, radius });
  return grid;
}

describe('PhysicsWorld', () => {
  it('runs whole fixed steps and reports the leftover for interpolation', () => {
    const p = new PhysicsWorld(api);
    const whole = p.step(1 / 60);
    expect(whole.steps).toBe(1);
    expect(whole.elapsed).toBeCloseTo(1 / 60);
    const r = p.step(1 / 120);
    expect(r.steps).toBe(0);
    expect(r.elapsed).toBe(0);
    expect(r.alpha).toBeCloseTo(0.5, 1);
    p.dispose();
  });

  it('runs the semantic callback after each completed physics step', () => {
    const p = new PhysicsWorld(api);
    const order: string[] = [];
    const r = p.step(2 / 60, () => order.push('before'), 5, () => order.push('after'));
    expect(r.steps).toBe(2);
    expect(order).toEqual(['before', 'after', 'before', 'after']);
    p.dispose();
  });

  it('caps how much time one frame may replay, so a stall does not teleport the car', () => {
    const p = new PhysicsWorld(api);
    const r = p.step(10);
    expect(r.steps).toBeLessThanOrEqual(5);
    expect(r.elapsed).toBeCloseTo(r.steps * p.timestep);
    expect(r.elapsed).toBeLessThan(10);
    p.dispose();
  });

  it('adds and removes tile colliders by key', () => {
    const p = new PhysicsWorld(api);
    ground(p);
    expect(p.tileCount).toBe(1);
    p.remove('ground');
    expect(p.tileCount).toBe(0);
    p.dispose();
  });

  it.each([
    ['wall', false],
    ['slime-colossus', true],
    ['slime-popper', true],
  ] as const)('classifies a car contact with %s through the event queue', (role, sensor) => {
    const p = new PhysicsWorld(api, 0);
    const car = new Car(p, tuningFor('sedan'), { pos: [0, 0, 0], yaw: 0 });
    const body = p.world.createRigidBody(api.RigidBodyDesc.fixed());
    const desc = api.ColliderDesc.cuboid(0.3, 0.3, 0.3).setTranslation(0, 0, 0);
    if (sensor) desc.setSensor(true);
    const collider = p.world.createCollider(desc, body);
    p.registerCollider(collider, role as CollisionRole);

    p.step(p.timestep, (h) => car.update(h, NO_INPUT));
    p.step(p.timestep, (h) => car.update(h, NO_INPUT));

    expect(car.collisions.some((event) => event.started && event.kind === role)).toBe(true);
    p.step(p.timestep, (h) => car.update(h, NO_INPUT));
    expect(car.collisions.some((event) => event.started)).toBe(false);
    expect(car.hardContact).toBe(role !== 'slime-popper');
    car.reset([5, 0, 0], 0);
    expect(car.hardContact).toBe(false);
    p.dispose();
  });

  it('reports real car contacts to both bodies, grades relative speed and only repeats after separation', () => {
    const collide = (speed: number, repeat = false) => {
      const p = new PhysicsWorld(api, 0);
      const tuning = tuningFor('sedan');
      const left = new Car(p, tuning, { pos: [-3, 0, 0], yaw: 0 });
      const right = new Car(p, tuning, { pos: [3, 0, 0], yaw: 0 });
      p.setVehicleContacts(left.collider, true); p.setVehicleContacts(right.collider, true);
      const hits: NonNullable<Car['impactFeedback']>[] = [];
      const step = () => p.step(p.timestep, h => {
        left.update(h, NO_INPUT); right.update(h, NO_INPUT);
        if (left.impactFeedback) hits.push(left.impactFeedback);
        if (right.impactFeedback) hits.push(right.impactFeedback);
      });
      const launch = () => {
        left.body.setLinvel({ x: speed, y: 0, z: 0 }, true);
        right.body.setLinvel({ x: -speed, y: 0, z: 0 }, true);
        for (let i = 0; i < 240 && hits.length < (repeat ? 4 : 2); i++) step();
      };
      launch();
      expect(hits).toHaveLength(2);
      for (let i = 0; i < 30; i++) step();
      expect(hits, 'one continuing contact is one hit').toHaveLength(2);
      if (repeat) {
        left.reset([-3, 0, 0], 0); right.reset([3, 0, 0], 0);
        for (let i = 0; i < 4; i++) step();
        launch();
        expect(hits, 'separating and hitting again makes one new event per car').toHaveLength(4);
      }
      const firstPair = hits.slice(0, 2);
      expect(firstPair.every(hit => hit.kind === 'vehicle')).toBe(true);
      expect(firstPair[0]!.point.x).toBeCloseTo(firstPair[1]!.point.x, 4);
      expect(firstPair[0]!.point.y).toBeCloseTo(firstPair[1]!.point.y, 4);
      expect(firstPair[0]!.normal.x * firstPair[1]!.normal.x
        + firstPair[0]!.normal.y * firstPair[1]!.normal.y
        + firstPair[0]!.normal.z * firstPair[1]!.normal.z).toBeLessThan(-0.99);
      p.dispose();
      return firstPair[0]!.strength;
    };
    const light = collide(1.2), hard = collide(10, true);
    expect(light).toBeGreaterThan(0.05);
    expect(hard).toBeGreaterThan(light * 4);
    expect(hard).toBeGreaterThan(0.9);
  });

  it('carries a real barrier solver point and normal into one graded impact', () => {
    const p = new PhysicsWorld(api, 0);
    const car = new Car(p, tuningFor('sedan'), { pos: [-4, 0, 0], yaw: 0 });
    const wallBody = p.world.createRigidBody(api.RigidBodyDesc.fixed());
    const wall = p.world.createCollider(api.ColliderDesc.cuboid(.5, 2, 4), wallBody);
    p.registerCollider(wall, 'wall');
    car.body.setLinvel({ x: 12, y: 0, z: 0 }, true);
    const hits: NonNullable<Car['impactFeedback']>[] = [];
    for (let i = 0; i < 240; i++) p.step(p.timestep, h => {
      car.update(h, NO_INPUT); if (car.impactFeedback) hits.push(car.impactFeedback);
    });
    expect(hits, JSON.stringify({ position: car.position, speed: car.speed })).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'barrier' });
    expect(hits[0]!.strength).toBeGreaterThan(0.6);
    expect(hits[0]!.point.x).toBeLessThan(0);
    expect(hits[0]!.normal.x).toBeLessThan(-0.9);
    p.dispose();
  });

  it('production wheel rays ignore ordinary slime and traversable colossus sensors', () => {
    const contactHeight = (role: 'slime-popper' | 'slime-colossus') => {
      const p = new PhysicsWorld(api, 0);
      ground(p, 20);
      const fixed = p.world.createRigidBody(api.RigidBodyDesc.fixed());
      const desc = api.ColliderDesc.cuboid(2, 0.03, 2).setTranslation(0, 0.14, 0);
      desc.setSensor(true);
      const collider = p.world.createCollider(desc, fixed);
      p.registerCollider(collider, role);
      const car = new Car(p, tuningFor('sedan'), { pos: [0, 0.5, 0], yaw: 0 });
      // Rapier updates its scene-query broad phase on a step; without this the fixture reaches no
      // collider and a zero contact height proves nothing either way.
      p.world.step();
      const probe = new api.Ray({ x: -0.39, y: 0.27, z: -0.7 }, { x: 0, y: -1, z: 0 });
      const direct = p.world.castRayAndGetNormal(
        probe, 0.37, true, api.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, car.body);
      expect(direct?.collider.handle).not.toBe(collider.handle);
      car.update(p.timestep, NO_INPUT);
      const height = Math.max(...car.wheels.map((wheel) => wheel.contact.y));
      p.dispose();
      return height;
    };

    expect(contactHeight('slime-popper')).toBeCloseTo(0, 2);
    expect(contactHeight('slime-colossus')).toBeCloseTo(0, 2);
  });
});

describe('Car', () => {
  it('settles on its suspension instead of falling through or bouncing away', () => {
    const { physics, car } = makeCar();
    drive(car, physics, 2, NO_INPUT);
    const y = car.position.y;
    expect(y).toBeGreaterThan(0.2);
    expect(y).toBeLessThan(1.2);
    expect(car.grounded).toBe(true);
    expect(Math.abs(car.speed)).toBeLessThan(0.5);
    physics.dispose();
  });

  it('accelerates on throttle and stops on the brake', () => {
    const { physics, car } = makeCar();
    drive(car, physics, 1, NO_INPUT);
    drive(car, physics, 4, { ...NO_INPUT, throttle: 1 });
    const cruising = car.forwardSpeed;
    expect(cruising).toBeGreaterThan(12);
    car.update(physics.timestep, { ...NO_INPUT, brake: 1 });
    expect(car.braking).toBe(1);
    physics.world.step();
    drive(car, physics, 3, { ...NO_INPUT, brake: 1 });
    expect(car.forwardSpeed).toBeLessThan(cruising * 0.4);
    physics.dispose();
  });

  it('reports tyre skid from the shared lateral and longitudinal force budget', () => {
    const { physics, car } = makeCar();
    drive(car, physics, 1, NO_INPUT);
    accelerateTo(car, physics, 18);
    car.update(physics.timestep, NO_INPUT);
    expect(Math.max(...car.wheels.map(wheel => wheel.skid))).toBeLessThan(.18);
    physics.world.step();
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      car.update(physics.timestep, { ...NO_INPUT, brake: 1 });
      peak = Math.max(peak, ...car.wheels.map(wheel => wheel.skid));
      physics.world.step();
    }
    expect(peak).toBeGreaterThan(.18);
    physics.dispose();
  });

  it('queries all four tyre contacts and eases a slick patch out', () => {
    const { physics, car } = makeCar();
    drive(car, physics, 1, NO_INPUT);
    accelerateTo(car, physics, 30);
    const coordinates: [number, number][] = [];
    car.setSurfaceQuery((x, z) => { coordinates.push([x, z]); return { slick: 0 }; });
    car.update(physics.timestep, NO_INPUT);
    physics.world.step();
    expect(coordinates).toHaveLength(4);
    coordinates.forEach(([x, z], i) => {
      expect(x).toBeCloseTo(car.wheels[i]!.contact.x);
      expect(z).toBeCloseTo(car.wheels[i]!.contact.z);
    });

    const grid = surfaceAhead(car, 'slick', 2.2);
    car.setSurfaceQuery(grid.query.bind(grid));
    drive(car, physics, 0.2, NO_INPUT);
    expect(car.surfaceState.slick).toBeGreaterThan(0.5);
    car.body.setLinvel({ x: 0, y: 0, z: -30 }, true);
    const before = car.speed;
    car.update(physics.timestep, NO_INPUT);
    expect(car.speed).toBeCloseTo(before, 8);
    car.setSurfaceQuery(() => ({ slick: 0 }));
    drive(car, physics, 2, NO_INPUT);
    expect(car.surfaceState.slick).toBeLessThan(0.06);
    physics.dispose();
  });

  it('makes a full slick lose about half its lateral grip and step the rear out', () => {
    const corner = (slick: number) => {
      const { physics, car } = makeCar();
      drive(car, physics, 1, NO_INPUT);
      accelerateTo(car, physics, 30);
      const grid = surfaceAhead(car, 'slick', 2.7);
      car.setSurfaceQuery(slick ? grid.query.bind(grid) : () => ({ slick: 0 }));
      let peak = 0;
      drive(car, physics, 1.2, () => {
        peak = Math.max(peak, Math.abs(car.slipAngle));
        return { ...NO_INPUT, throttle: 0.7, steer: 1 };
      });
      const result = { peak, speed: car.speed };
      physics.dispose();
      return result;
    };
    const dry = corner(0);
    const slick = corner(1);
    expect(slick.peak).toBeGreaterThan(dry.peak * 1.08);
    expect(slick.peak).toBeGreaterThan(rad(17));
    expect(slick.speed).toBeGreaterThan(10);
  });

  it('applies a half-strength state when only the left tyre contacts hit slick', () => {
    const { physics, car } = makeCar();
    drive(car, physics, 1, NO_INPUT);
    const centre = car.position.x;
    car.setSurfaceQuery((x) => ({ slick: x < centre ? 1 : 0 }));
    drive(car, physics, 0.5, NO_INPUT);
    expect(car.surfaceState.slick).toBeGreaterThan(0.45);
    expect(car.surfaceState.slick).toBeLessThan(0.55);
    physics.dispose();
  });

  it('respects its top speed', () => {
    const { physics, car } = makeCar();
    drive(car, physics, 30, { ...NO_INPUT, throttle: 1 });
    expect(car.forwardSpeed).toBeLessThan(SEDAN.maxSpeed * 1.15);
    expect(car.forwardSpeed).toBeGreaterThan(SEDAN.maxSpeed * 0.6);
    physics.dispose();
  });

  it('turns the way it is steered', () => {
    const { physics, car } = makeCar();
    drive(car, physics, 1, NO_INPUT);
    drive(car, physics, 3, { ...NO_INPUT, throttle: 1 });
    const before = car.position.clone();
    drive(car, physics, 3, { ...NO_INPUT, throttle: 0.6, steer: 1 });
    const moved = car.position.clone().sub(before);
    // steering right, in a frame where forward is -z and right is +x
    expect(moved.x).toBeGreaterThan(2);
    physics.dispose();
  });

  it('drifts on full lock at speed instead of spinning, and comes back when the wheel is straightened', () => {
    const { physics, car } = makeCar();
    drive(car, physics, 1, NO_INPUT);
    accelerateTo(car, physics, 35);
    let peak = 0;
    for (let i = 0; i < 3; i++) {
      drive(car, physics, 0.6, { ...NO_INPUT, throttle: 0.7, steer: 1 });
      peak = Math.max(peak, Math.abs(car.slipAngle));
    }
    expect(peak).toBeGreaterThan(rad(10));   // it really does slide
    expect(peak).toBeLessThan(rad(50));      // but it does not spin
    expect(car.speed).toBeGreaterThan(25);   // and it is still carrying speed
    drive(car, physics, 2.5, { ...NO_INPUT, throttle: 0.7 });
    expect(Math.abs(car.slipAngle)).toBeLessThan(rad(5));
    physics.dispose();
  });

  it('lets the throttle choose between carrying speed and rotating, without spinning either way', () => {
    // With no handbrake, the pedals are the whole drift vocabulary. On the power the car slides and
    // holds its angle; off it, the weight goes forward and the rear steps out for the same lock;
    // on the brakes it rotates hardest and arrives slowest. None of the three may end in a spin.
    const corner = (throttle: number, brake: number) => {
      const { physics, car } = makeCar();
      drive(car, physics, 1, NO_INPUT);
      accelerateTo(car, physics, 35);
      // Only while the car is still travelling. Below walking pace a slip angle stops meaning
      // anything -- full lock with the brakes on pivots the car, which is a handy way to turn round
      // in a street and not the spin this is about.
      let peak = 0;
      for (let i = 0; i < 18; i++) {
        drive(car, physics, 0.1, { ...NO_INPUT, throttle, brake, steer: 1 });
        if (car.speed > 8) peak = Math.max(peak, Math.abs(car.slipAngle));
      }
      const held = car.speed;
      drive(car, physics, 3, { ...NO_INPUT, throttle: 0.7 });
      const out = { peak, held, slipAfter: Math.abs(car.slipAngle) };
      physics.dispose();
      return out;
    };
    const power = corner(1, 0);
    const lift = corner(0, 0);
    const braked = corner(0, 0.6);
    for (const [what, r] of [['power', power], ['lift', lift], ['braked', braked]] as const) {
      expect(r.peak, `${what} slides`).toBeGreaterThan(rad(13));
      expect(r.peak, `${what} does not spin`).toBeLessThan(rad(50));
      expect(r.slipAfter, `${what} comes back`).toBeLessThan(rad(6));
    }
    // Staying on the power is the only one of the three that comes out the far side with speed;
    // both of the others rotate further and arrive slower, which is the trade the driver is making.
    expect(power.held).toBeGreaterThan(lift.held + 10);
    expect(power.held).toBeGreaterThan(braked.held + 10);
    expect(lift.peak).toBeGreaterThan(power.peak);
    expect(braked.peak).toBeGreaterThan(power.peak);
  });

  it('backs up when the brake is held at a standstill, but only at a walking pace', () => {
    // On a phone the brake is the only control there is, so whatever it does when the car has
    // stopped it will do for a long time.
    const { physics, car } = makeCar();
    drive(car, physics, 1, NO_INPUT);
    drive(car, physics, 12, { ...NO_INPUT, brake: 1 });
    expect(car.forwardSpeed).toBeLessThan(-1);                        // it does reverse
    expect(car.forwardSpeed).toBeGreaterThan(-SEDAN.maxReverseSpeed - 2);
    expect(car.braking, 'the same pedal is reverse drive now, not tyre braking').toBe(0);
    physics.dispose();
  });

  it('rubs along a guardrail, and reports nothing while merely driving hard', () => {
    // One winding, not two. A strip drawn twice over so it can be seen from behind is non-manifold
    // -- every edge belongs to four triangles -- and the solver answers contacts against it with
    // normals pointing anywhere at all, including straight back down the road. The rail meshes the
    // pipeline emits are single-sided for exactly that reason, so the fixture is too.
    const wall = (physics: PhysicsWorld, at: number, h = 1, len = 4000) => {
      const v = new Float32Array([at, 0, -len, at, h, -len, at, 0, len, at, h, len]);
      const i = new Uint32Array([0, 2, 1, 1, 2, 3]);
      physics.add('rail', { trimeshes: [{ vertices: v, indices: i }], boxes: [] });
    };
    const { physics, car } = makeCar();
    wall(physics, 6);
    drive(car, physics, 1, NO_INPUT);
    accelerateTo(car, physics, 40);

    // hard driving on its own is never contact
    drive(car, physics, 1.2, { ...NO_INPUT, throttle: 1, brake: 0, steer: 0 });
    let touched = false;
    drive(car, physics, 1.0, (): CarInput => { touched ||= !!car.scrape; return { ...NO_INPUT, brake: 1 }; });
    expect(touched, 'braking flat out in open road is not contact').toBe(false);

    accelerateTo(car, physics, 40);
    const dt = physics.timestep;
    let worstLoss = 0;
    for (let i = 0; i < 60 * 3 && car.position.x < 5.5; i++) {
      const before = car.speed;
      car.update(dt, { ...NO_INPUT, throttle: 1, steer: 0.3 });
      physics.world.step();
      if (car.scrape) { touched = true; worstLoss = Math.max(worstLoss, before - car.speed); }
    }
    expect(touched, 'brushing the rail registers').toBe(true);
    // The engine wins the speed back over the next half second, which is the point: the rail is a
    // cost, not a stop. What it must not be is free -- a fifth of a metre per second inside one
    // 60 Hz step is 12 m/s^2 on top of whatever the tyres were already doing.
    expect(worstLoss, 'and the rub itself takes speed off').toBeGreaterThan(0.2);
    expect(car.position.x, 'and keeps the car on the road').toBeLessThan(6);
    physics.dispose();
  });

  it('keeps a sustained low-angle scrape on the road side of a guardrail', () => {
    const tuning = tuningFor('sedan');
    const physics = new PhysicsWorld(api, tuning.gravity);
    ground(physics);
    const v = new Float32Array([6, 0, -4000, 6, 1, -4000, 6, 0, 4000, 6, 1, 4000]);
    physics.add('rail', { trimeshes: [{ vertices: v,
      indices: new Uint32Array([0, 2, 1, 1, 2, 3]) }], boxes: [] });
    const car = new Car(physics, tuning, { pos: [0, 1.2, 0], yaw: 0 });
    drive(car, physics, 1, NO_INPUT);
    accelerateTo(car, physics, 16);

    let touched = false;
    for (let step = 0; step < 60 * 12 && !touched; step++) {
      car.update(physics.timestep, { ...NO_INPUT, throttle: .55, steer: .18 });
      physics.world.step();
      touched ||= !!car.scrape;
    }
    expect(touched, 'the fixture must actually rub the rail').toBe(true);
    const at = car.position;
    physics.setBodyPosition(car.body, { x: 6.85, y: at.y, z: at.z });
    car.body.setLinvel({ x: .4, y: 0, z: -12 }, true);
    drive(car, physics, 1, { ...NO_INPUT, throttle: .35, steer: .05 });
    expect(car.position.x, 'a mild scrape must leave the chassis inside the rail')
      .toBeLessThanOrEqual(6 - tuning.chassisHalf[0] + .08);
    physics.dispose();
  });

  it('does not pull a high normal-speed breach back through the guardrail', () => {
    const tuning = tuningFor('sedan');
    const physics = new PhysicsWorld(api, tuning.gravity);
    ground(physics);
    const v = new Float32Array([6, 0, -4000, 6, 1, -4000, 6, 0, 4000, 6, 1, 4000]);
    physics.add('rail', { trimeshes: [{ vertices: v,
      indices: new Uint32Array([0, 2, 1, 1, 2, 3]) }], boxes: [] });
    const car = new Car(physics, tuning, { pos: [0, 1.2, 0], yaw: 0 });
    drive(car, physics, 1, NO_INPUT);
    accelerateTo(car, physics, 16);
    let touched = false;
    for (let step = 0; step < 60 * 12 && !touched; step++) {
      car.update(physics.timestep, { ...NO_INPUT, throttle: .55, steer: .18 });
      physics.world.step();
      touched ||= !!car.scrape;
    }
    expect(touched, 'the fixture must establish the protected light scrape first').toBe(true);
    const at = car.position;
    physics.setBodyPosition(car.body, { x: 6.85, y: at.y, z: at.z });
    car.body.setLinvel({ x: 12, y: 0, z: -1 }, true);
    drive(car, physics, .5, NO_INPUT);
    expect(car.position.x, 'a hard breach stays on the side it broke through to').toBeGreaterThan(6);
    physics.dispose();
  });

  it('keeps low-speed and shallow-angle hits inside but permits a hard direct breakout', () => {
    const strike = (along: number, across: number) => {
      const tuning = tuningFor('sedan');
      const physics = new PhysicsWorld(api, tuning.gravity);
      ground(physics);
      const v = new Float32Array([6, 0, -4000, 6, 1, -4000, 6, 0, 4000, 6, 1, 4000]);
      physics.add('rail', { trimeshes: [{ vertices: v,
        indices: new Uint32Array([0, 2, 1, 1, 2, 3]), role: 'guardrail' }], boxes: [] });
      const yaw = Math.atan2(-across, along);
      const car = new Car(physics, tuning, { pos: [4.8, 1.2, 0], yaw });
      drive(car, physics, .5, NO_INPUT);
      car.body.setLinvel({ x: across, y: 0, z: -along }, true);
      drive(car, physics, 1, NO_INPUT);
      const x = car.position.x;
      physics.dispose();
      return x;
    };

    expect(strike(0, 4), 'a slow direct hit stays road-side').toBeLessThan(6);
    expect(strike(0, 9), 'a medium direct hit stays road-side').toBeLessThan(6);
    expect(strike(18, 4), 'a fast shallow rub stays road-side').toBeLessThan(6);
    expect(strike(0, 11), 'a fast direct hit may break out').toBeGreaterThan(6);
  });

  it('steering harder than the tyres allow does not turn the car inside out', () => {
    const { physics, car } = makeCar();
    drive(car, physics, 1, NO_INPUT);
    drive(car, physics, 5, { ...NO_INPUT, throttle: 1 });
    drive(car, physics, 4, { ...NO_INPUT, throttle: 1, steer: 1 });
    expect(Math.abs(car.slipAngle)).toBeLessThan(rad(60));
    expect(car.grounded).toBe(true);
    physics.dispose();
  });

  it('survives a wall at speed without leaving the world', () => {
    const tuning = tuningFor('sedan');
    const physics = new PhysicsWorld(api, tuning.gravity);
    ground(physics);
    physics.add('wall', { trimeshes: [], boxes: [{ center: [0, 3, -40], half: [20, 3, 1], yaw: 0 }] });
    const car = new Car(physics, tuning, { pos: [0, 1.2, 0], yaw: 0 });
    drive(car, physics, 1, NO_INPUT);
    drive(car, physics, 6, { ...NO_INPUT, throttle: 1 });
    const p = car.position;
    expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
    expect(p.y).toBeGreaterThan(-5);
    expect(p.z).toBeGreaterThan(-45);
    physics.dispose();
  });

  it('settles after scraping a guardrail instead of entering a permanent jitter', () => {
    const tuning = tuningFor('sedan');
    const physics = new PhysicsWorld(api, tuning.gravity);
    ground(physics);
    const v = new Float32Array([6, 0, -4000, 6, 1, -4000, 6, 0, 4000, 6, 1, 4000]);
    const i = new Uint32Array([0, 2, 1, 1, 2, 3]);
    physics.add('rail', { trimeshes: [{ vertices: v, indices: i }], boxes: [] });
    const car = new Car(physics, tuning, { pos: [0, 1.2, 0], yaw: 0 });
    drive(car, physics, 1, NO_INPUT);

    accelerateTo(car, physics, 40);
    let collided = false;
    for (let step = 0; step < 60 * 10 && !collided; step++) {
      car.update(physics.timestep, { ...NO_INPUT, throttle: 1, steer: 0.3 });
      physics.world.step();
      collided = !!car.scrape || car.impact > 0;
    }
    expect(collided, 'the fixture must actually hit the rail').toBe(true);

    const positions: { x: number; y: number; z: number }[] = [];
    const angles: { x: number; y: number; z: number }[] = [];
    const grounded: number[] = [];
    for (let i = 0; i < 60 * 15; i++) {
      car.update(physics.timestep, { ...NO_INPUT, throttle: 1, steer: 0.3 });
      physics.world.step();
      if (i >= 60 * 10) {
        const p = car.body.translation();
        const a = car.body.angvel();
        positions.push({ x: p.x, y: p.y, z: p.z });
        angles.push({ x: a.x, y: a.y, z: a.z });
        grounded.push(car.wheels.filter((w) => w.grounded).length);
      }
    }
    const span = (values: number[]) => Math.max(...values) - Math.min(...values);
    const verticalSpan = span(positions.map((p) => p.y));
    const lateralSpan = span(positions.map((p) => p.x));
    const longitudinalSpan = span(positions.map((p) => p.z));
    const peakAngular = Math.max(...angles.map((a) => Math.hypot(a.x, a.y, a.z)));
    const wheelStates = [...new Set(grounded)];
    expect(verticalSpan, 'the body stops bobbing after the crash').toBeLessThan(0.01);
    expect(lateralSpan, 'the body stops shuffling sideways after the crash').toBeLessThan(0.01);
    expect(longitudinalSpan, 'the body keeps travelling rather than shuffling in place').toBeGreaterThan(1);
    expect(peakAngular, 'the body does not rock after the crash').toBeLessThan(0.02);
    expect(wheelStates, 'all four wheels keep one stable contact state').toEqual([4]);
    physics.dispose();
  });

  it('rolls itself back onto its wheels, and only gives up when it cannot', () => {
    // A player cannot recover a car that has gone over, and outside the rail there is nothing to
    // recover onto, so the car rights itself rather than waiting to be teleported. What is left for
    // the reset is the case the assist cannot win: pinned, or somewhere with no ground under it.
    const tuning = tuningFor('sedan');
    const physics = new PhysicsWorld(api, tuning.gravity);
    ground(physics);
    const car = new Car(physics, tuning, { pos: [0, 1.2, 0], yaw: 0 });
    car.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true); // rolled onto its roof
    drive(car, physics, 2.5, NO_INPUT);
    expect(car.upright, 'it gets itself back over').toBeGreaterThan(0.9);
    expect(car.stuckUpsideDown, 'and so never asks to be put back').toBe(false);
    expect(car.grounded).toBe(true);

    // held upside down, it does ask
    for (let i = 0; i < 60 * 2; i++) {
      car.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
      car.update(physics.timestep, NO_INPUT);
      physics.world.step();
    }
    expect(car.stuckUpsideDown).toBe(true);
    const beforeReset = car.poseRevision;
    car.reset([0, 1.2, 0], 0);
    expect(car.stuckUpsideDown).toBe(false);
    expect(car.poseRevision).toBe(beforeReset + 1);
    physics.dispose();
  });
});

describe('large-coordinate physics integration', () => {
  it('preserves slow motion at the far end of the 65 km route', () => {
    for (const coordinate of [0, -2000, -38000]) {
      const physics = new PhysicsWorld(api, 0);
      const body = physics.createRigidBody(api.RigidBodyDesc.dynamic()
        .setTranslation(coordinate, 0, coordinate).setLinvel(.07665, 0, -.19012));
      const collider = physics.createCollider(api.ColliderDesc.ball(.5), body);
      physics.registerCollider(collider, 'car');
      for (let i = 0; i < 600; i++) physics.step(1 / 60);
      const p = physics.bodyPosition(body);
      expect(p.x - coordinate).toBeCloseTo(.7665, 2);
      expect(p.z - coordinate).toBeCloseTo(-1.9012, 2);
      physics.dispose();
    }
  });

  it('keeps far streamed mesh vertices local without moving the world surface', () => {
    const physics = new PhysicsWorld(api);
    const vertices = new Float32Array([-38010, 4, -38010, -37990, 4, -38010,
      -37990, 4, -37990, -38010, 4, -37990]);
    const original = vertices.slice();
    physics.add('far-tile', { trimeshes: [{ vertices,
      indices: new Uint32Array([0, 2, 1, 0, 3, 2]) }], boxes: [] });
    physics.world.step();
    physics.world.forEachCollider(collider => {
      expect(Math.max(...collider.vertices().map(Math.abs))).toBeLessThanOrEqual(10);
    });
    expect(physics.surfaceAt(-38000, -38000)?.point.y).toBeCloseTo(4, 4);
    expect(vertices).toEqual(original);
    const car = new Car(physics, SEDAN, { pos: [-38000, 5, -38000], yaw: 0 });
    physics.step(1 / 60, dt => car.update(dt, NO_INPUT));
    expect(physics.surfaceAt(-38000, -38000)?.point.y).toBeCloseTo(4, 4);
    physics.dispose();
  });

  it('streams new ground and standalone slime sensors in world coordinates after rebasing', () => {
    const physics = new PhysicsWorld(api, 0);
    const car = new Car(physics, tuningFor('sedan'), { pos: [-38000, 1, -38000], yaw: 0 });
    physics.step(1 / 60);
    physics.add('late', { trimeshes: [], boxes: [{ center: [-38000, -.5, -38000],
      half: [10, .5, 10], yaw: 0, role: 'ground' }] });
    const slime = physics.createCollider(api.ColliderDesc.ball(2).setTranslation(-38000, 1, -38000).setSensor(true));
    physics.registerCollider(slime, 'slime-popper');
    physics.step(1 / 60);
    expect(physics.surfaceAt(-38000, -38000)?.point.y).toBeCloseTo(0, 2);
    expect(physics.takeCarCollisions(car.collider)).toContainEqual(expect.objectContaining({
      kind: 'slime-popper', started: true, other: slime.handle,
    }));
    car.reset([-37990, 1, -38000], 0);
    expect(car.position.x).toBeCloseTo(-37990, 3);
    physics.dispose();
  });

  it('keeps climbing a slick-covered 15 percent grade at large world coordinates', () => {
    const distances: number[] = [];
    for (const coordinate of [0, -2000, -38000]) {
      const physics = new PhysicsWorld(api);
      const angle = Math.atan(.15);
      const ground = physics.createRigidBody(api.RigidBodyDesc.fixed()
        .setTranslation(coordinate, 0, coordinate)
        .setRotation({ x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) }));
      physics.registerCollider(physics.createCollider(api.ColliderDesc.cuboid(20, .5, 200), ground), 'ground');
      const car = new Car(physics, vehicleTuning(vehicleFor('micro-hatch')!), { pos: [coordinate, 1.3, coordinate], yaw: 0 });
      car.setSurfaceQuery(() => ({ slick: 1 }));
      for (let i = 0; i < 2400; i++) physics.step(1 / 60, dt => car.update(dt, { ...NO_INPUT, throttle: 1 }));
      distances.push(coordinate - car.position.z);
      expect(coordinate - car.position.z).toBeGreaterThan(2);
      physics.dispose();
    }
    expect(distances[1]).toBeCloseTo(distances[0]!, 1);
  });
});


it.each(['wall', 'ground', 'slime-slick', 'slime-burst', 'car'] as const)(
  'applies predictive rail correction only to static surfaces: %s', role => {
    const { physics, car } = makeCar();
    try {
      drive(car, physics, 1, NO_INPUT);
      const body = physics.world.createRigidBody(api.RigidBodyDesc.fixed());
      const collider = physics.world.createCollider(api.ColliderDesc.cuboid(.1, 3, 10)
        .setTranslation(car.tuning.chassisHalf[0] + .15, 1, 0), body);
      physics.registerCollider(collider, role);
      physics.world.step();
      car.body.setLinvel({ x: 1, y: 0, z: -10 }, true);
      car.update(1 / 60, NO_INPUT);
      expect(car.scrape !== null).toBe(role === 'wall' || role === 'ground');
    } finally { physics.dispose(); }
  });

describe('Hard AI catch-up assist', () => {
  const run = (assist: number, seconds: number) => {
    const { physics, car } = makeCar();
    car.assist = assist;
    drive(car, physics, 1, NO_INPUT);                 // settle on the springs
    drive(car, physics, seconds, { ...NO_INPUT, throttle: 1 });
    const speed = car.speed; physics.dispose(); return speed;
  };

  it('1 leaves the car exactly as it was, above 1 pulls harder and runs faster', () => {
    const plain = (() => { const { physics, car } = makeCar();
      drive(car, physics, 1, NO_INPUT); drive(car, physics, 4, { ...NO_INPUT, throttle: 1 });
      const speed = car.speed; physics.dispose(); return speed; })();
    expect(run(1, 4)).toBe(plain);
    expect(run(1.2, 4)).toBeGreaterThan(plain * 1.05);
    const top = tuningFor('sedan').maxSpeed;
    expect(run(1, 60)).toBeLessThanOrEqual(top * 1.01);
    expect(run(1.2, 60)).toBeGreaterThan(top * 1.05);
  }, 60_000);
});
