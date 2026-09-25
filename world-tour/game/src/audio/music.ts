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

// ---- World Tour: one driving bed everywhere, a local tune on top (remix brief) --------------------

/**
 * A plucked string by Karplus-Strong: a burst of noise circulating in a delay line one period long,
 * averaged each pass so the upper harmonics die first. `damp` sets the sustain (a koto rings, an oud
 * stops), `bright` how much of the pick survives. Seeded, so the loop is the same every render.
 */
function pluck(data: Buffer, rate: number, midi: number, start: number, duration: number, level: number,
  damp = 0.996, bright = 0.5, seed = 1): void {
  const period = Math.max(2, Math.round(rate / hz(midi))), n = Math.round(duration * rate);
  const offset = Math.round(start * rate), line = new Float32Array(period);
  let state = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < period; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    line[i] = ((state >>> 0) / 0xffffffff) * 2 - 1;
  }
  // Soften the pick once before it starts ringing: raw white noise makes every note a spike that
  // stacks with the kick on the downbeat and leaves the loop quiet after it is normalised.
  for (let i = period - 1; i > 0; i--) line[i] = 0.5 * (line[i]! + line[i - 1]!);
  let previous = 0;
  for (let i = 0; i < n; i++) {
    const k = i % period, current = line[k]!;
    const next = damp * (bright * current + (1 - bright) * 0.5 * (current + previous));
    previous = current; line[k] = next;
    const release = Math.min(1, (n - i) / (rate * 0.03));
    data[(offset + i) % data.length]! += level * current * release;
  }
}

/** A breathy wind note (pan pipes, a bamboo flute): sine with a slow vibrato and a little noise. */
function flute(data: Buffer, rate: number, midi: number, start: number, duration: number, level: number, seed = 1): void {
  const f = hz(midi), offset = Math.round(start * rate), n = Math.round(duration * rate);
  let state = (seed * 40503) >>> 0 || 1, noise = 0, phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    noise = 0.9 * noise + 0.1 * (((state >>> 0) / 0xffffffff) * 2 - 1);
    phase += 2 * Math.PI * f * (1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t / 0.25)) / rate;
    const envelope = Math.min(1, t / 0.06) * Math.min(1, (duration - t) / 0.08);
    data[(offset + i) % data.length]! += level * envelope * (Math.sin(phase) + 0.12 * Math.sin(2 * phase) + 0.35 * noise);
  }
}

/** A struck bowl or temple bell: inharmonic partials, each fading at its own rate. */
function bell(data: Buffer, rate: number, midi: number, start: number, duration: number, level: number): void {
  const f = hz(midi), offset = Math.round(start * rate), n = Math.round(duration * rate);
  const partials: [number, number, number][] = [[1, 1, 1.4], [2.76, 0.5, 3.2], [5.4, 0.25, 6], [8.93, 0.12, 9]];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let wave = 0;
    for (const [ratio, amp, decay] of partials) wave += amp * Math.exp(-t * decay) * Math.sin(2 * Math.PI * f * ratio * t);
    data[(offset + i) % data.length]! += level * Math.min(1, t / 0.003) * wave;
  }
}

/** A marimba bar: a warm fundamental, its fourth harmonic, and a quick fall. */
function marimba(data: Buffer, rate: number, midi: number, start: number, level: number): void {
  const f = hz(midi), offset = Math.round(start * rate), n = Math.round(0.5 * rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const wave = Math.exp(-t * 7) * Math.sin(2 * Math.PI * f * t) + 0.3 * Math.exp(-t * 30) * Math.sin(8 * Math.PI * f * t);
    data[(offset + i) % data.length]! += level * Math.min(1, t / 0.002) * wave;
  }
}

/** Accordion reeds: odd harmonics from two voices tuned a few cents apart -- the musette's shimmer. */
function reed(data: Buffer, rate: number, midi: number, start: number, duration: number, level: number): void {
  const f = hz(midi), offset = Math.round(start * rate), n = Math.round(duration * rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let wave = 0;
    for (const detune of [0.997, 1.003]) for (const h of [1, 3, 5, 7]) wave += Math.sin(2 * Math.PI * f * detune * h * t) / (h * 1.6);
    const envelope = Math.min(1, t / 0.03) * Math.min(1, (duration - t) / 0.05);
    data[(offset + i) % data.length]! += level * envelope * wave * 0.5;
  }
}

/** A hand drum: `low` is the doum from the middle of the skin, otherwise the tek from its rim. */
function handDrum(data: Buffer, rate: number, start: number, level: number, low: boolean, seed: number): void {
  const offset = Math.round(start * rate), n = Math.round((low ? 0.25 : 0.08) * rate);
  const f = low ? 95 : 420;
  let state = seed >>> 0 || 1, phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    phase += 2 * Math.PI * f * (1 + (low ? 0.5 : 0.2) * Math.exp(-t * 40)) / rate;
    const noise = low ? 0 : 0.5 * (((state >>> 0) / 0xffffffff) * 2 - 1);
    data[(offset + i) % data.length]! += level * Math.exp(-t * (low ? 14 : 45)) * (Math.sin(phase) + noise);
  }
}

/** A bowed string (jinghu, erhu): a sawtooth-leaning stack with a slow-starting vibrato. `nasal` lifts the odd upper partials. */
function bowed(data: Buffer, rate: number, midi: number, start: number, duration: number, level: number, nasal = 0.5): void {
  const f = hz(midi), offset = Math.round(start * rate), n = Math.round(duration * rate);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    phase += 2 * Math.PI * f * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.2)) / rate;
    const wave = Math.sin(phase) + 0.45 * Math.sin(2 * phase) + nasal * (0.4 * Math.sin(3 * phase) + 0.22 * Math.sin(5 * phase))
      + 0.18 * Math.sin(4 * phase);
    const envelope = Math.min(1, t / 0.025) * Math.min(1, (duration - t) / 0.04);
    data[(offset + i) % data.length]! += level * envelope * wave * 0.5;
  }
}

/** An upright piano slightly out of tune with itself: two bright tones a few cents apart, the saloon sound. */
function honkyTonk(data: Buffer, rate: number, midi: number, start: number, duration: number, level: number): void {
  tone(data, rate, midi, start, duration, level, 0.004, 0.3);
  tone(data, rate, midi + 0.12, start, duration, level * 0.7, 0.004, 0.3);
}

// ---- Scores ------------------------------------------------------------------------------------------

/** One note of a score: a MIDI pitch (or null for a rest) and its length in the score's unit. */
type Note = [midi: number | null, units: number];

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEGREE = [0, 0, 2, 4, 5, 7, 9, 11];                                      // jianpu 1..7 in a major scale

/**
 * Parse a melody written the way the source score is written, so it can be checked against it note by
 * note. Tokens are separated by spaces; `|` is a bar line and only there for reading. A pitch is either
 * a note name with its octave (`G#4`, `Bb3`, `z` a rest) or a jianpu degree against `tonic` (`5`, `#4`,
 * `6,` an octave down, `1'` an octave up, `0` a rest). `:n`, `:1/2`, `:3/2` give the length in units
 * (default one); `-` holds the previous note one unit longer.
 */
function score(text: string, tonic = 60): Note[] {
  const notes: Note[] = [];
  for (const token of text.trim().split(/\s+/)) {
    if (token === '|') continue;
    if (token === '-') { notes[notes.length - 1]![1] += 1; continue; }
    const m = /^(z|[A-G][#b]?\d|[#b]?[0-7][',]*)(?::(\d+)(?:\/(\d+))?)?$/.exec(token);
    if (!m) throw new Error(`bad note '${token}'`);
    const pitch = m[1]!, length = Number(m[2] ?? 1) / Number(m[3] ?? 1);
    let midi: number | null = null;
    if (/^[A-G]/.test(pitch)) {
      midi = LETTER[pitch[0]!]! + (pitch[1] === '#' ? 1 : pitch[1] === 'b' ? -1 : 0) + (Number(pitch.at(-1)) + 1) * 12;
    } else if (pitch !== 'z') {
      const accidental = pitch[0] === '#' ? 1 : pitch[0] === 'b' ? -1 : 0;
      const degree = Number(pitch.replace(/[#b',]/g, ''));
      const octave = (pitch.match(/'/g)?.length ?? 0) - (pitch.match(/,/g)?.length ?? 0);
      if (degree > 0) midi = tonic + DEGREE[degree]! + accidental + 12 * octave;
    }
    notes.push([midi, length]);
  }
  return notes;
}

const lengthOf = (notes: readonly Note[]): number => notes.reduce((sum, [, units]) => sum + units, 0);

/** Play a score from `startBeat`, `beatsPerUnit` beats to its unit; returns the beats it took. */
function perform(notes: readonly Note[], beatsPerUnit: number, beat: number, startBeat: number,
  play: (midi: number, at: number, duration: number, index: number) => void): number {
  let at = startBeat;
  notes.forEach(([midi, units], index) => {
    if (midi !== null) play(midi, at * beat, units * beatsPerUnit * beat, index);
    at += units * beatsPerUnit;
  });
  return at - startBeat;
}

interface Groove {
  /** Beats to the bar, as the kick pattern counts them. */
  meter: number;
  /** Bass pulses per beat: 2 is straight eighths, 3 the triplet swing of a 6/8 tune. */
  sub?: number;
  /** Kick positions inside the bar, in beats. */
  kicks?: readonly number[];
  level?: number;
}

/**
 * The shared driving bed: kicks, off-beat hats and a pulsing bass on the tune's own chord roots, root
 * and fifth. Every regional piece starts from this, so the game sounds like one game in thirteen
 * places. `harmony` is a score of bass roots in beats and repeats until the loop is full.
 */
function bed(data: Buffer, rate: number, bpm: number, harmony: readonly Note[], groove: Groove): void {
  const beat = 60 / bpm, sub = groove.sub ?? 2, level = groove.level ?? 1, kicks = groove.kicks ?? [0, 1, 2, 3];
  const beats = Math.round(data.length / rate / beat), cycle = lengthOf(harmony);
  const roots: number[] = [];                                                    // the root under each beat
  for (let b = 0; b < beats; b++) {
    let at = b % cycle, k = 0;
    while (at >= harmony[k]![1]) at -= harmony[k++]![1];
    roots.push(harmony[k]![0] ?? 36);
  }
  for (let s = 0; s < beats * sub; s++) {
    const root = roots[Math.floor(s / sub)]!;
    tone(data, rate, root + (s % (2 * sub) === 2 * sub - 1 ? 7 : 0), s * beat / sub, beat / sub * 0.84, 0.16 * level, 0.004, 0.3);
    hat(data, rate, (s + 0.5) * beat / sub, (s % 2 ? 0.08 : 0.04) * level, s + 17);
  }
  for (let bar = 0; bar * groove.meter < beats; bar++) for (const q of kicks) kick(data, rate, (bar * groove.meter + q) * beat, 0.3 * level);
}

/** A loop exactly as long as its harmony, which must be a whole number of passes of the tune. */
function loop(rate: number, bpm: number, harmony: readonly Note[], tuneBeats: number): Buffer {
  const beats = lengthOf(harmony);
  if (Math.abs(beats / tuneBeats - Math.round(beats / tuneBeats)) > 1e-9) throw new Error(`harmony ${beats} beats, tune ${tuneBeats}`);
  return new Float32Array(Math.round(rate * (60 / bpm) * beats));
}

// ---- The tunes, one per route --------------------------------------------------------------------

/**
 * Beijing: 夜深沉, the Peking-opera 曲牌 the jinghu plays for Yu Ji's sword dance, developed by
 * generations of opera fiddlers from the kunqu aria 《思凡·风吹荷叶煞》; traditional. Notes from the
 * jinghu score 《夜深沉(1)》 (曲谱歌谱大全, reposted at blog.sina.com.cn/s/blog_46db7bad010006lb.html), its
 * opening 40 one-beat bars, set with 1 = D. Its 1/4 bars run at half the bed's pace, so the sixteenths
 * fall on the bed's eighths. A jinghu over clapper and gong.
 */
const YESHENCHEN = score(`
  0:2 5:2 | 1':2 6:3/2 5:1/2 | 6 7 6 5 | 3 2 3 5 | 6 1' 5 6 | 1' 7 6 5 | 3:3 6, | 3 6, 3:3/2 5:1/2 |
  6 1' 5 6 | 1' 0 1' 1' | 3:2 3 6, | 3 6, 3:3/2 5:1/2 | 6 5 6:2 | 0 1' 5 6 | 1' 1' 5 7 | 6 5 6:2 |
  0:2 5:2 | 6 7 6 5 | 3:3/2 2:1/2 5 6 | 3 2 1 3:1/2 5:1/2 | 2:2 0 3 | 5 6 5 3 | 2 3 2 1 | 6, 5, 6, 1 |
  2:2 0 3 | 5 6 5 3 | 2 3 2 1 | 6, 5, 6, 1 | 2 1 2:2 | 6,:2 1:2 | 2 1 2:2 | 0:2 1:2 |
  2:2 3:2 | 2:2 1:2 | 2:2 5:2 | 2:2 1:2 | 2 3 2 1 | 2 3 2 1 | 2 3 2 1 | 2:2 6, 1`, 62);
const YESHENCHEN_BASS = score(`D2:4 D2:4 B1:4 B1:4 D2:4 B1:4 G2:4 A1:4 A1:4 A1:4
  E2:4 A1:4 E2:4 A1:4 B1:4 E2:4 A1:4 E2:4 A1:4 E2:4`);

function beijing(rate: number): Buffer {
  const bpm = 124, beat = 60 / bpm, data = loop(rate, bpm, YESHENCHEN_BASS, lengthOf(YESHENCHEN) / 2);
  bed(data, rate, bpm, YESHENCHEN_BASS, { meter: 4, level: 0.9 });
  perform(YESHENCHEN, 0.5, beat, 0, (m, at, d) => bowed(data, rate, m + 12, at, Math.max(d, beat * 0.3), 0.2, 0.9));
  for (let bar = 0; bar * 4 * beat * rate < data.length; bar++) {
    handDrum(data, rate, bar * 4 * beat, 0.14, false, bar * 7 + 3);                   // the 板 on the downbeat
    if (bar % 4 === 0) bell(data, rate, 45, bar * 4 * beat, beat * 3.5, 0.1);          // a gong every phrase
  }
  return normalise(data, 0.36);
}

/**
 * Shanghai: 紫竹调, the Jiangnan love song that is a basic tune of Shanghai's own opera, 沪剧; traditional.
 * Notes from the dizi score 《紫竹调》 marked 江南民乐 (maidizi.com/i_17.html), its sung section, 1 = G in
 * 2/4, a quarter to each beat. A dizi, and on the second time round a guzheng answering an octave down.
 */
const ZIZHU = score(`
  6 5 6 1' 5 6 5 3 | 6 5 6 1' 5 6 5 3 | 2:2 2 3 2 1 6, 5, | 1':6 1 2 | 3:2 1':4 6 5 | 3:3 5 6 5 6 1' |
  5:8 | 3:3 5 6:3 1' | 5:8 | 1':3 6:1/2 5:1/2 3:3 1' | 5:8 | 5:2 5:4 1':2 | 6:2 5:2 3:4 | 5:2 2:2 3:2 2:2 |
  1:8 | 1:3 6, 5:3 3 | 2 3 2 1 2:4 | 3:2 5:2 5:2 6,:2 | 1:2 1 2 7, 6, 5,:2 | 6,:8`, 67);
const ZIZHU_BASS = score(`E2:2 E2:2 D2:2 G2:2 E2:2 E2:2 D2:2 E2:2 D2:2 G2:2 D2:2 G2:2 E2:2 D2:2 G2:2
  G2:2 D2:2 E2:2 D2:2 E2:2 E2:2 E2:2 D2:2 G2:2 E2:2 E2:2 D2:2 E2:2 D2:2 G2:2 D2:2 G2:2 E2:2 D2:2 G2:2
  G2:2 D2:2 E2:2 D2:2 E2:2`);

function shanghai(rate: number): Buffer {
  const bpm = 104, beat = 60 / bpm, pass = lengthOf(ZIZHU) / 4, data = loop(rate, bpm, ZIZHU_BASS, pass);
  bed(data, rate, bpm, ZIZHU_BASS, { meter: 4, level: 0.85, kicks: [0, 1.5, 2, 3] });
  for (const start of [0, pass]) perform(ZIZHU, 0.25, beat, start, (m, at, d, i) => {
    flute(data, rate, m, at, Math.max(d, beat * 0.2), 0.18, i + 5);
    if (start > 0) pluck(data, rate, m - 12, at, d * 2.5, 0.16, 0.997, 0.55, i + 61);
  });
  return normalise(data, 0.35);
}

/**
 * Zhangjiajie: 马桑树儿搭灯台, a Tujia folk song from Sangzhi county, sung since Ming soldiers from Sangzhi
 * marched to fight coastal pirates; traditional (《中国民歌集成·湖南卷》). Notes from the 简谱 published as
 * 湖南民歌 at cangqiang.com.cn/d/895.html, 1 = G, 2/4 with its 3/4 bars kept, ♩ = 60, set at half the
 * bed's pace; the last note is held one beat longer to close the loop. An erhu over the bed.
 */
const MASANG = score(`
  6,:2 1:2 2:2 3 2 | 2:6 3:2 | 3:2 6:2 5 5 6 5 | 3:6 5:2 | 6:2 3 5 6:2 5:2 | 5:2 3 2 2:6 #1:2 |
  3:2 3:1/2 2:1/2 1 6,:6 1:2 | 6,:2 1:2 2:2 3 2 | 2:6 3:2 | 5:2 3:4 5:2 | 2 3 2 1 6,:6 1:2 |
  6,:2 1:2 2:2 3 2 | 2:6 3:2 | 3:2 6:2 5 5 6 5 | 3:6 5:2 | 6:2 3 5 6:2 5 3 | 5:2 3 2 2:6 #1:2 |
  3:2 3:1/2 2:1/2 1 6,:12`, 67);
const MASANG_BASS = score(`E2:4 A2:4 E2:4 G2:4 E2:4 D2:2 E2:4 E2:6 E2:4 A2:4 G2:4 A2:2 E2:4
  E2:4 A2:4 E2:4 G2:4 E2:4 D2:2 E2:4 E2:8`);

function zhangjiajie(rate: number): Buffer {
  const bpm = 118, beat = 60 / bpm, data = loop(rate, bpm, MASANG_BASS, lengthOf(MASANG) / 2);
  bed(data, rate, bpm, MASANG_BASS, { meter: 4, level: 0.85, kicks: [0, 1, 2, 3] });
  perform(MASANG, 0.5, beat, 0, (m, at, d) => bowed(data, rate, m + 12, at, Math.max(d, beat * 0.3), 0.2, 0.35));
  return normalise(data, 0.35);
}

/**
 * Fuji: さくら さくら, an Edo-period koto song, published in 《箏曲集》 (Tokyo Music School, 1888);
 * traditional. Notes from the score on the English Wikipedia article (File:Sakura.song.png, 古歌/Traditional),
 * A minor in 4/4, each quarter taking two beats of the bed. A koto, with a softer koto echoing each
 * note an octave up a beat later.
 */
const SAKURA = score(`
  A4 A4 B4:2 | A4 A4 B4:2 | A4 B4 C5 B4 | A4 B4:1/2 A4:1/2 F4:2 | E4 C4 E4 F4 | E4 E4:1/2 C4:1/2 B3:2 |
  A4 B4 C5 B4 | A4 B4:1/2 A4:1/2 F4:2 | E4 C4 E4 F4 | E4 E4:1/2 C4:1/2 B3:2 | A4 A4 B4:2 | A4 A4 B4:2 |
  E4 F4 B4:1/2 A4:1/2 F4 | E4:2 z:2`);
const SAKURA_BASS = score(`A2:8 A2:4 G2:4 A2:2 G2:2 F2:2 G2:2 A2:4 D2:4 A2:6 D2:2 A2:4 E2:4
  A2:2 G2:2 F2:2 G2:2 A2:4 D2:4 A2:6 D2:2 A2:4 E2:4 A2:8 A2:4 G2:4 D2:8 E2:8`);

function fuji(rate: number): Buffer {
  const bpm = 120, beat = 60 / bpm, data = loop(rate, bpm, SAKURA_BASS, lengthOf(SAKURA) * 2);
  bed(data, rate, bpm, SAKURA_BASS, { meter: 4, level: 0.85 });
  perform(SAKURA, 2, beat, 0, (m, at, d, i) => {
    pluck(data, rate, m + 12, at, Math.max(d, beat * 1.5) * 1.4, 0.3, 0.998, 0.65, i + 23);
    tone(data, rate, m + 24, at + beat, beat * 1.5, 0.05, 0.004, 0.2);
  });
  return normalise(data, 0.35);
}

/**
 * Istanbul: Üsküdar'a Gider İken (Kâtibim), an Istanbul türkü in makam nihavend; traditional, recorded as
 * early as 1924. Notes from the ABC "Uskudara" (O:Turkey, abcnotation.com, Andy Hornby's Greek/Turkish
 * set), D minor in 4/4, an eighth to half a beat, checked against the do-re-mi notation at kolaynota.com
 * (the same tune a fourth higher). A saz, and the drum doubled up.
 */
const KATIBIM = score(`
  D4:3 A4 A4:2 A4:2 | Bb4 A4 Bb4 C5 A4:2 A4 A4 | G4:2 G4 G4 F4:2 G4:2 | A4 Bb4 A4 G4 F4 E4 D4 A3 |
  D4:3 A4 A4:2 A4:2 | Bb4 A4 Bb4 C5 A4:2 A4 A4 | G4:2 G4 G4 F4:2 G4:2 | A4:3 A4 A4:2 A4:2 |
  D4:3 E4 F4:2 G4:2 | A4 Bb4 A4 G4 F4 E4 D4:2 | E4 F4 F4 E4 E4 D4 C#4 D4 | E4 F4 E4 D4 C#4 Bb3 A3:2 |
  D4:3 E4 F4:2 G4:2 | A4 Bb4 A4 G4 F4 E4 D4:2 | E4 F4 F4 E4 E4 D4 D4 C#4 | D4:3 D4 D4:2 D4:2 |
  A4 Bb4 A4 G4 F4 E4 F4 G4 | A4 Bb4 A4 G4 F4 E4 D4:2 | E4 F4 F4 E4 E4 D4 C#4 D4 | E4 F4 E4 D4 C#4 Bb3 A3:2 |
  A4 Bb4 A4 G4 F4 E4 F4 G4 | A4 Bb4 A4 G4 F4 E4 D4:2 | E4 F4 F4 E4 E4 D4 D4 C#4 | D4:3 D4 D4:2 D4:2`);
const KATIBIM_BASS = score(`D2:4 D2:4 C2:4 D2:2 A1:2 D2:4 D2:4 C2:4 A1:4 D2:4 D2:2 A1:2 A1:4 A1:4
  D2:4 D2:2 A1:2 A1:4 D2:4 D2:4 D2:2 A1:2 A1:4 A1:4 D2:4 D2:2 A1:2 A1:4 D2:4`);

function istanbul(rate: number): Buffer {
  const bpm = 116, beat = 60 / bpm, data = loop(rate, bpm, KATIBIM_BASS, lengthOf(KATIBIM) / 2);
  bed(data, rate, bpm, KATIBIM_BASS, { meter: 4, level: 0.85 });
  // The kick already lands on one, so the darbuka's doum answers on the and-of-three instead.
  const drum: [number, boolean][] = [[1, false], [1.75, false], [2.5, true], [3, false], [3.5, false]];
  for (let bar = 0; bar * 4 * beat * rate < data.length; bar++) for (const [at, low] of drum)
    handDrum(data, rate, (bar * 4 + at) * beat, low ? 0.16 : 0.07, low, bar * 12 + at * 4 + 9);
  perform(KATIBIM, 0.5, beat, 0, (m, at, d, i) => pluck(data, rate, m + 12, at, Math.max(d, beat) * 1.4, 0.3, 0.994, 0.4, i + 41));
  return normalise(data, 0.35);
}

/**
 * Giza: Lamma Bada Yatathanna, the Andalusian muwashshah in nahawand whose melody is credited to the
 * nineteenth-century Egyptian Sheikh Muhammad Abd al-Rahim al-Maslub, recorded in Cairo by about 1910
 * (AMAR Foundation, amar-foundation.org/004-lamma-bada-yatathanna). Notes from the score on the English
 * Wikipedia article (File:Lamma_bada_yatathanna.jpg), its first strain up to Fine, G nahawand in 10/8
 * with an eighth to each beat of the bed: samai thaqil on the drums (doum - - tek - doum doum tek - -).
 * An oud, and a ney doubling it the second time round.
 */
const LAMMA = score(`
  G4:4 A4 Bb4 C5 Bb4 Bb4 A4 Bb4 G4 G4 F#4 G4:4 D4:2 | G4:4 A4 Bb4 C5 Bb4 Bb4 A4 Bb4 G4 G4 F#4 G4:4 A4 Bb4 |
  C5:4 C5:2 Bb4:3 A4 Bb4 G4 G4 F#4 G4:4 A4:2 | F#5:4 G5:2 D5:3 C5 D5 C5 Eb5 D5 C5:4 D5 C5 |
  C5:4 D5 C5 Bb4:3 G4 A4 G4 G4 F#4 G4:4 D4:2`);
const LAMMA_BASS = score(`G2:5 D2:3 G2:2 G2:5 D2:3 G2:2 C2:5 D2:3 G2:2 D2:3 G2:2 C2:5 C2:3 G2:2 D2:3 G2:2`);

function giza(rate: number): Buffer {
  const bpm = 132, beat = 60 / bpm, pass = lengthOf(LAMMA) / 2, data = loop(rate, bpm, [...LAMMA_BASS, ...LAMMA_BASS], pass);
  bed(data, rate, bpm, LAMMA_BASS, { meter: 10, kicks: [0, 5, 6], level: 0.8 });
  for (let bar = 0; bar * 10 * beat * rate < data.length; bar++) for (const at of [3, 7, 8.5])
    handDrum(data, rate, (bar * 10 + at) * beat, 0.12, false, bar * 5 + at * 2 + 1);
  for (const start of [0, pass]) perform(LAMMA, 0.5, beat, start, (m, at, d, i) => {
    pluck(data, rate, m, at, Math.max(d, beat * 0.6) * 1.5, 0.28, 0.992, 0.3, i + 31);
    if (start > 0) flute(data, rate, m + 12, at, Math.max(d, beat * 0.4), 0.09, i + 7);
  });
  return normalise(data, 0.35);
}

/**
 * Paris: Auprès de ma blonde, the French soldiers' song from 1704, under Louis XIV; traditional. Notes
 * from the ABC by Bernard Loffet (abcnotation.com, John Chambers' mirror, C:Traditionnel), C major in
 * 6/8, the dotted quarter on the beat and the bass swinging in threes. A musette accordion, twice through,
 * the second time with a second reed a third below.
 */
const BLONDE = score(`
  E5:2 F5 E5:2 D5 | C5:3 C5:2 C5 | G5:2 G5 A5:2 A5 | G5:3 z:2 E5 | E5:2 F5 E5:2 D5 | C5:3 C5:2 C5 |
  G5:2 G5 A5:2 A5 | G5:3 z:2 G5 | A5:2 A5 A5:2 E5 | F5:3 F5:2 F5 | G5:2 G5 G5:2 D5 | E5:3 z:3 |
  C5:3 D5 E5 F5 | E5:3 G5:3 | D5:2 F5 E5:2 D5 | C5:2 A4 G4:3 | C5:3 D5 E5 F5 | E5:3 G5:3 |
  D5:2 F5 E5:2 D5 | C5:3 z:2 E5`);
const BLONDE_BASS = score(`C3 G2 C3:2 C3 F2 G2:2 C3 G2 C3:2 C3 F2 G2:2 F2:2 F2:2 G2:2 C3:2
  C3 G2 C3:2 G2:2 F2 G2 C3 G2 C3:2 G2:2 C3:2`);

/** The diatonic third below each note of C major, for the second reed. */
const THIRD_BELOW = [3, 0, 3, 0, 4, 3, 0, 3, 0, 4, 0, 4];

function paris(rate: number): Buffer {
  const bpm = 100, beat = 60 / bpm, pass = lengthOf(BLONDE) / 3, data = loop(rate, bpm, [...BLONDE_BASS, ...BLONDE_BASS], pass);
  bed(data, rate, bpm, BLONDE_BASS, { meter: 4, sub: 3, level: 0.85 });
  for (const start of [0, pass]) perform(BLONDE, 1 / 3, beat, start, (m, at, d) => {
    reed(data, rate, m, at, d * 0.92, 0.2);
    if (start > 0) reed(data, rate, m - THIRD_BELOW[m % 12]!, at, d * 0.92, 0.1);
  });
  return normalise(data, 0.35);
}

/**
 * Sydney: Waltzing Matilda, Banjo Paterson's words (1895) to Christina Macpherson's tune (she died in
 * 1936) as Marie Cowan (d. 1919) set it for Billy Tea, published 1903. Notes from the score on the English Wikipedia article (Cowan's
 * arrangement as printed in 1905), F major in 4/4, a quarter to the beat. A banjo, and a tin whistle on
 * the chorus.
 */
const MATILDA = score(`
  A4:3/2 A4:1/2 A4 A4 G4:2 G4:2 | F4:2 A4 F4 D4 E4 F4:2 | C4:2 F4:3/2 A4:1/2 C5:2 C5 C5 | C5 C5 C5:2 C5 z F4 G4 |
  A4:2 A4 A4 G4:2 G4:2 | F4 G4 A4 F4 D4 E4 F4:2 | C4:2 F4:3/2 A4:1/2 C5:2 Bb4 A4 | G4:2 G4 G4 F4:2 z:2 |
  C5:2 C5:3/2 C5:1/2 C5:2 A4:2 | F5:2 F5:3/2 E5:1/2 D5:2 C5:2 | C5:2 C5:3/2 C5:1/2 D5:2 C5:3/2 C5:1/2 | C5:2 Bb4 A4 G4 z F4 G4 |
  A4:2 A4 A4 G4:2 G4:2 | F4 G4 A4 F4 D4 E4 F4:2 | C4:2 F4:3/2 A4:1/2 C5:2 Bb4 A4 | G4:2 G4 G4 F4:2 z:2`);
const MATILDA_BASS = score(`F2:2 C2:2 F2:2 Bb1:2 F2:4 F2 C2 F2:2 F2:2 C2:2 F2:2 Bb1:2 F2:4 C2:2 F2:2
  F2:4 F2:2 Bb1 F2 F2:2 Bb1 F2 C2:4 F2:2 C2:2 F2:2 Bb1:2 F2:4 C2:2 F2:2`);

function sydney(rate: number): Buffer {
  const bpm = 122, beat = 60 / bpm, data = loop(rate, bpm, MATILDA_BASS, lengthOf(MATILDA) / 2);
  bed(data, rate, bpm, MATILDA_BASS, { meter: 4, level: 0.85 });
  perform(MATILDA, 0.5, beat, 0, (m, at, d, i) => {
    pluck(data, rate, m, at, Math.max(d, beat * 0.5) * 1.2, 0.28, 0.985, 0.8, i + 51);
    if (at >= 32 * beat && at < 48 * beat) flute(data, rate, m + 12, at, d * 0.95, 0.08, i + 3);
  });
  return normalise(data, 0.35);
}

/**
 * Lhasa: 阿玛勒火, a nangma of Lhasa, the song-and-dance once performed in the Potala's 囊玛岗; traditional.
 * Notes from the 简谱 《阿玛嘞火(囊玛)》 marked 西藏拉萨·藏族 (sung by 穷布赤, recorded by 陈义根; qupu123.com/
 * minge/sizi/p15017.html, the same score as printed in 人民日报海外版), 1 = D in 4/4: the refrain
 * 阿玛勒火, the first verse and the second verse up to its first ending, a quarter to the beat. A
 * dranyen lute over a drone and singing bowls, a bamboo flute joining for the second verse.
 */
const AMALEHUO = score(`
  5:4 6:4 2':3 3' 1':2 7:2 | 6:12 5:4 | 6:2 2':2 1' 2' 6 1' 5:4 6:4 | 1':4 2':2 1' 2' 1':2 1':2 5 6 4 5 |
  2:4 5:2 4:2 4:2 5 4 2:2 4:2 | 5:4 6 1' 6 5 4:4 5:2 7:2 | 6:4 5:2 4 5 3:4 2 3 1:2 | 2:8 2:2 3:2 6,:2 1:2 |
  2:2 6,:2 5 6 4 5 2:2 2 2 1:2 7,:2 |
  3:6 5:2 6:4 2':4 | 1':2 2':2 6:2 5:2 3:2 5:2 2:2 3:2 | 1':4 1':2 5 6 3:2 5:2 2 3 1 2 |
  6,:4 2:2 1 2 1:2 2 1 6,:2 1:2 | 2:4 3 5 2 3 1:4 2:2 3:2 | 6:4 5:2 4:2 3:4 2 3 1:2 | 2:8 2:2 3:2 6,:2 1:2 |
  2:2 6,:2 5 6 4 5 2:2 2 2 1:2 7,:2`, 62);
const AMALEHUO_BASS = score(`E2:4 E2:4 E2:4 D2:4 E2:4 A1:4 D2:4 E2:4 E2:2 A1:2
  A1:2 E2:2 D2:2 A1:2 D2:2 A1:2 E2:2 D2:2 E2:2 D2:2 G2:2 D2:2 E2:4 E2:2 A1:2`);

function lhasa(rate: number): Buffer {
  const bpm = 96, beat = 60 / bpm, verse = 36, data = loop(rate, bpm, AMALEHUO_BASS, lengthOf(AMALEHUO) / 4);
  bed(data, rate, bpm, AMALEHUO_BASS, { meter: 4, level: 0.8 });
  for (let bar = 0; bar < 17; bar += 4) pad(data, rate, [40, 47, 52], bar * 4 * beat, 16 * beat, 0.12);
  for (let bar = 0; bar < 17; bar++) bell(data, rate, bar % 2 ? 78 : 71, bar * 4 * beat, beat * 3.8, 0.1);
  perform(AMALEHUO, 0.25, beat, 0, (m, at, d, i) => {
    pluck(data, rate, m, at, Math.max(d, beat * 0.5) * 1.6, 0.26, 0.994, 0.45, i + 11);
    if (at >= verse * beat) flute(data, rate, m + 12, at, Math.max(d, beat * 0.25), 0.08, i + 9);
  });
  return normalise(data, 0.34);
}

/**
 * Rome: Funiculì, Funiculà, Luigi Denza (1846-1922) to Peppino Turco's words, published by Ricordi in
 * 1880. Notes from the Ricordi edition on Wikimedia Commons (File:Funiculì_Funiculà_original_sheet_music.pdf,
 * plate 47127), its chorus "Jammo, jammo, 'ncoppa jammo jà", E-flat major in 6/8 with the dotted quarter on
 * the beat. A mandolin, trembling on the long notes, twice through, an accordion doubling it the second time.
 */
const FUNICULI = score(`
  D5:3 C5 z z | D5:3 C5 z z | Eb5:2 D5 C5:2 Eb5 | D5:4 z z | D5:3 C5 z z | D5:3 C5 z z | Eb5:2 D5 C5:2 Eb5 |
  Bb4 z G4 G4:2 G4 | G4:2 G4 G4:2 G4 | G4:2 G4 G4:2 G4 | G4:2 G4 G4:2 G4 | Eb5:6 | F5:2 Eb5 C5:2 Eb5 |
  Bb4 z G4 G4:2 Ab4 | Bb4:2 Ab4 G4:2 F4 | Eb4 z:5`);
const FUNICULI_BASS = score(`Bb1:2 Bb1:2 Bb1:2 Bb1:2 Bb1:2 Bb1:2 Bb1:2 Eb2:2 G2:2 C2:2 Bb1:2 Eb2:2 Ab2:2 Eb2:2 Bb1:2 Eb2:2`);

function rome(rate: number): Buffer {
  const bpm = 108, beat = 60 / bpm, pass = lengthOf(FUNICULI) / 3, data = loop(rate, bpm, [...FUNICULI_BASS, ...FUNICULI_BASS], pass);
  bed(data, rate, bpm, FUNICULI_BASS, { meter: 4, sub: 3, level: 0.85, kicks: [0, 1, 2, 3] });
  for (const start of [0, pass]) perform(FUNICULI, 1 / 3, beat, start, (m, at, d, i) => {
    const strokes = Math.max(1, Math.round(d / (beat / 6)));                   // tremolo on anything longer than an eighth
    for (let k = 0; k < (d > beat / 2 ? strokes : 1); k++)
      pluck(data, rate, m, at + k * beat / 6, (d > beat / 2 ? beat / 6 : d) * 1.6, k ? 0.16 : 0.24, 0.99, 0.75, i * 8 + k + 71);
    if (start > 0) reed(data, rate, m - 12, at, d * 0.9, 0.08);
  });
  return normalise(data, 0.35);
}

/**
 * New York: The Sidewalks of New York ("East Side, West Side"), Charles B. Lawlor (1852-1925) and James
 * W. Blake (1862-1935), published 1894. Notes from the 1894 sheet music (Howley, Haviland & Co.) in the
 * New York Public Library, on Wikimedia Commons as File:Sidewalks_of_New_York_(NYPL_Hades-454371-1822567).jpg:
 * the 32-bar chorus with its second ending, G major waltz, a quarter to the beat. A saloon piano.
 */
const SIDEWALKS = score(`
  D5:3 | B4:3 | A4:3 | G4:3 | A4:2 G4 | E4:2 F#4 | G4:3 | - - G4 | G4:2 G4 | A4 G4 E4 | D4 G4:2 | C5:2 B4 |
  B4 A4:2 | A4:2 E4 | A4:3 | - - - | B4:2 D5 | A4:2 B4 | G4 B4:2 | - - - | G4:2 G4 | A4 G4 E4 | G4:3 | - - z |
  G4:2 G4 | A4 G4 E4 | D4 G4:2 | C5:2 B4 | B4 A4:2 | E4:2 F#4 | G4:3 | - - z`);
const SIDEWALKS_BASS = score(`G2:3 G2:3 D2:3 G2:3 C2:3 D2:3 G2:3 G2:3 G2:3 C2:3 G2:3 C2:3 G2:3 A1:3 D2:3 D2:3
  G2:3 D2:3 G2:3 E2:3 C2:3 A1:3 G2:3 G2:3 G2:3 C2:3 G2:3 C2:3 G2:3 D2:3 G2:3 G2:3`);

function newYork(rate: number): Buffer {
  const bpm = 150, beat = 60 / bpm, data = loop(rate, bpm, SIDEWALKS_BASS, lengthOf(SIDEWALKS));
  bed(data, rate, bpm, SIDEWALKS_BASS, { meter: 3, kicks: [0, 2], level: 0.85 });
  perform(SIDEWALKS, 1, beat, 0, (m, at, d) => {
    honkyTonk(data, rate, m + 12, at, Math.max(d, beat) * 0.95, 0.14);
    tone(data, rate, m, at, Math.max(d, beat) * 0.95, 0.08, 0.004, 0.25);
  });
  return normalise(data, 0.35);
}

/** Dubai: no Gulf folk tune with a checkable public-domain score was found, so this stays an original: D hijaz on an oud over the maqsum. */
function dubai(rate: number): Buffer {
  const bpm = 112, beat = 60 / bpm, harmony = score('D2:8 C2:8 Bb1:8 D2:8 D2:8 C2:8 Bb1:8 D2:8'), data = loop(rate, bpm, harmony, 64);
  bed(data, rate, bpm, harmony, { meter: 4, level: 0.85 });
  const maqsum: [number, boolean][] = [[0, true], [0.5, false], [1.5, false], [2, true], [3, false]];
  for (let bar = 0; bar < 16; bar++) for (const [at, low] of maqsum)
    handDrum(data, rate, (bar * 4 + at) * beat, low ? 0.26 : 0.12, low, bar * 8 + at * 4 + 5);
  const line = score('D4 Eb4 F#4 G4 A4 G4 F#4 Eb4 D4 z Eb4 D4 C4 D4 z z');
  const answer = score('A4 Bb4 C5 Bb4 A4 G4 F#4 G4 A4 G4 F#4 Eb4 D4 z D4 z');
  for (let p = 0; p < 8; p++) perform(p % 4 === 3 ? answer : line, 0.5, beat, p * 8,
    (m, at, d, i) => pluck(data, rate, m, at, d * 1.5, 0.26, 0.992, 0.3, p * 16 + i + 31));
  return normalise(data, 0.35);
}

/** Amboseli: marimbas in G major pentatonic, two interlocking lines a sixteenth apart, shakers on top. An original: no Maasai or East African tune with a checkable public-domain score was found. */
function savanna(rate: number): Buffer {
  const bpm = 114, beat = 60 / bpm, harmony = score('G2:8 E2:8 C2:8 D2:8 G2:8 E2:8 C2:8 D2:8'), data = loop(rate, bpm, harmony, 64);
  bed(data, rate, bpm, harmony, { meter: 4, level: 0.85 });
  for (let bar = 0; bar < 16; bar++) for (let s = 0; s < 16; s++) hat(data, rate, (bar * 4 + s / 4) * beat, s % 4 === 2 ? 0.07 : 0.03, bar * 32 + s + 3);
  const low = score('G4 B4 D5 B4 A4 D5 B4 G4 E4 G4 B4 G4 A4 B4 D5 E5');
  const high = score('G5 z A5 B5 z D6 B5 z A5 G5 z E5 G5 z A5 z');
  for (let p = 0; p < 8; p++) {
    perform(low, 0.5, beat, p * 8, (m, at) => marimba(data, rate, m, at, 0.2));
    perform(high, 0.5, beat, p * 8, (m, at) => marimba(data, rate, m, at + beat / 4, 0.16));
  }
  return normalise(data, 0.35);
}

/** Every loop the game can play. The first three rotate race by race on a route with no voice of its own. `bars` counts four-beat bars. */
export const RACE_PIECES: readonly MusicPiece[] = [
  { id: 'rush', bpm: 132, bars: 16, render: rush },
  { id: 'coast', bpm: 112, bars: 16, render: coast },
  { id: 'night', bpm: 100, bars: 16, render: night },
  { id: 'yeshenchen', bpm: 124, bars: 20, render: beijing },
  { id: 'zizhu', bpm: 104, bars: 20, render: shanghai },
  { id: 'amalehuo', bpm: 96, bars: 17, render: lhasa },
  { id: 'masang', bpm: 118, bars: 21, render: zhangjiajie },
  { id: 'sakura', bpm: 120, bars: 28, render: fuji },
  { id: 'gulf', bpm: 112, bars: 16, render: dubai },
  { id: 'katibim', bpm: 116, bars: 24, render: istanbul },
  { id: 'funiculi', bpm: 108, bars: 16, render: rome },
  { id: 'blonde', bpm: 100, bars: 20, render: paris },
  { id: 'lamma', bpm: 132, bars: 25, render: giza },
  { id: 'savanna', bpm: 114, bars: 16, render: savanna },
  { id: 'sidewalks', bpm: 150, bars: 24, render: newYork },
  { id: 'matilda', bpm: 122, bars: 16, render: sydney },
];

/** The loops that take turns when a route has no regional music of its own. */
export const ROTATION = ['rush', 'coast', 'night'] as const;
