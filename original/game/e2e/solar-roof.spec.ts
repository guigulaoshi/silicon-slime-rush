import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePathOr } from './evidence';
import { expectWorldLoaded } from './world';

/**
 * Past the rail on the Big Tech Rooftop the roof is a photovoltaic field, and it
 * must read as rows of panels, not a flat slab. SOLAR_BEFORE=1 only captures.
 */
const BEFORE = process.env.SOLAR_BEFORE === '1';
const OUT = evidencePathOr(process.env.SOLAR_OUT, 'solar-roof', BEFORE ? 'before' : 'after');
test.describe.configure({ timeout: 240_000 });

const VIEWS = [
  { name: 'chase-side', at: .21, side: -2, back: 9, up: 2.2, look: 18, yawOff: 55 },
  { name: 'high', at: .21, side: 0, back: 30, up: 22, look: 60, yawOff: 0 },
];

async function frame(page: Page, v: typeof VIEWS[number]) {
  await page.evaluate(v => {
    const g = window.game as any, s = g.session, spline = s.world.spline;
    g.timeScale = 0;
    const index = spline.indexAt(v.at * spline.length);
    const p = spline.point(index), t = spline.tangent(index);
    const right = [-t[2], 0, t[0]];
    s.racers[0].car.reset([p[0], p[1] + .6, p[2]], Math.atan2(-t[0], -t[2]));
    const a = v.yawOff * Math.PI / 180;
    const lx = t[0] * Math.cos(a) + right[0] * Math.sin(a), lz = t[2] * Math.cos(a) + right[2] * Math.sin(a);
    const cam = s.world.camera;
    s.racers[0].chase.update = () => {
      cam.position.set(p[0] - t[0] * v.back + right[0] * v.side, p[1] + v.up, p[2] - t[2] * v.back + right[2] * v.side);
      cam.lookAt(p[0] + lx * v.look, p[1], p[2] + lz * v.look);
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

test('the roof beyond the Big Tech Rooftop rail reads as photovoltaic panels', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, obstacles: false, best: {} })));
  await page.goto('/?dev=1&track=wolfe-pruneridge&bot=1&time=day&weather=clear');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'wolfe-pruneridge');
  const probe: Record<string, unknown> = {};
  for (const v of VIEWS) {
    await frame(page, v);
    await page.screenshot({ path: resolve(OUT, `${v.name}.png`) });
  }
  const roof = await page.evaluate(() => {
    const scene = (window.game as any).session.world.scene;
    const found: { name: string; material: string; maxY: number; map: boolean }[] = [];
    scene.traverse((o: any) => {
      if (!o.isMesh) return;
      const m = [].concat(o.material)[0] as any;
      if (!/solar|landmark_glass/.test(m?.name ?? '')) return;
      o.geometry.computeBoundingBox(); const box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      found.push({ name: o.name, material: m.name, maxY: box.max.y, map: !!m.map });
    });
    return found;
  });
  probe.roof = roof;
  writeFileSync(resolve(OUT, 'probe.json'), JSON.stringify(probe, null, 2));
  if (BEFORE) return;
  const solar = roof.filter(r => r.material === 'building_landmark_solar');
  const glass = roof.filter(r => r.material === 'building_landmark_glass');
  expect(solar.length, 'the streamed roof carries the photovoltaic field').toBeGreaterThan(0);
  expect(solar.every(r => r.map), 'the panel texture is loaded on the field').toBe(true);
  expect(Math.min(...solar.map(r => r.maxY)), 'nothing of the glass support caps the panels')
    .toBeGreaterThan(Math.max(...glass.map(r => r.maxY)));
});
