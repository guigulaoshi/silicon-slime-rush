import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { evidencePath } from './evidence';

// The shortened US 101 passes the Moffett hangar, and the southbound carriageway beyond
// the median is drawn as real lanes rather than disappearing under the ground.
test.describe.configure({ timeout: 300_000, mode: 'serial' });
const OUT = evidencePath('bayshore');
// Hangar One's footprint centre in bayshore-101's local frame (origin 37.44, -122.11).
const HANGAR = [4958, 30, 2998] as const;

async function park(page: Page, at: number, lateral: number, turn: number): Promise<void> {
  await page.evaluate(({ at, lateral, turn }) => {
    const g = window.game as any, s = g.session, w = s.world;
    g.autopilot = false;
    const i = w.spline.indexAt(at), p = w.spline.point(i), t = w.spline.tangent(i), r = w.spline.right(i);
    s.car.reset([p[0] + r[0] * lateral, p[1] + .8, p[2] + r[2] * lateral], Math.atan2(-t[0], -t[2]) + turn);
    s.race.reacquire(p[0], p[2]); s.chase.reset();
  }, { at, lateral, turn });
  await page.waitForTimeout(2500);
  await page.waitForFunction(() => (window.game.report().tiles?.loading ?? 1) === 0, null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?track=bayshore-101&bot=1&dev=1&time=day');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 120_000 });
  mkdirSync(OUT, { recursive: true });
});

test('the hangar is in view from the northbound lanes near the start', async ({ page }) => {
  await park(page, 500, 0, 0);
  const view = await page.evaluate(hangar => {
    const w = window.game.session.world, c = w.camera;
    c.updateMatrixWorld();
    const v = c.position.clone().set(hangar[0], hangar[1], hangar[2]).project(c);
    return { x: v.x, y: v.y, z: v.z };
  }, HANGAR);
  // Replaced the pipeline's backdrop hangar with the authored hangar-one GLB landmark, so
  // count the vertices of that loaded model rather than a backdrop node name that no longer exists.
  await page.waitForFunction(() => !!window.game.session.world.landmarks.root.getObjectByName('hangar-one'));
  const landmarkVertices = await page.evaluate(() => {
    let count = 0;
    window.game.session.world.landmarks.root.getObjectByName('hangar-one')!.traverse((o: any) => {
      if (o.isMesh) count += o.geometry.getAttribute('position')?.count ?? 0;
    });
    return count;
  });
  await page.screenshot({ path: resolve(OUT, 'hangar-from.png') });
  expect(landmarkVertices, 'the hangar-one landmark model is loaded on this route').toBeGreaterThan(1000);
  expect(Math.abs(view.x), 'hangar horizontally inside the chase view').toBeLessThan(1);
  expect(Math.abs(view.y), 'hangar vertically inside the chase view').toBeLessThan(1);
  expect(view.z).toBeLessThan(1);
});

test('the southbound carriageway is level asphalt beyond the median', async ({ page }) => {
  const records = [];
  for (const at of [3000, 9000, 14000]) {
    await park(page, at, -9, 0.35);
    const record = await page.evaluate(at => {
      const w = window.game.session.world, i = w.spline.indexAt(at), p = w.spline.point(i);
      const t = w.spline.tangent(i), r = w.spline.right(i);
      const lefts: number[] = [], drops: number[] = [];
      w.streamer.root.updateMatrixWorld(true);
      w.streamer.root.traverse((o: any) => {
        if (!o.isMesh || o.material?.name !== 'road') return;
        const a = o.geometry.getAttribute('position'), e = o.matrixWorld.elements;
        for (let k = 0; k < a.count; k++) {
          const x = a.getX(k), y = a.getY(k), z = a.getZ(k);
          const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13];
          const wz = e[2] * x + e[6] * y + e[10] * z + e[14], dx = wx - p[0], dz = wz - p[2];
          if (Math.abs(dx * t[0] + dz * t[2]) > 12) continue;
          const lateral = dx * r[0] + dz * r[2];
          if (lateral < -12.5 && lateral > -45) { lefts.push(lateral); drops.push(wy - p[1]); }
        }
      });
      return { at, vertices: lefts.length, nearest: Math.max(...lefts), farthest: Math.min(...lefts),
        lowest: Math.min(...drops), highest: Math.max(...drops) };
    }, at);
    records.push(record);
    await page.screenshot({ path: resolve(OUT, `southbound-${at}.png`) });
  }
  writeFileSync(resolve(OUT, 'southbound.json'), JSON.stringify(records, null, 2));
  for (const record of records) {
    expect(record.vertices, `${record.at} m: opposite carriageway present`).toBeGreaterThan(4);
    expect(record.nearest - record.farthest, `${record.at} m: opposite carriageway width`).toBeGreaterThan(9);
    expect(record.lowest, `${record.at} m: opposite carriageway not sunk below the freeway`).toBeGreaterThan(-0.4);
    expect(record.highest).toBeLessThan(0.4);
  }
});
