import { afterEach, describe, expect, it } from 'vitest';
import { resetEncoderSilence, VideoClip } from '../src/app/VideoClip';
import { I18n } from '../src/ui/i18n';

/**
 * The third rule of recording: `isTypeSupported` answering true is not a promise that
 * anything was recorded. WebKit has shipped canvas capture that yields black frames (bug 230613)
 * and iOS has reported start() failing after a true answer, so a browser that says yes and then
 * produces nothing must cost us the offer, not leave a button that fails every press.
 */
type Listener = (event?: unknown) => void;

function fakeBrowser(options: { admits?: (mime: string) => boolean; breaks?: string[]; chunk?: number } = {}) {
  const admits = options.admits ?? (() => true);
  const breaks = options.breaks ?? [];
  const chunk = options.chunk ?? 200_000;
  const recorders: { mime: string; fire(kind: string): void }[] = [];
  class Fake {
    private readonly listeners = new Map<string, Listener[]>();
    constructor(_stream: unknown, init: { mimeType: string }) {
      if (breaks.includes(init.mimeType)) throw new Error('said yes, meant no');
      recorders.push({ mime: init.mimeType, fire: kind => this.listeners.get(kind)?.forEach(l => l({})) });
    }
    addEventListener(kind: string, listener: Listener) {
      this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]);
    }
    start() {
      if (chunk > 0) this.listeners.get('dataavailable')?.forEach(l => l({ data: new Blob(['x'.repeat(chunk)]) }));
    }
    stop() { this.listeners.get('stop')?.forEach(l => l({})); }
    get stream() { return { getTracks: () => [] }; }
  }
  (Fake as unknown as { isTypeSupported: (mime: string) => boolean }).isTypeSupported = admits;
  const capture = HTMLCanvasElement.prototype.captureStream;
  (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = () => ({ getTracks: () => [] });
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = Fake;
  return { recorders, restore() {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    if (capture) (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = capture;
    else delete (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream;
  } };
}

/** Enough clock for `available` without driving frame(), which needs a real 2D canvas. */
const wind = (clip: VideoClip, seconds: number) => { (clip as unknown as { clock: number }).clock = seconds; };

describe('a browser that says yes and then refuses', () => {
  afterEach(() => resetEncoderSilence());
  it('drops the candidate it cannot record and keeps the next one', () => {
    const fake = fakeBrowser({ breaks: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2'] });
    try {
      const clip = new VideoClip(new I18n('en'));
      clip.start();
      expect(fake.recorders.map(r => r.mime), 'the audio-naming mp4 is skipped, not the feature')
        .toEqual(['video/mp4;codecs=avc1']);
      expect(clip.supported).toBe(true);
    } finally { fake.restore(); }
  });

  it('withdraws the offer only when no candidate works', () => {
    const fake = fakeBrowser({ breaks: [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4',
      'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'] });
    try {
      const clip = new VideoClip(new I18n('en'));
      clip.start();
      expect(fake.recorders).toHaveLength(0);
      expect(clip.supported, 'nothing left to try').toBe(false);
    } finally { fake.restore(); }
  });

  it('withdraws the offer when a recorder that started hands back nothing', async () => {
    const fake = fakeBrowser({ chunk: 0 });
    try {
      const clip = new VideoClip(new I18n('en'));
      clip.start();
      wind(clip, 12);
      expect(clip.supported).toBe(true);
      expect(await clip.save(), 'an empty recording is not a clip').toBeNull();
      expect(clip.supported, 'and the save button goes away rather than failing forever').toBe(false);
    } finally { fake.restore(); }
  });

  it('withdraws the offer when the recorder reports an error mid-drive', () => {
    const fake = fakeBrowser();
    try {
      const clip = new VideoClip(new I18n('en'));
      clip.start();
      expect(clip.supported).toBe(true);
      fake.recorders[0]!.fire('error');
      expect(clip.supported).toBe(false);
    } finally { fake.restore(); }
  });
});
