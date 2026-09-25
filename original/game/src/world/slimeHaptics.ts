import type { SlimeKind } from './Slimes';

/**
 * How hard a slime hit shakes the hand, one table for both outputs: the gamepad plays
 * every pulse with its strength, a phone -- whose `navigator.vibrate` only knows on/off
 * milliseconds -- plays the same durations as an on/off pattern, so a three-pulse colossus entry
 * reads as on-pause-on. Weight is in the order the game has always used: splitter lightest, popper
 * short, boost one firm tap, burst long and heavy, colossus the long entry.
 */
export interface HapticPulse { duration: number; magnitude: number }

export const SLIME_HAPTICS: Record<SlimeKind, readonly HapticPulse[]> = {
  slick: [{ duration: 50, magnitude: 0.22 }],
  popper: [{ duration: 80, magnitude: 0.32 }],
  boost: [{ duration: 110, magnitude: 0.45 }],
  burst: [{ duration: 300, magnitude: 0.8 }],
  colossus: [{ duration: 120, magnitude: 0.9 }, { duration: 90, magnitude: 0.55 }, { duration: 180, magnitude: 0.82 }],
};

/** The phone's on/off pattern for a kind, straight from the shared table. */
export function phoneVibrationPattern(kind: SlimeKind): number[] {
  return SLIME_HAPTICS[kind].map((pulse) => pulse.duration);
}

/**
 * Whether this document may ask the phone to vibrate right now. Chromium refuses the call before
 * the page has ever seen a real tap or key press and logs an error-level intervention each time;
 * an automated run (`?bot=1`) never taps, so asking there would only paint the console red.
 * Browsers without `userActivation` are asked as before.
 */
export function phoneVibrationAllowed(nav: Navigator): boolean {
  if (typeof nav.vibrate !== 'function') return false;
  const activation = (nav as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return !activation || activation.hasBeenActive;
}
