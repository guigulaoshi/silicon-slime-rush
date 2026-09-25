import { actionIcon, brandTitle, creatorCards, renderBrandSignature, renderLanguageToggle, fitReplica, replicaButton } from './Replica';
import { el, type MenuItem, type MenuList } from './Ui';
import type { I18n } from './i18n';
import type { Screen } from './screens';

export interface PauseScreen extends Screen {
  dispose(): void;
  /**
   * The last stretch of the drive plays in a window beside the menu, with
   * a scrub bar. `seconds` is the recorder's own length, used while the file does not know its duration.
   * `null` takes the window down.
   */
  setLoop(url: string | null, seconds?: number): void;
  /** Opens the window at once on a copy of this picture; the video, when it plays, covers it. */
  showStill(still: HTMLCanvasElement): void;
}
export function pauseScreen(t: I18n, list: MenuList, options: {
  pick(item: MenuItem): void;
  location(): string;
  language(): void;
  /** Seconds of drive available to save as a video, or 0 when the browser cannot record. */
  clipSeconds?(): number;
}): PauseScreen {
  const node = el('div', 'replica replica-screen'), frame = el('div', 'replica-frame');
  const header = el('header'), brand = el('span', '', brandTitle(t));
  const language = replicaButton('', undefined, 'language'); language.onclick = options.language;
  header.append(brand, language);
  const main = el('main'), layout = el('div', 'pause-layout'), menu = el('section', 'pause-menu');
  const eyebrow = el('div', 'eyebrow'), title = el('h1'), location = el('p', 'pause-location');
  menu.append(eyebrow, title, location);
  const grid = el('div', 'pause-grid'), buttons = new Map<string, HTMLButtonElement>();
  // Share opens the game's share card, moved here from Settings.
  for (const [id, icon] of [['resume', 'play'], ['photo', 'camera'], ['clip', 'film'], ['share', 'share'], ['settings', 'settings'],
    ['restart', 'restart'], ['quit', 'house']] as const) {
    const button = replicaButton('', icon, id === 'resume' ? 'extra-primary resume' : '');
    button.dataset.action = id; buttons.set(id!, button);
    if (id === 'resume') menu.append(button);
    else grid.append(button);
  }
  menu.append(grid);
  const aside = el('aside', 'pause-aside');
  const cards = creatorCards(t, () => {}); aside.append(cards);
  for (const button of cards.querySelectorAll<HTMLButtonElement>('button')) buttons.set(button.dataset.action!, button);
  layout.append(menu, aside); main.append(layout); frame.append(header, main); node.append(frame);
  const unfit = fitReplica(node, frame);
  const keys: Record<string, string> = { resume: 'replica.resume', photo: 'photo.title', settings: 'settings.title',
    restart: 'replica.restart', quit: 'replica.menu', homepage: 'replica.home', coffee: 'replica.coffee',
    clip: 'clip.save', share: 'results.share' };
  const syncSelection = () => {
    for (const [id, button] of buttons) button.setAttribute('aria-selected', String(list.current?.id === id));
  };
  for (const [id, button] of buttons) {
    button.onclick = () => { list.select(id); syncSelection(); const item = list.current; if (item) options.pick(item); };
    button.onfocus = button.onmouseenter = () => { list.select(id); syncSelection(); };
  }
  function render() {
    renderBrandSignature(brand, t); eyebrow.textContent = t.t('replica.pauseEyebrow'); title.textContent = t.t('replica.pauseTitle'); location.textContent = options.location();
    renderLanguageToggle(language, t);
    // Only offered while there is something recorded to hand over.
    const clipSeconds = Math.floor(options.clipSeconds?.() ?? 0);
    buttons.get('clip')!.hidden = clipSeconds <= 0;
    list.setItems([...buttons.keys()].filter(id => !buttons.get(id)!.hidden).map(id => ({ id, label: t.t(keys[id]!, { seconds: clipSeconds }) })));
    for (const [id, button] of buttons) {
      if (['homepage', 'coffee'].includes(id)) continue;
      button.querySelector('span')!.textContent = t.t(keys[id]!, { seconds: clipSeconds });
    }
    cards.querySelector('.creator-home strong')!.textContent = t.t('replica.home');
    cards.querySelector('.creator-home small')!.textContent = t.t('replica.creator');
    cards.querySelector('.coffee strong')!.textContent = t.t('replica.coffee');
    syncSelection();
    if ([...buttons.values()].includes(document.activeElement as HTMLButtonElement))
      buttons.get(list.current?.id ?? '')?.focus({ preventScroll: true });
  }
  // The replay window: the video, a play/pause toggle, a scrub bar and the time. Hidden until a recording arrives.
  const replay = el('figure', 'pause-replay'); replay.hidden = true;
  const screenBox = el('div', 'pause-replay-screen');
  const controls = el('div', 'pause-replay-controls');
  const toggle = el('button', 'pause-replay-toggle') as HTMLButtonElement; toggle.type = 'button';
  const scrub = document.createElement('input');
  scrub.type = 'range'; scrub.className = 'pause-replay-scrub'; scrub.min = '0'; scrub.step = 'any'; scrub.value = '0';
  const clock = el('span', 'pause-replay-time');
  controls.append(toggle, scrub, clock); replay.append(screenBox, controls); aside.prepend(replay);
  let loop: HTMLVideoElement | null = null, fallbackSeconds = 0, dragging = false, resumeAfterDrag = false, raf = 0;
  const length = () => loop && Number.isFinite(loop.duration) && loop.duration > 0 ? loop.duration : fallbackSeconds;
  const stamp = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  function syncControls() {
    if (!loop) return;
    const total = length();
    scrub.max = String(total || 1);
    if (!dragging) scrub.value = String(Math.min(loop.currentTime, total || loop.currentTime));
    scrub.style.setProperty('--filled', `${total ? Math.min(100, Number(scrub.value) / total * 100) : 0}%`);
    clock.textContent = `${stamp(Number(scrub.value))} / ${stamp(total)}`;
    toggle.replaceChildren(actionIcon(loop.paused && !resumeAfterDrag ? 'play' : 'pause'));
    toggle.setAttribute('aria-label', t.t(loop.paused && !resumeAfterDrag ? 'replay.play' : 'replay.pause'));
  }
  // A recorder's WebM carries no duration, so `loop` never sees an end: playback just stops on the last
  // frame. A playhead that has not moved for half a second while playing, past the start, has reached the end.
  let lastTime = -1, lastMoved = 0;
  function rewindAtEnd(now: number) {
    if (!loop || loop.paused || dragging || loop.seeking) { lastMoved = now; return; }
    if (loop.currentTime !== lastTime) { lastTime = loop.currentTime; lastMoved = now; return; }
    if (loop.currentTime > 1 && now - lastMoved > 500) { loop.currentTime = 0; lastMoved = now; }
  }
  const tick = (now = performance.now()) => { rewindAtEnd(now); syncControls(); raf = loop ? requestAnimationFrame(tick) : 0; };
  toggle.onclick = () => {
    if (!loop) return;
    if (loop.paused) void loop.play()?.catch(() => {}); else loop.pause();
    syncControls();
  };
  const seek = () => { if (loop) { loop.currentTime = Number(scrub.value); syncControls(); } };
  scrub.addEventListener('pointerdown', () => {
    if (!loop || dragging) return;
    dragging = true; resumeAfterDrag = !loop.paused; loop.pause();
  });
  scrub.addEventListener('input', seek);
  const endDrag = () => {
    if (!dragging || !loop) { dragging = false; return; }
    dragging = false; seek();
    if (resumeAfterDrag) void loop.play()?.catch(() => {});
    resumeAfterDrag = false; syncControls();
  };
  scrub.addEventListener('change', endDrag);
  // Keys pressed while the replay has focus belong to the replay: the menu listens on the window, and a
  // Space meant for the video must not also confirm the selected menu item (usually Resume). Escape still resumes.
  replay.addEventListener('keydown', event => {
    if (event.key === 'Escape') return;
    event.stopPropagation();
    if (event.target === scrub && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); toggle.click(); }
  });
  replay.addEventListener('keyup', event => { if (event.key !== 'Escape') event.stopPropagation(); });
  scrub.addEventListener('pointerup', endDrag);
  scrub.addEventListener('pointercancel', endDrag);
  function dropVideo() {
    if (loop) { loop.pause(); loop.removeAttribute('src'); loop.load(); loop.remove(); loop = null; }
    cancelAnimationFrame(raf); raf = 0; dragging = false; resumeAfterDrag = false;
    replay.classList.remove('live');
  }
  function showStill(source: HTMLCanvasElement) {
    dropVideo();
    const still = document.createElement('canvas');
    still.className = 'pause-replay-still'; still.width = source.width; still.height = source.height;
    still.getContext('2d')?.drawImage(source, 0, 0);
    screenBox.style.aspectRatio = `${source.width} / ${source.height}`;
    screenBox.replaceChildren(still);
    clock.textContent = ''; toggle.replaceChildren(actionIcon('play'));
    replay.hidden = false;
  }
  function setLoop(url: string | null, seconds = 0) {
    dropVideo();
    if (!url) {
      replay.hidden = true; screenBox.replaceChildren(); screenBox.style.removeProperty('aspect-ratio');
      return;
    }
    fallbackSeconds = seconds;
    const video = document.createElement('video');
    video.className = 'pause-replay-video';
    video.muted = true; video.loop = true; video.autoplay = true; video.playsInline = true;
    video.setAttribute('aria-label', t.t('replay.title'));
    // The screen takes the recording's own shape (16:9 today, but read from the file, not assumed).
    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth && video.videoHeight) screenBox.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    }, { once: true });
    // The video covers the still only once frames are actually moving, so a slow decoder never shows black.
    video.addEventListener('playing', () => replay.classList.add('live'), { once: true });
    video.src = url;
    screenBox.append(video); loop = video; replay.hidden = false;
    tick();
    void video.play()?.catch(() => { /* autoplay refused: the window waits for the play button */ });
  }
  return {
    node, render, setLoop, showStill,
    dispose() { setLoop(null); unfit(); node.remove(); },
  };
}
