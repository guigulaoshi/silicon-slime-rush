import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 180_000 });
for (const lang of ['en', 'zh']) test(`actual slime collision scores and settles in ${lang}`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: lang === 'zh' ? { width: 844, height: 390 } : { width: 1280, height: 720 },
    isMobile: lang === 'zh', hasTouch: lang === 'zh' });
  const page = await context.newPage();
  await page.addInitScript(language => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ language, muted: true })), lang);
  await page.goto(`/?track=synth-p2p&bot=1&dev=1&time=day&vehicle=micro-hatch`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'scoring');
  const before = await page.evaluate(() => {
    const g = window.game as any, s = g.session, layer = s.slimes;
    g.autopilot = false; layer.fallingLimit = 0;
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    const spline = s.world.spline, at = spline.indexAt(30), p = spline.point(at);
    const start = spline.point(spline.indexAt(12)), t = spline.tangent(at);
    s.car.reset([start[0], start[1] + .8, start[2]], Math.atan2(-t[0], -t[2]));
    s.car.body.setLinvel({ x: t[0] * 8, y: 0, z: t[2] * 8 }, true);
    const [file, tile] = [...s.world.streamer.loaded.entries()][0] as any;
    tile.slimes = [{ kind: 'popper', position: [p[0], p[1] + 2, p[2]], scale: [2, 2, 2], yaw: 0 }];
    layer.addTile(file, tile.slimes);
    return { score: s.race.score, hits: s.race.slimeHits };
  });
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(score => window.game.report().score > score, before.score, { timeout: 15000 });
  await page.keyboard.up('ArrowUp');
  const hit = await page.evaluate(() => window.game.report());
  expect(hit.score).toBe(before.score + 200); expect(hit.slimeHits).toBe(before.hits + 1);
  await expect(page.locator('.hud-score')).toContainText(String(hit.score));
  const out = evidencePath('slime-score'); mkdirSync(out, { recursive: true });
  await page.evaluate(() => { const g = window.game as any; g.say(g.i18n.t('hud.checkpoint', { index: 1, total: 3 })); });
  const scoreBox = (await page.locator('.hud-score').boundingBox())!;
  const noticeBox = (await page.locator('.hud-notice').boundingBox())!;
  expect(noticeBox.y).toBeGreaterThanOrEqual(scoreBox.y + scoreBox.height);
  await page.screenshot({ path: resolve(out, `${lang}-hud.png`) });
  await page.waitForTimeout(500);
  expect((await page.evaluate(() => window.game.report())).score).toBe(hit.score);
  await page.evaluate(() => {
    const g = window.game as any; g.autopilot = true; g.timeScale = 8;
  });
  await page.waitForFunction(() => window.game.report().phase === 'results', null, { timeout: 120000 });
  const finished = await page.evaluate(() => window.game.report());
  await expect(page.locator('.result-score')).toContainText(String(finished.score));
  await expect(page.locator('.result-score')).toContainText(String(finished.slimeHits));
  expect(finished.score).toBeGreaterThanOrEqual(hit.score);
  await page.screenshot({ path: resolve(out, `${lang}-results.png`), animations: 'disabled' });
  await page.evaluate(() => { const g = window.game as any; g.autopilot = false; g.timeScale = 1; g.restart(); });
  expect((await page.evaluate(() => window.game.report())).score).toBe(0);
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await page.evaluate(() => {
    const g = window.game as any, s = g.session, spline = s.world.spline;
    g.autopilot = false; s.slimes.fallingLimit = 0;
    const p = spline.point(spline.indexAt(12)), t = spline.tangent(spline.indexAt(30));
    s.car.reset([p[0], p[1] + .8, p[2]], Math.atan2(-t[0], -t[2]));
    s.car.body.setLinvel({ x: t[0] * 8, y: 0, z: t[2] * 8 }, true);
  });
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.game.report().score >= 200, null, { timeout: 15000 });
  await page.keyboard.up('ArrowUp');
  expect((await page.evaluate(() => window.game.report())).score).toBe(200);
  await context.close();
});
