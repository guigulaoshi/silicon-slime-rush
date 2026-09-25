import * as THREE from 'three';
import type { Quality } from './World';

export type EnvironmentShadowRole = 'major' | 'detail' | 'none';

/** The sun volume is centred on the car; medium deliberately covers a shorter stretch of road. */
export const SHADOW_RADIUS: Readonly<Record<Quality, number>> = {
  high: 90,
  medium: 58,
  low: 0,
};

/**
 * How far a tile may be from the car before its environment stops entering the shadow pass.
 *
 * This is wider than the light camera because a tall building just outside the camera can cast a
 * long shadow into it. Tile bounds, rather than object origins, make the decision, so a 256 m tile
 * crossing the boundary does not blink while the car is still beside its near edge.
 */
export const SHADOW_TILE_DISTANCE: Readonly<Record<Quality, number>> = {
  high: 150,
  medium: 85,
  low: 0,
};

export function tileWithinShadowDistance(
  bounds: readonly [readonly number[], readonly number[]],
  x: number,
  z: number,
  quality: Quality,
): boolean {
  if (quality === 'low') return false;
  const [[minX, , minZ], [maxX, , maxZ]] = bounds;
  const dx = Math.max(minX! - x, 0, x - maxX!);
  const dz = Math.max(minZ! - z, 0, z - maxZ!);
  return Math.hypot(dx, dz) <= SHADOW_TILE_DISTANCE[quality];
}

/** One classification for every streamed environment node that may cast the shared sun shadow. */
export function environmentShadowRole(name: string): EnvironmentShadowRole {
  if (name === 'guardrail' || name === 'roof_support' || name.startsWith('buildings')
      || name.startsWith('landmark_') || name.startsWith('trees_')) return 'major';
  if (name === 'bridgeworks' || name.startsWith('roof_') || name.startsWith('deck_') || name === 'props_barrier'
      || name.startsWith('props_billboard_')) return 'detail';
  return 'none';
}

export function environmentCastsShadow(name: string, quality: Quality): boolean {
  const role = environmentShadowRole(name);
  return quality === 'high' ? role !== 'none' : quality === 'medium' ? role === 'major' : false;
}

/** Apply a quality and distance decision to one top-level GLB node and all meshes below it. */
export function configureEnvironmentNode(
  node: THREE.Object3D,
  quality: Quality,
  inRange = true,
): void {
  const cast = inRange && environmentCastsShadow(node.name, quality);
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.userData.environmentShadowRole = environmentShadowRole(node.name);
  });
}

/** Change a loaded tile without rebuilding it; used by auto-quality after the opening sample. */
export function configureEnvironmentTile(
  group: THREE.Object3D,
  quality: Quality,
  inRange = true,
): void {
  for (const node of group.children) configureEnvironmentNode(node, quality, inRange);
}
