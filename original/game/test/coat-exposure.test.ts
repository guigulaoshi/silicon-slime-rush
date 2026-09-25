import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import data from '../src/vehicles/catalogue.json' with { type: 'json' };
import type { VehicleBody } from '../src/vehicles/catalogue';
import { coatExposed, coatExposureMap } from '../src/vehicles/coatExposure';
import { wheelCentres } from '../src/vehicles/catalogue';

// Splatter streaks showed on seats and the cabin floor through the rear window. Interior
// surfaces must be behind the outer layer; paint and glass must be on it.
const SEAT = /upholstery|seat|fabric/i;
const LINING = /lining|interior/i;
const GLASS = /glazing/i;
const PAINT = /^Factory body paint/;
const bodies = (data.vehicles as unknown as (VehicleBody & { trailer?: VehicleBody })[])
  .flatMap(vehicle => [vehicle, ...(vehicle.trailer ? [vehicle.trailer] : [])]);

async function load(id: string) {
  const bytes = readFileSync(`public/models/cars/${id}.glb`);
  const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
  return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '')).scene;
}

describe('the body coat reaches the outer shell only', () => {
  it.each(bodies.map(body => [body.id, body] as const))('%s', async (id, body) => {
    const scene = await load(id);
    const wheels = wheelCentres(body).map((_, i) => scene.getObjectByName(`wheel-${i}`)).filter(Boolean) as THREE.Object3D[];
    scene.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(scene);
    const centre = bounds.getCenter(new THREE.Vector3()), half = bounds.getSize(new THREE.Vector3()).multiplyScalar(.5);
    const begin = performance.now();
    const map = coatExposureMap(scene, wheels, centre, half);
    const milliseconds = performance.now() - begin;
    const tally = new Map<string, [number, number]>();
    scene.traverse(node => {
      if (!(node instanceof THREE.Mesh) || Array.isArray(node.material)) return;
      const name = node.material.name;
      const kind = SEAT.test(name) ? 'seat' : LINING.test(name) ? 'lining' : GLASS.test(name) ? 'glass' : PAINT.test(name) ? 'paint' : null;
      if (!kind) return;
      const position = node.geometry.getAttribute('position'), normal = node.geometry.getAttribute('normal');
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(node.matrixWorld);
      const row = tally.get(kind) ?? [0, 0];
      for (let i = 0; i < position.count; i++) {
        const box = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).sub(centre).divide(half).multiplyScalar(.5).addScalar(.5);
        const n = new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
        row[0]! += coatExposed(map, box, n, half) ? 1 : 0; row[1]! += 1;
      }
      tally.set(kind, row);
    });
    const share = Object.fromEntries([...tally].map(([kind, [hit, all]]) => [kind, +(hit / all).toFixed(3)]));
    // Before 380 every surface facing an axis took the coat (share 1 everywhere).
    expect(share.seat ?? 0, `${id} seats`).toBe(0);
    expect(share.paint, `${id} paint`).toBeGreaterThan(.45);
    expect(share.glass, `${id} glass`).toBeGreaterThan(.15);
    expect(milliseconds, `${id} exposure map build time`).toBeLessThan(500);
  }, 60000);
});

it('the body coat shader on paint and glass reads the outer-layer map', async () => {
  const body = bodies.find(candidate => candidate.id === 'lightweight-sports')!;
  const scene = await load(body.id);
  const { VehicleModel } = await import('../src/vehicles/VehicleModel');
  new VehicleModel(scene, body);
  const materials: THREE.MeshStandardMaterial[] = [];
  scene.traverse(node => {
    if (node instanceof THREE.Mesh && !Array.isArray(node.material) && (PAINT.test(node.material.name) || GLASS.test(node.material.name))) materials.push(node.material);
  });
  expect(materials.length).toBeGreaterThan(1);
  for (const material of materials) {
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: '#include <common>\nvoid main(){\n#include <project_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main(){\n#include <color_fragment>\n#include <roughnessmap_fragment>\n}',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.coatExposure?.value, material.name).toBeInstanceOf(THREE.DataTexture);
    expect(shader.fragmentShader).toMatch(/wet\*=mod\(tile,2\.0\)<\.5\?step\(outer-inside,plane\.z\):step\(plane\.z,outer\+inside\)/);
  }
});
