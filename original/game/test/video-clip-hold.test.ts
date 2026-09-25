import { afterEach, describe, expect, it } from 'vitest';
import { mp4Samples, resetEncoderSilence, VideoClip } from '../src/app/VideoClip';
import { I18n } from '../src/ui/i18n';

/**
 *The file was not broken, it was mostly one still frame. MediaRecorder
 * stamps frames with wall-clock time, so a recorder left running through the pause menu wrote 15 s of
 * driving as a 179 s file, 161 s of it frozen. The recording has to hold whenever the game stops drawing.
 */
type Listener = (event?: unknown) => void;
const recorders: Fake[] = [];
/** Containers whose recorder runs but hands back nothing, like a used-up hardware encoder. */
let silentContainers: string[] = [];
/** Canvases at least this wide get nothing back, like a hardware-only size. */
let silentBelowWidth = Infinity;
class Fake {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  readonly mimeType: string;
  private readonly listeners = new Map<string, Listener[]>();
  static isTypeSupported() { return true; }
  private readonly width: number;
  constructor(stream: { width?: number }, init: { mimeType: string }) { this.mimeType = init.mimeType; this.width = stream.width ?? 0; recorders.push(this); }
  private get silent() { return silentContainers.includes(this.mimeType.split(';')[0]!) || this.width >= silentBelowWidth; }
  addEventListener(kind: string, listener: Listener) { this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]); }
  fire(kind: string, event: unknown = {}) { this.listeners.get(kind)?.forEach(l => l(event)); }
  start() { this.state = 'recording'; if (!this.silent) this.fire('dataavailable', { data: new Blob(['x'.repeat(4096)]) }); }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  requestData() { this.fire('dataavailable', { data: new Blob(this.silent ? [] : ['y'.repeat(4096)]) }); }
  stop() { this.state = 'inactive'; this.fire('stop'); }
  get stream() { return { getTracks: () => [] }; }
}
const capture = HTMLCanvasElement.prototype.captureStream;

function clip() {
  (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = function (this: HTMLCanvasElement) { return { width: this.width, getTracks: () => [] }; };
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = Fake;
  const video = new VideoClip(new I18n('en'), { watermark: false });
  // frame() composites onto a 2D canvas, which jsdom does not draw.
  (video as unknown as { context: unknown }).context = { fillRect() {}, drawImage() {} };
  video.start();
  return video;
}

afterEach(() => {
  resetEncoderSilence();
  recorders.length = 0; silentContainers = []; silentBelowWidth = Infinity;
  delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  if (capture) (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = capture;
  else delete (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream;
});

describe('the drive recording holds while the game is not drawing', () => {
  it('pauses on hold and picks up again on the next driven frame', () => {
    const video = clip(), source = document.createElement('canvas');
    expect(recorders.map(r => r.state)).toEqual(['recording']);
    video.hold();
    expect(recorders.map(r => r.state)).toEqual(['paused']);
    video.frame(source, 1 / 30);
    expect(recorders.map(r => r.state)).toEqual(['recording']);
  });

  it('holds when the tab is hidden, since the game loop stops before it can say so', () => {
    clip();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try { document.dispatchEvent(new Event('visibilitychange')); } finally { delete (document as { hidden?: boolean }).hidden; }
    expect(recorders.map(r => r.state)).toEqual(['paused']);
  });

  it('still hands the pause replay a copy of a held recording', async () => {
    const video = clip();
    (video as unknown as { clock: number }).clock = 8;
    video.hold();
    const copy = await video.peek();
    expect(copy?.blob.size).toBe(8192);
    expect(recorders[0]!.state, 'peeking does not end or restart it').toBe('paused');
  });

  // Lanes turn over every LANE_SECONDS (18 s, 540 frames at 30 fps); a turned-over lane is judged once it stops.
  const drive = async (video: VideoClip, frames: number) => {
    const source = document.createElement('canvas');
    for (let i = 0; i < frames; i++) { video.frame(source, 1 / 30); await Promise.resolve(); }
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('retries a silent mp4 at a size the software encoder takes, keeping the file an mp4', async () => {
    silentBelowWidth = 1000;
    const video = clip();
    expect(video.canvas.width).toBe(1280);
    await drive(video, 560);
    const live = recorders.filter(r => r.state !== 'inactive');
    expect(live.map(r => r.mimeType.split(';')[0])).toEqual(['video/mp4']);
    expect(video.canvas.width).toBe(640);
    await drive(video, 150);
    expect(video.available).toBe(true);
  });

  it('drops a container that stays silent even small, and records in the next one', async () => {
    silentContainers = ['video/mp4'];
    const video = clip();
    expect(recorders[0]!.mimeType).toMatch(/^video\/mp4/);
    await drive(video, 1120);
    const live = recorders.filter(r => r.state !== 'inactive');
    expect(new Set(live.map(r => r.mimeType.split(';')[0])), 'every mp4 spelling is skipped at once').toEqual(new Set(['video/webm']));
    expect(video.supported).toBe(true);
    await drive(video, 150);
    expect(video.available, 'the webm recording goes on to offer a clip').toBe(true);
  });

  it('counts a recorder that only handed over its header as silent', async () => {
    silentBelowWidth = 1000;
    const video = clip();
    // The header arrives, then nothing: what a stalled H.264 recorder looks like.
    (video as unknown as { lanes: { chunks: Blob[] }[] }).lanes[0]!.chunks.push(new Blob(['h'.repeat(752)]));
    await drive(video, 560);
    expect(video.canvas.width).toBe(640);
  });

  it('gives up only when no container delivers anything', async () => {
    silentContainers = ['video/mp4', 'video/webm'];
    const video = clip();
    await drive(video, 1700);
    expect(video.supported).toBe(false);
    expect(recorders.every(r => r.state === 'inactive')).toBe(true);
  });

  it('keeps a running mp4 that gives nothing until it is stopped, as Chrome\'s software H.264 does', async () => {
    const video = clip();
    // Nothing while running (no fragment boundary yet); everything on stop.
    const hold = (recorder: Fake) => {
      recorder.requestData = () => { recorder.fire('dataavailable', { data: new Blob([]) }); };
      const stop = recorder.stop.bind(recorder);
      recorder.stop = () => { recorder.fire('dataavailable', { data: new Blob(['z'.repeat(60_000)]) }); stop(); };
    };
    hold(recorders[0]!);
    (video as unknown as { lanes: { chunks: Blob[] }[] }).lanes[0]!.chunks.splice(0, Infinity);
    for (let i = 0; i < 300; i++) { video.frame(document.createElement('canvas'), 1 / 30); await Promise.resolve(); }
    for (const recorder of recorders) if (recorder.state !== 'inactive') hold(recorder);
    expect(video.canvas.width, 'frames of nothing is no verdict').toBe(1280);
    const replay = await video.peek();
    expect(replay?.blob.size, 'stopping gives the complete file').toBeGreaterThan(50_000);
    expect(video.canvas.width).toBe(1280);
    expect(recorders.filter(r => r.state !== 'inactive').every(r => r.mimeType.startsWith('video/mp4'))).toBe(true);
  });

  it('gives a short drive its replay, with no four-second minimum', async () => {
    const video = clip();
    (video as unknown as { clock: number }).clock = 1.5;
    expect(video.available).toBe(false);
    expect((await video.peek())?.seconds).toBe(1.5);
  });

  it('fills the recording with the drive instead of leaving bars when the window is wider than 16:9', () => {
    const video = clip();
    const calls: number[][] = [];
    (video as unknown as { context: unknown }).context = { fillRect() {}, drawImage: (...args: number[]) => { calls.push(args.slice(1)); } };
    const wide = document.createElement('canvas'); wide.width = 2000; wide.height = 900;
    video.frame(wide, 1 / 30);
    const [x, y, width, height] = calls[0]!;
    expect(y).toBeCloseTo(0);
    expect(height).toBeCloseTo(720);
    expect(width).toBeGreaterThan(1280);
    expect(x).toBeLessThan(0);
    // A window narrower than 16:9 still fits whole: nothing of the top or bottom is lost.
    calls.length = 0;
    const narrow = document.createElement('canvas'); narrow.width = 960; narrow.height = 1040;
    video.frame(narrow, 1 / 30);
    const [, ny, , nh] = calls[0]!;
    expect(ny).toBeCloseTo(0);
    expect(nh).toBeCloseTo(720);
  });

  it('saves the complete file by ending the longer lane, keeping the fragment a copy would miss', async () => {
    const video = clip();
    (video as unknown as { clock: number }).clock = 8;
    const first = recorders[0]!;
    const stop = first.stop.bind(first);
    first.stop = () => { first.fire('dataavailable', { data: new Blob(['z'.repeat(9000)]) }); stop(); };
    const saved = await video.save();
    expect(saved?.blob.size, 'the held fragment is in the file').toBe(4096 + 9000);
    expect(first.state).toBe('inactive');
    expect(recorders.at(-1)!.state, 'a fresh lane took its place').toBe('recording');
  });

  it('gives a short replay its full file when the copy is only a header', async () => {
    const video = clip();
    (video as unknown as { clock: number }).clock = 1.5;
    const first = recorders[0]!;
    first.requestData = () => { first.fire('dataavailable', { data: new Blob([]) }); };
    const stop = first.stop.bind(first);
    first.stop = () => { first.fire('dataavailable', { data: new Blob(['z'.repeat(9000)]) }); stop(); };
    (video as unknown as { lanes: { chunks: Blob[] }[] }).lanes[0]!.chunks.splice(0, Infinity, new Blob(['h'.repeat(36)]));
    expect((await video.peek())?.blob.size).toBe(9036);
  });

  it('a lane stopped with frames fed and only a header proves the encoder silent at once, for every recorder on the page', async () => {
    silentBelowWidth = 1000;
    const video = clip(), source = document.createElement('canvas');
    for (let i = 0; i < 40; i++) video.frame(source, 1 / 30);
    (video as unknown as { clock: number }).clock = 5;
    expect(await video.peek(), 'nothing to play this time').toBeNull();
    expect(video.canvas.width, 'no waiting for 200 frames').toBe(640);
    const replay = new VideoClip(new I18n('en'), { width: 960, height: 540, watermark: false });
    replay.start();
    expect(replay.canvas.width, 'the other recorder starts small straight away').toBe(640);
    expect(recorders.at(-1)!.mimeType).toMatch(/^video\/mp4/);
  });

  it('does not call a short, healthy lane silent when it is stopped', async () => {
    const video = clip();
    (video as unknown as { clock: number }).clock = 5;
    const first = recorders[0]!;
    first.stop = () => { first.state = 'inactive'; first.fire('stop'); };
    (video as unknown as { lanes: { chunks: Blob[] }[] }).lanes[0]!.chunks.splice(0, Infinity, new Blob(['h'.repeat(36)]));
    await video.finishLongest();
    expect(video.canvas.width, 'ten frames in is too early to judge').toBe(1280);
  });

  it('judges a stopped mp4 by the frames inside it, not only by its size', async () => {
    const video = clip();
    const first = recorders[0]!;
    (video as unknown as { lanes: { chunks: Blob[] }[] }).lanes[0]!.chunks.splice(0, Infinity);
    for (let i = 0; i < 120; i++) video.frame(document.createElement('canvas'), 1 / 30);
    // A well-formed 18 KB mp4 holding one frame, as the player's half-working hardware encoder wrote.
    const stop = first.stop.bind(first);
    first.stop = () => { first.fire('dataavailable', { data: fragmentedMp4(1, 18_000) }); stop(); };
    (video as unknown as { clock: number }).clock = 5;
    expect(await video.save(), 'nothing worth saving').toBeNull();
    expect(video.canvas.width, 'the large size is given up').toBe(640);
    expect(video.supported, 'the offer stays: recording carries on smaller').toBe(true);
  });
});

/** ftyp, a moov naming track 1 a picture, then one moof whose traf holds a trun of `samples` frames, then an mdat of `bytes`. */
function fragmentedMp4(samples: number, bytes: number): Blob {
  const box = (type: string, ...bodies: Uint8Array[]) => {
    const length = bodies.reduce((sum, body) => sum + body.length, 0);
    const out = new Uint8Array(8 + length); const view = new DataView(out.buffer);
    view.setUint32(0, out.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    let at = 8; for (const body of bodies) { out.set(body, at); at += body.length; } return out;
  };
  const words = (...values: number[]) => { const out = new Uint8Array(values.length * 4); values.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v)); return out; };
  const moov = box('moov', box('trak', box('tkhd', words(0, 0, 0, 1), new Uint8Array(80)),
    box('mdia', box('hdlr', words(0, 0), Uint8Array.from('vide', ch => ch.charCodeAt(0)), new Uint8Array(12)))));
  const moof = box('moof', box('traf', box('tfhd', words(0, 1)), box('trun', words(0, samples))));
  return new Blob([box('ftyp', new Uint8Array(20)), moov, moof, box('mdat', new Uint8Array(bytes))], { type: 'video/mp4' });
}

describe('mp4Samples', () => {
  it('counts the frames in an mp4\'s fragments and ignores other containers', async () => {
    expect(await mp4Samples(fragmentedMp4(1, 100))).toBe(1);
    expect(await mp4Samples(new Blob([await fragmentedMp4(90, 10).arrayBuffer(), (await fragmentedMp4(30, 10).arrayBuffer()).slice(28)]))).toBe(120);
    expect(await mp4Samples(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])]))).toBeNull();
  });
});
