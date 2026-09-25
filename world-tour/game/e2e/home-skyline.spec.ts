import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHOWCASE_AT, SHOWCASE_SPIN, SHOWCASE_START_ANGLE } from '../src/app/showcase';
import { evidencePath } from './evidence';

/**
 * Turned round. The home orbit opens facing across the harbour with the bridge on
 * the left, turns left so the bridge comes to the middle, and only then brings Sydney's skyline in (原始需求
 *
 * -- written for the Golden Gate showcase; the remix keeps the same shot
 * grammar -- bridge left-to-middle, then skyline -- for the Sydney Harbour Bridge showcase that replaced it).
 *
 * In Sydney the city stands at the bridge's south end, so the bridge that leads the eye to it is the south half
 * of the span: the route's line 200 to 600 m past the orbit's centre, towards the city, lifted to deck height.
 * (The Golden Gate check used the deck behind the centre; here that half points north, away from the city,
 * and turning left brings it to the middle only after the skyline has come and gone.) The skyline is the
 * backdrop's own towers: every building vertex within 3 km of the tallest one and more than 40 m above the
 * orbit's centre. "In the picture" means on screen, left of the home copy panel that covers the right of the
 * page; "the middle" is the middle of that open picture.
 */
const OUT = evidencePath('home-skyline');
test.describe.configure({ timeout: 300_000 });

/** Seconds of orbit to an angle: SHOWCASE_SPIN carries the direction. */
const at = (seconds: number) => SHOWCASE_START_ANGLE + SHOWCASE_SPIN * seconds;

async function viewAt(page: Page, angle: number) {
  await page.evaluate(a => { (window as any).game.showcase.angle = a; }, angle);
  return page.evaluate(async ({ a, at }) => {
    const g = (window as any).game;
    // Pin, draw, pin again: the orbit advances the angle every frame.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    g.showcase.angle = a;
    await new Promise(r => requestAnimationFrame(r));
    const w = g.session.world, cam = w.cameras[0], centre = g.showcase.centre;
    const panel = document.querySelector('.home-copy')!.getBoundingClientRect();
    const screenX = (v: any) => {
      const n = v.clone().project(cam);
      return n.z < -1 || n.z > 1 || Math.abs(n.y) > 1 ? null : (n.x + 1) / 2 * innerWidth;
    };
    const points: any[] = [];
    w.scene.getObjectByName('backdrop').traverse((o: any) => {
      if (!o.isMesh || !o.name.startsWith('backdrop_buildings')) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) points.push(cam.position.clone().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
    });
    const top = points.reduce((best, v) => v.y > best.y ? v : best);
    const skyline = points.filter(v => Math.hypot(v.x - top.x, v.z - top.z) < 3000 && v.y - centre.y > 40);
    const place = (v: any) => {
      const x = screenX(v);
      return x === null ? 'off' : x >= 0 && x < panel.left ? 'open' : x >= panel.left && x <= innerWidth ? 'panel' : 'off';
    };
    const places = skyline.map(place);
    const spline = w.spline, s = spline.length * at;
    const deck = [200, 400, 600].map(ahead => {
      const p = spline.point(spline.indexAt(s + ahead));
      return screenX(cam.position.clone().set(p[0], p[1] + 20, p[2]));
    });
    const look = cam.getWorldDirection(cam.position.clone());
    return { open: places.filter(p => p === 'open').length, panel: places.filter(p => p === 'panel').length,
      total: skyline.length, topOpen: place(top) === 'open', deck, panelLeft: panel.left,
      bearing: (Math.atan2(look.x, -look.z) * 180 / Math.PI + 360) % 360 };
  }, { a: angle, at: SHOWCASE_AT });
}

test('the home orbit opens facing across the harbour, brings the bridge to the middle, then the skyline', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.waitForSelector('[data-showcase=live]', { timeout: 240_000 });
  const opened = await page.evaluate(() => (window as any).game.showcase.angle);
  // Turning the reversed way: the angle falls from the start.
  expect(SHOWCASE_SPIN).toBeLessThan(0);
  expect(opened).toBeLessThanOrEqual(SHOWCASE_START_ANGLE);
  expect(opened).toBeGreaterThan(at(3));

  const start = await viewAt(page, at(0));
  await page.screenshot({ path: resolve(OUT, 'first-frame.png') });
  // Facing west along the harbour, the arch side-on across the picture (bearing = angle - 90).
  expect(start.bearing).toBeGreaterThan(270);
  expect(start.bearing).toBeLessThan(290);
  expect(start.total).toBeGreaterThan(1000);
  expect(start.open, 'no skyline yet').toBe(0);
  // The span's city end on the left of the open picture.
  const near = (view: typeof start) => view.deck[0];
  expect(near(start)).not.toBeNull();
  expect(near(start)!).toBeLessThan(start.panelLeft * .3);

  let bridgeMiddle: number | null = null, skylineIn: number | null = null;
  for (let t = .5; t <= 20 && (bridgeMiddle === null || skylineIn === null); t += .5) {
    const view = await viewAt(page, at(t));
    if (bridgeMiddle === null && near(view) !== null && near(view)! >= view.panelLeft * .5) {
      bridgeMiddle = t;
      await page.screenshot({ path: resolve(OUT, 'bridge-middle.png') });
    }
    // Its tallest tower, not its first vertex: the city's edge shows at the picture's left while the bridge is still crossing.
    if (skylineIn === null && view.topOpen) skylineIn = t;
  }
  expect(bridgeMiddle, 'the bridge comes across the picture').not.toBeNull();
  expect(skylineIn, 'the skyline\'s tallest tower follows within twenty seconds').not.toBeNull();
  expect(bridgeMiddle!, 'the bridge first, then the Sydney skyline').toBeLessThan(skylineIn!);

  const sweep = await viewAt(page, at(skylineIn! + 4));
  expect(sweep.topOpen).toBe(true);
  await page.screenshot({ path: resolve(OUT, 'skyline-sweeping.png') });
});
