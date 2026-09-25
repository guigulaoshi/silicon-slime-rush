import * as THREE from 'three';
import { LANDMARK_FLOOD, lightAuthoredLandmark } from '../src/world/materials';
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
  // Glass lights a grid of windows from its world position on vertical faces, not one flat glow.
  const shader = { vertexShader: '#include <common>\n#include <worldpos_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  expect(shader.fragmentShader).toContain('lmWindows(vLandmarkWorld, normalize(vLandmarkNormal))');
  expect(shader.vertexShader).toContain('vLandmarkNormal = normalize(mat3(modelMatrix) * objectNormal)');
  let lights = 0; model.traverse(node => { if (node instanceof THREE.Light) lights++; });
  expect(lights).toBe(0); landmarks.dispose();
});

it("floodlights a monument's copper and bronze at night like its stone, and leaves the day alone", () => {
  const copper = new THREE.MeshStandardMaterial({ name: 'statue-of-liberty_copper' });
  lightAuthoredLandmark(copper, 'night');
  const shader = { vertexShader: '#include <common>\n#include <worldpos_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
  copper.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  expect(shader.fragmentShader).toContain(`totalEmissiveRadiance += diffuseColor.rgb * ${LANDMARK_FLOOD.plain.toFixed(3)}`);
  const day = new THREE.MeshStandardMaterial({ name: 'statue-of-liberty_copper' });
  lightAuthoredLandmark(day, 'day');
  expect(day.onBeforeCompile.toString()).not.toContain('lmWindows');
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

it('floodlights a monument from the ground up, so the faces away from the lamps and the roofs stay darker', () => {
  // The first World Tour gave every face the same glow, and a pale tower (Dubai's Burj Khalifa) on a
  // rainy night was one flat white slab. The glow is scaled by which way the face points: full on
  // walls facing the two ground lamps, `shade` on walls facing away, `roof` on roofs; and it pools
  // at the foot. Read from the compiled shader, so deleting the facing term turns this red.
  const stone = new THREE.MeshStandardMaterial({ name: 'burj-khalifa_concrete' });
  lightAuthoredLandmark(stone, 'night');
  const shader = { vertexShader: '#include <common>\n#include <worldpos_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
  stone.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  const f = (v: number) => v.toFixed(3);
  const { lamps, shade, roof, stone: level, pool, fadeM } = LANDMARK_FLOOD;
  expect(shader.vertexShader).toContain('vLandmarkNormal = normalize(mat3(modelMatrix) * objectNormal)');
  expect(shader.vertexShader).toContain('vLandmarkHeight = transformed.y');
  expect(shader.fragmentShader).toContain(`vec2(${f(lamps[0][0])}, ${f(lamps[0][1])})`);
  expect(shader.fragmentShader).toContain(`vec2(${f(lamps[1][0])}, ${f(lamps[1][1])})`);
  expect(shader.fragmentShader).toContain(`float fwall = ${f(shade)} + ${f(1 - shade)} * max(fa, fb);`);
  expect(shader.fragmentShader).toContain(`float facing = mix(fwall, ${f(roof)}, fup);`);
  expect(shader.fragmentShader).toContain(`diffuseColor.rgb * ${f(level)}`);
  expect(shader.fragmentShader).toContain(`${f(pool)} * exp(-max(vLandmarkHeight, 0.0) / ${f(fadeM)})`);
  expect(shader.fragmentShader, 'the glow must be scaled by the facing term').toMatch(/exp\([^;]*\)\) \* facing;/);
  expect(shade, 'walls facing away stay clearly darker than lit ones').toBeLessThan(.34);
  expect(roof, 'roofs are not floodlit').toBeLessThanOrEqual(shade);
  // the stone's own surface detail is still there
  expect(shader.fragmentShader).toContain('lmFbm');
});

it('lights a skyscraper up its whole facade with a brighter crown, and a low monument from the ground', () => {
  // A ground wash that fades over 60 m left Shanghai's 400-600 m towers black silhouettes across the
  // river. From LANDMARK_FLOOD.towerM up the wash no longer fades with height and the crown is lifted;
  // below it nothing changes. Read from the compiled shaders, so removing the tower branch turns this red.
  const compile = (height: number) => {
    const m = new THREE.MeshStandardMaterial({ name: 'shanghai-tower_steel' });
    lightAuthoredLandmark(m, 'night', height);
    const shader = { vertexShader: '#include <common>\n#include <worldpos_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
    m.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    return { fragment: shader.fragmentShader, key: m.customProgramCacheKey() };
  };
  const f = (v: number) => v.toFixed(3);
  const { tower, crown, crownBoost, towerM, pool, fadeM } = LANDMARK_FLOOD;
  const tall = compile(632);
  expect(tall.fragment).toContain(`diffuseColor.rgb * ${f(tower)} * (1.0 + ${f(crownBoost)} * smoothstep(${f(1 - crown)}, 1.0, vLandmarkHeight / 632.000))`);
  expect(tall.fragment, 'a tower is not a ground wash').not.toContain(`exp(-max(vLandmarkHeight, 0.0) / ${f(fadeM)})`);
  expect(tall.fragment, 'still scaled by which way the face points').toMatch(/\) \* facing;/);
  const low = compile(towerM - 1);
  expect(low.fragment).toContain(`${f(pool)} * exp(-max(vLandmarkHeight, 0.0) / ${f(fadeM)})`);
  expect(low.key, 'the two need different shader programs').not.toBe(tall.key);
  expect(tower, 'a tower facade reads brighter than a monument wash').toBeGreaterThan(LANDMARK_FLOOD.plain);
});

it("glows a tower's strongly coloured glass in its own colour at night, and keeps grey glass as windows", () => {
  // The Oriental Pearl's pink spheres read as a warm office-window grid across the river. The share is
  // read from the glass colour's saturation in the compiled shader, so removing it turns this red.
  const compile = (height: number) => {
    const m = new THREE.MeshStandardMaterial({ name: 'oriental-pearl-tower_sphere_glass' });
    lightAuthoredLandmark(m, 'night', height);
    const shader = { vertexShader: '#include <common>\n#include <worldpos_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
    m.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    return shader.fragmentShader;
  };
  const { ledSat, led } = LANDMARK_FLOOD;
  const tower = compile(468);
  expect(tower).toContain(`smoothstep(${ledSat[0].toFixed(3)}, ${ledSat[1].toFixed(3)}, (hi - lo) / max(hi, 1e-3))`);
  expect(tower).toContain(`lc / max(hi, 1e-3) * ${led.toFixed(3)}, ledShare)`);
  expect(compile(60), 'glass on a low building stays windows').not.toContain('ledShare');
});
