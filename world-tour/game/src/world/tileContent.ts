import * as THREE from 'three';
import type { TileColliders, BoxCollider, TrimeshCollider } from '../physics/colliders';
import { NODE_COLLIDERS } from '../track/types';
import type { MaterialLibrary } from './materials';
import type { SlimeDensity } from '../app/Save';
import { SLIME_KINDS, type SlimeKind, type TileSlimeSpawn } from './Slimes';
import type { Quality } from './World';
import { configureEnvironmentNode } from './environmentShadows';

type ColliderKind = 'trimesh' | 'boxes' | 'instances-box' | 'none';

interface NodeExtras {
  collider?: ColliderKind;
  boxes?: number[][];
  halfExtents?: number[];
  killY?: number;
}

/**
 * Node name to collider kind, falling back to the contract's table when a tile omits the extra.
 *
 * A `props_` node is matched whole and then by its longest registered prefix: one prop can need
 * several nodes — the eight billboard faces are eight nodes only because an instanced node carries
 * exactly one material — and they all mean the same thing to physics.
 */
function colliderKind(name: string, extras: NodeExtras): ColliderKind {
  if (extras.collider) return extras.collider;
  const table = NODE_COLLIDERS as Record<string, ColliderKind>;
  if (!name.startsWith('props_')) return table[name.split('_')[0]!] ?? 'none';
  if (table[name]) return table[name]!;
  const prefixes = Object.keys(table).filter((k) => k.startsWith('props_') && name.startsWith(`${k}_`));
  if (!prefixes.length) return 'none';
  return table[prefixes.reduce((a, b) => (b.length > a.length ? b : a))]!;
}

/** The node name of the invisible wall above the guardrail beams (pipeline sr/roads.py). */
export const GUARDRAIL_SHIELD = 'guardrail_shield';

export function trimeshFrom(mesh: THREE.Mesh, role: 'ground' | 'wall' | 'guardrail'): TrimeshCollider | null {
  const geom = mesh.geometry as THREE.BufferGeometry;
  const pos = geom.getAttribute('position');
  const index = geom.getIndex();
  if (!pos || !index) return null;
  mesh.updateWorldMatrix(true, false);
  const v = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    v[i * 3] = p.x; v[i * 3 + 1] = p.y; v[i * 3 + 2] = p.z;
  }
  return { vertices: v, indices: new Uint32Array(index.array), role };
}

function instanceBoxes(mesh: THREE.InstancedMesh, half: number[]): BoxCollider[] {
  const out: BoxCollider[] = [];
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.premultiply(mesh.matrixWorld);
    m.decompose(pos, quat, scale);
    euler.setFromQuaternion(quat, 'YXZ');
    // halfExtents describe the unscaled mesh, because they are per node and instances may differ.
    out.push({
      center: [pos.x, pos.y, pos.z],
      half: [(half[0] ?? 1) * scale.x, (half[1] ?? 1) * scale.y, (half[2] ?? 1) * scale.z],
      yaw: euler.y,
      role: 'wall',
    });
  }
  return out;
}

function slimeCarrier(name: string): { kind: SlimeKind; manyOnly: boolean } | null {
  const manyOnly = name.startsWith('props_slime_many_');
  const prefix = manyOnly ? 'props_slime_many_' : 'props_slime_';
  const value = name.startsWith(prefix) ? name.slice(prefix.length) : '';
  return (SLIME_KINDS as readonly string[]).includes(value)
    ? { kind: value as SlimeKind, manyOnly } : null;
}

function instanceSlimes(node: THREE.Object3D, kind: SlimeKind): TileSlimeSpawn[] {
  const out: TileSlimeSpawn[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  node.traverse((child) => {
    const mesh = child as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      matrix.premultiply(mesh.matrixWorld);
      matrix.decompose(position, rotation, scale);
      euler.setFromQuaternion(rotation, 'YXZ');
      out.push({ kind, position: [position.x, position.y, position.z],
        scale: [Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)], yaw: euler.y });
    }
  });
  return out;
}

/** A disabled gameplay layer must not leave its GLB transport mesh resident in the scene. */
function disposeSlimeCarrier(node: THREE.Object3D): void {
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.dispose();
  });
  node.removeFromParent();
  node.clear();
}

export interface TileContent {
  group: THREE.Group;
  colliders: TileColliders;
  materialNames: Set<string>;
  slimes: TileSlimeSpawn[];
}

/**
 * Turn a loaded tile scene into something the game can use: shared materials on the render side,
 * plain arrays on the physics side.
 *
 * The GLB carries no textures and no physics, only node names and extras, so this is where the
 * contract in docs/CONTRACT.md is actually enforced. Anything it cannot classify renders and does
 * not collide, which is the safe direction to fail: the player sees the world but never gets stuck
 * on something invisible.
 */
export function readTile(
  scene: THREE.Object3D,
  materials: MaterialLibrary,
  slimeDensity: SlimeDensity = 'normal',
  quality: Quality = 'high',
): TileContent {
  const group = new THREE.Group();
  const colliders: TileColliders = { trimeshes: [], boxes: [] };
  const materialNames = new Set<string>();
  const slimes: TileSlimeSpawn[] = [];

  scene.updateWorldMatrix(true, true);
  const nodes = [...scene.children];
  for (const node of nodes) {
    const extras = ((node.userData ?? {}) as NodeExtras);
    const kind = colliderKind(node.name, extras);
    if (typeof extras.killY === 'number') colliders.killY = extras.killY;
    const slime = slimeCarrier(node.name);
    const scenery = node.name === 'scenery_slime' || node.name === 'scenery_slime_many';
    const manyOnly = slime?.manyOnly || node.name === 'scenery_slime_many';
    if (node.name.startsWith('props_slime_') || scenery) {
      if (slimeDensity === 'none' || (manyOnly && slimeDensity !== 'many')) {
        disposeSlimeCarrier(node);
        continue;
      }
      if (scenery) slimes.push(...instanceSlimes(node, 'popper')
        .map(spawn => ({ ...spawn, scenery: true })));
      if (slime) slimes.push(...instanceSlimes(node, slime.kind));
      // The carrier geometry only transports transforms. Keeping it hidden inside the group lets
      // normal tile disposal release its geometry without drawing a second set of slimes.
      node.visible = false;
      group.add(node);
      continue;
    }

    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material as THREE.Material | THREE.Material[];
      const name = Array.isArray(source) ? source[0]?.name : source?.name;
      if (name) materialNames.add(name);
      mesh.material = materials.get(name);
      if (name?.startsWith('building') && !mesh.geometry.hasAttribute('uv1')) {
        mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(
          new Float32Array(mesh.geometry.getAttribute('position').count * 2), 2));
      }
      if (kind === 'trimesh') {
        const t = trimeshFrom(mesh, node.name.startsWith('guardrail') ? 'guardrail' : 'ground');
        if (t && node.name.startsWith(GUARDRAIL_SHIELD)) t.invisible = true;
        if (t) colliders.trimeshes.push(t);
      } else if (kind === 'instances-box' && (mesh as THREE.InstancedMesh).isInstancedMesh) {
        colliders.boxes.push(...instanceBoxes(mesh as THREE.InstancedMesh, extras.halfExtents ?? [1, 1, 1]));
      }
    });
    configureEnvironmentNode(node, quality);
    // Collision only: a wall above the rail beams so a tipping car cannot roll over them. The beam is
    // what the player sees; drawing this would put a pane across every view off the road.
    if (node.name.startsWith(GUARDRAIL_SHIELD)) node.visible = false;

    if (kind === 'boxes') {
      for (const b of extras.boxes ?? []) {
        colliders.boxes.push({ center: [b[0]!, b[1]!, b[2]!], half: [b[3]!, b[4]!, b[5]!],
          yaw: b[6] ?? 0, role: 'wall' });
      }
    }
    group.add(node);
  }
  return { group, colliders, materialNames, slimes };
}

/** Release every geometry a tile owns. Materials are shared and outlive the tile, so they stay. */
export function disposeTile(group: THREE.Object3D): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  group.clear();
}
