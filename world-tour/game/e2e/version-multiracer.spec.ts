import { evidencePath } from './evidence';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOGUE, SYNTHETIC } from '../src/app/tracks';
import { autopilotSettingsFor } from '../src/bot/Autopilot';
import { QUALITY_LIMITS } from '../src/world/quality';
import { driveBudgetGameSeconds } from './driveBudget';
import { expectWorldLoaded } from './world';

// This is the archived 0.6 acceptance matrix: 24 six-AI route/difficulty combinations plus
// two-player bots on every route. The recurring suite already checks every route, every vehicle,
// every difficulty and independent two-player completion in smaller tests. Repeating this entire
// historical cross-product makes the deliberate 64 km US 101 route run four extra times and adds
// hours without protecting a distinct behaviour. Keep the exact matrix available for an explicit
// 0.6 evidence rebuild, but do not charge every later version for it.
test.skip(process.env.VERSION_06_QA !== '1', 'archived 0.6 full-route acceptance matrix');
test.describe.configure({ timeout: 600_000 });
const { vehicles }: { vehicles: { id: string }[] } = JSON.parse(
  readFileSync(new URL('../src/vehicles/catalogue.json', import.meta.url), 'utf8'));
const out = evidencePath('version-0.6');
const profiles = [
  { difficulty: 'relaxed', human: 'micro-hatch' },
  { difficulty: 'rush', human: 'city-pod' },
] as const;

async function snapshot(page: Page) {
  return page.evaluate(() => ({ report: window.game.report(), racers: window.game.session.racers.map(r => ({
    id: r.id, vehicle: r.vehicle.id, role: r.role, difficulty: r.difficulty,
    parking: r.parkingState, bodyEnabled: r.car.body.isEnabled(), visible: r.mesh.visible,
    progress: r.race.progress.value.s, lateral: r.race.progress.value.lateral,
    trafficWaitSeconds: r.bot.trafficWaitSeconds, position: r.car.position, upright: r.car.upright,
    wheelLoads: r.car.wheels.map(w => w.load), lap: r.race.lap, mode: r.race.track.mode, trailer: r.trailer ? {
      hitchGap: r.trailer.hitchGap, upright: r.trailer.car.upright,
    } : null,
  })) }));
}

async function complete(page: Page, label: string, role: 'human' | 'ai') {
  const route = await page.evaluate(() => window.game.report());
  const paceSettings = await page.evaluate(role => window.game.session.racers.filter(r => r.role === role)
    .map(r => ({ tuning: r.car.tuning, settings: r.bot.settings })), role);
  // Slow difficulty intentionally changes the requested pace. Read its actual settings and the
  // existing standard owner; do not copy profile constants or demand standard times from slow AI.
  const pace = Math.min(1, ...paceSettings.map(r => r.settings.topSpeed / autopilotSettingsFor(r.tuning).topSpeed));
  const budget = driveBudgetGameSeconds(route.length, route.laps) / pace;
  // Fixed-step turbo does not guarantee six times wall speed with eight physical vehicles.
  // The route's simulated-time allowance stays owned by driveBudget; wall time catches a dead browser.
  test.setTimeout(Math.max(600_000, budget * 1000 + 120_000));
  const samples = [];
  let nextSample = 0;
  let separated = false, waiting = false;
  try {
    for (;;) {
      const current = await snapshot(page);
      const drivers = current.report.players.filter(r => r.role === role);
      expect(drivers.length).toBeGreaterThan(0);
      const time = Math.max(...drivers.map(r => r.time));
      if (role === 'human' && drivers.length === 2) {
        if (!separated && Math.hypot(drivers[0]!.x - drivers[1]!.x, drivers[0]!.z - drivers[1]!.z) > 100) {
          await page.screenshot({ path: resolve(out, label + '-separated.png'), animations: 'disabled' });
          separated = true;
        }
        if (!waiting && drivers.filter(r => r.state === 'finished').length === 1) {
          await page.screenshot({ path: resolve(out, label + '-waiting.png'), animations: 'disabled' });
          waiting = true;
        }
      }
      if (time >= nextSample) {
        samples.push(current); nextSample = time + 30;
        console.log(`${label}: ${time.toFixed(0)}s ` + current.racers.filter(r => r.role === role)
          .map(r => `${r.vehicle}=${r.progress.toFixed(0)}m`).join(' '));
      }
      if (drivers.every(r => r.state === 'finished') || drivers.some(r => r.resets.length > 0) || time >= budget) break;
      await page.waitForTimeout(500);
    }
  } finally {
    const final = await snapshot(page);
    writeFileSync(resolve(out, label + '.json'), JSON.stringify({ budget, pace, samples, final }, null, 2));
    await page.screenshot({ path: resolve(out, label + '-finish.png'), animations: 'disabled' });
  }
  const result = await snapshot(page);
  const report = result.report;
  if (role === 'ai') for (const human of report.players.filter(r => r.role === 'human')) {
    // A released car can roll off a sloped road during a full-length AI run. Off-road rescue
    // remains shared physics; only mistaking deliberate inactivity for a wedge is forbidden.
    expect(human.resets.filter(reset => reset.reason === 'wedged'),
      `${label}: an idle human must not be treated as wedged`).toHaveLength(0);
  }
  for (const driver of report.players.filter(r => r.role === role)) {
    expect(driver.state, `${label} ${driver.id}: ${JSON.stringify(driver)}`).toBe('finished');
    const racer = result.racers.find(r => r.id === driver.id)!;
    // On a circuit the final start-line crossing advances nextCheckpoint back to one.
    expect(driver.checkpoints, `${label} ${driver.id}: missing checkpoint`)
      .toBe(racer.mode === 'loop' ? 1 % report.totalCheckpoints : report.totalCheckpoints);
    expect(racer.lap).toBe(report.laps);
    expect(driver.resets, `${label} ${driver.id}: unexpected rescue`).toHaveLength(0);
  }
  await expectWorldLoaded(page, label);
  expect(report.renderQuality).toBe('high');
  expect(report.qualityLimits?.slimes).toBe(QUALITY_LIMITS.high.slimes);
  expect(report.slimes!.spawned).toBeGreaterThan(0);
}

test.beforeEach(async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, best: {},
  })));
});

for (const track of CATALOGUE) for (const { difficulty, human } of profiles) {
  test(`AI ${difficulty} full route ${track.id}`, { tag: '@version' }, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const label = `ai-${difficulty}-${track.id}`;
    await page.goto('/?dev=1&bot=1&speed=6'); await page.waitForFunction(() => window.game);
    expect(await page.evaluate(({ track, difficulty, human }) => window.game.startRace({
      trackId: track, car: 'sedan', playerVehicles: [human], ai: true, aiDifficulty: difficulty,
      slimeDensity: 'many',
    }), { track: track.id, difficulty, human })).toBe(true);
    const roster = await page.evaluate(() => window.game.session.racers.map(r => ({
      role: r.role, vehicle: r.vehicle.id, difficulty: r.difficulty,
    })));
    expect(roster.filter(r => r.role === 'ai').map(r => r.vehicle).sort())
      .toEqual(vehicles.filter(r => r.id !== human).map(r => r.id).sort());
    expect(roster.filter(r => r.role === 'ai').every(r => r.difficulty === difficulty)).toBe(true);
    await page.evaluate(() => (window.game as any).beginCountdown());
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    expect(await page.evaluate(() => window.game.timeScale)).toBe(6);
    expect(await page.evaluate(() => window.game.report().players[0]!.autopilot)).toBe(false);
    await page.waitForFunction(() => window.game.report().time > 2);
    await page.screenshot({ path: resolve(out, label + '-start.png'), animations: 'disabled' });
    await complete(page, label, 'ai');
    expect(await page.evaluate(() => window.game.report().phase)).toBe('racing');
    await page.waitForFunction(() => window.game.session.racers.filter(r => r.role === 'ai')
      .every(r => r.parkingState?.stopped && r.mesh.visible && r.car.body.isEnabled()
        && (!r.trailer || r.trailer.car.body.isEnabled())));
    writeFileSync(resolve(out, label + '-parking.json'), JSON.stringify(await snapshot(page), null, 2));
    expect(errors).toEqual([]);
    await page.evaluate(() => (window.game as any).quit());
    expect(await page.evaluate(() => window.game.report().phase)).toBe('menu');
  });
}

for (const track of [...CATALOGUE.map(r => r.id), ...SYNTHETIC]) {
  test(`two human bots finish full route ${track}`, { tag: '@version' }, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const label = `dual-${track}`;
    await page.goto('/?dev=1&bot=1&speed=6'); await page.waitForFunction(() => window.game);
    expect(await page.evaluate(trackId => window.game.startRace({ trackId, car: 'sedan',
      playerVehicles: ['micro-hatch', 'pickup-travel-trailer'], ai: false, slimeDensity: 'many',
    }), track)).toBe(true);
    await page.evaluate(() => {
      window.game.setAutopilot(0, true); window.game.setAutopilot(1, true);
      (window.game as any).beginCountdown();
    });
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    expect(await page.evaluate(() => window.game.timeScale)).toBe(6);
    expect(await page.evaluate(() => window.game.report().players.map(r => [r.role, r.autopilot])))
      .toEqual([['human', true], ['human', true]]);
    await page.waitForFunction(() => window.game.report().time > 3);
    await page.screenshot({ path: resolve(out, label + '-driving.png'), animations: 'disabled' });
    await complete(page, label, 'human');
    expect(await page.evaluate(() => window.game.report().phase)).toBe('results');
    await expect(page.locator('.result-player')).toHaveCount(2);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('silicon-rush-world-tour.save.v1')!).best)).toEqual({});
    expect(errors).toEqual([]);
  });
}
