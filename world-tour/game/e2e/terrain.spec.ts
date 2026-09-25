import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 180_000 });

test('roadside terrain stays connected in snow and daylight', async ({ page }) => {
  const out = evidencePath('terrain');
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 742 });
  /* */
  for (const [track, at, weather] of [
    ['sydney', 2305, 'snow'], ['sydney', 2305, 'clear'],
    ['zhangjiajie', 1300, 'clear'], ['zhangjiajie', 500, 'snow'],
  ] as const) {
    await page.goto(`/?track=${track}&bot=1&dev=1&time=day&weather=${weather}&slimes=off`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    await expectWorldLoaded(page, `${track} roadside`);
    await page.evaluate(async distance => {
      const g = window.game as any, s = g.session, w = s.world;
      g.phase = 'paused'; g.autopilot = false;
      const i = w.spline.indexAt(distance), p = w.spline.point(i), t = w.spline.tangent(i);
      for (let n = 0; n < 10; n++) {
        w.streamer.update(distance, p[0], p[2]);
        while (w.streamer.stats.loading) await new Promise(r => setTimeout(r, 25));
      }
      s.mesh.visible = false;
      s.mesh.position.set(p[0], p[1], p[2]);
      w.camera.position.set(p[0] - t[0] * 8, p[1] + 3, p[2] - t[2] * 8);
      w.camera.lookAt(p[0] + t[0] * 80, p[1] + 2, p[2] + t[2] * 80);
      w.sky.follow(p[0], p[1], p[2]);
      w.camera.fov = 68; w.camera.updateProjectionMatrix();
      document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(e => e.style.display = 'none');
      w.render();
    }, at);
    await expectWorldLoaded(page, `${track} roadside at ${at} m`);
    await page.screenshot({ path: resolve(out, `${process.env.TERRAIN_CAPTURE ?? 'after'}-${track}-${weather}.png`) });
  }
});
