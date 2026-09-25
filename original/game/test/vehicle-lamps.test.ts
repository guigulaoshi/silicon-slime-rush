import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import data from '../src/vehicles/catalogue.json' with { type: 'json' };
import { lampSurfaces, type LampSurface } from '../test-support/lampSurfaces';
import * as THREE from 'three';
import type { VehicleBody, VehicleLight } from '../src/vehicles/catalogue';
import { VehicleModel } from '../src/vehicles/VehicleModel';

// The glow lenses of 263 were hand-placed and drifted when the models were rebuilt, so tail
// glows floated above the lamps (lightweight-sports 10 cm high, jeep 22 cm behind the body). Every
// catalogued lamp must sit on a lamp face of its own model, and every lamp face must have a lens.
const TOLERANCE = .015;
const bodies = (data.vehicles as unknown as (VehicleBody & { trailer?: VehicleBody })[])
  .flatMap(vehicle => [vehicle, ...(vehicle.trailer ? [vehicle.trailer] : [])]);

async function model(id: string) {
  const bytes = readFileSync(`public/models/cars/${id}.glb`);
  const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
  return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '')).scene;
}

function expectOnLamps(id: string, kind: string, specs: readonly VehicleLight[], lamps: LampSurface[], outward: 1 | -1) {
  expect(specs.length, `${id} ${kind}: ${lamps.length} lamp faces in the model`).toBe(lamps.length);
  for (const lamp of lamps) {
    const lens = specs.find(spec => Math.abs(spec.position[0] - lamp.centre[0]) <= TOLERANCE
      && Math.abs(spec.position[1] - lamp.centre[1]) <= TOLERANCE);
    expect(lens, `${id} ${kind}: no lens on the lamp at ${lamp.centre.map(n => n.toFixed(3))}`).toBeDefined();
    const clearance = (lens!.position[2] - lamp.centre[2]) * outward;
    expect(clearance, `${id} ${kind}: lens ${clearance.toFixed(3)} m off the lamp face`).toBeGreaterThanOrEqual(0);
    expect(clearance).toBeLessThanOrEqual(TOLERANCE);
    expect(lens!.size[0]).toBeGreaterThanOrEqual(lamp.size[0]);
    expect(lens!.size[1]).toBeGreaterThanOrEqual(lamp.size[1]);
  }
}

describe('vehicle lamp lenses sit on the model lamps', () => {
  it.each(bodies.map(body => [body.id, body] as const))('%s', async (id, body) => {
    const scene = await model(id);
    expectOnLamps(id, 'tail', body.lights.brakeLights, lampSurfaces(scene, 'Red tail lamp', 'rear'), 1);
    const heads = lampSurfaces(scene, 'Headlight reflector', 'front');
    // city-pod draws its oval headlamps from shared trim materials; it has no reflector face to check.
    if (heads.length) expectOnLamps(id, 'head', body.lights.headlights.filter(light => light.mount !== 'roof'), heads, -1);

    // A braking lens grows, but a long thin light bar must not grow past the body beside it.
    scene.updateMatrixWorld(true);
    const hull: THREE.Vector3[] = [];
    scene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const position = node.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) hull.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld));
    });
    const visual = new VehicleModel(scene, body);
    visual.setBrakeLights(true, true);
    body.lights.brakeLights.forEach((spec, index) => {
      const lens = visual.brakeLights.getObjectByName(`brake-lens-${index}`)!;
      const side = Math.max(...hull.filter(p => Math.abs(p.y - spec.position[1]) < spec.size[1] / 2 + .02 && Math.abs(p.z - spec.position[2]) < .08).map(p => Math.abs(p.x)));
      expect(Math.abs(spec.position[0]) + lens.scale.x / 2, `${id} braking lens ${index} past the body side ${side.toFixed(3)}`).toBeLessThanOrEqual(side + .01);
    });
  }, 30000);
});
