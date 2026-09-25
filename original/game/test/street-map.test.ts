import { expect, it, vi } from 'vitest';
import { loadStreetMap } from '../src/ui/StreetMap';

it('hides declared company labels while preserving their road geometry', async () => {
  const data = { bounds: [0, 0, 100, 100], line: [0, 0, 100, 100], closed: false, roads: [
    { c: 'c', n: 'Apple Park Way', p: [0, 0, 100, 0] },
    { c: 'b', n: 'Wolfe Road', p: [0, 10, 100, 10] },
  ] };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
  const loaded = await loadStreetMap('/map.json', ['Apple Park Way']);
  expect(loaded?.roads).toHaveLength(2);
  expect(loaded?.roads[0]).toEqual({ c: 'c', p: [0, 0, 100, 0] });
  expect(loaded?.roads[1]?.n).toBe('Wolfe Road');
  vi.unstubAllGlobals();
});
