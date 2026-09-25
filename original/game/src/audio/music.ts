/* */

type Buffer = Float32Array;

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** A plucked, slightly bright note: sine plus a soft second harmonic, quick attack, squared decay. */
function tone(data: Buffer, rate: number, midi: number, start: number, duration: number, level: number,
  attack = 0.012, bright = 0.16): void {
  const f = hz(midi), offset = Math.round(start * rate), n = Math.round(duration * rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const envelope = Math.min(1, t / attack) * Math.max(0, 1 - t / duration) ** 2;
    const wave = Math.sin(2 * Math.PI * f * t) + bright * Math.sin(4 * Math.PI * f * t);
    data[(offset + i) % data.length]! += level * envelope * wave;
  }
}

/** A swelling chord pad for the slower pieces: slow attack and release, no pluck. */
function pad(data: Buffer, rate: number, notes: readonly number[], start: number, duration: number, level: number): void {
  const offset = Math.round(start * rate), n = Math.round(duration * rate), fade = duration * 0.3;
  const omegas = notes.map(note => 2 * Math.PI * hz(note) / rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const envelope = Math.min(1, t / fade, (duration - t) / fade);
    let wave = 0;
    for (const w of omegas) wave += Math.sin(w * i) + 0.08 * Math.sin(3 * w * i);
    data[(offset + i) % data.length]! += level * envelope * wave / notes.length;
  }
}

/** A kick drum: a sine that falls from 110 Hz to 45 Hz in a tenth of a second. */
function kick(data: Buffer, rate: number, start: number, level: number): void {
  const offset = Math.round(start * rate), n = Math.round(0.2 * rate);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    phase += 2 * Math.PI * (45 + 65 * Math.exp(-t * 30)) / rate;
    data[(offset + i) % data.length]! += level * Math.exp(-t * 16) * Math.sin(phase);
  }
}

/** A closed hi-hat from seeded noise, differenced once so only the top end is left. */
function hat(data: Buffer, rate: number, start: number, level: number, seed: number): void {
  const offset = Math.round(start * rate), n = Math.round(0.035 * rate);
  let state = seed >>> 0 || 1, previous = 0;
  for (let i = 0; i < n; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const white = ((state >>> 0) / 0xffffffff) * 2 - 1;
    data[(offset + i) % data.length]! += level * Math.exp(-(i / rate) * 90) * (white - previous) * 0.5;
    previous = white;
  }
}

function normalise(data: Buffer, peak: number): Buffer {
  let max = 0;
  for (const value of data) max = Math.max(max, Math.abs(value));
  if (max > 0) for (let i = 0; i < data.length; i++) data[i]! *= peak / max;
  return data;
}

/** Original 96 BPM, eight-bar A minor loop: the menu's music. No samples or third-party melody. */
export function musicSamples(sampleRate: number): Float32Array {
  const beat = 60 / 96;
  const data = new Float32Array(Math.round(sampleRate * beat * 32));
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  for (let bar = 0; bar < 8; bar++) {
    const chord = chords[Math.floor(bar / 2)]!;
    for (let pulse = 0; pulse < 8; pulse++) {
      tone(data, sampleRate, chord[[0, 1, 2, 1, 0, 2, 1, 2][pulse]!]! + 12,
        (bar * 4 + pulse / 2) * beat, beat * 0.7, 0.12);
    }
    for (let pulse = 0; pulse < 4; pulse++)
      tone(data, sampleRate, chord[0]! - 12, (bar * 4 + pulse) * beat, beat * 0.85, 0.18);
  }
  return data;
}

export interface MusicPiece {
  id: string;
  bpm: number;
  bars: number;
  render(sampleRate: number): Float32Array;
}

/** Rendered at this rate and resampled by Web Audio: tones this soft have nothing above 11 kHz. */
export const RACE_MUSIC_RATE = 22050;

const empty = (rate: number, bpm: number, bars: number): Buffer => new Float32Array(Math.round(rate * (60 / bpm) * bars * 4));

/** 132 BPM E minor: eighth-note bass, a pentatonic hook that answers itself, kick and hats. */
function rush(rate: number): Buffer {
  const bpm = 132, beat = 60 / bpm, bars = 16, data = empty(rate, bpm, bars);
  const roots = [40, 36, 43, 38];                         // E, C, G, D
  const hook = [[64, 67, 69, 71, 69, 67, 64, 62], [64, 67, 69, 74, 71, 69, 67, 69]];
  for (let bar = 0; bar < bars; bar++) {
    const root = roots[Math.floor(bar / 2) % 4]!, at = bar * 4 * beat;
    for (let e = 0; e < 8; e++) tone(data, rate, root + (e % 4 === 3 ? 7 : 0), at + e * beat / 2, beat * 0.42, 0.2, 0.004, 0.35);
    for (let q = 0; q < 4; q++) kick(data, rate, at + q * beat, 0.34);
    for (let e = 0; e < 8; e++) hat(data, rate, at + (e + 0.5) * beat / 2, e % 2 ? 0.1 : 0.05, bar * 16 + e + 7);
    if (bar % 4 < 2 || bar >= 12) {
      const line = hook[bar % 2]!;
      for (let e = 0; e < 8; e++) if ((bar * 8 + e) % 3 !== 2) tone(data, rate, line[e]!, at + e * beat / 2, beat * 0.45, 0.11);
    }
  }
  return normalise(data, 0.36);
}

/** 112 BPM D minor: a rolling arpeggio over half-note bass, lighter drums, room to breathe. */
function coast(rate: number): Buffer {
  const bpm = 112, beat = 60 / bpm, bars = 16, data = empty(rate, bpm, bars);
  const chords = [[62, 65, 69], [58, 62, 65], [53, 57, 60], [60, 64, 67]];   // Dm, Bb, F, C
  for (let bar = 0; bar < bars; bar++) {
    const chord = chords[Math.floor(bar / 2) % 4]!, at = bar * 4 * beat;
    const lift = bar >= 8 ? 12 : 0;
    for (let s = 0; s < 16; s++) tone(data, rate, chord[[0, 1, 2, 1][s % 4]!]! + lift, at + s * beat / 4, beat * 0.3, 0.07, 0.006);
    for (let h = 0; h < 2; h++) tone(data, rate, chord[0]! - 24, at + h * 2 * beat, beat * 1.8, 0.24, 0.01, 0.1);
    kick(data, rate, at, 0.26); kick(data, rate, at + 2.5 * beat, 0.18);
    for (let q = 0; q < 4; q++) hat(data, rate, at + (q + 0.5) * beat, 0.07, bar * 4 + q + 101);
  }
  return normalise(data, 0.34);
}

/** 100 BPM A minor: pads and a sparse bell melody, for night and fog as much as for day. */
function night(rate: number): Buffer {
  const bpm = 100, beat = 60 / bpm, bars = 16, data = empty(rate, bpm, bars);
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];   // Am, F, C, G
  const bells = [76, 72, 74, 71, 72, 69, 71, 67];
  for (let bar = 0; bar < bars; bar++) {
    const chord = chords[Math.floor(bar / 2) % 4]!, at = bar * 4 * beat;
    if (bar % 2 === 0) pad(data, rate, chord, at, 8 * beat, 0.2);
    tone(data, rate, chord[0]! - 12, at, beat * 3.5, 0.2, 0.02, 0.05);
    tone(data, rate, bells[bar % 8]!, at + beat * (bar % 3 === 0 ? 1.5 : 2), beat * 1.6, 0.09, 0.004, 0.5);
    kick(data, rate, at, 0.2);
    hat(data, rate, at + 2 * beat, 0.06, bar + 211); hat(data, rate, at + 3.5 * beat, 0.04, bar + 307);
  }
  return normalise(data, 0.32);
}

/** Played one per race, in this order, starting over after the last. */
export const RACE_PIECES: readonly MusicPiece[] = [
  { id: 'rush', bpm: 132, bars: 16, render: rush },
  { id: 'coast', bpm: 112, bars: 16, render: coast },
  { id: 'night', bpm: 100, bars: 16, render: night },
];
