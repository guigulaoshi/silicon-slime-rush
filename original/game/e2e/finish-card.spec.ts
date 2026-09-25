import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

const out = evidencePath('finish-card');
test.describe.configure({ timeout: 180_000 });

/* */
async function finish(page: Page, ai: boolean, language: 'en' | 'zh') {
  return page.evaluate(async ({ ai, language }) => {
    const g = window.game as any;
    g.i18n.set(language);
    await g.startRace({ trackId: 'fishermans-wharf', vehicleId: 'sports-car', timeOfDay: 'day',
      slimeDensity: 'normal', ai, aiDifficulty: 'relaxed' });
    g.phase = 'paused';
    const s = g.session, person = s.humans[0], distance = person.race.spline.length * person.race.totalLaps;
    const seconds = distance / 25, score = Math.round(distance * 6.5);
    person.race.state = 'finished'; person.race.time = seconds; person.race.score = score; person.race.slimeHits = 32;
    for (const [index, racer] of s.racers.filter((r: any) => r.role === 'ai').entries()) {
      racer.race.state = 'finished'; racer.race.time = seconds + (index % 3 === 0 ? -8 : 8 + index);
    }
    for (const racer of s.racers) racer.render(1, 1 / 60);
    g.finish(seconds);
    const r = g.lastResult;
    return { rating: r.rating, field: r.standings.length,
      rank: r.standings.findIndex((x: any) => x.role === 'human') + 1 };
  }, { ai, language });
}

test('every route rates the finish: stars in the slogan slot, big title, new footer, place with AI', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  const facts: Record<string, unknown> = {};
  for (const language of ['en', 'zh'] as const) for (const ai of [false, true]) {
    const result = await finish(page, ai, language);
    facts[`${language}-${ai ? 'ai' : 'solo'}`] = result;
    const card = page.locator('[data-screen=results] .share-card').first();
    await expect(card.locator('.card-rating .earned')).toHaveCount(result.rating);
    await expect(card.locator('.card-rating .earned[data-revealed=true]')).toHaveCount(result.rating);
    await expect(card).not.toContainText('SURVIVED');
    const footer = language === 'en' ? 'DRIVE REAL BAY AREA ROADS · FREE IN YOUR BROWSER' : '开真实硅谷公路 · 浏览器免费玩';
    await expect(card.locator('.card-bottom')).toContainText(footer);
    const place = card.locator('.card-stats span', { hasText: language === 'en' ? 'PLACE' : '名次' });
    if (ai) await expect(place).toContainText(`${result.rank} / ${result.field}`);
    else await expect(place).toHaveCount(0);
    const brand = await card.locator('.card-brand').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    expect(brand).toBeGreaterThanOrEqual(18);
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(out, `finish-${language}-${ai ? 'ai' : 'solo'}.png`) });
  }
  // The exported share image is the same card.
  await page.locator('[data-screen=results] [data-action=share]').click();
  const dialog = page.locator('.share-dialog');
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  const downloading = page.waitForEvent('download');
  await dialog.locator('[data-share=save]').click();
  await (await downloading).saveAs(resolve(out, 'share-image-zh-ai.png'));
  writeFileSync(resolve(out, 'finish-facts.json'), JSON.stringify(facts, null, 2));
});
