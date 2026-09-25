import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

// Close-ups of every vehicle's tail lamps (brake off and on) and, at night, its headlamps.
// The alignment itself is asserted against the models in test/vehicle-lamps.test.ts.
test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 960, height: 540 } });
const OUT = evidencePath(process.env.LAMPS_379_LABEL ? `vehicle-lamps-${process.env.LAMPS_379_LABEL}` : 'vehicle-lamps');

async function start(page: Page, timeOfDay: 'day' | 'night') {
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ language: 'en', quality: 'high', muted: true })));
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  expect(await page.evaluate(timeOfDay => window.game.startRace({ trackId: 'shoreline', car: 'sedan', playerVehicles: ['lightweight-sports'],
    slimeDensity: 'none', timeOfDay, weather: 'clear', ai: true }, true), timeOfDay)).toBe(true);
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, `lamps-${timeOfDay}`);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { (window.game as any).phase = 'paused'; });
  return page.evaluate(() => (window.game as any).session.racers.map((r: any) => r.vehicle.id) as string[]);
}

/** Point the camera at one end of a racer's rig (the trailer's tail for a tow) and set its brake. */
async function frame(page: Page, index: number, end: 'tail' | 'head', braking: number) {
  await page.evaluate(({ index, end, braking }) => {
    const session = (window.game as any).session, racer = session.racers[index];
    racer.car.braking = braking;
    if (racer.trailer) racer.trailer.car.braking = braking;
    racer.render(1, 1 / 60);
    const model = end === 'tail' && racer.trailerModel ? racer.trailerModel : racer.model;
    const group = model.group, body = model.body;
    const lamps = end === 'tail' ? body.lights.brakeLights : body.lights.headlights.filter((l: any) => l.mount !== 'roof');
    const y = lamps.reduce((sum: number, l: any) => sum + l.position[1], 0) / lamps.length;
    const z = lamps[0].position[2];
    const camera = session.world.camera;
    const target = group.localToWorld(group.position.clone().set(0, y, z));
    const eye = group.localToWorld(group.position.clone().set(.35, y + .45, z + Math.sign(z) * (body.size[0] * 1.6 + .8)));
    camera.position.copy(eye); camera.lookAt(target); camera.fov = 40; camera.updateProjectionMatrix();
  }, { index, end, braking });
  await page.waitForTimeout(120);
}

for (const timeOfDay of ['day', 'night'] as const) {
  test(`every vehicle's lamp glows sit on its lamps (${timeOfDay})`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    const ids = await start(page, timeOfDay);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [index, id] of ids.entries()) {
      for (const braking of [0, 1]) {
        await frame(page, index, 'tail', braking);
        await page.screenshot({ path: resolve(OUT, `${timeOfDay}-${id}-tail-${braking ? 'brake' : 'idle'}.png`) });
      }
      if (timeOfDay === 'night') {
        await frame(page, index, 'head', 0);
        await page.screenshot({ path: resolve(OUT, `night-${id}-head.png`) });
      }
    }
  });
}
