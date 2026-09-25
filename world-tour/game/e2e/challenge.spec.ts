import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeChallenge } from '../src/app/Challenge';
import { evidencePath } from './evidence';

/** Open a friend's link, see the dare, race it, see the result against it, and pass a new one on. */
const OUT = evidencePath('challenge');
test.describe.configure({ timeout: 240_000 });

test('a challenge link lands on the route, the run is compared, and the copied text carries the next dare', async ({ page, context }) => {
  mkdirSync(OUT, { recursive: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');
    localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ version: 1, language: 'en', volume: 0, muted: true, best: {} })); } });

  // A tampered code is an ordinary visit: no banner, no crash.
  const dare = encodeChallenge({ trackId: 'synth-loop', direction: 'forward', time: 9999, rating: 3, score: 1234, name: 'Mia', vehicleId: 'micro-hatch' });
  await page.goto(`/?dev=1&bot=1&speed=8&challenge=${encodeURIComponent(dare.replace('Mia', 'Max'))}`);
  await page.waitForFunction(() => window.game?.report().phase === 'menu');
  await expect(page.locator('.sm-challenge')).toBeHidden();

  await page.goto(`/?dev=1&bot=1&speed=8&challenge=${encodeURIComponent(dare)}`);
  const banner = page.locator('.sm-challenge');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Mia');
  await expect(banner).toContainText('Beat it');
  await expect(banner, 'the dare names its car').toContainText("Sedan");
  await page.waitForTimeout(1200);                     // let the menu finish fading in before the picture
  await page.screenshot({ path: resolve(OUT, 'banner-en.png') });
  await banner.getByRole('button', { name: 'Take the challenge' }).click();
  await page.waitForFunction(() => ['intro', 'countdown', 'racing'].includes(window.game.report().phase), null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.game.report().track)).toBe('synth-loop');
  await page.evaluate(() => { const game = window.game as any; game.autopilot = true; if (game.phase === 'intro') game.beginCountdown(); });
  await page.waitForFunction(() => window.game.report().phase === 'results', null, { timeout: 200_000 });

  const invitation = page.locator('[data-screen=results] [data-challenge]');
  await expect(invitation).toHaveAttribute('data-challenge', 'beat');
  await expect(invitation).toContainText("You beat Mia's Sedan run by");
  await page.screenshot({ path: resolve(OUT, 'results-en.png') });
  await page.getByRole('button', { name: 'Copy text card', exact: true }).click();
  await expect(page.locator('[data-screen=results] [role=status]')).toContainText('copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text, 'the shared dare names the car it was driven in').toMatch(/Beat my \d+:\d\d\.\d\d on Synthetic Loop in the \S/);
  // This build knows no embed address, and itch's store page drops queries, so the copied
  // link is the plain game page; a build with VITE_PUBLIC_ASSET_ORIGIN carries the code (unit-tested).
  expect(text, 'no promise of a challenge box the store page cannot open').not.toContain('challenge=');
  const next = await page.evaluate(() => (window.game as any).lastResult);
  const code: string = next.challengeCode;
  expect(code, text).toMatch(/^SSC1~/);

  // The dare opens for the next person, in their language, with this run's numbers.
  await page.evaluate(() => { const save = JSON.parse(localStorage.getItem('silicon-rush-world-tour.save.v1')!); save.language = 'zh'; localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify(save)); });
  await page.goto(`/?dev=1&challenge=${encodeURIComponent(code!)}`);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(next.time >= 60 ? `${Math.floor(next.time / 60)}:` : '');
  await page.screenshot({ path: resolve(OUT, 'banner-zh.png') });
  await banner.locator('.sm-challenge-dismiss').click();
  await expect(banner).toBeHidden();
  writeFileSync(resolve(OUT, 'facts.json'), JSON.stringify({ dare, copied: text, bannerZh: await page.locator('.startup-replica').getAttribute('data-step') }, null, 2));
});
