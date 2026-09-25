import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

for (const viewport of [{ width: 1440, height: 900 }, { width: 932, height: 430 }]) {
  test(`selected garage cards stay inside the scroll row at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?dev=1');
    await page.locator('.home-go').click();
    for (let step = 1; step <= 2; step++) {
      await page.locator('.sm-go').click();
      await expect(page.locator('.sm')).toHaveAttribute('data-step', String(step));
    }
    const out = evidencePath('garage-clipping');
    mkdirSync(out, { recursive: true });
    const cards = page.locator('.sm-car');
    const school = page.locator('.sm-car[data-vehicle="school-bus"]');
    await school.click();
    await expect(page.locator('.sm-carhero')).toHaveAttribute('data-state', 'ready');
    const oldStyle = await page.addStyleTag({ content: '.startup-replica .sm-car.sel { transform:translateY(-3px); }' });
    const before = await school.boundingBox();
    const rowBefore = await page.locator('.sm-cars').boundingBox();
    expect(before!.y).toBeLessThan(rowBefore!.y);
    await page.screenshot({ path: resolve(out, `${viewport.width}-before.png`) });
    await oldStyle.evaluate(node => node.parentNode!.removeChild(node));
    for (const card of [school, cards.first(), cards.last()]) {
      await card.click();
      await expect(card).toHaveClass(/sel/);
      await expect.poll(async () => {
        const box = await card.boundingBox();
        const row = await page.locator('.sm-cars').boundingBox();
        return Math.min(box!.y - row!.y, row!.y + row!.height - box!.y - box!.height,
          box!.x - row!.x, row!.x + row!.width - box!.x - box!.width);
      }).toBeGreaterThanOrEqual(-0.5);
    }
    await school.click();
    await page.screenshot({ path: resolve(out, `${viewport.width}-after.png`) });
  });
}
