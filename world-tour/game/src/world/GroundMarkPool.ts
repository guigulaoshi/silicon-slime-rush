import * as THREE from 'three';

const _centre = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _rotation = new THREE.Quaternion();
const _extent = new THREE.Vector3();

interface Chunk { mesh: THREE.InstancedMesh; bounds: THREE.Box3; dirtyFrom: number; dirtyTo: number }

/**
 * Road marks kept for the whole race. Marks never fade and a lap never recycles them:
 * the pool grows a chunk at a time instead of wrapping a fixed ring, and each chunk culls itself
 * against the camera by the bounds of the marks it holds. Only past `limit` -- a guard for a car
 * circling in place for many minutes, not for a race -- does the oldest chunk get reused.
 */
export class GroundMarkPool {
  readonly root = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private written = 0;

  constructor(readonly name: string, private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material, private readonly chunkSize = 4096,
    readonly limit = 1 << 17, private readonly renderOrder = 3) {
    this.root.name = name;
    // The first chunk exists before any mark, so the loading-screen compile already covers its material.
    this.chunk(0);
  }

  /** Marks currently stored (drawn wherever they are in view). */
  get count(): number { return Math.min(this.written, this.limit); }
  get chunkCount(): number { return this.chunks.length; }
  /** Instance matrices held on the CPU, mirrored once on the GPU. */
  get bytes(): number { return this.chunks.length * this.chunkSize * 16 * Float32Array.BYTES_PER_ELEMENT; }

  /** Appends a mark and returns its handle for `set` (a mark extended along a straight run). */
  add(matrix: THREE.Matrix4): number {
    const handle = this.written % this.limit;
    this.written++;
    this.set(handle, matrix);
    return handle;
  }

  set(handle: number, matrix: THREE.Matrix4): void {
    const chunk = this.chunk(Math.floor(handle / this.chunkSize));
    const slot = handle % this.chunkSize;
    chunk.mesh.setMatrixAt(slot, matrix);
    chunk.mesh.count = Math.max(chunk.mesh.count, slot + 1);
    matrix.decompose(_centre, _rotation, _scale);
    // Bounds only ever grow, so a chunk reused past the limit is culled conservatively, never wrongly.
    const reach = Math.max(_scale.x, _scale.y, _scale.z) * .5 + .1;
    chunk.bounds.expandByPoint(_extent.copy(_centre).addScalar(reach)).expandByPoint(_extent.copy(_centre).addScalar(-reach));
    chunk.mesh.boundingSphere = chunk.bounds.getBoundingSphere(chunk.mesh.boundingSphere ?? new THREE.Sphere());
    chunk.dirtyFrom = Math.min(chunk.dirtyFrom, slot);
    chunk.dirtyTo = Math.max(chunk.dirtyTo, slot + 1);
  }

  /** Uploads only the slots written since the last frame. */
  flush(): void {
    for (const chunk of this.chunks) {
      if (chunk.dirtyTo <= chunk.dirtyFrom) continue;
      const attribute = chunk.mesh.instanceMatrix;
      // Tyre marks flush once per physics substep and a chunk out of view is not drawn at all, so a
      // range can still be waiting for its upload: widen it rather than replace it, or marks never
      // reach the GPU and a trail shows gaps. three.js clears the ranges once it has uploaded them.
      let from = chunk.dirtyFrom * 16, to = chunk.dirtyTo * 16;
      for (const range of attribute.updateRanges) { from = Math.min(from, range.start); to = Math.max(to, range.start + range.count); }
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(from, to - from);
      attribute.needsUpdate = true;
      chunk.dirtyFrom = Infinity; chunk.dirtyTo = 0;
    }
  }

  /** A new race on the same world starts with a clean road: keep the first chunk, free the rest. */
  clear(): void {
    for (const chunk of this.chunks.splice(1)) { chunk.mesh.removeFromParent(); chunk.mesh.dispose(); }
    const first = this.chunks[0]!;
    first.mesh.count = 0; first.bounds.makeEmpty(); first.mesh.boundingSphere = null;
    first.dirtyFrom = Infinity; first.dirtyTo = 0;
    this.written = 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const chunk of this.chunks) chunk.mesh.dispose();
    this.chunks.length = 0;
    this.geometry.dispose();
    this.material.dispose();
  }

  private chunk(index: number): Chunk {
    const existing = this.chunks[index];
    if (existing) return existing;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.chunkSize);
    mesh.name = `${this.name}-${index}`;
    mesh.count = 0;
    mesh.renderOrder = this.renderOrder;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const chunk = { mesh, bounds: new THREE.Box3(), dirtyFrom: Infinity, dirtyTo: 0 };
    this.chunks[index] = chunk;
    this.root.add(mesh);
    return chunk;
  }
}
