import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import metadata from '../../pipeline/landmarks.json' with { type: 'json' };
import { disposeModel } from '../src/world/disposeModel';
import { geometryTexturesOnly } from '../test-support/geometry-textures';

beforeEach(geometryTexturesOnly);
afterEach(() => vi.restoreAllMocks());

it('ships closed, finite landmark models at recognisable real-world scale', async () => {
  const models = metadata.landmarks.filter(entry => entry.kind === 'glb');
  expect(models.length).toBeGreaterThan(0);
  for (const venue of models) {
    const bytes = readFileSync(`public/models/landmarks/${venue.id}.glb`);
    const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
    const { scene, parser } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
    // Binary geometry may coincidentally spell words; only authored JSON carries asset labels.
    expect(JSON.stringify(parser.json).toLowerCase().includes('nasa'), `${venue.id}: branded metadata`).toBe(false);
    for (const material of parser.json.materials ?? []) {
      for (const texture of [material.pbrMetallicRoughness?.baseColorTexture,
        material.pbrMetallicRoughness?.metallicRoughnessTexture, material.normalTexture,
        material.occlusionTexture, material.emissiveTexture]) {
        if (!texture) continue;
        expect(Number.isInteger(texture.texCoord ?? 0)).toBe(true);
        expect(texture.texCoord ?? 0, `${venue.id}: invalid texture UV channel`).toBeGreaterThanOrEqual(0);
      }
    }
    const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3());
    expect(box.min.y).toBeCloseTo(0, 1);
    expect(size.y).toBeGreaterThan(venue.heightM * .8);
    expect(size.y).toBeLessThan(venue.heightM * 1.1);
    if ('footprint' in venue && venue.footprint) {
      // The model is authored east-up-south like the map, so its plan box covers the registered outline.
      const lats = venue.footprint.map(p => p[0]!), lons = venue.footprint.map(p => p[1]!);
      const east = (Math.max(...lons) - Math.min(...lons)) * 111320 * Math.cos(lats[0]! * Math.PI / 180);
      const south = (Math.max(...lats) - Math.min(...lats)) * 110540;
      expect(size.x, `${venue.id}: narrower than its outline`).toBeGreaterThan(east * .75);
      expect(size.z, `${venue.id}: shallower than its outline`).toBeGreaterThan(south * .75);
    } else {
      expect(size.x).toBeGreaterThan(9); expect(size.x).toBeLessThan(45);
      expect(size.z).toBeGreaterThan(14); expect(size.z).toBeLessThan(35);
    }
    let vertices = 0;
    const materialEdges = new Map<string, Map<string, number>>();
    scene.updateMatrixWorld(true);
    scene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const positions = node.geometry.getAttribute('position'); vertices += positions.count;
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      expect(materials).toHaveLength(1);
      const materialName = materials[0]!.name;
      const map = (materials[0] as THREE.MeshStandardMaterial).map;
      if (map) {
        const uv = node.geometry.getAttribute(map.channel === 0 ? 'uv' : `uv${map.channel}`);
        expect(uv?.count, `${venue.id}: textured vertices need UV coordinates`).toBe(positions.count);
        expect(Array.from(uv.array).every(Number.isFinite)).toBe(true);
      }
      const edges = materialEdges.get(materialName) ?? new Map<string, number>();
      materialEdges.set(materialName, edges);
      const points = Array.from({ length: positions.count }, (_, i) => {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
        return point.toArray().map(value => Math.round(value * 1e5) / 1e5).join(',');
      });
      const index = node.geometry.index;
      for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
        const tri = [0, 1, 2].map(offset => index?.getX(i + offset) ?? i + offset);
        for (const [a, b] of [[tri[0]!, tri[1]!], [tri[1]!, tri[2]!], [tri[2]!, tri[0]!]]) {
          const key = [points[a!]!, points[b!]!].sort().join('|');
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
    });
    expect(vertices).toBeGreaterThan(500);
    for (const [material, edges] of materialEdges) {
      expect([...edges.values()].filter(count => count % 2).length, `${venue.id}/${material}: open geometric edges`).toBe(0);
    }
    disposeModel(scene);
  }
}, 30_000);  // 36 landmark models to decode, not 20: well past the 5 s default


