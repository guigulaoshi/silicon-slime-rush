import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePathOr } from './evidence';
import { expectWorldLoaded } from './world';

/**
 * Hangar One's skin must read as its own weathered metal, not as a mirror showing a sharp
 * blue sky with clouds. HANGAR_BEFORE=1 only captures.
 */
const BEFORE = process.env.HANGAR_BEFORE === '1';
const OUT = evidencePathOr(process.env.HANGAR_OUT, 'hangar-sky', BEFORE ? 'before' : 'after');
test.describe.configure({ timeout: 240_000 });
const VIEWS = [
  { name: 'apron', at: .375, side: 0, back: 14, up: 5, look: 60 },
  { name: 'close', at: .375, side: 6, back: -40, up: 2.5, look: 80 },
];

async function frame(page: Page, v: typeof VIEWS[number]) {
  await page.evaluate(v => {
    const g = window.game as any, s = g.session, spline = s.world.spline;
    g.timeScale = 0;
    const index = spline.indexAt(v.at * spline.length);
    const p = spline.point(index), t = spline.tangent(index), right = [-t[2], 0, t[0]];
    s.racers[0].car.reset([p[0], p[1] + .6, p[2]], Math.atan2(-t[0], -t[2]));
    const cam = s.world.camera;
    s.racers[0].chase.update = () => {
      cam.position.set(p[0] - t[0] * v.back + right[0] * v.side, p[1] + v.up, p[2] - t[2] * v.back + right[2] * v.side);
      cam.lookAt(p[0] + t[0] * v.look, p[1] + 8, p[2] + t[2] * v.look);
      cam.fov = 58; cam.updateProjectionMatrix();
    };
  }, v);
  for (let i = 0; i < 40; i++) {
    const tiles = await page.evaluate(() => window.game.report().tiles);
    if (tiles && tiles.loading === 0 && tiles.loaded > 0) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  await expectWorldLoaded(page, v.name);
}

test('Hangar One skin shows metal, not a mirrored sky', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, obstacles: false, best: {} })));
  await page.goto('/?dev=1&track=moffett-field&bot=1&time=day&weather=clear');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'moffett-field');
  for (const v of VIEWS) { await frame(page, v); await page.screenshot({ path: resolve(OUT, `${v.name}.png`) }); }
  const skin = await page.evaluate(() => {
    const found: Record<string, { metalness: number; roughness: number }> = {};
    (window.game as any).session.world.scene.traverse((o: any) => {
      for (const m of [].concat(o.material ?? []) as any[])
        if (/^hangar-one_/.test(m?.name ?? '')) found[m.name] = { metalness: m.metalness, roughness: m.roughness };
    });
    return found;
  });
  writeFileSync(resolve(OUT, 'materials.json'), JSON.stringify(skin, null, 2));
  expect(Object.keys(skin).length, 'Hangar One is loaded').toBeGreaterThan(3);
  if (BEFORE) return;
  // A large, nearly smooth metal skin mirrors the baked sky; the visible cladding stays matte.
  for (const name of ['hangar-one_shell', 'hangar-one_aluminium', 'hangar-one_rib'])
    expect(skin[name]!.roughness, `${name} is too glossy to hide the sky reflection`).toBeGreaterThanOrEqual(.55);
});
