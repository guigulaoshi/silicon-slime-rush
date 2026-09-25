import type { TileRef, Vec3 } from '../track/types';

export interface StreamWindow {
  /** meters of track kept behind the car */
  behind: number;
  /** meters of track prefetched ahead */
  ahead: number;
  /** tiles within this distance of the car load regardless of progress */
  radius: number;
  /** extra distance a loaded tile must fall outside before it is dropped */
  hysteresis: number;
  /** loop tracks wrap their arc length */
  closed: boolean;
  /** total spline length, needed for wrapping */
  length: number;
}

export const DEFAULT_WINDOW: StreamWindow = {
  behind: 300,
  ahead: 1500,
  radius: 1000,
  hysteresis: 300,
  closed: false,
  length: 0,
};

/** Shortest signed distance from `a` to `b` along the track, respecting wrap on loops. */
export function alongTrack(a: number, b: number, w: StreamWindow): number {
  const d = b - a;
  if (!w.closed || w.length <= 0) return d;
  const half = w.length / 2;
  return d > half ? d - w.length : d < -half ? d + w.length : d;
}

/** Distance from a point to an axis-aligned box, zero inside it. Y is ignored: streaming is a map problem. */
export function distanceToBounds(bounds: [Vec3, Vec3], x: number, z: number): number {
  const [lo, hi] = bounds;
  const dx = Math.max(lo[0] - x, 0, x - hi[0]);
  const dz = Math.max(lo[2] - z, 0, z - hi[2]);
  return Math.hypot(dx, dz);
}

/**
 * Whether a tile belongs in the world right now.
 *
 * Two reasons qualify it, and both are needed. Progress covers the road ahead, which is what the car
 * is about to drive through. Distance covers everything the camera can see, which on a hairpin is the
 * leg the car left two hundred meters of arc length ago but is looking straight at.
 */
export function tileWanted(tile: TileRef, s: number, x: number, z: number, w: StreamWindow, slack = 0): boolean {
  if (distanceToBounds(tile.bounds, x, z) <= w.radius + slack) return true;
  for (const [a, b] of tile.sRanges) {
    // a range is in the window when it overlaps [s - behind, s + ahead]
    const toStart = alongTrack(s, a, w);
    const toEnd = alongTrack(s, b, w);
    const near = -(w.behind + slack);
    const far = w.ahead + slack;
    if (toStart <= far && toEnd >= near) return true;
    if (toStart > toEnd && (toStart <= far || toEnd >= near)) return true; // range straddles the wrap point
  }
  return false;
}

export interface StreamPlan {
  load: TileRef[];
  unload: string[];
}

/**
 * What to change about the loaded set, in priority order.
 *
 * Loading uses the plain window and unloading a window widened by the hysteresis, so a car sitting on
 * a boundary does not thrash the same tile in and out every frame.
 */
export function planStreaming(
  tiles: readonly TileRef[],
  loaded: ReadonlySet<string>,
  s: number,
  x: number,
  z: number,
  w: StreamWindow,
): StreamPlan {
  return planStreamingFor(tiles, loaded, [{ s, x, z }], w);
}

export interface StreamPosition { s: number; x: number; z: number }

/** Every driver and tow body contributes to the same desired set and the same load queue. */
export function planStreamingFor(tiles: readonly TileRef[], loaded: ReadonlySet<string>,
  positions: readonly StreamPosition[], w: StreamWindow): StreamPlan {
  const load: TileRef[] = [];
  const unload: string[] = [];
  for (const tile of tiles) {
    const has = loaded.has(tile.name);
    const wanted = positions.some(p => tileWanted(tile, p.s, p.x, p.z, w, has ? w.hysteresis : 0));
    if (!has && wanted) load.push(tile);
    else if (has && !wanted) unload.push(tile.name);
  }
  const distance = (tile: TileRef): number => Math.min(...positions.map(p => distanceToBounds(tile.bounds, p.x, p.z)));
  load.sort((a, b) => distance(a) - distance(b));
  return { load, unload };
}


/**
 * One tile's bytes out of its track's pack.
 *
 * Every tile of a track lives in one file, because itch.io counts files and one per tile reached
 * 795 with four corridors still owed. The streamer fetches that file whole and slices it here
 * (status 200); a 206 is a body that is already just this tile. The throws are for a body that is
 * neither, which would otherwise hand the GLB parser whatever happened to sit at that offset.
 */
export function tileBytes(body: ArrayBuffer, status: number,
                          tile: { name: string; offset: number; length: number }): ArrayBuffer {
  if (status === 206) {
    if (body.byteLength !== tile.length) {
      throw new Error(`${tile.name}: asked for ${tile.length} bytes, got ${body.byteLength}`);
    }
    return body;
  }
  const end = tile.offset + tile.length;
  if (body.byteLength < end) {
    throw new Error(`${tile.name}: pack is ${body.byteLength} bytes, tile ends at ${end}`);
  }
  return body.slice(tile.offset, end);
}
