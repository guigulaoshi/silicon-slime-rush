import { describe, expect, it } from 'vitest';
import { clipMime, clipMimes } from '../src/app/VideoClip';

/**
 * Stands in for a browser: `admits` decides what isTypeSupported answers, and `breaks` names the
 * container strings whose MediaRecorder throws on construction the way a real one can after saying
 * yes (a canvas stream has no audio track, so an mp4 string naming an audio codec is the candidate
 * most likely to be refused).
 */
function fakeBrowser(admits: (mime: string) => boolean, breaks: string[] = []) {
  const started: string[] = [];
  class Fake {
    constructor(_stream: unknown, options: { mimeType: string }) {
      if (breaks.includes(options.mimeType)) throw new Error('not really');
      started.push(options.mimeType);
    }
    addEventListener() {}
    start() {}
    stop() {}
    get stream() { return { getTracks: () => [] }; }
  }
  (Fake as unknown as { isTypeSupported: (mime: string) => boolean }).isTypeSupported = admits;
  const capture = HTMLCanvasElement.prototype.captureStream;
  (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = () => ({ getTracks: () => [] });
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = Fake;
  return { started, restore() {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    if (capture) (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = capture;
    else delete (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream;
  } };
}

/** A browser without MediaRecorder or canvas capture records nothing and says so. */
describe('clip support', () => {
  it('reports no format where the APIs are missing', () => {
    expect(clipMime()).toBeNull();
  });

  it('picks the first format the browser admits to', () => {
    const recorder = { isTypeSupported: (mime: string) => mime === 'video/webm;codecs=vp8' };
    const capture = HTMLCanvasElement.prototype.captureStream;
    (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = () => ({});
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = recorder;
    try { expect(clipMime()).toBe('video/webm;codecs=vp8'); }
    finally {
      delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
      if (capture) (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = capture;
      else delete (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream;
    }
  });

  /**
   * Mp4 before WebM is the whole point of the order, not a preference. A WebM cannot be
   * saved to an iPhone's camera roll and X, Facebook and Reddit all refuse it, so a browser that
   * offers both has to hand us mp4.
   */
  it('takes mp4 over WebM when the browser offers both', () => {
    const fake = fakeBrowser(() => true);
    try {
      expect(clipMime()).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
      expect(clipMimes()[3], 'WebM stays available for Firefox, just not first').toMatch(/^video\/webm/);
      expect(clipMimes().some(mime => mime.includes('codecs=h264')),
        'h264 is the spelling Safari answers false to, so it is not in the list').toBe(false);
    } finally { fake.restore(); }
  });

  it('gives Firefox WebM, because it has no mp4 muxer at all', () => {
    const fake = fakeBrowser(mime => mime.startsWith('video/webm'));
    try { expect(clipMime()).toBe('video/webm;codecs=vp9'); }
    finally { fake.restore(); }
  });
});
