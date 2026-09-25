import { devices, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePathOr } from './evidence';

/**
 * The home page's orbit had the sky showing through the ground. Two separate holes:
 * the corridor's ground and road live only in streamed tiles and the driving window keeps about a
 * kilometre of them, while the backdrop leaves the corridor to those tiles on purpose -- so the rest
 * of the bridge was simply not there; and the ground under the approach viaduct was cut away by
 * subtracting the road's plan shadow whatever height the road flew at.
 *
 * How it is asked: hide the sky dome and clear the frame to magenta, so every pixel no geometry
 * covers comes back magenta. Above the camera's own horizon line that is the sky and is fine.
 * **Below that line there is nothing but ground and sea**, so magenta there is a hole in the world.
 * The horizon row is measured from the camera rather than guessed, and eight bearings cover the turn.
 * HOME455_BEFORE=1 captures the old behaviour into its own folder.
 */
const BEFORE = process.env.HOME455_BEFORE === '1';
const OUT = evidencePathOr(process.env.HOME455_OUT, 'home-orbit', BEFORE ? 'before' : 'after');
test.describe.configure({ timeout: 300_000 });

test('no sky under the horizon from any bearing of the home orbit', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.waitForSelector('[data-showcase=live]', { timeout: 180_000 });
  // BEFORE puts the driving window back and drops what falls outside it: that is the old behaviour
  // this half of the fix replaced, measured by the same ruler rather than remembered.
  if (BEFORE) {
    await page.evaluate(() => {
      const st = (window.game as any).session.world.streamer;
      Object.assign(st.window, { behind: 300, ahead: 1500, radius: 1000, hysteresis: 300 });
      st.updateMany(st.positions);
    });
  }
  await page.waitForTimeout(1200);
  const holes: { bearing: number; sky: number; of: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const pin = () => page.evaluate(a => { (window.game as any).showcase.angle = a; }, angle);
    await pin(); await page.waitForTimeout(500); await pin(); await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(OUT, `bearing-${i}.png`) });
    holes.push({ bearing: i, ...await page.evaluate(() => {
      const w = (window.game as any).session.world, cam = w.cameras[0], gl = w.renderer.getContext();
      const sky: any[] = [];
      w.scene.traverse((o: any) => {
        if (o.isMesh && o.geometry?.type === 'SphereGeometry' && (o.material?.name ?? '') === '') sky.push(o);
      });
      for (const dome of sky) dome.visible = false;
      const clear = w.renderer.getClearColor(w.scene.fog.color.clone());
      w.renderer.setClearColor(0xff00ff, 1);
      w.renderer.render(w.scene, cam);
      const size = w.renderer.getDrawingBufferSize(cam.position.clone());
      const pixels = new Uint8Array(size.x * size.y * 4);
      gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (const dome of sky) dome.visible = true;
      w.renderer.setClearColor(clear, 1);
      // A point at eye height, far ahead: where the eye looks level. readPixels counts rows from the
      // bottom, so everything below the horizon is row 0 up to this one. Ten rows of slack, because
      // the far skyline sits right on that line and its own edge is what would otherwise be counted;
      // a hole reaches hundreds of rows down, so the slack costs the test nothing.
      const ahead = cam.getWorldDirection(cam.position.clone()).setY(0).normalize();
      const level = cam.position.clone().add(ahead.multiplyScalar(2000)).project(cam);
      const rows = Math.max(0, Math.min(size.y, Math.floor((level.y + 1) / 2 * size.y) - 10));
      let count = 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < size.x; x++) {
          const at = (y * size.x + x) * 4;
          if (pixels[at]! > 200 && pixels[at + 1]! < 80 && pixels[at + 2]! > 200) count++;
        }
      }
      return { sky: count, of: rows * size.x };
    }) });
  }
  const tiles = await page.evaluate(() => {
    const s = (window.game as any).session;
    return { loaded: s.world.streamer.loaded.size, total: s.world.streamer.track.tiles.length };
  });
  console.log('HOME455', OUT, JSON.stringify({ tiles, holes }));
  if (BEFORE) return;
  for (const { bearing, sky } of holes) {
    // A handful of pixels is a cable's anti-aliased edge against the background; a hole is thousands.
    expect(sky, `bearing ${bearing}: ${sky} pixels of sky below the horizon`).toBeLessThan(400);
  }
});

test('a phone still opens straight onto the home page', async ({ browser }) => {
  // The opening load is desktop-only. A phone never runs the scene, so it must not wait for one:
  // is the line this guards, and it guards it where it could break.
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  try {
    const started = Date.now();
    await page.goto('/');
    await expect(page.locator('.home-go')).toBeVisible({ timeout: 20_000 });
    const ms = Date.now() - started;
    const paint = await page.evaluate(() => {
      const entry = performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint');
      return Math.round(entry?.startTime ?? -1);
    });
    console.log('HOME455 phone', JSON.stringify({ homeUsableMs: ms, firstContentfulPaint: paint }));
    expect(await page.evaluate(() => !!(window.game as any).session), 'no scene is loaded on a phone').toBe(false);
    await expect(page.locator('[data-showcase]')).toHaveCount(0);
    expect(ms, 'the phone never waits for a scene it will not show').toBeLessThan(15_000);
  } finally { await page.close(); await context.close(); }
});
