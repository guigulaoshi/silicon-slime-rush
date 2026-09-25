import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

// Every world condition sits in the right-hand column with no fold, and at desktop sizes the
// whole column fits inside its pane -- nothing clipped, nothing to scroll to. The four rows share the
// column's height, so even a landscape phone gets buttons a finger can hit (44 CSS px).
test.describe.configure({ timeout: 90_000 });
const out = evidencePath('world-conditions');

for (const language of ['en', 'zh'] as const) for (const [width, height] of [[1440, 900], [1280, 720], [844, 390]] as const) {
  test(`all conditions fit the world pane in ${language} at ${width}x${height}`, async ({ page }) => {
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height });
    await page.addInitScript(language => localStorage.setItem('silicon-rush-world-tour.save.v1',
      JSON.stringify({ language, muted: true, reducedMotion: true })), language);
    await page.goto('/?dev=1'); await page.locator('.home-go').click(); await page.locator('.sm-go').click();
    const column = page.locator('.sm-world .sm-conditions');
    await expect(column).toBeVisible();
    await expect(page.locator('.startup-world-more, .sm-world details')).toHaveCount(0);
    const layout = await column.evaluate(node => {
      // The pane runs under the footer bar, so the column must end above the footer, not above the pane.
      const pane = node.closest('.sm-pane')!.getBoundingClientRect(), box = node.getBoundingClientRect();
      const footer = document.querySelector('.startup-replica .sm-foot')!.getBoundingClientRect();
      const frame = { bottom: Math.min(pane.bottom, footer.top), right: pane.right };
      const buttons = [...node.querySelectorAll('button')].map(b => b.getBoundingClientRect());
      return { rows: node.children.length, buttons: buttons.length, shortest: Math.min(...buttons.map(b => b.height)), overflow: node.scrollHeight - node.clientHeight,
        below: Math.max(box.bottom, ...buttons.map(b => b.bottom)) - Math.min(frame.bottom, innerHeight),
        right: Math.max(...buttons.map(b => b.right)) - Math.min(frame.right, innerWidth) };
    });
    expect(layout.rows).toBe(4);
    // Time 2, weather 4, slimes 3, AI 3 plus its difficulty 2: dropped the middle AI tier.
    expect(layout.buttons).toBe(14);
    expect(layout.shortest).toBeGreaterThanOrEqual(44);
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.below).toBeLessThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(0);
    await page.screenshot({ path: resolve(out, `${language}-${width}x${height}.png`) });
  });
}
