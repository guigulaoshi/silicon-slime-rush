import type { Vec3 } from '../track/types';

/** A box collider in world space: centre, half extents, and a yaw about Y. */
export interface BoxCollider {
  center: Vec3;
  half: Vec3;
  yaw: number;
  /** A wall produces a car-impact event; ground only supports wheel rays. */
  role?: 'ground' | 'wall' | 'guardrail';
}

/** A triangle mesh collider: flat vertex and index arrays in world space. */
export interface TrimeshCollider {
  vertices: Float32Array;
  indices: Uint32Array;
  /** A wall produces a car-impact event; ground only supports wheel rays. */
  role?: 'ground' | 'wall' | 'guardrail';
  /** Stops cars but is never drawn (the wall above a guardrail beam), so the camera sweep sees
   *  through it instead of stopping at nothing. */
  invisible?: boolean;
}

export interface TileColliders {
  trimeshes: TrimeshCollider[];
  boxes: BoxCollider[];
  /** below this height the car is in the water and gets reset */
  killY?: number;
}

/**
 * Where a tile's colliders go.
 *
 * The streamer owns tile lifetime and the physics world owns bodies, so they meet here: the streamer
 * hands over collider data and gets back a handle it can retire. Keeping the interface this thin is
 * what lets the streaming window be tested without a physics engine or a browser.
 */
export interface ColliderSink {
  add(key: string, colliders: TileColliders): void;
  remove(key: string): void;
}

/** Collects colliders in memory. Used by tests and by the loading screen before physics exists. */
export class RecordingColliderSink implements ColliderSink {
  readonly tiles = new Map<string, TileColliders>();
  add(key: string, colliders: TileColliders): void {
    this.tiles.set(key, colliders);
  }
  remove(key: string): void {
    this.tiles.delete(key);
  }
}
