import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pauseScreen } from '../src/ui/PauseScreen';
import { MenuList } from '../src/ui/Ui';
import { I18n } from '../src/ui/i18n';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

// The live build showed "TAKE A BREATHER" and "THE REAL BAY AREA" in Chinese mode,
// because both small headings were string literals rather than locale keys.
it('shows the pause heading in the chosen language and follows a language switch', () => {
  const t = new I18n('zh');
  const page = pauseScreen(t, new MenuList([]), { pick() {}, location: () => '', language() {} });
  page.render();
  expect(page.node.querySelector('.pause-menu .eyebrow')!.textContent).toBe('中场休息');
  t.set('en'); page.render();
  expect(page.node.querySelector('.pause-menu .eyebrow')!.textContent).toBe('PIT STOP');
});

it('builds no eyebrow heading from a string literal', () => {
  const ui = resolve(__dirname, '../src/ui');
  const literal = /el\(\s*'[a-z0-9]+'\s*,\s*'(?:sm-)?eyebrow'\s*,\s*['`"]/;
  const files = readdirSync(ui).filter(name => name.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(10);
  const offenders = files.filter(name => literal.test(readFileSync(resolve(ui, name), 'utf8')));
  expect(offenders).toEqual([]);
});
