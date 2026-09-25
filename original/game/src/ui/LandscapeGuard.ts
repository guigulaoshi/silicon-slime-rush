import { isMobileDevice } from '../app/device';
import type { I18n } from './i18n';
import { el } from './Ui';

type LockableOrientation = ScreenOrientation & { lock?: (orientation: 'landscape') => Promise<void> };

/** A mobile posture gate, independent of which menu or race screen is underneath it. */
export class LandscapeGuard {
  readonly node = el('section', 'landscape-guard');
  readonly mobile: boolean;
  blocked = false;
  private readonly title = el('h2');
  private readonly message = el('p');
  private readonly button = el('button', 'cta') as HTMLButtonElement;
  private readonly language = el('button', 'cta orientation-language') as HTMLButtonElement;
  private denied = false;
  private previousFocus: HTMLElement | null = null;

  constructor(private readonly i18n: I18n, private readonly ui: HTMLElement,
    private readonly changed: (blocked: boolean) => void, mobile = isMobileDevice(), onLanguage?: () => void) {
    this.mobile = mobile;
    document.documentElement.dataset.mobile = String(mobile);
    this.node.id = 'landscape-guard';
    this.node.setAttribute('role', 'dialog');
    this.node.setAttribute('aria-modal', 'true');
    this.node.tabIndex = -1;
    const phone = el('div', 'rotate-phone'); phone.setAttribute('aria-hidden', 'true');
    this.button.type = 'button';
    this.button.onclick = () => { void this.requestLandscape(); };
    this.language.onclick = onLanguage ?? null;
    this.language.hidden = !onLanguage;
    this.node.append(phone, this.title, this.message, this.button, this.language);
    document.body.append(this.node);
    window.addEventListener('resize', this.refresh);
    window.addEventListener('orientationchange', this.refresh);
    this.refresh();
  }

  private readonly refresh = (): void => {
    const blocked = this.mobile && innerHeight > innerWidth;
    const changed = blocked !== this.blocked;
    this.blocked = blocked;
    this.node.hidden = !blocked;
    this.ui.inert = blocked;
    this.render();
    if (!changed) return;
    if (blocked) {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.node.focus();
    } else if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.changed(blocked);
  };

  render(): void {
    this.language.textContent = this.i18n.lang === 'zh' ? 'English' : '中文';
    this.title.textContent = this.i18n.t('orientation.title');
    this.message.textContent = this.i18n.t(this.denied ? 'orientation.manual' : 'orientation.hint');
    this.button.textContent = this.i18n.t('orientation.fullscreen');
    this.button.hidden = !document.documentElement.requestFullscreen
      || !(screen.orientation as LockableOrientation | undefined)?.lock;
    this.node.setAttribute('aria-label', this.title.textContent);
  }

  private async requestLandscape(): Promise<void> {
    this.button.disabled = true;
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      await (screen.orientation as LockableOrientation).lock?.('landscape');
    } catch {
      this.denied = true;
    } finally {
      this.button.disabled = false;
      this.refresh();
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.refresh);
    window.removeEventListener('orientationchange', this.refresh);
    this.ui.inert = false;
    this.node.remove();
    delete document.documentElement.dataset.mobile;
  }
}
