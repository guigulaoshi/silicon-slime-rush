import { describe, expect, it } from 'vitest';
import { SAFETY_NET_DROP, Spline, buildSafetyNet } from '../src/track/Spline';
import { projectOnSample } from '../src/track/Progress';
import type { TrackData, Vec3 } from '../src/track/types';

function straight(n = 51, step = 2, closed = false): TrackData {
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) points.push([i * step, 5, 0]);
  return {
    id: 't', version: 1, editions: ['full'], category: 'race', mode: 'p2p', laps: 1,
    name: { zh: '', en: '' }, blurb: { zh: '', en: '' },
    origin: { lat: 0, lon: 0 }, timeOfDay: 'day', car: 'sedan',
    spline: { points, halfWidth: new Array(n).fill(4), closed, length: (n - 1) * step },
    start: { pos: [0, 5, 0], yaw: 0 }, checkpoints: [], tiles: [],
    tilePack: { file: 'tiles.bin', bytes: 0 }, attribution: [],
  } as TrackData;
}

describe('Spline', () => {
  it('measures arc length and finds the sample at a distance', () => {
    const s = new Spline(straight());
    expect(s.length).toBe(100);
    expect(s.s[s.count - 1]).toBeCloseTo(100);
    expect(s.indexAt(40)).toBe(20);
  });

  it('uses the exported three-dimensional sample arc as its authoritative distance scale', () => {
    const data = straight(3, 3);
    data.spline = { points: [[0,0,0],[3,4,0],[6,4,0]], halfWidth: [4,4,4],
      closed: false, s: [0,5,8], length: 8 };
    const spline = new Spline(data);
    expect([...spline.s]).toEqual([0,5,8]);
    expect(spline.length).toBe(8);
    expect(spline.indexAt(5)).toBe(1);
    expect(projectOnSample(spline, 0, 1.5, 0).s).toBeCloseTo(2.5);
  });

  it('points east and puts its right hand south', () => {
    const s = new Spline(straight());
    const t = s.tangent(10);
    expect(t[0]).toBeCloseTo(1); expect(t[2]).toBeCloseTo(0);
    const r = s.right(10);
    expect(r[0]).toBeCloseTo(0); expect(r[2]).toBeCloseTo(1);
  });

  it('owns the road normal for every road-aligned visual', () => {
    const data = straight();
    data.spline.points = data.spline.points.map(([x, _y, z]) => [x, 5 + x * 0.25, z]);
    const s = new Spline(data);
    const normal = s.normal(10);
    const tangent = s.tangent(10);
    expect(Math.hypot(...normal)).toBeCloseTo(1);
    expect(normal[0] * tangent[0] + normal[1] * tangent[1] + normal[2] * tangent[2])
      .toBeCloseTo(0);
    expect(normal[1]).toBeGreaterThan(0);
  });

  it('clamps indices on a sprint and wraps them on a loop', () => {
    expect(new Spline(straight()).wrapIndex(-3)).toBe(0);
    expect(new Spline(straight(51, 2, true)).wrapIndex(-1)).toBe(50);
  });
});

describe('buildSafetyNet', () => {
  it('can stop at timing lines when mapped continuations supply their own ground', () => {
    const spline = new Spline(straight());
    const net = buildSafetyNet(spline, undefined, 2, 0, 0);
    const xs = [...net.vertices].filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBe(0); expect(Math.max(...xs)).toBe(100);
    expect(net.indices.length).toBe((spline.count - 1) * 6);
  });
  it('sits under the road, wider than it, and covers the whole track', () => {
    const spline = new Spline(straight());
    const net = buildSafetyNet(spline, undefined, 2);
    // one extra row at each end: a car spawning on the open edge would otherwise slip off it
    expect(net.vertices.length / 3).toBe((spline.count + 2) * 2);
    expect(net.indices.length / 3).toBe((spline.count + 1) * 2);
    for (let i = 1; i < net.vertices.length; i += 3) expect(net.vertices[i]).toBeCloseTo(5 - SAFETY_NET_DROP);
    const zs = [...net.vertices].filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(-6);   // half width 4 plus 2 of overhang
    expect(Math.max(...zs)).toBeCloseTo(6);
  });

  it('closes the ring on a loop, which needs no apron', () => {
    const spline = new Spline(straight(51, 2, true));
    const net = buildSafetyNet(spline);
    expect(net.vertices.length / 3).toBe((spline.count + 1) * 2);
  });

  it('covers the spawn apron and all three post-finish parking rows', () => {
    const spline = new Spline(straight());
    const net = buildSafetyNet(spline, undefined, 2, 15);
    const xs = [...net.vertices].filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeLessThan(-14);
  expect(Math.max(...xs)).toBeGreaterThan(183);
  });
});

it('asks the wheel-slew planner about an abrupt one-way bend before entering it', async () => {
  const { Autopilot } = await import('../src/bot/Autopilot');
  const data = straight(6);
  data.spline.points = [[0, 0, 0], [2, 0, 0], [4, 0, .1], [6, 0, 1], [7, 0, 3], [7, 0, 5]];
  data.spline.curvature = [0, 0, .02, .1, .12, 0];
  const transitions: [number, number][] = [];
  new Autopilot(new Spline(data)).drive(1 / 60, {
    x: 0, z: 0, speed: 10, forwardSpeed: 10, headingX: 1, headingZ: 0,
    steeringTransitionSpeed: (from, to) => { transitions.push([from, to]); return 1; },
  }, { s: 0, lateral: 0, index: 0 });
  expect(transitions.some(([from, to]) => from * to >= 0 && Math.abs(to) >= .1 && from !== to)).toBe(true);
});

it('preserves unsigned export curvature and supplies left/right reversal signs to the driver', async () => {
  const { Autopilot } = await import('../src/bot/Autopilot');
  const data = straight(7);
  data.spline.points = [[0, 0, 0], [2, 0, 0], [4, 0, 2], [6, 0, 2], [8, 0, 0], [10, 0, 0], [12, 0, 2]];
  data.spline.curvature = Array(7).fill(0.2);
  const spline = new Spline(data);
  expect([...spline.curvature]).toEqual(Array(7).fill(0.2));
  expect([...spline.turnCurvature].some(k => k < 0)).toBe(true);
  expect([...spline.turnCurvature].some(k => k > 0)).toBe(true);
  const transitions: [number, number][] = [];
  new Autopilot(spline).drive(1 / 60, {
    x: 0, z: 0, speed: 10, forwardSpeed: 10, headingX: 1, headingZ: 0,
    steeringTransitionSpeed: (from, to) => { transitions.push([from, to]); return Infinity; },
  }, { s: 0, lateral: 0, index: 0 });
  expect(transitions.some(([from, to]) => from * to < 0)).toBe(true);
  const mirrored = new Spline({ ...data, spline: { ...data.spline,
    points: data.spline.points.map(([x, y, z]) => [x, y, -z]),
  } });
  for (let i = 0; i < spline.count; i++) expect(mirrored.turnCurvature[i]).toBeCloseTo(-spline.turnCurvature[i]!);
});
