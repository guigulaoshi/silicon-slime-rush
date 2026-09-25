import { describe, expect, it } from 'vitest';
import { cleanPlayerName, MAX_PLAYER_NAME } from '../src/app/playerName';
import { migrate } from '../src/app/Save';
import { decodeChallenge, encodeChallenge } from '../src/app/Challenge';
import { CATALOGUE } from '../src/app/tracks';
import { VEHICLES } from '../src/vehicles/catalogue';
import { I18n } from '../src/ui/i18n';
import { personLabel, type ResultFacts } from '../src/ui/screens';
import { shareLines } from '../src/ui/ShareDialog';
import { textCard } from '../src/ui/TextCard';

/** An optional nickname, kept tidy enough for a card, printed on what a player shares. */
describe('player nicknames', () => {
  it('flattens line breaks and invisible or direction-flipping characters, and caps the length by characters', () => {
    expect(cleanPlayerName('  老实\n人\t Mia  ')).toBe('老实 人 Mia');
    expect(cleanPlayerName('evil‮gnirts​')).toBe('evil gnirts');
    expect(cleanPlayerName('🏎️'.repeat(20))).toBe(Array.from('🏎️'.repeat(20)).slice(0, MAX_PLAYER_NAME).join(''));
    expect(Array.from(cleanPlayerName('x'.repeat(40)))).toHaveLength(MAX_PLAYER_NAME);
    expect(cleanPlayerName(42)).toBe('');
    expect(cleanPlayerName('\n\t ')).toBe('');
  });

  it('keeps cleaned names in the save and defaults to none', () => {
    expect(migrate({}).names).toEqual(['', '']);
    expect(migrate({ names: ['Ada\nLovelace', 7 as never] }).names).toEqual(['Ada Lovelace', '']);
  });

  it('labels a card with the nickname, falls back to left/right driver, and leaves an unnamed solo card as it was', () => {
    const t = new I18n('en');
    const solo: ResultFacts = { trackId: 'goldengate', time: 95.4, score: 1200, slimeHits: 3, best: null, isBest: false, rating: 3 };
    expect(personLabel(t, solo, 0)).toBeNull();
    expect(personLabel(t, { ...solo, name: 'Mia' }, 0)).toBe('Mia');
    const duo = { ...solo, players: [{ time: 95.4, score: 1, slimeHits: 0, name: 'Mia' }, { time: 99, score: 2, slimeHits: 0 }] };
    expect(personLabel(t, duo, 0)).toBe('Mia');
    expect(personLabel(t, duo, 1)).toBe(t.t('results.player2'));
    for (const lang of ['en', 'zh'] as const) {
      const tt = new I18n(lang);
      expect(textCard(tt, { ...solo, name: 'Mia' }, null)).toContain('Mia · 1:35.40');
      expect(textCard(tt, solo, null)).not.toContain(' · 1:35.40');
      expect(shareLines(tt, duo, null).join('\n')).toContain('Mia · 1:35.40');
      expect(shareLines(tt, duo, null).join('\n')).toContain(`${tt.t('results.player2')} · 1:39.00`);
    }
  });

  it('travels cleaned in a challenge code', () => {
    const known = { tracks: CATALOGUE.map(track => track.id), vehicles: VEHICLES.map(vehicle => vehicle.id) };
    const code = encodeChallenge({ trackId: 'goldengate', direction: 'forward', time: 90, rating: 2, score: 5, name: 'Mia‮\nX' });
    expect(decodeChallenge(code, known)?.name).toBe('Mia X');
  });
});

describe('the nickname setting row', () => {
  it('a confirm press without text focuses the field and keeps the saved name; typed text is stored cleaned', async () => {
    const { Game } = await import('../src/app/Game');
    const { Save } = await import('../src/app/Save');
    const input = document.createElement('input'); input.dataset.setting = 'name'; document.body.append(input);
    const game = Object.create(Game.prototype) as any;
    game.save = new Save(null); game.save.update({ names: ['Mia', 'Kai'] });
    Object.assign(game, { views: {}, screens: { current: 'settings' }, renderPlayerHelp: () => {}, photo: null });
    game.pickSetting({ id: 'name', label: '' });
    expect(game.save.all.names).toEqual(['Mia', 'Kai']);
    expect(document.activeElement).toBe(input);
    game.pickSetting({ id: 'name2', label: '' }, ' Zed\n ');
    expect(game.save.all.names).toEqual(['Mia', 'Zed']);
    input.remove();
  });
});
