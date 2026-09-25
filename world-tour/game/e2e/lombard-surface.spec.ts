import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 180_000 });

type Sample = {
  progress: number;
  carY: number;
  cameraY: number;
  verticalSpeed: number;
  pitchRollSpeed: number;
  groundY: number | null;
  groundNormal: [number, number, number] | null;
  roadY: number;
  compressions: number[];
};

const percentile = (values: number[], fraction: number): number => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] ?? 0;
};

// lombard (steep switchbacks/hairpins) -> rio (steep mountain climb with switchback hairpins, deleted
// along with machu-picchu) -> zhangjiajie, the remaining track with the same property: its
// curvature data (game/public/tracks/zhangjiajie/track.json spline.curvature) has a dense,
// near-continuous hairpin cluster from s~650 to s~1130 (480 m), computed the same way the singleFile
// threshold is in src/bot/Traffic.ts -- summed |curvature| * 2 m over a rolling 40 m window stays above
// 0.5 rad almost the whole way, only dipping briefly around s=790-820 and s=980-1000. It includes the
// s=742 hairpin (bend ~1.9 rad over that window) test/traffic.test.ts already uses as zhangjiajie's
// tightest bend.
test("251 City Pod crosses Zhangjiajie's real switchback hairpins without road or camera jolts", async ({ page }) => {
  const out = evidencePath('lombard-surface'); mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true,
    obstacles: false, slimeDensity: 'none', best: {},
  })));
  await page.goto('/?track=zhangjiajie&bot=1&dev=1&speed=6&time=day&vehicle=city-pod');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 60_000 });
  // derived: zhangjiajie (game/public/tracks/zhangjiajie/track.json) is 2141.5 m long with its dense
  // hairpin cluster running s~650-1130, so waiting for progress >= 600 still lands just ahead of the
  // switchbacks, and the 900 checkpoint below sits well inside that cluster with plenty of room before
  // the finish.
  await page.waitForFunction(() => window.game.report().progress >= 600, null, { timeout: 90_000 });
  await expectWorldLoaded(page, '251 Zhangjiajie switchback hairpins');

  await page.screenshot({ path: resolve(out, 'city-pod-hairpins.png') });
  const samples = await page.evaluate(async () => new Promise<Sample[]>((done) => {
    const values: Sample[] = [];
    const capture = () => {
      const game = window.game as any;
      const session = game.session;
      const report = game.report();
      const car = session.car;
      const velocity = car.body.linvel();
      const angular = car.body.angvel();
      const surface = session.physics.surfaceAt(car.position.x, car.position.z);
      const roadY = session.world.spline.point(session.world.spline.indexAt(report.progress))[1];
      values.push({
        progress: report.progress,
        carY: car.position.y,
        cameraY: session.world.camera.position.y,
        verticalSpeed: velocity.y,
        pitchRollSpeed: Math.hypot(angular.x, angular.z),
        groundY: surface?.point.y ?? null,
        groundNormal: surface ? [surface.normal.x, surface.normal.y, surface.normal.z] : null,
        roadY,
        compressions: car.wheels.map((wheel: any) => wheel.compression),
      });
      if (report.progress >= 900 || report.state === 'finished') done(values);
      else requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  }));

  const pairs = samples.slice(1).map((sample, index) => [samples[index]!, sample] as const);
  const compressionSteps = pairs.flatMap(([before, after]) =>
    after.compressions.map((value, wheel) => Math.abs(value - before.compressions[wheel]!)));
  const cameraSteps = pairs.map(([before, after]) => Math.abs(after.cameraY - before.cameraY));
  const cameraRideSteps = pairs.map(([before, after]) =>
    Math.abs((after.cameraY - after.carY) - (before.cameraY - before.carY)));
  const groundDots = pairs.flatMap(([before, after]) => before.groundNormal && after.groundNormal
    ? [before.groundNormal.reduce((sum, value, axis) => sum + value * after.groundNormal![axis]!, 0)] : []);
  const groundSamples = samples.filter(sample => sample.groundY !== null).length;
  const metrics = {
    samples: samples.length,
    startProgress: samples[0]?.progress ?? 0,
    endProgress: samples.at(-1)?.progress ?? 0,
    groundSamplePct: groundSamples / Math.max(samples.length, 1) * 100,
    minGroundNormalDot: Math.min(...groundDots),
    p99CompressionStepM: percentile(compressionSteps, .99),
    maxCompressionStepM: Math.max(...compressionSteps),
    p99CameraVerticalStepM: percentile(cameraSteps, .99),
    maxCameraVerticalStepM: Math.max(...cameraSteps),
    p99CameraRideStepM: percentile(cameraRideSteps, .99),
    maxCameraRideStepM: Math.max(...cameraRideSteps),
    p99VerticalSpeedMps: percentile(samples.map(sample => Math.abs(sample.verticalSpeed)), .99),
    p99PitchRollSpeed: percentile(samples.map(sample => sample.pitchRollSpeed), .99),
  };
  writeFileSync(resolve(out, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`251 Zhangjiajie surface ${JSON.stringify(metrics)}`);

  expect(metrics.samples).toBeGreaterThan(60);
  expect(metrics.endProgress).toBeGreaterThanOrEqual(900);
  expect(metrics.groundSamplePct).toBeGreaterThan(95);
  expect(metrics.minGroundNormalDot).toBeGreaterThan(.98);
  expect(metrics.p99CompressionStepM).toBeLessThan(.04);
  expect(metrics.maxCompressionStepM).toBeLessThan(.06);
  expect(metrics.p99PitchRollSpeed).toBeLessThan(.6);
  expect(metrics.p99CameraRideStepM).toBeLessThan(.8);
});
