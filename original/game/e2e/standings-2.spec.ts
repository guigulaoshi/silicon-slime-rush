import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { VEHICLES } from '../src/vehicles/catalogue';

test.describe.configure({ timeout: 180_000 });
const out = evidencePath('standings');

async function placeField(page: Page, playerAlong: number) {
  await page.evaluate(along => {
    const g = window.game as any, s = g.session;
    g.timeScale = 0;
    for (const [index, racer] of s.racers.entries()) {
      const at = s.world.spline.indexAt(index === 0 ? along : 160 + index * 22);
      const p = s.world.spline.point(at), t = s.world.spline.tangent(at);
      const height = racer.car.position.y - s.world.spline.point(racer.race.progress.value.index)[1];
      p[1] += height;
      racer.car.reset(p, Math.atan2(-t[0], -t[2])); racer.trailer?.syncReset();
      racer.race.reacquire(p[0], p[2]); racer.race.state = 'racing'; racer.race.time = 20;
      racer.chase.reset();
    }
  }, playerAlong);
}

async function start(page: Page, humans: string[], ai: boolean) {
  expect(await page.evaluate(async ({ humans, ai }) => {
    const g = window.game as any;
    g.timeScale = 1;
    const ready = await g.startRace({ trackId: 'shoreline', car: 'sedan',
      playerVehicles: humans, ai, slimeDensity: 'none', timeOfDay: 'day' });
    if (ready) { g.session.racers.forEach((r: any) => r.race.start()); g.show('racing'); }
    return ready;
  }, { humans, ai })).toBe(true);
  await page.waitForFunction(() => window.game.session.humans.every(racer => racer.car.grounded));
  await expect(page.locator('.hud-nav').first()).toBeVisible();
}

test('live standings follow overtakes in both languages and share the finish order', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ language: 'en', quality: 'high', muted: true })));
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await start(page, ['micro-hatch'], true);
  const total = VEHICLES.length;
  const standings = page.locator('.player-hud .hud-standing');
  for (const language of ['en', 'zh'] as const) {
    await page.evaluate(language => (window.game as any).i18n.set(language), language);
    for (const [stage, along, rank] of [['before', 150, total], ['after', 205, total - 2]] as const) {
      await placeField(page, along);
      await expect(standings).toHaveText(language === 'en' ? `Position ${rank} / ${total}` : `第 ${rank} 名 / 共 ${total} 辆`, { timeout: 1000 });
      const facts = await page.evaluate(() => {
        const g = window.game as any, h = g.hudState(0);
        return { standing: h.standing, rivals: h.rivals,
          cars: g.session.racers.slice(1).map((r: any) => ({ id: r.id, x: r.car.position.x, z: r.car.position.z })),
          mapPixels: [...document.querySelectorAll<HTMLCanvasElement>('.player-hud .hud-map, .player-hud .hud-nav')].map(canvas => {
            const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 255 && pixels[i + 1] === 240 && pixels[i + 2] === 178) count++;
            return count;
          }),
        };
      });
      expect(facts.rivals).toHaveLength(total - 1);
      for (const car of facts.cars) expect(facts.rivals.find((r: any) => r.id === car.id)).toMatchObject(car);
      expect(facts.mapPixels).toHaveLength(2); facts.mapPixels.forEach(count => expect(count).toBeGreaterThan(0));
      // the player removed the rank badges over other cars; the maps above still show them.
      expect(await page.locator('.hud-rival').count()).toBe(0);
      await page.screenshot({ path: resolve(out, `${language}-${stage}.png`) });
      writeFileSync(resolve(out, `${language}-${stage}.json`), JSON.stringify(facts, null, 2));
    }
  }
  const result = await page.evaluate(() => {
    const g = window.game as any, s = g.session;
    s.racers[0].race.state = 'finished'; s.racers[0].race.time = 49;
    s.racers[1].race.state = 'finished'; s.racers[1].race.time = 48;
    const h = g.hudState(0);
    const live = [{ id: s.racers[0].id, rank: h.standing.rank }, ...h.rivals].sort((a, b) => a.rank - b.rank).map(r => r.id);
    g.finish(49);
    return { live, final: g.lastResult.standings.map((r: any) => r.id),
      names: g.lastResult.standings.map((r: any) => g.i18n.t(`car.${r.vehicleId}.name`)) };
  });
  expect(result.live).toEqual(result.final);
  await expect(page.locator('.result-standing-name')).toHaveText(result.names);

  await start(page, ['micro-hatch', 'jeep'], false); await placeField(page, 150);
  await expect(page.locator('[data-player="1"] .hud-standing')).toHaveText('第 2 名 / 共 2 辆', { timeout: 1000 });
  await expect(page.locator('[data-player="2"] .hud-standing')).toHaveText('第 1 名 / 共 2 辆', { timeout: 1000 });
  await page.screenshot({ path: resolve(out, 'zh-dual.png') });
  const dual = await page.evaluate(() => [0, 1].map(index => (window.game as any).hudState(index).rivals.map((r: any) => r.player)));
  expect(dual).toEqual([[1], [0]]);
  await start(page, ['micro-hatch'], false);
  await expect(page.locator('.hud-standing')).toBeHidden();
  await expect(page.locator('.hud-rival')).toHaveCount(0);
});
