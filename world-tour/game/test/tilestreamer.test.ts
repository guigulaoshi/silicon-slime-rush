import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordingColliderSink } from '../src/physics/colliders';
import type { TrackData, Vec3 } from '../src/track/types';
import { MaterialLibrary } from '../src/world/materials';
import { TileStreamer, forgetTilePacks } from '../src/world/TileStreamer';
import * as THREE from 'three';

/**
 * What the streamer does when the bytes it asked for are not a tile.
 *
 * Since every tile of a track lives inside one pack, "not a GLB" stopped being a corrupt-file
 * story and became an ordinary one: a `track.json` and a `tiles.bin` cached at different moments
 * hand the loader the middle of some other tile, exactly `length` bytes of it, which passes every
 * size check there is. `GLTFLoader.parse` throws *synchronously* on that -- it decodes the bytes as
 * JSON -- and `load`, which the streamer used before the pack, caught it. `parse` does not.
 *
 * An unhandled throw there does not look like a failure. It leaves the tile in `pending` for ever;
 * four of those and `MAX_CONCURRENT` is exhausted, the world stops loading entirely, and
 * `stats.failed` still reads zero, so `drive.spec.ts`'s `expect(failed).toBe(0)` stays green.
 */
function track(): TrackData {
  const points: Vec3[] = [];
  for (let i = 0; i < 51; i++) points.push([i * 2, 0, 0]);
  return {
    id: 't', version: 1, editions: ['full'], category: 'race', mode: 'p2p', laps: 1,
    name: { zh: '', en: '' }, blurb: { zh: '', en: '' },
    origin: { lat: 0, lon: 0 }, timeOfDay: 'day', car: 'sedan',
    spline: { points, halfWidth: new Array(51).fill(4), closed: false, length: 100 },
    start: { pos: [0, 0, 0], yaw: 0 }, checkpoints: [],
    tiles: [{ name: 't_0_0', offset: 0, length: 64, sRanges: [[0, 100]],
              bounds: [[-10, -10, -10], [10, 10, 10]] }],
    tilePack: { file: 'tiles.bin', bytes: 64 },
    attribution: [],
  } as unknown as TrackData;
}

function streamer(): TileStreamer {
  return new TileStreamer(track(), '/tracks/t', new MaterialLibrary(), new RecordingColliderSink());
}

/** The shape the pipeline writes and `npm run dev` serves: loose files, no pack, no byte ranges. */
function looseTrack(): TrackData {
  const t = track() as unknown as Record<string, unknown>;
  delete t.tilePack;
  t.tiles = [{ name: 't_0_0', sRanges: [[0, 100]], bounds: [[-10, -10, -10], [10, 10, 10]] }];
  return t as unknown as TrackData;
}

/** A pack whose bytes are not a GLB -- the middle of some other tile, as far as this can tell. */
function garbage(status = 206): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status, arrayBuffer: async () => new Uint8Array(64).fill(0x41).buffer,
  })));
}

afterEach(() => { vi.unstubAllGlobals(); forgetTilePacks(); });

describe('which shape of track it is reading', () => {
  // Two shapes ship: loose `tiles/<name>.glb` from the pipeline, one `tiles.bin` from the web build
  //Both have to work, and which one is in front of the streamer is stated by the
  // document rather than guessed -- so both are tested against the request that actually goes out.
  const seen: { url: string; init?: RequestInit }[] = [];
  const record = (): void => {
    seen.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(64).fill(0x41).buffer };
    }));
  };

  it('asks for the whole pack, with no Range header, when the track has one', async () => {
    // itch.io answers a ranged request with the whole file uncompressed, and the browser cache
    // answers one with a 206 it cut itself -- so the pack is fetched plainly, once.
    record();
    const s = streamer();
    s.update(0, 0, 0);
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]!.url).toBe('/tracks/t/tiles.bin');
    expect(seen[0]!.init).toBeUndefined();
  });

  it('asks for the tile file itself when the track has no pack', async () => {
    record();
    const s = new TileStreamer(looseTrack(), '/tracks/t', new MaterialLibrary(),
                               new RecordingColliderSink());
    s.update(0, 0, 0);
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]!.url).toBe('/tracks/t/tiles/t_0_0.glb');
    expect(seen[0]!.init).toBeUndefined();      // no Range: there is nothing to range into
  });

  it('refuses a half-converted document rather than parsing whatever sits at that offset', async () => {
    record();
    const half = track() as unknown as Record<string, unknown>;
    half.tiles = [{ name: 't_0_0', sRanges: [[0, 100]], bounds: [[-10, -10, -10], [10, 10, 10]] }];
    const s = new TileStreamer(half as unknown as TrackData, '/tracks/t', new MaterialLibrary(),
                               new RecordingColliderSink());
    s.update(0, 0, 0);
    await vi.waitFor(() => expect(s.stats.loading).toBe(0));
    expect(seen).toHaveLength(0);               // it never asked: a pack with no ranges is broken
    expect(s.stats.loaded).toBe(0);
  });
});

describe('a tile whose bytes are not a tile', () => {
  it('releases the request slot instead of holding it for ever', async () => {
    garbage();
    const s = streamer();
    s.update(0, 0, 0);
    await vi.waitFor(() => expect(s.stats.loading).toBe(0));
    expect(s.stats.loaded).toBe(0);
  });

  it('is counted as a failure, so something can go red', async () => {
    // Three attempts is MAX_RETRIES; before this fix the count stayed at zero however many times
    // it happened, and `drive.spec.ts` asserts on exactly that number.
    garbage();
    const s = streamer();
    for (let attempt = 0; attempt < 3; attempt++) {
      s.update(0, 0, 0);
      await vi.waitFor(() => expect(s.stats.loading).toBe(0));
    }
    expect(s.stats.failed).toBe(1);
  });

  it('does not keep asking once it has given up', async () => {
    garbage();
    const s = streamer();
    for (let attempt = 0; attempt < 5; attempt++) {
      s.update(0, 0, 0);
      await vi.waitFor(() => expect(s.stats.loading).toBe(0));
    }
    // It stops at three *attempts*. The pack itself is fetched once: a pack that arrived whole is kept
    // for every tile in it, so retrying a tile re-slices it rather than downloading 27 MB again.
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
    expect(s.stats.failed).toBe(1);
  });
});

describe('asking for a tile', () => {
  it('fetches the pack once however many times its tiles are asked for', async () => {
    garbage();
    const s = streamer();
    for (let attempt = 0; attempt < 3; attempt++) {
      s.update(0, 0, 0);
      await vi.waitFor(() => expect(s.stats.loading).toBe(0));
    }
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;
    expect(calls.map(([url]) => url)).toEqual(['/tracks/t/tiles.bin']);
    expect(calls[0]![1]).toBeUndefined();
  });

  it('asks again for a pack that arrived the wrong length instead of keeping it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(10),
    })));
    const s = streamer();
    for (let attempt = 0; attempt < 2; attempt++) {
      s.update(0, 0, 0);
      await vi.waitFor(() => expect(s.stats.loading).toBe(0));
    }
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });

  it('treats an HTTP error as a failure rather than as bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 416, arrayBuffer: async () => new ArrayBuffer(0),
    })));
    const s = streamer();
    s.update(0, 0, 0);
    await vi.waitFor(() => expect(s.stats.loading).toBe(0));
    expect(s.stats.loaded).toBe(0);
  });
});

describe('the production slime handoff', () => {
  it('hands extracted spawns to the sink and removes the same tile on unload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8),
    })));
    const s = new TileStreamer(looseTrack(), '/tracks/t', new MaterialLibrary(),
      new RecordingColliderSink());
    const scene = new THREE.Scene();
    const carrier = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
    carrier.name = 'props_slime_popper';
    carrier.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 1, 0));
    scene.add(carrier);
    const loader = (s as unknown as { loader: { parse(
      bytes: ArrayBuffer, path: string, loaded: (value: { scene: THREE.Scene }) => void,
    ): void } }).loader;
    loader.parse = (_bytes, _path, loaded) => loaded({ scene });
    const sink = { addTile: vi.fn(), removeTile: vi.fn() };
    s.setSlimeSink(sink);

    s.update(0, 0, 0);
    await vi.waitFor(() => expect(sink.addTile).toHaveBeenCalledOnce());
    expect(sink.addTile.mock.calls[0]![0]).toBe('t_0_0');
    expect(sink.addTile.mock.calls[0]![1]).toMatchObject([{ kind: 'popper', position: [10, 1, 0] }]);
    s.clear();
    expect(sink.removeTile).toHaveBeenCalledWith('t_0_0');
  });
});


describe('starting collision readiness', () => {
  it('waits for bytes, parsing and collider insertion before releasing the spawn', async () => {
    let release!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { release = resolve; })));
    const colliders = new RecordingColliderSink();
    const s = new TileStreamer(looseTrack(), '/tracks/t', new MaterialLibrary(), colliders);
    let parsed!: (value: { scene: THREE.Scene }) => void;
    (s as any).loader.parse = (_bytes: unknown, _path: string, loaded: typeof parsed) => { parsed = loaded; };
    let ready = false;
    const pending = s.prepareSpawn(0, 0).then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    release({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });
    await vi.waitFor(() => expect(parsed).toBeTypeOf('function'));
    expect(ready).toBe(false);
    parsed({ scene: new THREE.Scene() });
    await pending;
    expect(s.stats.loaded).toBe(1);
    expect(ready).toBe(true);
    s.clear();
  });

  it('uses the existing three retries and rejects missing start ground', async () => {
    garbage();
    const s = streamer();
    await expect(s.prepareSpawn(0, 0)).rejects.toThrow('could not be loaded');
    expect(fetch).toHaveBeenCalledTimes(1); // three attempts at the tile, one download of its pack
    expect(s.stats.failed).toBe(1);
    await expect(streamer().prepareSpawn(1000, 1000)).rejects.toThrow('No track tile');
  });
});


for (const finish of ['leave', 'clear', 'keep'] as const) it(`deduplicates requests and handles late tiles when drivers ${finish}`, async () => {
  let release!: (value: unknown) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { release = resolve; })));
  const colliders = new RecordingColliderSink();
  const s = new TileStreamer(looseTrack(), '/tracks/t', new MaterialLibrary(), colliders);
  let parsed!: (value: { scene: THREE.Scene }) => void;
  (s as any).loader.parse = (_bytes: unknown, _path: string, loaded: typeof parsed) => { parsed = loaded; };
  const at = { s: 0, x: 0, z: 0 };
  s.updateMany([at, at]); s.updateMany([at, at]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(s.collisionReady(0, 0, 5)).toBe(false);
  release({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });
  await vi.waitFor(() => expect(parsed).toBeTypeOf('function'));
  expect(s.collisionReady(0, 0, 5)).toBe(false);
  if (finish === 'clear') s.clear();
  else s.updateMany(finish === 'keep' ? [at, { s: 50000, x: 50000, z: 50000 }]
    : [{ s: 50000, x: 50000, z: 50000 }]);
  parsed({ scene: new THREE.Scene() });
  await vi.waitFor(() => expect(s.stats.loading).toBe(0));
  expect(s.stats.loaded).toBe(finish === 'keep' ? 1 : 0);
  expect(colliders.tiles.size).toBe(finish === 'keep' ? 1 : 0);
  expect(s.collisionReady(0, 0, 5)).toBe(finish === 'keep');
  s.clear();
});


it('lets another driver load past four failed tiles, then recovers when the network returns', async () => {
  let now = 0, offline = true;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const t = looseTrack();
  const base = t.tiles[0]!;
  t.tiles = [...Array.from({ length: 4 }, (_, i) => ({ ...base, name: `bad-${i}` })),
    { ...base, name: 'healthy', sRanges: [[5000, 5100]], bounds: [[4990, -10, -10], [5010, 10, 10]] }];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: !(offline && url.includes('bad-')), status: offline && url.includes('bad-') ? 503 : 200,
    arrayBuffer: async () => new ArrayBuffer(8),
  })));
  const s = new TileStreamer(t, '/tracks/t', new MaterialLibrary(), new RecordingColliderSink());
  (s as any).loader.parse = (_bytes: unknown, _path: string, loaded: (value: { scene: THREE.Scene }) => void) => loaded({ scene: new THREE.Scene() });
  try {
    const positions = [{ s: 0, x: 0, z: 0 }, { s: 5000, x: 5000, z: 0 }];
    for (let attempt = 0; attempt < 3; attempt++) {
      s.updateMany(positions); await vi.waitFor(() => expect(s.stats.loading).toBe(0));
    }
    expect(s.stats.failed).toBe(4);
    s.updateMany(positions); await vi.waitFor(() => expect(s.stats.loading).toBe(0));
    expect(s.collisionReady(5000, 0, 5)).toBe(true);
    expect(s.collisionReady(0, 0, 5)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(13);
    offline = false; now = 5001;
    s.updateMany(positions); await vi.waitFor(() => expect(s.stats.loading).toBe(0));
    expect(s.collisionReady(0, 0, 5)).toBe(true);
    expect(s.stats.failed).toBe(0);
    expect(s.stats.loaded).toBe(5);
    expect(fetch).toHaveBeenCalledTimes(17);
  } finally { s.clear(); clock.mockRestore(); }
});


it('prepares every initial-window tile across batches without loading the distant track', async () => {
  const t = looseTrack();
  const nearby = Array.from({ length: 9 }, (_, i) => ({ ...t.tiles[0]!, name: `near-${i}` }));
  t.tiles = [...nearby, { ...t.tiles[0]!, name: 'far', sRanges: [[10000, 10100]],
    bounds: [[10000, 0, 10000], [10100, 10, 10100]] }];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  const s = new TileStreamer(t, '/tracks/t', new MaterialLibrary(), new RecordingColliderSink());
  (s as any).loader.parse = (_bytes: unknown, _path: string, loaded: Function) => loaded({ scene: new THREE.Scene() });
  await s.prepareWindow([{ s: 0, x: 0, z: 0 }]);
  expect(s.stats.loaded).toBe(9);
  expect(s.stats.loading).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(9);
  s.clear();
});

it('rejects a failed initial window after the existing retry budget', async () => {
  garbage();
  await expect(streamer().prepareWindow([{ s: 0, x: 0, z: 0 }])).rejects.toThrow('could not be loaded');
  expect(fetch).toHaveBeenCalledTimes(1); // three attempts at the tile, one download of its pack
});
