import { expect, it } from 'vitest';
import { textCard } from '../src/ui/TextCard';
import { I18n } from '../src/ui/i18n';
import { copyShareText } from '../src/ui/ShareDialog';
import type { ResultFacts } from '../src/ui/screens';

const result: ResultFacts = {trackId: 'synth-loop', time: 125.25, best: null, isBest: false,
  score: 1000, slimeHits: 8, rating: 4, cleanCorners: 2, impactKinds: {popper: 3, slick: 1, burst: 1, boost: 1, colossus: 1},
  achievements: ['slime-run-15'],
  sections: [{seconds: 10, distance: 50}, {seconds: 10, distance: 100}]};

it('writes localized facts, actual color counts, eight pace segments and a legend without a fake URL', () => {
  for (const lang of ['zh', 'en'] as const) {
    const t = new I18n(lang), card = textCard(t, result, null);
    expect(card).toContain(t.t('track.synth-loop.name'));
    expect(card).toContain('2:05.25 · ★★★★☆');
    expect(card).toContain('🟩×3 🟪×1 ⬛×1 🟥×1 🟦×1 ⚪×1');
    expect(card).toContain('🐢⏩▫️▫️▫️▫️▫️▫️');
    expect(card).toContain(t.t('textCard.colors'));
    expect(card).toContain(t.t('textCard.pace'));
    expect(card).toContain(t.t('achievement.slime-run-15.name'));
    expect(card).not.toMatch(/https?:/);
    expect(textCard(t, result, 'https://example.org/play')).toMatch(/https:\/\/example.org\/play$/);
  }
});
it('keeps two drivers independent', () => {
  const t = new I18n('en');
  const card = textCard(t, {...result, players: [result, {...result, time: 90, slimeHits: 0, impactKinds: {}, rating: 1}]}, null);
  expect(card).toContain(t.t('results.player1') + ' · 2:05.25 · ★★★★☆');
  expect(card).toContain(t.t('results.player2') + ' · 1:30.00 · ★☆☆☆☆');
  expect(card).toContain(t.t('textCard.noHits'));
  expect(card.match(/🟩×3/g)).toHaveLength(1);
});
it('reports clipboard denial and unavailable APIs honestly', async () => {
  const exec = Object.getOwnPropertyDescriptor(document, 'execCommand');
  Object.defineProperty(document, 'execCommand', {configurable: true, value: () => false});
  try {
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: undefined});
    expect(await copyShareText('card')).toBe(false);
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw new Error('denied');}}});
    expect(await copyShareText('card')).toBe(false);
  } finally { if (exec) Object.defineProperty(document, 'execCommand', exec); else delete (document as any).execCommand; }
});
it('falls back to a selection copy inside the open modal when the Clipboard API is refused', async () => {
  const exec = Object.getOwnPropertyDescriptor(document, 'execCommand');
  const dialog = document.createElement('dialog'), button = document.createElement('button');
  dialog.setAttribute('open', ''); dialog.append(button); document.body.append(dialog); button.focus();
  let copied = '', parent: Element | null = null;
  Object.defineProperty(document, 'execCommand', {configurable: true, value: (command: string) => {
    const area = document.activeElement as HTMLTextAreaElement;
    parent = area.parentElement; copied = command === 'copy' ? area.value.slice(area.selectionStart, area.selectionEnd) : '';
    return command === 'copy';
  }});
  try {
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw new Error('NotAllowedError');}}});
    expect(await copyShareText('card text')).toBe(true);
    expect(copied).toBe('card text');
    expect(parent).toBe(dialog);
    expect(dialog.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  } finally {
    dialog.remove();
    if (exec) Object.defineProperty(document, 'execCommand', exec); else delete (document as any).execCommand;
  }
});
