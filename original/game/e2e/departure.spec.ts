import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOGUE } from '../src/app/tracks';
const out = evidencePath('departure');
test.beforeEach(() => mkdirSync(out, { recursive: true }));

for (const [index, route] of CATALOGUE.entries()) test(`departure details for ${route.id}`, async ({ page }) => {
  const language = index % 2 ? 'zh' : 'en';
  if (index % 2) await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(language => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ language })), language);
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(trackId => window.game.startRace({ trackId, car: 'sedan', slimeDensity: 'normal' }), route.id)).toBe(true);
  const intro = page.locator('[data-screen="intro"]');
  await expect(intro).toBeVisible();
  await expect(intro.locator('.departure-go')).toBeEnabled();
  await expect(intro.locator('.hud-map')).toBeVisible();
  await expect(intro.locator('.departure-source')).toHaveAttribute('href', /^https:\/\//);
  const facts = await intro.locator('.departure-details').innerText();
  expect(facts).toMatch(/预计|Estimated/); expect(facts).toMatch(/爬升|climbing/);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('intro');
  if (index === 0) {
    const source = intro.locator('.departure-source');
    await page.context().route((await source.getAttribute('href'))!, route => route.fulfill({ body: 'Source page' }));
    const opened = page.waitForEvent('popup');
    await source.focus(); await source.press('Enter');
    const popup = await opened; await popup.close();
    expect(await page.evaluate(() => window.game.report().phase)).toBe('intro');
  }
  await page.screenshot({ path: resolve(out, `${route.id}-${language}.png`) });
  writeFileSync(resolve(out, `${route.id}.json`), JSON.stringify({ language, facts, waitedForConfirmation: true }, null, 2));
});

test('loading cannot start, return cancels the old result, and dual players confirm the ready page', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/tracks/synth-p2p/track.json', async route => { await held; await route.continue(); });
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.evaluate(() => { void window.game.startRace({ trackId: 'synth-p2p', car: 'sedan', slimeDensity: 'normal' }); });
  const boot = page.locator('[data-screen="boot"]');
  await expect(boot).toBeVisible(); await expect(boot.locator('.departure-go')).toBeDisabled();
  await boot.locator('button').last().click();
  await expect(page.locator('[data-screen="menu"]')).toBeVisible();
  release();
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-loop', car: 'sedan', slimeDensity: 'normal',
    playerVehicles: ['micro-hatch', 'city-pod'], ai: false }))).toBe(true);
  expect(await page.evaluate(() => window.game.report().track)).toBe('synth-loop');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('intro');
  expect(await page.evaluate(() => window.game.report().players.length)).toBe(2);
  await page.locator('[data-screen="intro"] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 15_000 }).toBe('racing');
});

test('a direct load failure stays above home and retries the same route in place', async ({ page }) => {
  await page.route('**/tracks/synth-p2p/track.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('/?dev=1&track=synth-p2p');
  const boot = page.locator('[data-screen="boot"]');
  await expect(boot).toBeVisible();
  await expect(boot.locator('.departure-retry')).toBeVisible();
  await expect(boot.locator('.loading-bar')).toBeHidden();
  await page.screenshot({ path: resolve(out, 'route-failed.png') });
  await page.unroute('**/tracks/synth-p2p/track.json');
  await boot.locator('.departure-retry').click();
  await expect(page.locator('[data-screen="intro"]')).toBeVisible();
  expect(await page.evaluate(() => window.game.report().track)).toBe('synth-p2p');
  await page.locator('[data-screen="intro"] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 15_000 }).toBe('racing');
});
