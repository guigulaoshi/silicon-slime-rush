import { CATALOGUE } from '../app/tracks';
import { SHOWCASE_IMAGE, SHOWCASE_TRACK } from '../app/showcase';
import { carThumbnail } from './carThumbnail';
import { challengeCar } from './ShareDialog';
import { routeName } from './routeName';
import type { RaceDirection } from '../track/Direction';
import { AI_DIFFICULTIES, aiDifficulty, type AiDifficulty } from '../bot/difficulty';
import { isMobileDevice } from '../app/device';
import { devHint } from '../app/dataHealth';
import type { MenuAction } from '../input/types';
import { VEHICLES, forTrack, vehicleFor, vehicleTuning } from '../vehicles/catalogue';
import type { CarKind, TimeOfDay } from '../track/types';
import { DEFAULT_SAVE, type SlimeDensity } from '../app/Save';
import type { LastRaceChoice } from '../app/Progression';
import type { Challenge } from '../app/Challenge';
import type { Quality } from '../world/World';
import { formatTime } from '../track/Race';
import { starGlyphs } from '../track/Rating';
import { WEATHERS, type Weather } from '../world/Sky';
import type { I18n } from './i18n';
import { el } from './Ui';
import { GaragePreview } from './GaragePreview';
import { home } from './Home';
import { fullscreenButton } from '../app/fullscreen';
import { fitReplica, renderBrandSignature, renderLanguageToggle } from './Replica';
import { conditionScene } from './conditionScene';
import './startup-replica.css';
import { chevron, chevronLabel } from './chevron';
import { callout, circuitPath, frameHeight, frameOf, insideFrame, pathFor, projector, shoreLines,
  type MenuMap, type MenuRoute } from './menuMap';

/** Three whole-page steps: route, world, then the vehicle garage with optional 2P.
 * Route geometry stays owned by menuMap; the same physical tuning drives the displayed numbers.
 */
const MAP_W = 1000;
const LOC = 300;
const PREVIEW_FALLBACK = SHOWCASE_TRACK;
const LABEL_PAD = 4;                    // keep a town's label off the card edge
const CIRCUIT_W = 720, CIRCUIT_H = 430; // the circuit's own box, in its own coordinates
/** Keyboard rows are time, weather, slimes, direction, AI; this is the order they appear on screen. */
const CONDITION_ROW_ORDER: readonly number[] = [0, 3, 1, 2, 4];
export const CARS = VEHICLES.map(vehicle => vehicle.id);
export type CarId = string;
export const TIMES: TimeOfDay[] = ['day', 'night'];
const SLIME_DENSITIES: readonly SlimeDensity[] = ['none', 'normal', 'many'];
type WorldPreviewFocus = 'time' | 'weather' | 'slimes' | 'ai';

/**
 * The three numbers a racing game puts on a car, read from the tuning the physics actually uses.
 *
 * Not invented ratings out of five: these are the values `CarTuning` hands to the solver, so a car
 * that reads faster here is faster on the road.
 *
 * Two things this got wrong the first time and now does not:
 *
 * - **Weight is not a bar.** Every bar here means "longer is better", and mass is the one number
 *   where longer is worse -- so the heaviest car showed the longest bar and read as the best one.
 *   It is a plain figure beside the name instead.
 * - **Bars are scaled inside the range of the four cars**, not against the largest. Top speeds run
 *   274 to 403 km/h, so scaling against the maximum puts every bar between 68% and 100% and four
 *   different cars look identical.
 */
const CAR_STATS = [
  { key: 'speed', of: (c: CarId) => tuning(c).maxSpeed * 3.6 },
  { key: 'accel', of: (c: CarId) => tuning(c).engineForce / totalMass(c), unit: 'N/kg' },
  { key: 'grip', of: (c: CarId) => tuning(c).maxLateralAccel, unit: 'm/s²' },
] as const;
const tuning = (id: string) => {
  const vehicle = vehicleFor(id)!;
  return vehicleTuning(vehicle, vehicle.tuning as CarKind);
};
const totalMass = (id: string) => {
  const trailer = vehicleFor(id)!.trailer;
  return tuning(id).mass + (trailer ? vehicleTuning(trailer).mass : 0);
};

export interface StartChoice {
  direction?: RaceDirection;
  trackId: string;
  car?: CarKind;
  vehicleId?: string;
  playerVehicles?: readonly string[];
  ai?: boolean;
  aiDifficulty?: AiDifficulty;
  timeOfDay?: TimeOfDay;
  weather?: Weather;
  slimeDensity: SlimeDensity;
}

export interface StartDeps {
  showHome?: boolean;
  /** The rendering quality the garage preview is built at, from the saved setting (auto on a phone is low). */
  renderQuality?(): Quality;
  onLanguage?(): void;
  onShare?(): void;
  /** The add-to-home-screen guide, for phones whose browser cannot go fullscreen. */
  onShortcut?(): void;
  /**
   * Every route this build can play, whether or not the map file arrived.
   *
   * The map is a picture of the routes, not the list of them. When `menu-map.json` is missing or
   * unreadable the screen still has to offer every track -- the old list menu read the catalogue
   * out of the code and could not be broken by a file, and losing that would mean one bad asset
   * takes away the only way into the game.
   */
  catalogue(): { id: string }[];
  playable(id: string): boolean;
  /** Already formatted, or null: the clock's format has one owner and it is not this screen. */
  /** The selected car's own best on this route. */
  bestLabel(id: string, direction: RaceDirection, vehicleId: string): string | null;
  ghostAvailable?(id: string, direction: RaceDirection, vehicleId: string): boolean;
  /** Persisted condition used before the player touches the density selector. */
  initialSlimeDensity?: SlimeDensity;
  initialAiDifficulty?: AiDifficulty;
  initialWeather?: Weather;
  initialChoice?(): LastRaceChoice | null;
  /** A run a friend shared: the menu opens on its route and direction and says what to beat. */
  challenge?(): Challenge | null;
  onChallengeDismiss?(): void;
  defaults?(id: string): Promise<{ vehicleId: string; timeOfDay: TimeOfDay }>;
  onStart(choice: StartChoice): void;
  /** The player stepped back from the route pages onto the landing page. */
  onHome?(): void;
  onSettings(): void;
  onAbout(): void;
}

export interface StartScreen {
  node: HTMLElement;
  render(): void;
  setActive(active: boolean): void;
  dispose(): void;
  reset(showHome?: boolean): void;
  setMap(map: MenuMap | null): void;
  /** True when the action was consumed, so the caller knows whether to fall through. */
  readonly playerCount: number;
  /** True while the landing page is showing, not the three steps. */
  readonly atHome: boolean;
  /** The landing page's copy of the live scene's last frame (shown only while the scene comes back). */
  readonly homeStill: HTMLCanvasElement;
  handle(action: MenuAction, player?: number): boolean;
}

const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Card rows scroll sideways with their scrollbar hidden, so a plain mouse wheel (vertical only)
 * would otherwise be stuck; touch and trackpads already swipe them natively. */
function wheelScrollsSideways(row: HTMLElement): void {
  row.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || row.scrollWidth <= row.clientWidth) return;
    event.preventDefault();
    row.scrollLeft += event.deltaY;
  }, { passive: false });
}

export function startScreen(i18n: I18n, deps: StartDeps): StartScreen {
  let map: MenuMap | null = null;
  let routes: MenuRoute[] = [];
  let pick = 0, step = 0, carAt = 0, timeAt = 0;
  /** A challenge the player has moved on from (raced it, or chose another route): it no longer picks for them. */
  let releasedDare: ReturnType<NonNullable<typeof deps.challenge>> = null;
  let weatherAt = Math.max(0, WEATHERS.indexOf(deps.initialWeather ?? 'clear'));
  let timeChoice: TimeOfDay | undefined;
  let loading = false, selectionRevision = 0;
  let routeFocus = 0;
  let worldPreviewFocus: WorldPreviewFocus = 'weather';
  const garage = new Map<string, string>();
  let slimeAt = Math.max(0, SLIME_DENSITIES.indexOf(deps.initialSlimeDensity ?? DEFAULT_SAVE.slimeDensity));
  let rowAt = 0;
  let direction: RaceDirection = 'forward';
  let active = false;
  let atHome = deps.showHome ?? false;
  const mobile = isMobileDevice();
  // A new player starts with the AI on — the whole garage lines up minus the cars the
  // player took — so the first race is a field of rivals, not an empty road. A saved lastRace still
  // wins below; this is only what a player who has never raced gets. On a computer the full field
  // races ("数量不是问题……所有车应该都上场"); a phone gets two, spread across the route's pace.
  let playerCount = 1, rightCarAt = 0, ai = true;
  let difficultyAt = AI_DIFFICULTIES.indexOf(aiDifficulty(deps.initialAiDifficulty ?? DEFAULT_SAVE.aiDifficulty));
  let leaving: HTMLElement | null = null;

  // ---- the stage ---------------------------------------------------------------------------
  const brandName = el('h1', 'sm-name');
  const brandSteps = el('p', 'sm-3steps');
  const brand = el('div', 'sm-brand');
  brand.append(brandName, brandSteps);

  const circuit = svgEl('svg', { class: 'sm-circuit', viewBox: `0 0 ${CIRCUIT_W} ${CIRCUIT_H}`,
    preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
  const trackName = el('h2', 'sm-headline');
  const trackStats = el('div', 'sm-stats');
  const trackBlurb = el('p', 'sm-blurb');
  const stageRoute = el('div', 'sm-act');
  stageRoute.append(circuit as unknown as HTMLElement, trackName, trackStats, trackBlurb);
  // Always shown. No visible label: the numbers need the strip's whole width once a best time fills in.
  const routeDetails=el('div','startup-route-details');routeDetails.setAttribute('role','group');
  routeDetails.append(trackStats,trackBlurb);stageRoute.append(routeDetails);

  const carName = el('h2', 'sm-headline');
  const carPicture = el('div', 'sm-carhero');
  const garageQuality = (): Quality => deps.renderQuality?.() ?? 'high';
  const preview = new GaragePreview(carPicture, i18n, refreshAdvance, garageQuality);
  // Each driver reads the numbers of their own car, so 2P gets its own details panel.
  const carSpecs = [0, 1].map(() => ({ desc: el('p', 'sm-blurb'), drive: el('p', 'sm-drive'),
    bars: el('div', 'sm-bars'), mass: el('div', 'sm-stats') }));

  const rightPicture = el('div', 'sm-carhero');
  const rightPreview = new GaragePreview(rightPicture, i18n, refreshAdvance, garageQuality);
  const rightName = el('h2', 'sm-headline');
  const rightGrid = el('div', 'sm-cars');
  wheelScrollsSideways(rightGrid);
  const leftPlayer = el('section', 'sm-player'), rightPlayer = el('section', 'sm-player');
  const playerHeads = [el('h3', 'sm-eyebrow'), el('h3', 'sm-eyebrow')];
  const addPlayer = el('button', 'startup-add-player') as HTMLButtonElement;
  addPlayer.dataset.players = '2';
  addPlayer.onclick = () => setPlayers(2);
  const removePlayer = el('button', 'startup-remove-player') as HTMLButtonElement;
  removePlayer.dataset.players = '1';
  removePlayer.onclick = () => setPlayers(1);
  const aiSeg = el('div', 'sm-seg sm-ai-options');
  const directionSeg = el('div', 'sm-seg sm-direction');
  const ghostHint = el('p', 'sm-ghost-hint');

  // Where the locator would be, when there is no map to draw in it. It names the command that
  // rebuilds the file, because the person who sees this is the person who can run it.
  const empty = el('p', 'sm-empty');
  // The Bay fills the whole card (slice), no longer a disc inside it.
  const locator = svgEl('svg', { class: 'sm-loc', viewBox: `0 0 ${LOC} ${LOC}`,
    preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' });
  const locLabel = el('p', 'sm-loclabel');
  const locBox = el('figure', 'sm-locbox');
  locBox.append(locator as unknown as HTMLElement, locLabel);

  // The magnifier: a ring round the route on the small map and two lines out to the big drawing of
  // it. It has to
  // live above both, in the stage's own pixels, because it crosses from one to the other.
  const link = svgEl('svg', { class: 'sm-callout', 'aria-hidden': 'true' });
  const stage = el('section', 'sm-stage');
  const maps = el('div', 'sm-maps');
  const circuitBox = el('figure', 'sm-circuitbox');
  circuitBox.append(circuit);
  maps.append(locBox, circuitBox);
  stageRoute.prepend(maps);
  stageRoute.append(empty, link as unknown as HTMLElement);
  stage.append(brand);

  // ---- the panel ---------------------------------------------------------------------------
  const stepsWrap = el('div', 'sm-steps');
  const paneRoute = el('section', 'sm-pane');
  const paneWorld = el('section', 'sm-pane sm-world');
  const paneCar = el('section', 'sm-pane sm-garage-pane');
  stepsWrap.append(paneRoute, paneWorld, paneCar);

  /* */
  const back = el('button', 'sm-back') as HTMLButtonElement;
  const go = el('button', 'sm-go cta') as HTMLButtonElement;
  chevron(back, 'back'); chevron(go, 'next');
  const recap = el('div', 'startup-recap');
  const recapSteps = ['route', 'world', 'car'].map(k => {
    const entry = el('div', 'startup-recap-step'); entry.dataset.k = k;
    entry.append(el('small'), el('strong'));
    return entry;
  });
  recap.append(...recapSteps);
  const foot = el('div', 'sm-foot');
  foot.append(back, recap, go);

  const extras = el('div', 'sm-extras');
  const settings = el('button', 'sm-link') as HTMLButtonElement;
  const about = el('button', 'sm-link') as HTMLButtonElement;
  settings.addEventListener('click', () => deps.onSettings());
  about.addEventListener('click', () => deps.onAbout());
  const fullscreen = fullscreenButton(i18n, 'sm-link sm-fullscreen', deps.onShortcut);
  extras.append(settings, about, ...fullscreen.nodes);

  const side = el('aside', 'sm-side');
  side.append(foot, extras);

  const node = el('div', 'sm replica startup-replica');
  const frame = el('div','replica-frame startup-frame');
  const headerLanguage=el('button','language') as HTMLButtonElement;
  headerLanguage.onclick=()=>deps.onLanguage?.();stage.append(headerLanguage);
  const unfit=fitReplica(node,frame);
  // The sampled menu action owns Enter; a focused button must not also click in the same frame.
  node.addEventListener('keydown', event => { if (event.code === 'Enter' || event.code === 'Space') event.preventDefault(); });
  const viewport = el('div', 'sm-viewport');viewport.setAttribute('role','main');
  // A shared run sits above the steps until the player starts or waves it away.
  const challengeBanner = el('div', 'sm-challenge');
  const challengeText = el('span', 'sm-challenge-text');
  const challengeAccept = el('button', 'sm-challenge-accept cta') as HTMLButtonElement;
  const challengeDismiss = el('button', 'sm-challenge-dismiss') as HTMLButtonElement;
  challengeAccept.type = challengeDismiss.type = 'button';
  challengeAccept.addEventListener('click', () => launch());
  challengeDismiss.addEventListener('click', () => { deps.onChallengeDismiss?.(); paint(); });
  // The dared car's garage photo beside the words: cars differ in pace, and a picture says which one at a glance.
  const challengeCarSlot = el('span', 'sm-challenge-car');
  const challengeBody = el('div', 'sm-challenge-body');
  challengeBody.append(challengeCarSlot, challengeText);
  challengeBanner.append(challengeBody, challengeAccept, challengeDismiss);
  challengeBanner.hidden = true;
  // On the route card's own heading strip, where the dared route is shown: over the page header it
  // hid the game's name.
  stageRoute.append(challengeBanner);
  viewport.append(stepsWrap);
  frame.append(stage, viewport, side);node.append(frame);
  const landing = home(i18n, () => {
    showRoutes();
    go.focus({ preventScroll: true });
  }, () => deps.onLanguage?.(), deps.onSettings, deps.onAbout, undefined, deps.onShare, deps.onShortcut, {
    start: () => launch(),
    ready: () => !!routes[pick] && !loading,
    // What the press will start, so it is never a surprise: route and car, and "2P" for a saved pair.
    detail: () => {
      // routes[pick], not current(): the home page renders once while this screen is still being built.
      const r = routes[pick];
      if (!r) return '';
      const left = i18n.t(`car.${shown(CARS[carAt]!)}.name`);
      const cars = playerCount === 2 ? `${left} + ${i18n.t(`car.${shown(CARS[rightCarAt]!)}.name`)}` : left;
      return `${routeName(i18n, r.id, direction)} · ${cars}`;
    },
  });
  frame.append(landing.node);

  function showRoutes(): void {
    atHome = false; paint(); refitLocator(); drawCircuit(current()); drawLink();
  }

  const current = (): MenuRoute | null => routes[pick] ?? null;
  /** The car that drives out of a garage slot on the selected route (its local car, if it has one). */
  const shown = (slot: string): string => forTrack(vehicleFor(slot)!, current()?.id).id;

  /** The list with no map behind it: every playable track, no line, no length. */
  const withoutMap = (): MenuRoute[] => deps.catalogue()
    .filter((t) => deps.playable(t.id))
    .map((t) => ({ id: t.id, km: 0, checkpoints: 0, line: [], streets: [] }));

  // ---- the circuit -------------------------------------------------------------------------
  /**
   * The selected route, drawn as a lap.
   *
   * Two strokes, not one: a wide dim one that reads as the road surface, and the racing line over
   * it. The dash on top runs the length of the route -- the one moving thing on the screen, and the
   * reason a still drawing of a road reads as a road being driven.
   */
  function drawCircuit(r: MenuRoute | null): void {
    while (circuit.firstChild) circuit.removeChild(circuit.firstChild);
    // The viewBox follows the element, so the drawing is fitted once. Fitting a route into a fixed
    // box and then letting `preserveAspectRatio` fit that box into a differently shaped element
    // boxes it twice, and a wide route came out a fifth smaller than the space it had.
    const w = circuit.clientWidth || CIRCUIT_W, h = circuit.clientHeight || CIRCUIT_H;
    circuit.setAttribute('viewBox', `0 0 ${w.toFixed(0)} ${h.toFixed(0)}`);
    const shape = r ? circuitPath(direction === 'reverse' ? [...r.line].reverse() : r.line, w, h, 14, r.streets) : null;
    if (!shape) return;
    for (const street of shape.streets) {
      circuit.appendChild(svgEl('path', { class: `sm-context sm-context-${street.class}`, d: street.d }));
    }
    circuit.appendChild(svgEl('path', { class: 'sm-road', d: shape.d }));
    circuit.appendChild(svgEl('path', { class: 'sm-line', d: shape.d }));
    const [sx, sy] = shape.start;
    circuit.appendChild(svgEl('circle', { class: 'sm-flag', cx: sx.toFixed(1), cy: sy.toFixed(1),
      r: '10' }));
    if (!shape.loop) {
      const [ex, ey] = shape.end;
      circuit.appendChild(svgEl('circle', { class: 'sm-finish', cx: ex.toFixed(1), cy: ey.toFixed(1),
        r: '8' }));
    }
  }

  // ---- the locator -------------------------------------------------------------------------
  const dot = svgEl('circle', { class: 'sm-dot', r: '6' });
  const spots = new Map<string, SVGElement>();
  let project: ((p: [number, number]) => [number, number]) | null = null;

  /**
   * The Bay, filling its card.
   *
   * A square frame sliced to the card's own shape (the player did not want a round
   * "radar"), so the part of the square the card crops is measured and town labels stay inside what
   * is actually shown. Everything in here is dim on purpose -- it is a locator, not the subject,
   * and the only bright thing is the route picked.
   */
  let builtAspect = 0;
  /** Top of the visible band when the card is wider than the square map, in viewBox units. */
  let panTop: number | null = null;
  function buildLocator(): void {
    while (locator.firstChild) locator.removeChild(locator.firstChild);
    spots.clear();
    project = null;
    if (!map) return;
    const frame = frameOf(map.region, map.world ? undefined : 1);
    const h = frameHeight(frame, MAP_W);
    const full = projector(frame, MAP_W);
    const k = LOC / MAP_W;
    const at = (p: [number, number]): [number, number] => {
      const [x, y] = full(p);
      return [x * k, y * k + (LOC - h * k) / 2];
    };
    project = at;
    // The visible part of the square once sliced to the card; an unmeasured card (hidden, or a test
    // with no layout) keeps the full square.
    const box = locBox.getBoundingClientRect();
    builtAspect = box.width && box.height ? box.width / box.height : 0;
    const shownW = builtAspect && builtAspect < 1 ? LOC * builtAspect : LOC;
    const shownH = builtAspect > 1 ? LOC / builtAspect : LOC;
    // A card wider than the square shows a horizontal band of it. The band follows the selected route
    //So the
    // viewBox is that band rather than the square sliced about its middle.
    const top = builtAspect > 1 ? Math.min(Math.max(panTop ?? (LOC - shownH) / 2, 0), LOC - shownH) : (LOC - shownH) / 2;
    locator.setAttribute('viewBox', builtAspect > 1 ? `0 ${top.toFixed(1)} ${LOC} ${shownH.toFixed(1)}` : `0 0 ${LOC} ${LOC}`);
    const shown = [(LOC - shownW) / 2, top, (LOC + shownW) / 2, top + shownH] as const;
    const g = svgEl('g');
    // The whole card is ground, so no page shows through the gaps: land with the water painted on it,
    // or for a world map sea with the continents on it and the seas they enclose painted back over them.
    g.appendChild(svgEl('rect', { class: map.world ? 'sm-water' : 'sm-locland', x: '0', y: '0', width: String(LOC),
      height: String(LOC) }));
    const waters = map.water.map((w) => svgEl('path', { class: 'sm-water', d: `${pathFor(w, at)}Z` }));
    const lands = map.land.map((l) => svgEl('path', { class: 'sm-land', d: `${pathFor(l, at)}Z` }));
    for (const layer of map.world ? [...lands, ...waters] : [...waters, ...lands]) g.appendChild(layer);
    for (const w of map.water) {
      for (const shore of shoreLines(w, map.region)) {
        g.appendChild(svgEl('path', { class: 'sm-coast', d: pathFor(shore, at) }));
      }
    }
    /* */
    for (const road of map.roads) {
      g.appendChild(svgEl('path', { class: 'sm-locroad', d: pathFor(road, at) }));
    }
    // The towns, under the routes. -- the
    // resonance is in the names you would use yourself to say where something is, so the locator
    // names them: a route beside 圣马特奥 is somewhere, a route beside nothing is a squiggle.
    //
    // Names are placed in PLACE_NAMES order and one that would sit on top of an already-placed name
    // loses its label and keeps its dot. Overlapping labels are worse than fewer labels: two names
    // printed through each other are unreadable *and* they hide which dot is which.
    const taken: [number, number, number, number][] = [];
    const hits = (b: [number, number, number, number]): boolean => taken.some(
      (t) => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1]);
    for (const place of map.places) {
      const [x, y] = at([place.lon, place.lat]);
      if (x < shown[0] + LABEL_PAD || x > shown[2] - LABEL_PAD || y < shown[1] + LABEL_PAD || y > shown[3] - LABEL_PAD) continue;
      g.appendChild(svgEl('circle', { class: 'sm-town', cx: x.toFixed(1), cy: y.toFixed(1),
        r: '2.6' }));
      const text = i18n.t(`place.${place.id}`);
      // A Han character is about twice as wide as a Latin letter at the same size.
      const w = [...text].reduce((sum, ch) => sum + (/[\u2e80-\u9fff\uf900-\ufaff]/.test(ch) ? 11.2 : 5.6), 0) + 4, h = 12;
      // Right of the dot, then left of it: whichever is clear, and nothing if neither is.
      const spots: [boolean, [number, number, number, number]][] = [
        [false, [x + 6, y - h / 2, x + 6 + w, y + h / 2]],
        [true, [x - 6 - w, y - h / 2, x - 6, y + h / 2]],
      ];
      // Inside what the card shows, not the square: a label that clears the square can still be
      // cut in half by the slice ("San Jo").
      const inside = (b: [number, number, number, number]): boolean =>
        b[0] > shown[0] + LABEL_PAD && b[2] < shown[2] - LABEL_PAD && b[1] > shown[1] + LABEL_PAD && b[3] < shown[3] - LABEL_PAD;
      const spot = spots.find(([, b]) => !hits(b) && inside(b));
      if (!spot) continue;
      taken.push(spot[1]);
      const label = svgEl('text', { class: 'sm-townnm', x: (x + (spot[0] ? -6 : 6)).toFixed(1),
        y: (y + 4).toFixed(1), 'text-anchor': spot[0] ? 'end' : 'start' });
      label.textContent = text;
      g.appendChild(label);
    }
    for (const r of routes) {
      if (!r.line.length || !insideFrame(r, frame)) continue;
      const p = svgEl('path', { class: 'sm-route', d: pathFor(r.line, at) });
      p.addEventListener('click', () => { select(routes.indexOf(r)); });
      g.appendChild(p);
      spots.set(r.id, p);
    }
    g.appendChild(dot);
    locator.appendChild(g);
  }

  /** Rebuild the locator when its card has changed shape since it was built (first layout, rotation). */
  function refitLocator(): void {
    const box = locBox.getBoundingClientRect();
    if (!box.width || !box.height || Math.abs(box.width / box.height - builtAspect) < .02) return;
    buildLocator(); moveDot(current());
  }

  /** Highlight the selected route's line and lift it above its neighbours, which it shares a city with. */
  function markRoute(r: MenuRoute | null): void {
    for (const [id, path] of spots) {
      const on = !!r && id === r.id;
      path.classList.toggle('sel', on);
      if (on && dot.parentNode === path.parentNode) path.parentNode!.insertBefore(path, dot);
    }
  }

  /**
   * Put the dot round the selected route, or take it off when there is nothing to point at.
   *
   * The dot is the circle the callout's ring is drawn round, not a mark of its own: it spans the whole
   * route, so the ring encloses the line instead of a filled disc sitting on top of it
   *.
   */
  function moveDot(r: MenuRoute | null): void {
    const line = r?.line ?? [];
    // Every caller that rebuilt the paths (a pan below, a resize in refitLocator) gets the highlight back.
    markRoute(r);
    if (!project || !line.length) { dot.setAttribute('class', 'sm-dot'); return; }
    const points = line.map((p) => project!(p));
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const [x, y] = [(x0 + x1) / 2, (y0 + y1) / 2];
    dot.setAttribute('cx', x.toFixed(1));
    dot.setAttribute('cy', y.toFixed(1));
    dot.setAttribute('r', Math.max(Math.hypot(x1 - x0, y1 - y0) / 2, 2).toFixed(1));
    dot.setAttribute('class', 'sm-dot on');
    let bandTop = 0, band = LOC;
    if (builtAspect > 1) {
      band = LOC / builtAspect;
      const wanted = Math.min(Math.max(y - band / 2, 0), LOC - band);
      if (panTop === null || Math.abs(wanted - panTop) > band * .25) {
        panTop = wanted; buildLocator();
        // A rebuild makes new route paths, without the highlight the old ones had.
        markRoute(r);
      }
      bandTop = panTop;
    }
    // The enlarged route drawing sits in the corner away from the dot: the other half across,
    // and, since the card grew wider than the drawing is tall, the other side as well --
    // a band centred on the dot left no top or bottom half for it to hide in.
    circuitBox.classList.toggle('low', y - bandTop < band / 2);
    circuitBox.classList.toggle('left', x > LOC / 2);
  }

  // ---- the panel's three panes -------------------------------------------------------------
  const list = el('ul', 'sm-list');
  wheelScrollsSideways(list);
  function buildList(): void {
    list.replaceChildren();
    routes.forEach((r, i) => {
      const li = el('li', 'sm-item');
      li.tabIndex = 0;
      li.dataset.track = r.id;
      li.append(routeThumbnail(r), el('span', 'sm-code', CATALOGUE.find((t) => t.id === r.id)?.code ?? ''),
                el('span', 'sm-nm', i18n.t(`track.${r.id}.name`)),
                el('span', 'sm-km', r.km > 0 ? `${r.km.toFixed(1)} km` : '—'),
                el('span', 'sm-route-blurb', i18n.t(`track.${r.id}.blurb`)));
      li.addEventListener('click', () => select(i));
      li.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') select(i);
      });
      list.appendChild(li);
    });
  }

  function select(i: number): void {
    if (i < 0 || i >= routes.length) return;
    pick = i; routeFocus = i;
    const id = routes[i]!.id;
    const dare = deps.challenge?.();
    if (dare && dare.trackId !== id) releasedDare = dare;
    const cached = garage.get(id);
    if (cached) carAt = CARS.indexOf(cached);
    if (deps.defaults) {
      const revision = ++selectionRevision;
      loading = true;
      void deps.defaults(id).then(defaults => {
        if (revision !== selectionRevision) return;
        const wanted = garage.get(id) ?? defaults.vehicleId;
        const wantedAt = CARS.indexOf(wanted);
        carAt = Math.max(0, wantedAt);
        timeAt = TIMES.indexOf(timeChoice ?? defaults.timeOfDay);
        loading = false;
        paint();
      }).catch((error: unknown) => {
        if (revision !== selectionRevision) return;
        // A missing track cannot be offered as a successfully prepared race.
        loading = true;
        trackBlurb.textContent = i18n.t('start.loadFailed');
        console.warn(`Could not prepare route ${id}`, error);
      });
    }
    paint();
  }

  function selectCar(i: number, player = 0): void {
    if (player === 1) { rightCarAt = i; paint(); return; }
    carAt = i;
    const id = current()?.id;
    if (id) garage.set(id, CARS[i]!);
    paint();
  }

  function goStep(i: number): void {
    for(const pane of [paneRoute,paneWorld,paneCar])pane.getAnimations?.().forEach(a=>a.cancel());
    if(leaving){leaving.getAnimations().forEach(a=>a.cancel());leaving.removeAttribute('data-leaving');leaving=null;}
    const previous=[paneRoute,paneWorld,paneCar][step]!;
    const changed=step!==Math.max(0,Math.min(2,i));
    step = Math.max(0, Math.min(2, i));
    paint();
    const reduced=document.documentElement.dataset.reducedMotion==='true'||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if(changed&&!atHome&&!reduced&&previous.animate){
      previous.hidden=false;previous.dataset.leaving='true';leaving=previous;
      void previous.animate([{opacity:1,transform:'none'},{opacity:0,transform:'translateY(-45px) scale(1.1)'}],{duration:260,easing:'ease-in'}).finished.then(()=>{if(leaving===previous){previous.hidden=true;previous.removeAttribute('data-leaving');leaving=null;}}).catch(()=>{});
      [paneRoute,paneWorld,paneCar][step]!.animate([{opacity:0,transform:'translateY(80px) scale(.85)'},{opacity:1,transform:'none'}],{delay:260,duration:390,fill:'backwards',easing:'cubic-bezier(.16,1.5,.45,1)'});
    }
    (go.disabled ? node : go).focus({ preventScroll: true });
  }

  const carGrid = el('div', 'sm-cars');
  wheelScrollsSideways(carGrid);
  const timeSeg = el('div', 'sm-seg sm-time');
  const weatherSeg = el('div', 'sm-seg sm-weather');
  const slimeSeg = el('div', 'sm-seg sm-slimes');

  function conditionButton(condition: 'time' | 'weather' | 'slimes' | 'direction' | 'ai',
    value: string, label: string): HTMLButtonElement {
    const button = el('button', '') as HTMLButtonElement;
    button.append(conditionScene(condition, value), el('span', 'sm-condition-label', label));
    return button;
  }

  function routeThumbnail(route: MenuRoute): HTMLImageElement {
    const image = el('img', 'sm-route-thumb') as HTMLImageElement;
    image.src = `./menu/tracks/${route.id}.webp`;
    image.alt = '';
    image.loading = 'eager';
    image.decoding = 'async';
    image.addEventListener('error', () => { image.src = SHOWCASE_IMAGE; }, { once: true });
    return image;
  }

  /** The pre-rendered world preview for the route picked on the previous step. */
  function worldPreviewSource(routeId = current()?.id ?? PREVIEW_FALLBACK): string {
    const time = TIMES[timeAt]!;
    const name = worldPreviewFocus === 'time' || worldPreviewFocus === 'weather' ? `${time}-${WEATHERS[weatherAt]}`
      : worldPreviewFocus === 'slimes' ? `slimes-${SLIME_DENSITIES[slimeAt]}`
        : ai ? `ai-${AI_DIFFICULTIES[difficultyAt]}` : 'ai-off';
    return `./menu/world/${routeId}/${name}.webp`;
  }

  function selectAiOption(index: number): void {
    ai = index > 0;
    if (ai) difficultyAt = index - 1;
  }

  /** Everything the car cards are drawn from: how many players (the right-hand row), the
   *  language (names, drive, speed units) and the route (its own car stands in its slot). */
  const carsKey = (): string => `${playerCount}|${i18n.lang}|${current()?.id ?? ''}`;
  let carsDrawnAs: string | undefined;
  /** Rebuild the cards only when what they show changed. `render()` runs whenever the input device
   *  changes -- so a prompt can say "tap" instead of "press Enter" -- and on an iPad the first tap on
   *  the car flips it. Rebuilding then replaced the whole row with fresh nodes, which the player saw
   * as the cards popping in again every time they touched the car. */
  function ensureCars(): void {
    // Not before the route is known: cards drawn for no route load the slot cars' pictures, and a
    // route with its own car then loads its picture as well -- a download the garage never shows.
    if (!current() || carsDrawnAs === carsKey()) return;
    carsDrawnAs = carsKey();
    carGrid.replaceChildren();
    CARS.forEach((c, i) => {
      // The button keeps the slot's id; the picture, name and figures are the car that will drive.
      const b = el('button', 'sm-car') as HTMLButtonElement, car = shown(c);
      b.dataset.vehicle = c;
      const speed = i18n.speed(tuning(car).maxSpeed * 3.6);
      const drive = i18n.t(`drive.${tuning(car).drive}.short`);
      b.append(carThumbnail(car), el('span', 'sm-carnm', i18n.t(`car.${car}.name`)),
               el('span', 'sm-cardesc', `${drive} · ${speed.value} ${speed.unit}`));
      b.addEventListener('click', () => selectCar(i));
      carGrid.appendChild(b);
    });
    rightGrid.replaceChildren();
    (playerCount === 2 ? CARS : []).forEach((c, i) => {
      const b = el('button', 'sm-car') as HTMLButtonElement;
      b.append(carThumbnail(shown(c)), el('span', 'sm-carnm', i18n.t(`car.${shown(c)}.name`)));
      b.dataset.vehicle = c; b.addEventListener('click', () => selectCar(i, 1)); rightGrid.append(b);
    });
  }

  function buildStatic(): void {
    const routePanel=el('section','startup-route-panel'),routeCount=el('div','startup-route-count');
    routeDetails.setAttribute('aria-label',i18n.t('flow.routeDetails'));
    routeCount.append(el('span','',i18n.t('flow.chooseRoute')));
    routePanel.append(routeCount,list);paneRoute.replaceChildren(stageRoute,routePanel);

    ensureCars();
    for(const [player,pane,picture,name,grid] of [[0,leftPlayer,carPicture,carName,carGrid],[1,rightPlayer,rightPicture,rightName,rightGrid]] as const){
      const row=el('div','startup-driver-row'),label=el('div');label.append(playerHeads[player]!,name);
      const specs=carSpecs[player]!,details=el('div','startup-car-details');details.append(el('h4','startup-details-title',i18n.t('flow.carDetails')),specs.mass,specs.drive,specs.bars,specs.desc);
      // The driver line and details sit inside the spotlight so the preview keeps that height.
      const stage=el('div','startup-car-stage');row.append(label);stage.append(picture,row,details);pane.replaceChildren(stage,grid);
    }
    const garageTitle=el('h1','startup-garage-title',i18n.t(playerCount===2?'flow.garageDual':'flow.garageSolo'));
    const garageHeader=el('div','startup-garage-header');garageHeader.append(garageTitle);
    addPlayer.textContent=`+ ${i18n.t('flow.addPlayer')}`;removePlayer.textContent=i18n.t('flow.removePlayer');
    if(!mobile)garageHeader.append(playerCount===1?addPlayer:removePlayer);
    const bays=el('div','startup-garage');bays.append(leftPlayer,...(playerCount===2?[rightPlayer]:[]));paneCar.replaceChildren(garageHeader,bays);

    timeSeg.replaceChildren();
    TIMES.forEach((t, i) => {
      const b = conditionButton('time', t, i18n.t(`time.${t}`));
      b.dataset.time = t;
      b.addEventListener('click', () => { timeAt = i; timeChoice = t; worldPreviewFocus = 'time'; paint(); });
      timeSeg.appendChild(b);
    });
    weatherSeg.replaceChildren();
    WEATHERS.forEach((weather, i) => {
      const b = conditionButton('weather', weather, i18n.t(`weather.${weather}`));
      b.dataset.weather = weather;
      b.addEventListener('click', () => { weatherAt = i; worldPreviewFocus = 'weather'; paint(); });
      weatherSeg.appendChild(b);
    });
    slimeSeg.replaceChildren();
    SLIME_DENSITIES.forEach((density, i) => {
      const b = conditionButton('slimes', density, i18n.t(`slimeDensity.${density}`));
      b.dataset.slimeDensity = density;
      b.addEventListener('click', () => { slimeAt = i; worldPreviewFocus = 'slimes'; paint(); });
      slimeSeg.appendChild(b);
    });
    aiSeg.replaceChildren();
    for (const [index, option] of ['none', ...AI_DIFFICULTIES].entries()) {
      const b = conditionButton('ai', option, i18n.t(`start.aiOption.${option}`));
      b.dataset.aiMode = option;
      b.addEventListener('click', () => { selectAiOption(index); worldPreviewFocus = 'ai'; paint(); });
      aiSeg.append(b);
    }
    directionSeg.replaceChildren();
    for (const value of ['forward', 'reverse'] as const) {
      const b = conditionButton('direction', value, i18n.t('direction.' + value));
      b.dataset.direction = value;
      b.addEventListener('click', () => { direction = value; paint(); drawCircuit(current()); });
      directionSeg.append(b);
    }
    const conditions = el('div', 'sm-conditions');
    // Time and direction are both two-way switches, so they share one row under one label; the four rows
    // split the column's height between them instead of sitting at a fixed pixel height.
    const departure = el('div', 'sm-seg-pair');
    departure.append(timeSeg, el('span', 'sm-seg-divider'), directionSeg);
    for (const [label, title, segment] of [
      ['start.departure', 'flow.departure', departure], ['start.weather', 'start.weatherLabel', weatherSeg],
      ['start.slimes', 'flow.slimes', slimeSeg], ['start.ai', 'start.ai', aiSeg],
    ] as const) {
      const group = el('section', 'sm-condition');
      group.dataset.condition=label;
      group.append(el('p', 'sm-eyebrow', i18n.t(title)), segment);
      conditions.append(group);   // every condition in the one right-hand column, nothing folded away
    }
    const worldPreview = el('div', 'sm-world-preview');
    worldPreview.setAttribute('aria-hidden', 'true');
    const worldShot = el('img', 'sm-world-shot') as HTMLImageElement;
    worldShot.alt = ''; worldShot.decoding = 'async';
    // A route without its own rendered set (a synthetic dev track) shows the Golden Gate set instead.
    worldShot.addEventListener('error', () => {
      const fallback = new URL(worldPreviewSource(PREVIEW_FALLBACK), document.baseURI).href;
      if (worldShot.src !== fallback) worldShot.src = fallback;
    });
    const worldState = el('div', 'sm-world-state');
    worldState.append(el('span', '', i18n.t(`time.${TIMES[timeAt]}`)),
      el('span', '', i18n.t(`weather.${WEATHERS[weatherAt]}`)),
      el('span', '', i18n.t(`slimeDensity.${SLIME_DENSITIES[slimeAt]}`)),
      el('span', '', i18n.t(`direction.${direction}`)),
      el('span', '', i18n.t(ai ? `start.aiOption.${AI_DIFFICULTIES[difficultyAt]}` : 'start.aiOption.none')));
    worldPreview.append(worldShot, worldState);
    const worldIntro=el('div','startup-world-intro');worldIntro.append(el('h1','',i18n.t('flow.worldTitle')),ghostHint);
    paneWorld.replaceChildren(worldPreview, worldIntro, conditions);


  }

  function stat(value: string, label?: string): HTMLElement {
    const box = el('div', 'sm-stat');
    box.append(el('b', '', value));
    if (label) box.append(el('span', '', label));
    return box;
  }

  /**
   * One car number as a bar, scaled inside the range the four cars actually cover.
   *
   * The worst of the four keeps a visible stub (18%) rather than an empty track: a bar at zero
   * reads as "missing", and no car here has none of anything.
   */
  function bar(label: string, value: number, lo: number, hi: number, text: string): HTMLElement {
    const row = el('div', 'sm-bar');
    const fill = el('i', '');
    const frac = hi > lo ? (value - lo) / (hi - lo) : 1;
    fill.style.width = `${Math.round(18 + frac * 82)}%`;
    const track = el('div', 'sm-bartrack');
    track.appendChild(fill);
    row.append(el('span', 'sm-barlabel', label), track, el('b', 'sm-barval', text));
    return row;
  }

  /**
   * Draw the callout, or take it away when there is nothing to point at.
   *
   * Everything here is measured off the rendered page rather than computed, because the two shapes
   * it connects live in different coordinate systems -- one in the locator's viewBox, one in the
   * circuit's -- and the only place they share is the screen. Zero-sized rectangles mean the layout
   * has not happened yet (or a test with no layout at all), and then there is simply no line.
   */
  function drawLink(): void {
    while (link.firstChild) link.removeChild(link.firstChild);
    const road = circuit.querySelector('.sm-road');
    if (step !== 0 || locBox.hidden || !road || !dot.classList.contains('on')) return;
    const stageBox = stageRoute.getBoundingClientRect();
    const here = (dot as SVGGraphicsElement).getBoundingClientRect();
    const there = (road as SVGGraphicsElement).getBoundingClientRect();
    if (!stageBox.width || !here.width || !there.width) return;
    link.setAttribute('viewBox', `0 0 ${stageBox.width.toFixed(0)} ${stageBox.height.toFixed(0)}`);
    const cx = here.left - stageBox.left + here.width / 2;
    const cy = here.top - stageBox.top + here.height / 2;
    const r = Math.max(here.width, here.height) / 2 + 9;
    const lines = callout(cx, cy, r, {
      left: there.left - stageBox.left, top: there.top - stageBox.top,
      right: there.right - stageBox.left, bottom: there.bottom - stageBox.top,
    });
    if (!lines) return;
    link.appendChild(svgEl('circle', { class: 'sm-lens', cx: cx.toFixed(1), cy: cy.toFixed(1),
      r: r.toFixed(1) }));
    for (const l of lines) {
      link.appendChild(svgEl('line', { class: 'sm-leader', x1: l.x1.toFixed(1),
        y1: l.y1.toFixed(1), x2: l.x2.toFixed(1), y2: l.y2.toFixed(1) }));
    }
  }

  function paint(): void {
    node.dataset.home = String(atHome);
    landing.node.hidden = !atHome;
    for (const part of [stage, viewport, side]) part.inert = atHome;
    landing.render();
    const r = current();
    node.dataset.players = String(playerCount);
    rightPlayer.hidden = playerCount === 1;
    [leftPlayer, rightPlayer].forEach((pane, player) => {
      pane.dataset.player = String(player);
      playerHeads[player]!.textContent = i18n.t('flow.driver',{player:player+1});
      playerHeads[player]!.title = i18n.t(`start.keys.${player}`);
      playerHeads[player]!.hidden=false;
    });
    [...rightGrid.children].forEach((b, i) => b.classList.toggle('sel', i === rightCarAt));
    rightName.textContent = i18n.t(`car.${shown(CARS[rightCarAt]!)}.name`);
    rightPreview.show(forTrack(vehicleFor(CARS[rightCarAt]!)!, current()?.id), active && step === 2 && playerCount === 2, current()?.id);
    [...aiSeg.children].forEach((b, i) => {
      const selected = i === (ai ? difficultyAt + 1 : 0);
      b.classList.toggle('on', selected); b.setAttribute('aria-pressed', String(selected));
    });
    aiSeg.classList.toggle('row', step === 1 && rowAt === 4);
    stepsWrap.style.transform = 'none';
    node.dataset.step = atHome ? 'home' : String(step);
    const dared = deps.challenge?.();
    // Only while the dared route and direction are the ones chosen: the banner's button starts what
    // is chosen, and a dare shown over another route would be raced and never compared.
    const dare = dared && current()?.id === dared.trackId && direction === dared.direction ? dared : null;
    challengeBanner.hidden = !dare || atHome;
    if (dare) {
      const car = challengeCar(i18n, dare.vehicleId);
      challengeText.textContent = i18n.t('challenge.banner', { name: dare.name ?? i18n.t('challenge.someone'),
        route: routeName(i18n, dare.trackId, dare.direction),
        time: formatTime(dare.time), stars: starGlyphs(dare.rating), score: dare.score.toLocaleString(i18n.lang === 'zh' ? 'zh-CN' : 'en-US'),
        car });
      if (challengeCarSlot.dataset.vehicle !== (dare.vehicleId ?? '')) {
        challengeCarSlot.replaceChildren(...(dare.vehicleId ? [carThumbnail(dare.vehicleId, 'sm-challenge-thumb')] : []));
        challengeCarSlot.dataset.vehicle = dare.vehicleId ?? '';
      }
      challengeCarSlot.hidden = !dare.vehicleId;
      challengeAccept.textContent = i18n.t('challenge.accept');
      challengeDismiss.textContent = i18n.t('challenge.dismiss');
      node.dataset.challenge = dare.trackId;
    } else delete node.dataset.challenge;
    [paneRoute, paneWorld, paneCar].forEach((pane, i) => {
      pane.inert = i !== step;
      pane.hidden=i!==step&&pane!==leaving;
      pane.setAttribute('aria-hidden', String(i !== step));
    });
    moveDot(r);
    [...list.children].forEach((li, i) => {
      li.classList.toggle('sel', i === pick);
      li.classList.toggle('browse', i === routeFocus);
    });
    [...carGrid.children].forEach((b, i) => b.classList.toggle('sel', i === carAt));
    if(active&&step===2&&!atHome)for(const grid of [carGrid,rightGrid]){
      const selected=grid.querySelector<HTMLElement>('.sel');
      if(selected)grid.scrollLeft=Math.max(0,selected.offsetLeft-(grid.clientWidth-selected.offsetWidth)/2);
    }
    [...timeSeg.children].forEach((b, i) => b.classList.toggle('on', i === timeAt));
    [...weatherSeg.children].forEach((b, i) => b.classList.toggle('on', i === weatherAt));
    [...slimeSeg.children].forEach((b, i) => b.classList.toggle('on', i === slimeAt));
    [...directionSeg.children].forEach(b => b.classList.toggle('on', (b as HTMLElement).dataset.direction === direction));
    directionSeg.classList.toggle('row', step === 1 && rowAt === 3);
    timeSeg.classList.toggle('row', step === 1 && rowAt === 0);
    weatherSeg.classList.toggle('row', step === 1 && rowAt === 1);
    slimeSeg.classList.toggle('row', step === 1 && rowAt === 2);

    const worldPreview = paneWorld.querySelector<HTMLElement>('.sm-world-preview');
    if (worldPreview) {
      worldPreview.dataset.worldTime = TIMES[timeAt];
      worldPreview.dataset.worldWeather = WEATHERS[weatherAt];
      worldPreview.dataset.worldSlimes = SLIME_DENSITIES[slimeAt];
      worldPreview.dataset.worldDirection = direction;
      worldPreview.dataset.worldAi = String(ai);
      worldPreview.dataset.worldDifficulty = AI_DIFFICULTIES[difficultyAt];
      const shot = worldPreview.querySelector<HTMLImageElement>('.sm-world-shot');
      if (shot) shot.src = worldPreviewSource();
      const labels = worldPreview.querySelectorAll<HTMLElement>('.sm-world-state span');
      const values = [i18n.t(`time.${TIMES[timeAt]}`), i18n.t(`weather.${WEATHERS[weatherAt]}`),
        i18n.t(`slimeDensity.${SLIME_DENSITIES[slimeAt]}`),
        i18n.t(`direction.${direction}`),
        i18n.t(ai ? `start.aiOption.${AI_DIFFICULTIES[difficultyAt]}` : 'start.aiOption.none')];
      labels.forEach((label, i) => { label.textContent = values[i]!; });
    }

    renderBrandSignature(brandName, i18n, true);brandSteps.hidden=true;
    renderLanguageToggle(headerLanguage, i18n);
    locLabel.replaceChildren(el('span','eyebrow',i18n.t('flow.mapEyebrow')),el('strong','',i18n.t('flow.mapTitle')));
    const chosen = [
      r ? i18n.t(`track.${r.id}.name`) : '—',
      `${i18n.t(`time.${TIMES[timeAt]}`)} · ${i18n.t(`weather.${WEATHERS[weatherAt]}`)} · ${i18n.t('flow.recapSlimes', { level: i18n.t(`slimeDensity.${SLIME_DENSITIES[slimeAt]}`) })}`,
      i18n.t(`car.${shown(CARS[carAt]!)}.name`) + (playerCount === 2 ? ` + ${i18n.t(`car.${shown(CARS[rightCarAt]!)}.name`)}` : ''),
    ];
    recapSteps.forEach((entry, i) => {
      entry.dataset.state = i < step ? 'done' : i === step ? 'on' : 'todo';
      entry.querySelector('small')!.textContent = `${String(i + 1).padStart(2, '0')} ${i18n.t(`flow.step.${i}`)}`;
      entry.querySelector('strong')!.textContent = i <= step ? chosen[i]! : '—';
    });

    drawCircuit(r);
    if (r) {
      trackName.textContent = i18n.t(`track.${r.id}.name`);
      trackStats.replaceChildren(
        ...(r.km > 0 ? [stat(r.km.toFixed(1), i18n.t('start.km'))] : []),
        ...(r.checkpoints > 0 ? [stat(String(r.checkpoints), i18n.t('start.checkpoints'))] : []),
        stat(deps.bestLabel(r.id, direction, CARS[carAt]!) ?? '—', i18n.t('start.best')),
      );
      trackBlurb.textContent = i18n.t(`track.${r.id}.blurb`);
    } else {
      trackName.textContent = i18n.t('start.nothingToDrive');
      trackStats.replaceChildren();
      trackBlurb.textContent = devHint(i18n.t('start.noMap'), 'menu-map');
    }

    const car = CARS[carAt]!;
    preview.show(forTrack(vehicleFor(car)!, current()?.id), active && step === 2, current()?.id);
    carName.textContent = i18n.t(`car.${shown(car)}.name`);
    [car, CARS[rightCarAt]!].forEach((id, player) => {
      const specs = carSpecs[player]!;
      specs.drive.textContent = `${i18n.t(`drive.${tuning(shown(id)).drive}.name`)} · ${i18n.t(`car.${shown(id)}.drive`)}`;
      specs.desc.textContent = i18n.t(`car.${shown(id)}.desc`);
      specs.bars.replaceChildren(...CAR_STATS.map((s) => {
        const all = CARS.map((c) => s.of(c));
        const value = s.of(id);
        const display = s.key === 'speed' ? i18n.speed(value) : { value: Math.round(value), unit: s.unit };
        return bar(i18n.t(`car.stat.${s.key}`), value, Math.min(...all), Math.max(...all),
                   `${display.value} ${display.unit}`);
      }));
      const weight = i18n.mass(totalMass(id));
      // The unit says what the number is;
      specs.mass.replaceChildren(stat(`${weight.value} ${weight.unit}`));
    });

    ghostHint.hidden = !r || !!deps.ghostAvailable?.(r.id, direction, CARS[carAt]!)
      || deps.bestLabel(r.id, direction, CARS[carAt]!) !== null;
    ghostHint.textContent = ghostHint.hidden ? '' : i18n.t('intro.ghostFirst');

    chevronLabel(back, i18n.t('start.back'));
    back.hidden = false;
    refreshAdvance();
    chevronLabel(go, !r ? i18n.t('start.nothingToDrive') : step < 2 ? i18n.t('flow.continue') : i18n.t('flow.startEngine'));
    go.classList.toggle('final', step === 2);
    // Only transfer the screen's placeholder focus; never steal it back from another control.
    if (document.activeElement === node) {
      if (atHome) landing.go.focus({ preventScroll: true });
      else if (!go.disabled) go.focus({ preventScroll: true });
    }
    settings.textContent = i18n.t('menu.settings');
    about.textContent = i18n.t('menu.about');
    fullscreen.render();
    locBox.hidden = !map;
    drawLink();
    empty.hidden = !!map;
    empty.textContent = map ? '' : devHint(i18n.t('start.noMap'), 'menu-map');
  }

  function refreshAdvance(): void {
    go.disabled = !current() || (loading && step === 2)
      || (active && step === 2 && !preview.ready)
      || (step === 2 && playerCount === 2 && active && !rightPreview.ready);
    // Keep the step's focus while loading, unless the player chose another control meanwhile.
    if (active && !atHome && !go.disabled && document.activeElement === node) go.focus({ preventScroll: true });
  }

  function setPlayers(count: number): void {
    if (mobile || count === playerCount) return;
    if (count === 2 && rightCarAt === carAt) {
      const preferred = CARS.indexOf('pickup-travel-trailer');
      rightCarAt = preferred !== carAt ? preferred : CARS.findIndex((_, index) => index !== carAt);
    }
    playerCount = count;
    buildStatic(); paint();
    go.focus({ preventScroll: true });
  }

  function advance(): void {
    if (go.disabled) return;
    if (step < 2) { goStep(step + 1); return; }
    launch();
  }

  /** Start with whatever is chosen now; the challenge banner's one press uses it from any step. */
  function launch(): void {
    const r = current();
    releasedDare = deps.challenge?.() ?? null;
    if (r) {
      deps.onStart({ trackId: r.id, direction, vehicleId: CARS[carAt]!, timeOfDay: TIMES[timeAt]!,
                     weather: WEATHERS[weatherAt]!,
                     slimeDensity: SLIME_DENSITIES[slimeAt]!, ai, aiDifficulty: AI_DIFFICULTIES[difficultyAt]!,
                     ...(playerCount === 2 ? { playerVehicles: [CARS[carAt]!, CARS[rightCarAt]!] } : {}) });
    }
  }

  function restoreSavedChoice(): void {
    const saved = deps.initialChoice?.();
    // A challenge picks its route, direction and car until the player races it or picks another
    // route; after that their own choices and last race lead again.
    const dare = deps.challenge?.();
    const fresh = !!dare && dare !== releasedDare;
    if (fresh) {
      const route = routes.findIndex(item => item.id === dare.trackId);
      if (route >= 0) { pick = route; routeFocus = route; }
      direction = dare.direction;
      const car = dare.vehicleId ? CARS.indexOf(dare.vehicleId) : -1;
      if (car >= 0) {
        carAt = car;
        // The garage is what `select` reads once the route's defaults load; without this a new save
        // quietly swaps the dared car for the route's default one.
        garage.set(dare.trackId, dare.vehicleId!);
      }
      if (!saved) return;
    }
    if (!saved) return;
    const route = routes.findIndex(item => item.id === saved.trackId);
    if (!fresh) { pick = Math.max(0, route); routeFocus = pick; }
    const left = CARS.indexOf(saved.playerVehicles[0]!);
    const right = CARS.indexOf(saved.playerVehicles[1]!);
    if (!(fresh && dare?.vehicleId && CARS[carAt] === dare.vehicleId)) carAt = Math.max(0, left);
    rightCarAt = right >= 0 ? right : carAt;
    const routeId = routes[pick]?.id;
    if (routeId) garage.set(routeId, CARS[carAt]!);
    playerCount = mobile ? 1 : saved.playerCount;
    timeChoice = saved.timeOfDay; timeAt = Math.max(0, TIMES.indexOf(saved.timeOfDay));
    weatherAt = Math.max(0, WEATHERS.indexOf(saved.weather));
    slimeAt = Math.max(0, SLIME_DENSITIES.indexOf(saved.slimeDensity));
    ai = saved.ai; difficultyAt = Math.max(0, AI_DIFFICULTIES.indexOf(saved.aiDifficulty));
    if (!dare) direction = saved.direction;
  }
  go.addEventListener('click', advance);
  back.addEventListener('click', () => {if(step===0){atHome=true;paint();deps.onHome?.();}else goStep(step-1);});

  // The callout and enlarged route are measured in screen pixels, so rotating a phone invalidates
  // both, and the locator is sliced to its card's shape, so a changed card rebuilds it too.
  let redraw: number | undefined;
  const onResize = () => {
    window.clearTimeout(redraw);
    redraw = window.setTimeout(() => { refitLocator(); drawCircuit(current()); drawLink(); }, 120);
  };
  window.addEventListener('resize', onResize);

  return {
    node,
    setActive(value) { active = value; paint(); },
    dispose() {
      for(const pane of [paneRoute,paneWorld,paneCar])pane.getAnimations?.().forEach(a=>a.cancel());
      window.removeEventListener('resize', onResize);
      window.clearTimeout(redraw);
      preview.dispose(); rightPreview.dispose();
      unfit();
    },
    setMap(next) {
      map = next;
      routes = withoutMap();
      if (next) {
        // The map's own routes win where it has them -- they carry the line, the length and the
        // checkpoint count -- and anything the catalogue knows about that the map does not (the
        // synthetic tracks in dev, a route built after the map was generated) keeps its plain row.
        const drawn = new Map(next.routes.filter((r) => deps.playable(r.id)).map((r) => [r.id, r]));
        routes = routes.map((r) => drawn.get(r.id) ?? r);
        for (const r of drawn.values()) if (!routes.some((x) => x.id === r.id)) routes.push(r);
      }
      pick = Math.min(pick, Math.max(0, routes.length - 1));
      restoreSavedChoice();
      buildStatic();
      buildLocator();
      buildList();
      select(pick);
    },
    render() {
      buildStatic(); buildLocator(); buildList();
      // Refreshing input prompts must not reload defaults and consume the confirming key.
      if (routes.length && selectionRevision === 0) select(pick); else paint();
    },
    get playerCount() { return playerCount; },
    get atHome() { return atHome; },
    homeStill: landing.still,
    reset(showHome = false) { atHome = showHome && !!deps.showHome; restoreSavedChoice(); goStep(0); },
    handle(action, player = 0) {
      if (atHome) {
        // A pad reaches the quick race below "hit the road" with down, and comes back with up.
        if (action === 'down' && !landing.quick.hidden && !landing.quick.disabled) landing.quick.focus({ preventScroll: true });
        if (action === 'up') landing.go.focus({ preventScroll: true });
        if (action === 'confirm') {
          const focused = document.activeElement;
          if (focused instanceof HTMLButtonElement && landing.node.contains(focused)) focused.click();
          else landing.go.click();
        }
        return true;
      }
      if (action === 'back') { if (step > 0) { goStep(step - 1); return true; } return false; }
      if (action === 'confirm') {
        const focused = document.activeElement as HTMLElement | null;
        if (focused && (focused === addPlayer || focused === removePlayer || focused.parentElement === extras
          || focused === back)) { focused.click(); return true; }
        if (go.disabled) return false; advance(); return true;
      }
      const vertical = action === 'up' || action === 'down';
      const delta = action === 'up' || action === 'left' ? -1
        : action === 'down' || action === 'right' ? 1 : 0;
      if (!delta) return false;
      if (step === 0) {
        routeFocus = (routeFocus + delta + routes.length) % Math.max(1, routes.length);
        select(routeFocus);
        const card = list.children[routeFocus] as HTMLElement | undefined;
        card?.focus({ preventScroll: true });
        card?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        return true;
      }
      if (step === 2) {
        const next = ((player === 1 ? rightCarAt : carAt) + delta + CARS.length) % CARS.length;
        selectCar(next, player); return true;
      }
      // All racers share these five world conditions, including the combined AI choice.
      // Direction sits beside time on the first visible row, so up and down visit it second.
      if (vertical) rowAt = CONDITION_ROW_ORDER[(CONDITION_ROW_ORDER.indexOf(rowAt) + delta + 5) % 5]!;
      else if (rowAt === 0) {
        timeAt = (timeAt + delta + TIMES.length) % TIMES.length;
        timeChoice = TIMES[timeAt];
      }
      else if (rowAt === 1) weatherAt = (weatherAt + delta + WEATHERS.length) % WEATHERS.length;
      else if (rowAt === 2) slimeAt = (slimeAt + delta + SLIME_DENSITIES.length) % SLIME_DENSITIES.length;
      else if (rowAt === 3) direction = direction === 'forward' ? 'reverse' : 'forward';
      else selectAiOption(((ai ? difficultyAt + 1 : 0) + delta + AI_DIFFICULTIES.length + 1) % (AI_DIFFICULTIES.length + 1));
      if(!vertical&&rowAt!==3)worldPreviewFocus=rowAt===0?'time':rowAt===1?'weather':rowAt===2?'slimes':'ai';
      paint();
      [timeSeg, weatherSeg, slimeSeg, directionSeg, aiSeg][rowAt]
        ?.scrollIntoView?.({ block: 'nearest' });
      return true;
    },
  };
}
