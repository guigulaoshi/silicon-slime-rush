import { routeName } from './routeName';
import { personLabel, recordText, resultRecord, type ResultFacts } from './screens';
import type { I18n } from './i18n';
import { formatTime } from '../track/Race';
import { PUBLIC_GAME_URL } from '../app/Publication';
import { starGlyphs, type StarRating } from '../track/Rating';
import { challengeLines } from './ShareDialog';

/** One driver's rows on the text card: who, time and stars, slime colours hit, and eight pace sections. */
export interface TextCardPlayer {
  label: string | null;
  time: number;
  rating?: StarRating;
  hits: { emoji: string; kind: string; count: number }[];
  sections: ('fast' | 'slow' | 'none')[];
}

const HIT_ROWS: [string, string][] = [['🟩', 'popper'], ['🟪', 'slick'], ['⬛', 'burst'], ['🟥', 'boost'], ['🟦', 'colossus']];
const SECTION_GLYPH = { fast: '⏩', slow: '🐢', none: '▫️' } as const;

/** The facts both the copied text and its picture version are drawn from, so the two never disagree. */
export function textCardPlayers(t: I18n, result: ResultFacts): TextCardPlayer[] {
  return (result.players ?? [result]).map((player, index) => {
    const counts = player.impactKinds ?? {};
    const hits = HIT_ROWS.map(([emoji, kind]) => ({ emoji, kind, count: (counts as Record<string, number>)[kind] ?? 0 }));
    const known = hits.reduce((sum, hit) => sum + hit.count, 0);
    if (player.slimeHits > known) hits.push({ emoji: '⚪', kind: 'other', count: player.slimeHits - known });
    const sections = Array.from({ length: 8 }, (_, section) => {
      const data = player.sections?.[section];
      return !data?.seconds ? 'none' as const : data.distance / data.seconds < 20 / 3.6 ? 'slow' as const : 'fast' as const;
    });
    return { label: personLabel(t, result, index), time: player.time, ...(player.rating ? { rating: player.rating } : {}),
      hits: hits.filter(hit => hit.count > 0), sections };
  });
}

export function textCard(t: I18n, result: ResultFacts, url: string | null = PUBLIC_GAME_URL): string {
  const lines = [t.t('app.title'), routeName(t, result.trackId, result.direction)];
  // A record is part of the brag, not a detail hidden in the results page.
  const feat = resultRecord(result);
  if (feat) lines.push(recordText(t, feat, true));
  for (const player of textCardPlayers(t, result)) {
    lines.push((player.label ? player.label + ' · ' : '') + formatTime(player.time) + (player.rating ? ' · ' + starGlyphs(player.rating) : ''));
    lines.push(player.hits.map(hit => `${hit.emoji}×${hit.count}`).join(' ') || t.t('textCard.noHits'));
    lines.push(t.t('textCard.sections') + ' ' + player.sections.map(section => SECTION_GLYPH[section]).join(''));
  }
  if (result.achievements?.length) lines.push(t.t('achievement.share', {
    items: result.achievements.map(id => t.t(`achievement.${id}.name`)).join(' · '),
  }));
  lines.push(t.t('textCard.colors'), t.t('textCard.pace'));
  lines.push(...challengeLines(t, result));
  if (url && !result.challengeUrl) lines.push(url);
  return lines.join('\n');
}
