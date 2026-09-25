import * as THREE from 'three';

export interface LampSurface { centre: [number, number, number]; size: [number, number] }

/**
 * Lamps of one material are exported as one batched mesh, so separate them by connectivity: vertices of
 * one triangle belong together, and vertices at the same position (split normals/UVs) are welded. Each
 * lamp reports the centre of its outer face (rear-most for tail lamps, front-most for headlamps) and its
 * width and height, in the model's own frame.
 */
export function lampSurfaces(root: THREE.Object3D, material: string, facing: 'rear' | 'front'): LampSurface[] {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const points: THREE.Vector3[] = [];
  const parent: number[] = [];
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]!));
  const join = (a: number, b: number) => { parent[find(a)] = find(b); };
  const welded = new Map<string, number>();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (!materials.some(m => m.name === material)) return;
    const position = node.geometry.getAttribute('position');
    const base = points.length;
    for (let i = 0; i < position.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).applyMatrix4(inverse);
      points.push(point); parent.push(base + i);
      const key = `${Math.round(point.x * 1e4)},${Math.round(point.y * 1e4)},${Math.round(point.z * 1e4)}`;
      const twin = welded.get(key);
      if (twin === undefined) welded.set(key, base + i); else join(base + i, twin);
    }
    const index = node.geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const [a, b, c] = [0, 1, 2].map(j => base + (index ? index.getX(i + j) : i + j));
      join(a!, b!); join(b!, c!);
    }
  });
  const groups = new Map<number, THREE.Box3>();
  points.forEach((point, i) => {
    const group = find(i);
    if (!groups.has(group)) groups.set(group, new THREE.Box3());
    groups.get(group)!.expandByPoint(point);
  });
  // Bezels, reflectors and bulbs of other materials can stand proud of the lens; a glow placed on the
  // lens alone is hidden behind them. The outer face is the outermost geometry over the lamp's centre.
  const others: THREE.Vector3[] = [];
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) others.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).applyMatrix4(inverse));
  });
  const outward = facing === 'rear' ? 1 : -1;
  return [...groups.values()]
    .map(box => {
      const face = facing === 'rear' ? box.max.z : box.min.z;
      const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
      const rx = (box.max.x - box.min.x) * .3, ry = (box.max.y - box.min.y) * .3;
      let outer = face;
      for (const p of others) {
        if (Math.abs(p.x - cx) > rx || Math.abs(p.y - cy) > ry) continue;
        const ahead = (p.z - face) * outward;
        if (ahead > 0 && ahead < PROUD) outer = Math.max(outer * outward, p.z * outward) * outward;
      }
      return { centre: [cx, cy, outer] as [number, number, number], size: [box.max.x - box.min.x, box.max.y - box.min.y] as [number, number] };
    })
    // A lamp is a face a driver can see: drop hairline trims and keep the outer ring of concentric parts.
    .filter(lamp => Math.min(...lamp.size) >= MIN_LAMP)
    .sort((a, b) => b.size[0] * b.size[1] - a.size[0] * a.size[1])
    .filter((lamp, i, all) => !all.slice(0, i).some(other => Math.hypot(other.centre[0] - lamp.centre[0], other.centre[1] - lamp.centre[1]) < MIN_LAMP))
    .sort((a, b) => a.centre[0] - b.centre[0] || a.centre[1] - b.centre[1]);
}

const MIN_LAMP = .015;
/** Parts further out than this over a lamp are the body around it (a bumper lip), not the lamp's own bezel. */
const PROUD = .02;
