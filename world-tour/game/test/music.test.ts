import { expect, it } from 'vitest';
import { musicSamples, RACE_MUSIC_RATE, RACE_PIECES, ROTATION } from '../src/audio/music';
import { CATALOGUE } from '../src/app/tracks';

it('renders an audible finite eight-bar loop with headroom and continuous loop endpoints', () => {
  const samples = musicSamples(24000);
  expect(samples.length).toBe(480000);
  let peak = 0; let energy = 0; let finite = true;
  for (const value of samples) { finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value)); energy += value * value; }
  expect(finite).toBe(true);
  expect(peak).toBeGreaterThan(0.1);
  expect(peak).toBeLessThan(0.5);
  expect(Math.sqrt(energy / samples.length)).toBeGreaterThan(0.02);
  // The last note tails into the opening beat; the join must be continuous, not silent.
  expect(Math.abs(samples[0]! - samples.at(-1)!)).toBeLessThan(0.002);
});

it('renders distinct race loops, each longer than the menu loop, with headroom and a join that does not click', () => {
  expect(ROTATION).toEqual(['rush', 'coast', 'night']);
  expect(RACE_PIECES.length).toBeGreaterThan(ROTATION.length);
  const rendered = RACE_PIECES.map(piece => ({ piece, samples: piece.render(RACE_MUSIC_RATE) }));
  for (const { piece, samples } of rendered) {
    const seconds = samples.length / RACE_MUSIC_RATE;
    expect(seconds, piece.id).toBeCloseTo(piece.bars * 4 * 60 / piece.bpm, 2);
    expect(seconds, `${piece.id} is longer than the 20 s menu loop`).toBeGreaterThan(28);
    let peak = 0, energy = 0, finite = true;
    for (const value of samples) { finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value)); energy += value * value; }
    expect(finite, piece.id).toBe(true);
    expect(peak, piece.id).toBeGreaterThan(0.2); expect(peak, piece.id).toBeLessThan(0.5);
    expect(Math.sqrt(energy / samples.length), piece.id).toBeGreaterThan(0.03);
    // No step at the loop point bigger than the largest step inside the loop.
    let step = 0;
    for (let i = 1; i < samples.length; i++) step = Math.max(step, Math.abs(samples[i]! - samples[i - 1]!));
    expect(Math.abs(samples[0]! - samples.at(-1)!), piece.id).toBeLessThanOrEqual(step);
  }
  // Different music, not the same notes at another length: compare the first two seconds.
  const head = (samples: Float32Array) => Array.from(samples.subarray(0, RACE_MUSIC_RATE * 2));
  const corr = (a: number[], b: number[]) => {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) { ab += a[i]! * b[i]!; aa += a[i]! ** 2; bb += b[i]! ** 2; }
    return ab / Math.sqrt(aa * bb);
  };
  for (let i = 0; i < rendered.length; i++) for (let j = i + 1; j < rendered.length; j++)
    expect(Math.abs(corr(head(rendered[i]!.samples), head(rendered[j]!.samples)))).toBeLessThan(0.3);
});

it('gives every route a loop of its own, and every regional loop is heard on some route', () => {
  const ids = new Set(RACE_PIECES.map(p => p.id));
  for (const track of CATALOGUE) expect(ids.has(track.music), `${track.id} plays ${track.music}`).toBe(true);
  // Each route has its own local tune: no two routes share a loop, and none falls back to the rotation.
  const heard = CATALOGUE.map(t => t.music);
  expect(new Set(heard).size, heard.join(', ')).toBe(CATALOGUE.length);
  for (const id of heard) expect(ROTATION as readonly string[], id).not.toContain(id);
  const regional = RACE_PIECES.filter(p => !ROTATION.includes(p.id as typeof ROTATION[number]));
  expect(regional.length).toBe(CATALOGUE.length);
  for (const piece of regional) expect(heard, `${piece.id} is heard somewhere`).toContain(piece.id);
});
