import { expect, test, type Page } from '@playwright/test';
import type { GameReport } from '../src/app/Game';
import { CATALOGUE, SYNTHETIC } from '../src/app/tracks';
import { driveBudgetGameSeconds } from './driveBudget';
import { QUALITY_LIMITS } from '../src/world/quality';


// 这个文件真的要开车，所以自己申请预算：默认档是 90 秒（playwright.config.ts），
// 那是「问浏览器一个问题」的价钱。十一条路线，多数六倍 turbo，金门大桥那条是实时的：
// 三分钟驾驶加加载。Turbo 每一帧多跑完整的 60 Hz 固定步，不把物理步长改粗。
test.describe.configure({ timeout: 600_000 });
const read = (page: Page) => page.evaluate(() => window.game.report());

/** Drive until the race finishes or its simulated-time budget runs out. */
async function driveToFinish(page: Page, budgetGameSeconds: number, label = ''): Promise<GameReport> {
  let last: GameReport = await read(page);
  let announced = 0;
  while (last.time < budgetGameSeconds) {
    await page.waitForTimeout(500);
    last = await read(page);
    if (last.state === 'finished' || last.phase === 'results') return last;
    // A heartbeat, so a slow run and a wedged one look different in the log. Without it the only
    // signal either way is silence, and silence is what a hang looks like too.
    const elapsed = Math.floor(last.time / 30);
    if (elapsed > announced) {
      announced = elapsed;
      console.log(`  ${label || 'driving'}: ${(elapsed * 0.5).toFixed(1)} min, `
        + `${last.progress.toFixed(0)}/${last.length.toFixed(0)} m, lap ${last.lap}, `
        + `${last.tiles?.loaded ?? 0} tiles, ${last.resets} resets`);
    }
    // Race owns the semantic stuck rules and records any recovery in resetLog. The test must not
    // invent a second one from projected progress: a car can still be moving at road speed while
    // the nearest-point projection holds at a tight seam. The simulated-time budget below decides
    // whether the drive completed; Playwright's outer timeout only catches a dead browser loop.
  }
  return last;
}

test.describe('the automated driver', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      version: 1, language: 'en', quality: 'high', volume: 0, muted: true,
      obstacles: true, best: {},
    })));
    page.on('console', (m) => { if (m.type() === 'error') console.error('page error:', m.text()); });
    page.on('pageerror', (e) => { throw e; });
  });

  for (const track of [...SYNTHETIC, ...CATALOGUE.map((entry) => entry.id)
    .filter((id) => id !== 'goldengate')]) {
    test(`finishes ${track}`, track === 'bayshore-101' ? { tag: '@long' } : {}, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      // The explicitly requested 64.8 km full-US exception owns one worker after the ordinary
      // suite. Twelve fixed steps per wall step reduce rendering overhead without coarsening physics.
      const timeScale = track === 'bayshore-101' ? 12 : 6;
      await page.goto(`/?track=${track}&bot=1&dev=1&speed=${timeScale}`);
      await page.waitForFunction(() => window.game?.report().track != null, null, { timeout: 60_000 });
      expect(await page.evaluate(() => window.game.timeScale)).toBe(timeScale);
      // Realistic classic-car power (183) makes long hill routes slower. Allow an average
      // 10 m/s plus 30 s for launch/turns; recovery and completion assertions remain strict.
      const route = await read(page);
      const budget = driveBudgetGameSeconds(route.length, route.laps);
      test.setTimeout(Math.max(600_000, budget / timeScale * 1000 + 120_000));
      const report = await driveToFinish(page, budget, track);
      // every assertion names what actually went wrong: a run that fails once and passes on retry
      // is only useful if the failure said which of these it was
      const where = `${report.progress.toFixed(0)}/${report.length.toFixed(0)} m, `
        + `${report.time.toFixed(1)}s, ${report.resets} resets ${JSON.stringify(report.resetLog)}, `
        + `${report.tiles?.failed ?? 0} tiles failed`;
      expect(report.state, where).toBe('finished');
      expect(report.resets, `the route needed a recovery: ${where}`).toBe(0);
      expect(report.tiles?.failed ?? 0, `tiles failed to load: ${where}`).toBe(0);
      expect(report.slimes?.spawned ?? 0, `the streamed route has no slimes: ${where}`).toBeGreaterThan(0);
      expect(report.renderQuality, `not the maximum-density tier: ${where}`).toBe('high');
      expect(report.qualityLimits?.slimes, `wrong slime ceiling: ${where}`).toBe(QUALITY_LIMITS.high.slimes);
      expect(report.slimes?.colossusEntries, `the bot never entered the route's mandatory colossus: ${where}`)
        .toBeGreaterThan(0);
      expect(report.slimes?.colossusExits, `an accidental giant entry never exited: ${where}`)
        .toBe(report.slimes?.colossusEntries);
      // Mandatory colossus and burst entries deliberately lift the car; a quarter of the run still
      // leaves most frames grounded while allowing the authored slime interaction to be visible.
      expect(report.airbornePct, `too much air: ${where}`).toBeLessThan(25);
      expect(errors, `console errors: ${where}\n${errors.join('\n')}`).toHaveLength(0);
      console.log(`${track}: ${report.time.toFixed(1)}s, ${report.resets} resets, `
        + `${report.airbornePct.toFixed(1)}% airborne, ${report.tiles?.loaded} tiles`);
    });
  }

  // Keep an explicit real-time recording path for release evidence. The recurring suite drives
  // this route at six times simulation speed with every production car, which is the stricter tile
  // streaming load and already protects completion, scenery, checkpoints and zero recovery.
  test('finishes the whole of Golden Gate with the scenery loaded', { tag: '@version' }, async ({ page }) => {
    test.skip(process.env.REALTIME_ROUTE_QA !== '1',
      'explicit real-time streaming evidence; turbo route and seven-car Golden Gate gates are recurring');
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/?track=goldengate&bot=1');
    await page.waitForFunction(() => window.game?.report().track != null, null, { timeout: 120_000 });
    expect(await page.evaluate(() => window.game.timeScale)).toBe(1);
    const route = await read(page);
    const budget = driveBudgetGameSeconds(route.length, route.laps);
    // A real-time run can share the machine with the turbo cases above. Keep its simulation budget
    // unchanged, but let wall time absorb renderer contention instead of dying metres before goal.
    test.setTimeout(Math.max(600_000, budget * 1000 + 120_000));
    const report = await driveToFinish(page, budget, 'goldengate');
    expect(report.state, `progress ${report.progress.toFixed(0)}/${report.length.toFixed(0)} m`).toBe('finished');
    expect(report.checkpoints).toBe(report.totalCheckpoints);
    expect(report.resets, 'the real-time Golden Gate run must not use recovery').toBe(0);
    expect(report.tiles?.failed ?? 0).toBe(0);
    expect(report.slimes?.spawned ?? 0, 'the streamed Golden Gate route has no slimes').toBeGreaterThan(0);
    expect(report.renderQuality).toBe('high');
    expect(report.qualityLimits?.slimes).toBe(QUALITY_LIMITS.high.slimes);
    expect(report.slimes?.colossusEntries, 'the Golden Gate bot never entered the route\'s mandatory colossus')
      .toBeGreaterThan(0);
    expect(report.slimes?.colossusExits, 'an accidental Golden Gate giant entry never exited')
      .toBe(report.slimes?.colossusEntries);
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.log(`goldengate: ${report.time.toFixed(1)}s, ${report.resets} resets, `
      + `${report.airbornePct.toFixed(1)}% airborne, ${report.tiles?.loaded} tiles loaded`);
  });
});

test('shows a result and remembers the best time', async ({ page }) => {
  await page.goto('/?track=synth-p2p&bot=1&dev=1&speed=6');
  await page.waitForFunction(() => window.game?.report().track != null, null, { timeout: 60_000 });
  const first = await driveToFinish(page, 300);
  expect(first.state).toBe('finished');

  // the results screen names the track and the time, and offers a way back
  await expect(page.locator('[data-screen=results] .result-track')).toHaveText(/Synthetic Sprint|合成点对点/, { timeout: 10_000 });
  const time = await page.locator('[data-screen=results] .card-stats b').first().textContent();
  expect(time).toMatch(/^\d+:\d{2}\.\d{2}$/);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('silicon-rush.save.v1') ?? 'null'));
  // Records are the car's own; the replay lives in IndexedDB, not in this JSON.
  expect(saved.best['synth-p2p@micro-hatch']).toBeGreaterThan(0);
  expect(Math.abs(saved.best['synth-p2p@micro-hatch'] - first.time)).toBeLessThan(0.5);
  expect(saved.ghosts).toBeUndefined();

  // and on the way back the menu shows it. The best time lives on the stage beside the selected
  // route now, not as a note inside a list row -- picking the route is what shows it.
  await page.goto('/?dev=1');
  await page.locator('.home-go').click({ timeout: 15_000 });
  await page.locator('.sm-item', { hasText: /Synthetic Sprint|合成点对点/ }).click({ timeout: 15_000 });
  // The route block's last stat is the best time (`StartScreen.ts` fills it km, checkpoints,
  // best). Matched by position, not by its label -- that reads 「最好成绩」 or a lowercase "best"
  // depending on the browser's language. `.first()` on the block matters: the car pane has a
  // `.sm-stats` of its own, and without it this picked the car's mass, 1250.
  const best = page.locator('.sm-stats').first().locator('.sm-stat').last().locator('b');
  await expect(best).toBeVisible();
  await expect(best).toHaveText(/^\d+:\d{2}\.\d{2}$/, { timeout: 10_000 });
});

test('manual and upside-down reset logs keep the pre-reset location', async ({ page }) => {
  await page.goto('/?track=synth-p2p&bot=1&dev=1&speed=4');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 60_000 });
  await page.waitForFunction(() => window.game.report().progress > 250);
  const beforeManual = await page.evaluate(() => window.game.report().progress);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.game.report().resets === 1);
  const manual = await page.evaluate(() => window.game.report().resetLog[0]!);
  expect(manual.reason).toBe('manual');
  expect(Math.abs(manual.progress - beforeManual)).toBeLessThan(40);
  expect(manual).not.toHaveProperty('lateral');

  await page.waitForFunction(() => window.game.report().progress > 120);
  const beforeUpsideDown = await page.evaluate(() => {
    const game = window.game as any;
    const car = game.session.car;
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setEnabledRotations(false, false, false, true);
    car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    return window.game.report().progress;
  });
  await page.waitForFunction(() => window.game.report().resets === 2, null, { timeout: 20_000 });
  const upsideDown = await page.evaluate(() => window.game.report().resetLog[1]!);
  expect(upsideDown.reason).toBe('upside-down');
  expect(Math.abs(upsideDown.progress - beforeUpsideDown)).toBeLessThan(40);
  expect(upsideDown).not.toHaveProperty('lateral');
});
