import { describe, expect, it } from 'vitest';
import { chevronDepth, chevronPath } from '../src/ui/chevron';

const points = (d: string) => [...d.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map(m => [Number(m[1]), Number(m[2])]);
const angle = (a: number[], tip: number[], b: number[]) => {
  const u = [a[0]! - tip[0]!, a[1]! - tip[1]!], v = [b[0]! - tip[0]!, b[1]! - tip[1]!];
  return Math.acos((u[0]! * v[0]! + u[1]! * v[1]!) / Math.hypot(u[0]!, u[1]!) / Math.hypot(v[0]!, v[1]!)) * 180 / Math.PI;
};

describe('chevron buttons', () => {
  it('keeps a 120° nose and a matching notch at any width', () => {
    for (const [w, h] of [[150, 54], [420, 56], [64, 48]]) {
      const p = points(chevronPath(w!, h!, 'next'));
      expect(p).toHaveLength(6);
      expect(angle(p[1]!, p[2]!, p[3]!)).toBeCloseTo(120, 0);
      expect(angle(p[4]!, p[5]!, p[0]!)).toBeCloseTo(360 - 240, 0);
      expect(p[2]![0]).toBeCloseTo(w! - 2, 1);
      expect(p[5]![0]! - p[0]![0]!).toBeCloseTo(p[2]![0]! - p[1]![0]!, 1);
    }
  });

  it('mirrors for back: the nose is on the left edge', () => {
    const p = points(chevronPath(150, 54, 'back'));
    expect(p[5]).toEqual([2, 27]);
    expect(angle(p[4]!, p[5]!, p[0]!)).toBeCloseTo(120, 0);
    expect(chevronDepth(54)).toBeCloseTo(27 / Math.sqrt(3), 5);
  });
});
