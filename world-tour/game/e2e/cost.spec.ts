import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';
import { checkMaximum } from '../test-support/resource-limit';

/**
 * The peak cost of the track that pays the most for a change, on demand.
 *
 * `baseline.spec.ts` photographs sydney, and sydney is mostly bridge, harbour and headland -- not
 * the *least* built-up of the new World Tour routes, but not the densest either. A change that
 * multiplies building nodes barely shows there and shows enormously on a dense city route, which is
 * nothing but blocks. This walks a whole lap and records the worst frame, so a draw-call budget can
 * be checked where it is actually spent:
 *
 *   COST_TRACK=beijing npx playwright test e2e/cost.spec.ts
 */

// 这个文件真的要开车，所以自己申请预算：默认档是 90 秒（playwright.config.ts），
// 那是「问浏览器一个问题」的价钱。四倍速走完一整圈取峰值，循环给 120 秒，超时必须红。
test.describe.configure({ timeout: 300_000 });
const OUT = evidencePath();
const writeRecord = process.env.COST_RECORD === '1';
/**
 * The track this measures when nobody says which.
 *
 * Asked for a measurement that runs by itself rather than one somebody has to remember, and
 * the only honest way to have one is to name the worst track and keep it in the suite. The
 * measurement above described the eight Bay Area tracks, all deleted along with their
 * routes, caches and landmarks; none of those numbers describe the fifteen new World Tour tracks.
 * new-york is the best guess pending a real remeasurement -- it is the one route table
 * (BRIEF/roadmap) describes as a "dense city", the same property that made twin-peaks the previous
 * worst. // RETARGET-MEASURE: run `COST_TRACK=<id> npx playwright test e2e/cost.spec.ts` with
 * COST_RECORD=1 across all fifteen tracks and replace this with whichever peaks highest.
 */
const WORST = 'new-york';
test('cost', async ({ page }) => {
  const track = process.env.COST_TRACK ?? WORST;
  await page.setViewportSize({ width: 1600, height: 900 });
  // The fixed-step driver already proves that turbo is the same route in less wall time;
  // cost depends on the rendered positions, so spending several minutes per track adds no signal.
  await page.goto(`/?track=${track}&bot=1&speed=6`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, track);
  // Accumulate inside the page on every rendered frame. Polling from Node at turbo speed can jump
  // hundreds of metres between samples and let a short dense block disappear from the denominator.
  const result = await page.evaluate(() => new Promise<{
    peak: { triangles: number; drawCalls: number; tilesLoaded: number; programs: number; textures: number };
    finished: boolean;
  }>((resolve) => {
    const peak = { triangles: 0, drawCalls: 0, tilesLoaded: 0, programs: 0, textures: 0 };
    const sample = (): void => {
      const w = window.game.session.world;
      const r = w.renderer;
      const now = {
        triangles: r.info.render.triangles, drawCalls: r.info.render.calls,
        tilesLoaded: window.game.report().tiles?.loaded ?? 0,
        programs: r.info.programs?.length ?? 0, textures: r.info.memory.textures,
        done: window.game.report().state === 'finished', time: window.game.report().time,
      };
      peak.triangles = Math.max(peak.triangles, now.triangles);
      peak.drawCalls = Math.max(peak.drawCalls, now.drawCalls);
      peak.tilesLoaded = Math.max(peak.tilesLoaded, now.tilesLoaded);
      peak.programs = Math.max(peak.programs, now.programs);
      peak.textures = Math.max(peak.textures, now.textures);
      if (now.done || now.time >= 360) resolve({ peak, finished: now.done });
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  const { peak, finished } = result;
  expect(finished, `${track} did not finish in 360 seconds of simulation`).toBe(true);
  if (writeRecord) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, `${track}.cost.json`), JSON.stringify(peak, null, 1) + '\n');
  }
  checkMaximum(peak.drawCalls, 'max_draw_calls', `${track} peak draw calls`);
  checkMaximum(peak.triangles, 'max_triangles', `${track} peak triangles`);
});
