import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MenuList } from '../src/ui/Ui';
import { resultsScreen } from '../src/ui/screens';
import { home } from '../src/ui/Home';
import { pauseScreen } from '../src/ui/PauseScreen';
import { I18n } from '../src/ui/i18n';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

// app.title (src/ui/locales/{en,zh}.json) is now the World Tour brand; brandTitle() (Replica.ts)
// uppercases the English for the header/card, so EN/ZH below track that exactly.
const EN = 'SILICON SLIME RUSH: WORLD TOUR', ZH = '史莱姆赛车：环游世界';
const MENU_WORDMARK = 'Silicon Slime Rush World Tour';

it('names the game in the current language only, and follows a language switch', () => {
  const t = new I18n('en');
  const facts = { trackId: 'lhasa', time: 20, best: null, isBest: false, score: 0, slimeHits: 0, rating: 3 as const };  // shoreline's replacement (mapping table)
  const pages = [
    home(t, () => {}, () => {}, () => {}, () => {}, 0),
    resultsScreen(t, () => facts, new MenuList([]), () => {}),
    pauseScreen(t, new MenuList([]), { pick() {}, location: () => '', language() {} }),
  ];
  const titles = () => pages.map((page, index) => {
    page.render();
    const header = page.node.querySelector('header')!;
    expect(header.querySelector('.brand-mark')).not.toBeNull();
    return { header: header.textContent!, accessible: header.querySelector('.brand-signature')?.getAttribute('aria-label'),
      card: page.node.querySelector('.card-brand')?.textContent ?? null, menu: index === 0 };
  });
  for (const { header, accessible, card, menu } of titles()) {
    expect(header).toContain(menu ? MENU_WORDMARK : EN); expect(header).not.toContain(ZH);
    if (menu) expect(accessible).toBe(EN);
    if (card !== null) { expect(card).toContain(EN); expect(card).not.toContain(ZH); }
  }
  t.set('zh');
  for (const { header, accessible, card, menu } of titles()) {
    expect(header).toContain(menu ? MENU_WORDMARK : ZH);
    if (menu) expect(accessible).toBe(ZH);
    else expect(header).not.toContain(EN);
    if (card !== null) { expect(card).toContain(ZH); expect(card).not.toContain(EN); }
  }
});
