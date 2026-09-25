import { expect, test } from '@playwright/test';
import { SAVE_KEY } from '../src/app/Save';
import { captureFrames, rendererFacts, reportDesktopFrames } from './frame-sample';
import { expectWorldLoaded } from './world';

/**
 * What the bloom-and-grade pass costs: the same desktop-high drive with it on and off (?grade=0),
 * sampled at the same stretch of road, side by side. The grade only ships if the graded run still
 * clears the desktop frame-rate floor.
 */
const TRACK = process.env.GRADE_TRACK ?? 'beijing';
// loads a world, waits up to 90 s for the race, then samples a drive: more than the 90 s default
test.describe.configure({ timeout: 240_000 });

for (const grade of ['on', 'off'] as const) {
  test(`post grade ${grade} on ${TRACK}`, { tag: '@long' }, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: SAVE_KEY, value: { version: 2, language: 'en', quality: 'high', volume: 0, muted: true, best: {} } });
    const page = await context.newPage();
    await page.goto(`/?track=${TRACK}&bot=1&time=day${grade === 'off' ? '&grade=0' : ''}`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
    await expectWorldLoaded(page, `grade ${grade}`);
    await page.waitForTimeout(3000);
    const frames = await captureFrames(page, 0, 8000, Number(process.env.GRADE_PASSES ?? 1));
    const facts = await rendererFacts(page);
    console.info(`GRADE ${grade} ${TRACK}`, JSON.stringify({ ...frames, gpu: facts.renderer }));
    await page.screenshot({ path: `test-results/post-grade-${TRACK}-${grade}.png` });
    if (!process.env.GRADE_PASSES) reportDesktopFrames(frames.fps, frames.p95Ms, `post grade ${grade}`);
    expect(frames.frames).toBeGreaterThan(100);
    await context.close();
  });
}
