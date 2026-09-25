import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

async function setSlider(page: import('@playwright/test').Page, id: string, value: number) {
  await page.locator(`[data-setting="${id}"]`).evaluate((node, value) => {
    (node as HTMLInputElement).value = String(value); node.dispatchEvent(new Event('input', {bubbles:true}));
  }, value);
}

// Driving and recording a complete race needs its own bounded budget.
test.describe.configure({ timeout: 120_000 });

// Capture the real browser's final audio output while the game drives and changes pages.
test('records one continuous mix, persists separate levels and survives unavailable audio', async ({ page }) => {
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: any[]) {
      if (args[0] === this.context.destination) (window as any).mixOutput = this;
      return (connect as any).apply(this, args);
    } as typeof connect;
    localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 5, language: 'en', muted: false, slimeDensity: 'none' }));
  });
  await page.goto('/?dev=1&bot=1&speed=3'); await page.locator('.home-go').click();
  await page.locator('.sm-link').first().click();
  await page.waitForFunction(() => (window as any).mixOutput);
  await page.evaluate(() => {
    const output = (window as any).mixOutput as AudioNode;
    const ctx = output.context as AudioContext;
    const stream = ctx.createMediaStreamDestination(); output.connect(stream);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; output.connect(analyser);
    const chunks: Blob[] = []; const recorder = new MediaRecorder(stream.stream);
    const data = new Float32Array(analyser.fftSize);
    const capture: any = (window as any).mixCapture = { recorder, chunks, peak: 0, samples: 0, active: 0 };
    capture.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      for (const x of data) { capture.peak = Math.max(capture.peak, Math.abs(x)); capture.samples++; if (Math.abs(x) > 0.005) capture.active++; }
    }, 20);
    recorder.ondataavailable = e => chunks.push(e.data); recorder.start();
  });
  await page.waitForTimeout(1500);
  await setSlider(page, 'musicVolume', 75); await setSlider(page, 'effectsVolume', 25);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('silicon-rush.save.v1')!)))
    .toMatchObject({ musicVolume: 0.75, effectsVolume: 0.25 });
  await setSlider(page, 'effectsVolume', 100);
  await page.locator('[data-setting="back"]').click();
  await page.evaluate(() => (window.game as any).load('synth-p2p'));
  await page.waitForFunction(() => window.game?.report().phase === 'intro');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await page.evaluate(() => { window.game.autopilot = true; });
  await page.waitForTimeout(1600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => window.game.audio.graph!.engine.gain.value)).toBeLessThan(0.005);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  // Audition the busiest mix through the same production voices: driving plus wet impacts and rail contact.
  await page.evaluate(() => {
    (window.game.audio as any).slime('burst'); (window.game.audio as any).slime('colossus');
    (window.game.audio as any).ui('countdown');
  });
  await page.waitForFunction(() => window.game.report().phase === 'results', null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.locator('[data-screen="results"] [data-action="quit"]').click();
  await page.waitForTimeout(800);
  const recording = await page.evaluate(async () => {
    const capture: any = (window as any).mixCapture;
    await new Promise<void>(resolve => { capture.recorder.onstop = () => resolve(); capture.recorder.stop(); });
    clearInterval(capture.timer);
    const bytes = new Uint8Array(await new Blob(capture.chunks).arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return { audio: btoa(binary), peak: capture.peak, samples: capture.samples, active: capture.active };
  });
  expect(recording.samples).toBeGreaterThan(100000);
  expect(recording.active / recording.samples).toBeGreaterThan(0.1);
  expect(recording.peak).toBeGreaterThan(0.03);
  expect(recording.peak).toBeLessThan(0.98);
  const out = evidencePath('mix'); mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'journey.webm'), Buffer.from(recording.audio, 'base64'));
  writeFileSync(resolve(out, 'levels.json'), JSON.stringify({ ...recording, audio: undefined }, null, 2));
});

test('no audio support still permits the full start flow', async ({ page }) => {
  await page.addInitScript(() => { (window as any).AudioContext = class { constructor() { throw new Error('disabled'); } }; });
  await page.goto('/?track=synth-p2p&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'intro');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  expect(await page.evaluate(() => window.game.audio.ctx?.state === 'running')).toBe(false);
});

test('phone settings keep independent mix and mute after reload', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?dev=1'); await page.locator('.home-go').click();
  await page.locator('.sm-link').first().click();
  await setSlider(page, 'musicVolume', 75); await setSlider(page, 'effectsVolume', 0);
  await setSlider(page, 'volume', 0);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('silicon-rush.save.v1')!));
  expect(before).toMatchObject({ muted: true, musicVolume: 0.75, effectsVolume: 0 });
  await page.reload(); await page.locator('.home-go').click();
  await page.locator('.sm-link').first().click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('silicon-rush.save.v1')!))).toEqual(before);
  await page.waitForTimeout(250);
  const out = evidencePath('mix'); mkdirSync(out, { recursive: true });
  await page.screenshot({ path: resolve(out, 'phone-settings.png') });
});
