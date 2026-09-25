import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MenuList } from '../src/ui/Ui';
import { resultsScreen, type ResultFacts } from '../src/ui/screens';
import { I18n } from '../src/ui/i18n';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

/** A run that came in through a friend's link ends by saying who won, by how much. */
it('says whether the challenge was beaten and by how many seconds, in both languages', () => {
  for (const lang of ['en', 'zh'] as const) {
    const t = new I18n(lang);
    const base: ResultFacts = { trackId: 'zhangjiajie', time: 90, best: null, isBest: false, score: 100, slimeHits: 2 };  // lombard's replacement, then rio's (both deleted; mapping table)
    for (const [facts, state, seconds] of [
      [{ ...base, challenge: { time: 95.4, rating: 4, score: 8200, name: 'Ada', vehicleId: 'sports-car' } }, 'beat', '5.40'],
      [{ ...base, time: 97.25, challenge: { time: 95.4, rating: 4, score: 8200 } }, 'short', '1.85'],
    ] as const) {
      const screen = resultsScreen(t, () => facts, new MenuList([]), () => {});
      screen.render(); document.body.append(screen.node);
      const line = screen.node.querySelector<HTMLElement>('.result-challenge')!;
      expect(line.dataset.challenge, `${lang} ${state}`).toBe(state);
      expect(line.textContent).toContain(seconds);
      expect(line.textContent).toContain(facts.challenge.name ?? t.t('challenge.someoneInline'));
      // Mid-sentence, so lower case in English.
      if (!facts.challenge.name && lang === 'en') expect(line.textContent).toContain("of a friend's");
      const car = facts.challenge.vehicleId;
      expect(line.textContent, 'cars differ in pace, so the line names the car').toContain(car ? t.t(`car.${car}.name`) : t.t('challenge.anyCar'));
      document.body.replaceChildren();
    }
    const plain = resultsScreen(t, () => base, new MenuList([]), () => {});
    plain.render();
    expect(plain.node.querySelector('.result-challenge')).toBeNull();
  }
});
