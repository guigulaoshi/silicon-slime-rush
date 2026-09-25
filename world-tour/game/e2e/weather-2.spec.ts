import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';
import type { TimeOfDay } from '../src/track/types';

test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1280, height: 720 } });
const OUT = evidencePath('weather-2');

// rio is replaced here by zhangjiajie, the remaining
// switchback mountain climb (see the retarget brief in e2e/lombard-surface.spec.ts).
test("shows day and night snow and completes zhangjiajie's switchback mountain climb with reduced grip", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const reports: Record<string, unknown> = {};
  const open = async (time: TimeOfDay) => {
    await page.goto(`/?dev=1&track=zhangjiajie&bot=1&speed=12&time=${time}&weather=snow`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    await expectWorldLoaded(page, `${time}-snow`);
    const report = await page.evaluate(() => window.game.report());
    expect(report.sky).toMatchObject({ weather: 'snow', rainStreaks: 0, snowFlakes: 900, lightning: 0 });
    expect(report.weatherSound).toBe('snow');
    expect(report.weatherGrip).toBe(.62);
    reports[time] = report;
    await page.screenshot({ path: resolve(OUT, `${time}-snow.png`) });
  };

  await open('day');
  await open('night');
  await page.waitForFunction(() => window.game.report().state === 'finished', undefined, { timeout: 150_000 });
  const finish = await page.evaluate(() => window.game.report());
  expect(finish.totalCheckpoints).toBeGreaterThan(0);
  expect(finish.checkpoints).toBe(finish.totalCheckpoints);
  expect(finish.resets).toBe(0);
  expect(finish.tiles?.failed).toBe(0);
  reports.finish = finish;
  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(reports, null, 2) + '\n');
});
