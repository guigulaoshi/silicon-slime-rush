import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { RecordingColliderSink } from '../src/physics/colliders';
import { Landmarks } from '../src/world/Landmarks';

const parse = vi.hoisted(() => vi.fn());
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    setMeshoptDecoder() { return this; }
    parseAsync = parse;
  },
}));
const ref = { id: 'arena', file: '../../models/arena.glb', pos: [100, 3, 200] as [number, number, number], yaw: .3, loadRadius: 50 };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); parse.mockReset(); });

it('loads only near the venue, preserves colours, and frees shared geometry and materials when the world retires', async () => {
  const model = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: '#dd6633', vertexColors: true }));
  model.add(mesh);
  const geometry = vi.spyOn(mesh.geometry, 'dispose');
  const material = vi.spyOn(mesh.material, 'dispose');
  const fetcher = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  vi.stubGlobal('fetch', fetcher); parse.mockResolvedValue({ scene: model });
  const landmarks = new Landmarks([ref], '/tracks/test');
  landmarks.update(0, 0); expect(fetcher).not.toHaveBeenCalled();
  landmarks.update(100, 200); landmarks.update(100, 200); await settle();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const instance = landmarks.root.children[0]!;
  expect(instance.position.toArray()).toEqual(ref.pos);
  expect(instance.rotation.y).toBe(ref.yaw);
  expect(mesh.material.vertexColors).toBe(true);
  expect(mesh.material.color.getHexString()).toBe('dd6633');
  expect(landmarks.root.children).toHaveLength(1);
  landmarks.update(500, 500);
  expect(landmarks.root.children).toHaveLength(0);
  expect(geometry).not.toHaveBeenCalled(); expect(material).not.toHaveBeenCalled();
  landmarks.dispose();
  expect(geometry).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1);
});

it('disposes an in-flight parsed model after exiting the world instead of attaching it late', async () => {
  let finish!: (value: { scene: THREE.Group }) => void;
  const model = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); model.add(mesh);
  const geometry = vi.spyOn(mesh.geometry, 'dispose');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
  parse.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const landmarks = new Landmarks([ref], '/tracks/test'); landmarks.update(100, 200); await settle();
  landmarks.dispose(); finish({ scene: model }); await settle();
  expect(landmarks.root.children).toHaveLength(0); expect(geometry).toHaveBeenCalledTimes(1);
});

it('does not retry an unavailable model every frame', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 }); vi.stubGlobal('fetch', fetcher);
  const landmarks = new Landmarks([ref], '/tracks/test');
  for (let i = 0; i < 60; i++) { landmarks.update(100, 200); await settle(); }
  expect(fetcher).toHaveBeenCalledTimes(1); landmarks.dispose();
});


it('lights the original glass at night without replacing the authored colours or adding scene lights', async () => {
  const model = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ name: 'building_landmark_glass', color: '#335566', vertexColors: true });
  model.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
  parse.mockResolvedValue({ scene: model });
  const landmarks = new Landmarks([ref], '/tracks/test', 'night');
  landmarks.update(100, 200); await settle();
  expect(material.color.getHexString()).toBe('335566'); expect(material.vertexColors).toBe(true);
  expect(material.emissive.r).toBeGreaterThan(0);
  const shader = { fragmentShader: '#include <emissivemap_fragment>' };
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  expect(shader.fragmentShader).toContain('diffuseColor.rgb * 0.065');
  let lights = 0; model.traverse(node => { if (node instanceof THREE.Light) lights++; });
  expect(lights).toBe(0); landmarks.dispose();
});

it('retains a landmark needed by either viewport, deduplicates overlap and releases after both leave', async () => {
  const model = new THREE.Group();
  const fetcher = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  vi.stubGlobal('fetch', fetcher); parse.mockResolvedValue({ scene: model });
  const landmarks = new Landmarks([ref], '/tracks/test');
  landmarks.updateMany([{ x: 900, z: 900 }, { x: 100, z: 200 }]); await settle();
  expect(landmarks.root.children).toHaveLength(1);
  landmarks.updateMany([{ x: 100, z: 200 }, { x: 100, z: 200 }]); await settle();
  expect(fetcher).toHaveBeenCalledTimes(1);
  landmarks.updateMany([{ x: 100, z: 200 }, { x: 900, z: 900 }]);
  expect(landmarks.root.children).toHaveLength(1);
  landmarks.updateMany([{ x: 900, z: 900 }, { x: 900, z: 900 }]);
  expect(landmarks.root.children).toHaveLength(0); landmarks.dispose();
});


it('keeps preparation pending until the nearby model is parsed', async () => {
  let finish!: (value: { scene: THREE.Group }) => void;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
  parse.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const landmarks = new Landmarks([ref], '/tracks/test');
  let ready = false;
  const preparation = landmarks.prepare([{ x: 100, z: 200 }]).then(() => { ready = true; });
  await settle(); expect(ready).toBe(false);
  const scene = new THREE.Group(); finish({ scene }); await preparation;
  expect(landmarks.root.children).toHaveLength(1);
  landmarks.dispose();
});

it('allows startup with the existing missing-landmark fallback', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  const landmarks = new Landmarks([ref], '/tracks/test');
  await landmarks.prepare([{ x: 100, z: 200 }]);
  expect(landmarks.root.children).toHaveLength(0);
  landmarks.dispose();
});


it('shares one parse across repeated placements, transforms collision, and keeps the other instance alive', async () => {
  const model = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 4), new THREE.MeshStandardMaterial());
  mesh.position.y = 1; model.add(mesh);
  const geometry = vi.spyOn(mesh.geometry, 'dispose'), material = vi.spyOn(mesh.material, 'dispose');
  const fetcher = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  vi.stubGlobal('fetch', fetcher); parse.mockResolvedValue({ scene: model });
  const colliders = new RecordingColliderSink();
  const a = { ...ref, collision: true }, b = { ...ref, pos: [200, 5, 200] as [number, number, number], yaw: Math.PI / 2, collision: true };
  const landmarks = new Landmarks([a, b], '/tracks/test', 'day', colliders);
  await landmarks.prepare([{x:100,z:200}, {x:200,z:200}]);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(parse).toHaveBeenCalledTimes(1);
  expect(landmarks.root.children).toHaveLength(2); expect(colliders.tiles.size).toBe(2);
  const clones = landmarks.root.children.map(group => group.children[0] as THREE.Mesh);
  expect(clones[0]!.geometry).toBe(clones[1]!.geometry);
  const second = colliders.tiles.get('landmark:1')!.trimeshes[0]!;
  const xs = Array.from(second.vertices).filter((_, i) => i % 3 === 0);
  const ys = Array.from(second.vertices).filter((_, i) => i % 3 === 1);
  expect(Math.min(...xs)).toBeCloseTo(198); expect(Math.max(...xs)).toBeCloseTo(202);
  expect(Math.min(...ys)).toBeCloseTo(5); expect(Math.max(...ys)).toBeCloseTo(7);
  landmarks.update(100, 200);
  expect(landmarks.root.children).toHaveLength(1); expect(colliders.tiles.size).toBe(1);
  expect(geometry).not.toHaveBeenCalled(); expect(material).not.toHaveBeenCalled();
  await landmarks.prepare([{x:200,z:200}]);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(parse).toHaveBeenCalledTimes(1);
  landmarks.dispose(); expect(colliders.tiles.size).toBe(0);
  expect(geometry).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1);
});

it('does not cancel a shared pending template when just one placement leaves', async () => {
  let finish!: (value: {scene: THREE.Group}) => void;
  const fetcher = vi.fn().mockResolvedValue({ok:true, arrayBuffer:async()=>new ArrayBuffer(0)});
  vi.stubGlobal('fetch',fetcher); parse.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const other={...ref,pos:[200,3,200] as [number,number,number]};
  const landmarks=new Landmarks([ref,other],'/tracks/test');
  const ready=landmarks.prepare([{x:100,z:200},{x:200,z:200}]);
  await settle();landmarks.update(200,200);finish({scene:new THREE.Group()});await ready;
  expect(fetcher).toHaveBeenCalledTimes(1);expect(landmarks.root.children).toHaveLength(1);
  expect(landmarks.root.children[0]!.position.toArray()).toEqual(other.pos);
  landmarks.dispose();
});
