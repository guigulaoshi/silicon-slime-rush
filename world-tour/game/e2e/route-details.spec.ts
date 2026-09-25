import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { evidencePath } from './evidence';
import { CATALOGUE } from '../src/app/tracks';

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

for (const [language, width, height] of [['zh', 1280, 720], ['en', 1280, 720], ['en', 844, 390], ['zh', 844, 390]] as const) {
  test(`route details stay open in a corner strip and the route dash is twice as dense (${language} ${width}x${height})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const best = Object.fromEntries(CATALOGUE.map(track => [track.id, 245.33]));
    await page.addInitScript(({ language, best }) => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
      // A best time is the widest the numbers row gets ("4:05.33" instead of "—"), so every route carries one.
      language, muted: true, best,
    })), { language, best });
    await page.goto('/'); await page.locator('.home-go').click();
    await expect(page.locator('.sm-go')).toBeEnabled();
    const card = page.locator('.sm-pane').first().locator('.sm-act'), details = card.locator('.startup-route-details');
    await expect(details.locator('summary')).toHaveCount(0);
    for (const part of ['.sm-stats', '.sm-blurb']) await expect(details.locator(part)).toBeVisible();
    const out = evidencePath('route-details'); mkdirSync(out, { recursive: true });
    // Every route moves the dot and so the enlarged drawing; none of them may sit under the strip.
    const rows = page.locator('.sm-item'), count = await rows.count();
    for (let i = 0; i < count; i++) {
      if (i) await page.keyboard.press('ArrowDown');
      await expect(rows.nth(i)).toHaveClass(/sel/);
      const strip = (await details.boundingBox())!, box = (await card.boundingBox())!;
      expect(strip.x).toBeGreaterThanOrEqual(box.x - 1); expect(strip.x + strip.width).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(strip.y + strip.height).toBeLessThanOrEqual(box.y + box.height + 1);
      for (const other of ['.sm-circuitbox', '.sm-headline']) expect(overlaps(strip, (await card.locator(other).boundingBox())!), other).toBe(false);
      expect(overlaps(strip, (await page.locator('.startup-route-panel').boundingBox())!)).toBe(false);
      await expect(details.locator('.sm-stat').last().locator('b'), `best ${i}`).toHaveText(/\d:\d\d\.\d\d/);
      // Nothing in the strip is cut off: the blurb shows every line, and the numbers row does not run past the card.
      expect(await details.locator('.sm-blurb').evaluate(node => node.scrollHeight <= node.clientHeight + 1), `blurb ${i}`).toBe(true);
      expect(await details.locator('.sm-stats').evaluate(node => node.scrollWidth <= node.clientWidth + 1), `stats ${i}`).toBe(true);
    }
    const line = card.locator('.sm-line');
    expect(await line.evaluate(node => { const s = getComputedStyle(node); return [s.strokeDasharray, s.animationName]; }))
      .toEqual(['13px, 10px', 'sm-run']);
    await page.addStyleTag({ content: '.sm-line { animation-play-state:paused !important; stroke-dashoffset:0 !important; }' });
    await card.screenshot({ path: `${out}/${language}-${width}-after.png` });
    // The same view with the old 26/20 dash, for the before/after pair the entry asks for.
    await page.addStyleTag({ content: '.sm-line { stroke-dasharray:26 20 !important; }' });
    await card.screenshot({ path: `${out}/${language}-${width}-before.png` });
  });
}
