import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MenuList } from '../src/ui/Ui';
import { resultsScreen } from '../src/ui/screens';
import { home } from '../src/ui/Home';
import { pauseScreen } from '../src/ui/PauseScreen';
import { I18n } from '../src/ui/i18n';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('shows the header language control as an EN / 中文 switch with the current side lit, flipping on press', () => {
  const t = new I18n('en');
  const flip = () => t.set(t.lang === 'en' ? 'zh' : 'en');
  const facts = { trackId: 'lhasa', time: 20, best: null, isBest: false, score: 0, slimeHits: 0 };  // shoreline's replacement (mapping table)
  const pages = [
    { page: home(t, () => {}, flip, () => {}, () => {}, 0), selector: '.home-language' },
    { page: resultsScreen(t, () => facts, new MenuList([]), () => {}, () => {}, { language: flip }), selector: '.language' },
    { page: pauseScreen(t, new MenuList([]), { pick() {}, location: () => '', language: flip }),
      selector: '.language' },
  ];
  for (const { page, selector } of pages) {
    page.render();
    const button = page.node.querySelector<HTMLElement>(selector)!;
    const read = () => ({ options: [...button.querySelectorAll('.lang-option')].map(side => side.textContent),
      lit: button.querySelector('.lang-option.on')?.textContent, checked: button.getAttribute('aria-checked') });
    expect(button.getAttribute('role')).toBe('switch');
    expect(read()).toEqual({ options: ['EN', '中文'], lit: 'EN', checked: 'false' });
    button.click(); page.render();
    expect(t.lang).toBe('zh');
    expect(page.node.querySelector<HTMLElement>(selector)!.querySelector('.lang-option.on')!.textContent).toBe('中文');
    expect(page.node.querySelector<HTMLElement>(selector)!.getAttribute('aria-checked')).toBe('true');
    t.set('en');
  }
});
