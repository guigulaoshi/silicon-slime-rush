import type { MenuAction } from '../input/types';
import type { I18n } from './i18n';
import { resetPageZoom } from './pageZoom';

export type ScreenName = 'boot' | 'menu' | 'intro' | 'hud' | 'pause' | 'results' | 'settings' | 'about';

export interface MenuItem {
  id: string;
  label: string;
  detail?: string;
  note?: string;
  disabled?: boolean;
}

/**
 * A list that can be walked with a keyboard, a stick or a mouse.
 *
 * Disabled entries are skipped by the cursor rather than hidden.
 */
export class MenuList {
  index = 0;

  constructor(public items: MenuItem[]) {
    this.index = this.firstEnabled();
  }

  get current(): MenuItem | undefined {
    return this.items[this.index];
  }

  setItems(items: MenuItem[]): void {
    const previous = this.current?.id;
    this.items = items;
    const found = items.findIndex((i) => i.id === previous && !i.disabled);
    this.index = found >= 0 ? found : this.firstEnabled();
  }

  move(delta: number): boolean {
    const n = this.items.length;
    if (!n) return false;
    for (let step = 1; step <= n; step++) {
      const i = (this.index + delta * step + n * step) % n;
      if (!this.items[i]?.disabled) {
        const changed = i !== this.index;
        this.index = i;
        return changed;
      }
    }
    return false;
  }

  select(id: string): boolean {
    const i = this.items.findIndex((item) => item.id === id && !item.disabled);
    if (i < 0) return false;
    this.index = i;
    return true;
  }

  private firstEnabled(): number {
    const i = this.items.findIndex((item) => !item.disabled);
    return i < 0 ? 0 : i;
  }
}

/** Apply a menu action to a list, returning what the caller should do about it. */
export function applyAction(list: MenuList, action: MenuAction): 'moved' | 'confirm' | 'back' | null {
  switch (action) {
    case 'up': case 'left': return list.move(-1) ? 'moved' : null;
    case 'down': case 'right': return list.move(1) ? 'moved' : null;
    case 'confirm': return list.current && !list.current.disabled ? 'confirm' : null;
    case 'back': return 'back';
    default: return null;
  }
}

export function el(tag: string, className = '', text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Shows one screen at a time and keeps the DOM out of the game loop. */
export class Screens {
  private readonly nodes = new Map<ScreenName, HTMLElement>();
  private active: ScreenName | null = null;

  constructor(private readonly root: HTMLElement, readonly i18n: I18n) {}

  register(name: ScreenName, node: HTMLElement): HTMLElement {
    node.classList.add('screen');
    node.hidden = true;
    node.inert = true;
    node.dataset.screen = name;
    node.tabIndex = -1;
    node.addEventListener('keydown', e => {
      if (e.defaultPrevented) return;
      const button = e.target instanceof Element ? e.target.closest<HTMLElement>('button,[role="button"]') : null;
      if (!button || (e.code !== 'Enter' && e.code !== 'Space')) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat && !button.matches(':disabled,[aria-disabled="true"]')) button.click();
    });
    this.root.appendChild(node);
    this.nodes.set(name, node);
    return node;
  }

  show(name: ScreenName, backdrop?: ScreenName): void {
    if (this.active === name) return;
    for (const [key, node] of this.nodes) {
      node.hidden = key !== name && key !== backdrop;
      node.inert = key !== name;
    }
    this.active = name;
    if (name === 'intro' || name === 'hud') resetPageZoom();
    const node = this.nodes.get(name);
    queueMicrotask(() => {
      if (this.active !== name || !node || this.root.inert) return;
      const home = node.dataset.home === 'true';
      // The loading screen's start button is disabled until the race is ready; falling through to the
      // first enabled button put focus on Back, so a keyboard player's next Enter cancelled the load.
      const primary = node.querySelector<HTMLButtonElement>(home ? '.home-go' : '.sm-go, .departure-go');
      const target = home ? primary ?? node : name === 'hud' ? node : node.querySelector<HTMLElement>('button[aria-selected="true"]:not(:disabled), .row[aria-selected="true"]')
        ?? (primary ? (primary.disabled ? node : primary) : node.querySelector<HTMLElement>('button:not(:disabled)'))
        ?? node;
      target.focus({ preventScroll: true });
    });
  }

  get(name: ScreenName): HTMLElement | undefined {
    return this.nodes.get(name);
  }

  get current(): ScreenName | null {
    return this.active;
  }
}
