import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

const out = evidencePath('ui');

async function openResult(page: import('@playwright/test').Page, players: 1 | 2): Promise<number> {
  await page.evaluate(async (count) => {
    const game = window.game as any;
    await game.startRace({trackId:'synth-p2p', direction:'forward', vehicleId:'jeep',
      ...(count === 2 ? {playerVehicles:['jeep','sports-car']} : {}),
      timeOfDay:'day', weather:'clear', slimeDensity:'normal', ai:true, aiDifficulty:'relaxed'});
    const racers = game.session.racers;
    racers.forEach((racer: any, index: number) => {
      racer.race.state = index < count ? 'finished' : 'racing';
      racer.race.time = 65 + index * 2;
    });
    racers[count].race.state = 'finished'; racers[count].race.time = 61;
    game.finish(65);
  }, players);
  await expect(page.locator('[data-screen=results]')).toBeVisible();
  if (players === 1) await page.locator('.result-details summary').click();
  return page.locator('.result-standing').count();
}

test('final UI shows the full real field in single and split play, in both languages and landscape sizes', async ({page}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({width:1440,height:810});
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    language: 'en', muted: true, best: {},
  })));
  await page.goto('/');
  await page.waitForFunction(() => !!window.game);
  const singleCount = await openResult(page, 1);
  expect(singleCount).toBeGreaterThan(1);
  await expect(page.locator('.result-standing').first()).toContainText('1:01.00');
  await expect(page.locator('.result-standing.human')).toHaveCount(1);
  await page.screenshot({path:resolve(out,'result-single-en.png')});
  await page.setViewportSize({width:932,height:430});
  await page.screenshot({path:resolve(out,'result-single-phone-landscape.png')});
  await page.locator('[data-screen=results] .language').click();
  await expect(page.locator('.result-standings h3')).toHaveText('全场名次');
  await page.screenshot({path:resolve(out,'result-single-zh.png')});
  await page.locator('[data-screen=results] .language').click();

  await page.setViewportSize({width:1440,height:810});
  const splitCount = await openResult(page, 2);
  expect(splitCount).toBeGreaterThan(2);
  await expect(page.locator('.result-standing.human')).toHaveCount(2);
  await expect(page.locator('.result-players .result-player')).toHaveCount(2);
  await page.screenshot({path:resolve(out,'result-split-en.png')});
});
