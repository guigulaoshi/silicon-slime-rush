import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GARAGE_STAGE, GaragePreview } from '../src/ui/GaragePreview';
import { VehicleModel } from '../src/vehicles/VehicleModel';
import { VEHICLES, vehicleFor } from '../src/vehicles/catalogue';
import { I18n } from '../src/ui/i18n';

const draws = vi.hoisted(() => [] as { scene: THREE.Scene; camera: THREE.PerspectiveCamera }[]);
const renderers = vi.hoisted(() => [] as { params: { antialias?: boolean }; shadowMap: { enabled?: boolean }; pixelRatio?: number }[]);
vi.mock('three', async original => {
  const actual = await original<typeof THREE>();
  return { ...actual, WebGLRenderer: class {
    domElement = document.createElement('canvas');
    shadowMap: { enabled?: boolean } = {};
    pixelRatio?: number;
    constructor(readonly params: { antialias?: boolean } = {}) { renderers.push(this); }
    setPixelRatio(ratio: number) { this.pixelRatio = ratio; }
    setSize() {}
    dispose() {}
    forceContextLoss() {}
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      draws.push({ scene, camera });
    }
  } };
});

vi.mock('../src/world/Reflection', () => ({
  bakeReflection: () => new THREE.WebGLRenderTarget(1, 1),
}));

beforeEach(() => {
  draws.length = 0;
  vi.restoreAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(VehicleModel, 'load').mockImplementation(async body => {
    const bytes = readFileSync('public/models/cars/' + body.id + '.glb');
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
    return new VehicleModel(gltf.scene, body);
  });
});

// Every case parses all nine production glb files. Alone the first width takes 2.0 s; inside the full
// parallel vitest run it passed the 5 s default and turned the delivery gate red with no assertion failing.
describe('production model garage framing and ownership', { timeout: 30_000 }, () => {
  for (const width of [160, 500, 800]) it('frames every actual model at width ' + width, async () => {
    const node = document.createElement('div');
    Object.defineProperties(node, { clientWidth: { value: width }, clientHeight: { value: 260 } });
    document.body.replaceChildren(node);
    const preview = new GaragePreview(node, new I18n('en'), () => {}, () => 'high');
    let vertices = 0;
    let pose: number[] | undefined;
    for (const vehicle of VEHICLES) {
      preview.show(vehicle, true);
      await vi.waitFor(() => expect(preview.ready).toBe(true));
      const { scene, camera } = draws.at(-1)!;
      expect(scene.environment).toBeInstanceOf(THREE.Texture);
      const turntable = scene.getObjectByName('garage-turntable')!;
      expect(turntable).toBeDefined();
      expect(scene.getObjectByName('garage-spotlight')).toBeInstanceOf(THREE.SpotLight);
      expect(scene.getObjectByName('garage-spotlight-beam')).toBeInstanceOf(THREE.Mesh);
      // One camera for every vehicle: fitted to each one, a city pod filled the frame like the bus.
      const current = [...camera.position.toArray(), ...camera.quaternion.toArray(), camera.fov];
      if (!pose) pose = current;
      current.forEach((value, i) => expect(value, vehicle.id + ' camera').toBeCloseTo(pose![i]!, 9));
      turntable.rotation.y = 0;
      turntable.updateMatrixWorld(true);
      for (const body of [vehicle, ...(vehicle.trailer ? [vehicle.trailer] : [])]) {
        const model = scene.getObjectByName('car-' + body.id)!;
        expect(model).toBeDefined();
        const box = new THREE.Box3().setFromObject(model);
        expect(box.min.y, body.id + ' stands on the stage floor').toBeGreaterThan(-.001);
        expect(box.max.y, body.id + ' fits under the stage height').toBeLessThan(GARAGE_STAGE.height);
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            expect(Math.hypot(x, z), body.id + ' fits the stage radius').toBeLessThan(GARAGE_STAGE.radius);
            // The rig stays in frame all the way round the turntable, a long bus pointing at the lens included.
            for (let turn = 0; turn < 8; turn++) {
              const projected = new THREE.Vector3(x, y, z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn / 4 * Math.PI)
                .project(camera);
              expect(Math.abs(projected.x)).toBeLessThan(1);
              expect(Math.abs(projected.y)).toBeLessThan(1);
              expect(Math.abs(projected.z)).toBeLessThan(1);
            }
            vertices++;
          }
      }
      if (vehicle.trailer) {
        const a = scene.getObjectByName('car-' + vehicle.id)!
          .localToWorld(new THREE.Vector3().fromArray(vehicle.hitch!));
        const b = scene.getObjectByName('car-' + vehicle.trailer.id)!
          .localToWorld(new THREE.Vector3().fromArray(vehicle.trailer.hitch!));
        expect(a.distanceTo(b)).toBeLessThan(.00001);
      }
    }
    expect(vertices).toBe(VEHICLES.flatMap(vehicle =>
      [vehicle, ...(vehicle.trailer ? [vehicle.trailer] : [])]).length * 8);
    const dispose = vi.spyOn(VehicleModel.prototype, 'dispose');
    const count = draws.length;
    preview.show(vehicleFor('city-pod')!, false);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(node.querySelectorAll('canvas')).toHaveLength(0);
    window.dispatchEvent(new Event('resize'));
    expect(draws).toHaveLength(count);
    preview.dispose();
  });
});

// Low is what a phone on auto gets since the same day.
describe('garage preview follows the quality setting', { timeout: 30_000 }, () => {
  for (const [quality, antialias, shadows, ratio] of [
    ['low', false, false, 1], ['medium', true, true, 1.25], ['high', true, true, 2],
  ] as const) it('builds at ' + quality, async () => {
    vi.stubGlobal('devicePixelRatio', 3);
    try {
      const node = document.createElement('div');
      Object.defineProperties(node, { clientWidth: { value: 500 }, clientHeight: { value: 260 } });
      document.body.replaceChildren(node);
      const preview = new GaragePreview(node, new I18n('en'), () => {}, () => quality);
      preview.show(vehicleFor('city-pod')!, true);
      await vi.waitFor(() => expect(preview.ready).toBe(true));
      const renderer = renderers.at(-1)!;
      expect(renderer.params.antialias).toBe(antialias);
      expect(renderer.shadowMap.enabled).toBe(shadows);
      expect(renderer.pixelRatio).toBe(ratio);
      expect(draws.at(-1)!.scene.getObjectByName('garage-spotlight')!.castShadow).toBe(shadows);
      preview.dispose();
    } finally { vi.unstubAllGlobals(); }
  });
});
