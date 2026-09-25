import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { rendererFacts, SOFTWARE_RENDERER } from './frame-sample';

test.describe.configure({ timeout: 120_000 });

test.skip(process.env.PERF_REAL_GPU !== '1', 'startup latency needs the real GPU');
test('first thirty seconds after loading avoid a startup stall', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ language: 'en', quality: 'high', muted: true }));
    const w = window as any;
    const data = w.startup338 = { frames: [] as any[], shaders: [] as any[], tasks: [] as any[], started: 0, done: false };
    new PerformanceObserver(list => data.tasks.push(...list.getEntries().map(e => ({ at: e.startTime, ms: e.duration }))))
      .observe({ type: 'longtask', buffered: true });
    for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['compileShader', 'linkProgram'] as const) {
        const original = prototype[name] as Function;
        (prototype as any)[name] = function (...args: unknown[]) {
          const at = performance.now();
          const result = original.apply(this, args);
          data.shaders.push({ name, at, ms: performance.now() - at, phase: w.game?.phase });
          return result;
        };
      }
    }
    let previous = 0;
    const sample = (at: number) => {
      const game = w.game;
      if (game?.session && ['intro', 'countdown', 'racing'].includes(game.phase)) {
        if (!data.started) data.started = at;
        if (previous) data.frames.push({ at, ms: at - previous, phase: game.phase,
          tiles: game.session.world.streamer.stats, programs: game.session.world.renderer.info.programs.length });
        if (at - data.started >= 30_000) { data.done = true; return; }
        previous = at;
      } else previous = 0;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto('/?track=dubai&bot=1&dev=1&speed=1&time=day');
  await page.waitForFunction(() => (window as any).startup338.done, null, { timeout: 90_000 });
  const facts = await rendererFacts(page);
  expect(facts.renderer).not.toMatch(SOFTWARE_RENDERER);
  const data = await page.evaluate(() => ({ ...(window as any).startup338,
    resources: performance.getEntriesByType('resource').map(e => ({ name: e.name, at: e.startTime, ms: e.duration })),
    report: window.game.report() }));
  const frames = data.frames as { at: number; ms: number }[];
  expect(frames.length).toBeGreaterThan(600);
  const worst = [...frames].sort((a, b) => b.ms - a.ms).slice(0, 10);
  const out = evidencePath('startup-stutter');
  mkdirSync(out, { recursive: true });
  const stage = process.env.STUTTER_STAGE ?? 'after';
  writeFileSync(resolve(out, stage + '.json'), JSON.stringify({ facts, worst, ...data }, null, 2));
  await page.screenshot({ path: resolve(out, stage + '.png') });
  console.log('startup', stage, JSON.stringify({ frames: frames.length, worst }));
  if (stage !== 'before') expect(worst[0]!.ms).toBeLessThanOrEqual(100);
});
