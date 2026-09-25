import { musicSamples, RACE_MUSIC_RATE, RACE_PIECES } from './music';
import { IDLE_HZ, approach, brakeLevel, clamp, scrubLevel } from './curves';
import { ENGINE_VOICES, voiceHz, voiceHzFromRpm, voiceLevel } from './voices';
import type { Weather } from '../world/Sky';

export interface AudioState {
  /** m/s */
  speed: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** slip angle in radians; the sign says which way, only the size is audible */
  slip: number;
  grounded: boolean;
  /** The live car powertrain owns this value; audio and HUD only display it. */
  rpmFraction?: number;
  /** collision strength 0..1, present only on the frame of a hit */
  impact?: number;
  /** continuous guardrail rub strength, zero as soon as contact ends */
  scrape?: number;
  /** Current slime surface under the tyres. */
  surface?: string;
}

export type UiSound = 'move' | 'confirm' | 'back' | 'countdown' | 'go' | 'finish' | 'clean-corner' | 'star' | 'record';
export type SlimeSound = 'popper' | 'slick' | 'burst' | 'boost' | 'colossus' | 'gurgle'
  | 'fall';
export type SlimeSoundPhase = 'enter' | 'exit' | 'impact';

interface SlimeVoice {
  filter: BiquadFilterType;
  oscillator: OscillatorType;
  hz: number;
  q: number;
  noise: number;
  tone: number;
  from: number;
  to: number;
  decay: number;
}

const SLIME_VOICES: Record<SlimeSound, SlimeVoice> = {
  popper: { filter: 'bandpass', oscillator: 'triangle', hz: 1050, q: .75,
    noise: .14, tone: .07, from: 210, to: 78, decay: .13 },
  slick: { filter: 'bandpass', oscillator: 'triangle', hz: 980, q: 2.7,
    noise: .035, tone: .13, from: 168, to: 690, decay: .27 },
  burst: { filter: 'lowpass', oscillator: 'sine', hz: 720, q: .7,
    noise: .24, tone: .19, from: 105, to: 42, decay: .30 },
  boost: { filter: 'bandpass', oscillator: 'sine', hz: 1480, q: 1.4,
    noise: .07, tone: .065, from: 330, to: 660, decay: .32 },
  colossus: { filter: 'lowpass', oscillator: 'sine', hz: 430, q: .8,
    noise: .27, tone: .24, from: 68, to: 25, decay: .52 },
  gurgle: { filter: 'bandpass', oscillator: 'sine', hz: 360, q: 1.8,
    noise: .10, tone: .075, from: 82, to: 132, decay: .24 },
  fall: { filter: 'lowpass', oscillator: 'sine', hz: 470, q: .7,
    noise: .13, tone: .09, from: 86, to: 38, decay: .24 },
};

/** The renderer and tests share one voice calculation: large bodies are lower and last longer. */
export function slimeVoice(kind: SlimeSound, phase: SlimeSoundPhase, level: number): SlimeVoice {
  const base = SLIME_VOICES[kind];
  const size = clamp(level, 0, 1);
  const pitch = 1.17 - size * .28;
  const phaseShape = phase === 'enter'
    ? { hz: .76, from: .72, to: 1.14, noise: 1.12, tone: .82, decay: 1.34 }
    : phase === 'exit'
      ? { hz: 1.30, from: 1.42, to: .66, noise: 1.42, tone: 1.18, decay: .78 }
      : { hz: 1, from: 1, to: 1, noise: 1, tone: 1, decay: 1 };
  return { ...base, hz: base.hz * pitch * phaseShape.hz,
    from: base.from * pitch * phaseShape.from,
    to: base.to * pitch * phaseShape.to,
    noise: base.noise * phaseShape.noise,
    tone: base.tone * phaseShape.tone,
    decay: base.decay * (.84 + size * .42) * phaseShape.decay };
}

export interface GameAudioOptions {
  /** Starting master volume, 0..1. */
  masterVolume?: number;
  /**
   * Where the AudioContext comes from. Returning null means this environment has no audio, which
   * is the normal case in a test and must be as quiet as it is harmless.
   */
  contextFactory?: () => AudioContext | null;
}

/** One tone of an interface sound. */
interface Blip {
  hz: number;
  dur: number;
  /** slide to this frequency over dur */
  to?: number;
  /** offset from the start of the sound, seconds */
  at?: number;
  gain?: number;
  type?: OscillatorType;
}

/**
 * Interface sounds, as short tones rather than samples.
 *
 * Menus are the one place a wrong sound is unbearable, so these are deliberately plain: a rise for
 * yes, a fall for no, and a third above the countdown beep for the flag drop so that "go" is heard
 * as the resolution of the three that came before it.
 */
const UI_SOUNDS: Record<UiSound, Blip[]> = {
  move: [{ hz: 620, dur: 0.05, gain: 0.12 }],
  confirm: [{ hz: 660, dur: 0.07, gain: 0.16 }, { hz: 990, at: 0.055, dur: 0.14, gain: 0.16 }],
  back: [{ hz: 520, to: 300, dur: 0.13, gain: 0.14 }],
  countdown: [{ hz: 700, dur: 0.2, gain: 0.22, type: 'square' }],
  go: [{ hz: 1050, dur: 0.5, gain: 0.26, type: 'square' }],
  'clean-corner': [
    { hz: 740, dur: .08, gain: .15 }, { hz: 1110, at: .07, dur: .18, gain: .2 },
  ],
  star: [{ hz: 880, to: 1320, dur: .16, gain: .16 }],
  // A personal best deserves its own fanfare, a step above the finish chime.
  record: [
    { hz: 784, dur: .12, gain: .2 }, { hz: 1047, at: .1, dur: .12, gain: .2 },
    { hz: 1319, at: .2, dur: .16, gain: .22 }, { hz: 1568, at: .34, dur: .62, gain: .24 },
  ],
  finish: [
    { hz: 660, dur: 0.13, gain: 0.2 },
    { hz: 880, at: 0.12, dur: 0.13, gain: 0.2 },
    { hz: 1320, at: 0.24, dur: 0.5, gain: 0.22 },
  ],
};

/** Exponential ramps cannot reach zero, so this stands in for silence. */
const SILENT = 0.0001;

/** Seconds of noise in the loop. Long enough that the loop point is not a rhythm of its own. */
const NOISE_SECONDS = 2;

/** How fast the engine fades out when the car stops being live. Short, but not a click. */
const ENGINE_STOP_GLIDE = 0.06;

/** How fast the engine note chases the speed it is being told about. */
const ENGINE_GLIDE = 0.07;

/** Tyres let go faster than they hook back up. */
const SCRUB_ATTACK = 0.05;
const SCRUB_RELEASE = 0.18;
const METAL_SCRAPE_ATTACK = 0.025;
const METAL_SCRAPE_RELEASE = 0.075;

/** Smoothing applied inside WebAudio on top of ours, purely to kill zipper noise between frames. */
const PARAM_GLIDE = 0.02;

const ENGINE_IDLE_GAIN = 0.06;
const SCRUB_GAIN = 0.34;
const METAL_SCRAPE_GAIN = 0.30;

/** Below this an impact is a scrape, and no closer together than this or a scrape machine-guns. */
const IMPACT_FLOOR = 0.03;
const IMPACT_GAP = 0.08;

/** A frame after the tab comes back carries an enormous dt; letting it through snaps everything. */
const MAX_DT = 0.1;

/** The nodes that live for the whole session, as opposed to the one-shots a crash or a menu makes. */
interface Graph {
  master: GainNode;
  limiter: DynamicsCompressorNode;
  effects: GainNode;
  music: GainNode;
  /** One gain per loop under `music`: index 0 the menu loop, then one per race piece. */
  pieces: GainNode[];
  /** The playing loop per piece; race loops stay null until they are synthesised. */
  loops: (AudioBufferSourceNode | null)[];
  engine: GainNode;
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  intake: BiquadFilterNode;
  intakeGain: GainNode;
  scrubFilter: BiquadFilterNode;
  scrubGain: GainNode;
  metalFilter: BiquadFilterNode;
  metalGain: GainNode;
  rainFilter: BiquadFilterNode;
  rainGain: GainNode;
  noise: AudioBuffer;
  sources: AudioScheduledSourceNode[];
}

/**
 * Everything the game makes a sound with, synthesised.
 *
 * Vehicle voices share two oscillators and filtered intake noise. Electric motors use clean
 * harmonics without gear shifts; combustion engines have distinct registers and waveforms.
 *
 * The class is built to survive having no audio at all. Without an AudioContext — Node, jsdom, or a
 * browser that refuses one — it constructs, every method is a no-op, and `running` is false, so the
 * game loop never has to ask whether sound exists.
 */
export class GameAudio {
  private readonly factory: (() => AudioContext | null) | null;
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  /** The saved clip's copy of what the speakers play; made the first time a clip asks. */
  private recordTap: MediaStreamAudioDestinationNode | null = null;
  private volumeLevel: number;
  private mutedFlag = false;
  private musicLevel = 0.5;
  private piece = 0;
  private racePiece = -1;
  private inRace = false;
  private idleMusic: ReturnType<typeof setTimeout> | null = null;
  private effectsLevel = 1;
  private musicSceneLevel = 0.65;
  private engineOn = true;
  private voice = ENGINE_VOICES['sports-car']!;
  private hz = IDLE_HZ;
  private scrub = 0;
  private metalScrape = 0;
  private lastImpact = Number.NEGATIVE_INFINITY;
  private impactCount = 0;
  private weather: Weather = 'clear';
  private thunderCount = 0;
  private readonly slimeCounts = Object.fromEntries(
    (['popper', 'slick', 'burst', 'boost', 'colossus', 'gurgle', 'fall'] as const)
      .map((kind) => [kind, 0]),
  ) as Record<SlimeSound, number>;
  private readonly slimePhases = Object.fromEntries(Object.keys(SLIME_VOICES).map(kind => [kind,
    { enter: 0, exit: 0, impact: 0 }])) as Record<SlimeSound, Record<SlimeSoundPhase, number>>;

  constructor(opts: GameAudioOptions = {}) {
    this.volumeLevel = clamp(opts.masterVolume ?? 0.7, 0, 1);
    this.factory = opts.contextFactory ?? browserContext();
  }

  /**
   * Create the context if there is not one yet, and resume it.
   *
   * Has to be called from a user gesture the first time. Calling it again is free and is the right
   * thing to do on every tap: Safari hands back a context that claims to be running and stays
   * silent until a resume inside a gesture, so there is no state worth branching on here.
   */
  async unlock(): Promise<void> {
    const ctx = this.ensure();
    if (!ctx) return;
    try {
      await ctx.resume();
    } catch {
      // Resume rejects when it is called outside a gesture. The next tap gets it.
    }
  }

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** The engine note as it currently sounds, in hertz. Smoothed, so it lags `state.speed`. */
  get engineNote(): number {
    return this.hz;
  }

  /** How loud the tyres currently are, 0..1. */
  get scrubAmount(): number {
    return this.scrub;
  }

  get metalScrapeAmount(): number {
    return this.metalScrape;
  }

  get impactSoundCount(): number { return this.impactCount; }
  get thunderSoundCount(): number { return this.thunderCount; }
  get weatherSound(): Weather { return this.weather; }

  /** Weather is stored even before the first user gesture creates an AudioContext. */
  setWeather(weather: Weather): void {
    this.weather = weather;
    if (this.graph && this.ctx) {
      this.graph.rainGain.gain.setTargetAtTime(weather === 'rain' ? .16 : 0,
        this.ctx.currentTime, .22);
    }
  }

  /** One low, broadband thunderclap paired with the sky's first lightning frame. */
  thunder(strength = 1): void {
    if (this.weather !== 'rain') return;
    this.thunderCount++;
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = g.noise;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass'; low.frequency.value = 620; low.Q.value = .5;
    const noiseGain = ctx.createGain();
    envelope(noiseGain.gain, t, .34 * clamp(strength, .2, 1), .015, 1.25);
    noise.connect(low).connect(noiseGain).connect(g.effects);
    const body = ctx.createOscillator();
    body.type = 'sine'; body.frequency.setValueAtTime(74, t);
    body.frequency.exponentialRampToValueAtTime(28, t + .85);
    const bodyGain = ctx.createGain();
    envelope(bodyGain.gain, t, .24 * clamp(strength, .2, 1), .025, .9);
    body.connect(bodyGain).connect(g.effects);
    noise.start(t); noise.stop(t + 1.5); body.start(t); body.stop(t + 1.1);
  }

  get slimeSoundCounts(): Readonly<Record<SlimeSound, number>> {
    return { ...this.slimeCounts };
  }

  get slimeSoundPhaseCounts(): Readonly<Record<SlimeSound, Readonly<Record<SlimeSoundPhase, number>>>> {
    return Object.fromEntries(Object.entries(this.slimePhases)
      .map(([kind, phases]) => [kind, { ...phases }])) as Record<SlimeSound, Record<SlimeSoundPhase, number>>;
  }

  /**
   * Turn the engine on or off.
   *
   * `update` is only called while the car is live, so without this the oscillators simply stay at
   * whatever gain they had when the game stopped calling it: pause a race at full throttle and the
   * engine howls at that note behind the pause menu until the race resumes. Nothing about the graph
   * is torn down -- the oscillators are free-running and restarting them clicks -- the engine, its
   * intake and the tyres are just faded out.
   */
  setEngineRunning(on: boolean): void {
    if (on === this.engineOn) return;
    this.engineOn = on;
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx || on) return;
    const now = ctx.currentTime;
    for (const node of [g.engine, g.intakeGain, g.scrubGain, g.metalGain]) {
      node.gain.cancelScheduledValues(now);
      node.gain.setTargetAtTime(0, now, ENGINE_STOP_GLIDE);
    }
    this.scrub = 0;
    this.metalScrape = 0;
  }

  /** Called with the resolved garage vehicle on every successful start, including restarts. */
  setVehicle(id: string): void {
    this.voice = ENGINE_VOICES[id] ?? ENGINE_VOICES['micro-hatch']!;
    this.hz = this.voice.idle;
    if (this.graph) {
      this.graph.oscA.type = this.voice.wave;
      this.graph.oscB.type = this.voice.subWave;
      this.graph.oscA.detune.value = -this.voice.detune;
      this.graph.oscB.detune.value = this.voice.detune;
    }
  }

  /** One frame. Cheap enough to call before unlock, when it does nothing at all. */
  update(dt: number, state: AudioState): void {
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const step = clamp(dt, 0, MAX_DT);
    const now = ctx.currentTime;

    const voice = this.voice;
    let target = state.rpmFraction === undefined
      ? voiceHz(voice, state.speed, state.throttle)
      : voiceHzFromRpm(voice, state.rpmFraction, state.throttle);
    this.hz += (target - this.hz) * approach(step, ENGINE_GLIDE);

    g.oscA.frequency.setTargetAtTime(this.hz, now, PARAM_GLIDE);
    g.oscB.frequency.setTargetAtTime(this.hz * voice.ratio, now, PARAM_GLIDE);
    // Sweeping the noise band with the note is what turns two saws into something with air moving
    // through it; held still it reads as a synth pad sitting behind the engine.
    g.intake.frequency.setTargetAtTime(clamp(this.hz * 4, 120, 5000), now, PARAM_GLIDE);

    const load = clamp(state.throttle, 0, 1);
    const revs = clamp((this.hz - voice.idle) / (voice.redline - voice.idle), 0, 1);
    g.engine.gain.setTargetAtTime((ENGINE_IDLE_GAIN + revs * 0.10 + load * 0.20) * voiceLevel(voice, state.speed), now, 0.05);
    g.intakeGain.gain.setTargetAtTime((0.05 + load * 0.14) * voice.intake, now, 0.05);

    const slide = scrubLevel(state.slip, state.speed, state.grounded);
    const braking = brakeLevel(state.brake, state.speed, state.grounded);
    const wanted = Math.max(slide, braking);
    this.scrub += (wanted - this.scrub) * approach(step, wanted > this.scrub ? SCRUB_ATTACK : SCRUB_RELEASE);
    g.scrubGain.gain.setTargetAtTime(this.scrub * SCRUB_GAIN, now, PARAM_GLIDE);
    // A tyre going further past its limit squeals higher, not just louder.
    g.scrubFilter.frequency.setTargetAtTime(900 + 900 * this.scrub + 380 * braking, now, PARAM_GLIDE);

    // Sparks and sound read the same per-step wall rub. A high narrow noise band supplies the
    // continuous metal scrape; its fast release makes leaving the rail audibly immediate.
    const metal = clamp(state.scrape ?? 0, 0, 1);
    this.metalScrape += (metal - this.metalScrape)
      * approach(step, metal > this.metalScrape ? METAL_SCRAPE_ATTACK : METAL_SCRAPE_RELEASE);
    g.metalGain.gain.setTargetAtTime(this.metalScrape * METAL_SCRAPE_GAIN, now, PARAM_GLIDE);
    g.metalFilter.frequency.setTargetAtTime(1550 + this.metalScrape * 2850, now, PARAM_GLIDE);

    const impact = state.impact ?? 0;
    if (impact > IMPACT_FLOOR && now - this.lastImpact > IMPACT_GAP) {
      this.lastImpact = now;
      this.impactCount++;
      this.crash(ctx, g, clamp(impact, 0, 1));
    }
  }

  ui(kind: UiSound): void {
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const now = ctx.currentTime;
    for (const note of UI_SOUNDS[kind]) this.blip(ctx, g.effects, note, now);
  }

  /** One wet body sound. Enter, exit and centre impact are deliberately separate events. */
  slime(kind: SlimeSound, strength = 1, phase: SlimeSoundPhase = 'impact'): void {
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx || strength <= 0) return;
    const level = clamp(strength, 0, 1);
    this.slimeCounts[kind]++;
    this.slimePhases[kind][phase]++;
    const t = ctx.currentTime;
    const shape = slimeVoice(kind, phase, level);
    const punch = phase === 'exit' ? 1.38 : phase === 'enter' ? 1.18
      : kind === 'burst' ? 1.28 : 1;
    const burst = ctx.createBufferSource();
    burst.buffer = g.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = shape.filter;
    filter.frequency.value = shape.hz;
    filter.Q.value = shape.q;
    const gain = ctx.createGain();
    envelope(gain.gain, t, shape.noise * punch * (0.55 + level * 0.45), 0.004, shape.decay);
    burst.connect(filter).connect(gain).connect(g.effects);
    burst.start(t);
    burst.stop(t + shape.decay + 0.06);

    const body = ctx.createOscillator();
    body.type = shape.oscillator;
    body.frequency.setValueAtTime(shape.from, t);
    body.frequency.exponentialRampToValueAtTime(shape.to, t + shape.decay);
    const bodyGain = ctx.createGain();
    envelope(bodyGain.gain, t, shape.tone * punch * (0.6 + level * 0.4), 0.006, shape.decay);
    body.connect(bodyGain).connect(g.effects);
    body.start(t);
    body.stop(t + shape.decay + 0.07);

    if (phase === 'enter') {
      // Two offset bubbles turn the low wet sweep into a short rolling plunge rather than one note.
      this.blip(ctx, g.effects, { hz: shape.from * 1.08, to: shape.from * .72,
        at: .035, dur: .10 + level * .05, gain: .055 + level * .025, type: 'sine' }, t);
      this.blip(ctx, g.effects, { hz: shape.from * .82, to: shape.from * 1.03,
        at: .11, dur: .12 + level * .06, gain: .048 + level * .022, type: 'sine' }, t);
    }

    if (kind === 'boost' && phase === 'enter') {
      // A short major arpeggio reads as a reward and stays musical even when the engine is loud.
      for (const note of [
        { hz: 659.25, dur: 0.28, gain: 0.10, type: 'sine' as OscillatorType },
        { hz: 830.61, at: 0.07, dur: 0.30, gain: 0.09, type: 'sine' as OscillatorType },
        { hz: 987.77, at: 0.14, dur: 0.34, gain: 0.085, type: 'sine' as OscillatorType },
      ]) this.blip(ctx, g.effects, note, t);
    }

    if (kind === 'slick' && phase !== 'enter') {
      // A quick up-down-up pitch wobble reads as a comic metal spring. It fires on the contact
      // and again, more lightly, when the elastic body separates from the vehicle.
      const gain = phase === 'impact' ? .105 + level * .055 : .055 + level * .035;
      for (const note of [
        { hz: 230, to: 760, dur: .10, gain, type: 'triangle' as OscillatorType },
        { hz: 720, to: 315, at: .085, dur: .12, gain: gain * .82, type: 'triangle' as OscillatorType },
        { hz: 330, to: 610, at: .19, dur: .09, gain: gain * .58, type: 'sine' as OscillatorType },
      ]) this.blip(ctx, g.effects, note, t);
    }

    if (kind === 'burst' && phase === 'impact') {
      // A separate bright crack keeps the explosion readable over its low body and the engine.
      const crack = ctx.createBufferSource();
      crack.buffer = g.noise;
      const high = ctx.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 1450;
      const crackGain = ctx.createGain();
      envelope(crackGain.gain, t, .15 * (.55 + level * .45), .001, .075);
      crack.connect(high).connect(crackGain).connect(g.effects);
      crack.start(t); crack.stop(t + .1);
      const thump = ctx.createOscillator(); thump.type = 'sine';
      thump.frequency.setValueAtTime(58 - level * 12, t);
      thump.frequency.exponentialRampToValueAtTime(22, t + .42);
      const thumpGain = ctx.createGain();
      envelope(thumpGain.gain, t, .16 + level * .10, .003, .42);
      thump.connect(thumpGain).connect(g.effects);
      thump.start(t); thump.stop(t + .48);
    }

    if (kind === 'colossus') {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(42, t);
      sub.frequency.exponentialRampToValueAtTime(21, t + 0.56);
      const subGain = ctx.createGain();
      envelope(subGain.gain, t, 0.13 + level * 0.10, 0.012, 0.56);
      sub.connect(subGain).connect(g.effects);
      sub.start(t);
      sub.stop(t + 0.65);
    }
  }

  setMix(music: number, effects: number): void {
    this.musicLevel = clamp(music, 0, 1);
    this.effectsLevel = clamp(effects, 0, 1);
    this.applyMix();
  }

  /**
   * Change gain on the continuing loops; never restart music at a page boundary. A countdown that
   * follows anything but a race scene is a new race, and a new race moves on to the next race piece
   *Restarting from pause keeps the piece. The menu brings its own loop back.
   */
  setScene(scene: string): void {
    // A race has started once its countdown or racing screen has been shown. Pause and settings keep
    // whatever was playing, so pausing on the intro and choosing restart is still the start of a new
    // race, while pausing mid-race and restarting is not.
    if (scene === 'countdown' && !this.inRace) {
      this.racePiece = (this.racePiece + 1) % RACE_PIECES.length;
      this.renderPiece(this.racePiece + 1);
    }
    if (scene === 'countdown' || scene === 'racing') { this.inRace = true; this.piece = this.racePiece + 1; }
    else if (scene !== 'paused' && scene !== 'settings') {
      this.inRace = false;
      if (scene !== 'results') this.piece = 0;
    }
    this.applyPiece();
    this.musicSceneLevel = scene === 'racing' ? 0.24
      : scene === 'paused' || scene === 'settings' ? 0.18
        : scene === 'countdown' || scene === 'boot' ? 0.32 : 0.65;
    this.applyMix();
  }

  /** Which loop is audible: index 0 the menu, 1.. the race pieces. */
  get musicPiece(): string { return this.piece === 0 ? 'menu' : RACE_PIECES[this.piece - 1]!.id; }

  /**
   * Synthesise one race loop and start it silently, if it is not playing yet. The menu loop is built
   * with the graph; race loops come one per idle turn after unlock, or right away when a countdown
   * needs one first -- rendering all three inside the first tap froze a phone for most of a second.
   */
  private renderPiece(index: number): void {
    const graph = this.graph, ctx = this.ctx;
    if (!graph || !ctx || index < 1 || graph.loops[index]) return;
    const samples = RACE_PIECES[index - 1]!.render(RACE_MUSIC_RATE);
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, samples.length, RACE_MUSIC_RATE);
    source.buffer.getChannelData(0).set(samples);
    source.loop = true;
    source.connect(graph.pieces[index]!);
    source.start();
    graph.loops[index] = source;
    graph.sources.push(source);
  }

  private renderIdlePieces = (): void => {
    const next = this.graph?.loops.findIndex((loop, index) => index > 0 && !loop) ?? -1;
    if (next < 1) return;
    this.renderPiece(next);
    this.idleMusic = setTimeout(this.renderIdlePieces, 400);
  };

  private applyPiece(): void {
    if (!this.graph || !this.ctx) return;
    this.graph.pieces.forEach((gain, index) =>
      gain.gain.setTargetAtTime(index === this.piece ? 1 : 0, this.ctx!.currentTime, 0.6));
  }

  private applyMix(): void {
    if (!this.graph || !this.ctx) return;
    this.graph.music.gain.setTargetAtTime(this.musicLevel * this.musicSceneLevel, this.ctx.currentTime, 0.25);
    this.graph.effects.gain.setTargetAtTime(this.effectsLevel, this.ctx.currentTime, PARAM_GLIDE);
  }

  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    this.applyGain();
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** Set the volume. Doing this while muted stores it and stays silent, rather than unmuting. */
  setVolume(v: number): void {
    this.volumeLevel = clamp(v, 0, 1);
    this.applyGain();
  }

  get volume(): number {
    return this.volumeLevel;
  }

  /**
   * The game's sound as a track a video recording can carry. Tapped after the limiter, so volume,
   * mute and the hidden-tab silence reach the clip exactly as they reach the speakers: volume 0 records a
   * silent clip. Null while the context is not running -- a recorder fed an audio track that has stopped
   * delivering wrote a WebKit mp4 whose timestamps claimed 83 days, so a clip must
   * never be handed one.
   */
  recordingTrack(): MediaStreamTrack | null {
    const ctx = this.ctx, g = this.graph;
    if (!ctx || !g || !this.running || typeof ctx.createMediaStreamDestination !== 'function') return null;
    if (!this.recordTap) {
      this.recordTap = ctx.createMediaStreamDestination();
      g.limiter.connect(this.recordTap);
    }
    return this.recordTap.stream.getAudioTracks()[0] ?? null;
  }

  dispose(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    if (this.idleMusic) { clearTimeout(this.idleMusic); this.idleMusic = null; }
    const g = this.graph;
    this.graph = null;
    this.recordTap = null;
    if (g) {
      for (const s of g.sources) {
        try {
          s.stop();
        } catch {
          // Stopping a source that never started throws; there is nothing to do about it.
        }
      }
      g.master.disconnect();
    }
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) {
      try {
        void ctx.close().catch(() => undefined);
      } catch {
        // Safari throws rather than rejecting when the context is already gone.
      }
    }
  }

  /**
   * Safari suspends the context when the tab goes into the background and does not reliably bring
   * it back, so a game that has been away returns silent forever unless something resumes it here.
   */
  private readonly onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    this.applyGain();
    if (document.visibilityState !== 'visible') return;
    // Not a test for 'suspended': iOS Safari parks the context in a non-standard 'interrupted'
    // state after a phone call or a lock, and that one needs the same resume.
    if (ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
  };

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (!this.factory) return null;
    let ctx: AudioContext | null;
    try { ctx = this.factory(); } catch { return null; }
    if (!ctx) return null;
    this.ctx = ctx;
    this.graph = this.build(ctx);
    // A race that was chosen before the first tap still needs its loop; the rest follow idly.
    if (this.piece > 0) this.renderPiece(this.piece);
    this.applyPiece();
    this.applyGain();
    this.applyMix();
    this.idleMusic = setTimeout(this.renderIdlePieces, 1500);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    return ctx;
  }

  private applyGain(): void {
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    // A ramp rather than a jump: a step change in gain is a click, and mute is the button most
    // likely to be pressed while the engine is loud.
    g.master.gain.setTargetAtTime(this.mutedFlag || (typeof document !== 'undefined' && document.hidden) ? 0 : this.volumeLevel, ctx.currentTime, PARAM_GLIDE);
  }

  private build(ctx: AudioContext): Graph {
    // Master is built first so everything else has something to connect to, and it starts at zero
    // so that unlocking mid-race fades in instead of banging.
    const master = ctx.createGain();
    master.gain.value = 0;
    // The engine, the tyres and a crash can all peak together, and the sum of three sounds each
    // mixed to sound right alone is a clipped one. The limiter is what lets them be mixed alone.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(ctx.destination);

    const effects = ctx.createGain();
    effects.connect(master);
    const music = ctx.createGain();
    music.gain.value = 0;
    music.connect(master);
    const pieces = [null, ...RACE_PIECES].map((_, index) => {
      const gain = ctx.createGain();
      gain.gain.value = index === this.piece ? 1 : 0;
      gain.connect(music);
      return gain;
    });
    const menuSamples = musicSamples(ctx.sampleRate);
    const score = ctx.createBufferSource();
    score.buffer = ctx.createBuffer(1, menuSamples.length, ctx.sampleRate);
    score.buffer.getChannelData(0).set(menuSamples);
    score.loop = true;
    score.connect(pieces[0]!);
    const loops: (AudioBufferSourceNode | null)[] = [score, ...RACE_PIECES.map(() => null)];

    const noise = this.makeNoise(ctx);

    const engine = ctx.createGain();
    engine.gain.value = this.engineOn ? ENGINE_IDLE_GAIN * voiceLevel(this.voice, 0) : 0;
    engine.connect(effects);

    // The selected voice owns the harmonic pair; changing cars reuses these session nodes.
    const oscA = ctx.createOscillator();
    oscA.type = this.voice.wave;
    oscA.frequency.value = this.voice.idle;
    oscA.detune.value = -this.voice.detune;
    const gainA = ctx.createGain();
    gainA.gain.value = 0.5;
    oscA.connect(gainA).connect(engine);

    const oscB = ctx.createOscillator();
    oscB.type = this.voice.subWave;
    oscB.frequency.value = this.voice.idle * this.voice.ratio;
    oscB.detune.value = this.voice.detune;
    const gainB = ctx.createGain();
    gainB.gain.value = 0.42;
    oscB.connect(gainB).connect(engine);

    const intakeSource = ctx.createBufferSource();
    intakeSource.buffer = noise;
    intakeSource.loop = true;
    const intake = ctx.createBiquadFilter();
    intake.type = 'bandpass';
    intake.Q.value = 0.8;
    intake.frequency.value = IDLE_HZ * 4;
    const intakeGain = ctx.createGain();
    intakeGain.gain.value = 0.05;
    intakeSource.connect(intake).connect(intakeGain).connect(engine);

    // Tyres are the same noise through a much narrower band, and they hang off master rather than
    // off the engine bus so that lifting off does not quieten a slide that is still happening.
    const scrubSource = ctx.createBufferSource();
    scrubSource.buffer = noise;
    scrubSource.loop = true;
    const scrubFilter = ctx.createBiquadFilter();
    scrubFilter.type = 'bandpass';
    scrubFilter.Q.value = 1.4;
    scrubFilter.frequency.value = 900;
    const scrubGain = ctx.createGain();
    scrubGain.gain.value = 0;
    scrubSource.connect(scrubFilter).connect(scrubGain).connect(effects);

    const metalSource = ctx.createBufferSource();
    metalSource.buffer = noise;
    metalSource.loop = true;
    const metalFilter = ctx.createBiquadFilter();
    metalFilter.type = 'bandpass';
    metalFilter.Q.value = 4.2;
    metalFilter.frequency.value = 1550;
    const metalGain = ctx.createGain();
    metalGain.gain.value = 0;
    metalSource.connect(metalFilter).connect(metalGain).connect(effects);

    // The same noise buffer becomes rain through a wide high band. Its source is permanent so
    // changing weather is a click-free gain ramp and costs no downloaded sample.
    const rainSource = ctx.createBufferSource();
    rainSource.buffer = noise;
    rainSource.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass'; rainFilter.frequency.value = 3600; rainFilter.Q.value = .35;
    const rainGain = ctx.createGain();
    rainGain.gain.value = this.weather === 'rain' ? .16 : 0;
    rainSource.connect(rainFilter).connect(rainGain).connect(effects);

    const sources: AudioScheduledSourceNode[] = [oscA, oscB, intakeSource, scrubSource, metalSource,
      rainSource, score];
    // Starting them on a suspended context is fine: they begin when it does, and starting them
    // lazily instead would mean a first note that arrives after the first frame of throttle.
    for (const s of sources) s.start();

    return { master, limiter, effects, music, pieces, loops, engine, oscA, oscB, intake, intakeGain, scrubFilter, scrubGain,
      metalFilter, metalGain, rainFilter, rainGain, noise, sources };
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const frames = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // White noise is all treble and reads as tape hiss whatever is done to it afterwards. One pole
    // of integration tilts it toward the low end, which is what tyres and exhaust actually are.
    let last = 0;
    for (let i = 0; i < frames; i++) {
      last = (last + 0.045 * (Math.random() * 2 - 1)) / 1.045;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  /**
   * A hit is two sounds at once: the crack of the bodywork, which is broadband and gone in a blink,
   * and the weight of the car behind it, which is almost pure low frequency. The crack alone is
   * static; the weight alone is a door closing in another room.
   */
  private crash(ctx: AudioContext, g: Graph, strength: number): void {
    const t = ctx.currentTime;
    const level = 0.2 + 0.5 * strength;

    const burst = ctx.createBufferSource();
    burst.buffer = g.noise;
    const shape = ctx.createBiquadFilter();
    shape.type = 'lowpass';
    // A harder hit is brighter as well as louder, which is most of how the strength reads.
    shape.frequency.value = 700 + 3200 * strength;
    const burstGain = ctx.createGain();
    const decay = 0.06 + 0.16 * strength;
    envelope(burstGain.gain, t, level, 0.003, decay);
    burst.connect(shape).connect(burstGain).connect(g.effects);
    burst.start(t);
    burst.stop(t + decay + 0.05);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(90 + 60 * strength, t);
    // Pitching the thump down as it decays is what makes a crash read as heavy rather than as a drum.
    thud.frequency.exponentialRampToValueAtTime(34, t + 0.22);
    const thudGain = ctx.createGain();
    envelope(thudGain.gain, t, level * 0.9, 0.006, 0.24);
    thud.connect(thudGain).connect(g.effects);
    thud.start(t);
    thud.stop(t + 0.33);
  }

  private blip(ctx: AudioContext, master: GainNode, note: Blip, base: number): void {
    const t = base + (note.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = note.type ?? 'triangle';
    osc.frequency.setValueAtTime(note.hz, t);
    if (note.to !== undefined) osc.frequency.exponentialRampToValueAtTime(note.to, t + note.dur);
    const gain = ctx.createGain();
    envelope(gain.gain, t, note.gain ?? 0.16, 0.006, note.dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + note.dur + 0.05);
  }
}

/** Attack then decay on a gain, the shape every one-shot in here has. */
function envelope(param: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  param.cancelScheduledValues(t);
  param.setValueAtTime(SILENT, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(SILENT, t + attack + decay);
}

/**
 * The real constructor, or null where there is none.
 *
 * The webkit-prefixed name is still how older iOS gets one, and it is checked lazily rather than at
 * module load so that importing this file is safe anywhere.
 */
function browserContext(): (() => AudioContext) | null {
  const scope = globalThis as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return Ctor ? (): AudioContext => new Ctor() : null;
}
