import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

// After a splash the streaks stay on the paint and glass; through the glass the seats and
// cabin floor are clean. One chase-view close-up per vehicle, through the rear window.
test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 960, height: 540 } });
const OUT = evidencePath(process.env.COAT_380_LABEL ? `body-coat-${process.env.COAT_380_LABEL}` : 'body-coat');

test('every vehicle takes the slime coat on its shell, not inside the cabin', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ language: 'en', quality: 'high', muted: true })));
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'shoreline', car: 'sedan', playerVehicles: ['lightweight-sports'],
    slimeDensity: 'normal', timeOfDay: 'day', weather: 'clear', ai: true }, true))).toBe(true);
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, 'body-coat');
  await page.waitForTimeout(1500);
  const ids: string[] = await page.evaluate(() => {
    const game = window.game as any, session = game.session;
    game.phase = 'paused';
    for (const racer of session.racers) racer.model.splashBody(new (racer.mesh.position.constructor)(0, 1.2, -2.2), 22, undefined, 5);
    return session.racers.map((r: any) => r.vehicle.id);
  });
  await page.waitForTimeout(600);
  for (const [index, id] of ids.entries()) {
    await page.evaluate(index => {
      const session = (window.game as any).session, racer = session.racers[index], group = racer.model.group, body = racer.model.body;
      const camera = session.world.camera;
      // A chase view from behind: the rear glass and, through it, the seats.
      const eye = group.localToWorld(group.position.clone().set(.2, body.size[1] * .55 + .7, body.size[2] * .5 + 2.4));
      const target = group.localToWorld(group.position.clone().set(0, body.size[1] * .2, 0));
      camera.position.copy(eye); camera.lookAt(target); camera.fov = 45; camera.updateProjectionMatrix();
    }, index);
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(OUT, `${id}.png`) });
  }
});
