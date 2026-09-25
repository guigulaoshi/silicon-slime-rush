import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packTiles } from '../vite.config';

/**
 * The release packing, tested without a build.
 *
 * This is the whole point of -- the pipeline writes loose tiles and `npm run build` packs
 * them for itch.io, which counts files and stops at a thousand. Nothing else would notice if it
 * stopped happening: the runtime reads both shapes, so a dist full of loose tiles loads perfectly
 * and every browser test stays green, right up until an upload of 400-odd files is refused.
 *
 * `closeBundle` is called directly against a temporary dist tree, so this costs milliseconds. The
 * plugin takes the directory as an argument for exactly that reason -- the build passes its own.
 */
let dist = '';
const run = async (): Promise<void> => {
  const plugin = packTiles(dist) as { closeBundle: (this: unknown) => Promise<void> };
  await plugin.closeBundle.call({});
};

// 'sydney' stands in for the old 'goldengate' fixture id: `playable()` (src/app/tracks.ts) now
// requires the id to be in both CATALOGUE and BUILT, and goldengate is gone with the rest of the
// Bay Area set. 'san-tomas' below is kept as the "retired" example: it was never real either way.
function track(id: string, tiles: Record<string, string>): string {
  const dir = resolve(dist, 'tracks', id);
  mkdirSync(resolve(dir, 'tiles'), { recursive: true });
  for (const [name, body] of Object.entries(tiles)) {
    writeFileSync(resolve(dir, 'tiles', `${name}.glb`), body);
  }
  writeFileSync(resolve(dir, 'track.json'),
    JSON.stringify({ id, tiles: Object.keys(tiles).map((name) => ({ name, sRanges: [], bounds: [] })) }));
  return dir;
}

afterEach(() => { if (dist) rmSync(resolve(dist, '..'), { recursive: true, force: true }); });

describe('packing the tiles for release', () => {
  it('writes one file per track, in the index order, and takes the loose copies away', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'sr-pack-'));
    dist = resolve(root, 'dist');
    const dir = track('sydney', { t_0_0: 'AAAA', t_1_0: 'BBBBBB' });
    await run();
    const doc = JSON.parse(readFileSync(resolve(dir, 'track.json'), 'utf-8'));
    expect(doc.tilePack).toEqual({ file: 'tiles.bin', bytes: 10 });
    expect(doc.tiles.map((t: { offset: number; length: number }) => [t.offset, t.length]))
      .toEqual([[0, 4], [4, 6]]);
    expect(readFileSync(resolve(dir, 'tiles.bin'), 'utf-8')).toBe('AAAABBBBBB');
    expect(statSync(resolve(dir, 'tiles'), { throwIfNoEntry: false })).toBeUndefined();
  });

  it('drops retired routes while preserving playable and synthetic routes', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'sr-pack-'));
    dist = resolve(root, 'dist');
    const retired = track('san-tomas', { t_0_0: 'OLD' });
    const current = track('sydney', { t_0_0: 'ROAD' });
    const synthetic = track('synth-loop', { t_0_0: 'LOOP' });
    await run();
    expect(statSync(retired, { throwIfNoEntry: false })).toBeUndefined();
    expect(readFileSync(resolve(current, 'tiles.bin'), 'utf-8')).toBe('ROAD');
    expect(readFileSync(resolve(synthetic, 'tiles.bin'), 'utf-8')).toBe('LOOP');
  });

  it('refuses to ship a track that has neither shape', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'sr-pack-'));
    dist = resolve(root, 'dist');
    const dir = track('sydney', { t_0_0: 'AAAA' });
    rmSync(resolve(dir, 'tiles'), { recursive: true });
    await expect(run()).rejects.toThrow(/would ship broken/);
  });

  it('leaves an already-packed track alone', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'sr-pack-'));
    dist = resolve(root, 'dist');
    const dir = track('sydney', { t_0_0: 'AAAA' });
    rmSync(resolve(dir, 'tiles'), { recursive: true });
    writeFileSync(resolve(dir, 'tiles.bin'), 'AAAA');
    await run();
    expect(readFileSync(resolve(dir, 'tiles.bin'), 'utf-8')).toBe('AAAA');
  });
});
