import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { CATALOGUE } from '../src/app/tracks';
import { baselinePath, evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 240_000 });
type FacadeView = { at: number; centre: number[]; normal: number[] };
test('roofline windows remain stable from nearby moving viewpoints', async ({ page }) => {
  const out = evidencePath('windows');
  mkdirSync(out, { recursive: true });
  const before = process.env.WINDOW_CAPTURE === 'before';
  const referencePath = baselinePath('windows', 'views.json');
  const views: Record<string, FacadeView> = before && !existsSync(referencePath) ? {}
    : JSON.parse(readFileSync(referencePath, 'utf8'));
  const scenes = [...CATALOGUE.map(({ id }) => ({ track: id, key: id, weather: 'clear',
    time: id === 'twin-peaks' ? 'night' : 'day' })),
    { track: 'twin-peaks', key: 'twin-peaks-snow', weather: 'snow', time: 'day' }];
  for (const { track, key, weather, time } of scenes) {
    await page.goto(`/?track=${track}&bot=1&dev=1&time=${time}&weather=${weather}&direction=${track === 'twin-peaks' ? 'reverse' : 'forward'}`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    const view = await page.evaluate(async ({ reference }): Promise<FacadeView | null> => {
      const g = window.game as any, s = g.session, w = s.world;
      g.phase = 'paused'; g.autopilot = false;
      let selected: typeof reference = null, closest = Infinity;
      for (const fraction of reference ? [reference.at / w.spline.length] : [.35, .08, .65, .9]) {
      const at = w.spline.length * fraction;
      const i = w.spline.indexAt(at), p = w.spline.point(i);
      for (let pass = 0; pass < 10; pass++) {
        w.streamer.update(at, p[0], p[2]);
        while (w.streamer.stats.loading) await new Promise(r => setTimeout(r, 25));
      }
      s.mesh.visible = false; s.mesh.position.set(...p);
      w.streamer.root.updateMatrixWorld(true);
      w.streamer.root.traverse((o: any) => {
        if (!o.isMesh || !o.name.includes('building')) return;
        const a = o.geometry.attributes.position, n = o.geometry.attributes.normal;
        const uv = o.geometry.attributes.uv, indices = o.geometry.index;
        if (!a || !n || !uv || !indices) return;
        for (let k = 0; k < indices.count; k += 3) {
          const ids = [indices.getX(k), indices.getX(k + 1), indices.getX(k + 2)];
          if (!ids.every(v => Math.abs(n.getY(v)) < .1 && Math.abs(uv.getX(v) - .02) < .001
            && Math.abs(uv.getY(v) - .02) < .001)) continue;
          const centre = w.camera.position.clone().set(0, 0, 0);
          for (const v of ids) centre.add(w.camera.position.clone().set(a.getX(v), a.getY(v), a.getZ(v)));
          centre.multiplyScalar(1 / 3).applyMatrix4(o.matrixWorld);
          const normal = centre.clone().set(n.getX(ids[0]), n.getY(ids[0]), n.getZ(ids[0]))
            .transformDirection(o.matrixWorld);
          if (reference) {
            if (centre.distanceTo(centre.clone().fromArray(reference.centre)) < .1
              && normal.dot(normal.clone().fromArray(reference.normal)) > .99) selected = reference;
            continue;
          }
          const distance = Math.hypot(centre.x - p[0], centre.z - p[2]);
          if (distance < 8 || distance > 600 || centre.y < p[1] - 40 || centre.y > p[1] + 80
            || (p[0] - centre.x) * normal.x + (p[2] - centre.z) * normal.z < 0) continue;
          if (distance < closest) { closest = distance; selected = { at, centre: centre.toArray(), normal: normal.toArray() }; }
        }
      });
      if (selected) break;
      }
      document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(e => e.style.display = 'none');
      return selected ?? null;
    }, { reference: views[key] ?? null });
    expect(view, `${track}: a real roof fascia must be found`).not.toBeNull();
    views[key] = view!;
    await expectWorldLoaded(page, `${track} roof facade`);
    for (const [index, offset] of [0, .18].entries()) {
      await page.evaluate(({ centre: c, normal: n, offset }) => {
        const w = window.game.session.world;
        w.camera.position.set(c[0]! + n[0]! * 8 + offset, c[1]! + 1.5, c[2]! + n[2]! * 8);
        w.camera.lookAt(c[0]!, c[1]! - 2, c[2]!);
        w.camera.fov = 60; w.camera.updateProjectionMatrix(); w.render();
      }, { ...view!, offset });
      await page.screenshot({ path: resolve(out, `${before ? 'before' : 'after'}-${key}-${index}.png`) });
    }
  }
  writeFileSync(resolve(out, 'views.json'), JSON.stringify(views, null, 2));
});
