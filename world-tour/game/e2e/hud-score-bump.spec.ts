import { expect, test } from '@playwright/test';

/**
 * The score pop stays in its own space.
 *
 * Found it in a store screenshot: every point scored plays `hud-score-bump`, and a centred
 * 1.28 scale reached across the 12 px gap and printed "3543Slimes · 5" as one word. The animation is
 * still there; what this holds is that at its widest the score cannot touch the hits label beside it.
 */
// 这个文件要加载一条合成赛道，所以自己申请预算：默认档是 90 秒（playwright.config.ts）。
test.describe.configure({ timeout: 180_000 });

test('the score pop never reaches the hits label', async ({ page }) => {
  await page.goto('/?track=synth-loop&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  const measured = await page.evaluate(async () => {
    const score = document.querySelector('.hud-score') as HTMLElement;
    const hits = document.querySelector('.hud-hits') as HTMLElement;
    // The score the store screenshot was taken at: a four-figure score is what made the pop reach, and
    // a fresh synthetic lap only ever shows one digit.
    score.textContent = 'Score · 3543';
    hits.textContent = 'Slimes · 5';
    score.classList.remove('bump'); void score.offsetWidth; score.classList.add('bump');
    // 45% of a 300 ms animation is the widest frame.
    await new Promise(done => setTimeout(done, 135));
    const grown = score.getBoundingClientRect(), beside = hits.getBoundingClientRect();
    return { right: grown.right, left: beside.left, width: grown.width };
  });
  expect(measured.width, 'the pop really did grow').toBeGreaterThan(0);
  expect(measured.right, 'the widest score frame stays left of the hits label').toBeLessThan(measured.left);
});
