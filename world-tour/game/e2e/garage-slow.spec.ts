import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { evidencePath } from './evidence';

// the player's own report: on a slow connection the garage's car card sat empty while the model
// downloaded, on entering the garage and on every pick. It now fills with its own progress bar inside the
// card -- never the full-screen loader -- and a car already downloaded comes up with no bar at all.
test.describe.configure({ timeout: 240_000 });
const out = evidencePath('garage-slow');

type Sample = { t: number; canvas: boolean; shown: boolean; value: string | null; indeterminate: boolean;
  text: string; fullScreen: boolean };
/** Poll the card every 100 ms until the model is up, recording what a player would see. */
async function watch(page: Page, vehicle: string, pick: () => Promise<unknown>, shot?: string): Promise<Sample[]> {
  await page.evaluate(vehicle => {
    const samples: unknown[] = [], start = performance.now();
    (window as any).samples = samples;
    const hero = document.querySelector<HTMLElement>('[data-player="0"] .sm-carhero')!;
    const tick = () => {
      const progress = hero.querySelector<HTMLElement>('.sm-model-progress')!;
      const loader = [...document.querySelectorAll<HTMLElement>('.departure-progress')].some(n => n.offsetParent !== null);
      samples.push({ t: performance.now() - start, canvas: !!hero.querySelector('canvas'),
        shown: hero.dataset.progress === 'shown' && getComputedStyle(progress).display !== 'none',
        value: progress.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'),
        indeterminate: progress.dataset.indeterminate === 'true',
        text: hero.querySelector('.sm-model-message')!.textContent, fullScreen: loader });
      // Until the picked car is up: on a switch the old car is still ready when sampling starts.
      if (!(hero.dataset.modelVehicle === vehicle && hero.dataset.state === 'ready')) setTimeout(tick, 100);
      else (window as any).sampled = true;
    };
    (window as any).sampled = false;
    tick();
  }, vehicle);
  await pick();
  if (shot) {
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-player="0"] .sm-carhero')!.dataset.progress === 'shown');
    await page.waitForTimeout(400);
    await page.locator('[data-player="0"] .sm-carhero').screenshot({ path: resolve(out, shot) });
  }
  await page.waitForFunction(() => (window as any).sampled, null, { timeout: 120_000 });
  return page.evaluate(() => (window as any).samples);
}

function expectProgressUntilReady(samples: Sample[], label: string) {
  // Sampling starts just before the pick, so on a switch the old car is still up for a sample or two.
  const gone = samples.findIndex(s => !s.canvas);
  const ready = samples.findIndex((s, i) => i > gone && s.canvas);
  const start = samples[gone]!.t;
  const waiting = samples.slice(gone, ready < 0 ? samples.length : ready).map(s => ({ ...s, t: s.t - start }));
  // Positive control: the throttle made this download take long enough to matter.
  expect(waiting.at(-1)!.t, label + ': the download took a while').toBeGreaterThan(1000);
  const late = waiting.filter(s => s.t > 400);
  expect(late.filter(s => !s.shown), label + ': every moment after the first 0.4 s shows the bar').toEqual([]);
  expect(samples.filter(s => s.fullScreen), label + ': no full-screen loader').toEqual([]);
  const values = late.filter(s => !s.indeterminate).map(s => Number(s.value));
  // The served file declares its length, so the bar shows real bytes rather than only sliding.
  expect(values.length, label + ': the bar shows a real fraction').toBeGreaterThan(0);
  expect(values, label + ': the bar only moves forward').toEqual([...values].sort((a, b) => a - b));
  return { waited: Math.round(waiting.at(-1)!.t), determinate: values.length, of: late.length, last: values.at(-1) };
}

for (const language of ['zh', 'en'] as const) test(`slow network (3 Mbps): the car card shows its own progress, ${language}`, async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(language => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ language, muted: true })), language);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60,
    downloadThroughput: 3 * 125_000, uploadThroughput: 3 * 125_000 });
  await page.goto('/');
  await page.locator('.home-go').click({ timeout: 120_000 });
  await page.locator('.sm-go').click();
  const entering = await watch(page, 'micro-hatch', () => page.locator('.sm-go').click(), `${language}-entering.png`);
  const first = expectProgressUntilReady(entering, 'entering the garage');
  expect(entering.find(s => s.shown)!.text).toBe(language === 'zh' ? '正在加载车辆…' : 'Loading vehicle…');
  await page.locator('[data-player="0"] .sm-carhero').screenshot({ path: resolve(out, `${language}-ready.png`) });
  const switching = await watch(page, 'monster-truck', () => page.locator('[data-player="0"] [data-vehicle="monster-truck"]').click(), `${language}-switching.png`);
  const second = expectProgressUntilReady(switching, 'switching cars');
  // Back to a car already downloaded: only decoding is left, so no bar at all, or a blink.
  const back = await watch(page, 'micro-hatch', () => page.locator('[data-player="0"] [data-vehicle="micro-hatch"]').click());
  expect(back.filter(s => s.shown).length, 'a downloaded car shows at most a blink of the bar').toBeLessThanOrEqual(2);
  console.log(JSON.stringify({ language, first, second, cachedSamplesShown: back.filter(s => s.shown).length }));
});
