import * as THREE from 'three';

/** Cells per projection axis. At 128 a 4 m car resolves 3 cm, finer than any seat-to-shell gap. */
export const COAT_EXPOSURE_GRID = 128;
/** A surface this far inside the outermost one along the projection axis is behind the shell. */
export const COAT_EXPOSURE_DEPTH_M = .05;

/**
 * The body coat projects one splatter image per axis onto every surface facing that way, so a
 * seat under the roof received the roof's streaks. For each of the six axes (+x, -x, +y, -y, +z, -z, the
 * order of the coat images) record the outermost surface of the shell (glass included, wheels excluded)
 * in the coat's normalised box coordinates. The coat shows only on surfaces at that outer layer.
 * Tiles are laid out 3 × 2 in one float texture so the shader spends a single sampler.
 */
export function coatExposureMap(group: THREE.Object3D, skip: readonly THREE.Object3D[], centre: THREE.Vector3, half: THREE.Vector3): THREE.DataTexture {
  const n = COAT_EXPOSURE_GRID;
  const data = new Float32Array(n * 3 * n * 2);
  for (let tile = 0; tile < 6; tile++) for (let i = 0; i < n * n; i++) data[tileIndex(tile, i % n, Math.floor(i / n))] = tile % 2 ? 1e3 : -1e3;
  group.updateWorldMatrix(true, true);
  const inverse = group.matrixWorld.clone().invert();
  const toBox = (p: THREE.Vector3) => p.applyMatrix4(inverse).sub(centre).divide(half).multiplyScalar(.5).addScalar(.5);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  group.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (let parent: THREE.Object3D | null = node; parent && parent !== group; parent = parent.parent) if (skip.includes(parent)) return;
    const position = node.geometry.getAttribute('position');
    const index = node.geometry.index;
    const count = index ? index.count : position.count;
    const vertex = (target: THREE.Vector3, k: number) => toBox(target.fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(node.matrixWorld));
    for (let k = 0; k + 2 < count; k += 3) {
      vertex(a, k); vertex(b, k + 1); vertex(c, k + 2);
      for (let tile = 0; tile < 6; tile++) rasterise(data, tile, a, b, c);
    }
  });
  const texture = new THREE.DataTexture(data, n * 3, n * 2, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Plane coordinates and depth component per tile, matching the coat images' own projection. */
const PLANE: readonly [number, number, number][] = [[2, 1, 0], [2, 1, 0], [2, 0, 1], [2, 0, 1], [0, 1, 2], [0, 1, 2]];

function tileIndex(tile: number, u: number, v: number): number {
  const n = COAT_EXPOSURE_GRID;
  return (Math.floor(tile / 3) * n + v) * n * 3 + (tile % 3) * n + u;
}

function rasterise(data: Float32Array, tile: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
  const n = COAT_EXPOSURE_GRID, [iu, iv, id] = PLANE[tile]!, outer = tile % 2 ? Math.min : Math.max;
  const write = (u: number, v: number, depth: number) => {
    if (u < 0 || v < 0 || u >= n || v >= n) return;
    const at = tileIndex(tile, u, v);
    data[at] = outer(data[at]!, depth);
  };
  const au = a.getComponent(iu) * n, av = a.getComponent(iv) * n;
  const bu = b.getComponent(iu) * n, bv = b.getComponent(iv) * n;
  const cu = c.getComponent(iu) * n, cv = c.getComponent(iv) * n;
  // Every vertex occludes its own cell, so a mesh of triangles smaller than a cell leaves no holes.
  write(Math.floor(au), Math.floor(av), a.getComponent(id));
  write(Math.floor(bu), Math.floor(bv), b.getComponent(id));
  write(Math.floor(cu), Math.floor(cv), c.getComponent(id));
  const area = (bu - au) * (cv - av) - (cu - au) * (bv - av);
  const minU = Math.max(0, Math.floor(Math.min(au, bu, cu))), maxU = Math.min(n - 1, Math.floor(Math.max(au, bu, cu)));
  const minV = Math.max(0, Math.floor(Math.min(av, bv, cv))), maxV = Math.min(n - 1, Math.floor(Math.max(av, bv, cv)));
  const extreme = outer(a.getComponent(id), b.getComponent(id), c.getComponent(id));
  let covered = false;
  if (Math.abs(area) > 1e-9) {
    for (let v = minV; v <= maxV; v++) for (let u = minU; u <= maxU; u++) {
      const pu = u + .5, pv = v + .5;
      const w1 = ((bu - pu) * (cv - pv) - (cu - pu) * (bv - pv)) / area;
      const w2 = ((cu - pu) * (av - pv) - (au - pu) * (cv - pv)) / area;
      const w3 = 1 - w1 - w2;
      if (w1 < 0 || w2 < 0 || w3 < 0) continue;
      covered = true;
      write(u, v, w1 * a.getComponent(id) + w2 * b.getComponent(id) + w3 * c.getComponent(id));
    }
  }
  // Slivers and edge-on triangles that miss every cell centre still occlude the cells they cross.
  if (!covered && (maxU - minU + 1) * (maxV - minV + 1) <= 9) {
    for (let v = minV; v <= maxV; v++) for (let u = minU; u <= maxU; u++) write(u, v, extreme);
  }
}

/** The shader's test, for tests: is a surface at box coordinate `box` facing `normal` at the outer layer? */
export function coatExposed(map: THREE.DataTexture, box: THREE.Vector3, normal: THREE.Vector3, half: THREE.Vector3): boolean {
  const an = new THREE.Vector3(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z));
  const tile = an.x > an.y && an.x > an.z ? (normal.x > 0 ? 0 : 1) : an.y > an.z ? (normal.y > 0 ? 2 : 3) : (normal.z > 0 ? 4 : 5);
  const [iu, iv, id] = PLANE[tile]!, n = COAT_EXPOSURE_GRID;
  const cell = (x: number) => Math.min(n - 1, Math.max(0, Math.floor(x * n)));
  const outer = (map.image.data as Float32Array)[tileIndex(tile, cell(box.getComponent(iu)), cell(box.getComponent(iv)))]!;
  const epsilon = COAT_EXPOSURE_DEPTH_M / (2 * half.getComponent(id));
  return tile % 2 ? box.getComponent(id) <= outer + epsilon : box.getComponent(id) >= outer - epsilon;
}
