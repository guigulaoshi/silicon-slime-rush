import type { Game, GameReport, Session } from '../src/app/Game';

/**
 * The one description of `window.game` the browser tests share.
 *
 * Eight specs each declared their own `interface Window { game: … }` with a different idea of what
 * `report()` returns. That is legal only because `game/tsconfig.json` did not include `e2e` at all,
 * so none of them was ever type-checked: adding the directory produced 24 errors, most of them
 * "Subsequent property declarations must have the same type". The merge winner was whichever shape
 * had the fewest fields, so the rest were reading properties TypeScript believed did not exist.
 *
 * `report()`'s shape now has an owner in `Game.ts`. What is left here is the part that has none:
 * the automated run also reaches two private members at runtime -- `session` and `audio` -- and a
 * structural description of those is the honest way to say so in one place rather than eight.
 */
interface AudioSurface {
  graph: {
    engine: GainNode; intakeGain: GainNode; limiter: DynamicsCompressorNode;
    /** The three buses under the master, read by the release QA pass. */
    master: GainNode; music: GainNode; effects: GainNode;
  } | null;
  ctx: AudioContext | null;
  unlock(): Promise<void>;
  slime(kind: 'popper' | 'slick' | 'burst' | 'boost' | 'colossus', strength?: number,
    phase?: 'enter' | 'exit' | 'impact'): void;
  readonly slimeSoundCounts: Readonly<Record<
    'popper' | 'slick' | 'burst' | 'boost' | 'colossus' | 'gurgle' | 'fall', number>>;
  readonly slimeSoundPhaseCounts: Readonly<Record<
    'popper' | 'slick' | 'burst' | 'boost' | 'colossus' | 'gurgle' | 'fall',
    Readonly<Record<'enter' | 'exit' | 'impact', number>>>>;
  readonly scrubAmount: number;
  readonly metalScrapeAmount: number;
  readonly impactSoundCount: number;
}

export interface GameSurface extends Pick<Game, 'startRace' | 'autoRun' | 'autopilot' | 'setAutopilot'> {
  report(): GameReport;
  readonly timeScale: number;
  /**
   * Non-null on purpose. Every spec that touches it has already waited for a track to load, and a
   * spec that has not fails loudly at runtime -- which is a better failure than the `!` on every
   * line that typing it nullable would produce.
   */
  session: Session;
  audio: AudioSurface;
}

declare global {
  interface Window { game: GameSurface }
}
