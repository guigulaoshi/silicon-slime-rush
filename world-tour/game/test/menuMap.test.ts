import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT } from '../src/app/tracks';
import { callout, circuitPath, frameHeight, frameOf, insideFrame, parseMenuMap, pathFor, projector, shoreLines,
  type MenuRoute, type Region } from '../src/ui/menuMap';

/**
 * The arithmetic behind the opening map, tested without a browser.
 *
 * A menu map fails quietly: nothing throws when a route is projected into the wrong place, it just
 * lands in the bay, and a person looking at it assumes that is where the road goes. So the tests
 * here are about position and proportion, and the last ones run against the real generated file
 * rather than a fixture -- the fixture cannot tell us the pipeline still writes what this reads.
 */
const route = (id: string, line: [number, number][], km = 5): MenuRoute =>
  ({ id, km, checkpoints: 4, line, streets: [] });

const SQUARE: [number, number][] = [[-122.5, 37.7], [-122.3, 37.7], [-122.3, 37.9], [-122.5, 37.9]];
const REGION: Region = [37.15, -122.85, 38.25, -121.55];
const doc = (over: Record<string, unknown> = {}): unknown =>
  ({ version: 5, region: REGION, water: [], land: [], roads: [], places: [],
     routes: [{ id: 'a', km: 3.2, checkpoints: 7, line: SQUARE, streets: [] }],
     ...over });

/** Ray casting, so a test can ask the document itself whether a place is wet. */
const inside = (ring: [number, number][], [x, y]: [number, number]): boolean => {
  let odd = false;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [x1, y1] = ring[i]!, [x2, y2] = ring[i + 1]!;
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) odd = !odd;
  }
  return odd;
};

describe('reading the document', () => {
  it('takes what the pipeline writes', () => {
    const m = parseMenuMap(doc({ water: [SQUARE], land: [SQUARE] }));
    expect(m.routes[0]!.id).toBeTruthy();
    expect(m.water[0]).toHaveLength(4);
    expect(m.region).toEqual(REGION);
  });

  it.each([
    ['a version it does not know', doc({ version: 4 })],
    ['no places array', doc({ places: undefined })],
    ['a place with no position', doc({ places: [{ id: 'x' }] })],
    ['no roads array', doc({ roads: undefined })],
    ['no routes at all', doc({ routes: [] })],
    ['no region box', doc({ region: [1, 2, 3] })],
    ['no water array', doc({ water: undefined })],
    ['a route with no id', doc({ routes: [{ line: SQUARE }] })],
    ['a line that is one point', doc({ routes: [{ id: 'a', line: [[1, 2]] }] })],
    ['a pair that is not a pair', doc({ routes: [{ id: 'a', line: [[1, 2], [3]] }] })],
  ])('refuses %s', (_why, bad) => {
    expect(() => parseMenuMap(bad)).toThrow(/menu map/);
  });
});

describe('framing', () => {
  it('frames the whole region, not the routes on it', () => {
    // A frame drawn around the routes would
    // creep whenever a route is added; this one is the Bay whatever the queue delivers.
    const frame = frameOf(REGION);
    expect(frame.south).toBe(37.15);
    expect(frame.north).toBe(38.25);
    expect(insideFrame(route('bay', SQUARE), frame)).toBe(true);
    // A route 150 km south of the Bay. No such track ships today (the Monterey one was deleted
    //), but the rule is written from the frame rather than from a name, and this is what
    // keeps it that way.
    expect(insideFrame(route('far-south', [[-121.9, 36.6], [-121.8, 36.6]]), frame)).toBe(false);
  });

  it('keeps latitude and longitude in proportion', () => {
    // A degree of longitude is shorter than a degree of latitude here, so a frame 1 deg each way is
    // taller than it is wide. Getting this backwards squashes the bay.
    const frame = frameOf([37.7, -122.5, 38.7, -121.5]);
    const h = frameHeight(frame, 1000);
    expect(h).toBeGreaterThan(1000);
    expect(h).toBeCloseTo(1000 / frame.kx, 0);
  });

  it('trims the long axis to the panel, so no part of it lies outside the data', () => {
    // A grown frame left a strip the pipeline never cut water into: a black band down the Pacific.
    const square = frameOf(REGION, 1);
    expect(square.west).toBe(-122.85);                  // the short axis is left alone
    expect(square.east).toBe(-121.55);
    expect(square.south).toBeGreaterThan(37.15);
    expect(square.north).toBeLessThan(38.25);
    expect(frameHeight(square, 1000)).toBeCloseTo(1000, 0);
    const wide = frameOf(REGION, 2.0);
    expect(wide.west).toBe(-122.85);
    expect(frameHeight(wide, 1000)).toBeCloseTo(500, 0);
  });

  it('puts the north-west corner at the origin and the south-east at the far corner', () => {
    const frame = frameOf(REGION);
    const project = projector(frame, 1000);
    expect(project([-122.85, 38.25])).toEqual([0, 0]);
    const [x, y] = project([-121.55, 37.15]);
    expect(x).toBeCloseTo(1000, 3);
    expect(y).toBeCloseTo(frameHeight(frame, 1000), 3);
  });

  it('draws a path a browser will accept', () => {
    const d = pathFor(SQUARE, projector(frameOf(REGION), 1000));
    expect(d.startsWith('M')).toBe(true);
    expect(d.match(/L/g)).toHaveLength(3);
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});

describe('a route drawn as a circuit', () => {
  it('fits the box, keeps the shape in proportion, and marks both ends', () => {
    const wide: [number, number][] = [[-122.5, 37.8], [-122.3, 37.8], [-122.3, 37.81]];
    const c = circuitPath(wide, 400, 200, 10)!;
    expect(c.d.startsWith('M')).toBe(true);
    expect(c.d).not.toMatch(/NaN|Infinity/);
    const xs = [...c.d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [+m[1]!, +m[2]!]);
    for (const [x, y] of xs) {
      expect(x).toBeGreaterThanOrEqual(10 - 0.05);
      expect(x).toBeLessThanOrEqual(390 + 0.05);
      expect(y).toBeGreaterThanOrEqual(10 - 0.05);
      expect(y).toBeLessThanOrEqual(190 + 0.05);
    }
    expect(c.loop).toBe(false);            // ends 20 km from where it started
  });

  it('knows a lap from a point-to-point, which is what the finish marker hangs on', () => {
    const square: [number, number][] = [[-122.5, 37.7], [-122.4, 37.7], [-122.4, 37.8],
      [-122.5, 37.8], [-122.5, 37.7]];
    expect(circuitPath(square, 300, 300)!.loop).toBe(true);
    expect(circuitPath(square.slice(0, 3), 300, 300)!.loop).toBe(false);
    expect(circuitPath([[-122.5, 37.7]], 300, 300)).toBeNull();
  });

  it('projects nearby streets with the exact same scale and origin as the route', () => {
    const line: [number, number][] = [[-122.5, 37.7], [-122.4, 37.7], [-122.4, 37.8]];
    const c = circuitPath(line, 300, 200, 10, [{ class: 'b', line }])!;
    expect(c.streets).toEqual([{ class: 'b', d: c.d }]);
  });
});

describe('the magnifier callout', () => {
  // The two lines
  // have to bracket the enlargement -- leave the ring at the widest angles it subtends -- or they
  // read as two lines that happen to point near it.
  const box = { left: 100, top: 100, right: 300, bottom: 200 };

  it('leaves the ring at its edge and lands on the two extreme corners', () => {
    const lines = callout(500, 150, 10, box)!;      // ring to the right of the box
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(Math.hypot(l.x1 - 500, l.y1 - 150)).toBeCloseTo(10, 6);
    }
    // The widest pair is the near edge, not the far one: seen from the right, the box's own right
    // corners are its silhouette and the left ones sit inside the fan.
    const ends = lines.map((l) => [l.x2, l.y2]).sort((a, b) => a[1]! - b[1]!);
    expect(ends[0]).toEqual([300, 100]);
    expect(ends[1]).toEqual([300, 200]);
  });

  it('brackets the box from below as well, which is where the locator actually sits', () => {
    const lines = callout(200, 500, 12, box)!;      // ring below the box
    const ends = lines.map((l) => [l.x2, l.y2]).sort((a, b) => a[0]! - b[0]!);
    expect(ends[0]).toEqual([100, 200]);
    expect(ends[1]).toEqual([300, 200]);
  });

  it('draws nothing when there is nothing to point at', () => {
    expect(callout(200, 150, 10, box)).toBeNull();                       // ring inside the box
    expect(callout(500, 150, 10, { left: 0, top: 0, right: 0, bottom: 0 })).toBeNull();
    expect(callout(500, 150, 0, box)).toBeNull();
  });
});

describe('shoreline out of a water ring', () => {
  // A water ring closes along the edge of the region. Stroking the ring itself would draw a bright
  // rectangle round the map; only the part that is real coast may be stroked.
  const ring: [number, number][] = [
    [-122.85, 38.0], [-122.5, 37.9], [-122.4, 37.5], [-122.85, 37.4],   // shore, ends on the edge
    [-122.85, 38.0],                                                     // closure up the west edge
  ];

  it('keeps the coast and drops the closure', () => {
    const [shore, ...rest] = shoreLines(ring, REGION);
    expect(rest).toHaveLength(0);
    expect(shore).toHaveLength(4);
    expect(shore![0]).toEqual([-122.85, 38.0]);
    expect(shore![3]).toEqual([-122.85, 37.4]);
  });

  it('drops a ring that is nothing but frame edge', () => {
    const box: [number, number][] = [[-122.85, 38.25], [-121.55, 38.25], [-121.55, 37.15],
      [-122.85, 37.15], [-122.85, 38.25]];
    expect(shoreLines(box, REGION)).toEqual([]);
  });
});

describe('the file the pipeline actually writes', () => {
  const map = parseMenuMap(JSON.parse(readFileSync(
    resolve(process.cwd(), 'public', 'menu-map.json'), 'utf-8')));

  it('parses, and holds every route the game can play', () => {
    // Against the real file, not a fixture: a fixture proves the parser reads itself. This is the
    // only test that would notice `sr menu-map` and this module drifting apart.
    // Tied to the roster rather than to a number: it was 11, we deleted five, and a
    // hard-coded count only ever says what the roster was on the day somebody typed it.
    for (const id of BUILT) expect(map.routes.some((r) => r.id === id), id).toBe(true);
    expect(map.routes.length).toBe(BUILT.size);
    expect(map.world, 'the opening map is the world').toBe(true);
    expect(map.water.length).toBeGreaterThan(2);        // the seas the continents close round
    expect(map.land.length).toBeGreaterThan(10);        // continents and the big islands
    expect(map.places.length).toBe(map.routes.length);  // one pin per city
    for (const r of map.routes) {
      expect(r.km, r.id).toBeGreaterThan(0.5);
      expect(r.line.length, r.id).toBeGreaterThan(20);
      expect(r.streets.length, `${r.id} has no nearby streets`).toBeGreaterThan(0);
    }
  });

  it('has the seas wet and the continents dry', () => {
    // The failure this catches is the polygon assembly coming out inverted -- a map that is all
    // water, or a Mediterranean painted as desert -- which throws nothing at all.
    const land = (p: [number, number]): boolean => map.land.some((r) => inside(r, p))
      && !map.water.some((r) => inside(r, p));
    expect(land([10, 23]), 'the Sahara').toBe(true);
    expect(land([88, 32]), 'Tibet').toBe(true);
    expect(land([133, -25]), 'the outback').toBe(true);
    expect(land([18, 35]), 'the Mediterranean').toBe(false);
    expect(land([34, 43.5]), 'the Black Sea').toBe(false);
    expect(land([-35, 20]), 'the Atlantic').toBe(false);
  });

  it('lands every route on land, at its own city', () => {
    for (const r of map.routes) {
      const pin = map.places.find((p) => p.id === r.id)!;
      for (const [lon, lat] of r.line) {
        expect(Math.hypot(lon - pin.lon, lat - pin.lat), r.id).toBeLessThan(0.1);   // within ~10 km of its city
      }
    }
  });
});
