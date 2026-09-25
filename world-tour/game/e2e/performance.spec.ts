import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { expectWorldLoaded } from './world';
import { CATALOGUE } from '../src/app/tracks';
import { captureFrames, rendererFacts, reportDesktopFrames, SOFTWARE_RENDERER, type FrameSample } from './frame-sample';
import { RESOURCE_LIMITS, checkMaximum, checkMinimum } from '../test-support/resource-limit';
import { driveBudgetGameSeconds } from './driveBudget';

/**
 * The real-GPU version gate. Run it visibly, on the machine being certified:
 *
 *   npm run performance
 *   PERF_TRACK=sydney npm run performance
 *   PERF_TRACK=sydney npm run performance:phone
 *
 * Ordinary Playwright uses SwiftShader so screenshots are deterministic. This spec refuses that
 * renderer, opens a Metal browser (PERF_HEADLESS=1 avoids focus changes), scans at 4x to find three separated
 * heavy places, and samples the player's requestAnimationFrame loop there at both quality levels.
 */
test.describe.configure({ timeout: 600_000, mode: 'serial' });
const REAL_GPU = process.env.PERF_REAL_GPU === '1';
test.skip(!REAL_GPU, 'run through `npm run performance`; ordinary runs do not assert performance numbers');

const ROUTES = CATALOGUE.map(track => track.id);
const TRACKS = process.env.PERF_TRACK ? [process.env.PERF_TRACK] : ROUTES;
const OUT = evidencePath();
const PERF_DIR = resolve(OUT, 'performance');
const PHONE_PERF_DIR = resolve(OUT, 'performance-phone');
const LIGHT_DIR = resolve(OUT, 'lighting');
const SAVE_KEY = 'silicon-rush-world-tour.save.v1';
const SAMPLE_MS = 6_000;
const TILE_RETRIES = 3;


type Quality = 'high' | 'medium' | 'low';
type TimeOfDay = 'day' | 'night';
type ProfileName = 'desktop' | 'local-phone-load';
type SlimeDensity = 'none' | 'normal' | 'many';

const requestedDensity = process.env.PERF_SLIME_DENSITY ?? 'normal';
if (!['none', 'normal', 'many'].includes(requestedDensity)) {
  throw new Error(`PERF_SLIME_DENSITY must be none, normal or many, got ${requestedDensity}`);
}
const SLIME_DENSITY = requestedDensity as SlimeDensity;
const requestedTime = process.env.PERF_TIME;
if (requestedTime !== undefined && requestedTime !== 'day' && requestedTime !== 'night') {
  throw new Error(`PERF_TIME must be day or night, got ${requestedTime}`);
}
const PERF_TIME: TimeOfDay | undefined = requestedTime;

interface PerfProfile {
  name: ProfileName;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  cpuThrottleRate: number;
  renderPassesPerFrame: number;
  output: string;
}

const requestedProfile = process.env.PERF_PROFILE ?? 'desktop';
if (requestedProfile !== 'desktop' && requestedProfile !== 'phone') {
  throw new Error(`PERF_PROFILE must be desktop or phone, got ${requestedProfile}`);
}
const PROFILE: PerfProfile = requestedProfile === 'phone' ? {
  name: 'local-phone-load',
  // Landscape is the certification posture: it matches driving controls and exposes more roadside
  // scene at once than portrait. Portrait shows the rotation gate; driving is landscape only.
  viewport: { width: 932, height: 430 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  // Four times slower than this M4 is deliberately conservative for a current high-end phone's
  // main-thread budget. Four complete scene passes per displayed frame apply the same safety factor
  // to fragment, vertex and submission work on the real Metal GPU, rather than pretending a mobile
  // viewport by itself has turned an M4 into a phone.
  cpuThrottleRate: 4,
  renderPassesPerFrame: 4,
  output: PHONE_PERF_DIR,
} : {
  name: 'desktop',
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
  isMobile: false,
  hasTouch: false,
  cpuThrottleRate: 1,
  renderPassesPerFrame: 1,
  output: PERF_DIR,
};

const requestedQualities = (process.env.PERF_QUALITIES ?? 'high,low').split(',');
const QUALITIES = requestedQualities.map((quality) => {
  if (quality !== 'high' && quality !== 'medium' && quality !== 'low') {
    throw new Error(`PERF_QUALITIES must contain only high, medium or low, got ${quality}`);
  }
  return quality;
});


interface QualityRun {
  quality: Quality;
  canvas: { width: number; height: number };
  shadows: boolean;
  antialias: boolean;
  samples: FrameSample[];
  minimumFps: number;
  worstP95Ms: number;
}

async function openWorld(browser: Browser, track: string, quality: Quality,
                         time: TimeOfDay | undefined = PERF_TIME, speed = 1): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: PROFILE.viewport,
    deviceScaleFactor: PROFILE.deviceScaleFactor,
    isMobile: PROFILE.isMobile,
    hasTouch: PROFILE.hasTouch,
  });
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SAVE_KEY,
    value: { version: 2, language: 'en', quality, volume: 0, muted: true,
      slimeDensity: SLIME_DENSITY, best: {} },
  });
  const page = await context.newPage();
  if (PROFILE.cpuThrottleRate > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: PROFILE.cpuThrottleRate });
  }
  await page.goto(`/?track=${track}&bot=1&speed=${speed}${time ? `&time=${time}` : ''}`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null,
    { timeout: 90_000 });
  await expectWorldLoaded(page, `${track} ${quality}${time ? ` ${time}` : ''}`);
  if (PROFILE.isMobile) {
    await page.touchscreen.tap(Math.round(PROFILE.viewport.width * 0.25),
      Math.round(PROFILE.viewport.height * 0.7));
    await page.waitForFunction(() => window.game.report().input.device === 'touch', null,
      { timeout: 10_000 });
  }
  return { context, page };
}

async function pause(page: Page): Promise<void> {
  if (await page.evaluate(() => window.game.report().phase === 'racing')) {
    if (PROFILE.isMobile) await page.locator('.hud-pause').tap();
    else await page.keyboard.press('Escape');
  }
  await page.waitForFunction(() => window.game.report().phase === 'paused', null,
    { timeout: 10_000 });
}

async function resume(page: Page): Promise<void> {
  if (PROFILE.isMobile) await page.getByRole('button', { name: 'Resume' }).tap();
  else await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.game.report().phase === 'racing', null,
    { timeout: 10_000 });
  if (PROFILE.isMobile) {
    await page.waitForFunction(() => window.game.report().input.device === 'touch', null,
      { timeout: 10_000 });
  }
}

async function settle(page: Page, at: number): Promise<void> {
  const ask = async (clear: boolean) => {
    await page.evaluate(([s, first]: number[]) => {
      const w = window.game.session.world;
      if (first) w.streamer.clear();
      const p = w.spline.point(w.spline.indexAt(s!));
      w.follow(s!, p[0]!, p[1]!, p[2]!);
    }, [at, clear ? 1 : 0]);
    await page.waitForFunction(
      () => (window.game.report().tiles?.loading ?? 1) === 0
        && (!window.game.session.track.backdrop || window.game.session.world.backdrop.ready),
      null, { timeout: 120_000, polling: 100 });
    return page.evaluate(() => window.game.report().tiles?.loaded ?? 0);
  };
  let previous = -1;
  for (let round = 0; round < 40; round++) {
    const loaded = await ask(round === 0);
    if (loaded !== previous) { previous = loaded; continue; }
    for (let retry = 0; retry < TILE_RETRIES; retry++) await ask(false);
    return;
  }
  throw new Error(`${at} m never settled (${previous} tiles)`);
}

async function hottestPlaces(browser: Browser, track: string): Promise<number[]> {
  // Selection is a separate 4x drive, never the benchmark: every live frame can nominate a place,
  // while the measurements below run at the player's real 1x physics load.
  const { context, page } = await openWorld(browser, track, 'high', undefined, 4);
  expect((await rendererFacts(page)).renderer,
    'hotspot discovery must use the machine GPU, not Playwright software rendering')
    .not.toMatch(SOFTWARE_RENDERER);
  const costs: { at: number; triangles: number; drawCalls: number }[] = [];
  const route = await page.evaluate(() => window.game.report());
  const scanBudget = Math.max(180_000, driveBudgetGameSeconds(route.length, route.laps) / 4 * 1000);
  test.setTimeout(Math.max(600_000, scanBudget + 420_000));
  const deadline = Date.now() + scanBudget;
  while (Date.now() < deadline) {
    const sample = await page.evaluate(() => {
      const w = window.game.session.world;
      const report = window.game.report();
      return { at: Math.round(report.progress), triangles: w.renderer.info.render.triangles,
        drawCalls: w.renderer.info.render.calls, done: report.state === 'finished' };
    });
    costs.push(sample);
    if (sample.done) break;
    await page.waitForTimeout(100);
  }
  expect(await page.evaluate(() => window.game.report().state), `${track} hotspot discovery finished`)
    .toBe('finished');
  await expectWorldLoaded(page, `${track} after hotspot discovery`);
  await context.close();

  costs.sort((a, b) => b.drawCalls - a.drawCalls || b.triangles - a.triangles);
  const selected: typeof costs = [];
  for (const sample of costs) {
    if (selected.every((other) => Math.abs(other.at - sample.at) >= 200)) selected.push(sample);
    if (selected.length === 3) break;
  }
  expect(selected.length, `${track} has three distinct heavy places`).toBe(3);
  return selected.map((s) => s.at).sort((a, b) => a - b);
}


async function putCar(page: Page, at: number): Promise<void> {
  await page.evaluate((s) => {
    const g = window.game;
    const w = g.session.world;
    const i = w.spline.indexAt(s);
    const p = w.spline.point(i);
    const t = w.spline.tangent(i);
    g.session.car.reset([p[0], p[1] + 0.8, p[2]], Math.atan2(-t[0], -t[2]));
    g.session.race.reacquire(p[0], p[2]);
    g.session.chase.reset();
    g.session.bot.reset();
    w.follow(s, p[0], p[1], p[2]);
  }, at);
}

async function sampleFrames(page: Page, at: number): Promise<FrameSample> {
  await settle(page, at);
  await expectWorldLoaded(page, `${at} m after hotspot reload`);
  await putCar(page, at);
  await resume(page);
  await page.waitForTimeout(1_000);
  const sample = await captureFrames(page, at, SAMPLE_MS, PROFILE.renderPassesPerFrame);
  await pause(page);
  return sample;
}

async function runQuality(browser: Browser, track: string, quality: Quality,
                          hotspots: number[]): Promise<{ run: QualityRun; facts: Awaited<ReturnType<typeof rendererFacts>> }> {
  const { context, page } = await openWorld(browser, track, quality);
  await pause(page);
  const facts = await rendererFacts(page);
  expect(facts.renderer, 'this must be the machine GPU, not Playwright software rendering')
    .not.toMatch(SOFTWARE_RENDERER);
  const samples: FrameSample[] = [];
  for (const at of hotspots) samples.push(await sampleFrames(page, at));
  const canvas = await page.evaluate(() => ({
    width: window.game.session.world.renderer.domElement.width,
    height: window.game.session.world.renderer.domElement.height,
  }));
  const shadows = await page.evaluate(() => window.game.session.world.renderer.shadowMap.enabled);
  const antialias = await page.evaluate(() =>
    window.game.session.world.renderer.getContext().getContextAttributes()?.antialias ?? false);
  await context.close();
  return {
    facts,
    run: {
      quality, canvas, shadows, antialias, samples,
      minimumFps: Math.min(...samples.map((s) => s.fps)),
      worstP95Ms: Math.max(...samples.map((s) => s.p95Ms)),
    },
  };
}

async function lightShot(browser: Browser, track: string, time: TimeOfDay, at: number): Promise<void> {
  const { context, page } = await openWorld(browser, track, 'high', time);
  await pause(page);
  await settle(page, at);
  await expectWorldLoaded(page, `${track} ${time} lighting shot`);
  // Read in the same browser turn that draws. WebGL does not preserve its drawing buffer, so a
  // later evaluate sees a correctly rendered frame that has already been cleared to black.
  const shot = await page.evaluate((s) => {
    const w = window.game.session.world;
    const i = w.spline.indexAt(s);
    const p = w.spline.point(i);
    const t = w.spline.tangent(i);
    w.camera.position.set(p[0] - t[0] * 9, p[1] + 3.2, p[2] - t[2] * 9);
    w.camera.lookAt(p[0] + t[0] * 40, p[1] + 1, p[2] + t[2] * 40);
    w.camera.fov = 62;
    w.camera.updateProjectionMatrix();
    w.camera.updateMatrixWorld(true);
    w.render();
    const canvas = w.renderer.domElement;
    const gl = w.renderer.getContext();
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 9) lit++;
    }
    return { png: canvas.toDataURL('image/png'), litPct: lit / (pixels.length / 4) * 100 };
  }, at);
  expect(shot.litPct, `${track} ${time} screenshot is not a cleared WebGL buffer`).toBeGreaterThan(1);
  writeFileSync(resolve(LIGHT_DIR, `${track}-${time}.png`), Buffer.from(shot.png.split(',')[1]!, 'base64'));
  await context.close();
}

for (const track of TRACKS) {
  test(`${track} holds frame rate at its three heaviest sampled places`, async ({ browser }) => {
    mkdirSync(PROFILE.output, { recursive: true });
    const hotspots = await hottestPlaces(browser, track!);
    const measured: { run: QualityRun; facts: Awaited<ReturnType<typeof rendererFacts>> }[] = [];
    for (const quality of QUALITIES) measured.push(await runQuality(browser, track!, quality, hotspots));
    const runs = Object.fromEntries(measured.map((entry) => [entry.run.quality, entry.run])) as
      Partial<Record<Quality, QualityRun>>;
    if (PROFILE.name === 'desktop') {
      mkdirSync(LIGHT_DIR, { recursive: true });
      await lightShot(browser, track!, 'day', hotspots[0]!);
      await lightShot(browser, track!, 'night', hotspots[0]!);
    }

    const facts = measured[0]!.facts;
    writeFileSync(resolve(PROFILE.output, `${track}.json`), JSON.stringify({
      recorded: new Date().toISOString().slice(0, 10),
      machine: { ...facts },
      profile: {
        name: PROFILE.name,
        viewport: PROFILE.viewport,
        deviceScaleFactor: PROFILE.deviceScaleFactor,
        orientation: PROFILE.name === 'desktop' ? 'landscape-desktop' : 'landscape-phone',
        isMobile: PROFILE.isMobile,
        hasTouch: PROFILE.hasTouch,
        cpuThrottleRate: PROFILE.cpuThrottleRate,
        renderPassesPerFrame: PROFILE.renderPassesPerFrame,
        emulated: PROFILE.name !== 'desktop',
        claim: PROFILE.name === 'desktop' ? 'measured host desktop' : 'local conservative load profile',
        gpu: 'host real GPU',
        headless: process.env.PERF_HEADLESS === '1',
        slimeDensity: SLIME_DENSITY,
        timeOfDay: PERF_TIME ?? 'track-default',
      },
      targets: { desktopHighFps: RESOURCE_LIMITS.desktop_min_fps,
        phoneLowFps: RESOURCE_LIMITS.phone_min_fps },
      track, hotspots, qualities: QUALITIES, runs,
    }, null, 2) + '\n');
    console.log(track, JSON.stringify({ profile: PROFILE.name, renderer: facts.renderer,
      fps: Object.fromEntries(measured.map((entry) => [entry.run.quality, entry.run.minimumFps])), hotspots }));

    for (const entry of measured) {
      expect(entry.facts.renderer).not.toMatch(SOFTWARE_RENDERER);
      const quality = entry.run.quality;
      const ratio = quality === 'high' ? 1.5 : quality === 'medium' ? 1.25 : 1;
      expect(entry.run.canvas, `${quality} uses its pixel-ratio cap`).toEqual({
        width: Math.floor(PROFILE.viewport.width * ratio),
        height: Math.floor(PROFILE.viewport.height * ratio),
      });
      expect(entry.run.shadows, `${quality} shadow tier`).toBe(quality !== 'low');
      expect(entry.run.antialias, `${quality} antialias tier`).toBe(quality !== 'low');
    }

    if (PROFILE.name === 'desktop') {
      for (const entry of measured) {
        reportDesktopFrames(entry.run.minimumFps, entry.run.worstP95Ms, `${track} desktop ${entry.run.quality} quality`);
      }
    } else {
      expect(facts.userAgent, 'local phone load keeps the honest host browser UA').toContain('Macintosh');
      for (const entry of measured) {
        checkMinimum(entry.run.minimumFps, 'phone_min_fps', `${track} phone-profile ${entry.run.quality} quality`);
        checkMaximum(entry.run.worstP95Ms, 'phone_max_p95_ms', `${track} phone-profile ${entry.run.quality} quality p95`);
      }
    }
  });
}
