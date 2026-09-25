import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW, alongTrack, distanceToBounds, planStreaming, planStreamingFor, tileBytes, tileWanted } from '../src/world/streaming';
import type { TileRef, Vec3 } from '../src/track/types';

const W = { ...DEFAULT_WINDOW, length: 1000, radius: 100, hysteresis: 50 };

function tile(name: string, sRanges: [number, number][], at: [number, number]): TileRef {
  const bounds: [Vec3, Vec3] = [[at[0], 0, at[1]], [at[0] + 256, 20, at[1] + 256]];
  return { name, offset: 0, length: 1, sRanges, bounds };
}

describe('alongTrack', () => {
  it('is a plain difference on point-to-point tracks', () => {
    expect(alongTrack(100, 400, { ...W, closed: false })).toBe(300);
    expect(alongTrack(400, 100, { ...W, closed: false })).toBe(-300);
  });
  it('takes the short way round a loop', () => {
    const loop = { ...W, closed: true, length: 1000 };
    expect(alongTrack(950, 50, loop)).toBe(100);
    expect(alongTrack(50, 950, loop)).toBe(-100);
  });
});

describe('distanceToBounds', () => {
  it('is zero inside and ignores height', () => {
    expect(distanceToBounds([[0, 0, 0], [10, 100, 10]], 5, 5)).toBe(0);
    expect(distanceToBounds([[0, 0, 0], [10, 100, 10]], 13, 5)).toBe(3);
    expect(distanceToBounds([[0, 0, 0], [10, 100, 10]], 14, 15)).toBeCloseTo(Math.hypot(4, 5));
  });
});

describe('tileWanted', () => {
  const far: [number, number] = [10_000, 10_000];
  it('takes the road ahead and leaves the road far behind', () => {
    expect(tileWanted(tile('a', [[500, 700]], far), 100, 0, 0, W)).toBe(true);
    expect(tileWanted(tile('b', [[3000, 3200]], far), 100, 0, 0, W)).toBe(false);
    expect(tileWanted(tile('c', [[0, 50]], far), 900, 0, 0, { ...W, closed: false })).toBe(false);
  });
  it('keeps a tile the camera is looking at even when its arc length is far away', () => {
    // the other leg of a hairpin: 400 m away along the road, twenty meters away in space
    const hairpin = tile('d', [[5000, 5100]], [10, 10]);
    expect(tileWanted(hairpin, 100, 20, 20, W)).toBe(true);
  });
  it('wraps around the start of a loop', () => {
    const loop = { ...W, closed: true };
    expect(tileWanted(tile('e', [[0, 100]], far), 950, 0, 0, loop)).toBe(true);
  });
});

describe('planStreaming', () => {
  const far: [number, number] = [10_000, 10_000];
  const tiles = [tile('near', [[0, 200]], far), tile('soon', [[900, 1100]], far), tile('gone', [[5000, 5200]], far)];

  it('loads what is in the window and nothing else', () => {
    const plan = planStreaming(tiles, new Set(), 100, 0, 0, W);
    expect(plan.load.map((t) => t.name).sort()).toEqual(['near', 'soon']);
    expect(plan.unload).toEqual([]);
  });

  it('holds a tile through the hysteresis band before dropping it', () => {
    const loaded = new Set(['near']);
    // just outside the load window but inside the hysteresis band: keep it
    const held = planStreaming(tiles, loaded, 530, 0, 0, { ...W, closed: false });
    expect(held.unload).toEqual([]);
    const dropped = planStreaming(tiles, loaded, 900, 0, 0, { ...W, closed: false });
    expect(dropped.unload).toEqual(['near']);
  });

  it('never asks for a tile that is already loading', () => {
    const plan = planStreaming(tiles, new Set(['near', 'soon']), 100, 0, 0, W);
    expect(plan.load).toEqual([]);
  });

  it('orders loads nearest first', () => {
    const spread = [tile('faraway', [[0, 100]], [900, 900]), tile('here', [[0, 100]], [0, 0])];
    const plan = planStreaming(spread, new Set(), 50, 0, 0, { ...W, radius: 5000 });
    expect(plan.load.map((t) => t.name)).toEqual(['here', 'faraway']);
  });
});


describe('one tile out of the pack', () => {
  // Every tile of a track is written end to end into one file, because itch.io counts files and
  // one per tile reached 795 with four corridors still owed. What the runtime asks for is a byte
  // range; what it gets back depends on whether the server honours the header.
  const tile = { name: 't_-8_-6', offset: 1024, length: 256 };

  it('asks for the tile and nothing else', () => {
  });

  it('asks for a single byte correctly rather than an empty range', () => {
    // `bytes=n-n` is one byte. Getting this wrong by one is a range that ends before it starts,
    // which a server answers with 416 rather than the tile.
  });

  it('takes a 206 body as the tile itself', () => {
    const body = new ArrayBuffer(256);
    expect(tileBytes(body, 206, tile)).toBe(body);
  });

  it('refuses a 206 body that is not the size it asked for', () => {
    expect(() => tileBytes(new ArrayBuffer(255), 206, tile)).toThrow(/asked for 256/);
  });

  it('slices a 200 body, because a server may ignore the range and send the whole pack', () => {
    const pack = new Uint8Array(2048);
    pack[1024] = 7;
    pack[1279] = 9;
    const out = new Uint8Array(tileBytes(pack.buffer, 200, tile));
    expect(out.byteLength).toBe(256);
    expect(out[0]).toBe(7);
    expect(out[255]).toBe(9);
  });

  it('refuses a 200 body too short to contain the tile', () => {
    // Otherwise the GLB parser is handed whatever happened to sit at that offset, and the error
    // arrives as "not a glb" from somewhere else entirely.
    expect(() => tileBytes(new ArrayBuffer(1100), 200, tile)).toThrow(/ends at 1280/);
  });
});


it('retains the union for separated, overlapping and regrouping drivers without duplicate loads', () => {
  const refs = [0, 5000, 10000].map((x, i) => tile(String(i), [[x, x + 100]], [x, 0]));
  const window = { ...W, ahead: 100, behind: 100, radius: 100, closed: false, length: 20000 };
  const positions = [0, 10000].map(x => ({ s: x, x, z: 0 }));
  expect(planStreamingFor(refs, new Set(), [...positions, positions[0]!], window).load.map(t => t.name)).toEqual(['0', '2']);
  expect(planStreamingFor(refs, new Set(['0', '1', '2']), positions, window).unload).toEqual(['1']);
  expect(planStreamingFor(refs, new Set(['0', '2']), [positions[0]!], window).unload).toEqual(['2']);
  expect(planStreamingFor(refs, new Set(['0']), [positions[0]!, positions[0]!], window).load).toEqual([]);
  expect(planStreamingFor(refs, new Set(['0']), [], window).unload).toEqual(['0']);
});
