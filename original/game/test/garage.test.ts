import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GARAGE_PROGRESS_DELAY_MS, GaragePreview } from '../src/ui/GaragePreview';
import { VehicleModel } from '../src/vehicles/VehicleModel';
import { VEHICLES, vehicleFor, type VehicleBody } from '../src/vehicles/catalogue';
import { I18n } from '../src/ui/i18n';

// The garage card's own progress bar, its reflection after a WebGL restore, and the
// touch cancelling that keeps a drag on the car from scrolling an iPad's host page.
const draws = vi.hoisted(() => [] as THREE.Scene[]);
const bakes = vi.hoisted(() => ({ count: 0 }));
vi.mock('three', async original => {
  const actual = await original<typeof THREE>();
  return { ...actual, WebGLRenderer: class {
    domElement = document.createElement('canvas');
    shadowMap = {};
    setPixelRatio() {}
    setSize() {}
    dispose() {}
    forceContextLoss() {}
    render(scene: THREE.Scene) { draws.push(scene); }
  } };
});
vi.mock('../src/world/Reflection', () => ({
  bakeReflection: () => { bakes.count++; return new THREE.WebGLRenderTarget(1, 1); },
}));

async function parse(body: VehicleBody): Promise<VehicleModel> {
  const bytes = readFileSync('public/models/cars/' + body.id + '.glb');
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  return new VehicleModel(gltf.scene, body);
}

/** A download the test drives by hand: report progress, then let it finish. */
interface Held { body: VehicleBody; progress: (fraction: number | null) => void; finish: () => void }
let held: Held[] = [];
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  draws.length = 0; bakes.count = 0; held = []; frames = [];
  vi.restoreAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(VehicleModel, 'load').mockImplementation((body, _signal, _stage, onProgress) =>
    new Promise(resolve => held.push({ body, progress: fraction => onProgress?.(fraction),
      finish: () => resolve(parse(body)) })));
});
afterEach(() => vi.unstubAllGlobals());

function card() {
  const node = document.createElement('div');
  Object.defineProperties(node, { clientWidth: { value: 500 }, clientHeight: { value: 260 } });
  document.body.replaceChildren(node);
  return node;
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const bar = (node: HTMLElement) => node.querySelector<HTMLElement>('.sm-model-progress [role="progressbar"]')!;
const indeterminate = (node: HTMLElement) => node.querySelector<HTMLElement>('.sm-model-progress')!.dataset.indeterminate;

describe('The garage card shows its own download progress', { timeout: 30_000 }, () => {
  it('shows real byte progress inside the card after a slow start, and clears it once the car is up', async () => {
    const node = card();
    const preview = new GaragePreview(node, new I18n('zh'), () => {}, () => 'high');
    preview.show(vehicleFor('city-pod')!, true);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(node.dataset.progress, 'not yet: a fast load never shows the bar').toBeUndefined();
    expect(node.querySelector('.sm-model-message')!.textContent).toBe('正在加载车辆…');
    await wait(GARAGE_PROGRESS_DELAY_MS + 50);
    expect(node.dataset.progress).toBe('shown');
    expect(indeterminate(node), 'no fraction claimed before the size is known').toBe('true');
    held[0]!.progress(.4);
    expect(indeterminate(node)).toBeUndefined();
    expect(bar(node).getAttribute('aria-valuenow')).toBe('40');
    held[0]!.progress(null);
    expect(indeterminate(node), 'a size that turns out unknown drops back to the sliding bar').toBe('true');
    held[0]!.finish();
    await vi.waitFor(() => expect(preview.ready).toBe(true));
    expect(node.dataset.progress).toBeUndefined();
    expect(node.querySelector('canvas')).not.toBeNull();
    preview.dispose();
  });

  it('never shows the bar for a load that is over within the delay', async () => {
    const node = card();
    const preview = new GaragePreview(node, new I18n('en'), () => {}, () => 'high');
    preview.show(vehicleFor('city-pod')!, true);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    held[0]!.progress(1); held[0]!.finish();
    await vi.waitFor(() => expect(preview.ready).toBe(true));
    await wait(GARAGE_PROGRESS_DELAY_MS + 50);
    expect(node.dataset.progress).toBeUndefined();
    preview.dispose();
  });

  it('starts over for a newly picked car and splits the bar between a pickup and its trailer', async () => {
    const rig = VEHICLES.find(vehicle => vehicle.trailer)!;
    const node = card();
    const preview = new GaragePreview(node, new I18n('en'), () => {}, () => 'high');
    preview.show(vehicleFor('city-pod')!, true);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    await wait(GARAGE_PROGRESS_DELAY_MS + 50);
    held[0]!.progress(.9);
    expect(bar(node).getAttribute('aria-valuenow')).toBe('90');
    preview.show(rig, true);
    await vi.waitFor(() => expect(held).toHaveLength(2));
    // The superseded download's late reports no longer move the new car's bar.
    held[0]!.progress(1);
    expect(bar(node).getAttribute('aria-valuenow'), 'the new pick starts from empty').toBe('0');
    await wait(GARAGE_PROGRESS_DELAY_MS + 50);
    expect(node.dataset.progress).toBe('shown');
    expect(node.querySelector('canvas'), 'no stale car stays on the card').toBeNull();
    held[1]!.progress(.5);
    expect(bar(node).getAttribute('aria-valuenow')).toBe('25');
    held[1]!.progress(1); held[1]!.finish();
    await vi.waitFor(() => expect(held).toHaveLength(3));
    expect(held[2]!.body.id).toBe(rig.trailer!.id);
    held[2]!.progress(.5);
    expect(bar(node).getAttribute('aria-valuenow')).toBe('75');
    held[2]!.finish();
    await vi.waitFor(() => expect(preview.ready).toBe(true));
    expect(node.dataset.progress).toBeUndefined();
    preview.dispose();
  });
});

describe('The garage card after a WebGL restore and under an iPad finger', { timeout: 30_000 }, () => {
  async function ready(node: HTMLElement) {
    const preview = new GaragePreview(node, new I18n('en'), () => {}, () => 'high');
    preview.show(vehicleFor('city-pod')!, true);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    held[0]!.finish();
    await vi.waitFor(() => expect(preview.ready).toBe(true));
    return preview;
  }

  it('rebakes the room reflection and redraws on the next frame after the context comes back', async () => {
    const node = card();
    const preview = await ready(node);
    const scene = draws.at(-1)!;
    const before = scene.environment;
    expect(bakes.count).toBe(1);
    node.querySelector('canvas')!.dispatchEvent(new Event('webglcontextrestored'));
    const drawn = draws.length;
    frames.splice(0).forEach(frame => frame(performance.now()));
    expect(bakes.count, 'the GPU-only reflection is baked again').toBe(2);
    expect(scene.environment, 'the scene reads the new reflection').not.toBe(before);
    expect(scene.environment).toBeInstanceOf(THREE.Texture);
    expect(draws.length, 'the restored card is drawn even with no frame loop running').toBeGreaterThan(drawn);
    frames.splice(0).forEach(frame => frame(performance.now()));
    expect(bakes.count, 'only once per restore').toBe(2);
    preview.dispose();
  });

  it('cancels touchstart and touchmove on the car, with non-passive listeners, but not on the retry button', async () => {
    const node = card();
    const listen = vi.spyOn(node, 'addEventListener');
    const preview = await ready(node);
    for (const type of ['touchstart', 'touchmove']) {
      expect(listen.mock.calls.find(([name]) => name === type)?.[2]).toEqual({ passive: false });
    }
    const touch = (target: Element, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const canvas = node.querySelector('canvas')!;
    expect(touch(canvas, 'touchstart')).toBe(true);
    expect(touch(canvas, 'touchmove')).toBe(true);
    expect(touch(node.querySelector('.sm-model-retry')!, 'touchstart'), 'the retry button keeps its tap').toBe(false);
    preview.dispose();
  });
});
