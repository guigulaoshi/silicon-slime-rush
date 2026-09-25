import { expect, test } from '@playwright/test';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

/**
 * Fog is air, not a white wall at 220 m. The browser proves the layered model is what the
 * real renderer compiled for the streamed city, and records a drive through it for review.
 */
const OUT = evidencePath('fog');
test.describe.configure({ timeout: 240_000 });

test('fog weather renders the layered fog model on a streamed city drive', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const video = page.video()!;
  try {
    await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
      version: 1, language: 'en', quality: 'high', volume: 0, muted: true, obstacles: true, best: {} })));
    // new-york: a dense streamed city (game/public/tracks/new-york/track.json), replacing
    // fishermans-wharf as the streamed-city fog test bed.
    await page.goto('/?dev=1&track=new-york&bot=1&speed=1&time=day&weather=fog');
    await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
    await expectWorldLoaded(page, 'new-york fog');
    const compiled = await page.evaluate(() => {
      const w = (window.game as any).session.world; const gl = w.renderer.getContext() as WebGL2RenderingContext;
      let layered = 0, fogged = 0;
      for (const info of w.renderer.info.programs ?? []) {
        const source = (gl.getAttachedShaders(info.program) ?? []).map(s => gl.getShaderSource(s) ?? '').join('\n');
        if (/\bUSE_FOG\b/.test(source) && source.includes('fogFar')) fogged++;
        if (source.includes('srLayeredFog(')) layered++;
      }
      return { layered, fogged, far: w.scene.fog.far };
    });
    expect(compiled.far).toBeLessThanOrEqual(220);
    expect(compiled.fogged, 'some streamed material is fogged at all').toBeGreaterThan(0);
    expect(compiled.layered, 'every fogged program carries the layered model').toBe(compiled.fogged);
    await page.screenshot({ path: resolve(OUT, 'new-york-day-start.png') });
    await page.waitForFunction(() => window.game.report().progress > 350, null, { timeout: 120_000 });
    await page.screenshot({ path: resolve(OUT, 'new-york-day-350m.png') });
    const report = await page.evaluate(() => window.game.report());
    expect(report.resets).toBe(0);
    writeFileSync(resolve(OUT, 'fog-drive.json'), JSON.stringify({ compiled, progress: report.progress, time: report.time }, null, 2));
  } finally {
    await context.close();
    renameSync(await video.path(), resolve(OUT, 'new-york-fog-drive.webm'));
  }
});
