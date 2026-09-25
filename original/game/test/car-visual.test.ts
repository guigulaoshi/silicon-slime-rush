import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { VEHICLES, modelPath, wheelCentres, type VehicleBody } from '../src/vehicles/catalogue';
import { VehicleModel } from '../src/vehicles/VehicleModel';
import { ChaseCamera, vehicleChase } from '../src/world/ChaseCamera';

function bytes(body: VehicleBody): ArrayBuffer {
  const source = readFileSync(`public/${modelPath(body)}`);
  const buffer = new ArrayBuffer(source.byteLength);
  new Uint8Array(buffer).set(source);
  return buffer;
}
async function model(body = VEHICLES[0]!): Promise<VehicleModel> {
  return new VehicleModel((await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes(body), '')).scene, body);
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('production vehicle rendering', () => {
  it('builds and switches the authored brake lamps for every playable vehicle', async () => {
    for (const body of VEHICLES) {
      const visual = await model(body);
      expect(visual.brakeLights.children).toHaveLength(body.lights.brakeLights.length * 2);
      // Dim but lit when cruising, day or night; braking is brighter, larger and adds the halo.
      const [lens, halo] = visual.brakeLights.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
      for (const night of [false, true]) {
        visual.setBrakeLights(false, night);
        expect(visual.brakeLights.visible).toBe(true);
        const dim = { opacity: lens!.material.opacity, area: lens!.scale.x * lens!.scale.y };
        expect(dim.opacity).toBeGreaterThan(.2);
        expect(halo!.visible && halo!.material.opacity > 0).toBe(false);
        visual.setBrakeLights(true, night);
        expect(lens!.material.opacity).toBeGreaterThan(dim.opacity * 2);
        // 379: larger by area; a thin light bar grows in height, not past the body.
        expect(lens!.scale.x * lens!.scale.y).toBeGreaterThan(dim.area * 1.2);
        expect(halo!.visible).toBe(true);
        expect(halo!.material.opacity).toBeGreaterThan(.5);
        expect(halo!.scale.x * halo!.scale.y).toBeGreaterThan(lens!.scale.x * lens!.scale.y * 2);
        expect(halo!.material.map).toBeInstanceOf(THREE.DataTexture);
      }
      visual.setBrakeLights(false, false);
      expect(halo!.visible).toBe(false);
      visual.dispose();
    }
  });

  it('drives the real wheel pivots in every car from suspension, speed and front steering', async () => {
    for (const body of VEHICLES) {
      const visual = await model(body);
      // Inside the arch.
      const compression = [.2, .4, .6, .8].map(share => share * body.wheelLift);
      visual.update(12, .25, compression, .1, 0);
      expect(visual.wheels).toHaveLength(4);
      visual.wheels.forEach((wheel, i) => {
        expect(wheel.position.y).toBeCloseTo(wheelCentres(body)[i]![1]! + compression[i]!);
        expect(wheel.rotation.x).toBeCloseTo((-12 * .1 / body.wheelRadius) % (2 * Math.PI));
        expect(wheel.rotation.y).toBeCloseTo(i < 2 ? .25 : 0);
      });
      visual.update(0, 0, [0, 0, 0, 0], 0, 1);
      expect(visual.wheels[0]!.rotation.x).toBe(0);
      expect(visual.wheels[0]!.position.y).toBeCloseTo(wheelCentres(body)[0]![1]!);
      visual.dispose();
    }
  });

  it('keeps every tail-lamp overlay on the body while the visual bump stop lifts and tilts it', async () => {
    for (const body of VEHICLES) {
      const visual = await model(body);
      const root = visual.group.getObjectByName('vehicle-root')!;
      const compression = [.95, .55, .75, .65].map(share => share * body.suspensionRest);
      visual.update(0, 0, compression, 1 / 60, 0);
      visual.group.updateMatrixWorld(true);
      expect(visual.brakeLights.parent, `${body.id}: lamps must follow the rendered body`).toBe(root);
      body.lights.brakeLights.forEach((lamp, index) => {
        const expected = root.localToWorld(new THREE.Vector3(...lamp.position));
        const actual = visual.brakeLights.getObjectByName(`brake-lens-${index}`)!
          .getWorldPosition(new THREE.Vector3());
        expect(actual.distanceTo(expected), `${body.id}: tail lamp ${index} left behind by suspension`)
          .toBeLessThan(1e-7);
      });
      visual.dispose();
    }
  });

  it('owns independent resources and releases each exactly once on repeated disposal', async () => {
    const first = await model(); const second = await model();
    const geometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const material = vi.spyOn(THREE.Material.prototype, 'dispose');
    const scene = new THREE.Scene(); scene.add(first.group, second.group);
    first.dispose();
    const geometryCount = geometry.mock.calls.length;
    const materialCount = material.mock.calls.length;
    expect(geometryCount).toBeGreaterThan(0); expect(materialCount).toBeGreaterThan(0);
    first.dispose();
    expect(geometry).toHaveBeenCalledTimes(geometryCount);
    expect(material).toHaveBeenCalledTimes(materialCount);
    expect(scene.children).toEqual([second.group]);
    second.dispose();
    expect(geometry).toHaveBeenCalledTimes(geometryCount * 2);
    expect(material).toHaveBeenCalledTimes(materialCount * 2);
  });

  it('rejects missing assets and releases a parsed model when its request was cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(VehicleModel.load(VEHICLES[0]!)).rejects.toThrow('model HTTP 404');
    const abort = new AbortController();
    // A real Response: modelBytes streams the body and reads its length for the garage's progress.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes(VEHICLES[0]!))));
    const parse = GLTFLoader.prototype.parseAsync;
    vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockImplementation(async function(this: GLTFLoader, data, path) {
      const parsed = await parse.call(this, data, path);
      abort.abort();
      return parsed;
    });
    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    await expect(VehicleModel.load(VEHICLES[0]!, abort.signal)).rejects.toThrow('cancelled');
    expect(dispose).toHaveBeenCalled();
  });

  it('frames small, long and complete articulated envelopes in landscape and portrait', () => {
    for (const vehicle of VEHICLES) for (const aspect of [16 / 9, 9 / 16]) {
      const camera = new THREE.PerspectiveCamera(58, aspect, .1, 1000);
      new ChaseCamera(vehicleChase(vehicle)).update(camera, new THREE.Vector3(),
        new THREE.Quaternion(), new THREE.Vector3(), 1 / 60);
      camera.updateMatrixWorld(true);
      for (const body of [vehicle, ...(vehicle.trailer ? [vehicle.trailer] : [])]) {
        const offset = body === vehicle ? [0, 0, 0] : vehicle.hitch!.map((n, i) => n - body.hitch![i]!);
        const ground = body.anchorY - body.suspensionRest;
        for (const x of [-1, 1]) for (const y of [ground, ground + body.size[1]!]) for (const z of [-1, 1]) {
          const point = new THREE.Vector3(x * body.size[0]! / 2, y, z * body.size[2]! / 2)
            .add(new THREE.Vector3(...offset as [number, number, number])).project(camera);
          expect(Math.abs(point.x), `${vehicle.id} horizontal crop at ${aspect}`).toBeLessThan(1);
          expect(Math.abs(point.y), `${vehicle.id} vertical crop at ${aspect}`).toBeLessThan(1);
          expect(point.z).toBeLessThan(1);
        }
      }
    }
  });
});

it('AI exit fading preserves independently owned body and glass opacity for restart', async () => {
  const visual = await model(), other = await model();
  const originals = new Map<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();
  visual.group.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material])
      originals.set(material, { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
  });
  expect(originals.size).toBeGreaterThan(1);
  visual.setOpacity(.5);
  for (const [material, original] of originals) {
    expect(material.opacity).toBe(original.opacity * .5); expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
  }
  expect(other.group.visible).toBe(true);
  visual.setOpacity(0); expect(visual.group.visible).toBe(false);
  visual.setOpacity(1); expect(visual.group.visible).toBe(true);
  for (const [material, original] of originals) {
    expect(material.opacity).toBe(original.opacity); expect(material.transparent).toBe(original.transparent);
    expect(material.depthWrite).toBe(original.depthWrite);
  }
  visual.dispose(); other.dispose();
});
