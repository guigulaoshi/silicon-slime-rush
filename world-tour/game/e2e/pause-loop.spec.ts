import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

// Headless Chrome with --use-angle=metal hands MediaRecorder no frames at all (a 320x180 WebM of a plain 2D
// canvas comes back 0 bytes; the same page without the Metal flags records,), so the specs that
// need a real recording run on Chrome's default headless GL, which is SwiftShader at about 5 fps.
test.use({ launchOptions: { args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] } });


/**
 *
 * pausing plays the last stretch of the drive in a window beside the menu, silent and unmarked, with a
 * scrub bar; the backdrop stays the frozen frame. Resuming takes it away.
 */
const OUT = evidencePath('pause-loop');
test.describe.configure({ timeout: 300_000 });

test('the pause menu plays the drive in a window with a scrub bar, and resuming takes it away', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, best: {} })));
  await page.goto('/?dev=1&track=synth-loop&bot=1&speed=1&time=day&weather=clear');
  // This spec is about the window, not the format. On SwiftShader's few frames a second Chrome's mp4 muxer
  // (about a hundred frames per fragment) hands over nothing before a lane turns over, so the replay here
  // records WebM; the saved mp4 is video-clip's job. Set before the countdown opens the first lane.
  await page.waitForFunction(() => (window.game as any)?.loopVideo);
  await page.evaluate(() => { const clip = (window.game as any).loopVideo;
    clip.stop(); clip.candidates = clip.candidates.filter((mime: string) => mime.startsWith('video/webm')); });
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'pause loop');
  expect(await page.evaluate(() => (window.game as any).loopVideo.supported), 'this browser records').toBe(true);
  await page.waitForFunction(() => (window.game as any).loopVideo.seconds > 6, null, { timeout: 60_000 });

  await page.evaluate(() => { (window.game as any).handleAction('pause'); });
  const box = page.locator('[data-screen=pause] .pause-aside .pause-replay.live');
  const loop = box.locator('video.pause-replay-video');
  await expect(loop).toHaveCount(1, { timeout: 15_000 });
  // Nothing plays behind the menu any more: the one video is the window's.
  await expect(page.locator('[data-screen=pause] video')).toHaveCount(1);
  const played = await loop.evaluate(async node => {
    const video = node as HTMLVideoElement;
    const start = video.currentTime;
    await new Promise(done => setTimeout(done, 1200));
    const rect = video.getBoundingClientRect();
    return { muted: video.muted, loop: video.loop, paused: video.paused, advanced: video.currentTime - start,
      width: video.videoWidth, height: video.videoHeight, shownWidth: rect.width, shownHeight: rect.height };
  });
  expect(played).toMatchObject({ muted: true, loop: true, paused: false });
  // 960x540, or 640x360 where the hardware H.264 encoder delivers nothing (VideoClip SMALL_CLIP).
  expect([[960, 540], [640, 360]]).toContainEqual([played.width, played.height]);
  // The window takes the video's own shape: no crop, no bars.
  expect(Math.abs(played.shownWidth / played.shownHeight - played.width / played.height)).toBeLessThan(.02);
  expect(played.advanced).toBeGreaterThan(.5);
  expect(played.shownWidth, 'a window, not the whole screen').toBeLessThan(560);
  await expect(page.locator('[data-screen=pause] [data-action=resume]')).toBeVisible();
  await expect(page.locator('[data-screen=pause] [data-action=clip]')).toBeVisible();
  await page.screenshot({ path: resolve(OUT, 'paused-a.png') });

  // The scrub bar follows the playhead, and dragging it moves the video.
  const scrub = box.locator('input.pause-replay-scrub');
  const max = Number(await scrub.getAttribute('max'));
  expect(max).toBeGreaterThan(4);
  const bar = (await scrub.boundingBox())!;
  await page.mouse.move(bar.x + 4, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width * .5, bar.y + bar.height / 2, { steps: 6 });
  // A recorder's WebM has no seek index, so a seek can take longer than a fixed pause on a busy machine:
  // read the playhead once the video says the seek has landed.
  const settled = () => loop.evaluate(node => new Promise<{ time: number; paused: boolean }>(done => {
    const video = node as HTMLVideoElement;
    const read = () => done({ time: video.currentTime, paused: video.paused });
    setTimeout(() => { if (video.seeking) video.addEventListener('seeked', read, { once: true }); else read(); }, 400);
  }));
  const held = await settled();
  expect(held.paused, 'holding the bar holds the picture').toBe(true);
  expect(Math.abs(held.time - max * .5), `dragged to the middle of ${max}s`).toBeLessThan(max * .15);
  await page.screenshot({ path: resolve(OUT, 'scrubbed.png') });
  await page.mouse.move(bar.x + bar.width * .25, bar.y + bar.height / 2, { steps: 4 });
  const back = (await settled()).time;
  expect(Math.abs(back - max * .25), 'dragging back moves the picture back').toBeLessThan(max * .15);
  await page.mouse.up();
  // Letting go carries on playing from there. The budget is for asking, not for the video: with four GPU
  // workers decoding at once a single question to the page has taken over 3 s while the page snapshot of
  // that same failure showed the replay playing ("Pause replay", slider moving).
  await expect.poll(() => loop.evaluate(node => !(node as HTMLVideoElement).paused), { timeout: 10_000 }).toBe(true);
  // The play button stops and starts it.
  await box.locator('.pause-replay-toggle').click();
  expect(await loop.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  await box.locator('.pause-replay-toggle').click();
  expect(await loop.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
  // With the replay focused, Space plays and pauses the replay only; the race stays paused.
  await scrub.focus();
  await page.keyboard.press('Space');
  expect(await loop.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  await box.locator('.pause-replay-toggle').focus();
  await page.keyboard.press('Space');
  expect(await loop.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
  await page.keyboard.press('Enter');
  expect(await loop.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
  await page.keyboard.press('Enter');
  expect(await loop.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);

  // It loops: the playhead comes back round instead of stopping on the last frame.
  const wrapped = await loop.evaluate(async node => {
    const video = node as HTMLVideoElement;
    let last = video.currentTime;
    const until = performance.now() + 25_000;
    while (performance.now() < until) {
      await new Promise(done => setTimeout(done, 100));
      if (video.currentTime + .5 < last) return true;
      last = video.currentTime;
    }
    return false;
  });
  expect(wrapped, 'the replay loops').toBe(true);

  await page.evaluate(() => { (window.game as any).handleAction('pause'); });
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expect(page.locator('[data-screen=pause] video')).toHaveCount(0);
  await expect(page.locator('[data-screen=pause] .pause-replay')).toBeHidden();
  expect(await page.evaluate(() => (window.game as any).pauseLoop.playing)).toBe(false);

  // Pausing again and again, including straight after resuming, still finds a recording: taking the
  // replay copies the recording rather than ending it, so the two recorders stay half a turn apart.
  // A lane ends early only through finishLongest() or stop(), so those are watched directly. The recorder's
  // own turnover is not the pause's doing: a lane retires once it is LANE_SECONDS old (VideoClip.frame), and
  // these drives put the clock at about 18 s -- right on the first lane's turn. On a loaded machine it crossed
  // it and the lane retired on schedule, which the old since-comparison read as "pausing ended it" (full run
  //[0] became [9.05], the second lane, with VideoClip.run unchanged).
  await page.evaluate(() => {
    const clip = (window.game as any).loopVideo, ended: string[] = [];
    for (const name of ['finishLongest', 'stop']) {
      const own = clip[name].bind(clip);
      clip[name] = (...args: unknown[]) => { ended.push(name); return own(...args); };
    }
    (window as any).loopEnded = ended;
  });
  const lanesBefore: number[] = await page.evaluate(() => (window.game as any).loopVideo.lanes.map((lane: any) => lane.since));
  for (const drive of [3000, 200, 5000, 200]) {
    await page.waitForTimeout(drive);
    await page.evaluate(() => { (window.game as any).handleAction('pause'); });
    await expect(page.locator('[data-screen=pause] .pause-replay.live video'), `after driving ${drive} ms`).toHaveCount(1, { timeout: 15_000 });
    await page.evaluate(() => { (window.game as any).handleAction('pause'); });
    await page.waitForFunction(() => window.game.report().phase === 'racing');
  }
  const after = await page.evaluate(() => { const clip = (window.game as any).loopVideo;
    return { clock: clip.clock as number, lanes: clip.lanes.map((lane: any) => lane.since) as number[],
      ended: [...(window as any).loopEnded] as string[] }; });
  expect(after.ended, 'pausing ends no recording').toEqual([]);
  // And every lane not yet due its turn is the very lane that was recording before. 18 is VideoClip's
  // LANE_SECONDS; this spec cannot import it (VideoClip's imports read import.meta.env).
  const inTurn = lanesBefore.filter(since => after.clock - since < 18);
  expect(after.lanes, 'pausing ends no recording').toEqual(expect.arrayContaining(inTurn));
  console.log(`lanes ${JSON.stringify(lanesBefore)} -> ${JSON.stringify(after.lanes)} at ${after.clock.toFixed(2)} s, checked ${JSON.stringify(inTurn)}`);

  // Reduced motion chosen while paused takes the moving replay down.
  await page.evaluate(() => { (window.game as any).handleAction('pause'); });
  await expect(page.locator('[data-screen=pause] .pause-replay.live video')).toHaveCount(1, { timeout: 15_000 });
  await page.evaluate(() => { (window.game as any).save.all.reducedMotion = true; });
  await expect(page.locator('[data-screen=pause] video')).toHaveCount(0, { timeout: 5_000 });
});

// The format players get: an mp4 copied out of a recorder that is still running, so it carries no
// duration. Made from a plain animated canvas, which SwiftShader encodes fast enough, and handed to the
// window the way PauseLoop does. It must start moving at once and come round again at the end.
test('an mp4 cut from a running recording plays at once in the window and loops', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'low', volume: 0, muted: true, best: {} })));
  await page.goto('/?dev=1&track=synth-loop&bot=1&speed=1&time=day&weather=clear');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  // Pause first, with the pause's own replay switched off (it would replace this cut when its copy arrives),
  // so the page is idle and the canvas below gets its frames.
  await page.evaluate(() => { const game = window.game as any; game.pauseLoop.open = async () => {}; game.handleAction('pause'); });
  const cut = await page.evaluate(async () => {
    const mime = ['video/mp4;codecs=avc1', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) return null;
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d')!; let n = 0;
    // Frames are handed over one by one, as VideoClip does: a captureStream(30) follows the page's
    // painting and records nothing while the screen is locked or the window hidden.
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
    const draw = setInterval(() => { ctx.fillStyle = `hsl(${n * 9},70%,50%)`; ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = '#fff'; ctx.fillRect((n++ * 12) % 600, 150, 40, 40); track.requestFrame?.(); }, 33);
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = []; recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.start(1000);
    await new Promise(done => setTimeout(done, 6000));
    // Like VideoClip.peek(): ask for what is there, without stopping -- and, as it does since 0d677882, stop
    // for the complete file when the copy is only the header (Chrome's software H.264 holds its frames until stop).
    await new Promise(done => { recorder.addEventListener('dataavailable', done, { once: true }); recorder.requestData(); });
    if (new Blob(chunks).size <= 1024) await new Promise(done => { recorder.addEventListener('stop', done, { once: true }); recorder.stop(); });
    const blob = new Blob(chunks, { type: mime });
    if (recorder.state !== 'inactive') recorder.stop();
    clearInterval(draw);
    const game = window.game as any;
    game.pause.setLoop(URL.createObjectURL(blob), 5);
    return { mime, bytes: blob.size };
  });
  test.skip(!cut, 'this browser records no mp4');
  expect(cut!.bytes).toBeGreaterThan(5_000);
  const loop = page.locator('[data-screen=pause] .pause-replay.live video');
  await expect(loop, 'moving within two seconds of the pause').toHaveCount(1, { timeout: 2_000 });
  const wrapped = await loop.evaluate(async node => {
    const video = node as HTMLVideoElement;
    let last = video.currentTime, moved = false;
    const until = performance.now() + 15_000;
    while (performance.now() < until) {
      await new Promise(done => setTimeout(done, 100));
      if (video.currentTime > last) moved = true;
      if (moved && video.currentTime + .5 < last) return true;
      last = video.currentTime;
    }
    return false;
  });
  expect(wrapped, 'the mp4 plays and comes round again').toBe(true);
});
