import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { CATALOGUE } from '../src/app/tracks';

/**
 * The route map card fills the pane's height
 * and is wider than the old fixed column, and whichever route is selected, its dot stays on the map.
 */
const OUT = evidencePath('route-map');
test.describe.configure({ timeout: 120_000 });

for (const [name, viewport, mobile] of [['desktop', { width: 1280, height: 720 }, false], ['phone', { width: 915, height: 412 }, true]] as const) {
  test(`439 ${name}: a taller-than-before map card keeps every selected route in view`, async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const context = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true } : {}), locale: 'zh-CN' });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ language: 'zh', muted: true })));
    await page.goto('/'); await page.locator('.home-go').click();
    await expect(page.locator('.sm-item')).toHaveCount(CATALOGUE.length);
    const card = page.locator('.sm-pane:first-child > .sm-act');
    const pane = page.locator('.sm-pane:first-child');
    const [c, p] = [(await card.boundingBox())!, (await pane.boundingBox())!];
    expect(c.width, 'wider than the old fixed column').toBeGreaterThan(mobile ? 240 : 300);
    expect(c.width, 'the gallery keeps at least half').toBeLessThanOrEqual(p.width * .5);
    //The "08 ROUTES" count above the gallery is gone; the heading stays.
    expect(await page.locator('.startup-route-count').textContent()).not.toMatch(/\d/);
    for (const track of CATALOGUE) {
      await page.locator(`[data-track="${track.id}"]`).click();
      await page.waitForTimeout(80);
      const inside = await page.evaluate(() => {
        const dot = document.querySelector('.sm-loc .sm-dot.on')?.getBoundingClientRect();
        const box = document.querySelector('.sm-locbox')?.getBoundingClientRect();
        const lens = document.querySelector('.sm-circuitbox')?.getBoundingClientRect();
        const selected = document.querySelectorAll('.sm-loc .sm-route.sel').length;
        const route = document.querySelector<SVGGraphicsElement>('.sm-loc .sm-route.sel');
        const ring = document.querySelector('.sm-lens')?.getBoundingClientRect();
        if (!dot || !box || !lens || !route || !ring) return null;
        //The line is thin on screen, nothing is painted over
        // it, and the ring goes round the whole route rather than a point on it.
        const r = route.getBoundingClientRect();
        const [rx, ry, rr] = [(ring.left + ring.right) / 2, (ring.top + ring.bottom) / 2, ring.width / 2];
        const enclosed = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]
          .every(([x, y]) => Math.hypot(x! - rx, y! - ry) <= rr + 1);
        const strokePx = parseFloat(getComputedStyle(route).strokeWidth) * route.getScreenCTM()!.a;
        const dotPainted = getComputedStyle(document.querySelector('.sm-loc .sm-dot')!).fill !== 'none';
        // The magnifier is a circle: the dot is covered when its centre is inside that circle.
        const [cx, cy] = [(dot.left + dot.right) / 2, (dot.top + dot.bottom) / 2];
        const [lx, ly, lr] = [(lens.left + lens.right) / 2, (lens.top + lens.bottom) / 2, lens.width / 2];
        return { dot: [dot.left, dot.top, dot.right, dot.bottom], box: [box.left, box.top, box.right, box.bottom],
          covered: Math.hypot(cx - lx, cy - ly) < lr + dot.width / 2, selected, enclosed, strokePx, dotPainted,
          onTop: route.nextElementSibling?.classList.contains('sm-dot') ?? false };
      });
      expect(inside, track.id).not.toBeNull();
      const [dl, dt, dr, db] = inside!.dot as [number, number, number, number];
      const [bl, bt, br, bb] = inside!.box as [number, number, number, number];
      expect(dl >= bl - 1 && dr <= br + 1 && dt >= bt - 1 && db <= bb + 1, `${track.id} dot on the map`).toBe(true);
      expect(inside!.covered, `${track.id} dot not under the magnifier`).toBe(false);
      expect(inside!.selected, `${track.id} route line highlighted`).toBe(1);
      expect(inside!.onTop, `${track.id} highlighted line drawn over its neighbours`).toBe(true);
      expect(inside!.enclosed, `${track.id} ring goes round the whole route`).toBe(true);
      expect(inside!.dotPainted, `${track.id} nothing painted over the route`).toBe(false);
      expect(inside!.strokePx as number, `${track.id} route line thin enough to see its shape`).toBeLessThan(7);
      // Retargeted from goldengate/wolfe-pruneridge (deleted) to sydney (the new showcase route)
      // and beijing (a loop, the other shape family), just two representative screenshots.
      if (track.id === 'sydney' || track.id === 'beijing') await page.screenshot({ path: resolve(OUT, `${name}-${track.id}.png`) });
    }
    // A resize rebuilds the map's paths; the selected one keeps its highlight. (A mobile context cannot resize.)
    // twin-peaks (deleted) was picked because this resize did not pan the map there, and a pan rebuilt
    // with the highlight anyway, which would have hidden a rebuild bug. beijing is the stand-in; a
    // browser run should confirm this resize does not itself pan beijing into view.
    // RETARGET-MEASURE: does resizing viewport.height + 180 pan the map when beijing is selected? If it
    // does, pick a different CATALOGUE track for this assertion instead.
    if (!mobile) {
      await page.locator('[data-track="beijing"]').click();
      await page.locator('.sm-loc .sm-route.sel').evaluate(path => { (path as SVGElement).dataset.stale = '1'; });
      await page.setViewportSize({ width: viewport.width, height: viewport.height + 180 });
      await expect.poll(() => page.locator('.sm-loc .sm-route[data-stale]').count(), 'the map was rebuilt').toBe(0);
      await expect(page.locator('.sm-loc .sm-route.sel')).toHaveCount(1);
    }
    await context.close();
  });
}
