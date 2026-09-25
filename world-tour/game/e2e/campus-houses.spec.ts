import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 180_000 });
test('roof driving views include the surrounding residential streets', async ({ page }) => {
  // beijing: the new loop route (game/public/tracks/beijing/track.json, mode 'loop'), replacing
  // wolfe-pruneridge as the loop this test drives around to check the surrounding buildings.
  await page.goto('/?track=beijing&bot=1&dev=1&time=day');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'campus surroundings');
  const directory = evidencePath('campus-houses', process.env.CAMPUS_STAGE ?? 'after');
  mkdirSync(directory, { recursive: true });
  const views = [];
  for (let part = 0; part < 4; part++) {
    const view = await page.evaluate(async part => {
      const g = window.game as any, s = g.session, w = s.world;
      g.phase = 'paused'; g.autopilot = false;
      const at = w.spline.length * (part + .125) / 4;
      const p = w.spline.point(w.spline.indexAt(at)), t = w.spline.tangent(w.spline.indexAt(at));
      s.car.reset([p[0], p[1] + .8, p[2]], Math.atan2(-t[0], -t[2]));
      s.mesh.position.copy(s.car.position); s.mesh.quaternion.copy(s.car.quaternion);
      for (let i = 0; i < 8; i++) {
        w.streamer.update(at, p[0], p[2]);
        while (w.streamer.stats.loading > 0) await new Promise(r => setTimeout(r, 25));
      }
      const outward = w.camera.position.clone().set(p[0], 0, p[2]).normalize();
      w.camera.position.set(p[0] - t[0] * 8, p[1] + 5.2, p[2] - t[2] * 8);
      w.camera.fov = 65; w.camera.updateProjectionMatrix();
      w.camera.lookAt(p[0] + t[0] * 45 + outward.x * 65, p[1] - 2, p[2] + t[2] * 45 + outward.z * 65);
      document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(n => n.style.display = 'none');
      w.render();
      return { part, at, position: p, camera: w.camera.position.toArray(), loaded: w.streamer.stats.loaded };
    }, part);
    expect(view.loaded).toBeGreaterThan(0); views.push(view);
    await page.screenshot({ path: resolve(directory, `view-${part}.png`) });
  }
  writeFileSync(resolve(directory, 'views.json'), JSON.stringify(views, null, 2));
});
