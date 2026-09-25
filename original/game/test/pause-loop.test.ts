import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PauseLoop, type LoopSource } from '../src/app/PauseLoop';
import { pauseScreen } from '../src/ui/PauseScreen';
import { MenuList } from '../src/ui/Ui';
import { I18n } from '../src/ui/i18n';

function source(available = true, blob: Blob | null = new Blob(['x'.repeat(2048)])) {
  let resolve!: (clip: { blob: Blob; seconds: number } | null) => void;
  const saves: number[] = [];
  const src: LoopSource & { finish(): Promise<void> } = {
    available: () => available,
    peek: () => { saves.push(1); return new Promise(done => { resolve = done; }); },
    async finish() { resolve(blob ? { blob, seconds: 9 } : null); await Promise.resolve(); await Promise.resolve(); },
  };
  return { src, saves };
}
function harness(available = true, blob?: Blob | null) {
  const { src, saves } = source(available, blob === undefined ? new Blob(['x'.repeat(2048)]) : blob);
  const shown: (string | null)[] = [], revoked: string[] = [];
  let n = 0;
  const urls = { createObjectURL: () => `blob:loop-${++n}`, revokeObjectURL: (url: string) => { revoked.push(url); } };
  const loop = new PauseLoop(src, { setLoop: url => { shown.push(url); } }, urls);
  return { loop, src, saves, shown, revoked };
}

describe('pause loop', () => {
  it('plays the finished recording behind the pause menu and lets it go on resume', async () => {
    const h = harness();
    const opening = h.loop.open();
    expect(h.shown).toEqual([]);
    await h.src.finish(); await opening;
    expect(h.shown).toEqual(['blob:loop-1']);
    expect(h.loop.playing).toBe(true);
    h.loop.close();
    expect(h.shown).toEqual(['blob:loop-1', null]);
    expect(h.revoked).toEqual(['blob:loop-1']);
    expect(h.loop.playing).toBe(false);
  });

  it('drops a recording that finishes after the player has already resumed', async () => {
    const h = harness();
    const opening = h.loop.open();
    h.loop.close();
    await h.src.finish(); await opening;
    expect(h.shown).toEqual([]);
    expect(h.revoked).toEqual([]);
    expect(h.loop.playing).toBe(false);
  });

  it('keeps the frozen frame when nothing is recorded or the recorder gives nothing back', async () => {
    const none = harness(false);
    await none.loop.open();
    expect(none.saves).toHaveLength(0);
    expect(none.shown).toEqual([]);
    const empty = harness(true, null);
    const opening = empty.loop.open(); await empty.src.finish(); await opening;
    expect(empty.shown).toEqual([]);
  });

  it('asks for one recording per pause, not one per screen shown', async () => {
    const h = harness();
    const first = h.loop.open(); void h.loop.open();
    await h.src.finish(); await first;
    await h.loop.open();
    expect(h.saves).toHaveLength(1);
  });
});

describe('pause replay opens at once', () => {
  it('shows the last recorded frame the moment the pause opens, then hands over to the video', async () => {
    const h = harness();
    const stills: HTMLCanvasElement[] = [];
    const frame = document.createElement('canvas');
    const loop = new PauseLoop({ ...h.src, still: () => frame },
      { setLoop: url => { h.shown.push(url); }, showStill: still => { stills.push(still); } },
      { createObjectURL: () => 'blob:loop-1', revokeObjectURL() {} });
    const opening = loop.open();
    expect(stills, 'before the recording is copied').toEqual([frame]);
    await h.src.finish(); await opening;
    expect(h.shown).toEqual(['blob:loop-1']);
  });

  it('keeps the still when no recording follows it, and takes it down when the player resumes', async () => {
    for (const resumeFirst of [false, true]) {
      const h = harness(true, null);
      const loop = new PauseLoop({ ...h.src, still: () => document.createElement('canvas') },
        { setLoop: url => { h.shown.push(url); }, showStill() {} });
      const opening = loop.open();
      if (resumeFirst) loop.close();
      await h.src.finish(); await opening;
      expect(h.shown, resumeFirst ? 'resumed' : 'nothing recorded').toEqual(resumeFirst ? [null] : []);
      loop.close();
      expect(h.shown.at(-1), 'resuming always takes the window down').toBeNull();
    }
  });
});

describe('pause screen replay window', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
  afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

  it('plays the drive in a window beside the menu with a scrub bar, not behind it, and takes it down again', () => {
    const screen = pauseScreen(new I18n('en'), new MenuList([]), { pick() {}, location: () => '', language() {} });
    document.body.append(screen.node);
    const box = screen.node.querySelector<HTMLElement>('.pause-aside .pause-replay')!;
    expect(box.hidden).toBe(true);
    screen.setLoop('blob:loop-1', 9);
    const video = box.querySelector<HTMLVideoElement>('video.pause-replay-video')!;
    expect(video.muted && video.loop && video.playsInline).toBe(true);
    expect(video.getAttribute('src')).toBe('blob:loop-1');
    expect(box.hidden).toBe(false);
    expect(screen.node.querySelectorAll('video')).toHaveLength(1);
    const scrub = box.querySelector<HTMLInputElement>('input[type=range].pause-replay-scrub')!;
    // The recorder's length stands in while the file does not know its own duration.
    expect(scrub.max).toBe('9');
    scrub.value = '4';
    scrub.dispatchEvent(new Event('input'));
    expect(video.currentTime).toBe(4);
    expect(box.querySelector('.pause-replay-time')!.textContent).toBe('0:04 / 0:09');
    screen.setLoop(null);
    expect(screen.node.querySelector('video')).toBeNull();
    expect(box.hidden).toBe(true);
    screen.dispose();
  });

  it('opens on the still and keeps it under the video until frames move', () => {
    const screen = pauseScreen(new I18n('en'), new MenuList([]), { pick() {}, location: () => '', language() {} });
    document.body.append(screen.node);
    const box = screen.node.querySelector<HTMLElement>('.pause-replay')!;
    const frame = document.createElement('canvas'); frame.width = 640; frame.height = 360;
    screen.showStill(frame);
    expect(box.hidden).toBe(false);
    expect(box.querySelector<HTMLElement>('.pause-replay-screen')!.style.aspectRatio).toBe('640 / 360');
    screen.setLoop('blob:loop-1', 3);
    expect(box.querySelector('canvas.pause-replay-still'), 'the still stays until the video plays').not.toBeNull();
    expect(box.querySelector('video')).not.toBeNull();
    screen.setLoop(null);
    expect(box.hidden).toBe(true);
    expect(box.querySelector('canvas')).toBeNull();
    screen.dispose();
  });

  it('keeps Space and Enter on the replay to the replay, so they never also confirm Resume', () => {
    const screen = pauseScreen(new I18n('en'), new MenuList([]), { pick() {}, location: () => '', language() {} });
    document.body.append(screen.node);
    screen.setLoop('blob:loop-1', 9);
    const menu: string[] = [];
    const onWindow = (event: KeyboardEvent) => menu.push(event.key);
    window.addEventListener('keydown', onWindow);
    try {
      const video = screen.node.querySelector<HTMLVideoElement>('video')!;
      let paused = false;
      Object.defineProperty(video, 'paused', { get: () => paused });
      video.play = () => { paused = false; return Promise.resolve(); };
      video.pause = () => { paused = true; };
      const scrub = screen.node.querySelector<HTMLInputElement>('.pause-replay-scrub')!;
      const press = (target: HTMLElement, key: string) =>
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      press(scrub, ' ');
      expect(paused, 'Space on the scrub bar pauses the replay').toBe(true);
      press(scrub, 'Enter');
      expect(paused).toBe(false);
      press(scrub, 'ArrowRight');
      press(screen.node.querySelector<HTMLElement>('.pause-replay-toggle')!, ' ');
      expect(menu, 'the menu heard none of them').toEqual([]);
      press(scrub, 'Escape');
      expect(menu, 'Escape still reaches the game and resumes').toEqual(['Escape']);
    } finally { window.removeEventListener('keydown', onWindow); screen.dispose(); }
  });
});
