import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MenuList } from '../src/ui/Ui';
import { resultPlace, resultsScreen, type ResultFacts, type ResultStanding } from '../src/ui/screens';
import { drawResultImage } from '../src/ui/ResultImage';
import { I18n } from '../src/ui/i18n';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

const human = (player: number, time: number): ResultStanding =>
  ({ id: `p${player}`, role: 'human', vehicleId: 'sports-car', player, finished: true, time });
const ai = (id: string, time: number): ResultStanding =>
  ({ id, role: 'ai', vehicleId: 'jeep', finished: true, time });
// fishermans-wharf's replacement (mapping table: a busy city route) -- new-york, 'Lower Manhattan'.
const base: ResultFacts = { trackId: 'new-york', time: 83, best: null, isBest: false,
  score: 10738, slimeHits: 32, rating: 4, maxCombo: 0, reducedMotion: true };

it('gives a place only when AI racers ran, and each human their own', () => {
  expect(resultPlace({ standings: [human(0, 83)] })).toBeNull();
  expect(resultPlace({})).toBeNull();
  const field = [ai('a', 80), human(0, 83), ai('b', 85), ai('c', 90)];
  expect(resultPlace({ standings: field })).toEqual({ rank: 2, total: 4 });
  const pair = [human(1, 70), ai('a', 80), human(0, 83)];
  expect(resultPlace({ standings: pair }, 0)).toEqual({ rank: 3, total: 3 });
  expect(resultPlace({ standings: pair }, 1)).toEqual({ rank: 1, total: 3 });
  // Two humans and no AI: the players drive together and the card names no winner.
  expect(resultPlace({ standings: [human(0, 83), human(1, 90)] }, 1)).toBeNull();
});

function card(facts: ResultFacts, lang: 'en' | 'zh') {
  const screen = resultsScreen(new I18n(lang), () => facts, new MenuList([]), () => {});
  screen.render();
  return screen.node;
}

it('puts five stars where the old slogan was, a new footer, and the place only with AI, in both languages', () => {
  for (const lang of ['en', 'zh'] as const) {
    const t = new I18n(lang);
    const solo = card(base, lang);
    expect(solo.querySelector('.card-finish')).toBeNull();
    expect(solo.textContent).not.toContain('SURVIVED');
    const brand = solo.querySelector('.card-brand')!;
    expect(brand.nextElementSibling!.classList.contains('card-rating')).toBe(true);
    expect(solo.querySelectorAll('.card-rating .earned')).toHaveLength(4);
    expect(solo.querySelector('.card-bottom')!.textContent).toContain(t.t('replica.realRoads'));
    expect(solo.querySelector('.card-stats')!.textContent).not.toContain(t.t('replica.place'));
    expect(solo.querySelector('.card-stats')!.textContent).toContain('1:23.00');

    const raced = card({ ...base, standings: [ai('a', 80), human(0, 83), ai('b', 85), ai('c', 90)] }, lang);
    expect(raced.querySelector('.card-stats')!.textContent).toContain(`2 / 4${t.t('replica.place')}`);

    const dual = card({ ...base, standings: [human(1, 70), ai('a', 80), human(0, 83)],
      players: [{ time: 83, score: 1, slimeHits: 1, rating: 2 }, { time: 70, score: 2, slimeHits: 2, rating: 5 }] }, lang);
    const stats = [...dual.querySelectorAll('.result-player .card-stats')].map(node => node.textContent);
    expect(stats[0]).toContain('3 / 3'); expect(stats[1]).toContain('1 / 3');
    expect([...dual.querySelectorAll('.result-player')].map(node => node.querySelectorAll('.card-rating .earned').length))
      .toEqual([2, 5]);
  }
  expect(new I18n('en').t('replica.realRoads')).toBe('DRIVE REAL STREETS IN 13 CITIES · FREE IN YOUR BROWSER');
});

it('draws the shared image with a large title, stars, and the place on its own route line for two players', () => {
  const texts: { text: string; font: string; y: number }[] = [];
  let font = '';
  const ctx = new Proxy({}, {
    get: (_target, key) => key === 'fillText' ? (text: string, _x: number, y: number) => texts.push({ text, font, y })
      : key === 'font' ? font : () => {},
    set: (_target, key, value) => { if (key === 'font') font = value; return true; },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const t = new I18n('en');
  drawResultImage(canvas, t, { ...base, standings: [human(1, 70), ai('a', 80), human(0, 83)],
    players: [{ time: 83, score: 1, slimeHits: 1, rating: 2 }, { time: 70, score: 2, slimeHits: 2, rating: 5 }] }, null);
  const title = texts.find(entry => entry.text === 'SILICON SLIME RUSH: WORLD TOUR')!;
  expect(Number(/(\d+)px/.exec(title.font)![1])).toBeGreaterThanOrEqual(48);
  expect(texts.some(entry => entry.text.includes('SURVIVED'))).toBe(false);
  expect(texts.filter(entry => entry.text === '★★☆☆☆' || entry.text === '★★★★★')).toHaveLength(2);
  const routeLines = texts.filter(entry => entry.y === 376).map(entry => entry.text);
  expect(routeLines).toEqual([`Lower Manhattan · 3 / 3 PLACE`, `Lower Manhattan · 1 / 3 PLACE`]);
  expect(texts.filter(entry => entry.y === 414).every(entry => !entry.text.includes('PLACE'))).toBe(true);
});

it('titles the Chinese share image in Chinese only', () => {
  const texts: string[] = [];
  const ctx = new Proxy({}, { get: (_t, key) => key === 'fillText' ? (text: string) => texts.push(text) : () => {}, set: () => true });
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  drawResultImage(canvas, new I18n('zh'), base, null);
  expect(texts[0]).toBe('史莱姆赛车：环游世界');
  expect(texts.some(text => text.includes('SILICON SLIME RUSH'))).toBe(false);
});
