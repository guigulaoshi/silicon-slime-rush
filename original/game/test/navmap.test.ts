import { describe, expect, it, vi } from 'vitest';
import { headingUp, NavMap } from '../src/ui/NavMap';
import { drivenPointCount, MiniMap, northUpArrow } from '../src/ui/MiniMap';

/**
 * Which way is up on the navigation panel.
 *
 * Two sign conventions cross here -- +z is south, and canvas y grows downwards -- and getting
 * either wrong still produces something that looks like a map. It shipped once with the world
 * turned half a turn: the car arrow pointed up, as drawn, but every road ahead of it was drawn
 * behind it, so the panel read as a mirror. That is invisible to any test that only asks whether
 * the panel drew something, so it is arithmetic here.
 */
const SIZE = 200;
const RANGE = 100;
const centre = SIZE / 2;

describe('the navigation panel is heading-up, not heading-down', () => {
  // north, east, south, west, and one off-axis heading
  const headings = [
    { name: 'north', hx: 0, hz: -1 },
    { name: 'east', hx: 1, hz: 0 },
    { name: 'south', hx: 0, hz: 1 },
    { name: 'west', hx: -1, hz: 0 },
    { name: 'north-east', hx: Math.SQRT1_2, hz: -Math.SQRT1_2 },
  ];

  for (const { name, hx, hz } of headings) {
    it(`puts the road ahead at the top and the driver's right on the right, facing ${name}`, () => {
      const view = { x: 137, z: -42, headingX: hx, headingZ: hz };
      const px = headingUp(view, SIZE, RANGE);

      const [ax, ay] = px(view.x + hx * 50, view.z + hz * 50);
      expect(ay, 'fifty metres ahead should be above the car').toBeLessThan(centre - 40);
      expect(ax, 'and straight above it').toBeCloseTo(centre, 6);

      const [bx, by] = px(view.x - hx * 50, view.z - hz * 50);
      expect(by, 'fifty metres behind should be below the car').toBeGreaterThan(centre + 40);
      expect(bx).toBeCloseTo(centre, 6);

      // the driver's right in this frame: x east, z south, so right of the heading is (-hz, hx)
      const [rx, ry] = px(view.x - hz * 50, view.z + hx * 50);
      expect(rx, "the driver's right should be on the right").toBeGreaterThan(centre + 40);
      expect(ry).toBeCloseTo(centre, 6);
    });
  }

  it('puts the car itself in the middle', () => {
    const view = { x: -1602, z: 1009, headingX: 0.6, headingZ: -0.8 };
    const [x, y] = headingUp(view, SIZE, RANGE)(view.x, view.z);
    expect(x).toBeCloseTo(centre, 9);
    expect(y).toBeCloseTo(centre, 9);
  });

  it('scales metres to pixels by the range the panel covers', () => {
    const view = { x: 0, z: 0, headingX: 0, headingZ: -1 };
    const [, y] = headingUp(view, SIZE, RANGE)(0, -RANGE);
    expect(y, 'the edge of the range should be the edge of the panel').toBeCloseTo(0, 6);
  });
});


/**
 * And which way the car points on the north-up route map.
 *
 * Same two conventions crossing -- +z is south, canvas y grows downwards -- and the same failure:
 * an arrow drawn pointing up, rotated by the wrong sign, points exactly backwards on every map. It
 * shipped that way, and it looks like a plausible map right up until you drive.
 */
describe('the car marker on the route map', () => {
  // the marker is drawn pointing up and then rotated clockwise by this angle; work out where its
  // nose lands on screen, where x is east and y is south
  const nose = (hx: number, hz: number) => {
    const a = northUpArrow(hx, hz);
    return [Math.sin(a), -Math.cos(a)];
  };

  it('points the way the car is going, not the other way', () => {
    for (const [hx, hz, name] of [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']] as const) {
      const [x, y] = nose(hx, hz);
      expect(x, `${name}: east-west`).toBeCloseTo(hx, 9);
      expect(y, `${name}: north-south`).toBeCloseTo(hz, 9);
    }
  });

  it('handles a heading off the compass points', () => {
    const hx = 0.6, hz = -0.8;
    const [x, y] = nose(hx, hz);
    expect(x).toBeCloseTo(hx, 9);
    expect(y).toBeCloseTo(hz, 9);
  });
});

it('dims a steep route by its authoritative three-dimensional sample arc', () => {
  const arc = [0, 5, 8]; // [0,0,0] -> [3,4,0] -> [6,4,0]
  expect(drivenPointCount(arc, 2.5, 8, false)).toBe(1);
  expect(drivenPointCount(arc, 5, 8, false)).toBe(2);
  expect(drivenPointCount(arc, 8, 8, false)).toBe(3);
  expect(drivenPointCount(arc, 10.5, 8, true)).toBe(1);
});


it('draws roads beyond the old range when enlarged and restores the original projection', () => {
  const moveTo = vi.fn();
  const context = { moveTo, clearRect() {}, save() {}, restore() {}, beginPath() {}, arc() {},
    clip() {}, lineTo() {}, stroke() {}, closePath() {}, fill() {} };
  const nav = new NavMap();
  vi.spyOn(nav.node, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const streets = { bounds: [-400, -400, 400, 400] as [number, number, number, number],
    roads: [{ c: 'c', p: [-20, -350, 20, -350] }], line: [], closed: false };
  nav.setStreets(streets);
  const small = nav.node.width;
  const view = { x: 0, z: 0, headingX: 0, headingZ: -1 };
  nav.draw(view);
  expect(moveTo).toHaveBeenCalledTimes(1); // Only the car: the distant road is outside the view.
  moveTo.mockClear();
  nav.setExpanded(true); nav.setStreets(streets); nav.draw(view);
  expect(nav.node.width).toBe(small * 2);
  expect(nav.node.style.width).toBe('340px');
  expect(moveTo).toHaveBeenCalledTimes(2);
  const expected = headingUp(view, nav.node.width, 380)(-20, -350);
  expect(moveTo.mock.calls[0]![0]).toBeCloseTo(expected[0], 6);
  expect(moveTo.mock.calls[0]![1]).toBeCloseTo(expected[1], 6);
  moveTo.mockClear(); nav.setExpanded(false); nav.draw(view);
  expect(nav.node.width).toBe(small);
  expect(nav.node.style.width).toBe('170px');
  expect(moveTo).toHaveBeenCalledTimes(1);
});

it('redraws the route picture after the graphics come back', () => {
  // The street picture is drawn once per route; a canvas that lost its pixels would keep showing
  // an empty panel for the rest of the race unless something asks for the picture again.
  const map = new MiniMap();
  const base = (map as unknown as { base: HTMLCanvasElement }).base;
  const context = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {},
    fill() {}, closePath() {} };
  const draws = vi.spyOn(base, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const route = { id: 'r', points: [[0, 0, 0], [10, 0, 10]], checkpoints: [], length: 14, closed: false };
  map.setRoute(route);
  map.setRoute(route);
  expect(draws).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('webglcontextrestored'));
  map.setRoute(route);
  expect(draws, 'a restored 3D context').toHaveBeenCalledTimes(2);
  base.dispatchEvent(new Event('contextrestored'));
  map.setRoute(route);
  expect(draws, 'a restored 2D canvas').toHaveBeenCalledTimes(3);
});
