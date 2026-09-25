import type { SlimeKind } from '../world/Slimes';
import type { Spline } from './Spline';
import { Progress, delta, projectOnSample } from './Progress';
import type { TrackData } from './types';

export type RaceState = 'ready' | 'racing' | 'finished';

/** Checkpoint 0 is the start line, not one of the numbered gates the player drives through. */
export function drivableGateCount(checkpointCount: number): number {
  return Math.max(0, checkpointCount - 1);
}

/**
 * How many gantries are behind the player, for the HUD and the intro screen.
 *
 * Checkpoint 0 is the start: the car stands on it, the race counts it cleared before the clock
 * starts, and it carries no gantry, so the gates a player drives through number one fewer than the
 * checkpoints. `nextCheckpoint` is the index of the one still ahead -- one more than the count
 * behind -- except on a circuit, where it wraps back to 0 once the last gate is passed and 0 there
 * means "all of them, and the finish line is what remains".
 *
 * `state` has to come in because 0 means two opposite things: the wrap above, and the field's
 * initial value before `start()` has run. The countdown screen is the HUD, so without this a race
 * announced itself as 9/9 for its first three and a half seconds.
 */
export function gatesPassed(state: RaceState, nextCheckpoint: number, gateCount: number): number {
  if (state === 'ready') return 0;
  return nextCheckpoint === 0 ? gateCount : nextCheckpoint - 1;
}

export interface CarSample {
  x: number;
  z: number;
  /** A real front vehicle is asking this driver to wait; off-road checks still apply. */
  waitingForTraffic?: boolean;
  /** False when a human deliberately leaves the pedals alone; legacy robot samples imply intent. */
  tryingToMove?: boolean;
  /** speed over the ground, m/s */
  speed: number;
  /** unit heading on the ground plane */
  headingX: number;
  headingZ: number;
  /** A new solid contact this step: another car, a rail, an elastic slime, or a colossus. */
  hardCollision?: boolean;
}

export interface RaceEvent {
  type: 'checkpoint' | 'lap' | 'finish' | 'reset' | 'stop-required' | 'stop-cleared' | 'clean-corner';
  index?: number;
  lap?: number;
  time?: number;
  resetReason?: 'off-track' | 'wedged';
  lateral?: number;
  halfWidth?: number;
  speed?: number;
  points?: number;
}

export interface ResetRequest {
  pos: [number, number, number];
  yaw: number;
  resetReason?: 'off-track' | 'wedged';
  lateral?: number;
  halfWidth?: number;
  speed?: number;
}

export interface ScoreAward {
  id: number;
  points: number;
  total: number;
  source: 'slime' | 'clean-corner';
  /** The combo this slime extended, 1 for a lone hit; absent on corner awards. */
  combo?: number;
  /** Race time of the award, so the HUD can tell whether the combo is still alive. */
  at?: number;
}

/** A slime within this many seconds of the previous one extends the combo. */
export const COMBO_WINDOW_SECONDS = 4;

/**
 * Points multiplier for the n-th slime in a combo: a quarter more per link, capped at 3x
 * from the ninth slime on, so a chain pays but one long chain cannot outweigh a whole clean race.
 */
export function comboMultiplier(combo: number): number {
  return Math.min(3, 1 + .25 * (Math.max(1, Math.floor(combo)) - 1));
}

// Beyond the road edge before the car counts as off, and how long it has to stay there. There is a
// rail 0.3 m outside the tarmac now, so being two and a half metres past the edge means the car got
// over it or round its ends -- and outside the rail there is nothing to drive back in on. Before
// the rails this had to be a generous eight metres and three seconds, because running onto the
// verge was ordinary.
export const OFF_TRACK_MARGIN = 2.5;
export const OFF_TRACK_WARNING_SECONDS = 0.15;
export const OFF_TRACK_SECONDS = 1.15;
/** Guardrail line past the painted edge; matches pipeline/sr/roads.py RAIL_OFFSET. */
export const RAIL_OFFSET = 0.3;
export const WEDGED_SECONDS = 5;       // stopped this long, with nothing asking the car to stop
export const WEDGED_SPEED = 0.15;      // a physically wedged car can still be making progress
export const WRONG_WAY_SECONDS = 2;
export const STOP_SPEED = 5 / 3.6;     // 5 km/h
export const STOP_SECONDS = 1;
export const CLEAN_CORNER_POINTS = 300;

/**
 * Stable corner ids from authored curvature. Brief straight samples are bridged so one real bend
 * does not become several farmable awards; short steering corrections never become a corner.
 */
export function cleanCornerMap(spline: Spline): Int16Array {
  const curved = Array.from(spline.curvature, value => Math.abs(value) >= .007);
  const maxGapSamples = Math.max(1, Math.round(12 / Math.max(1, spline.length / Math.max(1, spline.count - 1))));
  for (let i = 0; i < curved.length;) {
    if (curved[i]) { i++; continue; }
    const start = i;
    while (i < curved.length && !curved[i]) i++;
    if (start > 0 && i < curved.length && i - start <= maxGapSamples) curved.fill(true, start, i);
  }
  const groups: number[][] = [];
  for (let i = 0; i < curved.length;) {
    if (!curved[i]) { i++; continue; }
    const group: number[] = [];
    while (i < curved.length && curved[i]) group.push(i++);
    groups.push(group);
  }
  if (spline.closed && groups.length > 1 && groups[0]![0] === 0
    && groups.at(-1)!.at(-1) === spline.count - 1) {
    groups[0] = [...groups.pop()!, ...groups[0]!];
  }
  const out = new Int16Array(spline.count); out.fill(-1);
  const metres = spline.length / Math.max(1, spline.closed ? spline.count : spline.count - 1);
  let id = 0;
  for (const group of groups) {
    const length = group.length * metres;
    const turn = group.reduce((sum, index) => sum + Math.abs(spline.curvature[index]!) * metres, 0);
    const peak = Math.max(...group.map(index => Math.abs(spline.curvature[index]!)));
    if (length < 16 || turn < .22 || peak < .012) continue;
    for (const index of group) out[index] = id;
    id++;
  }
  return out;
}

/* */
export const RESCUE_BACK_M = 15;
/** A rescue that lands within this of the previous one, this soon after, backs off further each time. */
export const RESCUE_REPEAT_M = 30;
export const RESCUE_REPEAT_SECONDS = 20;
export const RESCUE_REPEAT_BACK_M = 40;
/** The road position only advances continuously: a jump further than this in one step is a shortcut or a projection slip, not driving. */
const SAFE_STEP_M = 30;
/** After a jump, this much continuous driving on the road makes the car's own position the rescue spot again. */
const SAFE_RUN_M = 20;

/**
 * Timing, checkpoints, laps and putting the car back when it leaves the road.
 *
 * It takes a plain sample of where the car is rather than the car itself, so the whole rule set runs
 * in a test without a physics engine, and the same code drives the automated driver.
 */
export class Race {
  readonly progress: Progress;
  state: RaceState = 'ready';
  time = 0;
  score = 0;
  slimeHits = 0;
  cleanCorners = 0;
  readonly scoreAwards: ScoreAward[] = [];
  readonly impactKinds: Partial<Record<SlimeKind, number>> = {};
  readonly sections = Array.from({length: 8}, () => ({seconds: 0, distance: 0}));
  maxCombo = 0;
  /** Points added by combo multipliers alone; stars are judged without them. */
  comboBonus = 0;
  private combo = 0;
  private lastSlimeTime = -Infinity;
  private readonly scoredSlimes = new Set<string>();
  private readonly cleanCornerIds: Int16Array;
  private readonly scoredCorners = new Set<string>();
  private activeCorner = -1;
  private activeCornerLap = 1;
  private cornerDirty = false;
  private nextAwardId = 0;
  lap = 1;
  nextCheckpoint = 0;
  wrongWay = false;
  /** set while the car is stopped at a delivery point and the clock for it is running */
  stopDwell = 0;

  private lastS = 0;
  private offFor = 0;
  private wedgedFor = 0;
  private wrongFor = 0;
  private pendingReset: ResetRequest | null = null;
  private lastCleared = -1;
  /** Metres past the last cleared gate the car last drove properly on the road; where a rescue starts from. */
  private safeAhead = 0;
  private lastRescue: { ahead: number; gate: number; time: number; streak: number } | null = null;
  /** The current unbroken stretch of proper driving: where it began and the last step, in metres past the gate. */
  private safeRun: { start: number; last: number } | null = null;

  /**
   * @param bodyHalfWidth half the vehicle's width. A car whose whole body is past the rail line is
   * already out, however little of the 2.5 m margin it used: outside the rail it can only wait, so
   * it is rescued on the same clock.
   */
  constructor(readonly track: TrackData, readonly spline: Spline, readonly bodyHalfWidth = 0) {
    this.progress = new Progress(spline);
    this.cleanCornerIds = cleanCornerMap(spline);
    this.reacquire(track.start.pos[0], track.start.pos[2]);
  }

  /** Each authored or fallen slime contributes once per run, including after rescue or streaming. */
  hitSlime(key: string, scale: readonly number[], kind?: SlimeKind): void {
    if (this.state !== 'racing' || this.scoredSlimes.has(key)) return;
    this.scoredSlimes.add(key);
    this.combo = this.time - this.lastSlimeTime <= COMBO_WINDOW_SECONDS ? this.combo + 1 : 1;
    this.lastSlimeTime = this.time;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const base = slimePoints(scale);
    const points = Math.round(base * comboMultiplier(this.combo));
    this.comboBonus += points - base;
    this.addScore(points, 'slime', this.combo);
    this.slimeHits++;
    if (kind) this.impactKinds[kind] = (this.impactKinds[kind] ?? 0) + 1;
  }

  /** The score the star rating reads: everything except the combo bonus, so star thresholds keep their meaning. */
  get ratingScore(): number {
    return this.score - this.comboBonus;
  }

  get totalLaps(): number {
    return this.track.mode === 'loop' ? this.track.laps : 1;
  }

  /** Checkpoints cleared so far on this lap, for the head-up display. */
  get checkpointsCleared(): number {
    return this.nextCheckpoint;
  }

  /** True only while roadside rescue is counting down; returning inside clears it immediately. */
  get rescueWarning(): boolean {
    return this.offFor >= OFF_TRACK_WARNING_SECONDS;
  }

  start(): void {
    this.state = 'racing';
    this.time = 0;
    // The car begins standing on the start line, so it can never be driven through. It counts as
    // cleared from the off; on a loop it becomes the lap gate, crossed again at the end of each lap.
    if (this.track.checkpoints.length) {
      this.lastCleared = 0;
      this.nextCheckpoint = this.track.checkpoints.length > 1 ? 1 : 0;
    }
  }

  reacquire(x: number, z: number): void {
    this.lastS = this.progress.reacquire(x, z).s;
    this.offFor = 0;
    if (this.pendingReset?.resetReason === 'off-track') this.pendingReset = null;
  }

  /**
   * Signed distance to the next delivery point; negative means the car overshot it.
   * Null means the next gate is a drive-through.
   *
   * A driver has to know this: a stop gate is not passed by arriving at it, and anything that just
   * follows the racing line will sail through the delivery and never finish the run.
   */
  distanceToStop(): number | null {
    const gate = this.track.checkpoints[this.nextCheckpoint];
    if (!gate?.stop) return null;
    const ahead = delta(this.progress.value.s, gate.s, this.spline.length, this.spline.closed);
    return ahead;
  }

  /** Distance to the final timing line once it is the next gate the driver can clear. */
  distanceToFinish(): number | null {
    if (this.state !== 'racing' || !this.track.checkpoints.length) return null;
    if (this.track.mode === 'loop') {
      if (this.lap !== this.totalLaps || this.nextCheckpoint !== 0) return null;
      return Math.max(delta(this.progress.value.s, 0, this.spline.length, true), 0);
    }
    const finish = this.track.checkpoints.length - 1;
    if (this.nextCheckpoint !== finish) return null;
    return Math.max(delta(this.progress.value.s, this.track.checkpoints[finish]!.s,
      this.spline.length, false), 0);
  }

  /** A reset was asked for, or triggered; where to put the car back. */
  takeReset(): ResetRequest | null {
    const r = this.pendingReset;
    this.pendingReset = null;
    return r;
  }

  /**
   * Where the car goes on a reset: a little behind the last place it was driving properly on the road,
   * never past a gate it has not cleared and never behind the last gate it has; before any gate, the start line.
   * Repeated rescues at the same spot back off further, so a place that keeps wedging the car is left behind.
   */
  resetTarget(): ResetRequest {
    const cp = this.lastCleared >= 0 ? this.track.checkpoints[this.lastCleared] : null;
    if (!cp) return { pos: [...this.track.start.pos], yaw: this.track.start.yaw };
    const previous = this.lastRescue;
    const plain = Math.max(0, this.safeAhead - RESCUE_BACK_M);
    const repeat = previous && previous.gate === this.lastCleared && this.time - previous.time <= RESCUE_REPEAT_SECONDS
      && Math.abs(previous.ahead - plain) <= RESCUE_REPEAT_M;
    const streak = repeat ? previous!.streak + 1 : 0;
    const ahead = Math.max(0, plain - streak * RESCUE_REPEAT_BACK_M);
    this.lastRescue = { ahead, gate: this.lastCleared, time: this.time, streak };
    this.safeAhead = ahead;
    this.safeRun = null;
    const station = this.spline.closed ? this.spline.wrapS(cp.s + ahead) : Math.min(cp.s + ahead, this.spline.length);
    const i = this.spline.indexAt(station);
    const p = this.spline.point(i);
    const t = this.spline.tangent(i);
    return { pos: [p[0], p[1] + 0.8, p[2]], yaw: Math.atan2(-t[0], -t[2]) };
  }

  /** Remembers how far past the last cleared gate the car is while it drives properly on the road. */
  private trackSafePlace(s: number, lateral: number, halfWidth: number, moved: number): void {
    const cps = this.track.checkpoints;
    const from = cps[this.lastCleared];
    if (!from || this.state !== 'racing' || this.wrongWay || moved < 0 || Math.abs(lateral) > halfWidth) {
      this.safeRun = null;
      return;
    }
    const length = this.spline.length;
    const ahead = this.spline.closed ? ((s - from.s) % length + length) % length : s - from.s;
    const next = cps[this.nextCheckpoint];
    const span = !next ? Infinity : this.spline.closed
      ? (((next.s - from.s) % length + length) % length || length) : next.s - from.s;
    if (ahead >= span) { this.safeRun = null; return; }
    // Continuity is judged step by step: a single jump (a cut, a projection slip) starts a new stretch, and
    // that stretch counts once it has been driven for SAFE_RUN_M, so one cut never freezes the spot for a sector.
    const run = this.safeRun && ahead - this.safeRun.last >= 0 && ahead - this.safeRun.last <= SAFE_STEP_M
      ? { start: this.safeRun.start, last: ahead } : { start: ahead, last: ahead };
    this.safeRun = run;
    if (ahead > this.safeAhead && (ahead - this.safeAhead <= SAFE_STEP_M || run.last - run.start >= SAFE_RUN_M)) this.safeAhead = ahead;
  }

  requestReset(request: ResetRequest = this.resetTarget()): void {
    this.cornerDirty = true;
    this.pendingReset = request;
  }

  update(dt: number, car: CarSample): RaceEvent[] {
    const events: RaceEvent[] = [];
    const p = this.progress.update(car.x, car.z);
    if (this.state === 'racing') {
      this.time += dt;
      const completedDistance = (this.lap - 1) * this.spline.length + p.s;
      const index = Math.max(0, Math.min(7, Math.floor(completedDistance / (this.spline.length * this.totalLaps) * 8)));
      this.sections[index]!.seconds += dt;
      this.sections[index]!.distance += Math.max(0, car.speed) * dt;
    }

    const moved = delta(this.lastS, p.s, this.spline.length, this.spline.closed);
    const halfWidth = this.spline.halfWidth[p.index] ?? 4;

    // wrong way: pointing back down the track while actually moving
    const t = this.spline.tangent(p.index);
    const facing = car.headingX * t[0] + car.headingZ * t[2];
    this.wrongFor = facing < -0.3 && car.speed > 3 ? this.wrongFor + dt : 0;
    this.wrongWay = this.wrongFor >= WRONG_WAY_SECONDS;

    // Past the margin a cut is dirty and, on the same clock, rescued.
    const off = Math.abs(p.lateral) > halfWidth + OFF_TRACK_MARGIN;
    const openStation = !this.spline.closed
      ? projectOnSample(this.spline, p.index, car.x, car.z).s : p.s;
    const pastEndpoint = !this.spline.closed && this.state === 'racing'
      && (openStation < -12 || openStation > this.spline.length + 12);
    const pastRail = this.bodyHalfWidth > 0
      && Math.abs(p.lateral) - this.bodyHalfWidth > halfWidth + RAIL_OFFSET;
    const beyondRescue = off || pastRail || pastEndpoint;
    if (!beyondRescue && this.pendingReset?.resetReason === 'off-track') this.pendingReset = null;
    this.offFor = pastEndpoint ? OFF_TRACK_SECONDS : beyondRescue ? this.offFor + dt : 0;
    if (this.offFor >= OFF_TRACK_SECONDS && !this.pendingReset) {
      this.cornerDirty = true;
      this.pendingReset = { ...this.resetTarget(), resetReason: 'off-track',
        lateral: p.lateral, halfWidth, speed: car.speed };
      events.push({
        type: 'reset', resetReason: 'off-track', lateral: p.lateral, halfWidth, speed: car.speed,
      });
    }

    // Wedged: stopped dead, with nothing in the rules asking the car to stop. Running wide leaves
    // the car against a rail or a kerb often enough that "press R" cannot be the only way out --
    // a player who does not know about R is simply stuck, and an automated driver has no keyboard.
    const toStop = this.state === 'racing' ? this.distanceToStop() : null;
    const mustStop = toStop !== null && toStop < 40;
    this.wedgedFor = this.state === 'racing' && car.speed < WEDGED_SPEED && !mustStop && !car.waitingForTraffic
      && car.tryingToMove !== false
      ? this.wedgedFor + dt : 0;
    if (this.wedgedFor >= WEDGED_SECONDS && !this.pendingReset) {
      this.wedgedFor = 0;
      this.cornerDirty = true;
      this.pendingReset = { ...this.resetTarget(), resetReason: 'wedged',
        lateral: p.lateral, halfWidth, speed: car.speed };
      events.push({
        type: 'reset', resetReason: 'wedged', lateral: p.lateral, halfWidth, speed: car.speed,
      });
    }

    if (this.state === 'racing') {
      const corner = this.updateCleanCorner(this.cleanCornerIds[p.index] ?? -1,
        !!car.hardCollision || off || moved < -0.25);
      if (corner) events.push(corner);
      events.push(...this.advanceCheckpoints(dt, car, p.s, moved, p.lateral, halfWidth));
      if (!beyondRescue) this.trackSafePlace(p.s, p.lateral, halfWidth, moved);
    }
    this.lastS = p.s;
    return events;
  }

  private updateCleanCorner(zone: number, dirty: boolean): RaceEvent | null {
    if (zone === this.activeCorner) {
      if (zone >= 0 && dirty) this.cornerDirty = true;
      return null;
    }
    let award: RaceEvent | null = null;
    if (this.activeCorner >= 0) {
      const key = `${this.activeCornerLap}:${this.activeCorner}`;
      if (!this.cornerDirty && !this.scoredCorners.has(key)) {
        this.scoredCorners.add(key);
        this.cleanCorners++;
        this.addScore(CLEAN_CORNER_POINTS, 'clean-corner');
        award = { type: 'clean-corner', points: CLEAN_CORNER_POINTS };
      }
    }
    this.activeCorner = zone;
    this.activeCornerLap = this.lap;
    this.cornerDirty = zone >= 0 && dirty;
    return award;
  }

  private addScore(points: number, source: ScoreAward['source'], combo?: number): void {
    this.score += points;
    this.scoreAwards.push({ id: ++this.nextAwardId, points, total: this.score, source,
      ...(combo !== undefined ? { combo, at: this.time } : {}) });
  }

  private advanceCheckpoints(
    dt: number, car: CarSample, s: number, moved: number, lateral: number, halfWidth: number,
  ): RaceEvent[] {
    const events: RaceEvent[] = [];
    const cps = this.track.checkpoints;
    if (!cps.length) return events;
    const gate = cps[this.nextCheckpoint];
    if (!gate) return events;

    if (gate.stop) {
      // a delivery point is reached by stopping at it, not by driving through it
      const within = Math.abs(delta(s, gate.s, this.spline.length, this.spline.closed)) < 15
        && Math.abs(lateral) < halfWidth + 6;
      if (!within) {
        if (this.stopDwell > 0) events.push({ type: 'stop-cleared' });
        this.stopDwell = 0;
        return events;
      }
      if (car.speed > STOP_SPEED) {
        if (this.stopDwell === 0) events.push({ type: 'stop-required', index: this.nextCheckpoint });
        this.stopDwell = 0;
        return events;
      }
      this.stopDwell += dt;
      if (this.stopDwell < STOP_SECONDS) return events;
      this.stopDwell = 0;
      events.push(...this.clear(this.nextCheckpoint));
      return events;
    }

    // a driving gate is cleared when progress passes its arc length going forward, on the road
    if (moved <= 0 || Math.abs(lateral) > halfWidth + OFF_TRACK_MARGIN) return events;
    const before = delta(this.lastS, gate.s, this.spline.length, this.spline.closed);
    const after = delta(s, gate.s, this.spline.length, this.spline.closed);
    if (before > 0 && after <= 0) events.push(...this.clear(this.nextCheckpoint));
    return events;
  }

  private clear(index: number): RaceEvent[] {
    const events: RaceEvent[] = [{ type: 'checkpoint', index }];
    this.lastCleared = index;
    this.safeAhead = 0;
    this.safeRun = null;
    const cps = this.track.checkpoints;

    if (this.track.mode === 'loop') {
      this.nextCheckpoint = (index + 1) % cps.length;
      if (index !== 0) return events;
      // back across the start line: another lap, or the end of the race
      if (this.lap < this.totalLaps) {
        this.lap++;
        events.push({ type: 'lap', lap: this.lap });
      } else {
        this.state = 'finished';
        events.push({ type: 'finish', time: this.time });
      }
      return events;
    }

    this.nextCheckpoint = index + 1;
    if (this.nextCheckpoint >= cps.length) {
      this.state = 'finished';
      events.push({ type: 'finish', time: this.time });
    }
    return events;
  }
}

/** Best time for a track, in seconds, or null when there is none yet. */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Equivalent body radius rewards size without making giants overwhelm the whole run. */
export function slimePoints(scale: readonly number[]): number {
  return Math.max(1, Math.round(100 * Math.cbrt(scale[0]! * scale[1]! * scale[2]!)));
}
