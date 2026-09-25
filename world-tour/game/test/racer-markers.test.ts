import { afterEach, expect, it, vi } from 'vitest';
import { MiniMap } from '../src/ui/MiniMap';
import { NavMap, headingUp } from '../src/ui/NavMap';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('both maps draw opponents at their existing world projection, including the other human', () => {
  vi.stubGlobal('devicePixelRatio', 1);
  const calls: Record<string, any> = {};
  const context = new Proxy(calls, { get(target, key: string) { return target[key] ??= vi.fn(); } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  const rival = { id: 'ai-bus', x: 50, z: 0, rank: 1 };
  const human = { id: 'player-2', x: 0, z: 50, rank: 2, player: 1 };
  const view = { x: 0, z: 0, headingX: 0, headingZ: -1, s: 0 };
  const mini = new MiniMap();
  mini.setRoute({ id: 'sample', points: [[-100, 0, -100], [100, 0, 100]], checkpoints: [], length: 283, closed: false });
  vi.clearAllMocks(); mini.draw(view, [rival, human]);
  expect(context.arc).toHaveBeenCalledWith(109.5, 75, 3.2, 0, Math.PI * 2);
  expect(context.rect).toHaveBeenCalledWith(71, 105.5, 8, 8);
  const nav = new NavMap(); nav.setStreets({ roads: [], line: [] } as any);
  vi.clearAllMocks(); nav.draw(view, [rival, human]);
  const [x, y] = headingUp(view, 170, 190)(rival.x, rival.z);
  expect(context.arc).toHaveBeenCalledWith(x, y, 3.2, 0, Math.PI * 2);
});
