import { isMobileDevice } from './device';
import type { I18n } from '../ui/i18n';

/** How long after leaving fullscreen a background switch still counts as the cause. */
const FULLSCREEN_EXIT_GRACE_MS = 500;

type LockableOrientation = ScreenOrientation & { lock?: (orientation: 'landscape') => Promise<void> };

/**
 * A phone plays without the browser's address and status bars.
 *
 * Browsers only grant fullscreen inside a user gesture, so on a phone the first tap on any button
 * requests it (and a landscape lock). A player who leaves fullscreen has chosen to; taps stop pulling
 * them back, and the menu's fullscreen button is the way in again. Where the page cannot go
 * fullscreen at all (iPhone Safari), that button opens the add-to-home-screen guide instead, and the
 * web app manifest launches the home-screen icon fullscreen.
 */
/**
 * Buttons whose own job needs the tap's user activation: copying text, the system share sheet and
 * opening a new tab. A fullscreen request spends that activation, and on a phone inside itch.io's
 * iframe the page never sees itself fullscreen (itch fullscreens its own wrapper), so every tap asked
 * again -- and every copy then failed with "Could not copy" (found on the live itch page
 * on a Pixel 7 Pro had fixed the desktop case). These taps leave fullscreen alone.
 */
export const KEEPS_USER_ACTIVATION = [
  'dialog[open] button',
  '[data-share]',
  '[data-action="text"]', '[data-action="share"]', '[data-action="homepage"]', '[data-action="coffee"]',
  '[data-setting="share"]', '[data-setting="shortcut"]',
].join(', ');

export class MobileFullscreen {
  private left = false;
  private hiddenAt = -Infinity;
  private readonly listeners = new Set<() => void>();

  constructor(readonly mobile = isMobileDevice(), private readonly doc: Document = document,
    private readonly now: () => number = () => performance.now()) {
    if (!mobile) return;
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) this.hiddenAt = this.now(); });
    doc.addEventListener('fullscreenchange', () => {
      // Android Chrome also leaves fullscreen when the page goes to the background (another app, a
      // call, the lock screen). Only an exit that is not followed by hiding is the player's choice.
      if (!doc.fullscreenElement) setTimeout(() => {
        if (!doc.fullscreenElement && !doc.hidden && this.now() - this.hiddenAt > FULLSCREEN_EXIT_GRACE_MS) this.left = true;
      }, FULLSCREEN_EXIT_GRACE_MS);
      for (const listener of this.listeners) listener();
    });
    doc.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!this.left && button && !button.matches(KEEPS_USER_ACTIVATION)) void this.enter();
    }, true);
  }

  /** The page itself can request fullscreen here. */
  get supported(): boolean { return this.mobile && typeof this.doc.documentElement.requestFullscreen === 'function'; }
  get active(): boolean {
    return !!this.doc.fullscreenElement || !!window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches;
  }
  /** Whether a menu should offer the fullscreen button now. */
  get offer(): boolean { return this.mobile && !this.active; }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async enter(): Promise<boolean> {
    if (!this.supported || this.doc.fullscreenElement) return !!this.doc.fullscreenElement;
    try {
      await this.doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
      this.left = false;
      await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape').catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }
}

let shared: MobileFullscreen | null = null;
export function mobileFullscreen(): MobileFullscreen { return shared ??= new MobileFullscreen(); }

/**
 * The menu's way into fullscreen, shown on a phone only while not already fullscreen. `fallback` is
 * the add-to-home-screen guide for browsers whose pages cannot go fullscreen. `nodes` is empty on a
 * desktop, so a desktop menu keeps exactly its old buttons.
 */
export function fullscreenButton(i18n: I18n, className: string, fallback?: () => void): { nodes: HTMLButtonElement[]; render(): void } {
  const fullscreen = mobileFullscreen();
  const node = document.createElement('button');
  node.type = 'button'; node.className = className;
  node.addEventListener('click', () => { if (fullscreen.supported) void fullscreen.enter(); else fallback?.(); });
  const render = () => { node.textContent = i18n.t('menu.fullscreen'); node.hidden = !fullscreen.offer || (!fullscreen.supported && !fallback); };
  if (!fullscreen.mobile) return { nodes: [], render: () => undefined };
  fullscreen.onChange(render); render();
  return { nodes: [node], render };
}
