import { describe, expect, it } from 'vitest';
import { SurfaceGrid, type SurfaceZone } from '../src/world/SurfaceGrid';

const zone = (key: string, x: number, tile = 'tile-a'): SurfaceZone =>
  ({ key, tile, source: 'dynamic', kind: 'slick', x, z: 0, radius: 4 });

describe('SurfaceGrid', () => {
  it('queries dynamic zones through cell boundaries with a feathered edge', () => {
    const grid = new SurfaceGrid(8);
    grid.add(zone('left', 7.8));
    grid.add(zone('right', 8.4));
    expect(grid.query(8, 0)).toEqual({ slick: 1 });
    expect(grid.query(4.2, 0).slick).toBeCloseTo(0.5);
    expect(grid.query(3, 0)).toEqual({ slick: 0 });
    grid.removeTile('tile-a');
    expect(grid.count).toBe(0);
  });

  it('returns and removes the globally oldest zone when the quality cap is reached', () => {
    const grid = new SurfaceGrid(3);
    grid.add(zone('oldest', 0));
    grid.add(zone('middle', 20));
    grid.add(zone('newer', 40));
    expect(grid.add(zone('newest', 60)))
      .toEqual([expect.objectContaining({ key: 'oldest' })]);
    expect(grid.query(0, 0)).toEqual({ slick: 0 });
    expect(grid.count).toBe(3);
    expect(grid.setLimit(2)).toEqual([expect.objectContaining({ key: 'middle' })]);
  });
});
