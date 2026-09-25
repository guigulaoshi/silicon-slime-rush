import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { BASE_URL } from './server';
import { expectWorldLoaded } from './world';

test.skip(process.env.SLIME_AUDIO_QA !== '1', 'run with SLIME_AUDIO_QA=1');
test.describe.configure({ timeout: 240_000 });
const OUT = evidencePath('slime-audio');

test('records production voices and actual small, large and ordinary collisions', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  await context.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 3, language: 'en', quality: 'high', masterVolume: .8, musicVolume: 0,
    effectsVolume: 1, muted: false, slimeDensity: 'normal', best: {},
  })));
  const page = await context.newPage();
  const video = page.video()!;
  try {
    await page.goto('/?track=synth-p2p&bot=1&dev=1&time=day&vehicle=micro-hatch');
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    await expectWorldLoaded(page, 'slime audio delivery');
    await page.evaluate(() => window.game.audio.unlock());
    await page.waitForFunction(() => window.game.audio.ctx?.state === 'running');

    const audio = await page.evaluate(async () => {
      const gameAudio = window.game.audio;
      const ctx = gameAudio.ctx!;
      const sink = ctx.createMediaStreamDestination();
      gameAudio.graph!.limiter.connect(sink);
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(sink.stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus' } : undefined);
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      recorder.start(100);
      for (const kind of ['popper', 'slick', 'boost', 'colossus'] as const) {
        gameAudio.slime(kind, kind === 'colossus' ? 1 : .58, 'enter');
        await wait(kind === 'colossus' ? 750 : 420);
        gameAudio.slime(kind, kind === 'colossus' ? 1 : .58, 'exit');
        await wait(kind === 'colossus' ? 750 : 360);
      }
      for (const strength of [.1, .55, 1]) {
        gameAudio.slime('burst', strength, 'enter'); await wait(260);
        gameAudio.slime('burst', strength, 'impact'); await wait(560);
        gameAudio.slime('burst', strength, 'exit'); await wait(380);
      }
      for (let i = 0; i < 8; i++) { gameAudio.slime('burst', .75, 'impact'); await wait(75); }
      await wait(900);
      recorder.stop();
      await stopped;
      gameAudio.graph!.limiter.disconnect(sink);
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), type: blob.type,
        phases: gameAudio.slimeSoundPhaseCounts };
    });
    expect(audio.bytes.length).toBeGreaterThan(10_000);
    writeFileSync(resolve(OUT, 'production-voices.webm'), Buffer.from(audio.bytes));

    await page.evaluate(() => {
      const gameAudio = window.game.audio;
      (gameAudio as any).setMix(0, 1);
      const sink = gameAudio.ctx!.createMediaStreamDestination();
      gameAudio.graph!.limiter.connect(sink);
      const picture = document.querySelector<HTMLCanvasElement>('#app canvas')!.captureStream(30);
      const stream = new MediaStream([...picture.getVideoTracks(), ...sink.stream.getAudioTracks()]);
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream,
        MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? { mimeType: 'video/webm;codecs=vp8,opus' } : undefined);
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.start(100);
      (window as any).__slimeAv = { recorder, stopped, chunks, sink, stream };
    });

    const encounters: unknown[] = [];
    for (const setup of [
      { label: 'ordinary', kind: 'popper', radius: 2 },
      { label: 'burst-min', kind: 'burst', radius: .5 },
      { label: 'burst-max', kind: 'burst', radius: 4 },
    ] as const) {
      const impact = await page.evaluate(({ kind, radius, label }) => {
        const game = window.game as any;
        const session = game.session;
        const layer = session.slimes;
        game.autopilot = false;
        for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
        layer.effects.particleBorn.fill(-100);
        const p = session.world.spline.point(session.world.spline.indexAt(25));
        session.car.reset([p[0], p[1] + radius * .82, p[2]], 0);
        session.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        layer.addTile(`audio-${label}`, [{ kind, position: [p[0], p[1] + radius * .82, p[2]],
          scale: [radius, radius * .82, radius], yaw: 0 }]);
        const before = structuredClone(game.audio.slimeSoundPhaseCounts[kind]);
        for (let i = 0; i < 5; i++) session.physics.step(session.physics.timestep, (dt: number) => {
          layer.prepareCar(session.car); session.car.update(dt, { throttle: 0, brake: 0, steer: 0 });
          layer.handleCar(session.car); layer.update(dt);
        });
        const after = structuredClone(game.audio.slimeSoundPhaseCounts[kind]);
        return { label, kind, radius, before, after, particles: layer.stats.particles,
          flash: Number(layer.defaultDriver.feedback.flash.style.opacity) };
      }, setup);
      expect(impact.after.enter).toBe(impact.before.enter + 1);
      if (setup.kind === 'burst') expect(impact.after.impact).toBe(impact.before.impact + 1);
      await page.waitForTimeout(setup.kind === 'burst' ? 80 : 30);
      await page.screenshot({ path: resolve(OUT, `${setup.label}.png`) });
      const afterExit = await page.evaluate(({ kind }) => {
        const game = window.game as any;
        const session = game.session;
        const layer = session.slimes;
        const p = session.world.spline.point(session.world.spline.indexAt(25));
        session.physics.setBodyPosition(session.car.body, { x: p[0] + 80, y: .8, z: p[2] + 80 });
        layer.update(.12); layer.handleCar(session.car);
        return structuredClone(game.audio.slimeSoundPhaseCounts[kind]);
      }, setup);
      expect(afterExit.exit).toBe(impact.before.exit + 1);
      encounters.push({ ...impact, afterExit });
      await page.waitForTimeout(450);
    }
    const min = encounters[1] as { particles: number };
    const max = encounters[2] as { particles: number };
    expect(max.particles).toBeGreaterThan(min.particles);
    const av = await page.evaluate(async () => {
      const state = (window as any).__slimeAv;
      state.recorder.stop();
      await state.stopped;
      window.game.audio.graph!.limiter.disconnect(state.sink);
      for (const track of state.stream.getTracks()) track.stop();
      const blob = new Blob(state.chunks, { type: state.recorder.mimeType || 'video/webm' });
      return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), type: blob.type };
    });
    expect(av.bytes.length).toBeGreaterThan(20_000);
    writeFileSync(resolve(OUT, 'actual-collisions.webm'), Buffer.from(av.bytes));
    writeFileSync(resolve(OUT, 'encounters.json'), JSON.stringify({ audio: {
      mimeType: audio.type, bytes: audio.bytes.length, phases: audio.phases,
    }, audiovisual: { mimeType: av.type, bytes: av.bytes.length }, encounters }, null, 2));
  } finally {
    await context.close();
    await video.saveAs(resolve(OUT, 'operator-view.webm'));
    await video.delete();
  }
});
