import { drawMapRacer, racerColor, type MapRacer } from './RacerMarkers';
import { ROAD_STYLE, type StreetMapData } from './StreetMap';

/**
 * The navigation panel: the streets right around the car, turned so the car points up.
 *
 * The other map answers "how much of the route is left". This one answers "where am I" -- which
 * street this is, what the next junction is called, whether the thing on the right is a road or a
 * car park. That needs real streets with real names, close in, and it needs to turn with the car:
 * a driver reads a nav view by matching it against the windscreen, and a north-up view at a corner
 * has to be rotated in your head first.
 *
 * Everything is redrawn every frame, because everything moves. A few hundred short lines inside a
 * 170 pixel box is nothing; the cost is in the labels, so there are at most a handful of those.
 */
const RANGE = 190;        // metres from the car to the edge of the panel
const MAX_LABELS = 4;
const LABEL_MIN_PX = 34;  // a name is only drawn on a run of street long enough to carry it
const LABEL_INSET = 0.62; // labels stay this far inside the circle, or they are cut off by its edge

/**
 * The heading-up projection: world metres to canvas pixels, with the car at the centre and its
 * nose pointing up the screen.
 *
 * Pulled out of the drawing so it can be checked directly. It is four lines of trigonometry with
 * two sign conventions crossing in it -- +z is south, and canvas y grows downwards -- and either
 * one being wrong gives a picture that still looks like a map. It shipped once with the world
 * turned half a turn, so every road ahead of the car was drawn behind it.
 */
export function headingUp(view: { x: number; z: number; headingX: number; headingZ: number },
                          size: number, range: number): (x: number, z: number) => [number, number] {
  const scale = (size / 2) / range;
  // atan2(headingX, headingZ) turns the heading onto +z, and +z is south: down the screen on a
  // north-up map. The half turn is what puts it at the top instead.
  const a = Math.atan2(view.headingX, view.headingZ) + Math.PI;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return (x, z) => {
    const dx = (x - view.x) * scale;
    const dz = (z - view.z) * scale;
    return [size / 2 + dx * cos - dz * sin, size / 2 + dx * sin + dz * cos];
  };
}

export class NavMap {
  readonly node: HTMLCanvasElement;
  private streets: StreetMapData | null = null;
  private size = 0;
  private dpr = 1;
  private enlarged = false;

  get expanded(): boolean { return this.enlarged; }

  setExpanded(expanded: boolean): void {
    if (this.enlarged === expanded) return;
    this.enlarged = expanded;
    this.resize();
  }

  constructor(private readonly cssSize = 170) {
    this.node = document.createElement('canvas');
    this.node.className = 'hud-nav';
  }

  setStreets(streets: StreetMapData | null): void {
    this.streets = streets;
    if (this.size > 0) return;
    this.resize();
  }

  private resize(): void {
    const cssSize = this.cssSize * (this.enlarged ? 2 : 1);
    this.dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    this.size = Math.round(cssSize * this.dpr);
    this.node.width = this.size;
    this.node.height = this.size;
    this.node.style.width = `${cssSize}px`;
    this.node.style.height = `${cssSize}px`;
  }

  draw(view: { x: number; z: number; headingX: number; headingZ: number },
    rivals: readonly MapRacer[] = [], player = 0): void {
    const g = this.node.getContext('2d');
    if (!g || this.size === 0) return;
    const s = this.size;
    const dpr = this.dpr;
    g.clearRect(0, 0, s, s);
    if (!this.streets) return;

    const range = RANGE * (this.enlarged ? 2 : 1);
    const px = headingUp(view, s, range);
    // world metres that fall inside the panel, whatever the rotation: the panel's own diagonal
    const reach = range * Math.SQRT2;

    g.save();
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    g.clip();
    g.lineJoin = 'round';
    g.lineCap = 'round';

    const labels: { name: string; x: number; y: number; len: number }[] = [];
    // Segment by segment, not point by point. Simplification leaves a long straight road as two
    // points hundreds of metres apart, and a road culled because neither *end* is on screen is a
    // road that vanishes exactly when it is the one you are driving down.
    const near = (ax: number, az: number, bx: number, bz: number) =>
      Math.min(ax, bx) - view.x < reach && Math.max(ax, bx) - view.x > -reach
      && Math.min(az, bz) - view.z < reach && Math.max(az, bz) - view.z > -reach;

    for (const road of this.streets.roads) {
      const style = ROAD_STYLE[road.c] ?? ROAD_STYLE.c!;
      let best = 0;
      let bx = 0;
      let by = 0;
      g.beginPath();
      for (let i = 0; i + 3 < road.p.length; i += 2) {
        const ax = road.p[i]!;
        const az = road.p[i + 1]!;
        const bxw = road.p[i + 2]!;
        const bzw = road.p[i + 3]!;
        if (!near(ax, az, bxw, bzw)) continue;
        const a = px(ax, az);
        const b = px(bxw, bzw);
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        // remember the longest visible run, which is where the street's name will fit
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len > best) { best = len; bx = (a[0] + b[0]) / 2; by = (a[1] + b[1]) / 2; }
      }
      g.strokeStyle = style.c;
      g.lineWidth = style.w * dpr;
      g.stroke();
      if (road.n && best > LABEL_MIN_PX * dpr) labels.push({ name: road.n, x: bx, y: by, len: best });
    }

    // the racing line on top of the streets, so it reads as the thing to follow
    g.beginPath();
    const line = this.streets.line;
    for (let i = 0; i + 3 < line.length; i += 2) {
      const ax = line[i]!;
      const az = line[i + 1]!;
      const bxw = line[i + 2]!;
      const bzw = line[i + 3]!;
      if (!near(ax, az, bxw, bzw)) continue;
      const a = px(ax, az);
      const b = px(bxw, bzw);
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
    }
    g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    g.lineWidth = 6 * dpr;
    g.stroke();
    g.strokeStyle = 'rgba(255, 176, 64, 0.95)';
    g.lineWidth = 3 * dpr;
    g.stroke();

    // Names last and few. Labels are the only thing here that can turn a map into a mess, so the
    // longest runs of street win and the rest go unnamed; one name per street, never a stack of
    // the same road repeated for every way OSM happens to have split it into.
    labels.sort((p, q) => q.len - p.len);
    const seen = new Set<string>();
    const placed: { x: number; y: number; half: number }[] = [];
    g.font = `${Math.round(9 * dpr)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3 * dpr;
    g.strokeStyle = 'rgba(6, 10, 15, 0.85)';
    g.fillStyle = 'rgba(232, 240, 250, 0.92)';
    for (const l of labels) {
      if (placed.length >= MAX_LABELS) break;
      if (seen.has(l.name)) continue;
      // Half a name cut off by the edge of the circle is worse than no name: it reads as a
      // different street. Keep them in the middle, where they are also nearest the car.
      if (Math.hypot(l.x - s / 2, l.y - s / 2) > (s / 2) * LABEL_INSET) continue;
      const half = g.measureText(l.name).width / 2;
      if (l.x - half < 4 * dpr || l.x + half > s - 4 * dpr) continue;
      // and two names on top of each other read as neither
      if (placed.some((q) => Math.abs(q.y - l.y) < 11 * dpr && Math.abs(q.x - l.x) < q.half + half)) continue;
      seen.add(l.name);
      placed.push({ x: l.x, y: l.y, half });
      g.strokeText(l.name, l.x, l.y);
      g.fillText(l.name, l.x, l.y);
    }
    for (const rival of rivals) {
      const [x, y] = px(rival.x, rival.z);
      drawMapRacer(g, x, y, dpr, rival);
    }
    g.restore();

    // the car, always at the centre and always pointing up
    g.beginPath();
    g.moveTo(s / 2, s / 2 - 6.5 * dpr);
    g.lineTo(s / 2 + 4.4 * dpr, s / 2 + 5 * dpr);
    g.lineTo(s / 2 - 4.4 * dpr, s / 2 + 5 * dpr);
    g.closePath();
    g.fillStyle = racerColor(player);
    g.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    g.lineWidth = 1.5 * dpr;
    g.fill();
    g.stroke();
  }
}
