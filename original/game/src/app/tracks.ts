export interface TrackEntry {
  id: string;
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
  // Catalogue order is the menu order, so this list is the one place the shelf order lives.: the two routes
  // people share most -- the bridge and the ring rooftop -- lead; short and recognisable next; the
  // 16 km commute last, so a new player does not meet a ten-minute drive on their second race.
  { id: 'goldengate' },
  { id: 'wolfe-pruneridge',
    hiddenStreetNames: ['Apple Park Way', 'Apple Park Transit Center'] },
  { id: 'twin-peaks' },
  { id: 'lombard' },
  // Corridors, not campuses. One route that passes four famous front doors beats four routes that
  // each pass one: more people find their own building, and a corridor is a better drive than a
  // lap of a car park. Named after the roads, never after the companies.
  { id: 'shoreline' },
  { id: 'fishermans-wharf' },
  { id: 'moffett-field' },
  { id: 'bayshore-101' },
];

/** Tracks that actually have data built for them right now. */
export const BUILT = new Set(['bayshore-101', 'goldengate', 'twin-peaks', 'lombard', 'fishermans-wharf',
  'shoreline', 'wolfe-pruneridge', 'moffett-field']);

export const SYNTHETIC = ['synth-loop', 'synth-p2p', 'synth-stops'];

export function playable(id: string, dev: boolean): boolean {
  if (dev && SYNTHETIC.includes(id)) return true;
  return CATALOGUE.some((t) => t.id === id) && BUILT.has(id);
}
