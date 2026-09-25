import { expect, test } from '@playwright/test';

/**
 * The two map panels: the nav view and the route map.
 *
 * Both are canvases, so nothing about them is visible to a DOM assertion -- a panel that draws
 * nothing at all looks exactly like one that draws the whole street network. The only honest check
 * is to count the ink, and then to check the nav view actually follows the car: it is drawn
 * heading-up around the car's own position, so on a moving car it can never be the same twice.
 */

// 这个文件真的要开车，所以自己申请预算：默认档是 90 秒（playwright.config.ts），
// 那是「问浏览器一个问题」的价钱。加载 new-york 并跑到街道图出现。
test.describe.configure({ timeout: 180_000 });
const ink = (page: import('@playwright/test').Page, sel: string) => page.evaluate((s) => {
  const c = document.querySelector(s) as HTMLCanvasElement | null;
  if (!c) return { pixels: -1, signature: '' };
  const g = c.getContext('2d');
  if (!g) return { pixels: -1, signature: '' };
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let pixels = 0;
  let signature = 0;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i]! > 8) { pixels++; signature = (signature * 31 + i) >>> 0; }
  }
  return { pixels, signature: String(signature) };
}, sel);

test('the corner maps draw real streets and the nav view follows the car', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const maps: string[] = [];
  // `/map.json`, not `map.json`: the opening screen fetches `menu-map.json`, which ends with the
  // same eight characters and turned this into a two-element list the day that screen landed.
  page.on('response', (r) => { if (r.url().endsWith('/map.json')) maps.push(`${r.status()}`); });

  await page.goto('/?track=new-york&bot=1&dev=1');
  // Past the loading screen, not just a loaded track: it rests at 100% first with Back focused,
  // where an Enter goes back to the menu. The robot (bot=1) starts the race on its own.
  await page.waitForFunction(() => ['intro', 'countdown', 'racing'].includes(window.game?.report().phase), null, { timeout: 60_000 });
  await page.waitForFunction(() => (window.game.report().tiles?.loaded ?? 0) > 2, null, { timeout: 60_000 });
  // the street map is fetched beside the track and drawn as soon as it lands
  await page.waitForSelector('canvas.hud-nav', { state: 'visible', timeout: 30_000 });
  expect(maps, 'the track should ask for its street map').toEqual(['200']);

  const route = await ink(page, 'canvas.hud-map');
  const nav = await ink(page, 'canvas.hud-nav');
  // A no-streets control leaves 792 pixels in this nav view (route plus car); real streets on
  // twin-peaks' dense SF grid lifted it to about 1,360. new-york ("dense city" per the track table) was
  // picked to keep a comparably rich nearby street network for this same no-streets/real-streets gap,
  // but the exact pixel counts depend on new-york's actual OSM road density around the route.
  // RETARGET-MEASURE: confirm these thresholds against a real new-york run; kept unchanged (not weakened)
  // since 2000/1100 sit well above the 792 no-streets floor and new-york is the densest new track.
  expect(route.pixels, 'the route map should carry streets, not just the route').toBeGreaterThan(2000);
  expect(nav.pixels, 'the nav panel should carry streets, not just the route').toBeGreaterThan(1100);

  const before = nav.signature;
  // metres or kilometres, whichever the readout chose; a tenth of a kilometre is the resolution,
  // so this has to watch for long enough that the car covers one
  const left = async () => {
    const text = (await page.textContent('.hud-remaining')) ?? '';
    const n = parseFloat(text);
    return text.includes('km') ? n * 1000 : n;
  };
  const startLeft = await left();
  expect(startLeft, 'the readout should show a real distance').toBeGreaterThan(100);
  // Wait for distance covered, not for time. The readout is rounded to a tenth of a kilometre, and
  // how long the bot takes to cover one of those is a question about the hill it is on.
  const from = await page.evaluate(() => window.game.report().progress);
  await page.waitForFunction((s0) => window.game.report().progress > s0 + 300, from,
    { timeout: 90_000, polling: 200 });
  expect((await ink(page, 'canvas.hud-nav')).signature,
    'the nav view should move with the car').not.toBe(before);
  expect(await left(), 'and the distance left should be counting down').toBeLessThan(startLeft);
  expect(errors, errors.join('\n')).toHaveLength(0);
});
