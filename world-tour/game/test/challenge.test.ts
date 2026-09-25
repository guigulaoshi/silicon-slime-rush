import { MAX_PLAYER_NAME } from '../src/app/playerName';
import { describe, expect, it } from 'vitest';
import { challengeMargin, challengeUrl, decodeChallenge, encodeChallenge, type Challenge } from '../src/app/Challenge';
import { CATALOGUE } from '../src/app/tracks';
import { VEHICLES } from '../src/vehicles/catalogue';
import { challengeLines, shareLines } from '../src/ui/ShareDialog';
import { textCard } from '../src/ui/TextCard';
import { I18n } from '../src/ui/i18n';
import type { ResultFacts } from '../src/ui/screens';

const known = { tracks: CATALOGUE.map(t => t.id), vehicles: VEHICLES.map(v => v.id) };
// goldengate/lombard's replacements (mapping table): sydney (showcase/default), zhangjiajie
//.
const run: Challenge = { trackId: 'sydney', direction: 'reverse', time: 151.37, rating: 3, score: 15562,
  vehicleId: 'retro-van', name: '老实人 ~ & ?' };

/** A finished run travels in a link and comes back exactly, and nothing else gets in. */
describe('challenge codes', () => {
  it('round-trips every field, including a name with separators, spaces and CJK', () => {
    const code = encodeChallenge(run);
    expect(decodeChallenge(code, known)).toEqual(run);
    expect(decodeChallenge(`  ${code}\n`, known)).toEqual(run);
    const bare = encodeChallenge({ trackId: 'sydney', direction: 'forward', time: 60, rating: 1, score: 0 });
    expect(decodeChallenge(bare, known)).toEqual({ trackId: 'sydney', direction: 'forward', time: 60, rating: 1, score: 0 });
  });

  it('refuses tampered, malformed, unknown and out-of-range codes instead of throwing', () => {
    const code = encodeChallenge(run);
    const parts = code.split('~');
    const retime = [...parts]; retime[3] = '100';
    for (const bad of [undefined, 42, '', 'SSC1', 'SSR1-abc-def', code.replace('SSC1', 'SSC2'), retime.join('~'),
      code.slice(0, -1) + (code.endsWith('0') ? '1' : '0'), 'SSC1~%E0%A4%A~f~1~1~1~~~zz']) {
      expect(decodeChallenge(bad, known), String(bad)).toBeNull();
    }
    const forged = (patch: Partial<Challenge>) => encodeChallenge({ ...run, ...patch });
    expect(decodeChallenge(forged({ trackId: 'synth-loop' }), known)).toBeNull();
    expect(decodeChallenge(forged({ vehicleId: 'tank' }), known)).toBeNull();
    expect(decodeChallenge(forged({ time: 0 }), known)).toBeNull();
    expect(decodeChallenge(forged({ time: 99_999 }), known)).toBeNull();
    expect(decodeChallenge(forged({ rating: 7 as never }), known)).toBeNull();
    expect(decodeChallenge(forged({ score: -5 }), known)).toBeNull();
    expect(decodeChallenge(forged({ name: 'x'.repeat(80) }), known)?.name).toHaveLength(MAX_PLAYER_NAME);
  });

  it('links the plain game page, never a ?challenge= code itch cannot pass into the game', () => {
    expect(challengeUrl(null)).toBe('https://guigulaoshi.itch.io/silicon-slime-rush-world-tour');
    expect(challengeUrl('https://example.itch.io/game')).toBe('https://example.itch.io/game');
  });

  it('measures the margin in hundredths, ahead positive and behind negative', () => {
    expect(challengeMargin({ time: 151.37 }, 150)).toBe(1.37);
    expect(challengeMargin({ time: 151.37 }, 152.5)).toBe(-1.13);
  });

  it('puts the dare and the link into both share texts, and the plain URL only once', () => {
    const code = encodeChallenge(run);
    const result: ResultFacts = { trackId: 'sydney', time: 151.37, score: 15562, slimeHits: 35, best: null, isBest: false,
      rating: 3, challengeCode: code, challengeUrl: challengeUrl(null), challengeVehicleId: 'sports-car' };
    for (const lang of ['zh', 'en'] as const) {
      const t = new I18n(lang);
      for (const text of [shareLines(t, result, 'https://guigulaoshi.itch.io/silicon-slime-rush-world-tour').join('\n'),
        textCard(t, result, 'https://guigulaoshi.itch.io/silicon-slime-rush-world-tour')]) {
        // Cars differ in pace: the shared dare names the car, the route and the time.
        expect(text).toContain(t.t('challenge.shareLine', { car: t.t('car.sports-car.name'), route: t.t('track.sydney.name'), time: '2:31.37' }));
        expect(text).toContain(result.challengeUrl);
        expect(text.split('https://').length - 1, 'one link, the challenge link').toBe(1);
      }
    }
    expect(challengeLines(new I18n('en'), { trackId: 'sydney', time: 1 })).toEqual([]);
  });
});
