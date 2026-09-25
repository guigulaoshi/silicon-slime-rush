export const STAR_RATINGS = [1, 2, 3, 4, 5] as const;
export type StarRating = typeof STAR_RATINGS[number];

/**
 * High stars require both pace and earned points; neither can compensate for the other.
 *
 * Pace is the AI's time for this route in this vehicle over the player's: 1 means as fast
 * as the normal AI on an empty road. The shares are the old absolute targets (24, 20, 16, 10 m/s)
 * over the normal AI's 26.4 m/s on the Golden Gate in the micro-hatch (the catalogue's fallback car),
 * so a typical run there keeps its stars while slow vehicles and slow routes stop being capped.
 */
export const PACE_TARGETS = [.9, .75, .6, .4] as const;

export function raceRating(distance: number, seconds: number, score: number, referenceSeconds: number): StarRating {
  if (distance <= 0 || seconds <= 0 || referenceSeconds <= 0 || !Number.isFinite(distance + seconds + score + referenceSeconds)) return 1;
  const pace = referenceSeconds / seconds;
  const pointsPerMetre = Math.max(0, score) / distance;
  if (pace >= PACE_TARGETS[0] && pointsPerMetre >= 6) return 5;
  if (pace >= PACE_TARGETS[1] && pointsPerMetre >= 3.5) return 4;
  if (pace >= PACE_TARGETS[2] && pointsPerMetre >= 1.5) return 3;
  if (pace >= PACE_TARGETS[3] && pointsPerMetre >= .5) return 2;
  return 1;
}

export function starGlyphs(rating: StarRating): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

/** Previous 0.7 saves used letter grades; preserve their rough achievement level on migration. */
export function legacyStarRating(value: unknown): StarRating | null {
  if (STAR_RATINGS.includes(value as StarRating)) return value as StarRating;
  return value === 'S' ? 5 : value === 'A' ? 4 : value === 'B' ? 2 : value === 'C' ? 1 : null;
}
