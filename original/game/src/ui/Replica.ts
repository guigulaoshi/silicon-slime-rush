import { el } from './Ui';
import type { I18n } from './i18n';
import './replica.css';

/* */
export function fitReplica(host: HTMLElement, frame: HTMLElement): () => void {
  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const designWidth = w < 1000 ? 844 : 1024, designHeight = designWidth * 9 / 16;
    const scale = Math.min(w / designWidth, h / designHeight);
    host.dataset.device = designWidth === 844 ? 'mobile' : 'desktop';
    frame.style.width = `${w / scale}px`; frame.style.height = `${h / scale}px`;
    frame.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  return () => observer.disconnect();
}

/** Simple line drawings used by the accepted controls; no downloaded icon assets. */
export function actionIcon(name: string): SVGSVGElement {
  const paths: Record<string, string> = {
    play: 'M6 3 20 12 6 21Z', camera: 'M3 7h4l2-3h6l2 3h4v13H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    settings: 'M9 3h6l1 4 4 1 2 5-3 3-1 4-5 2-3-3-4-1-2-5 3-3 1-4Zm7 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    restart: 'M3 10V4m0 6h6M3 10a9 9 0 1 1 1 8', house: 'm3 10 9-7 9 7v11h-6v-8H9v8H3Z',
    external: 'M14 3h7v7m0-7L10 14M10 5H3v16h16v-7',
    link: 'M9 17H7a5 5 0 0 1 0-10h2m6 0h2a5 5 0 0 1 0 10h-2M8 12h8',
    map: 'm3 5 6-3 6 3 6-3v17l-6 3-6-3-6 3ZM9 2v17m6-14v17',
    music: 'M9 18V5l12-2v13M9 5v5l12-2M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    volume: 'M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
    monitor: 'M3 3h18v14H3ZM12 17v4m-4 0h8',
    languages: 'M3 5h12M9 2v3m4 0c-1 6-4 9-10 12M5 9l8 7m1 6 5-12 5 12m-8-4h6',
    sparkles: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4',
    help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1',
    check: 'm4 12 5 5L20 6', back: 'M20 12H4m6-6-6 6 6 6', forward: 'M4 12h16m-6-6 6 6-6 6',
    keyboard: 'M2 5h20v14H2ZM5 8h1m3 0h1m3 0h1m3 0h1M5 11h1m3 0h1m3 0h1m3 0h1M6 15h12',
    phone: 'M6 2h12v20H6ZM11 18h2',
    user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21a8 8 0 0 1 16 0',
    film: 'M3 5h18v14H3ZM3 9h4m10 0h4M3 15h4m10 0h4M9 5v14',
    pause: 'M7 3h3v18H7ZM14 3h3v18h-3Z', close: 'm6 6 12 12M18 6 6 18',
    sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
    moon: 'M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10',
    drop: 'M12 3c-1 5-7 7-7 12a7 7 0 0 0 14 0c0-5-6-7-7-12Z',
    dropOff: 'm3 3 18 18M10 6c-2 4-5 5-5 9a7 7 0 0 0 11 6M14 5c1 4 5 6 5 10',
    power: 'M12 2v10M6 5a9 9 0 1 0 12 0', gauge: 'M3 18a10 10 0 1 1 18 0M12 13l5-5',
    zoom: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-2 4 7 7M7 10h6m-3-3v6',
    coffee: 'M4 8h12v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Zm12 1h2a3 3 0 0 1 0 6h-2M6 2v2m4-2v2m4-2v2',
    share: 'M7 11 17 5M7 13l10 6M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0M22 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0M22 20a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    ghost: 'M5 21V10a7 7 0 0 1 14 0v11l-2.5-2-2.5 2-2-2-2 2-2.5-2ZM9.5 10h.01M14.5 10h.01',
    download: 'M12 3v12m-5-5 5 5 5-5M3 15v6h18v-6', copy: 'M9 9h12v12H9ZM15 5V3H3v12h2',
  };
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('aria-hidden', 'true');
  node.setAttribute('fill', 'none'); node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '1.8'); node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(node.namespaceURI, 'path');
  path.setAttribute('d', paths[name] ?? paths.external!); node.append(path); return node;
}

export function replicaButton(label: string, icon?: string, className = 'modal-secondary'): HTMLButtonElement {
  const button = el('button', className) as HTMLButtonElement;
  button.type = 'button'; if (icon) button.append(actionIcon(icon));
  button.append(el('span', '', label)); return button;
}

/**
 * The top-right language control as a two-sided switch: both options visible, the current one lit,
 * one press flips to the other. Call on every render so a switch made elsewhere shows.
 */
export function renderLanguageToggle(button: HTMLElement, t: I18n): void {
  button.classList.add('lang-toggle');
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(t.lang === 'zh'));
  button.setAttribute('aria-label', t.t('settings.language'));
  button.replaceChildren(...(['en', 'zh'] as const).map(lang => {
    const side = el('span', lang === t.lang ? 'lang-option on' : 'lang-option', lang === 'en' ? 'EN' : '中文');
    side.dataset.lang = lang;
    return side;
  }));
}

/** The header's game name in the current language only, never both side by side. */
export function brandTitle(t: I18n): string {
  return t.lang === 'zh' ? t.t('app.title') : t.t('app.title').toUpperCase();
}

/** The game icon file, shared by the header mark and the shared-image watermark. */
export const BRAND_MARK_SRC = './brand/slime-race-mark-180.png';

/** The selected slime-and-start-line mark. The wordmark remains ordinary translated text. */
export function brandMark(): HTMLImageElement {
  const image = document.createElement('img');
  image.className = 'brand-mark';
  image.src = BRAND_MARK_SRC;
  image.alt = '';
  image.decoding = 'async';
  image.setAttribute('aria-hidden', 'true');
  return image;
}

/** Menus show the English wordmark; compact in-game headers keep a translated accessible name. */
export function renderBrandSignature(host: HTMLElement, t: I18n, showWordmark = false): void {
  host.classList.add('brand-signature');
  host.classList.toggle('brand-signature-visible', showWordmark);
  if (showWordmark) {
    host.setAttribute('aria-label', brandTitle(t));
    const wordmark = el('span', 'brand-wordmark');
    wordmark.append(
      el('span', 'brand-word-silicon', 'Silicon'), document.createTextNode(' '),
      el('span', 'brand-word-slime', 'Slime'), document.createTextNode(' '),
      el('span', 'brand-word-rush', 'Rush'),
    );
    host.replaceChildren(brandMark(), wordmark);
  } else {
    host.removeAttribute('aria-label');
    host.replaceChildren(brandMark(), el('span', 'brand-name-accessible', brandTitle(t)));
  }
}

export function creatorCards(t: I18n, choose: (kind: 'homepage' | 'coffee') => void): HTMLElement {
  const group = el('div', 'creator-links');
  const home = replicaButton('', 'external', 'creator-home');
  home.dataset.action = 'homepage'; home.lastElementChild!.remove();
  const homeText = el('span'); homeText.append(el('small', '', t.t('replica.creator')), el('strong', '', t.t('replica.home')));
  home.append(homeText); home.onclick = () => choose('homepage');
  const coffee = replicaButton('', undefined, 'coffee'); coffee.replaceChildren(); coffee.dataset.action = 'coffee';
  const text = el('span'); text.append(el('strong', '', t.t('replica.coffee')));   // one line; no price since the chevron redesign
  coffee.append(el('span', 'coffee-cup', '☕'), text); coffee.onclick = () => choose('coffee');
  group.append(home, coffee); return group;
}

export class ReplicaDialog {
  readonly node = document.createElement('dialog');
  private readonly frame = el('div', 'replica-frame');
  private readonly overlay = el('div', 'extra-modal');
  private readonly unfit: () => void;
  constructor(private readonly t: I18n) {
    this.node.className = 'replica replica-dialog'; this.frame.append(this.overlay); this.node.append(this.frame);
    this.node.addEventListener('keydown', e => { if (e.code !== 'Tab') e.stopPropagation(); });
    document.body.append(this.node); this.unfit = fitReplica(this.node, this.frame);
  }
  get open(): boolean { return this.node.open; }
  close(): void { if (this.open) this.node.close(); }
  show(kind: 'destination' | 'restart' | 'menu', confirm?: () => void): void {
    const t = this.t, shell = el('section', 'modal-shell'), header = el('div', 'modal-header');
    const title = el('h2', '', t.t(`replica.${kind}Title`));
    const close = replicaButton('×', undefined, 'modal-close'); close.setAttribute('aria-label', t.t('share.close'));
    close.onclick = () => this.close(); header.append(title, close); shell.append(header);
    shell.append(el('p', '', t.t(`replica.${kind}Body`)));
    if (kind !== 'destination') {
      const labels = { restart: 'replica.restart', menu: 'replica.menu' };
      const button = replicaButton(t.t(labels[kind]), kind === 'menu' ? 'house' : undefined, 'extra-primary');
      button.dataset.dialogAction = 'confirm';
      button.onclick = () => { this.close(); confirm?.(); };
      if (kind === 'menu') {
        const actions = el('div', 'confirm-actions'), keep = replicaButton(t.t('replica.keep'));
        keep.onclick = () => this.close(); actions.append(keep, button); shell.append(actions);
      } else shell.append(button);
    }
    this.overlay.replaceChildren(shell); this.overlay.dataset.menu = kind;
    this.node.setAttribute('aria-label', title.textContent!);
    if (!this.open) this.node.showModal(); close.focus();
  }
  dispose(): void { this.close(); this.unfit(); this.node.remove(); }
}


