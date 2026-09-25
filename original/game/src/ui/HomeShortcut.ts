import { PUBLIC_GAME_URL } from '../app/Publication';
import { isAppleTouchDevice } from '../app/device';
import { copyShareText } from './ShareDialog';
import type { I18n } from './i18n';
import { el } from './Ui';

/** Instructions describe browser actions; the embedded game never claims to install itself. */
export function shortcutGuide(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator): string {
  const ua = nav.userAgent;
  if (/MicroMessenger|BytedanceWebview|aweme|musical_ly|TTWebView/i.test(ua)) return 'shortcut.embedded';
  const apple = isAppleTouchDevice(nav);
  if (apple && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) return 'shortcut.safari';
  if (/Android/.test(ua) && /Chrome/.test(ua) && !/EdgA|OPR|SamsungBrowser/.test(ua)) return 'shortcut.chrome';
  return apple || /Android/.test(ua) ? 'shortcut.embedded' : 'shortcut.desktop';
}

export class HomeShortcut {
  readonly node = document.createElement('dialog');
  private readonly title = el('h2');
  private readonly instructions = el('p');
  private readonly note = el('p');
  private readonly link = el('a', 'cta') as HTMLAnchorElement;
  private readonly copy = el('button', 'cta') as HTMLButtonElement;
  private readonly language = el('button', 'cta') as HTMLButtonElement;
  private readonly closeButton = el('button', 'cta') as HTMLButtonElement;
  private readonly status = el('p');
  constructor(private readonly t: I18n, onLanguage: () => void, private readonly url = PUBLIC_GAME_URL) {
    this.node.className = 'shortcut-dialog';
    this.link.target = '_blank'; this.link.rel = 'noopener noreferrer';
    this.copy.onclick = () => { void this.copyUrl(); };
    this.language.onclick = () => { onLanguage(); this.render(); };
    this.closeButton.onclick = () => this.close();
    this.status.setAttribute('role', 'status');
    this.node.addEventListener('keydown', e => { if (e.code !== 'Tab') e.stopPropagation(); });
    const actions = el('div', 'actions'); actions.append(this.link, this.copy, this.language, this.closeButton);
    this.node.append(this.title, this.instructions, this.note, this.status, actions); document.body.append(this.node);
  }
  get open(): boolean { return this.node.open; }
  show(): void { this.status.textContent = ''; this.render(); this.node.showModal(); }
  close(): void { this.node.close(); }
  render(): void {
    this.title.textContent = this.t.t('shortcut.title'); this.node.setAttribute('aria-label', this.title.textContent);
    this.instructions.textContent = this.t.t(shortcutGuide());
    this.note.textContent = this.t.t(this.url ? 'shortcut.note' : 'shortcut.unavailable');
    this.link.hidden = this.copy.hidden = !this.url; this.link.href = this.url ?? '';
    this.link.textContent = this.t.t('shortcut.open'); this.copy.textContent = this.t.t('share.link');
    this.language.textContent = this.t.lang === 'zh' ? 'English' : '中文';
    this.closeButton.textContent = this.t.t('help.close');
  }
  private async copyUrl(): Promise<void> {
    if (!this.url) return;
    this.status.textContent = this.t.t(await copyShareText(this.url) ? 'share.copied' : 'shortcut.copyFailed');
  }
  dispose(): void { this.close(); this.node.remove(); }
}
