import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { expectWorldLoaded } from './world';

const OUT = evidencePath('roads');
test.skip(process.env.ROADS_QA !== '1', 'full-route video and authored geometry inspection');
test.describe.configure({ timeout: 1_200_000 });

for (const [track, distance, label] of [
  ['goldengate', 4180, 'golden-curve'], ['lombard', 1350, 'lombard-curve'],
  ['shoreline', 2210, 'shoreline-curve'],
] as const) test(`217 ${label}`, async ({ page }) => {
  await page.goto(`/?track=${track}&bot=1&dev=1&time=day`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await page.evaluate(({ at, track }) => {
    const g = window.game as any;
    g.show('paused');
    const s = g.session, w = s.world, index = w.spline.indexAt(at), p = w.spline.point(index);
    w.follow(at, p[0], p[1], p[2]);
    const t = w.spline.tangent(index), r = w.spline.right(index);
    s.car.reset([p[0], p[1] + .8, p[2]], Math.atan2(-t[0], -t[2]));
    s.model.group.position.copy(s.car.position); s.model.group.quaternion.copy(s.car.quaternion);
    w.camera.position.set(p[0] - t[0] * 45 + r[0] * 25, p[1] + 36, p[2] - t[2] * 45 + r[2] * 25);
    w.camera.lookAt(p[0] + t[0] * 20, p[1], p[2] + t[2] * 20);
    if (track === 'lombard') {
      w.camera.position.set(p[0] - t[0] * 20, p[1] + 100, p[2] - t[2] * 20);
      w.camera.lookAt(p[0], p[1], p[2]);
    }
    w.camera.fov = 65; w.camera.updateProjectionMatrix();
    document.querySelectorAll<HTMLElement>('#ui,.touch-controls').forEach(n => n.style.display = 'none');
  }, { at: distance, track });
  await page.waitForFunction(() => {
    const stats = (window.game as any).session.world.streamer.stats;
    return stats.loaded > 0 && stats.loading === 0;
  });
  await expectWorldLoaded(page, label);
  await page.evaluate(() => (window.game as any).session.world.render());
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, `${label}.png`) });
});
