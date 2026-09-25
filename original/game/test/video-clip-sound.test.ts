import { afterEach, describe, expect, it } from 'vitest';
import { mp4Samples, resetEncoderSilence, VideoClip, webmFrames } from '../src/app/VideoClip';
import { I18n } from '../src/ui/i18n';

/**
 *The saved clip recorded only the canvas. It now carries the
 * game's sound as well, and a browser that will not record sound still records the picture.
 */
class Track {
  stopped = false;
  clones: Track[] = [];
  constructor(readonly kind: 'audio' | 'video') {}
  clone(): Track { const copy = new Track(this.kind); this.clones.push(copy); return copy; }
  stop(): void { this.stopped = true; }
}
class Stream {
  readonly tracks: Track[] = [new Track('video')];
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  addTrack(track: Track) { this.tracks.push(track); }
}
const recorders: Fake[] = [];
/** Throws like Firefox does for `video/webm;codecs=vp8` once the stream carries sound. */
let refusesSound: (mime: string) => boolean = () => false;
class Fake {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  readonly mimeType: string;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  static isTypeSupported() { return true; }
  constructor(readonly stream: Stream, init: { mimeType: string }) {
    this.mimeType = init.mimeType;
    if (stream.tracks.some(track => track.kind === 'audio') && refusesSound(init.mimeType)) throw new Error('NotSupportedError');
    recorders.push(this);
  }
  get sound() { return this.stream.tracks.some(track => track.kind === 'audio'); }
  addEventListener(kind: string, listener: (event: unknown) => void) { this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]); }
  start() { this.state = 'recording'; this.listeners.get('dataavailable')?.forEach(l => l({ data: new Blob(['x'.repeat(4096)]) })); }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  requestData() {}
  stop() { this.state = 'inactive'; this.listeners.get('stop')?.forEach(l => l({})); }
}
const capture = HTMLCanvasElement.prototype.captureStream;
const live = () => recorders.filter(recorder => recorder.state !== 'inactive');

function clip(sound: () => Track | null) {
  (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = () => new Stream();
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = Fake;
  const video = new VideoClip(new I18n('en'), { watermark: false, sound: sound as () => MediaStreamTrack | null });
  (video as unknown as { context: unknown }).context = { fillRect() {}, drawImage() {} };
  video.start();
  return video;
}
const drive = (video: VideoClip, seconds: number) => {
  const source = document.createElement('canvas');
  for (let i = 0; i < Math.round(seconds * 30); i++) video.frame(source, 1 / 30);
};

afterEach(() => {
  resetEncoderSilence();
  recorders.length = 0; refusesSound = () => false;
  delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  if (capture) (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = capture;
  else delete (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream;
});

describe('the saved clip carries the game\'s sound', () => {
  it('records a copy of the game\'s track in every lane, and closing a lane leaves the game\'s own track alone', async () => {
    const game = new Track('audio');
    const video = clip(() => game);
    drive(video, 10);
    expect(live().map(recorder => recorder.sound)).toEqual([true, true]);
    expect(game.clones).toHaveLength(2);
    await video.save();
    expect(game.clones[0]!.stopped, 'the saved lane stopped its copy').toBe(true);
    expect(game.stopped, 'the game keeps its track').toBe(false);
  });

  it('opens a lane without sound before the game has any, and picks the sound up at the next lane', () => {
    let game: Track | null = null;
    const video = clip(() => game);
    expect(live().map(recorder => recorder.sound)).toEqual([false]);
    game = new Track('audio');
    drive(video, 10);
    expect(live().map(recorder => recorder.sound)).toEqual([false, true]);
  });

  it('moves on to the next container when one refuses sound, as Firefox refuses it for vp8', () => {
    refusesSound = mime => mime !== 'video/webm';
    clip(() => new Track('audio'));
    expect(live().map(recorder => [recorder.mimeType, recorder.sound])).toEqual([['video/webm', true]]);
  });

  it('records the picture alone when every container refuses sound', () => {
    refusesSound = () => true;
    const video = clip(() => new Track('audio'));
    expect(video.supported).toBe(true);
    expect(live().map(recorder => [recorder.mimeType, recorder.sound])).toEqual([['video/mp4;codecs=avc1.42E01E,mp4a.40.2', false]]);
    drive(video, 10);
    expect(live().every(recorder => !recorder.sound), 'and does not ask again').toBe(true);
  });

  it('holds while the sound is briefly gone, then starts again with the picture alone', () => {
    let game: Track | null = new Track('audio');
    const video = clip(() => game);
    drive(video, 5);
    game = null;
    drive(video, .5);
    expect(recorders.map(recorder => recorder.state), 'held, not recording picture without its sound').toEqual(['paused']);
    game = new Track('audio');
    drive(video, 1 / 30);
    expect(recorders.map(recorder => recorder.state), 'the context came back in time').toEqual(['recording']);
    game = null;
    drive(video, 1.1);
    expect(live().map(recorder => recorder.sound), 'gone for a second: the picture carries on alone').toEqual([false]);
    expect(video.seconds).toBeLessThan(.2);
  });
});

function box(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size), view = new DataView(out.buffer);
  view.setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let at = 8;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
const u32 = (...values: number[]) => { const out = new Uint8Array(values.length * 4); values.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v)); return out; };
const text = (value: string) => Uint8Array.from(value, ch => ch.charCodeAt(0));
/** tkhd version 0: version/flags, creation, modification, then the track id. */
const trak = (id: number, handler: string) => box('trak',
  box('tkhd', u32(0, 0, 0, id), new Uint8Array(80)),
  box('mdia', box('hdlr', u32(0, 0), text(handler), new Uint8Array(12))));
const traf = (id: number, samples: number) => box('traf', box('tfhd', u32(0, id)), box('trun', u32(0, samples)));

describe('mp4Samples with a sound track beside the picture', () => {
  it('counts only the picture\'s frames, whichever order the tracks come in', async () => {
    // WebKit puts sound first, Chrome puts the picture first.
    for (const [picture, sound] of [[1, 2], [2, 1]] as const) {
      const file = new Blob([box('ftyp', new Uint8Array(20)),
        box('moov', trak(sound, 'soun'), trak(picture, 'vide')),
        box('moof', traf(sound, 52), traf(picture, 31)), box('mdat', new Uint8Array(64)),
        box('moof', traf(picture, 29), traf(sound, 46)), box('mdat', new Uint8Array(64))]);
      expect(await mp4Samples(file)).toBe(60);
    }
  });

  it('passes nothing off as frames when the sound is all there is', async () => {
    const file = new Blob([box('ftyp', new Uint8Array(20)), box('moov', trak(1, 'vide'), trak(2, 'soun')),
      box('moof', traf(2, 400)), box('mdat', new Uint8Array(64))]);
    expect(await mp4Samples(file)).toBe(0);
  });
});

/** One EBML element; `size` null writes the unknown size MediaRecorder uses for its Segment and Clusters. */
function element(id: number[], body: number[], size: number | null = body.length): number[] {
  const length = size === null ? [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] : [0x80 | size];
  return [...id, ...length, ...body];
}
const track = (number: number, type: number) => element([0xae], [...element([0xd7], [number]), ...element([0x83], [type])]);
const block = (number: number) => element([0xa3], [0x80 | number, 0, 0, 0x80, 1, 2, 3]);
function webm(blocks: number[], tracks = [track(1, 1), track(2, 2)]): Blob {
  return new Blob([Uint8Array.from([
    ...element([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]),
    ...element([0x18, 0x53, 0x80, 0x67], [], null),
    ...element([0x16, 0x54, 0xae, 0x6b], tracks.flat()),
    ...element([0x1f, 0x43, 0xb6, 0x75], [], null), ...element([0xe7], [0]), ...blocks.slice(0, 3).flatMap(block),
    ...element([0x1f, 0x43, 0xb6, 0x75], [], null), ...element([0xe7], [9]),
    ...blocks.slice(3).flatMap(number => element([0xa0], element([0xa1], [0x80 | number, 0, 0, 0, 7]))),
  ])], { type: 'video/webm' });
}

describe('webmFrames', () => {
  it('counts the picture\'s blocks through unknown-size clusters, simple or grouped', async () => {
    expect(await webmFrames(webm([1, 2, 1, 2, 1]))).toBe(3);
  });

  it('finds no frames in a WebM that holds only sound, and ignores other containers', async () => {
    expect(await webmFrames(webm([2, 2, 2, 2]))).toBe(0);
    expect(await webmFrames(webm([1, 1], [track(1, 2)]))).toBe(0);
    expect(await webmFrames(new Blob(['x'.repeat(64)]))).toBeNull();
  });
});
