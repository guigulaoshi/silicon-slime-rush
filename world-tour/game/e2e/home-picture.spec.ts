import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SHOWCASE_IMAGE, SHOWCASE_SPIN, SHOWCASE_START_ANGLE } from '../src/app/showcase';
import { expectWorldLoaded } from './world';

/**
 * The home page's shipped picture, `public/home/showcase.webp` (SHOWCASE_IMAGE in showcase.ts, once
 * `public/home/goldengate.webp` before the showcase track became sydney), is a frame of the live orbit
 * itself. It is what a phone, reduced motion and a low-quality machine get instead of the orbit, what the
 * home page's Share hands out, and what `build/og-image.mjs` turns into the link preview. The first one was
 * a hand-taken screenshot and nothing ever retook it, so it showed the bay
 * of months before. Opt-in, because it rewrites a shipped image:
 * HOME_PICTURE=survey writes a contact sheet of the orbit to choose the angle from; HOME_PICTURE=render
 * writes the picture at HOME_PICTURE_ANGLE.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const MODE = process.env.HOME_PICTURE;
test.skip(MODE !== 'survey' && MODE !== 'render', 'HOME_PICTURE=survey|render rewrites the home picture');
test.describe.configure({ timeout: 600_000 });
/**
 * The orbit angle of the shipped picture: the opening frame of the live orbit -- the Harbour Bridge's arch
 * across the picture, the Opera House at its left edge and the city towers behind. Picked from two
 * HOME_PICTURE=survey sheets: turning either way loses the Opera House, and no angle of
 * this orbit brings it nearer the middle. An angle rather than seconds after the opening, so the picture
 * stays the same frame if the opening moves.
 */
const HOME_PICTURE_ANGLE = SHOWCASE_START_ANGLE;
const SURVEY_OUT = resolve(HERE, '..', 'test-results', 'evidence', 'home-picture');

async function openOrbit(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ version: 1, language: 'en', muted: true })));
  await page.goto('/?dev=1');
  await page.waitForSelector('[data-showcase=live]', { timeout: 240_000 });
  await page.evaluate(() => {
    const g = window.game as any;
    g.timeScale = 0;
    g.session.world.renderer.domElement.setAttribute('data-home-picture', '');
    // Roadside boards carry social-network logos; a picture the game hands out shows none (不把商标写进去).
    g.session.world.scene.traverse((o: any) => {
      for (const m of [].concat(o.material ?? [])) if ((m as any).name?.startsWith('billboard')) (m as any).visible = false;
    });
  });
  // Only the 3D frame: the page itself is laid over the picture wherever it is shown.
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } [data-home-picture] { visibility: visible !important; }' });
}

async function frameAt(page: Page, orbitAngle: number): Promise<Buffer> {
  await page.evaluate(angle => { (window.game as any).showcase.angle = angle; }, orbitAngle);
  for (let i = 0; i < 40; i++) {
    const tiles = await page.evaluate(() => window.game.report().tiles);
    if (tiles && tiles.loading === 0 && tiles.loaded > 0) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);
  await expectWorldLoaded(page, 'home picture');
  return page.screenshot();
}

test('home picture', async ({ page }) => {
  await openOrbit(page);
  if (MODE === 'survey') {
    mkdirSync(SURVEY_OUT, { recursive: true });
    const turns = Array.from({ length: 12 }, (_, k) => k * 1.5);
    const tiles: Buffer[] = [];
    for (const turn of turns) tiles.push(await sharp(await frameAt(page, SHOWCASE_START_ANGLE + SHOWCASE_SPIN * turn)).resize(480, 270).png().toBuffer());
    await sharp({ create: { width: 480 * 4, height: 270 * 3, channels: 3, background: '#000' } })
      .composite(tiles.map((input, k) => ({ input, left: (k % 4) * 480, top: Math.floor(k / 4) * 270 })))
      .png().toFile(resolve(SURVEY_OUT, 'orbit.png'));
    return;
  }
  const png = await frameAt(page, HOME_PICTURE_ANGLE);
  // SHOWCASE_IMAGE is './home/showcase.webp' -- write to the exact file showcase.ts (and home.spec.ts's abort test) reference.
  await sharp(png).resize(1280, 720).webp({ quality: 80 }).toFile(resolve(HERE, '..', 'public', SHOWCASE_IMAGE.replace(/^\.\//, '')));
  expect(true).toBe(true);
});
