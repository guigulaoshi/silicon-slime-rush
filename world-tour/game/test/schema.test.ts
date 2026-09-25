import { afterEach, describe, expect, it, vi } from 'vitest';
import example from '../../pipeline/sr/schema/examples/minimal.track.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTrack, parseTrack, trackErrors } from '../src/track/schema';
import { MATERIAL_NAMES, NODE_COLLIDERS } from '../src/track/types';
import type { TrackData } from '../src/track/types';

const clone = () => JSON.parse(JSON.stringify(example)) as Record<string, unknown>;

afterEach(() => vi.unstubAllGlobals());

describe('track.json contract', () => {
  it('accepts the shared example', () => {
    expect(trackErrors(example)).toEqual([]);
    expect(parseTrack(example).id).toBe('synth-loop');
  });
  it('accepts a bounded route-specific camera height', () => {
    const t = clone(); t.camera = { heightM: 3.2 };
    expect(trackErrors(t)).toEqual([]);
    t.camera = { heightM: 9 };
    expect(trackErrors(t).some((e) => e.includes('heightM'))).toBe(true);
  });
  it('rejects a race track with a countdown', () => {
    const t = clone(); t.countdown = { seconds: 100 };
    expect(trackErrors(t).length).toBeGreaterThan(0);
  });
  it('requires countdown and story on missions', () => {
    const t = clone(); t.category = 'mission';
    expect(trackErrors(t).length).toBeGreaterThan(0);
    t.countdown = { seconds: 200 }; t.story = { zh: '跑', en: 'run' };
    expect(trackErrors(t)).toEqual([]);
  });
  it('accepts the two place-driven categories in both schema and runtime types', () => {
    const categories: TrackData['category'][] = ['scenic', 'campus'];
    for (const category of categories) {
      const t = clone(); t.category = category;
      expect(parseTrack(t).category).toBe(category);
    }
  });
  it('checks halfWidth length like the pipeline does', () => {
    const t = clone(); (t.spline as { halfWidth: number[] }).halfWidth.push(4);
    expect(trackErrors(t).some((e) => e.includes('halfWidth'))).toBe(true);
  });
  it('checks an exported sample arc against the same three-dimensional points as the pipeline', () => {
    const t = clone(); t.mode = 'p2p'; t.laps = 1;
    t.spline = { points: [[0,0,0],[3,4,0],[6,4,0]], halfWidth: [4,4,4],
      closed: false, s: [0,5,8], length: 8 };
    t.checkpoints = [
      {s:0,pos:[0,0,0],dir:[1,0,0],halfWidth:4},
      {s:8,pos:[6,4,0],dir:[1,0,0],halfWidth:4},
    ];
    expect(trackErrors(t)).toEqual([]);
    (t.spline as {s:number[]}).s = [0,3,6];
    expect(trackErrors(t).some((e) => e.includes('three-dimensional arc'))).toBe(true);
  });
  it('rejects stop checkpoints outside multistop', () => {
    const t = clone(); (t.checkpoints as { stop?: boolean }[])[1]!.stop = true;
    expect(trackErrors(t).some((e) => e.includes('stop'))).toBe(true);
  });
  it('throws with every violation listed', () => {
    const t = clone(); t.id = 'Bad ID'; delete t.tiles;
    expect(() => parseTrack(t)).toThrow(/invalid track.json/);
  });
});

describe('track downloads', () => {
  it('reuses one validated download without sharing mutable route data', async () => {
    const fetchTrack = vi.fn(async () => ({ ok: true, json: async () => clone() } as Response));
    vi.stubGlobal('fetch', fetchTrack);
    const first = await loadTrack('synth-loop', './cache-test');
    first.start.pos[0] = 99;
    const second = await loadTrack('synth-loop', './cache-test');
    expect(fetchTrack).toHaveBeenCalledOnce();
    expect(second.start.pos[0]).toBe(example.start.pos[0]);
  });

  it('retries a download that failed', async () => {
    const fetchTrack = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => clone() } as Response);
    vi.stubGlobal('fetch', fetchTrack);
    await expect(loadTrack('synth-loop', './retry-test')).rejects.toThrow('HTTP 503');
    await expect(loadTrack('synth-loop', './retry-test')).resolves.toMatchObject({ id: 'synth-loop' });
    expect(fetchTrack).toHaveBeenCalledTimes(2);
  });
});

describe('the node table', () => {
  it('says the same thing the contract says', () => {
    // The pipeline stamps a collider kind onto every node and the runtime honours it, so this table
    // and the exporter's have to agree with the document both were written from. A guardrail once
    // shipped with the exporter missing the row: it rendered, and nothing ever touched it.
    const doc = readFileSync(resolve(process.cwd(), '..', 'docs', 'CONTRACT.md'), 'utf-8');
    const rows: Record<string, string> = {};
    for (const m of doc.matchAll(/^\| `([a-z_]+)` \| [^|]* \| `([a-z-]+)`/gm)) rows[m[1]!] = m[2]!;
    expect(Object.keys(rows).length).toBeGreaterThan(5);
    expect({ ...NODE_COLLIDERS }).toEqual(rows);
  });
});

describe('the material list', () => {
  it('says the same thing the contract says', () => {
    // Tiles carry material names rather than textures, so a name the library has never heard of
    // renders magenta. The contract keeps the list as a plain block that both sides read back.
    const doc = readFileSync(resolve(process.cwd(), '..', 'docs', 'CONTRACT.md'), 'utf-8');
    const block = /## 4\.[\s\S]*?```text\n([\s\S]*?)```/.exec(doc);
    expect(block, 'could not read the material list out of docs/CONTRACT.md').toBeTruthy();
    expect([...MATERIAL_NAMES]).toEqual(block![1]!.trim().split(/\s+/));
  });
});
