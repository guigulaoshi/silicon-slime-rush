import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { expectWorldLoaded } from './world';

/**
 * A picture of one spot on one track, on demand:
 *
 *   SHOT_TRACK=zhangjiajie SHOT_AT=742 SHOT_NAME=01-hairpins npx playwright test e2e/shot.spec.ts
 *
 * SHOT_TIME=day|night overrides the track's own time of day.
 *
 * SHOT_W and SHOT_H widen the frame when the picture has to be compared against one a player sent
 * in: a bug report off an ultrawide monitor shows a third more of the road than 1280x720 does, and
 * the building being complained about is usually in the part that is missing.
 *
 * The baseline suite photographs sydney on a fixed list; this is for looking at anywhere else
 * without editing that list. It does nothing at all unless it is asked for.
 */

// 这个文件真的要开车，所以自己申请预算：默认档是 90 秒（playwright.config.ts），
// 那是「问浏览器一个问题」的价钱。开到指定里程再截图，跑的是真实路线。
// 480 秒而不是 300：这个文件里三个写死的等待加起来是 90+120+240=450 秒，预算比它们小的话，
// 先说话的永远是「测试超时」，而它说不出是哪一步没成——实测这个文件跑到过 179 秒。
test.describe.configure({ timeout: 480_000 });
/* */
const OUT = evidencePath('shots');
test.skip(!process.env.SHOT_TRACK, 'no SHOT_TRACK asked for');
test('shot', async ({ page }) => {
  const track = process.env.SHOT_TRACK!;
  const at = Number(process.env.SHOT_AT ?? 100);
  await page.setViewportSize({ width: Number(process.env.SHOT_W ?? 1280), height: Number(process.env.SHOT_H ?? 720) });
  // SHOT_TIME=day photographs a night route in daylight: the player picks the time now,
  // so appearance work is judged in both and the two night routes were only ever seen in the dark.
  const time = process.env.SHOT_TIME ? `&time=${process.env.SHOT_TIME}` : '';
  await page.goto(`/?track=${track}&bot=1${time}`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  // On a circuit the start line is the seam, where the projection reads a whole lap rather than
  // none: without waiting for it to wrap, every "shot at 400 m" is a shot of the start line.
  await page.waitForFunction(() => window.game.report().progress < 60, null, { timeout: 120_000 });
  // Under the file's own budget on purpose: a wait as long as the test itself can never report
  // "the car never got there", only "the test ran out of time", which says nothing about why.
  await page.waitForFunction((s) => window.game.report().progress >= s, at, { timeout: 240_000 });
  await expectWorldLoaded(page, `${track} at ${at} m`);
  mkdirSync(resolve(OUT, track), { recursive: true });
  writeFileSync(resolve(OUT, track, `${process.env.SHOT_NAME}.png`), await page.screenshot());
});
