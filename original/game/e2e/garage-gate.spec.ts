import { evidencePathOr } from './evidence';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';
import { driveBudgetGameSeconds } from './driveBudget';
import { CATALOGUE } from '../src/app/tracks';
import { checkMaximum } from '../test-support/resource-limit';

const { vehicles } = JSON.parse(readFileSync(resolve('src/vehicles/catalogue.json'), 'utf8')) as {
  vehicles: { id: string }[];
};
const output = evidencePathOr(process.env.GARAGE_OUTPUT, 'garage');
// Complete Golden Gate drives at fixed-step turbo; drive.spec retains the real-time stream proof.
test.describe.configure({ timeout: 240_000 });

const catalogue = JSON.parse(readFileSync(resolve('src/vehicles/catalogue.json'), 'utf8')) as {
  vehicles: { id: string; trailer?: { id: string } }[];
};
const heaviestDownload = catalogue.vehicles.map(vehicle => ({ id: vehicle.id,
  bytes: [vehicle, ...(vehicle.trailer ? [vehicle.trailer] : [])].reduce((sum, body) =>
    sum + readFileSync(resolve(`public/models/cars/${body.id}.glb`)).byteLength, 0) }))
  .sort((a, b) => b.bytes - a.bytes)[0]!;

for (const ai of [false, true]) for (const track of CATALOGUE) test(`reports cold menu to first drive: ${track.id} AI ${ai}`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    language: 'en', quality: 'high', muted: true, slimeDensity: 'normal', best: {},
  })));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const requests = new Map<string, { url: string; bytes: number; finished: boolean }>();
  cdp.on('Network.requestWillBeSent', event => requests.set(event.requestId,
    { url: event.request.url, bytes: 0, finished: false }));
  cdp.on('Network.responseReceived', event => {
    const request = requests.get(event.requestId);
    if (request) request.bytes = event.response.encodedDataLength;
  });
  cdp.on('Network.dataReceived', event => {
    const request = requests.get(event.requestId);
    if (request) request.bytes += event.encodedDataLength;
  });
  cdp.on('Network.loadingFinished', event => {
    const request = requests.get(event.requestId);
    if (request) { request.bytes = event.encodedDataLength; request.finished = true; }
  });
  await page.goto('/'); await page.locator('.home-go').click();
  await page.locator(`.sm-item[data-track="${track.id}"]`).click();
  await page.locator('.sm-go').click();
  // Made a new player start with the AI on, so a solo cold start has to say so out loud
  // rather than lean on the old default.
  await page.locator(`[data-ai-mode="${ai ? 'relaxed' : 'none'}"]`).click();
  await page.locator('.sm-go').click();
  if (ai) await page.locator('.startup-add-player').click();
  await page.locator(`[data-player="0"] [data-vehicle="${heaviestDownload.id}"]`).click();
  if (ai) {
    await page.locator(`[data-player="1"] [data-vehicle="${heaviestDownload.id}"]`).click();
  }
  await page.locator('.sm-go').click();
  await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await cdp.detach();
  expect(await page.evaluate(() => window.game.session.racers.length)).toBe(ai ? vehicles.length + 1 : 1);
  await expectWorldLoaded(page, `cold ${track.id}`);
  const completed = [...requests.values()];
  const bytes = completed.reduce((sum, request) => sum + request.bytes, 0);
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, `${track.id}${ai ? "-full-roster" : ""}-download.json`), JSON.stringify({
    vehicle: heaviestDownload, ai, humans: ai ? 2 : 1, bytes, requests: completed,
    inFlight: completed.filter(request => !request.finished).length,
  }, null, 2));
  expect(completed.length).toBeGreaterThan(20);
  expect(completed.some(request => request.url.includes(`${heaviestDownload.id}.glb`))).toBe(true);
  checkMaximum(bytes, 'first_drive_bytes', `${track.id} AI ${ai} cold menu to first drive`);
  console.log(`${track.id}: first drive ${bytes} bytes with ${heaviestDownload.id}`);
});

for (const vehicle of vehicles) test(`garage gate: ${vehicle.id} finishes Golden Gate${vehicle.id === 'school-bus' ? ' @long' : ''}`, async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    language: 'en', quality: 'high', muted: true, slimeDensity: 'normal', best: {},
  })));
  await page.goto(`/?track=goldengate&bot=1&dev=1&speed=6&vehicle=${vehicle.id}`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  let peakHitchGap = 0;
  while (true) {
    const report = await page.evaluate(() => window.game.report());
    peakHitchGap = Math.max(peakHitchGap, report.trailer?.hitchGap ?? 0);
    if (report.state === 'finished' || report.time > driveBudgetGameSeconds(report.length, report.laps)) {
      mkdirSync(output, { recursive: true });
      writeFileSync(resolve(output, `${vehicle.id}-goldengate${testInfo.repeatEachIndex ? `-${testInfo.repeatEachIndex}` : ''}.json`), JSON.stringify({ report, peakHitchGap }, null, 2));
      expect(report.state, JSON.stringify(report.resetLog)).toBe('finished');
      expect(report.vehicle).toBe(vehicle.id);
      expect(report.resets).toBe(0);
      expect(report.checkpoints).toBe(report.totalCheckpoints);
      expect(report.slimes!.spawned).toBeGreaterThan(0);
      expect(peakHitchGap).toBeLessThan(.15);
      await expectWorldLoaded(page, vehicle.id);
      console.log(`${vehicle.id} Golden Gate ${report.time.toFixed(1)}s, resets${report.resets}, hitch${peakHitchGap}`);
      break;
    }
    await page.waitForTimeout(500);
  }
});

test('six selected cars move in the real world and are shown in a comparison video', async ({ browser }) => {
  mkdirSync(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
    recordVideo: { dir: output, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const video = page.video()!;
  for (const vehicle of vehicles) {
    await page.goto(`/?track=shoreline&bot=1&dev=1&time=day&vehicle=${vehicle.id}`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    await page.evaluate(id => {
      const label = document.createElement('output'); label.textContent = id;
      Object.assign(label.style, { position: 'fixed', bottom: '70px', left: '35%', color: 'white',
        background: '#101820dd', padding: '12px', font: '22px sans-serif', zIndex: '999' });
      document.body.append(label);
    }, vehicle.id);
    // Circuit progress wraps at the start line; world displacement proves actual movement.
    const at = await page.evaluate(() => {
      const report = window.game.report(); return [report.posX, report.posZ];
    });
    await page.waitForFunction(([x, z]) => {
      const report = window.game.report();
      return Math.hypot(report.posX - x!, report.posZ - z!) > 35;
    }, at, { timeout: 15_000 });
    await expectWorldLoaded(page, `comparison ${vehicle.id}`);
    await page.screenshot({ path: resolve(output, `${vehicle.id}-road.png`) });
    const hits = await page.evaluate(() => {
      const game = window.game as any; const session = game.session;
      game.autopilot = false;
      const p = session.car.position.addScaledVector(session.car.forward, session.car.tuning.chassisHalf[2]);
      session.slimes.addTile('comparison-burst', [{ kind: 'burst', position: p.toArray(),
        scale: [.7, .7, .7], yaw: 0 }]);
      return session.slimes.stats.feedback.hits.burst;
    });
    await page.waitForFunction(before => window.game.report().slimes!.feedback.hits.burst > before, hits);
    await page.waitForTimeout(800);
  }
  // The roll proof belongs to the van, regardless of which model is last in the catalogue.
  await page.goto('/?track=shoreline&bot=1&dev=1&time=day&vehicle=retro-van');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'van over-limit roll');
  expect(await page.evaluate(() => window.game.session.vehicle.id)).toBe('retro-van');
  await page.evaluate(() => {
    const game = window.game as any; const car = game.session.car;
    game.autopilot = false;
    const label = document.createElement('output');
    label.textContent = '超限滚转扰动 / Over-limit roll pulse';
    document.body.append(label);
    const axis = car.forward;
    car.body.setLinvel({ x: 0, y: 3, z: 0 }, true);
    car.body.setAngvel({ x: axis.x * 12, y: 0, z: axis.z * 12 }, true);
  });
  await page.waitForFunction(() => {
    const game = window.game as any;
    if (game.session.car.upright >= 0) return false;
    game.phase = 'paused'; return true;
  }, null, { timeout: 5_000 });
  await page.screenshot({ path: resolve(output, 'van-over-limit.png') });
  await page.waitForTimeout(800);
  await page.evaluate(() => (window.game as any).restart());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  expect(await page.evaluate(() => window.game.session.car.upright)).toBeGreaterThan(.9);
  await context.close();
  await video.saveAs(resolve(output, 'six-cars.webm'));
  await video.delete();
});
