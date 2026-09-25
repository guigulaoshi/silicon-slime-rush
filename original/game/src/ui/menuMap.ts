/**
 * The map behind the opening screen: the real Bay Area coastline with the real routes on it.
 *
 * Everything in this module is pure -- parse, project, frame -- so the parts that decide *where a
 * route appears* can be tested without a browser. The screen that draws it (`StartScreen`) owns the
 * DOM; this owns the arithmetic, because the arithmetic is where a map goes quietly wrong.
 *
 * The document is `game/public/menu-map.json`, written by `python -m sr.cli menu-map`. It carries
 * geometry and numbers only: names and blurbs live in the i18n files and the runtime reads them
 * from there (`docs/CONTRACT.md` section 6).
 */

export interface MenuRoute {
  id: string;
  km: number;
  checkpoints: number;
  /** [lon, lat] along the route, thinned by the pipeline to what a screen-wide map can resolve */
  line: [number, number][];
  /** Nearby OSM streets in the same lon/lat coordinates, so the enlarged route is a real map. */
  streets: { class: 'a' | 'b' | 'c'; line: [number, number][] }[];
}

/** [south, west, north, east] -- the window the pipeline cut the water and the land to. */
export type Region = [number, number, number, number];

export interface MenuMap {
  version: number;
  region: Region;
  /** closed rings: everything inside one of these is water */
  water: [number, number][][];
  /** closed rings: islands standing in that water */
  land: [number, number][][];
  /** open polylines: the motorways, trunks and primaries, drawn faintly so the land reads as land */
  roads: [number, number][][];
  /** the towns a local names when saying where something is; the label lives in i18n as `place.<id>` */
  places: { id: string; lon: number; lat: number }[];
  routes: MenuRoute[];
}

function bad(why: string): never {
  throw new Error(`menu map: ${why}`);
}

function line(value: unknown, where: string): [number, number][] {
  if (!Array.isArray(value) || value.length < 2) bad(`${where} is not a polyline`);
  return (value as unknown[]).map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      bad(`${where}[${i}] is not a [lon, lat] pair`);
    }
    return [p[0] as number, p[1] as number];
  });
}

/** Read the document, or say why it cannot be read. Strict: half a map is worse than a list. */
export function parseMenuMap(data: unknown): MenuMap {
  if (typeof data !== 'object' || data === null) bad('not an object');
  const raw = data as Record<string, unknown>;
  if (raw.version !== 5) bad(`version ${String(raw.version)} is not 5`);
  if (!Array.isArray(raw.water) || !Array.isArray(raw.land)) bad('no water/land arrays');
  if (!Array.isArray(raw.roads)) bad('no roads array');
  if (!Array.isArray(raw.places)) bad('no places array');
  const places = raw.places.map((item, i) => {
    const p = item as Record<string, unknown>;
    if (typeof p.id !== 'string' || !p.id) bad(`places[${i}] has no id`);
    if (typeof p.lon !== 'number' || typeof p.lat !== 'number') bad(`places[${i}] has no position`);
    return { id: p.id, lon: p.lon, lat: p.lat };
  });
  const region = raw.region;
  if (!Array.isArray(region) || region.length !== 4
      || !region.every((n) => typeof n === 'number' && Number.isFinite(n))) bad('no region box');
  if (!Array.isArray(raw.routes) || raw.routes.length === 0) bad('no routes');
  const routes = raw.routes.map((item, i) => {
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id) bad(`routes[${i}] has no id`);
    if (!Array.isArray(r.streets)) bad(`routes[${i}].streets is not an array`);
    const streets = r.streets.map((item, j) => {
      const street = item as Record<string, unknown>;
      const streetClass = street.class;
      if (streetClass !== 'a' && streetClass !== 'b' && streetClass !== 'c') {
        bad(`routes[${i}].streets[${j}] has bad class`);
      }
      const parsed: MenuRoute['streets'][number] = {
        class: streetClass, line: line(street.line, `routes[${i}].streets[${j}].line`),
      };
      return parsed;
    });
    return {
      id: r.id,
      km: typeof r.km === 'number' ? r.km : 0,
      checkpoints: typeof r.checkpoints === 'number' ? r.checkpoints : 0,
      line: line(r.line, `routes[${i}].line`),
      streets,
    } satisfies MenuRoute;
  });
  return {
    version: 5,
    region: region as Region,
    water: raw.water.map((c, i) => line(c, `water[${i}]`)),
    land: raw.land.map((c, i) => line(c, `land[${i}]`)),
    roads: raw.roads.map((c, i) => line(c, `roads[${i}]`)),
    places,
    routes,
  };
}

export interface Frame {
  west: number; east: number; south: number; north: number;
  /** how much a degree of longitude is worth beside a degree of latitude, at this frame's middle */
  kx: number;
}

/**
 * Trim the long axis of a frame until it matches the panel it is drawn in.
 *
 * Trimmed, not grown: the pipeline only cut water and land inside the region, so a frame grown past
 * it has a strip with no data in it, painted the land colour whatever is really there -- down the
 * Pacific side that was a black band beside the ocean.
 */
function fit(frame: Frame, aspect?: number): Frame {
  if (!aspect || aspect <= 0) return frame;
  let { west, east, south, north } = frame;
  const have = ((east - west) * frame.kx) / (north - south);
  if (aspect < have) {
    const trim = ((east - west) - (north - south) * aspect / frame.kx) / 2;
    west += trim; east -= trim;
  } else {
    const trim = ((north - south) - ((east - west) * frame.kx) / aspect) / 2;
    south += trim; north -= trim;
  }
  return { west, east, south, north, kx: frame.kx };
}

/**
 * The window the map is drawn through: the whole region the pipeline cut, never just the routes.
 *
 * A frame drawn around the routes answers "what does this route look like"; the player is
 * asking "where is it", and only the whole Bay answers that. The region stops at the Bay on purpose:
 * a route 150 km south would shrink the Bay into a smudge, so anything outside gets a marker on the
 * frame's edge instead -- which is what a real map does with an inset.
 */
export function frameOf(region: Region, aspect?: number): Frame {
  const [south, west, north, east] = region;
  const kx = Math.cos(((south + north) / 2) * Math.PI / 180);
  return fit({ west, east, south, north, kx }, aspect);
}

/**
 * The parts of a water ring that are actual shoreline, as open polylines.
 *
 * A water ring is closed by running along the edge of the region, so part of it is not coast at
 * all: drawing the ring's own outline would put a bright rectangle around the map. A segment whose
 * two ends both sit on the region's edge is that closure; everything else is shore.
 */
export function shoreLines(ring: [number, number][], region: Region,
                           eps = 1e-6): [number, number][][] {
  const [south, west, north, east] = region;
  const edge = (p: [number, number]): boolean =>
    Math.abs(p[0] - west) < eps || Math.abs(p[0] - east) < eps
    || Math.abs(p[1] - south) < eps || Math.abs(p[1] - north) < eps;
  const out: [number, number][][] = [];
  let cur: [number, number][] | null = null;
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i]!, b = ring[i + 1]!;
    if (edge(a) && edge(b)) {
      if (cur) { out.push(cur); cur = null; }
      continue;
    }
    if (!cur) cur = [a];
    cur.push(b);
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.length >= 2);
}

/** How tall the drawing is when it is `width` wide, so latitude and longitude stay in proportion. */
export function frameHeight(frame: Frame, width: number): number {
  return width * (frame.north - frame.south) / ((frame.east - frame.west) * frame.kx);
}

/**
 * A projector for one frame. Equirectangular with a cosine correction at the frame's middle: over
 * a bay sixty kilometres across the error is under a pixel, and a real projection would be a
 * dependency and a second coordinate system for nothing.
 */
export function projector(frame: Frame, width: number) {
  const height = frameHeight(frame, width);
  const spanX = (frame.east - frame.west) || 1e-9;
  const spanY = (frame.north - frame.south) || 1e-9;
  return (p: [number, number]): [number, number] => [
    (p[0] - frame.west) / spanX * width,
    (frame.north - p[1]) / spanY * height,
  ];
}

/** An SVG path for one polyline, at one decimal place -- more is bytes nobody can see. */
export function pathFor(poly: [number, number][], project: (p: [number, number]) => [number, number]): string {
  return poly.map((p, i) => {
    const [x, y] = project(p);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join('');
}

/* */
export function insideFrame(route: MenuRoute, frame: Frame): boolean {
  return route.line.some(([lon, lat]) =>
    lon >= frame.west && lon <= frame.east && lat >= frame.south && lat <= frame.north);
}

/** A route drawn on its own, in a box of its own: the shape you would recognise on a poster. */
export interface Circuit {
  /** an SVG path, in the box's coordinates */
  d: string;
  /** where the lap begins, for the marker that says so */
  start: [number, number];
  /** where it ends -- the same point on a loop, a different one on a point-to-point */
  end: [number, number];
  /** true when the route comes back to where it started, within a tenth of its own length */
  loop: boolean;
  /** Context paths projected by the same transform as `d`; never independently stretched. */
  streets: { class: 'a' | 'b' | 'c'; d: string }[];
}

/**
 * One route, fitted to a box, north up and in proportion.
 *
 * This is the circuit diagram, and it is the whole reason the opening screen reads as a racing game
 * rather than a map viewer. Every racing game ever made shows the lap this way, and the shape is already in the
 * document -- 140 points per route -- so it costs no new data at all.
 *
 * Longitude is scaled by cos(latitude) first: without it every route leans, because a degree east
 * is shorter than a degree north and nothing about the shape survives that.
 */
export function circuitPath(line: [number, number][], width: number, height: number,
                            pad = 14, streets: MenuRoute['streets'] = []): Circuit | null {
  if (line.length < 2) return null;
  const lat0 = line.reduce((s, p) => s + p[1], 0) / line.length;
  const kx = Math.cos(lat0 * Math.PI / 180);
  const xs = line.map((p) => p[0] * kx), ys = line.map((p) => p[1]);
  const west = Math.min(...xs), east = Math.max(...xs);
  const south = Math.min(...ys), north = Math.max(...ys);
  const spanX = (east - west) || 1e-9, spanY = (north - south) || 1e-9;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2, offY = (height - spanY * scale) / 2;
  const at = (i: number): [number, number] =>
    [(xs[i]! - west) * scale + offX, (north - ys[i]!) * scale + offY];
  const project = (p: [number, number]): [number, number] =>
    [(p[0] * kx - west) * scale + offX, (north - p[1]) * scale + offY];
  let d = '';
  for (let i = 0; i < line.length; i++) {
    const [x, y] = at(i);
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  const start = at(0), end = at(line.length - 1);
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    run += Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
  }
  const gap = Math.hypot(xs[line.length - 1]! - xs[0]!, ys[line.length - 1]! - ys[0]!);
  return {
    d, start, end, loop: gap <= run * 0.1,
    streets: streets.map((street) => ({ class: street.class, d: pathFor(street.line, project) })),
  };
}

/** A rectangle in screen pixels, the way `getBoundingClientRect` gives it. */
export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * The two lines of a magnifier callout: from a circle on the small map to the big drawing of it.
 *
 * This is the
 * convention every atlas and every exploded diagram uses -- a ring around the detail, two lines
 * fanning out to the enlargement -- and it works because the two lines *bracket* the big drawing:
 * they leave the ring at the extreme angles the target subtends, so the enlargement sits between
 * them rather than beside them.
 *
 * Returns null when the ring is inside the target or either shape has no size (a layout that has
 * not happened yet), because a callout with nothing to point at is a scribble.
 */
export function callout(cx: number, cy: number, r: number, box: Box):
    { x1: number; y1: number; x2: number; y2: number }[] | null {
  const w = box.right - box.left, h = box.bottom - box.top;
  if (!(w > 0) || !(h > 0) || !(r > 0)) return null;
  if (cx > box.left && cx < box.right && cy > box.top && cy < box.bottom) return null;
  const corners: [number, number][] = [
    [box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom],
  ];
  // The widest pair as seen from the ring. Angles are measured from the ring's centre and compared
  // by their difference, so a fan that straddles the -pi/pi seam is still measured correctly.
  let best: [number, number] | null = null, widest = -1;
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const a = Math.atan2(corners[i]![1] - cy, corners[i]![0] - cx);
      const b = Math.atan2(corners[j]![1] - cy, corners[j]![0] - cx);
      let d = Math.abs(a - b);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > widest) { widest = d; best = [i, j]; }
    }
  }
  if (!best) return null;
  return best.map((i) => {
    const [x, y] = corners[i]!;
    const a = Math.atan2(y - cy, x - cx);
    return { x1: cx + Math.cos(a) * r, y1: cy + Math.sin(a) * r, x2: x, y2: y };
  });
}
