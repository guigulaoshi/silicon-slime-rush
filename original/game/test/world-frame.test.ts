import { expect, it, vi } from 'vitest';
import { World } from '../src/world/World';

it('counts every viewport exactly once in the frame and clears the previous frame totals', () => {
  const info = { autoReset: true, render: { calls: 0, triangles: 0 }, reset: () => { info.render.calls = 0; info.render.triangles = 0; } };
  const renderer = { info, getPixelRatio: () => 1, setPixelRatio: vi.fn(),
    domElement: { clientWidth: 1280, clientHeight: 720 }, setScissorTest: vi.fn(), setViewport: vi.fn(), setScissor: vi.fn(),
    render: vi.fn(() => { if (info.autoReset) info.reset(); info.render.calls += 5; info.render.triangles += 100; }),
  };
  const cameras = [{ aspect: 0, updateProjectionMatrix: vi.fn() }, { aspect: 0, updateProjectionMatrix: vi.fn() }];
  const world = { renderer, cameras, quality: 'high', born: 0, materials: { animate: vi.fn() }, scene: {} };
  const beforeView = vi.fn();
  for (let i = 0; i < 2; i++) {
    World.prototype.render.call(world as unknown as World, beforeView);
    expect(info.render).toEqual({ calls: 10, triangles: 200 });
    expect(cameras.map(c => c.aspect)).toEqual([640 / 720, 640 / 720]);
  }
  expect(beforeView.mock.calls.map(args => args[0])).toEqual([0, 1, 0, 1]);
});
