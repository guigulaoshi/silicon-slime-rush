import { describe, expect, it } from 'vitest';
import { SEDAN } from '../src/physics/CarTuning';

/**
 * Rubbing along a rail must not throw the car anywhere it did not ask to go.
 *
 * The old behaviour was the solver's: push the car out of the wall, which sends it across the road
 * and spinning, and two hits later it is over the rail on the far side. That is a punishment most
 * players cannot read -- they do not know what just happened. So the wall is allowed to take speed
 * and to line the car up along itself, and nothing else; the rule is written as a number here
 * rather than as a feeling.
 */
describe('the guardrail tuning', () => {
  it('lets nothing bounce back and nothing spin', () => {
    expect(SEDAN.scrapeAbsorb, 'all of the speed into the wall has to go').toBe(1);
    expect(SEDAN.scrapeSpin, 'none of the spin from the wall may survive').toBe(1);
  });

  it('still charges for the rub, or the wall becomes a free racing line', () => {
    expect(SEDAN.scrapeDrag).toBeGreaterThan(0.2);
    expect(SEDAN.scrapeDrag).toBeLessThan(1.5);
  });

  it('guides at a road-following rate, not a spinning one', () => {
    // fast enough to follow a 75 m corner at 120 km/h, which is the tightest thing the synthetic
    // test loop asks for; slow enough that it can never read as the wall throwing the car
    expect(SEDAN.scrapeAlign).toBeGreaterThan(0.45);
    expect(SEDAN.scrapeAlign).toBeLessThan(1.5);
  });
});

/**
 * The clamp itself, as arithmetic.
 *
 * The car is allowed to yaw anywhere between what the driver's own steering asks for and what would
 * line it up with the rail. Both ends of that band are things the player would recognise: their own
 * steering, and the rail they can see. Everything outside it -- every kick, every spin the solver
 * would have handed out -- is clipped away.
 */
function clampYaw(yaw: number, steerAngle: number, forwardSpeed: number, wheelbase: number,
                  align: number): number {
  const driver = Math.abs(steerAngle) * Math.abs(forwardSpeed) / wheelbase;
  return Math.min(Math.max(yaw, Math.min(-driver, align)), Math.max(driver, align));
}

describe('a wall may not out-turn the driver', () => {
  const wheelbase = Math.abs(SEDAN.wheels[0]![2] - SEDAN.wheels[2]![2]);

  it('freezes the heading when the wheel is straight and the rail runs straight on', () => {
    expect(clampYaw(2.4, 0, 40, wheelbase, 0)).toBeCloseTo(0, 10);
    expect(clampYaw(-2.4, 0, 40, wheelbase, 0)).toBeCloseTo(0, 10);
  });

  it('lets a bending rail straighten the car along itself, at the rail\'s own rate', () => {
    // the rail wants 0.4 rad/s of left; the driver is asking for nothing
    expect(clampYaw(3.0, 0, 40, wheelbase, 0.4)).toBeCloseTo(0.4);
    expect(clampYaw(0.2, 0, 40, wheelbase, 0.4)).toBeCloseTo(0.2);
    // and it may not push the car the other way while doing it
    expect(clampYaw(-3.0, 0, 40, wheelbase, 0.4)).toBeCloseTo(0);
  });

  it('leaves the driver the yaw they asked for', () => {
    const asked = 0.3 * 40 / wheelbase;
    expect(clampYaw(asked * 0.5, 0.3, 40, wheelbase, 0)).toBeCloseTo(asked * 0.5);
    expect(clampYaw(asked * 4, 0.3, 40, wheelbase, 0)).toBeCloseTo(asked);
  });

  it('never turns the car harder than the driver or the rail between them asked for', () => {
    for (const yaw of [6, -6, 0.4, -0.4]) {
      for (const align of [0, 0.6, -0.6]) {
        const out = clampYaw(yaw, 0.1, 30, wheelbase, align);
        const driver = 0.1 * 30 / wheelbase;
        expect(out).toBeLessThanOrEqual(Math.max(driver, align) + 1e-9);
        expect(out).toBeGreaterThanOrEqual(Math.min(-driver, align) - 1e-9);
        expect(Math.abs(out)).toBeLessThanOrEqual(Math.abs(yaw) + 1e-9);
      }
    }
  });

  it('does nothing at a standstill, where there is no yaw to clamp anyway', () => {
    expect(clampYaw(0, 0, 0, wheelbase, 0)).toBe(0);
  });
});


/**
 * Sparks are a thing speed does, not a thing contact does.
 *
 * Contact is measured every physics step, so a car parked against the rail was throwing sparks
 * sixty times a second while standing perfectly still. Steel does not do that.
 */
describe('sparks', () => {
  it('needs the car to actually be moving along the wall', async () => {
    const { Sparks } = await import('../src/world/Sparks');
    const THREE = await import('three');
    const sparks = new Sparks();
    const forward = new THREE.Vector3(0, 0, -1);

    sparks.emit(0, 0, 0, 0, forward);          // parked against the rail
    expect(sparks.live, 'a stationary car makes no sparks').toBe(0);
    sparks.emit(0, 0, 0, 0.05, forward);       // creeping, about five km/h
    expect(sparks.live, 'nor does creeping along it').toBe(0);

    sparks.emit(0, 0, 0, 0.6, forward);        // a real scrape
    expect(sparks.live, 'a scrape at speed does').toBeGreaterThan(0);
    sparks.dispose();
  });

  it('turns a light hit into a small burst and a hard hit into a larger one', async () => {
    const { Sparks } = await import('../src/world/Sparks');
    const THREE = await import('three');
    const normal = new THREE.Vector3(1, 0, 0), forward = new THREE.Vector3(0, 0, -1);
    const light = new Sparks(), hard = new Sparks();
    light.impact(0, 0, 0, 0.12, normal, forward);
    hard.impact(0, 0, 0, 0.9, normal, forward);
    expect(light.impacts).toBe(1);
    expect(hard.live).toBeGreaterThan(light.live * 2);
    const ignored = new Sparks();
    ignored.impact(0, 0, 0, 0.01, normal, forward);
    expect(ignored.live).toBe(0);
    light.dispose(); hard.dispose(); ignored.dispose();
  });
});
