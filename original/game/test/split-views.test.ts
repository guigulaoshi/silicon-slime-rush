import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/world/World';

it.each([1280, 1281, 640])('renders complete non-overlapping left and right rectangles at width %i', width => {
  const cameras = [new THREE.PerspectiveCamera(), new THREE.PerspectiveCamera()];
  const viewport = vi.fn(), scissor = vi.fn(), render = vi.fn();
  const renderer = { info: { autoReset: true, reset: vi.fn() }, domElement: { clientWidth: width, clientHeight: 720 },
    getPixelRatio: () => 1, setPixelRatio: vi.fn(), setViewport: viewport, setScissor: scissor, setScissorTest: vi.fn(), render };
  const prepare = vi.fn();
  World.prototype.render.call({ renderer, cameras, scene: new THREE.Scene(),
    quality: 'low', materials: { animate: vi.fn() }, born: 0 } as unknown as World, prepare);
  expect(scissor.mock.calls).toEqual([[0, 0, Math.floor(width / 2), 720],
    [Math.floor(width / 2), 0, width - Math.floor(width / 2), 720]]);
  expect(cameras.map(camera => camera.aspect)).toEqual([Math.floor(width / 2) / 720,
    (width - Math.floor(width / 2)) / 720]);
  expect(render.mock.calls.map(call => call[1])).toEqual(cameras);
  expect(prepare.mock.calls.map(call => call[0])).toEqual([0, 1]);
  expect(viewport.mock.calls.at(-1)).toEqual([0, 0, width, 720]);
});

it('returns to one full-width camera', () => {
  const camera = new THREE.PerspectiveCamera();
  const scissor = vi.fn();
  World.prototype.render.call({ cameras: [camera], renderer: {
    info: { autoReset: true, reset: vi.fn() },
    domElement: { clientWidth: 1280, clientHeight: 720 }, setViewport: vi.fn(),
    getPixelRatio: () => 1, setPixelRatio: vi.fn(), setScissor: scissor, setScissorTest: vi.fn(), render: vi.fn(),
  }, quality: 'low', materials: { animate: vi.fn() }, born: 0 } as unknown as World);
  expect(scissor).toHaveBeenCalledWith(0, 0, 1280, 720);
  expect(camera.aspect).toBe(1280 / 720);
});
