import { describe, expect, it } from 'vitest';
import { I18n } from '../src/ui/i18n';
import { resultRecord, type ResultFacts } from '../src/ui/screens';
import { textCard } from '../src/ui/TextCard';
import { shareLines } from '../src/ui/ShareDialog';

/** A personal best is announced once, and a lap that beat nothing says nothing. */
const base: ResultFacts = { trackId: 'goldengate', time: 95.4, score: 1200, slimeHits: 3, best: null, isBest: false, rating: 3 };

describe('a record run', () => {
  it('tells a best from a route first finish, and stays quiet otherwise', () => {
    const best = resultRecord({ ...base, isBest: true, best: 101.25 })!;
    expect(best.kind).toBe('best');
    expect(best.seconds).toBeCloseTo(5.85, 6);
    expect(resultRecord({ ...base, isBest: true, best: null })).toEqual({ kind: 'first', seconds: 0 });
    expect(resultRecord({ ...base, isBest: false, best: 90 })).toBeNull();
    expect(resultRecord({ ...base, isBest: true, best: 101.25, players: [] as never })).toBeNull();
  });

  it('marks the shared text and text card, in both languages, only when there is a record', () => {
    for (const lang of ['en', 'zh'] as const) {
      const t = new I18n(lang);
      const best: ResultFacts = { ...base, isBest: true, best: 101.25 };
      const expected = t.t('results.recordShare', { seconds: '5.85' });
      // A gap that rounds to nothing gets its own wording rather than 「快了 0.00 秒」.
      expect(textCard(t, { ...base, isBest: true, best: 95.403 }, null)).toContain(t.t('results.recordShareTiny'));
      expect(textCard(t, best, null)).toContain(expected);
      expect(shareLines(t, best, null).join('\n')).toContain(expected);
      expect(textCard(t, { ...base, isBest: true }, null)).toContain(t.t('results.recordShareFirst'));
      expect(textCard(t, base, null)).not.toContain(expected);
      expect(shareLines(t, base, null).join('\n')).not.toContain(expected);
    }
  });
});
