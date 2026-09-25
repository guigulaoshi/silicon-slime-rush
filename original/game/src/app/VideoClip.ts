import type { I18n } from '../ui/i18n';
import { drawWatermark } from '../ui/ShareWatermark';
import { watermarkMark } from '../ui/ShareDialog';
import { watermarkAddress } from './Publication';

export const CLIP_VIDEO = { width: 1280, height: 720, fps: 30 } as const;
/** How long each lane records before it starts again; two lanes, half a turn apart. */
export const LANE_SECONDS = 18;
/** Anything shorter than this is not worth offering; two lanes guarantee at least half a turn. */
export const MIN_CLIP_SECONDS = 4;
/** At most a container header: the same line save() draws between a clip and nothing. */
export const SILENT_BYTES = 1024;
/**
 * Where a silent recording retries before it gives up its container: small enough for the software
 * encoder, so the file stays an mp4; WebM is the last resort.
 */
export const SMALL_CLIP = { width: 640, height: 360 } as const;
/**
 * Stopping a recorder makes it hand over everything it holds, so a lane stopped after this many frames with
 * no more than a header proves its encoder silent. Only a stop can prove it: a running recorder gives up
 * data at its own fragment boundaries, and Chrome's software H.264 (640x360, measured in the
 * player's Chrome) gave nothing for over 200 frames yet a complete, playable mp4 on stop -- an earlier rule
 * that judged running recorders by frame count threw that working mp4 away for WebM. What a stop proved
 * silent (seen the same day: hardware H.264 at 960x540 and above, sessions used up) is dropped: first the
 * large size, then the container. Lanes stop every LANE_SECONDS, on every pause replay and every save.
 */
export const STOPPED_SILENT_FRAMES = 30;
/**
 * An mp4 that holds fewer than this share of the frames fed to it is broken even when it is not tiny: the
 * player's Chrome, its hardware H.264 half-working, wrote a well-formed 18 KB file for 370 frames -- one
 * sample -- which saved and downloaded fine and played nothing.
 */
export const MIN_ENCODED_SHARE = .25;

/**
 * Video frames in an mp4's fragments (the sum of the picture track's trun sample counts); null for anything
 * that is not an mp4. Only the picture counts: a sound track rides beside it, and its ~47 AAC
 * frames a second would pass a file whose video encoder gave nothing.
 */
export async function mp4Samples(blob: Blob): Promise<number | null> {
  const view = new DataView(await blob.arrayBuffer());
  const code = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  const type = (at: number) => code(at + 4);
  if (view.byteLength < 8 || type(0) !== 'ftyp') return null;
  // Walks boxes inside [from, to), handing each one's start and size to `visit`.
  const walk = (from: number, to: number, visit: (at: number, size: number) => void) => {
    for (let at = from; at + 8 <= to;) {
      const size = view.getUint32(at);
      if (size < 8 || at + size > to) return;
      visit(at, size); at += size;
    }
  };
  // Which track ids are pictures: tkhd names the id, the handler under mdia names the kind.
  const pictures = new Set<number>();
  walk(0, view.byteLength, (moov, moovSize) => {
    if (type(moov) !== 'moov') return;
    walk(moov + 8, moov + moovSize, (trak, trakSize) => {
      if (type(trak) !== 'trak') return;
      let id = -1, kind = '';
      walk(trak + 8, trak + trakSize, (box, boxSize) => {
        if (type(box) === 'tkhd' && boxSize >= 32) id = view.getUint32(box + (view.getUint8(box + 8) === 1 ? 28 : 20));
        if (type(box) === 'mdia') walk(box + 8, box + boxSize, (hdlr, hdlrSize) => { if (type(hdlr) === 'hdlr' && hdlrSize >= 20) kind = code(hdlr + 16); });
      });
      if (kind === 'vide') pictures.add(id);
    });
  });
  let samples = 0;
  walk(0, view.byteLength, (moof, moofSize) => {
    if (type(moof) !== 'moof') return;
    walk(moof + 8, moof + moofSize, (traf, trafSize) => {
      if (type(traf) !== 'traf') return;
      let id = -1;
      walk(traf + 8, traf + trafSize, (box, boxSize) => {
        if (type(box) === 'tfhd' && boxSize >= 16) id = view.getUint32(box + 12);
        if (type(box) === 'trun' && boxSize >= 16 && pictures.has(id)) samples += view.getUint32(box + 12);
      });
    });
  });
  return samples;
}

/**
 * Video frames in a WebM (blocks on its picture track); null for anything that is not a WebM.: with
 * sound in the lane a WebM whose picture encoder gave nothing is no longer a sub-kilobyte file, so size alone
 * cannot tell it from a clip. MediaRecorder writes the Segment and its Clusters with unknown sizes, so this
 * reads the file as one flat run of elements, stepping into the few that hold what it counts.
 */
export async function webmFrames(blob: Blob): Promise<number | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) return null;
  // An EBML variable-length integer at `at`: its length, and its value without the length marker.
  const vint = (at: number): [number, number] | null => {
    const first = bytes[at];
    if (first === undefined || first === 0) return null;
    const length = Math.clz32(first) - 23;
    if (at + length > bytes.length) return null;
    let value = first & (0xff >> length);
    for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i]!;
    return [length, value];
  };
  const ENTER = new Set([0x18538067, 0x1654ae6b, 0xae, 0x1f43b675, 0xa0]); // Segment, Tracks, TrackEntry, Cluster, BlockGroup
  const pictures = new Set<number>();
  let entry = { number: -1, type: -1 }, frames = 0;
  for (let at = 0; at < bytes.length;) {
    const idLength = vint(at)?.[0];
    if (!idLength) break;
    let id = 0;
    for (let i = 0; i < idLength; i++) id = id * 256 + bytes[at + i]!;
    const size = vint(at + idLength);
    if (!size) break;
    const body = at + idLength + size[0];
    if (ENTER.has(id)) { if (id === 0xae) entry = { number: -1, type: -1 }; at = body; continue; }
    const uint = () => { let value = 0; for (let i = 0; i < size[1] && body + i < bytes.length; i++) value = value * 256 + bytes[body + i]!; return value; };
    if (id === 0xd7) entry.number = uint();
    if (id === 0x83) entry.type = uint();
    if ((id === 0xd7 || id === 0x83) && entry.type === 1 && entry.number >= 0) pictures.add(entry.number);
    // SimpleBlock, or Block inside a BlockGroup: the payload opens with its track number.
    if ((id === 0xa3 || id === 0xa1) && pictures.has(vint(body)?.[1] ?? -1)) frames++;
    at = body + size[1];
  }
  return frames;
}

/**
 * What one recorder learned about this browser's encoders holds for every recorder on the page: the
 * saved clip and the pause replay share the machine, so the second need not run into the same wall.
 */
const silence = { large: false, containers: new Set<string>() };
/** Tests only: a fresh page. */
export function resetEncoderSilence(): void { silence.large = false; silence.containers.clear(); }
const containerOf = (mime: string) => mime.split(';')[0]!;
/**
 * mp4 first, because the file has to be shareable, not just playable: iOS cannot save a WebM to the
 * camera roll, and X, Facebook and Reddit all refuse WebM uploads. WebM stays at the back because
 * Firefox has no mp4 muxer at all (Bugzilla 1631143, open since 2020) and would otherwise get
 * nothing. `video/mp4;codecs=h264` is deliberately absent: Safari answers false to that spelling
 *While it answers true to the avc1 spellings below.
 */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/**
 * The first container this browser will actually record, or null.
 *
 * Safari has recorded MediaRecorder since 14.1 / iOS 14.5 (2021) -- it just only answered true for
 * mp4 until 18.4. An earlier comment here claimed "Safari not yet", which was our own candidate
 * list talking: it listed WebM only, so `isTypeSupported` was always false and we read that as the
 * browser's verdict instead of ours.
 */
export function clipMime(): string | null {
  return clipMimes()[0] ?? null;
}

/**
 * Every container this browser claims, best first. More than one matters because `isTypeSupported`
 * only inspects the string, so a browser may accept it and still refuse the recorder -- Firefox says
 * yes to `video/webm;codecs=vp8` and then refuses a stream with sound in it. Then we drop
 * that candidate and try the next rather than dropping the feature. With sound in the stream the first
 * candidate records H.264 + AAC on Chrome and Safari; Firefox lands on plain `video/webm`, VP8 + Opus.
 */
export function clipMimes(): string[] {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return [];
  return MIME_CANDIDATES.filter(mime => MediaRecorder.isTypeSupported(mime));
}

interface Lane {
  recorder: MediaRecorder; chunks: Blob[]; since: number;
  /** Frames composited while it recorded. */
  frames: number;
  /** Set when frames are handed over one by one; absent where the browser can only capture on its own clock. */
  track?: CanvasCaptureMediaStreamTrack;
  /** It records the game's sound as well as its picture. */
  sound: boolean;
}

/**
 * The last dozen seconds of the drive, watermarked, ready to save.
 *
 * A WebM file cannot be trimmed at the front -- its header belongs to the first chunk -- so a
 * rolling window is two recorders started half a turn apart: whichever has been running longer is
 * the one that gets saved, which puts the floor at half a turn and the ceiling at a whole one.
 * What both record is a 1280x720 composite of the game's own canvas plus the watermark, so the
 * saved clip carries the game's name and address like every shared picture does.
 */
export class VideoClip {
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly lanes: Lane[] = [];
  private candidates = clipMimes();
  private get mime(): string | null { return this.candidates[0] ?? null; }
  private icon: HTMLImageElement | null = null;
  private clock = 0;
  /** Bumped by stop(), so a lane that ends after a restart cannot judge the recorders that replaced it. */
  private run = 0;
  private lastFrame = -Infinity;
  private drawCost = 0;
  private frames = 0;

  private width: number;
  private height: number;
  private readonly watermark: boolean;
  private readonly bitrate: number;
  /**
   * The game's sound, null while there is none to be had (GameAudio.recordingTrack). The pause
   * replay passes none -- it plays muted behind the menu, so sound would only cost encoding.
   */
  private readonly sound: (() => MediaStreamTrack | null) | null;
  /** Candidates that refused a stream with sound in it; they get another turn without it. */
  private refusedSound: string[] = [];
  /** Set once every candidate refused sound: this browser records the picture only. */
  private soundless = false;
  /** Seconds the game has drawn while a lane's sound was gone. */
  private soundGone = 0;

  /** The pause screen's backdrop is a second, smaller, unmarked recording of the same drive. */
  constructor(private readonly i18n: I18n,
    options: { width?: number; height?: number; watermark?: boolean; bitrate?: number;
      sound?: () => MediaStreamTrack | null } = {}) {
    this.width = options.width ?? CLIP_VIDEO.width; this.height = options.height ?? CLIP_VIDEO.height;
    this.watermark = options.watermark ?? true; this.bitrate = options.bitrate ?? 4_000_000;
    this.sound = options.sound ?? null;
    this.canvas.width = this.width; this.canvas.height = this.height;
    this.context = this.canvas.getContext('2d', { alpha: false })!;
    // A hidden tab stops the game loop before it can call hold(), so the tab itself holds the recording.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.hidden) this.hold(); });
  }

  get supported(): boolean { return !!this.mime && !this.failed; }
  /** Set when a recorder that claimed to work threw or errored; the offer is withdrawn. */
  private failed = false;
  get recording(): boolean { return this.lanes.length > 0; }
  /** Seconds available to save right now. */
  get seconds(): number { return this.lanes.reduce((best, lane) => Math.max(best, this.clock - lane.since), 0); }
  get available(): boolean { return this.seconds >= MIN_CLIP_SECONDS; }
  get stats() { return { recording: this.recording, seconds: Number(this.seconds.toFixed(1)), lanes: this.lanes.length,
    frames: this.frames, meanDrawMs: this.frames ? Number((this.drawCost / this.frames).toFixed(3)) : 0 }; }

  /**
   * A lane proved its encoder silent: first the large size goes (a size the software encoder takes keeps the
   * file an mp4), then the container. Every recorder on the page follows, and this one starts over.
   */
  private silenced(lane: Lane): void {
    const container = containerOf(lane.recorder.mimeType || this.mime || '');
    this.stop();
    if (this.width > SMALL_CLIP.width) silence.large = true;
    else silence.containers.add(container);
    this.start();
  }

  /** Brings size and formats in line with what the page has learned; false when nothing is left to try. */
  private heedSilence(): boolean {
    if (silence.large && this.width > SMALL_CLIP.width) {
      this.width = SMALL_CLIP.width; this.height = SMALL_CLIP.height;
      this.canvas.width = this.width; this.canvas.height = this.height;
    }
    this.candidates = this.candidates.filter(mime => !silence.containers.has(containerOf(mime)));
    if (!this.candidates.length) { this.failed = true; return false; }
    return true;
  }

  start(): void {
    if (!this.heedSilence()) return;
    if (!this.mime || this.lanes.length) return;
    this.clock = 0; this.lastFrame = -Infinity; this.drawCost = 0; this.frames = 0;
    // The icon loader every shared picture already uses, so this badge matches theirs.
    if (this.watermark) void watermarkMark().then(icon => { this.icon = icon; });
    this.openLane();
  }

  stop(): void {
    this.run++; this.soundGone = 0;
    for (const lane of this.lanes.splice(0)) this.closeLane(lane);
    this.clock = 0; this.lastFrame = -Infinity;
  }

  /** Stops one lane's recorder and its capture track, so nothing keeps drawing from the canvas. */
  private closeLane(lane: Lane): void {
    try { lane.recorder.stop(); } catch { /* already inactive */ }
    for (const track of lane.recorder.stream.getTracks()) track.stop();
  }

  /**
   * The game stopped drawing (pause menu, results, a dialog). MediaRecorder stamps frames with wall-clock
   * time, so a recorder left running turns the wait into one frame that lasts the whole wait: a saved
   * file of 15 s of driving came out 179 s long, 161 s of it one still frame.
   */
  hold(): void {
    for (const lane of this.lanes) if (lane.recorder.state === 'recording') lane.recorder.pause();
  }

  /** One composited frame, at most `fps` a second; the game's own canvas is the source. */
  frame(source: HTMLCanvasElement, dt: number): void {
    if (!this.lanes.length) return;
    // A lane with sound needs the sound to keep coming: WebKit wrote a broken mp4 when it stopped (see
    // GameAudio.recordingTrack). Coming back to a tab, the context is only a moment behind, so hold for it;
    // after a second, start again with the picture alone -- the next lane picks the sound up once it is back.
    if (this.sound && this.lanes.some(lane => lane.sound) && !this.sound()) {
      this.hold();
      this.soundGone += dt;
      if (this.soundGone >= 1) { this.stop(); this.start(); }
      return;
    }
    this.soundGone = 0;
    for (const lane of this.lanes) if (lane.recorder.state === 'paused') lane.recorder.resume();
    this.clock += dt;
    // A lane past its turn is replaced, so the other one always holds at least half a turn.
    if (this.lanes.length < 2 && this.clock >= LANE_SECONDS / 2) this.openLane();
    for (const lane of [...this.lanes]) {
      if (this.clock - lane.since < LANE_SECONDS) continue;
      this.lanes.splice(this.lanes.indexOf(lane), 1);
      void this.endLane(lane);
      this.openLane();
    }
    if (this.clock - this.lastFrame + 1e-6 < 1 / CLIP_VIDEO.fps) return;
    this.lastFrame = this.clock;
    const began = performance.now(), ctx = this.context;
    /* */
    const wider = source.width / source.height >= this.width / this.height;
    const scale = (wider ? Math.max : Math.min)(this.width / source.width, this.height / source.height);
    const width = source.width * scale, height = source.height * scale;
    ctx.fillStyle = '#08121c'; ctx.fillRect(0, 0, this.width, this.height);
    ctx.drawImage(source, (this.width - width) / 2, (this.height - height) / 2, width, height);
    if (this.watermark) drawWatermark(ctx, this.i18n, this.icon, watermarkAddress());
    this.drawCost += performance.now() - began; this.frames++;
    // Each composited frame is handed to the encoder once, by hand: see openLane.
    for (const lane of this.lanes) { lane.frames++; lane.track?.requestFrame(); }
  }

  /**
   * Ends the longer lane and hands back its complete file; recording carries on in the other one. Not a
   * copy: Chrome's mp4 muxer keeps its current fragment (up to ~3 s) until the lane ends, and that is the
   * last stretch a player wants. Game restarts the replay recorder's lane with it, so the two stay equal.
   */
  async save(): Promise<{ blob: Blob; seconds: number } | null> {
    if (!this.lanes.length || !this.available) return null;
    const run = this.run;
    const clip = await this.finishLongest();
    // The lane proved its encoder silent and recording has moved on to what works: nothing to save this
    // time, but the offer stays (it is withdrawn in heedSilence when nothing is left to try).
    if (run !== this.run) return null;
    // `isTypeSupported` is not a promise that recording worked: WebKit has shipped canvas capture
    // that yields black frames (bug 230613) and iOS reports of start() failing after a true answer.
    // A file this small is not a clip, so treat it as "this machine cannot", not as a saved video.
    // A picture track with nothing on it is no clip either, however much sound came with it.
    if (clip.blob.size > SILENT_BYTES && await webmFrames(clip.blob) !== 0) return clip;
    // Nothing usable came out of a recorder that claimed to work, so withdraw the offer rather
    // than leave a button that fails every time it is pressed.
    this.failed = true; this.stop();
    return null;
  }

  /**
   * A copy of what the longer lane has recorded so far, for the pause replay. No minimum length:
   * a short drive still gets its replay.
   */
  async peek(): Promise<{ blob: Blob; seconds: number } | null> {
    if (!this.lanes.length) return null;
    let clip = await this.copyLongest();
    // A short drive is still inside the mp4 muxer's first fragment (about a hundred frames), so a copy is only
    // the header and the window flashed up and vanished.
    if (clip.blob.size <= SILENT_BYTES) clip = await this.finishLongest();
    return clip.blob.size > SILENT_BYTES ? clip : null;
  }

  /** Stops a lane, waits for everything it holds, and drops what that proves silent: next to nothing, or an mp4 missing most of its frames. */
  private async endLane(lane: Lane): Promise<Blob> {
    const run = this.run;
    const done = new Promise<void>(resolve => { lane.recorder.addEventListener('stop', () => resolve(), { once: true }); });
    this.closeLane(lane);
    await done;
    const blob = new Blob(lane.chunks, { type: lane.recorder.mimeType || this.mime || 'video/webm' });
    if (run !== this.run || lane.frames < STOPPED_SILENT_FRAMES) return blob;
    const samples = blob.size > SILENT_BYTES ? await mp4Samples(blob) : 0;
    if (run === this.run && samples !== null && samples < lane.frames * MIN_ENCODED_SHARE) {
      this.silenced(lane);
      return new Blob([], { type: blob.type });
    }
    return blob;
  }

  /** Ends the longer lane for its complete file and opens a fresh one in its place. */
  async finishLongest(): Promise<{ blob: Blob; seconds: number }> {
    const lane = this.lanes.reduce((best, item) => item.since <= best.since ? item : best);
    const seconds = this.clock - lane.since;
    this.lanes.splice(this.lanes.indexOf(lane), 1);
    const run = this.run;
    const blob = await this.endLane(lane);
    if (run === this.run) this.openLane();
    return { blob, seconds };
  }

  /** Flushes the longer lane and copies it without stopping it, so both lanes keep their half-turn stagger. */
  private async copyLongest(): Promise<{ blob: Blob; seconds: number }> {
    const lane = this.lanes.reduce((best, item) => item.since <= best.since ? item : best);
    const seconds = this.clock - lane.since;
    if (lane.recorder.state !== 'inactive') {
      const flushed = new Promise<void>(resolve => {
        lane.recorder.addEventListener('dataavailable', () => resolve(), { once: true });
      });
      try { lane.recorder.requestData(); await flushed; } catch { /* keep what was already delivered */ }
    }
    return { blob: new Blob(lane.chunks, { type: this.mime ?? 'video/webm' }), seconds };
  }

  private openLane(): void {
    // Construction and start() can both throw on a browser whose isTypeSupported said yes. Give up
    // one candidate at a time; only when none is left is the feature genuinely unavailable. With sound, a
    // refusal may be about the sound alone, so a browser that refuses it everywhere records the picture alone.
    for (;;) {
      const sound = this.soundless ? null : this.sound?.() ?? null;
      while (this.candidates.length) {
        const mime = this.candidates[0]!;
        if (this.tryLane(mime, sound)) return;
        this.candidates = this.candidates.slice(1);
        if (sound) this.refusedSound.push(mime);
      }
      if (!sound || !this.refusedSound.length) break;
      this.soundless = true;
      this.candidates = this.refusedSound; this.refusedSound = [];
    }
    this.failed = true; this.stop();
  }

  /** Starts one lane recording `mime`, with the game's sound when there is some; false when the browser refuses. */
  private tryLane(mime: string, sound: MediaStreamTrack | null): boolean {
    let stream: MediaStream | null = null;
    try {
      // Frames on demand, not on the browser's clock: captureStream(fps) samples the canvas when the page
      // paints, so a locked screen, an occluded window or a slow compositor recorded nothing at all -- every
      // browser and container came back 0 bytes overnight -- and what it did catch never matched
      // the frames drawn. requestFrame() after each composite records exactly those frames.
      const manual = this.canvas.captureStream(0);
      const track = manual.getVideoTracks?.()[0] as CanvasCaptureMediaStreamTrack | undefined;
      const onDemand = !!track && typeof track.requestFrame === 'function';
      if (!onDemand) for (const other of manual.getTracks()) other.stop();
      stream = onDemand ? manual : this.canvas.captureStream(CLIP_VIDEO.fps);
      // A clone per lane: closing a lane stops its tracks, and the game's own track has to outlive it.
      // Sound and picture share the recorder's clock, so a held (paused) lane skips both alike: the pause
      // menu's music never lands in the file, and the drive after it stays in step (measured:
      // a beep drawn with a white frame after a pause landed 35 ms after it in Chromium, 9 ms before it in
      // Firefox and 56 ms after it in WebKit, all within two frames).
      if (sound) stream.addTrack(sound.clone());
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: this.bitrate });
      const lane: Lane = { recorder, chunks: [], since: this.clock, frames: 0, sound: !!sound, ...(onDemand ? { track } : {}) };
      recorder.addEventListener('dataavailable', event => { if (event.data.size) lane.chunks.push(event.data); });
      recorder.addEventListener('error', () => { this.failed = true; this.stop(); });
      recorder.start(1000);
      this.lanes.push(lane);
      return true;
    } catch {
      for (const track of stream?.getTracks?.() ?? []) track.stop();
      return false;
    }
  }
}
