import type { Language } from './i18n';

export interface Startup {
  readonly language?: Language;
  stage(key: string): void;
  /** Real loading progress of the opening scene, 0..1; the bar only ever moves forward. */
  progress(fraction: number): void;
  /** Fill the one startup bar. True only for the call that made it complete. */
  complete(): boolean;
  fail(reason: 'network' | 'graphics' | 'startup'): void;
  done(): void;
}

declare global { interface Window { startup?: Startup } }

/** Inlined by Vite into HTML. Keep runtime dependencies explicit so no module must load first. */
export function mountStartup(
  copy: Record<Language, Record<string, string>>,
  saveKey: string,
  readSave: (storage: Pick<Storage, 'getItem'> | null, key: string) => Record<string, unknown>,
  preference: (value: unknown) => Language | null,
  browserLanguage: () => Language,
): void {
  const root = document.getElementById('startup')!;
  let storage: Storage | null = null;
  try { storage = localStorage; } catch { /* Restricted storage still allows a first visit. */ }
  let language = preference(readSave(storage, saveKey).language) ?? browserLanguage();
  let text = copy[language];
  let stageKey = 'boot.download';
  let preparing = false;
  document.documentElement.dataset.reducedMotion = String(readSave(storage, saveKey).reducedMotion === true);
  document.documentElement.lang = language;
  const heading = root.querySelector<HTMLElement>('h1')!;
  // Unit fixtures and a cached pre-update shell can still contain plain text in the h1.
  const title = heading.querySelector<HTMLElement>('span') ?? heading;
  const status = root.querySelector<HTMLElement>('[role="status"]')!;
  const retry = root.querySelector<HTMLButtonElement>('button')!;
  const languageButton = document.createElement('button');
  languageButton.className = 'startup-language';
  root.append(languageButton);
  const render = () => {
    document.documentElement.lang = language;
    title.textContent = text['app.title']!;
    retry.textContent = text['boot.retry']!;
    status.textContent = text[stageKey] ?? stageKey;
    languageButton.textContent = language === 'zh' ? 'English' : '中文';
  };
  languageButton.onclick = () => {
    language = language === 'zh' ? 'en' : 'zh'; text = copy[language];
    try { storage?.setItem(saveKey, JSON.stringify({ ...readSave(storage, saveKey), language })); } catch { /* Page preference still works. */ }
    render();
  };
  render();
  // The bar fills from the left.
  // The module download reports no progress, so during it the fill creeps slowly toward DOWNLOAD_SHARE;
  // from the first stage main reports, it follows the opening scene's real progress over the rest.
  const DOWNLOAD_SHARE = .2;
  const barFill = root.querySelector<HTMLElement>('.loading-bar-fill');
  let shown = 0;
  const fillTo = (fraction: number, seconds: number) => {
    if (!barFill || fraction <= shown) return;
    shown = fraction;
    barFill.style.transition = `width ${seconds}s ${seconds > 1 ? 'cubic-bezier(.2,.7,.3,1)' : 'ease-out'}`;
    barFill.style.width = `${Math.round(fraction * 1000) / 10}%`;
  };
  let closed = false;
  let failed = false;
  const cleanup = () => {
    clearTimeout(timeout);
    window.removeEventListener('error', scriptError, true);
    window.removeEventListener('offline', offline);
  };
  const fail = (reason: 'network' | 'graphics' | 'startup') => {
    if (closed || failed) return;
    failed = true;
    cleanup();
    root.dataset.failed = 'true';
    root.dataset.failure = reason;
    root.setAttribute('aria-busy', 'false');
    root.querySelector<HTMLElement>('.loading-bar')!.hidden = true;
    stageKey = `boot.error.${reason}`; render();
    retry.hidden = false;
  };
  const offline = () => fail('network');
  const scriptError = (event: ErrorEvent) => {
    if (event.target instanceof HTMLScriptElement) fail('network');
  };
  // This is a failure boundary, never a pretend percentage or an animation delay.
  // The first limit covers the module download. Once main has evaluated it calls stage(prepare),
  // and the same shell may legitimately spend longer streaming and compiling the opening scene.
  // Keep a recovery boundary for that work, but do not misreport a slow, healthy scene as offline.
  let timeout = window.setTimeout(() => fail('network'), 120_000);
  retry.onclick = () => { retry.disabled = true; location.reload(); };
  window.addEventListener('error', scriptError, true);
  window.addEventListener('offline', offline);
  window.startup = {
    get language() { return language; },
    stage(key) {
      if (closed || failed) return;
      if (!preparing && key !== 'boot.download') {
        preparing = true;
        clearTimeout(timeout);
        timeout = window.setTimeout(() => fail('startup'), 300_000);
      }
      stageKey = key; render();
      if (key !== 'boot.download') fillTo(DOWNLOAD_SHARE, .3);
    },
    progress(fraction) {
      if (closed || failed) return;
      fillTo(DOWNLOAD_SHARE + (1 - DOWNLOAD_SHARE) * Math.min(1, Math.max(0, fraction)), .3);
    },
    complete() {
      if (closed || failed || root.dataset.complete === 'true') return false;
      clearTimeout(timeout);
      root.dataset.complete = 'true';
      root.setAttribute('aria-busy', 'false');
      const bar = root.querySelector<HTMLElement>('.loading-bar')!;
      bar.dataset.complete = 'true';
      bar.querySelector<HTMLElement>('.loading-bar-fill')!.style.width = '100%';
      return true;
    },
    fail,
    done() {
      if (closed) return;
      closed = true;
      cleanup();
      root.remove();
    },
  };
  window.startup.stage('boot.download');
  // Start from an empty bar, then creep: most of the download stays inside the first fifth.
  void barFill?.offsetWidth;
  fillTo(DOWNLOAD_SHARE * .9, 12);
  if (!navigator.onLine) offline();
}
