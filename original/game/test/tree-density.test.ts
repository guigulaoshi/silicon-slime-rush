import * as THREE from 'three';
import { expect, it } from 'vitest';
import { applyTreeDensity, TREE_SHARE } from '../src/world/treeDensity';

function tile(n: number): THREE.Group {
  const group = new THREE.Group();
  for (const part of ['trunk', 'foliage']) {
    const node = new THREE.Group(); node.name = `trees_broadleaf_${part}`;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), n);
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 7.3 % 256, 0, i * 13.1 % 256));
    node.add(mesh); group.add(node);
  }
  const other = new THREE.Group(); other.name = 'buildings';
  other.add(new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), n)); group.add(other);
  return group;
}
const kept = (group: THREE.Group, name: string) => {
  const mesh = group.getObjectByName(name)!.children[0] as THREE.InstancedMesh, m = new THREE.Matrix4(), p = new THREE.Vector3();
  return Array.from({ length: mesh.count }, (_, i) => { mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m); return `${p.x.toFixed(1)},${p.z.toFixed(1)}`; });
};

it('draws every tree on high and a stable, nested share on lower tiers, trunks with their canopies', () => {
  const group = tile(2000);
  applyTreeDensity(group, 'low');
  const low = kept(group, 'trees_broadleaf_trunk');
  expect(low.length / 2000).toBeGreaterThan(TREE_SHARE.low - .05);
  expect(low.length / 2000).toBeLessThan(TREE_SHARE.low + .05);
  expect(kept(group, 'trees_broadleaf_foliage')).toEqual(low);
  applyTreeDensity(group, 'medium');
  const medium = kept(group, 'trees_broadleaf_trunk');
  expect(medium.length / 2000).toBeGreaterThan(TREE_SHARE.medium - .05);
  expect(medium.slice(0, low.length)).toEqual(low);
  applyTreeDensity(group, 'high');
  expect(kept(group, 'trees_broadleaf_trunk')).toHaveLength(2000);
  applyTreeDensity(group, 'low');
  expect(kept(group, 'trees_broadleaf_trunk')).toEqual(low);
  expect((group.getObjectByName('buildings')!.children[0] as THREE.InstancedMesh).count).toBe(2000);
});
