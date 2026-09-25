import { expect, test, type Page } from '@playwright/test';
import { expectWorldLoaded } from './world';

const RUN = process.env.MOTION_QA === '1';
test.skip(!RUN, 'run with MOTION_QA=1 for focused render-motion evidence');
test.describe.configure({ timeout: 180_000 });

interface MotionSample {
  car: number[];
  camera: number[];
}

async function sampleMotion(page: Page, frames: number): Promise<MotionSample[]> {
  return page.evaluate((count) => new Promise<MotionSample[]>((resolve) => {
    const samples: MotionSample[] = [];
    const frame = () => {
      const session = window.game.session;
      samples.push({ car: session.mesh.position.toArray(), camera: session.world.camera.position.toArray() });
      if (samples.length >= count) resolve(samples);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), frames);
}

function continuity(samples: MotionSample[], key: keyof MotionSample) {
  const distances = samples.slice(1).map((sample, index) => Math.hypot(
    sample[key][0]! - samples[index]![key][0]!,
    sample[key][1]! - samples[index]![key][1]!,
    sample[key][2]! - samples[index]![key][2]!,
  ));
  const moving = distances.filter((distance) => distance > 1e-4).sort((a, b) => a - b);
  const median = moving[Math.floor(moving.length / 2)] ?? 0;
  const p95 = moving[Math.floor(moving.length * 0.95)] ?? 0;
  return {
    zeroPct: distances.filter((distance) => distance <= 1e-4).length / distances.length,
    median,
    peak: Math.max(...distances),
    peakToMedian: median > 0 ? Math.max(...distances) / median : Infinity,
    p95ToMedian: median > 0 ? p95 / median : Infinity,
  };
}

test('a real route keeps car and camera moving on every display frame', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, obstacles: false, best: {},
  })));
  // Retargeted from shoreline (deleted, "an open flat campus route"): lhasa is a flat day track,
  // just as quick to reach a steady driving speed.
  await page.goto('/?track=lhasa&bot=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing'
    && window.game.report().speedKmh > 45, null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'render motion');

  const normal = await sampleMotion(page, 90);
  const normalCar = continuity(normal, 'car');
  const normalCamera = continuity(normal, 'camera');
  expect(normalCar.zeroPct).toBeLessThan(0.08);
  expect(normalCamera.zeroPct).toBeLessThan(0.08);

  // Force alternate zero-step display frames on the same real road. The old bridge held the car
  // on those frames and jumped a whole physics step on the next one; persistent pose history keeps
  // the visible motion continuous. This changes only the QA fixture, never production timing.
  await page.evaluate(() => {
    const physics = window.game.session.physics as unknown as {
      timestep: number; world: { timestep: number };
    };
    physics.timestep = 1 / 30;
    physics.world.timestep = 1 / 30;
  });
  const zeroStep = await sampleMotion(page, 120);
  const zeroStepCar = continuity(zeroStep, 'car');
  const zeroStepCamera = continuity(zeroStep, 'camera');
  expect(zeroStepCar.zeroPct, '30 Hz physics on a 60 Hz display must not hold every other frame')
    .toBeLessThan(0.08);
  expect(zeroStepCamera.zeroPct).toBeLessThan(0.08);
  expect(zeroStepCar.p95ToMedian, 'sustained whole-step jumps may not replace display-frame motion')
    .toBeLessThan(2.2);
  expect(zeroStepCamera.p95ToMedian).toBeLessThan(2.8);
  console.log(JSON.stringify({ normal: { car: normalCar, camera: normalCamera },
    zeroStep: { car: zeroStepCar, camera: zeroStepCamera } }));
});
