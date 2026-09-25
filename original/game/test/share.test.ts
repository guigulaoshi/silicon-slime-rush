import { expect, it } from 'vitest';
import { creatorLinkUrl, publicGameUrl, supportUrl, watermarkAddress } from '../src/app/Publication';
import { readFileSync } from 'node:fs';
import { shareButtonHidden, shareLines, coverShareImage, HOME_CARD, shareFileName } from '../src/ui/ShareDialog';
import { I18n } from '../src/ui/i18n';
import { drawWatermark, watermarkRect } from '../src/ui/ShareWatermark';
import type { ResultFacts } from '../src/ui/screens';
it('only accepts a configured public itch project URL, never iframe or editor URLs', () => {
  for (const value of [undefined, '', 'https://itch.io/edit/1234567', 'https://v6p9d9t4.ssl.hwcdn.net/html/game/', 'http://example.itch.io/game', 'https://example.itch.io/game?draft=true']) expect(publicGameUrl(value)).toBeNull();
  expect(publicGameUrl('https://example.itch.io/game')).toBe('https://example.itch.io/game');
});
it('shares current-language actual player facts without ranking', () => {
  const result: ResultFacts = { trackId: 'synth-p2p', time: 83.4, score: 12, slimeHits: 3, best: null, isBest: false,
    achievements: ['no-rescue'],
    players: [{time: 83.4, score: 12, slimeHits: 3}, {time: 90, score: 8, slimeHits: 2}] };
  for (const language of ['zh', 'en'] as const) {
    const t = new I18n(language), lines = shareLines(t, result, null);
    expect(lines.join('\n')).toContain(t.t('results.player1')); expect(lines.join('\n')).toContain(t.t('results.player2'));
    expect(lines.join('\n')).toContain(t.t('achievement.no-rescue.name'));
    expect(lines.join('\n')).not.toMatch(/https:|rank|winner|第一名|冠军/);
  }
});

it('uses the exact bilingual Big Tech Rooftop name in result sharing', () => {
  const result: ResultFacts = { trackId: 'wolfe-pruneridge', time: 83.4,
    score: 12, slimeHits: 3, best: null, isBest: false };
  expect(shareLines(new I18n('en'), result, null)[1]).toBe('Big Tech Rooftop');
  expect(shareLines(new I18n('zh'), result, null)[1]).toBe('大厂楼顶');
});

it.each([[1280,720],[844,390],[800,600],[500,1000]])('fills the home card from a %i × %i shot without stretching or letterboxing', (width,height) => {
  //The screenshot fills the picture; the words go over it.
  const crop = coverShareImage(width,height);
  expect(crop.width / crop.height).toBeCloseTo(HOME_CARD.width / HOME_CARD.height);
  expect(crop.x).toBeGreaterThanOrEqual(0); expect(crop.y).toBeGreaterThanOrEqual(0);
  expect(crop.x + crop.width).toBeLessThanOrEqual(width + 1e-6); expect(crop.y + crop.height).toBeLessThanOrEqual(height + 1e-6);
  expect(Math.max(crop.width / width, crop.height / height)).toBeCloseTo(1);   // one side is used in full
});

it('points the coffee card at the verified game page\'s own itch.io tip page', () => {
  expect(supportUrl('https://example.itch.io/game')).toBe('https://example.itch.io/game/purchase');
  expect(supportUrl('https://example.itch.io/game/')).toBe('https://example.itch.io/game/purchase');
  expect(supportUrl(null)).toBeNull();
  const home = 'https://example.itch.io/game';
  expect(creatorLinkUrl('coffee', home)).toBe('https://example.itch.io/game/purchase');
  // "More Games" is the author's profile, not the page the player is already on.
  expect(creatorLinkUrl('homepage', home)).toBe('https://example.itch.io/');
  expect(creatorLinkUrl('homepage', 'https://guigulaoshi.itch.io/silicon-slime-rush')).toBe('https://guigulaoshi.itch.io/');
  expect(creatorLinkUrl('homepage', null)).toBeNull();
  expect(creatorLinkUrl('coffee', null)).toBeNull();
  // The pause and results cards really use it (the coffee card once went to the game page).
  expect(readFileSync('src/app/Game.ts', 'utf8')).toContain('const url = creatorLinkUrl(kind);');
});
it('stamps name, icon and address inside the bottom-right corner of every image size', () => {
  expect(watermarkAddress(null)).toBe('guigulaoshi.itch.io/silicon-slime-rush');
  expect(watermarkAddress('https://example.itch.io/game/')).toBe('example.itch.io/game');
  for (const [width, height] of [[1200, 1000], [1000, 600], [1920, 1080], [640, 1080], [320, 400]] as const) {
    const r = watermarkRect(width, height);
    expect(r.x).toBeGreaterThan(width / 2); expect(r.y).toBeGreaterThan(height / 2);
    expect(r.x + r.width).toBeLessThan(width); expect(r.y + r.height).toBeLessThan(height);
    expect(r.width * r.height).toBeLessThan(width * height * 0.08);
  }
  for (const language of ['zh', 'en'] as const) {
    const t = new I18n(language), texts: string[] = [], images: unknown[] = [];
    const ctx = new Proxy({ canvas: { width: 1200, height: 1000 },
      fillText: (text: string) => texts.push(text), drawImage: (image: unknown) => images.push(image) } as Record<string, unknown>,
    { get: (target, key) => key in target ? target[key as string] : () => {}, set: () => true });
    const icon = {} as HTMLImageElement;
    drawWatermark(ctx as unknown as CanvasRenderingContext2D, t, icon, watermarkAddress(null));
    expect(texts).toEqual([t.t('app.title'), 'guigulaoshi.itch.io/silicon-slime-rush']);
    expect(images).toEqual([icon]);
  }
});

it('offers "Copy game link" on the result card as well as the game card, never on photos or clips', () => {
  expect(shareButtonHidden('link', 'score', true, true)).toBe(false);
  expect(shareButtonHidden('link', 'home', true, true)).toBe(false);
  expect(shareButtonHidden('link', 'score', false, true)).toBe(true);
  expect(shareButtonHidden('link', 'photo', true, true)).toBe(true);
  expect(shareButtonHidden('link', 'clip', true, true)).toBe(true);
  expect(shareButtonHidden('language', 'score', true, true)).toBe(true);
  expect(shareButtonHidden('language', 'home', true, true)).toBe(false);
  expect(shareButtonHidden('system', 'home', true, false)).toBe(true);
  expect(shareButtonHidden('system', 'score', true, false)).toBe(false);
});

it('names every saved picture and clip after its route and local time, so two saves never collide', () => {
  const at = new Date(2026, 8, 18, 7, 12, 5);
  expect(shareFileName({trackId: 'lombard', direction: 'forward'}, 'png', '', at)).toBe('silicon-slime-rush-lombard-20260918-071205.png');
  expect(shareFileName({trackId: 'twin-peaks', direction: 'reverse'}, 'mp4', '', at)).toBe('silicon-slime-rush-twin-peaks-reverse-20260918-071205.mp4');
  expect(shareFileName({trackId: 'lombard'}, 'png', 'text-card', at)).toBe('silicon-slime-rush-text-card-lombard-20260918-071205.png');
  expect(shareFileName(null, 'png', '', at)).toBe('silicon-slime-rush-20260918-071205.png');
  expect(shareFileName({trackId: 'lombard'}, 'webm', '', new Date(2026, 8, 18, 7, 12, 6)))
    .not.toBe(shareFileName({trackId: 'lombard'}, 'webm', '', at));
});
