import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MenuList } from '../src/ui/Ui';
import { resultsScreen } from '../src/ui/screens';
import { creatorCards } from '../src/ui/Replica';
import { I18n } from '../src/ui/i18n';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('shows the coffee link as one line without a price and the other link as the itch.io page, in both languages', () => {
  const expected = {
    en: { coffee: 'Buy me a quarter of a coffee', home: 'More Games' },
    zh: { coffee: '请作者喝 1/4 杯咖啡', home: '更多游戏' },
  } as const;
  for (const lang of ['en', 'zh'] as const) {
    const t = new I18n(lang);
    const facts = { trackId: 'shoreline', time: 20, best: null, isBest: false, score: 0, slimeHits: 0 };
    const screen = resultsScreen(t, () => facts, new MenuList([]), () => {});
    for (const root of [creatorCards(t, () => {}), (screen.render(), screen.node)]) {
      const coffee = root.querySelector('.coffee')!;
      expect(coffee.querySelector('strong')!.textContent).toBe(expected[lang].coffee);
      expect(coffee.querySelector('small')).toBeNull();
      expect(coffee.textContent).not.toMatch(/Bay Area|湾区|硅谷|itch\.io/);
      expect(root.querySelector('.creator-home strong')!.textContent).toBe(expected[lang].home);
    }
  }
});
