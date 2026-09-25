import * as THREE from 'three';
import type { Quality } from './World';

/**
 * Planted campuses, parks and neighbourhoods by area, which multiplied some routes' trees
 * (goldengate 1092 -> 6308) and halved a phone-load frame rate. High keeps every tree; lower tiers
 * draw a fixed share. The share is chosen by a hash of each tree's position, so the same trees stay
 * whatever the tier, and a trunk and its canopy (separate instanced nodes) are always kept together.
 */
export const TREE_SHARE: Readonly<Record<Quality, number>> = { high: 1, medium: .6, low: .35 };

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();

function keepRank(x: number, z: number): number {
  let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Order a tile's tree instances by their keep rank once, then show the tier's share of them. */
export function applyTreeDensity(group: THREE.Object3D, quality: Quality): void {
  for (const node of group.children) {
    if (!node.name.startsWith('trees_')) continue;
    node.traverse((child) => {
      const mesh = child as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      if (mesh.userData.treeTotal === undefined) {
        const ranked = Array.from({ length: mesh.count }, (_, i) => {
          mesh.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix);
          return { rank: keepRank(position.x, position.z), m: matrix.clone() };
        }).sort((a, b) => a.rank - b.rank);
        ranked.forEach((entry, i) => mesh.setMatrixAt(i, entry.m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.treeTotal = ranked.length;
        mesh.userData.treeRanks = ranked.map(entry => entry.rank);
      }
      const ranks = mesh.userData.treeRanks as number[];
      const share = TREE_SHARE[quality];
      let count = 0;
      while (count < ranks.length && ranks[count]! < share) count++;
      mesh.count = count;
    });
  }
}
