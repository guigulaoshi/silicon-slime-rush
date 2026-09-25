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
const EXACT = 1e-9;

export function raceRating(distance: number, seconds: number, score: number, referenceSeconds: number): StarRating {
  if (distance <= 0 || seconds <= 0 || referenceSeconds <= 0 || !Number.isFinite(distance + seconds + score + referenceSeconds)) return 1;
  // A run exactly on a threshold must get the star. Neither dividing nor multiplying is exact in
  // floating point -- 2.16/2.4 comes out 0.8999999999999999, 0.6 x 166.67 comes out 100.00000000000001
  // so each threshold allows a billionth of slack.
  const pace = referenceSeconds / seconds;
  const pointsPerMetre = Math.max(0, score) / distance;
  const meets = (share: number, perMetre: number) => pace >= share - EXACT && pointsPerMetre >= perMetre - EXACT;
  if (meets(PACE_TARGETS[0], 6)) return 5;
  if (meets(PACE_TARGETS[1], 3.5)) return 4;
  if (meets(PACE_TARGETS[2], 1.5)) return 3;
  if (meets(PACE_TARGETS[3], .5)) return 2;
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
