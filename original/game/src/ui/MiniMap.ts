import { drawMapRacer, racerColor, type MapRacer } from './RacerMarkers';
import { ROAD_STYLE, type StreetMapData } from './StreetMap';

/**
 * The whole route, drawn small in a corner on the real streets, with the car on it and the part
 * already driven greyed out.
 *
 * This is the "how far is left" panel; NavMap is the "where am I" one. It is drawn north-up rather
 * than turned to face the car, because the shape of a route is something you learn once and a map
 * that spins is a map you have to read twice.
 *
 * The streets and the route are redrawn only when the track changes; every frame copies that
 * picture, strokes the driven part over it and puts an arrow on it.
 */
export interface MiniMapRoute {
  id: string;
  /** the real street network around the route; null while it loads, or if it failed to */
  streets?: StreetMapData | null;
  /** the spline, one [x, y, z] per sample */
  points: readonly (readonly number[])[];
  /** authoritative three-dimensional distance at each spline sample */
  s?: readonly number[];
  /** distance along the route of each checkpoint, in the same units as `s` */
  checkpoints: readonly number[];
  /** total length, for placing checkpoints along the drawn path */
  length: number;
  closed: boolean;
}

export interface MiniMapView {
  x: number;
  z: number;
  /** unit heading in the ground plane */
  headingX: number;
  headingZ: number;
  /** distance travelled along the route */
  s: number;
}

const PAD = 6;

/**
 * Counts graphics recoveries, so every map redraws the picture it drew once. A 2D canvas can
 * lose its pixels when the GPU does, and after a 3D context came back the route map stayed dark. A
 * lost 3D context's restore event does not bubble, but the capture phase still passes the window.
 */
let graphicsEpoch = 0;
if (typeof window !== 'undefined') window.addEventListener('webglcontextrestored', () => { graphicsEpoch++; }, true);

/**
 * How far to turn the car marker on a north-up map, in radians clockwise on screen.
 *
 * The arrow is drawn pointing up and then rotated, so this is the one number that decides whether
 * the map says north or south. Two conventions cross in it -- +z is south, and canvas y grows
 * downwards -- and getting it wrong turns every car on every map exactly backwards, which looks
 * like a plausible map right up until you drive.
 */
export function northUpArrow(headingX: number, headingZ: number): number {
  return Math.atan2(headingX, -headingZ);
}

export function drivenPointCount(along: readonly number[], viewS: number, length: number, closed: boolean): number {
  const at = closed ? ((viewS % length) + length) % length : viewS;
  const firstAhead = along.findIndex((distance) => distance > at);
  return firstAhead < 0 ? along.length : firstAhead;
}

export class MiniMap {
  readonly node: HTMLCanvasElement;
  private readonly base: HTMLCanvasElement;
  private routeId: string | null = null;
  private scale = 1;
  private ox = 0;
  private oz = 0;
  private size = 0;
  /** the route again, in canvas pixels, so the driven part can be stroked without reprojecting */
  private path: number[] = [];
  /** distance along the route at each of those points */
  private along: number[] = [];
  private closed = false;
  private length = 0;

  constructor(private readonly cssSize = 150) {
    this.node = document.createElement('canvas');
    this.node.className = 'hud-map';
    this.base = document.createElement('canvas');
    // A 2D canvas says so itself when the browser gives its pixels back empty.
    for (const canvas of [this.node, this.base]) canvas.addEventListener('contextrestored', () => { this.routeId = null; });
  }

  /** Redraw the route picture. Cheap to call; does nothing unless the track actually changed. */
  setRoute(route: MiniMapRoute | null): void {
    if (!route) { this.routeId = null; return; }
    const key = `${route.id}:${route.streets ? 'streets' : 'bare'}:${graphicsEpoch}`;
    if (key === this.routeId && this.size > 0) return;
    this.routeId = key;
    this.closed = route.closed;
    this.length = route.length;

    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    this.size = Math.round(this.cssSize * dpr);
    for (const c of [this.node, this.base]) {
      c.width = this.size;
      c.height = this.size;
      c.style.width = `${this.cssSize}px`;
      c.style.height = `${this.cssSize}px`;
    }

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of route.points) {
      minX = Math.min(minX, p[0]!); maxX = Math.max(maxX, p[0]!);
      minZ = Math.min(minZ, p[2]!); maxZ = Math.max(maxZ, p[2]!);
    }
    // one scale for both axes, so a route is never stretched into a different shape than it has
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    this.scale = (this.size - 2 * PAD * dpr) / span;
    this.ox = (minX + maxX) / 2;
    this.oz = (minZ + maxZ) / 2;

    const g = this.base.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, this.size, this.size);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // The real streets first and faint, so the route reads as a line drawn on a map rather than a
    // squiggle on nothing. Without them a player who works on the road the route runs down cannot
    // tell which road it is.
    // Only the roads that still mean something at this scale. A whole city's side streets inside
    // 150 pixels is grey noise, and the route disappears into it; on a short campus route the side
    // streets *are* the place, so they stay.
    const minor = span < 1500;
    for (const road of route.streets?.roads ?? []) {
      if (road.c === 'c' && !minor) continue;
      const style = ROAD_STYLE[road.c] ?? ROAD_STYLE.c!;
      g.beginPath();
      for (let i = 0; i + 1 < road.p.length; i += 2) {
        const [px, pz] = this.project(road.p[i]!, road.p[i + 1]!);
        if (i === 0) g.moveTo(px, pz); else g.lineTo(px, pz);
      }
      g.strokeStyle = style.c;
      g.lineWidth = Math.max(0.6, style.w * 0.55) * dpr;
      g.stroke();
    }

    // the route in pixels, kept: draw() strokes the driven part of it every frame
    this.path = [];
    this.along = [];
    let run = 0;
    for (let i = 0; i < route.points.length; i++) {
      const p = route.points[i]!;
      const [px, pz] = this.project(p[0]!, p[2]!);
      if (i > 0) {
        const q = route.points[i - 1]!;
        run += Math.hypot(p[0]! - q[0]!, p[2]! - q[2]!);
      }
      this.path.push(px, pz);
      this.along.push(route.s?.[i] ?? run);
    }

    this.strokeRoute(g, this.path.length / 2, route.closed);
    g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    g.lineWidth = 6 * dpr;
    g.stroke();
    // the same orange the nav panel uses for the racing line: one colour means "this is the way",
    // whichever panel you happen to be looking at
    g.strokeStyle = 'rgba(255, 176, 64, 0.95)';
    g.lineWidth = 2.8 * dpr;
    g.stroke();

    // the finish, so the shape has an end as well as a start
    const last = route.points[route.points.length - 1]!;
    const [fx, fz] = this.project(last[0]!, last[2]!);
    g.fillStyle = 'rgba(214, 226, 240, 0.9)';
    if (!route.closed) { g.beginPath(); g.arc(fx, fz, 2.6 * dpr, 0, Math.PI * 2); g.fill(); }
  }

  /** The route path, or the first `count` points of it, ready to stroke. */
  private strokeRoute(g: CanvasRenderingContext2D, count: number, close: boolean): void {
    g.beginPath();
    for (let i = 0; i < count; i++) {
      const x = this.path[2 * i]!;
      const y = this.path[2 * i + 1]!;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    if (close && count === this.path.length / 2) g.closePath();
  }

  draw(view: MiniMapView, rivals: readonly MapRacer[] = [], player = 0): void {
    const g = this.node.getContext('2d');
    if (!g || this.size === 0) return;
    const dpr = this.size / this.cssSize;
    g.clearRect(0, 0, this.size, this.size);
    g.drawImage(this.base, 0, 0);

    // What is left, shown by taking away what is done: the driven part of the route goes dim, so
    // the bright part is exactly the part still to drive. On a lap track this resets each lap,
    // which is the honest answer to "how much of this lap is left".
    const done = drivenPointCount(this.along, view.s, this.length || 1, this.closed);
    if (done > 1) {
      g.lineJoin = 'round';
      g.lineCap = 'round';
      this.strokeRoute(g, done, false);
      g.strokeStyle = 'rgba(122, 134, 148, 0.85)';
      g.lineWidth = 2.8 * (this.size / this.cssSize);
      g.stroke();
    }

    for (const rival of rivals) {
      const [x, z] = this.project(rival.x, rival.z);
      drawMapRacer(g, x, z, dpr, rival);
    }
    const [cx, cz] = this.project(view.x, view.z);
    // a triangle, not a dot: which way the car points is half of what a map is for
    g.save();
    g.translate(cx, cz);
    g.rotate(northUpArrow(view.headingX, view.headingZ));
    g.beginPath();
    g.moveTo(0, -5.4 * dpr);
    g.lineTo(3.6 * dpr, 4 * dpr);
    g.lineTo(-3.6 * dpr, 4 * dpr);
    g.closePath();
    g.fillStyle = racerColor(player);
    g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    g.lineWidth = 1.4 * dpr;
    g.fill();
    g.stroke();
    g.restore();
  }

  private project(x: number, z: number): [number, number] {
    // north up: +x east goes right, +z south goes down, which is the world's own orientation
    return [this.size / 2 + (x - this.ox) * this.scale, this.size / 2 + (z - this.oz) * this.scale];
  }
}
