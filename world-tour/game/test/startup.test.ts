import { afterEach, expect, it, vi } from 'vitest';
import { mountStartup } from '../src/ui/Startup';
import { detectLanguage, languagePreference, I18n } from '../src/ui/i18n';
import { readSavedData, SAVE_KEY } from '../src/app/Save';

function start(saved?: string) {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === SAVE_KEY ? saved ?? null : null });
  document.body.innerHTML = '<section id="startup"><div class="loading-bar"><div class="loading-bar-fill"></div></div><h1></h1><p role="status"></p><button hidden></button></section>';
  const keys = ['app.title', 'boot.download', 'boot.prepare', 'boot.retry',
    'boot.error.network', 'boot.error.graphics', 'boot.error.startup'];
  const copy = Object.fromEntries(['en', 'zh'].map(lang => [lang,
    Object.fromEntries(keys.map(key => [key, new I18n(lang as 'en' | 'zh').t(key)]))]));
  mountStartup(copy as Parameters<typeof mountStartup>[0], SAVE_KEY, readSavedData, languagePreference,
    () => detectLanguage({ language: 'zh-CN' }));
  return window.startup!;
}
afterEach(() => {
  window.startup?.done(); delete window.startup; vi.useRealTimers(); vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('uses the saved preference and actual stages without inventing percentages', () => {
  const shell = start('{"language":"en"}');
  expect(document.documentElement.lang).toBe('en');
  expect(document.querySelector('[role="status"]')!.textContent).toBe('Downloading the game…');
  shell.stage('boot.prepare');
  expect(document.querySelector('[role="status"]')!.textContent).toBe('Preparing the game…');
  shell.done();
  expect(document.getElementById('startup')).toBeNull();
  vi.advanceTimersByTime(120_000);
  expect(document.getElementById('startup')).toBeNull();
});
it('fills the one bar exactly once before the caller reveals the game', () => {
  const shell = start();
  expect(shell.complete()).toBe(true);
  expect(document.getElementById('startup')!.dataset.complete).toBe('true');
  expect((document.querySelector('.loading-bar-fill') as HTMLElement).style.width).toBe('100%');
  expect(shell.complete()).toBe(false);
});
it('fills from the left: creeps through the download, then follows the real progress, never backwards', () => {
  const shell = start('{"language":"en"}');
  const fill = document.querySelector<HTMLElement>('.loading-bar-fill')!;
  const width = () => parseFloat(fill.style.width);
  expect(width(), 'already growing from the left during the download').toBeGreaterThan(0);
  expect(width()).toBeLessThan(20);
  shell.stage('boot.prepare');
  expect(width()).toBe(20);
  shell.progress(.5);
  expect(width()).toBe(60);
  shell.progress(.3);
  expect(width(), 'never backwards').toBe(60);
  expect(shell.complete()).toBe(true);
  expect(fill.style.width).toBe('100%');
});
it('keeps a recoverable static error and preserves a specific graphics failure', () => {
  const shell = start('broken json');
  expect(document.documentElement.lang).toBe('zh');
  shell.fail('graphics'); shell.fail('startup'); shell.stage('boot.prepare');
  expect(document.querySelector('[role="status"]')!.textContent).toContain('3D');
  expect(document.getElementById('startup')!.dataset.failure).toBe('graphics');
  expect(document.querySelector('button')!.hidden).toBe(false);
  expect((document.querySelector('.loading-bar') as HTMLElement).hidden).toBe(true);
});
it('bounds an unfinished download without pretending it finished', () => {
  start(); vi.advanceTimersByTime(120_000);
  expect(document.getElementById('startup')!.dataset.failed).toBe('true');
  expect(document.querySelector('[role="status"]')!.textContent).toContain('下载中断');
});
it('does not apply the module-download timeout to a healthy scene preparation', () => {
  const shell = start();
  shell.stage('boot.prepare');
  vi.advanceTimersByTime(120_000);
  expect(document.getElementById('startup')!.dataset.failed).toBeUndefined();
  vi.advanceTimersByTime(180_000);
  expect(document.getElementById('startup')!.dataset.failure).toBe('startup');
  expect(document.querySelector('[role="status"]')!.textContent).toContain('启动');
});
it('reports a connection lost during startup and keeps the retry reachable', () => {
  start(); window.dispatchEvent(new Event('offline'));
  expect(document.querySelector('[role="status"]')!.textContent).toContain('下载中断');
  expect(document.querySelector('button')!.hidden).toBe(false);
});
