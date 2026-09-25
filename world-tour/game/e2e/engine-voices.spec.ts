import { evidencePath } from './evidence';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
const VEHICLES: { id: string }[] = JSON.parse(readFileSync(new URL('../src/vehicles/catalogue.json', import.meta.url), 'utf8')).vehicles;
import { DEV_URL } from './server';

test('all garage selections use their voice and render distinct original audio', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`${DEV_URL}/?dev=1`); await page.locator('.home-go').click();
  await page.waitForFunction(() => window.game);
  const out = evidencePath('engine');
  mkdirSync(out, { recursive: true });
  const metrics = [];
  for (const vehicle of VEHICLES) {
    const result = await page.evaluate(async id => {
      const url = '/src/audio/Audio.ts';
      const { GameAudio } = await import(/* @vite-ignore */ url);
      await (window.game as any).load('synth-p2p', id);
      const liveVoice = (window.game.audio as any).voice;
      const ctx = new OfflineAudioContext(1, 48000 * 3, 48000);
      const audio = new GameAudio({ contextFactory: () => ctx });
      audio.setVehicle(id);
      audio.ensure();
      audio.setMix(0, 1);
      const update = (speed: number) => {
        for (let i = 0; i < 120; i++) audio.update(1 / 60, { speed, throttle: 0.7, brake: 0, slip: 0, grounded: true });
      };
      update(0);
      const first = ctx.suspend(1).then(() => { update(12); return ctx.resume(); });
      const second = ctx.suspend(2).then(() => { update(28); return ctx.resume(); });
      const rendered = await ctx.startRendering();
      await Promise.all([first, second]);
      const data = rendered.getChannelData(0);
      const rms = (from: number, to: number) => Math.sqrt(data.slice(from, to).reduce((sum, x) => sum + x * x, 0) / (to - from));
      const wav = new ArrayBuffer(44 + data.length * 2); const view = new DataView(wav);
      const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
      text(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      text(36, 'data'); view.setUint32(40, data.length * 2, true);
      let peak = 0;
      data.forEach((x, i) => { peak = Math.max(peak, Math.abs(x)); view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 32767, true); });
      let binary = ''; new Uint8Array(wav).forEach(b => { binary += String.fromCharCode(b); });
      return { id, liveVoice, selectedVoice: audio.voice, idle: rms(24000, 48000), drive: rms(120000, 144000), peak, wav: btoa(binary) };
    }, vehicle.id);
    expect(result.liveVoice).toEqual(result.selectedVoice);
    expect(result.drive).toBeGreaterThan(0.001);
    expect(result.peak).toBeLessThan(0.98);
    if (result.selectedVoice.electric) expect(result.idle).toBeLessThan(0.0001);
    else expect(result.idle).toBeGreaterThan(0.005);
    writeFileSync(resolve(out, `${vehicle.id}.wav`), Buffer.from(result.wav, 'base64'));
    metrics.push({ ...result, wav: undefined });
  }
  expect(new Set(metrics.map(m => m.drive.toFixed(6))).size).toBe(VEHICLES.length);
  writeFileSync(resolve(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
});
