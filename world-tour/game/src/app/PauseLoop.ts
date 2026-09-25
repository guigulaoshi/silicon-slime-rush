/** What the pause replay needs from a rolling recording (VideoClip). */
export interface LoopSource {
  available(): boolean;
  /** The last frame composited into the recording, shown the moment the pause opens. */
  still?(): HTMLCanvasElement | null;
  /** The recording so far, without ending it. */
  peek(): Promise<{ blob: Blob; seconds: number } | null>;
}
/** Where the loop plays; `null` takes it down. */
export interface LoopView {
  setLoop(url: string | null, seconds?: number): void;
  /** The window at once, holding this picture until the video is ready. */
  showStill?(still: HTMLCanvasElement): void;
}
/** Shortest drive worth a replay window. */
export const MIN_REPLAY_SECONDS = 1;

/**
 * While paused, the last stretch of the drive plays on a loop. Since it plays in a window beside the menu with a
 * scrub bar; the backdrop stays the frozen frame. Copying and decoding the recording takes a moment, so
 * the window opens at once on the last recorded frame and the video takes over when it plays, the way
 * the old backdrop sat on the frozen frame until the video faded in. A resume that lands first drops it. No recording (unsupported
 * browser, a phone, a drive too short) shows no window.
 */
export class PauseLoop {
  private url: string | null = null;
  private stillShown = false;
  private pending = false;
  private ticket = 0;

  constructor(private readonly source: LoopSource, private readonly view: LoopView,
    private readonly urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL) {}

  get playing(): boolean { return this.url !== null; }

  async open(): Promise<void> {
    if (this.url || this.pending || !this.source.available()) return;
    const ticket = ++this.ticket;
    this.pending = true;
    const still = this.source.still?.();
    if (still && this.view.showStill) { this.view.showStill(still); this.stillShown = true; }
    try {
      const clip = await this.source.peek();
      if (ticket !== this.ticket) return;
      // Nothing to play: the window keeps the last frame rather than flashing up and vanishing.
      if (!clip) return;
      this.url = this.urls.createObjectURL(clip.blob);
      this.view.setLoop(this.url, clip.seconds);
    } finally {
      if (ticket === this.ticket) this.pending = false;
    }
  }

  close(): void {
    this.ticket++;
    this.pending = false;
    if (!this.url && !this.stillShown) return;
    this.view.setLoop(null);
    this.stillShown = false;
    if (!this.url) return;
    this.urls.revokeObjectURL(this.url);
    this.url = null;
  }
}
