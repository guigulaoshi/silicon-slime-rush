export interface TrackEntry {
  id: string;
  /**
   * The nearest airport's IATA code, printed big on the route's boarding-pass card: the travel
   * theme's ticket for the place. Locale-free, so it lives with the roster rather than in i18n.
   */
  code: string;
  /** The race loop from `audio/music.ts` that plays here: a local folk tune, on a local instrument, over the shared bed. */
  music: string;
  /** OSM road labels intentionally omitted from player maps; geometry remains visible. */
  hiddenStreetNames?: readonly string[];
}

/**
 * Every track the game will ever have, in menu order. Tracks are not classed.
 *
 * The ones without data yet are listed on purpose. A menu with one entry looks like the whole game;
 * a menu with a dozen, most marked with the version that brings them, looks like a series.
 */
export const CATALOGUE: TrackEntry[] = [
  // Menu order is by continent: Asia, the Middle East, Europe, Africa, the Americas, Oceania. Beijing
  // leads because it is the default track (remix brief).
  { id: 'beijing', code: 'PEK', music: 'yeshenchen' },
  { id: 'shanghai', code: 'SHA', music: 'zizhu' },
  { id: 'lhasa', code: 'LXA', music: 'amalehuo' },
  { id: 'zhangjiajie', code: 'DYG', music: 'masang' },
  { id: 'fuji', code: 'HND', music: 'sakura' },
  { id: 'dubai', code: 'DXB', music: 'gulf' },
  { id: 'istanbul', code: 'IST', music: 'katibim' },
  { id: 'rome', code: 'FCO', music: 'funiculi' },
  { id: 'paris', code: 'CDG', music: 'blonde' },
  { id: 'giza', code: 'CAI', music: 'lamma' },
  { id: 'amboseli', code: 'ASV', music: 'savanna' },
  { id: 'new-york', code: 'JFK', music: 'sidewalks' },
  { id: 'sydney', code: 'SYD', music: 'matilda' },
];

/** Tracks that actually have data built for them right now. */
export const BUILT = new Set([
  'beijing',
  'shanghai',
  'lhasa',
  'zhangjiajie',
  'fuji',
  'dubai',
  'istanbul',
  'rome',
  'paris',
  'giza',
  'amboseli',
  'new-york',
  'sydney',
]);

export const SYNTHETIC = ['synth-loop', 'synth-p2p', 'synth-stops'];

export function playable(id: string, dev: boolean): boolean {
  if (dev && SYNTHETIC.includes(id)) return true;
  return CATALOGUE.some((t) => t.id === id) && BUILT.has(id);
}
