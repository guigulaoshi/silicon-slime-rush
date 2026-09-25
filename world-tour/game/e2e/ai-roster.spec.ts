import { evidencePath } from './evidence';
import { expect, test, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectWorldLoaded } from './world';
import { VEHICLES, vehicleFor } from '../src/vehicles/catalogue';
import { MOBILE_AI_RIVALS } from '../src/app/roster';

test.describe.configure({ timeout: 180_000 });

test('AI roster survives restart, selection changes and disposal without gaining human views', async ({ page }) => {
  // No ?speed: it was only ever honoured with ?bot=1 (src/main.ts), so this always ran at 1x, and nothing
  // here waits on race time -- only on the countdown and AI starting to move.
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  const cases = [
    { humans: ['micro-hatch'], ai: true },
    { humans: ['pickup-travel-trailer', 'pickup-travel-trailer'], ai: true },
    { humans: ['sports-car', 'city-pod'], ai: true },
    { humans: ['jeep', 'retro-van'], ai: false },
    { humans: ['school-bus'], ai: false },
  ];
  const evidence = [];
  for (const c of cases) {
    const selected = new Set(c.humans);
    const roster = [...c.humans.map(id => vehicleFor(id)!), ...(c.ai ? VEHICLES.filter(v => !selected.has(v.id)) : [])];
    const cars = roster.length, joints = roster.filter(vehicle => vehicle.trailer).length;
    expect(await page.evaluate(c => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
      playerVehicles: c.humans, ai: c.ai, slimeDensity: 'none' }), c)).toBe(true);
    await expectWorldLoaded(page, JSON.stringify(c));
    const snapshot = () => page.evaluate(() => {
      const s = window.game.session;
      return { roles: s.racers.map(r => r.role), vehicles: s.racers.map(r => r.vehicle.id),
        views: s.world.cameras.length, humans: s.humans.length, joints: s.physics.world.impulseJoints.len(),
        bodies: [...(s.physics as any).colliderRoles.values()].filter(role => role === 'car').length, choice: window.game.report().choice };
    });
    const before = await snapshot();
    expect(before.roles).toEqual([...c.humans.map(() => 'human'), ...Array(cars - c.humans.length).fill('ai')]);
    expect(before.views).toBe(c.humans.length); expect(before.humans).toBe(c.humans.length);
    expect(before.joints).toBe(joints); expect(before.bodies).toBe(cars + joints); expect(before.vehicles.slice(0, c.humans.length)).toEqual(c.humans);
    expect(before.vehicles.slice(c.humans.length).every(id => !c.humans.includes(id))).toBe(true);
    await page.evaluate(() => (window.game as any).beginCountdown());
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    if (c.ai) {
      await page.waitForFunction(() => window.game.report().players.filter(r => r.role === 'ai').every(r => r.speedKmh > 1));
      expect(await page.evaluate(() => window.game.report().players.filter(r => r.role === 'ai').every(r => !r.autopilot))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window.game as any).restart());
    const after = await snapshot();
    expect(after.roles).toEqual(before.roles); expect(after.joints).toBe(before.joints);
    expect(after.bodies).toBe(before.bodies);
    evidence.push({ c, before, after });
    if (c.ai && c.humans.length === 2) {
      const out = evidencePath('ai-roster'); mkdirSync(out, { recursive: true });
      await page.screenshot({ path: resolve(out, 'full-roster-grid.png'), animations: 'disabled' });
    }
    const disposed = await page.evaluate(() => {
      const s = window.game.session, counts = { racers: 0, models: 0, physics: 0 };
      const bodies = s.racers.flatMap(r => [r.car.body, ...(r.trailer ? [r.trailer.car.body] : [])]);
      let leftoverBodies = -1, leftoverJoints = -1;
      for (const racer of s.racers) {
        const original = racer.dispose.bind(racer); racer.dispose = () => { counts.racers++; original(); };
        const disposeModel = racer.model.dispose.bind(racer.model);
        racer.model.dispose = () => { counts.models++; disposeModel(); };
      }
      const original = s.physics.dispose.bind(s.physics);
      s.physics.dispose = () => { counts.physics++; leftoverBodies = bodies.filter(body => body.isValid()).length;
        leftoverJoints = s.physics.world.impulseJoints.len(); original(); };
      (window.game as any).quit();
      return { counts, leftoverBodies, leftoverJoints, sessionGone: window.game.session === null, phase: window.game.report().phase };
    });
    expect(disposed).toEqual({ counts: { racers: cars, models: cars, physics: 1 }, leftoverBodies: 0, leftoverJoints: 0, sessionGone: true, phase: 'menu' });
  }
  const out = evidencePath('ai-roster'); mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'lifecycle.json'), JSON.stringify(evidence, null, 2));
});

// Retired the phone's full field: a phone lines up
// MOBILE_AI_RIVALS rivals, none of them the player's own car; the one-view rule is unchanged.
test('mobile keeps one human view and lines up the short AI field', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 915, height: 412 } });
  const page = await context.newPage();
  try {
    await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
    expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
      playerVehicles: ['micro-hatch', 'jeep'], ai: true, slimeDensity: 'none' }))).toBe(true);
    expect(await page.evaluate(() => ({ humans: window.game.session.humans.length,
      cars: window.game.session.racers.length, views: window.game.session.world.cameras.length })))
      .toEqual({ humans: 1, cars: 1 + MOBILE_AI_RIVALS, views: 1 });
    const rivals = await page.evaluate(() => window.game.session.racers.filter(r => r.role === 'ai').map(r => r.vehicle.id));
    expect(new Set(rivals).size).toBe(MOBILE_AI_RIVALS);
    expect(rivals).not.toContain('micro-hatch');
  } finally { await context.close(); }
});
