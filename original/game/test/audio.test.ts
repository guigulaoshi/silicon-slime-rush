import { describe, expect, it, vi } from 'vitest';
import { GameAudio, slimeVoice, type AudioState } from '../src/audio/Audio';
import { GEAR_TOPS, IDLE_HZ, brakeLevel, engineHz, gearAt, revFraction, scrubLevel } from '../src/audio/curves';

/**
 * jsdom has no WebAudio at all, so the graph is faked.
 *
 * The fake is deliberately dumb: every scheduling call lands on the parameter immediately. That is
 * wrong as a model of WebAudio and right as a test, because GameAudio does its own smoothing in
 * JavaScript and the scheduling is only there to stop frame-rate zipper noise. What the parameter
 * ends up holding is therefore exactly the value the game asked for.
 */
class FakeParam {
  constructor(public value = 0) {}
  setValueAtTime(v: number): this { this.value = v; return this; }
  setTargetAtTime(v: number): this { this.value = v; return this; }
  linearRampToValueAtTime(v: number): this { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number): this { this.value = v; return this; }
  cancelScheduledValues(): this { return this; }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  connect(target: FakeNode): FakeNode { this.outputs.push(target); return target; }
  disconnect(): void { this.outputs.length = 0; }
}

class FakeGain extends FakeNode { readonly gain = new FakeParam(1); }

class FakeOsc extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  starts = 0;
  stops = 0;
  start(): void { this.starts++; }
  stop(): void { this.stops++; }
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  readonly gain = new FakeParam(0);
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  starts = 0;
  stops = 0;
  start(): void { this.starts++; }
  stop(): void { this.stops++; }
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
}

class FakeTap extends FakeNode {
  readonly track = { kind: 'audio' };
  readonly stream = { getAudioTracks: () => [this.track] };
}

class FakeContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  now = 0;
  readonly sampleRate = 48000;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly oscillators: FakeOsc[] = [];
  readonly filters: FakeFilter[] = [];
  readonly buffers: FakeSource[] = [];
  readonly compressors: FakeCompressor[] = [];
  resumes = 0;
  closes = 0;

  get currentTime(): number { return this.now; }
  createGain(): FakeGain { const n = new FakeGain(); this.gains.push(n); return n; }
  createOscillator(): FakeOsc { const n = new FakeOsc(); this.oscillators.push(n); return n; }
  createBiquadFilter(): FakeFilter { const n = new FakeFilter(); this.filters.push(n); return n; }
  createBufferSource(): FakeSource { const n = new FakeSource(); this.buffers.push(n); return n; }
  createDynamicsCompressor(): FakeCompressor {
    const n = new FakeCompressor(); this.compressors.push(n); return n;
  }
  createBuffer(_channels: number, frames: number): { getChannelData(): Float32Array } {
    const data = new Float32Array(frames);
    return { getChannelData: () => data };
  }
  readonly taps: FakeTap[] = [];
  createMediaStreamDestination(): FakeTap { const n = new FakeTap(); this.taps.push(n); return n; }
  resume(): Promise<void> { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  close(): Promise<void> { this.closes++; this.state = 'closed'; return Promise.resolve(); }
}

function harness(): { audio: GameAudio; made: FakeContext[]; factory: () => AudioContext | null } {
  const made: FakeContext[] = [];
  const factory = vi.fn((): AudioContext | null => {
    const ctx = new FakeContext();
    made.push(ctx);
    return ctx as unknown as AudioContext;
  });
  return { audio: new GameAudio({ contextFactory: factory }), made, factory };
}

const driving = (over: Partial<AudioState> = {}): AudioState =>
  ({ speed: 0, throttle: 1, brake: 0, slip: 0, grounded: true, ...over });

/** Run enough frames for the smoothed values to arrive, since one frame only covers part of the gap. */
function settle(audio: GameAudio, state: AudioState, frames = 120): void {
  for (let i = 0; i < frames; i++) audio.update(1 / 60, state);
}

/** The master gain is the first one the graph builds, which is what makes this index safe. */
const master = (ctx: FakeContext): FakeGain => ctx.gains[0]!;

describe('GameAudio without audio', () => {
  it('constructs, stays silent and never throws when there is no context to be had', () => {
    const audio = new GameAudio({ contextFactory: () => null });
    expect(audio.running).toBe(false);
    audio.update(1 / 60, driving({ speed: 30, impact: 1 }));
    audio.ui('go');
    audio.setMuted(true);
    audio.setVolume(0.5);
    expect(audio.volume).toBe(0.5);
    expect(audio.running).toBe(false);
    audio.dispose();
  });

  it('does nothing before unlock, on the real browser factory as well', () => {
    // jsdom has no AudioContext, so this exercises the default factory returning null too.
    const audio = new GameAudio();
    audio.update(1 / 60, driving({ speed: 20 }));
    expect(audio.running).toBe(false);
    audio.dispose();
  });
});

describe('unlock', () => {
  it('creates the context once and resumes it every time', async () => {
    const { audio, made, factory } = harness();
    await audio.unlock();
    expect(made.length).toBe(1);
    expect(made[0]!.resumes).toBe(1);
    expect(audio.running).toBe(true);

    await audio.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(made.length).toBe(1);
    // Resuming again is on purpose: Safari can report a running context that is still silent.
    expect(made[0]!.resumes).toBe(2);
  });

  it('builds two detuned sawtooth oscillators and starts the loops', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;
    const [a, b] = [ctx.oscillators[0]!, ctx.oscillators[1]!];
    expect(a.type).toBe('sawtooth');
    expect(b.type).toBe('sawtooth');
    expect(a.detune.value).toBe(-b.detune.value);
    expect(a.detune.value).not.toBe(0);
    expect(a.starts).toBe(1);
    // Five looping sources at unlock: menu music, intake, tyres, rail scrape and rain. The three race
    // loops are synthesised later, one per idle turn, not inside the first tap.
    expect(ctx.buffers.length).toBe(5);
    expect(ctx.buffers.every((s) => s.loop && s.starts === 1)).toBe(true);
  });

  it('keeps rain silent until weather asks for it and changes it without restarting loops', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;
    const rain = ctx.gains.at(-1)!;
    expect(rain.gain.value).toBe(0);
    audio.setWeather('rain');
    expect(rain.gain.value).toBe(.16);
    expect(ctx.buffers.every(source => source.starts === 1)).toBe(true);
    audio.setWeather('fog');
    expect(rain.gain.value).toBe(0);
  });

  it('resumes again when the page comes back into view', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;
    ctx.state = 'suspended';   // what Safari does to a backgrounded tab
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.resumes).toBe(2);
    audio.dispose();
    // The listener has to go with the object, or a disposed session keeps waking the context up.
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.resumes).toBe(2);
  });
});

describe('engine pitch', () => {
  it('idles at rest and climbs through a gear', () => {
    expect(engineHz(0, 0)).toBeCloseTo(IDLE_HZ * 0.94, 5);
    expect(engineHz(6, 1)).toBeGreaterThan(engineHz(3, 1));
    expect(engineHz(8, 1)).toBeGreaterThan(engineHz(6, 1));
  });

  it('drops on the upshift and climbs again', () => {
    const top = GEAR_TOPS[1]!;
    const beforeShift = engineHz(top - 0.2, 1);
    const afterShift = engineHz(top + 0.2, 1);
    expect(afterShift).toBeLessThan(beforeShift * 0.75);
    expect(engineHz(top + 4, 1)).toBeGreaterThan(afterShift);
    expect(gearAt(top - 0.2)).toBe(1);
    expect(gearAt(top + 0.2)).toBe(2);
    // Every gear starts partway up the rev range except the first, which pulls away from idle.
    expect(revFraction(0)).toBe(0);
    expect(revFraction(top + 0.001)).toBeGreaterThan(0.4);
  });

  it('sits lower off the throttle than on it', () => {
    expect(engineHz(25, 0)).toBeLessThan(engineHz(25, 1));
  });

  it('reaches the oscillators, the sub an octave below', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;

    settle(audio, driving({ speed: 4 }));
    const slow = audio.engineNote;
    expect(ctx.oscillators[0]!.frequency.value).toBeCloseTo(slow, 3);
    expect(ctx.oscillators[1]!.frequency.value).toBeCloseTo(slow / 2, 3);

    settle(audio, driving({ speed: 8 }));
    expect(audio.engineNote).toBeGreaterThan(slow);

    // Across a gear change the note has to fall, which is the whole point of modelling gears.
    const top = GEAR_TOPS[2]!;
    settle(audio, driving({ speed: top - 0.5 }));
    const revving = audio.engineNote;
    settle(audio, driving({ speed: top + 0.5 }));
    expect(audio.engineNote).toBeLessThan(revving);
    expect(ctx.oscillators[0]!.frequency.value).toBeCloseTo(audio.engineNote, 3);
  });

  it('chases the limiter with the wheels off the ground', async () => {
    const { audio } = harness();
    await audio.unlock();
    settle(audio, driving({ speed: 12, grounded: true }));
    const planted = audio.engineNote;
    settle(audio, driving({ speed: 12, grounded: false }));
    expect(audio.engineNote).toBeGreaterThan(planted);
  });
});

describe('tyre scrub', () => {
  it('rises with slip, and is silent airborne or standing still', () => {
    expect(scrubLevel(0.02, 25, true)).toBe(0);
    expect(scrubLevel(0.5, 25, true)).toBeGreaterThan(scrubLevel(0.2, 25, true));
    expect(scrubLevel(0.5, 25, false)).toBe(0);
    expect(scrubLevel(0.5, 0, true)).toBe(0);
  });

  it('drives the scrub gain and shuts it off when the car leaves the ground', async () => {
    const { audio } = harness();
    await audio.unlock();
    // The scrub gain is the one part of the graph that is built silent: everything else is either
    // a fixed mixer level or the master, which unlock has already brought up.
    const scrubGain = (audio as any).graph.scrubGain as FakeGain;

    settle(audio, driving({ speed: 25, slip: 0.02 }));
    expect(audio.scrubAmount).toBeCloseTo(0, 4);

    settle(audio, driving({ speed: 25, slip: 0.2 }));
    const light = audio.scrubAmount;
    expect(light).toBeGreaterThan(0);

    settle(audio, driving({ speed: 25, slip: 0.5 }));
    expect(audio.scrubAmount).toBeGreaterThan(light);
    expect(scrubGain.gain.value).toBeGreaterThan(0);

    settle(audio, driving({ speed: 25, slip: 0.5, grounded: false }));
    expect(audio.scrubAmount).toBeCloseTo(0, 4);
    expect(scrubGain.gain.value).toBeCloseTo(0, 4);
  });

  it('uses the existing tyre voice for straight braking and stays quiet when stopped or airborne', async () => {
    expect(brakeLevel(1, 20, true)).toBeGreaterThan(brakeLevel(0.3, 20, true));
    expect(brakeLevel(1, 0, true)).toBe(0);
    expect(brakeLevel(1, 20, false)).toBe(0);
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;
    const sources = ctx.buffers.length;
    settle(audio, driving({ speed: 20, throttle: 0, brake: 1, slip: 0 }));
    expect(audio.scrubAmount).toBeGreaterThan(0.9);
    expect(ctx.buffers.length, 'braking reuses the scrub loop instead of adding another source')
      .toBe(sources);
    settle(audio, driving({ speed: 20, throttle: 0, brake: 1, grounded: false }));
    expect(audio.scrubAmount).toBeCloseTo(0, 4);
  });
});

describe('one-shots', () => {
  it('makes a filtered wet thud for a nearby falling slime', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;
    const oscs = ctx.oscillators.length;
    const sources = ctx.buffers.length;
    audio.slime('fall', 0.6);
    expect(ctx.oscillators.length).toBe(oscs + 1);
    expect(ctx.buffers.length).toBe(sources + 1);
    expect(ctx.filters.at(-1)?.type).toBe('lowpass');
  });

  it('gives every physical slime distinct enter and exit voices without audio files', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;
    const kinds = ['popper', 'slick', 'burst', 'boost', 'colossus'] as const;
    const signature = (kind: typeof kinds[number], phase: 'enter' | 'exit') => {
      const voice = slimeVoice(kind, phase, .7);
      return [voice.filter, voice.oscillator, Math.round(voice.hz), Math.round(voice.from),
        Math.round(voice.to), voice.decay.toFixed(3)].join(':');
    };
    expect(new Set(kinds.map(kind => signature(kind, 'enter'))).size).toBe(kinds.length);
    expect(new Set(kinds.map(kind => signature(kind, 'exit'))).size).toBe(kinds.length);
    for (const kind of kinds) {
      const sources = ctx.buffers.length;
      const oscs = ctx.oscillators.length;
      audio.slime(kind, .7, 'enter');
      expect(ctx.buffers.length).toBe(sources + 1);
      expect(ctx.filters.at(-1)?.type).toBe(slimeVoice(kind, 'enter', .7).filter);
      expect(ctx.oscillators.length).toBe(oscs + (kind === 'boost' ? 6 : kind === 'colossus' ? 4 : 3));
      audio.slime(kind, .7, 'exit');
      expect(audio.slimeSoundPhaseCounts[kind]).toMatchObject({ enter: 1, exit: 1 });
      expect(signature(kind, 'enter')).not.toBe(signature(kind, 'exit'));
    }
  });

  it('makes large bodies lower and longer while a limiter catches stacked impacts', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;
    const small = slimeVoice('burst', 'impact', .1);
    const large = slimeVoice('burst', 'impact', 1);
    expect(large.from).toBeLessThan(small.from);
    expect(large.hz).toBeLessThan(small.hz);
    expect(large.decay).toBeGreaterThan(small.decay);
    expect(ctx.compressors).toHaveLength(1);
    expect(ctx.compressors[0]).toMatchObject({ threshold: { value: -8 }, ratio: { value: 12 } });
    const oscs = ctx.oscillators.length;
    const sources = ctx.buffers.length;
    for (let i = 0; i < 6; i++) audio.slime('burst', i % 2 ? 1 : .1, 'impact');
    expect(ctx.oscillators.length).toBe(oscs + 12);
    expect(ctx.buffers.length).toBe(sources + 12);
    expect(audio.slimeSoundPhaseCounts.burst.impact).toBe(6);
  });

  it('gives the purple elastic impact a comic rising spring voice distinct from the black bomb', () => {
    const bounce = slimeVoice('slick', 'impact', .7);
    const bomb = slimeVoice('burst', 'impact', .7);
    expect(bounce.oscillator).toBe('triangle');
    expect(bounce.to).toBeGreaterThan(bounce.from * 3);
    expect(bounce.decay).toBeLessThan(.4);
    expect(bounce.noise).toBeLessThan(bomb.noise / 3);
    expect(bounce.from).toBeGreaterThan(bomb.from * 1.5);
  });

  it('adds three spring notes on purple impact and separation', async () => {
    const { audio, made } = harness(); await audio.unlock();
    const ctx = made[0]!;
    for (const phase of ['impact','exit'] as const) {
      const before = ctx.oscillators.length;
      audio.slime('slick', .7, phase);
      expect(ctx.oscillators.length - before).toBe(4);
      expect(ctx.oscillators.slice(-3).map(osc => osc.frequency.value)).toEqual([760,315,610]);
    }
  });

  it('plays a bright rising arpeggio when the tyres enter a boost slime', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;
    const oscs = ctx.oscillators.length;
    audio.slime('boost', 0.9, 'enter');
    expect(audio.slimeSoundCounts.boost).toBe(1);
    expect(ctx.oscillators.length).toBe(oscs + 6);
    expect(ctx.oscillators.slice(-3).map((osc) => osc.frequency.value))
      .toEqual([659.25, 830.61, 987.77]);
  });

  it('follows the same continuous rail contact as sparks and releases when contact ends', async () => {
    const { audio } = harness();
    await audio.unlock();
    settle(audio, driving({ speed: 18, scrape: 0.75 }), 20);
    expect(audio.metalScrapeAmount).toBeGreaterThan(0.7);
    settle(audio, driving({ speed: 18, scrape: 0 }), 30);
    expect(audio.metalScrapeAmount).toBeLessThan(0.02);
  });

  it('makes a burst and a thump on a hit, and refuses to machine-gun', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;
    const oscs = ctx.oscillators.length;
    const sources = ctx.buffers.length;

    audio.update(1 / 60, driving({ speed: 20, impact: 0.8 }));
    expect(ctx.oscillators.length).toBe(oscs + 1);
    expect(ctx.buffers.length).toBe(sources + 1);

    // A scrape along a wall arrives as a hit every frame; each one must not be its own crash.
    audio.update(1 / 60, driving({ speed: 20, impact: 0.8 }));
    expect(ctx.oscillators.length).toBe(oscs + 1);

    ctx.now = 1;
    audio.update(1 / 60, driving({ speed: 20, impact: 0.8 }));
    expect(ctx.oscillators.length).toBe(oscs + 2);

    // A graze is not a collision.
    ctx.now = 2;
    audio.update(1 / 60, driving({ speed: 20, impact: 0.001 }));
    expect(ctx.oscillators.length).toBe(oscs + 2);
  });

  it('plays interface sounds, the finish as a chord of three', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;
    const oscs = ctx.oscillators.length;
    audio.ui('move');
    expect(ctx.oscillators.length).toBe(oscs + 1);
    audio.ui('finish');
    expect(ctx.oscillators.length).toBe(oscs + 4);
  });
});

describe('volume and mute', () => {
  it('silences the output without forgetting the volume', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const out = master(made[0]!);

    audio.setVolume(0.6);
    expect(out.gain.value).toBeCloseTo(0.6, 5);

    audio.setMuted(true);
    expect(audio.muted).toBe(true);
    expect(out.gain.value).toBe(0);
    expect(audio.volume).toBe(0.6);

    // Changing the volume while muted stores it and stays quiet.
    audio.setVolume(0.3);
    expect(out.gain.value).toBe(0);
    expect(audio.volume).toBe(0.3);

    audio.setMuted(false);
    expect(out.gain.value).toBeCloseTo(0.3, 5);
  });

  it('clamps out of range volumes', () => {
    const { audio } = harness();
    audio.setVolume(4);
    expect(audio.volume).toBe(1);
    audio.setVolume(-1);
    expect(audio.volume).toBe(0);
  });
});

describe('dispose', () => {
  it('stops the loops, closes the context and goes quiet for good', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const ctx = made[0]!;
    const oscs = ctx.oscillators.length;

    audio.dispose();
    expect(ctx.closes).toBe(1);
    expect(ctx.state).toBe('closed');
    expect(audio.running).toBe(false);
    expect(ctx.oscillators.every((o) => o.stops === 1)).toBe(true);

    audio.update(1 / 60, driving({ speed: 30, impact: 1 }));
    audio.ui('go');
    expect(ctx.oscillators.length).toBe(oscs);
  });
});


describe('music mix and lifecycle', () => {
  it('keeps one score through page changes and controls effects independently', async () => {
    const { audio, made } = harness();
    audio.setEngineRunning(false);
    audio.setMix(0.5, 0.75);
    await audio.unlock();
    const graph = (audio as any).graph;
    expect(graph.engine.gain.value).toBe(0);
    const sources = made[0]!.buffers.length;
    audio.setScene('racing');
    expect(graph.music.gain.value).toBeCloseTo(0.12);
    expect(graph.effects.gain.value).toBe(0.75);
    for (const scene of ['paused', 'results', 'menu', 'boot', 'racing']) audio.setScene(scene);
    expect(made[0]!.buffers.length).toBe(sources);
    audio.setMix(0, 0.25);
    expect(graph.music.gain.value).toBe(0);
    expect(graph.effects.gain.value).toBe(0.25);
    audio.dispose();
    expect(made[0]!.buffers.every(source => source.stops === 1)).toBe(true);
  });

  it('moves to the next race piece for each new race, keeps it through pause and restart, and brings the menu loop back', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    const graph = (audio as any).graph;
    const audible = () => graph.pieces.map((g: { gain: { value: number } }) => g.gain.value);
    expect(audio.musicPiece).toBe('menu');
    const heard: string[] = [];
    // The real order: loading, the intro screen, a pause on the intro that restarts, the race, a
    // mid-race pause with settings and a restart, then results.
    const race = ['menu', 'boot', 'intro', 'paused', 'countdown', 'racing', 'paused', 'settings', 'paused', 'countdown', 'racing', 'results'];
    for (let n = 0; n < 3; n++) {
      for (const scene of race) {
        audio.setScene(scene);
        if (scene === 'racing') heard.push(audio.musicPiece);
      }
      expect(audio.musicPiece, 'results keep the race piece').not.toBe('menu');
    }
    // Retry from results is a new race too.
    for (const scene of ['countdown', 'racing']) { audio.setScene(scene); if (scene === 'racing') heard.push(audio.musicPiece); }
    expect(heard).toEqual(['rush', 'rush', 'coast', 'coast', 'night', 'night', 'rush']);
    // Each loop was synthesised once, when its first countdown needed it, and started once.
    expect(made[0]!.buffers.length).toBe(5 + 3);
    expect(made[0]!.buffers.every(source => source.starts === 1)).toBe(true);
    audio.setScene('menu');
    expect(audio.musicPiece).toBe('menu');
    expect(audible()).toEqual([1, 0, 0, 0]);
    audio.dispose();
    expect(made[0]!.buffers.every(source => source.stops === 1)).toBe(true);
  });

  it('synthesises the race loops after the first tap, one per idle turn, not inside it', async () => {
    vi.useFakeTimers();
    try {
      const { audio, made } = harness();
      await audio.unlock();
      expect(made[0]!.buffers.length).toBe(5);
      vi.advanceTimersByTime(1500);
      expect(made[0]!.buffers.length).toBe(6);
      vi.advanceTimersByTime(400);
      expect(made[0]!.buffers.length).toBe(7);
      vi.advanceTimersByTime(400);
      expect(made[0]!.buffers.length).toBe(8);
      vi.advanceTimersByTime(4000);
      expect(made[0]!.buffers.length).toBe(8);
      audio.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('fades all output in the background and restores the saved mix on return', async () => {
    const { audio, made } = harness();
    await audio.unlock();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(master(made[0]!).gain.value).toBe(0);
    vi.restoreAllMocks();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(master(made[0]!).gain.value).toBe(0.7);
    audio.dispose();
  });

  it('can still start when a browser refuses AudioContext construction', async () => {
    const audio = new GameAudio({ contextFactory: () => { throw new Error('Audio disabled'); } });
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(audio.running).toBe(false);
  });
});

// The garage roster is the denominator: adding a car without an authored voice must fail.
import { VEHICLES } from '../src/vehicles/catalogue';
import { ENGINE_VOICES, voiceHz, voiceHzFromRpm, voiceLevel } from '../src/audio/voices';

describe('garage engine voices', () => {
  it('covers every drivable vehicle with a distinct harmonic signature', () => {
    expect(Object.keys(ENGINE_VOICES).sort()).toEqual(VEHICLES.map(v => v.id).sort());
    const signatures = VEHICLES.map(v => JSON.stringify(ENGINE_VOICES[v.id]));
    expect(new Set(signatures).size).toBe(VEHICLES.length);
  });

  it('electric motors have no idle or gear drops; combustion gears still unload', () => {
    for (const voice of Object.values(ENGINE_VOICES)) {
      if (voice.electric) {
        expect(voiceLevel(voice, 0)).toBe(0);
        for (let speed = 1; speed < 38; speed++) {
          expect(voiceHz(voice, speed, 1)).toBeGreaterThan(voiceHz(voice, speed - 1, 1));
        }
      } else {
        expect(voiceLevel(voice, 0)).toBeGreaterThan(0);
        const shift = GEAR_TOPS[0]! / voice.speedScale;
        expect(voiceHz(voice, shift + 0.1, 1)).toBeLessThan(voiceHz(voice, shift - 0.1, 1));
      }
    }
    expect(ENGINE_VOICES['school-bus']!.redline).toBeLessThan(ENGINE_VOICES['sports-car']!.redline);
  });

  it('switches the live graph for every car, including selection before audio unlock', async () => {
    const { audio, made } = harness();
    audio.setVehicle('city-pod');
    await audio.unlock();
    const ctx = made[0]!;
    expect(ctx.oscillators[0]!.type).toBe('sine');
    for (const vehicle of VEHICLES) {
      audio.setVehicle(vehicle.id);
      settle(audio, driving({ speed: 15 }));
      const voice = ENGINE_VOICES[vehicle.id]!;
      expect(ctx.oscillators[0]!.type).toBe(voice.wave);
      expect(ctx.oscillators[1]!.type).toBe(voice.subWave);
      expect(audio.engineNote).toBeCloseTo(voiceHz(voice, 15, 1), 4);
      expect(ctx.oscillators[1]!.frequency.value).toBeCloseTo(audio.engineNote * voice.ratio, 4);
    }
    expect(ctx.oscillators).toHaveLength(2);
    audio.dispose();
    expect(ctx.oscillators.every(osc => osc.stops === 1)).toBe(true);
  });

  it('uses the powertrain RPM supplied by the car instead of deriving another gear from speed', async () => {
    const { audio } = harness();
    audio.setVehicle('sports-car');
    await audio.unlock();
    settle(audio, driving({ speed: 5, rpmFraction: .72 }));
    const first = audio.engineNote;
    settle(audio, driving({ speed: 45, rpmFraction: .72 }));
    expect(audio.engineNote).toBeCloseTo(first, 4);
    expect(first).toBeCloseTo(voiceHzFromRpm(ENGINE_VOICES['sports-car']!, .72, 1), 4);
  });
});

describe('recordingTrack', () => {
  it('hands the saved clip what the speakers play, and nothing while the context is not running', async () => {
    const { audio, made } = harness();
    expect(audio.recordingTrack(), 'no context before the first tap').toBeNull();
    await audio.unlock();
    const ctx = made[0]!;
    const track = audio.recordingTrack();
    expect(track).toBe(ctx.taps[0]!.track);
    // After the limiter, the same node the speakers hang off: volume and mute reach the clip as they reach the room.
    expect(ctx.compressors[0]!.outputs).toEqual([ctx.destination, ctx.taps[0]]);
    expect(audio.recordingTrack(), 'one tap, however often a lane asks').toBe(track);
    expect(ctx.taps).toHaveLength(1);
    ctx.state = 'suspended';
    expect(audio.recordingTrack(), 'a stalled track would break the file').toBeNull();
  });
});
