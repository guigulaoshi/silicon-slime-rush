import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ColliderSink } from '../physics/colliders';
import type { TileRef, TrackData } from '../track/types';
import type { SlimeDensity } from '../app/Save';
import type { MaterialLibrary } from './materials';
import { disposeTile, readTile } from './tileContent';
import type { TileSlimeSpawn } from './Slimes';
import { DEFAULT_WINDOW, distanceToBounds, planStreamingFor, tileWanted, tileBytes, type StreamWindow, type StreamPosition } from './streaming';
import type { Quality } from './World';
import { configureEnvironmentTile, tileWithinShadowDistance } from './environmentShadows';
import { applyTreeDensity } from './treeDensity';

const MAX_CONCURRENT = 4;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

interface LoadedTile {
  ref: TileRef;
  group: THREE.Group;
  slimes: TileSlimeSpawn[];
  shadowState: string;
}

export interface SlimeTileSink {
  addTile(file: string, spawns: readonly TileSlimeSpawn[]): void;
  removeTile(file: string): void;
}

export interface StreamerStats {
  loaded: number;
  loading: number;
  failed: number;
  generation: number;
}

/**
 * Keeps the tiles around the car in the scene and everything else out of it.
 *
 * Two rules matter more than the rest. Requests carry the generation they were issued in, so a tile
 * that arrives after the car has driven out of its window is discarded instead of being added behind
 * the player. And a tile is always removed from physics before its geometry is released, because the
 * reverse order leaves the physics world pointing at freed vertex data for one step.
 */
export class TileStreamer {
  private readonly loader = new GLTFLoader();
  private readonly loaded = new Map<string, LoadedTile>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, number>();
  private readonly retryAt = new Map<string, number>();
  private readonly unknownMaterials = new Set<string>();
  private slimeSink: SlimeTileSink | null = null;
  private generation = 0;
  private epoch = 0;
  private positions: readonly StreamPosition[] = [];

  readonly root = new THREE.Group();
  readonly window: StreamWindow;

  constructor(
    private readonly track: TrackData,
    private readonly baseUrl: string,
    private readonly materials: MaterialLibrary,
    private readonly colliders: ColliderSink,
    window?: Partial<StreamWindow>,
    private readonly slimeDensity: SlimeDensity = 'normal',
    private quality: Quality = 'high',
  ) {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.root.name = `tiles:${track.id}`;
    this.window = {
      ...DEFAULT_WINDOW,
      closed: track.spline.closed,
      length: track.spline.length,
      ...window,
    };
  }

  get stats(): StreamerStats {
    return {
      loaded: this.loaded.size,
      loading: this.pending.size,
      failed: [...this.failures.values()].filter((n) => n >= MAX_RETRIES).length,
      generation: this.generation,
    };
  }

  setSlimeSink(sink: SlimeTileSink | null): void {
    if (this.slimeSink === sink) return;
    if (this.slimeSink) for (const file of this.loaded.keys()) this.slimeSink.removeTile(file);
    this.slimeSink = sink;
    if (sink) for (const [file, tile] of this.loaded) sink.addTile(file, tile.slimes);
  }

  /** Load solid ground around the whole starting combination before creating its bodies. */
  async prepareSpawn(x: number, z: number): Promise<void> {
    const epoch = this.epoch;
    const required = this.track.tiles.filter(tile => distanceToBounds(tile.bounds, x, z) <= 8);
    if (!required.length) throw new Error('No track tile covers the start');
    this.shadowX = x; this.shadowZ = z;
    while (required.some(tile => !this.loaded.has(tile.name))) {
      const missing = required.filter(tile => !this.loaded.has(tile.name));
      const failed = missing.find(tile => (this.failures.get(tile.name) ?? 0) >= MAX_RETRIES);
      if (failed) throw new Error(`Starting tile ${failed.name} could not be loaded`);
      await Promise.all(missing.slice(0, MAX_CONCURRENT).map(tile => this.begin(tile)));
      if (epoch !== this.epoch) throw new Error('Track streaming was cleared');
    }
  }

  /** Finish the normal initial streaming window while the loading screen still covers it. */
  async prepareWindow(positions: readonly StreamPosition[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const epoch = this.epoch;
    const required = planStreamingFor(this.track.tiles, new Set(), positions, this.window).load;
    const report = () => onProgress?.(required.filter(tile => this.loaded.has(tile.name)).length, required.length);
    report();
    while (required.some(tile => !this.loaded.has(tile.name))) {
      const failed = required.find(tile => (this.failures.get(tile.name) ?? 0) >= MAX_RETRIES);
      if (failed) throw new Error(`Starting tile ${failed.name} could not be loaded`);
      this.updateMany(positions);
      // report as each tile lands, not once per batch, so the bar moves tile by tile
      for (const tile of this.pending.values()) void tile.then(report, report);
      await Promise.all(this.pending.values());
      report();
      if (epoch !== this.epoch) throw new Error('Track streaming was cleared');
    }
  }

  update(s: number, x: number, z: number): void { this.updateMany([{ s, x, z }]); }

  collisionReady(x: number, z: number, radius: number): boolean {
    const required = this.track.tiles.filter(tile => distanceToBounds(tile.bounds, x, z) <= radius);
    // Outside authored tiles there is nothing to wait for; Race still owns off-track rescue.
    return required.every(tile => this.loaded.has(tile.name));
  }

  updateMany(positions: readonly StreamPosition[]): void {
    this.positions = positions;
    const { x = 0, z = 0 } = positions[0] ?? {};
    this.generation++;
    this.shadowX = x;
    this.shadowZ = z;
    for (const tile of this.loaded.values()) this.updateTileShadows(tile, x, z);
    const { load, unload } = planStreamingFor(this.track.tiles, this.keys(), positions, this.window);
    for (const file of unload) this.drop(file);
    const free = MAX_CONCURRENT - this.pending.size;
    const eligible = load.filter(ref => !this.pending.has(ref.name)
      && ((this.failures.get(ref.name) ?? 0) < MAX_RETRIES
        || performance.now() >= (this.retryAt.get(ref.name) ?? Infinity)));
    for (const ref of eligible.slice(0, Math.max(free, 0))) {
      if ((this.failures.get(ref.name) ?? 0) >= MAX_RETRIES) this.failures.delete(ref.name);
      this.retryAt.delete(ref.name);
      this.begin(ref);
    }
  }

  /** Auto-quality changes loaded geometry in place; tiles that arrive later read this same value. */
  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    for (const tile of this.loaded.values()) {
      tile.shadowState = '';
      this.updateTileShadows(tile, this.shadowX, this.shadowZ);
    }
  }

  /** Drop everything and release it. Called when leaving a track. */
  clear(): void {
    this.epoch++;
    this.positions = [];
    for (const file of [...this.loaded.keys()]) this.drop(file);
    this.pending.clear();
    this.failures.clear();
    this.retryAt.clear();
  }

  private keys(): Set<string> {
    const keys = new Set(this.loaded.keys());
    for (const file of this.pending.keys()) keys.add(file);
    return keys;
  }

  /**
   * Fetch one tile's bytes, in whichever shape this track was written in.
   *
   * **Loose file, or a byte range inside one pack.** The pipeline writes `tiles/<name>.glb`, one
   * file each, so a rebuild rewrites only what changed; `npm run build` packs those into
   * `tiles.bin` on the way into `dist/`, because itch.io counts files and one per tile crossed
   * eight hundred. Which one is here is not a guess: the `track.json` beside the bytes
   * either has a `tilePack` or it does not.
   *
   * For the pack it is a `Range` header. A server that honours it answers 206 with just those
   * bytes; one that does not answers 200 with the whole pack, and the slice in `tileBytes` is what
   * keeps that case correct rather than fast -- `vite preview` and itch.io both honour it, so the
   * slow path is a safety net and not the normal one.
   */
  private async fetchTile(ref: TileRef): Promise<ArrayBuffer> {
    const pack = this.track.tilePack;
    // A packed track carries the range on every entry; a loose one carries none. Reading the two
    // facts together rather than trusting either alone means a half-converted document -- a pack
    // header with no offsets, or offsets with no pack -- fails here with its own name in the
    // message instead of handing the GLB parser somebody else's bytes.
    const range = pack && ref.offset !== undefined && ref.length !== undefined
      ? { name: ref.name, offset: ref.offset, length: ref.length }
      : null;
    if (pack && !range) throw new Error(`${ref.name}: packed track with no byte range`);
    const url = range ? `${this.baseUrl}/${pack!.file}` : `${this.baseUrl}/tiles/${ref.name}.glb`;
    if (!range) return fetchBody(url);
    // The whole pack, once, and every tile sliced out of it -- no Range header at all. Asking for
    // ranges was the plan and it cannot be made reliable where the game actually lives: itch.io
    // answers a ranged request with 200 and the whole file *uncompressed* (27 MB for Highway 101
    // instead of the 10 MB it sends gzipped to a plain request), and the browser's own cache answers
    // a ranged request with a 206 it cut itself, so a probe learns "ranges work" from the cache and
    // the next dozen tiles each pull the full pack from the network (measured on the live page on
    //Fifteen 27 MB downloads for one Highway 101 start, and an intermittent failed
    // load). Unity and Godot web builds do the same thing for the same reason: a bundle per level,
    // fetched whole.
    return tileBytes(await wholePack(url, pack!.bytes), 200, range);
  }

  private begin(ref: TileRef): Promise<void> {
    const existing = this.pending.get(ref.name);
    if (existing) return existing;
    const issued = this.generation;
    const epoch = this.epoch;
    const failed = (err: unknown) => {
      if (epoch !== this.epoch) return;
      this.pending.delete(ref.name);
      const n = (this.failures.get(ref.name) ?? 0) + 1;
      this.failures.set(ref.name, n);
      if (n >= MAX_RETRIES) {
        this.retryAt.set(ref.name, performance.now() + RETRY_DELAY_MS);
        console.error(`tile ${ref.name}: failed after ${n} attempts; retrying later`, err);
      }
    };
    const pending = this.fetchTile(ref).then((bytes) => new Promise<void>((resolve, reject) => {
      // `parse`, not `load`: the bytes are already here, and the path argument is the base for
      // external resources a tile never has (they carry no textures -- see docs/CONTRACT.md).
      //
      // `.then(ok).catch(failed)`, never `.then(ok, failed)`: `parse` throws *synchronously* when
      // the bytes are not a GLB -- it decodes them as JSON and lets SyntaxError out -- and the
      // two-argument form does not see what its own success handler throws. Since every tile now
      // lives inside one pack, "not a GLB" is a real input rather than a corrupt file: a
      // `track.json` and a `tiles.bin` cached at different moments hand this the middle of some
      // other tile, exactly `length` bytes of it, which both size checks accept. Unseen, the
      // pending slot never clears, and after four of those the streamer stops loading anything at
      // all while `stats.failed` still reads zero. game/test/tilestreamer.test.ts holds this shape.
      this.loader.parse(bytes, '', (gltf) => {
        if (epoch === this.epoch) this.pending.delete(ref.name);
        // the car may have driven out of this tile's window while it was in flight
        if (epoch !== this.epoch || (this.generation !== issued && !this.stillWanted(ref))) {
          disposeTile(gltf.scene);
          resolve();
          return;
        }
        const content = readTile(gltf.scene, this.materials, this.slimeDensity, this.quality);
        for (const name of this.materials.unknown(content.materialNames)) {
          if (!this.unknownMaterials.has(name)) {
            this.unknownMaterials.add(name);
            console.error(`tile ${ref.name}: no material named "${name}" in the library`);
          }
        }
        this.root.add(content.group);
        const tile = { ref, group: content.group, slimes: content.slimes, shadowState: '' };
        this.loaded.set(ref.name, tile);
        this.updateTileShadows(tile, this.shadowX, this.shadowZ);
        this.colliders.add(ref.name, content.colliders);
        this.slimeSink?.addTile(ref.name, content.slimes);
        resolve();
      }, reject);
    })).catch(failed);
    this.pending.set(ref.name, pending);
    return pending;
  }

  private shadowX = 0;
  private shadowZ = 0;

  private updateTileShadows(tile: LoadedTile, x: number, z: number): void {
    const inRange = tileWithinShadowDistance(tile.ref.bounds, x, z, this.quality);
    const state = `${this.quality}:${inRange}`;
    if (state === tile.shadowState) return;
    configureEnvironmentTile(tile.group, this.quality, inRange);
    applyTreeDensity(tile.group, this.quality);
    tile.shadowState = state;
  }

  private stillWanted(ref: TileRef): boolean {
    return this.positions.some(p => tileWanted(ref, p.s, p.x, p.z, this.window, this.window.hysteresis));
  }

  private drop(file: string): void {
    const tile = this.loaded.get(file);
    if (!tile) return;
    // physics first: a body referencing released vertex data is a crash, an unrendered tile is not
    this.colliders.remove(file);
    this.slimeSink?.removeTile(file);
    this.root.remove(tile.group);
    disposeTile(tile.group);
    this.loaded.delete(file);
  }
}

async function fetchBody(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

/**
 * Whole tile packs by URL, most recently used last. Two, because a route is previewed on the
 * departure screen and then raced, and those are two worlds asking for the same pack; more would
 * keep up to 27 MB per route alive for routes nobody is on.
 */
const PACK_CACHE_LIMIT = 2;
const packCache = new Map<string, Promise<ArrayBuffer>>();

/** Tests start each case from an empty cache; nothing in the game needs to. */
export function forgetTilePacks(): void {
  packCache.clear();
}

function wholePack(url: string, bytes: number): Promise<ArrayBuffer> {
  const known = packCache.get(url);
  if (known) {
    packCache.delete(url);
    packCache.set(url, known);
    return known;
  }
  // A body of the wrong length is a download that went wrong, not a pack: it is refused here so it
  // is asked for again rather than kept, and sliced, for the rest of the session.
  const pack = fetchBody(url).then(body => {
    if (body.byteLength !== bytes) throw new Error(`${url}: ${body.byteLength} bytes, the track expects ${bytes}`);
    return body;
  });
  pack.catch(() => { if (packCache.get(url) === pack) packCache.delete(url); }); // a failure is retried, not remembered
  packCache.set(url, pack);
  while (packCache.size > PACK_CACHE_LIMIT) packCache.delete(packCache.keys().next().value!);
  return pack;
}
