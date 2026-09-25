import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

/**
 * A small and a large bomb burst side by side on the road, photographed a fifth of a second
 * after they go off. Run on a build before and after the change to compare; the counts come from the
 * live particle buffer, so a black droplet would show up as a number, not only as pixels.
 */
const OUT = evidencePath('burst-sparks');
test.describe.configure({ timeout: 180_000 });

test('a small and a large bomb burst into sparks sized by the body', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, best: {} })));
  await page.goto('/?dev=1&track=synth-p2p&bot=1&time=day&weather=clear');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'burst sparks');
  for (const time of ['day', 'night'] as const) {
    if (time === 'night') {
      await page.goto('/?dev=1&track=synth-p2p&bot=1&time=night&weather=clear');
      await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
    }
    const counts = await page.evaluate(() => {
      const game = window.game as any, s = game.session, layer = s.slimes, effects = layer.effects, world = s.world;
      game.timeScale = 0;
      const car = s.car.body.translation(), camera = world.camera;
      const THREE = camera.position.constructor;
      const forward = new THREE(0, 0, -1).applyQuaternion(s.car.body.rotation());
      const right = new THREE(1, 0, 0).applyQuaternion(s.car.body.rotation());
      const ahead = new THREE(car.x, car.y, car.z).addScaledVector(forward, 26);
      const ground = ahead.clone(); ground.y -= .6;
      const up = new THREE(0, 1, 0);
      const before = effects.nextParticle;
      const small = ahead.clone().addScaledVector(right, -5), big = ahead.clone().addScaledVector(right, 6);
      effects.emit('burst', small, ground.clone().addScaledVector(right, -5), up, 0, forward.clone().multiplyScalar(-8), .8);
      const afterSmall = effects.nextParticle;
      effects.emit('burst', big, ground.clone().addScaledVector(right, 6), up, 0, forward.clone().multiplyScalar(-8), 4);
      let black = 0;
      const colours = effects.particles.instanceColor.array as Float32Array;
      for (let i = before; i < effects.nextParticle; i++)
        if (colours[i * 3]! < .05 && colours[i * 3 + 1]! < .05 && colours[i * 3 + 2]! < .06) black++;
      camera.position.set(car.x, car.y + 3, car.z).addScaledVector(forward, 4);
      camera.lookAt(ahead.x, ahead.y + 2, ahead.z);
      s.chase.update = () => undefined;
      layer.update(.22);
      return { small: afterSmall - before, big: effects.nextParticle - afterSmall, black };
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(OUT, `${time}-small-left-big-right.png`) });
    expect(counts.big, `${time}: the big bomb throws more sparks`).toBeGreaterThan(counts.small);
    expect(counts.black, `${time}: no black droplet particles`).toBe(0);
  }
});
