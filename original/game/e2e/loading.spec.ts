import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = evidencePath('loading');
test.use({ video: 'on' });

// The route loading screen shows a compact progress bar with a percentage, not a spinner: the player
// has to see at a glance that something is loading and roughly how far along it is.
for (const mobile of [false, true]) test(`loading progress bar is readable and moves on ${mobile ? 'phone' : 'desktop'}`, async ({ page }) => {
  mkdirSync(out, { recursive: true });
  if (mobile) await page.setViewportSize({ width: 844, height: 390 });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/tracks/synth-p2p/track.json', async route => { await held; await route.continue(); });
  await page.goto('/?dev=1&track=synth-p2p');
  const bar = page.locator('[data-screen="boot"] .loading-bar');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  if (mobile) expect(box.width).toBeGreaterThan(300);
  else expect(box.width).toBeCloseTo(420, 0);
  await expect(page.locator('[data-screen="boot"] [role="status"]')).toContainText(/Synthetic Sprint|合成点对点/);
  await expect(page.locator('[data-screen="boot"] .loading-percent')).toHaveText('0%');
  //The bar only fills from the left; no light or segment sweeps across it (that read as the
  // loading running twice), so nothing animates while it waits.
  expect(await bar.evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: resolve(out, mobile ? 'phone.png' : 'desktop.png') });
  const seen = new Set<number>();
  const sample = setInterval(() => {
    void bar.getAttribute('aria-valuenow').then(v => { if (v !== null) seen.add(Number(v)); }).catch(() => {});
  }, 50);
  release();
  await expect(page.locator('[data-screen="intro"]')).toBeVisible({ timeout: 20_000 });
  clearInterval(sample);
  expect(await bar.getAttribute('aria-valuenow')).toBe('100');
  // it climbed through intermediate values rather than jumping from nothing to done
  expect([...seen].filter(v => v > 0 && v < 100).length).toBeGreaterThan(1);
  await expect(bar).toBeHidden();
});
