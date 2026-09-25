import { expect, it, vi } from 'vitest';
import { CREDITS } from '../src/ui/Credits';
import { readFileSync } from 'node:fs';
import { I18n } from '../src/ui/i18n';
import { aboutScreen } from '../src/ui/screens';
import { buildCredits } from '../build/credits';
import { resolve } from 'node:path';

it('exposes actual installed versions and asset inventory links through both translations', () => {
  // No commit revision: it is a development detail and the upload may not carry one.
  expect(CREDITS.version).toMatch(/^\d+\.\d+$/);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const name of Object.keys(pkg.dependencies)) expect(CREDITS.libraries.map(lib => lib.name)).toContain(name);
  for (const name of ['fast-uri', 'fast-deep-equal', 'json-schema-traverse']) expect(CREDITS.libraries.map(lib => lib.name)).toContain(name);
  for (const lib of CREDITS.libraries) {
    const actual = JSON.parse(readFileSync(`node_modules/${lib.name}/package.json`, 'utf8'));
    expect(lib.version).toBe(actual.version); expect(lib.license).toBe(actual.license);
  }
  expect(CREDITS.sourceLinks).toHaveLength(4);
  for (const lang of ['en', 'zh'] as const) {
    const back = vi.fn(), t = new I18n(lang), view = aboutScreen(t, back); view.render();
    expect(view.node.textContent).toContain(t.t('home.story'));
    expect(view.node.textContent).toContain('guigulaoshi');
    // Five source links and the creator's eight accounts.
    expect(view.node.querySelectorAll('a')).toHaveLength(13);
    const close = view.node.querySelector<HTMLButtonElement>('.about-close')!;
    expect(close.textContent).toBe('×');
    expect(close.getAttribute('aria-label')).toBe(t.t('share.close'));
    close.click(); expect(back).toHaveBeenCalledOnce();
  }
});

it('publishes credits.txt as English with no internal task references', () => {
  const { notices } = buildCredits(resolve(__dirname, '../..'));
  expect(notices).not.toMatch(/[\u3000-\u9fff\uff00-\uffef]/);
  expect(notices).not.toMatch(/\b(task|tasks)\s+\d{3}\b/i);
  expect(notices).not.toMatch(/\]\(|^\|/m);
  for (const required of ['OpenStreetMap', 'Apache License', 'SIL OPEN FONT LICENSE', 'three 0.']) expect(notices).toContain(required);
});
