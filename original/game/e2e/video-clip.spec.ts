import { expect, test, devices } from '@playwright/test';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';



/**
 * A rolling watermarked video of the drive, saved from the pause page or the results.
 * It is the only save on offer now, and it prefers mp4 over WebM -- a WebM cannot go on a
 * phone's camera roll and most social sites refuse it.
 */
const OUT = evidencePath('video-clip');
// Headless Chrome with --use-angle=metal hands MediaRecorder no frames at all (a 320x180 WebM of a plain 2D
// canvas comes back 0 bytes; the same page without the Metal flags records,), so the specs that
// need a real recording run on Chrome's default headless GL, which is SwiftShader at about 5 fps.
const RECORDS = { launchOptions: { args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] } };
test.describe.configure({ timeout: 300_000 });

test.use(RECORDS);
test('the last seconds of the drive save as a playable watermarked video', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, best: {} })));
  await page.goto('/?dev=1&track=synth-loop&bot=1&speed=1&time=day&weather=clear');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'rolling clip');
  const mime = await page.evaluate(() => (window.game as any).video.mime as string | null);
  expect(await page.evaluate(() => (window.game as any).video.supported), `this browser records (${mime})`).toBe(true);

  await page.waitForFunction(() => (window.game as any).video.seconds > 5, null, { timeout: 60_000 });

  // The pause page offers it, and saving hands over a real file. The pause replay stays off here: on this slow
  // browser its copy would restart its own lane, and the check below is that saving restarts it.
  await page.evaluate(() => { const game = window.game as any; game.pauseLoop.open = async () => {}; game.handleAction('pause'); });
  const save = page.locator('[data-screen=pause] [data-action=clip]');
  await expect(save).toBeVisible();
  await expect(save).toContainText('Save last');
  await save.click();
  const dialog = page.locator('.share-dialog');
  await expect(dialog.locator('video')).toBeVisible({ timeout: 60_000 });
  // The copy never names a container -- a player gets a file, not a format quiz.
  await expect(dialog.locator('[role=status]')).toContainText('watermarked');
  expect(await dialog.locator('[role=status]').textContent()).not.toMatch(/GIF|WebM|MP4/i);
  const clip = await dialog.locator('video').evaluate(async node => {
    const video = node as HTMLVideoElement;
    if (!video.readyState) await new Promise(done => video.addEventListener('loadeddata', done, { once: true }));
    return { width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : null };
  });
  // 1280x720, or 640x360 where the hardware H.264 encoder delivers nothing and the recording steps down (VideoClip SMALL_CLIP).
  expect([[1280, 720], [640, 360]]).toContainEqual([clip.width, clip.height]);
  const downloading = page.waitForEvent('download');
  await dialog.locator('[data-share=save]').click();
  const download = await downloading;
  // The name follows what the recorder produced, so the file opens with the right app.
  const extension = mime!.startsWith('video/mp4') ? 'mp4' : 'webm';
  // The route and local time follow the product name, so two saves never collide -- from the pause menu too.
  expect(download.suggestedFilename()).toMatch(new RegExp(`^silicon-slime-rush-synth-loop-\\d{8}-\\d{6}\\.${extension}$`));
  const file = resolve(OUT, `drive.${extension}`);
  await download.saveAs(file);
  const bytes = statSync(file).size;
  expect(bytes).toBeGreaterThan(50_000);
  // Saving restarted the saved recording; the pause replay restarted with it, so the two offer the same length.
  await expect.poll(() => page.evaluate(() => { const game = window.game as any;
    return Math.abs(game.video.seconds - game.loopVideo.seconds); }), { timeout: 5_000 }).toBeLessThan(.5);

  // A frame of the recorded canvas shows the watermark that the file carries.
  const shot = await page.evaluate(() => (window.game as any).video.canvas.toDataURL('image/png'));
  writeFileSync(resolve(OUT, 'recorded-frame.png'), Buffer.from(shot.split(',')[1]!, 'base64'));
  const facts = { mime,
    clip: { ...clip, bytes }, stats: await page.evaluate(() => (window.game as any).video.stats) };
  console.log('452 CLIP FACTS', JSON.stringify(facts));
  writeFileSync(resolve(OUT, 'facts.json'), JSON.stringify(facts, null, 2));


  // The results page offers the same thing. Saving starts the window again, so drive a little more first.
  await dialog.locator('[data-share=close]').click();
  await page.evaluate(() => { (window.game as any).handleAction('pause'); });
  await page.waitForFunction(() => (window.game as any).video.seconds > 5, null, { timeout: 60_000 });
  await page.evaluate(() => { const game = window.game as any; game.session.humans[0].race.time = 42; game.finish(42); });
  await expect(page.locator('[data-screen=results] [data-action=clip]')).toBeVisible();
  // One save entry -- the old GIF button and its preview block are gone from beside it.
  await expect(page.locator('[data-screen=results] [data-action=impact]')).toHaveCount(0);
  await expect(page.locator('[data-screen=results] .replay-button')).toHaveCount(0);
  await page.locator('[data-screen=results]').screenshot({ path: resolve(OUT, 'results-one-save.png') });
});

test('a browser without MediaRecorder shows no clip button and does not fail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => { Object.defineProperty(window, 'MediaRecorder', { value: undefined }); });
  await page.goto('/?dev=1&track=synth-loop&bot=1&speed=1&time=day&weather=clear');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  expect(await page.evaluate(() => (window.game as any).video.supported)).toBe(false);
  await page.waitForTimeout(3000);
  await page.evaluate(() => { (window.game as any).handleAction('pause'); });
  await expect(page.locator('[data-screen=pause] [data-action=clip]')).toBeHidden();
  expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
});

test('a phone does not record', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  try {
    await page.goto('/?dev=1');
    await page.waitForFunction(() => !!window.game);
    expect(await page.evaluate(() => (window.game as any).videoWanted()), 'a phone never records').toBe(false);
    expect(await page.evaluate(() => (window.game as any).video.recording)).toBe(false);
  } finally { await page.close(); await context.close(); }
});

test('a new race starts a new recording, and reduced motion withdraws the offer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, best: {} })));
  await page.goto('/?dev=1&track=synth-loop&bot=1&speed=1&time=day&weather=clear');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await page.waitForFunction(() => (window.game as any).video.seconds > 5, null, { timeout: 60_000 });

  // Restarting must not hand the next race the last one's footage.
  await page.evaluate(() => { const game = window.game as any; game.phase = 'paused'; game.restart(); });
  await expect.poll(() => page.evaluate(() => (window.game as any).video.seconds)).toBeLessThan(2);
  await page.evaluate(() => { (window.game as any).handleAction('pause'); });
  await expect(page.locator('[data-screen=pause] [data-action=clip]')).toBeHidden();

  // Reduced motion, switched on mid-race, drops what was recorded like it drops the recording.
  await page.evaluate(() => { (window.game as any).handleAction('pause'); });
  await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 60_000 });
  await page.waitForFunction(() => (window.game as any).video.seconds > 5, null, { timeout: 60_000 });
  await page.evaluate(() => { (window.game as any).pickSetting({ id: 'reducedMotion', label: '' }, 'on'); });
  await expect.poll(() => page.evaluate(() => (window.game as any).video.recording)).toBe(false);
  await page.evaluate(() => { (window.game as any).handleAction('pause'); });
  await expect(page.locator('[data-screen=pause] [data-action=clip]')).toBeHidden();
});
