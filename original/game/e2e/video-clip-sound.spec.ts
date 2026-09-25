import { chromium, expect, firefox, test, webkit, type BrowserType } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { BASE_URL } from './server';

/**
 *A saved clip carries the game's sound in every engine the
 * game supports, the sound stays with the picture across a pause, and volume 0 saves a silent clip.
 * The file is judged by ffprobe/ffmpeg, the tools a person would reach for, not by the page's own word.
 */
test.describe.configure({ timeout: 300_000 });
const OUT = evidencePath('video-clip-sound');
const ENGINES: [string, BrowserType][] = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]];
// Headless Metal, as the rest of the suite runs: with frames handed over by requestFrame it records (7.2 s of
// drive in 12 s,), where SwiftShader drew 3.5 frames a second and left the file's picture ending
// 2 s before its sound. --mute-audio keeps the speakers quiet and does not touch what is recorded (measured).
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=metal', '--mute-audio', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];

interface Probe { streams: string[]; duration: number; audioDuration: number; meanDb: number; maxDb: number }
function probe(file: string): Probe {
  const run = (cmd: string, args: string[]) => {
    const result = spawnSync(cmd, args, { encoding: 'utf8' });
    if (result.error) throw new Error(`${cmd} is needed to judge the saved clip: ${result.error.message}`);
    return `${result.stdout}${result.stderr}`;
  };
  const streams = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', file])
    .trim().split('\n').filter(Boolean);
  // WebM from MediaRecorder carries no duration in its header, so both lengths are read by decoding.
  const decoded = (map: string) => {
    const times = [...run('ffmpeg', ['-hide_banner', '-i', file, '-map', map, '-f', 'null', '-']).matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
    const last = times.at(-1);
    return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
  };
  const levels = run('ffmpeg', ['-hide_banner', '-i', file, '-map', '0:a', '-af', 'volumedetect', '-f', 'null', '-']);
  const db = (key: string) => Number(levels.match(new RegExp(`${key}: (-?[\\d.]+) dB`))?.[1] ?? -Infinity);
  return { streams, duration: decoded('0:v'), audioDuration: decoded('0:a'), meanDb: db('mean_volume'), maxDb: db('max_volume') };
}

async function saveClip(engine: BrowserType, name: string, volume: number) {
  const browser = await engine.launch(name === 'chromium' ? { args: CHROMIUM_ARGS }
    : name === 'firefox' ? { firefoxUserPrefs: { 'webgl.disabled': false, 'webgl.force-enabled': true, 'media.autoplay.default': 0 } } : undefined);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.addInitScript(level => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      version: 1, language: 'en', quality: 'low', volume: level, muted: false, best: {} })), volume);
    await page.goto(`${BASE_URL}/?dev=1&track=synth-loop&bot=1&speed=1&time=day&weather=clear`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 120_000 });
    // A key is a gesture: the context is allowed to run, as it is for a player who has touched the page.
    await page.keyboard.press('Shift');
    await page.waitForFunction(() => (window.game as any).audio.running, null, { timeout: 30_000 });
    const mime = await page.evaluate(() => (window.game as any).video.mime as string | null);
    expect(await page.evaluate(() => (window.game as any).video.supported), `${name} records (${mime})`).toBe(true);
    // Lanes opened before the gesture carry no sound; wait for the one that will be saved to have it.
    await page.waitForFunction(() => { const video = (window.game as any).video;
      return video.lanes.length && video.lanes.every((lane: { sound: boolean }) => lane.sound) && video.seconds > 3; },
    null, { timeout: 180_000, polling: 250 });
    // A pause in the middle: the menu's own music and the wait must not land in the file.
    await page.evaluate(() => { const game = window.game as any; game.pauseLoop.open = async () => {}; game.handleAction('pause'); });
    await page.waitForTimeout(3000);
    await page.evaluate(() => { (window.game as any).handleAction('pause'); });
    await page.waitForFunction(() => (window.game as any).video.seconds > 7, null, { timeout: 120_000, polling: 250 });
    const saved = await page.evaluate(async () => {
      const clip = await (window.game as any).video.save() as { blob: Blob; seconds: number } | null;
      if (!clip) return null;
      const bytes = new Uint8Array(await clip.blob.arrayBuffer());
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { type: clip.blob.type, seconds: clip.seconds, base64: btoa(text) };
    });
    expect(saved, `${name} saved a clip`).not.toBeNull();
    mkdirSync(OUT, { recursive: true });
    const file = resolve(OUT, `${name}-volume-${volume}.${saved!.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
    writeFileSync(file, Buffer.from(saved!.base64, 'base64'));
    const facts = { name, volume, mime: saved!.type, seconds: saved!.seconds, ...probe(file) };
    console.log('531 CLIP SOUND', JSON.stringify(facts));
    writeFileSync(file.replace(/\.\w+$/, '.json'), JSON.stringify(facts, null, 2));
    return facts;
  } finally { await page.close(); await browser.close(); }
}

for (const [name, engine] of ENGINES) {
  test(`531 ${name} saves a clip with the game's sound in step with the picture`, async () => {
    const facts = await saveClip(engine, name, 1);
    expect(facts.streams.some(stream => stream.endsWith('audio')), `${name} has a sound track: ${facts.streams}`).toBe(true);
    expect(facts.meanDb, 'the engine and music are audible, not digital silence (-91 dB)').toBeGreaterThan(-60);
    // The pause lasted 3 s: had it landed in the file, the file would run 3 s past what was driven.
    expect(Math.abs(facts.duration - facts.seconds), `picture ${facts.duration}s for ${facts.seconds}s driven`).toBeLessThan(1.5);
    expect(Math.abs(facts.audioDuration - facts.duration), `sound ${facts.audioDuration}s beside picture ${facts.duration}s`).toBeLessThan(.5);
  });
}

test('volume 0 saves a silent clip', async () => {
  const facts = await saveClip(chromium, 'chromium', 0);
  expect(facts.maxDb, 'nothing above the noise floor').toBeLessThan(-80);
});
