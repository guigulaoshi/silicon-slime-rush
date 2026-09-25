import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';

test.skip(process.env.SLIME_IMPACT_QA !== '1', 'run with SLIME_IMPACT_QA=1');
test.describe.configure({ timeout: 180_000 });

const SHOT_DIR = evidencePath('shots', 'synth-loop');

test('burst feedback shakes without smearing, and a popper smear is wiped open as a fan', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { rumble: Record<string, number>[] }).rumble = [];
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [{ vibrationActuator: {
        playEffect: (_type: string, effect: Record<string, number>) => {
          (window as unknown as { rumble: Record<string, number>[] }).rumble.push(effect);
          return Promise.resolve();
        },
      } }],
    });
    localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
      version: 1, language: 'en', quality: 'high', volume: 0, muted: true,
      obstacles: true, best: {},
    }));
  });
  await page.goto('/?track=synth-loop&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'slime burst feedback');
  const sameFrame = await page.evaluate(() => {
    const game = window.game as unknown as { session: any; phase: string };
    game.session.slimes.feedback.hit('burst');
    const overlay = document.querySelector<HTMLElement>('.slime-windshield')!;
    return { feedback: window.game.report().slimes!.feedback, opacity: overlay.style.opacity,
      rumble: (window as unknown as { rumble: Record<string, number>[] }).rumble };
  });
  // A bomb is flash, shake and rumble -- nothing black on the glass.
  expect(sameFrame.feedback).toMatchObject({ cameraShake: true, windshield: false,
    cameraShakeMs: 250, windshieldMs: 0, vibrationAttempts: 1 });
  expect(sameFrame.opacity).toBe('0');
  expect(sameFrame.rumble[0]).toMatchObject({ duration: 300, weakMagnitude: 0.8 });
  await page.waitForFunction(() => !window.game.report().slimes!.feedback.cameraShake);
  await page.evaluate(() => (window.game as unknown as { session: any }).session.slimes.feedback.hit('popper'));
  /* */
  await page.waitForFunction(() => {
    const feedback = window.game.report().slimes!.feedback;
    return !feedback.cameraShake && feedback.windshield && feedback.windshieldMs < 900;
  });
  const swept = await page.evaluate(() => ({
    feedback: window.game.report().slimes!.feedback,
    mask: document.querySelector<HTMLElement>('.slime-windshield')!.style.maskImage,
  }));
  expect(swept.feedback.cameraShake).toBe(false);
  expect(swept.feedback.windshield).toBe(true);
  expect(swept.mask).toContain('conic-gradient');
  await page.waitForFunction(() => !window.game.report().slimes!.feedback.windshield);

  // Freeze the game and replay the same feedback at exact times for inspectable evidence frames.
  await page.evaluate(() => {
    const game = window.game as unknown as { session: any; phase: string };
    game.phase = 'paused';
    game.session.slimes.feedback.hit('popper');
  });
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOT_DIR, 'impact-smear.png') });
  await page.evaluate(() => {
    const game = window.game as unknown as { session: any };
    game.session.slimes.feedback.update(0.3, game.session.world.camera);
  });
  await page.screenshot({ path: resolve(SHOT_DIR, 'impact-wiped.png') });
});
