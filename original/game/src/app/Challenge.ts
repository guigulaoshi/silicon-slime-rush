import type { RaceDirection } from '../track/Direction';
import { STAR_RATINGS, type StarRating } from '../track/Rating';
import { fnvChecksum } from './Progression';
import { cleanPlayerName } from './playerName';
import { PLANNED_GAME_URL, PUBLIC_GAME_URL } from './Publication';

/**
 * A finished run, small enough to travel inside a link or a pasted code: the route, the
 * direction, the time, the stars, the slime score, and optionally the car and a name. Nothing else
 * -- a ghost recording is up to a megabyte and has no place in a URL.
 */
export interface Challenge {
  trackId: string;
  direction: RaceDirection;
  /** Seconds, kept to hundredths. */
  time: number;
  rating: StarRating;
  score: number;
  vehicleId?: string;
  name?: string;
}

export const CHALLENGE_PARAM = 'challenge';
const PREFIX = 'SSC1';
const SEP = '~';
const MAX_TIME_SECONDS = 36_000;
const MAX_SCORE = 10_000_000;

// `~` is the separator and encodeURIComponent leaves it alone, so it is escaped by hand; it stays
// unescaped in a URL query, which keeps the link short.
const field = (text: string): string => encodeURIComponent(text).replaceAll('~', '%7E');
const unfield = (text: string): string => decodeURIComponent(text);

export function encodeChallenge(challenge: Challenge): string {
  const body = [
    field(challenge.trackId), challenge.direction === 'reverse' ? 'r' : 'f',
    String(Math.round(challenge.time * 100)), String(challenge.rating), String(Math.round(challenge.score)),
    field(challenge.vehicleId ?? ''), field(cleanPlayerName(challenge.name)),
  ].join(SEP);
  return `${PREFIX}${SEP}${body}${SEP}${fnvChecksum(body)}`;
}

/** What the game knows about; anything else in a code is somebody's typo or somebody's joke. */
export interface ChallengeCatalogue { tracks: readonly string[]; vehicles: readonly string[] }

/** The decoded challenge, or null for anything that is not a well-formed, untampered, known code. */
export function decodeChallenge(text: unknown, known: ChallengeCatalogue): Challenge | null {
  if (typeof text !== 'string') return null;
  const parts = text.trim().split(SEP);
  if (parts.length !== 9 || parts[0] !== PREFIX) return null;
  const body = parts.slice(1, 8).join(SEP);
  if (fnvChecksum(body) !== parts[8]) return null;
  try {
    const [trackId, dir, hundredths, stars, score, vehicleId, name] = parts.slice(1, 8).map(unfield) as string[];
    const time = Number(hundredths) / 100, rating = Number(stars), points = Number(score);
    if (!known.tracks.includes(trackId!)) return null;
    if (dir !== 'f' && dir !== 'r') return null;
    if (!Number.isInteger(Number(hundredths)) || time <= 0 || time > MAX_TIME_SECONDS) return null;
    if (!STAR_RATINGS.includes(rating as StarRating)) return null;
    if (!Number.isInteger(points) || points < 0 || points > MAX_SCORE) return null;
    if (vehicleId && !known.vehicles.includes(vehicleId)) return null;
    const challenge: Challenge = { trackId: trackId!, direction: dir === 'r' ? 'reverse' : 'forward', time, rating: rating as StarRating, score: points };
    if (vehicleId) challenge.vehicleId = vehicleId;
    const cleaned = cleanPlayerName(name);
    if (cleaned) challenge.name = cleaned;
    return challenge;
  } catch { return null; }
}

/**
 * The link under a shared dare: the plain game page. itch.io runs the game in an iframe
 * whose address belongs to one upload and passes no query into it, so a ?challenge= code on any link
 * a player can share would do nothing on the store page and die with the next upload on the embed
 * page. The shared words still dare the friend to beat the time; the code stays readable from a
 * direct `?challenge=` address (main.ts) for a host that can pass one in.
 */
export function challengeUrl(home: string | null = PUBLIC_GAME_URL): string {
  return new URL(home ?? PLANNED_GAME_URL).href;
}

/** Seconds the finisher was ahead of (positive) or behind (negative) the challenge. */
export const challengeMargin = (challenge: Pick<Challenge, 'time'>, time: number): number =>
  Math.round((challenge.time - time) * 100) / 100;
