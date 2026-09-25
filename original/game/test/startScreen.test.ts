import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18n } from '../src/ui/i18n';
import { startScreen, type StartChoice } from '../src/ui/StartScreen';
import type { MenuMap } from '../src/ui/menuMap';

it('enters the existing map from home without selecting a car or launching a race', () => {
  const { screen, started } = mount({ showHome: true });
  screen.reset(true);
  screen.setActive(true);
  expect(screen.node.dataset.home).toBe('true');
  expect((screen.node.querySelector('.sm-viewport') as HTMLElement).inert).toBe(true);
  screen.handle('confirm');
  expect(screen.node.dataset.home).toBe('false');
  expect(screen.node.dataset.step).toBe('0');
  expect(started).toEqual([]);
  screen.render(); expect(screen.node.dataset.home).toBe('false');
  screen.reset(); expect(screen.node.dataset.home).toBe('false');
  screen.dispose();
});

const previewState = vi.hoisted(() => ({ ready: true, changed: () => {} }));
vi.mock('../src/ui/GaragePreview', () => ({
  GaragePreview: class {
    constructor(_node: HTMLElement, _i18n: unknown, changed: () => void) { previewState.changed = changed; }
    get ready() { return previewState.ready; }
    show() {}
    dispose() {}
  },
}));
const line = (lon: number, lat: number): [number, number][] =>
  [[lon, lat], [lon + 0.01, lat + 0.01], [lon + 0.02, lat]];

const MAP: MenuMap = {
  version: 5,
  region: [37.15, -122.85, 38.25, -121.55],
  roads: [line(-122.4, 37.6)],
  places: [{ id: 'san-francisco', lon: -122.41, lat: 37.79 }],
  water: [[[-122.85, 38.0], [-122.5, 37.9], [-122.4, 37.5], [-122.85, 37.4], [-122.85, 38.0]]],
  land: [[[-122.44, 37.83], [-122.41, 37.83], [-122.42, 37.86], [-122.44, 37.83]]],
  routes: [
    { id: 'goldengate', km: 5.3, checkpoints: 10,
      line: line(-122.48, 37.81), streets: [{ class: 'b', line: line(-122.49, 37.80) }] },
    { id: 'shoreline', km: 1.7, checkpoints: 3,
      line: line(-122.08, 37.42), streets: [{ class: 'c', line: line(-122.09, 37.41) }] },
    { id: 'lombard', km: 2.3, checkpoints: 5,
      line: line(-122.42, 37.80), streets: [{ class: 'a', line: line(-122.43, 37.79) }] },
    // Outside the frame on purpose. No shipping track is that far south any more -- the Monterey
    // one went -- and the edge marker is a rule about the frame, not about that track.
    { id: 'far-south', km: 6.0, checkpoints: 10,
      line: line(-121.90, 36.61), streets: [] },
  ],
};

function mount(over: Partial<Parameters<typeof startScreen>[1]> = {}) {
  const started: StartChoice[] = [];
  const i18n = new I18n('zh');
  const screen = startScreen(i18n, {
    catalogue: () => MAP.routes.map((r) => ({ id: r.id })),
    playable: () => true,
    bestLabel: () => null,
    onStart: (c) => started.push(c),
    onSettings: () => {},
    onAbout: () => {},
    ...over,
  });
  document.body.replaceChildren(screen.node);
  screen.render();
  screen.setMap(MAP);
  return { screen, started, i18n, q: (sel: string) => [...screen.node.querySelectorAll(sel)] };
}

beforeEach(() => { document.body.replaceChildren(); previewState.ready = true; vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}}); });
afterEach(()=>vi.unstubAllGlobals());

it('reuses one route details entry across map loads and language refreshes',()=>{
 const {screen,i18n,q}=mount();screen.render();screen.setMap(MAP);i18n.set('en');screen.render();
 expect(q('.startup-route-details summary')).toHaveLength(0);
 expect(q('.startup-route-details[aria-label="Route details"]')).toHaveLength(1);
 expect(q('.startup-route-details .sm-stats')).toHaveLength(1);
});

describe('the map', () => {
  it('updates both garage speed displays when switching language', () => {
    const { screen, i18n, q } = mount();
    const metric = Number(q('.sm-cardesc')[0]!.textContent!.match(/(\d+) km\/h/)![1]);
    i18n.set('en'); screen.render();
    expect(q('.sm-cardesc')[0]!.textContent).toBe(`AWD · ${Math.round(metric / 1.609344)} mph`);
    expect(q('.sm-barval')[0]!.textContent).toMatch(/\d+ mph/);
    expect(q('.sm-cardesc').every(n => n.textContent!.endsWith(' mph'))).toBe(true);
    i18n.set('zh'); screen.render();
    expect(q('.sm-cardesc')[0]!.textContent).toBe(`四驱 · ${metric} km/h`);
  });
  it('draws the selected route as a lap, and the Bay only as a locator', () => {
    const { q } = mount();
    // The stage is the lap: one wide stroke for the road, one bright one for the line through it,
    // and a marker where it starts. This is the picture that says "racing game".
    expect(q('.sm-road')).toHaveLength(1);
    expect(q('.sm-line')).toHaveLength(1);
    expect(q('.sm-flag')).toHaveLength(1);
    expect(q('.sm-context')).toHaveLength(1);
    // The locator is the small round map: the routes inside the frame, the coast behind them.
    // far-south is 150 km below the Bay, so it is not drawn there at all -- it is still in the
    // list, which is now the control, so nothing about it is unreachable.
    expect(q('.sm-route')).toHaveLength(3);
    expect(q('.sm-coast').length).toBeGreaterThan(0);
    expect(q('.sm-item')).toHaveLength(4);
  });

  it('shows the car numbers the physics actually uses, and the summary before the start', () => {
    const { screen, q } = mount();
    screen.handle('confirm');                                             // world and summary
    expect(q('.startup-recap-step[data-k="route"]')[0]!.getAttribute('data-state')).toBe('done');
    expect(q('.startup-recap-step[data-k="world"]')[0]!.getAttribute('data-state')).toBe('on');
    expect(q('[data-time].on')).toHaveLength(1);
    expect(q('[data-weather].on')).toHaveLength(1);
    screen.handle('confirm');                                             // garage
    // Three bars, not four: weight is the one number where longer is worse, so it is a plain
    // figure beside the name rather than a bar that reads as "best".
    expect(q('.sm-bar')).toHaveLength(3);
    expect(q('.sm-barval')[0]!.textContent).toMatch(/\d+ km\/h/);
    expect(q('.sm-barval').some((n) => /^\d+ kg$/.test(n.textContent ?? ''))).toBe(false);
    expect(q('.sm-stat b').some((n) => n.textContent === '900 kg')).toBe(true);   // micro mass, with its unit (the mount is Chinese)
  });

  it('selects a route when its line is clicked, and only that one', () => {
    const { q } = mount();
    (q('.sm-route')[2] as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(q('.sm-route.sel')).toHaveLength(1);
    expect(q('.sm-item.sel')).toHaveLength(1);
  });

  it('lists every route beside the map, because a map is the wrong control for a keyboard', () => {
    const { q } = mount();
    expect(q('.sm-item')).toHaveLength(MAP.routes.length);
  });

  it('says what to run when there is no map, instead of showing an empty screen', () => {
    const { screen, q } = mount();
    screen.setMap(null);
    expect(q('.sm-route')).toHaveLength(0);
    expect(screen.node.querySelector('.sm-empty')!.textContent).toContain('sr.cli menu-map');
    expect((screen.node.querySelector('.sm-empty') as HTMLElement).hidden).toBe(false);
  });

  it('leaves out a route this build cannot play', () => {
    const { q } = mount({ playable: (id: string) => id !== 'lombard' });
    expect(q('.sm-item')).toHaveLength(3);
  });
});

describe('walking the three setup steps', () => {
  it('restores the complete previous start choice', () => {
    const { screen, q, started } = mount({
      initialChoice: () => ({ trackId: 'shoreline', direction: 'reverse', playerCount: 2,
        playerVehicles: ['sports-car', 'jeep'], timeOfDay: 'night', weather: 'rain', slimeDensity: 'many',
        ai: true, aiDifficulty: 'rush' }),
    });
    expect(q('.sm-item.sel')[0]!.getAttribute('data-track')).toBe('shoreline');
    screen.handle('confirm');                                             // world
    expect(q('.sm-car.sel')[0]!.getAttribute('data-vehicle')).toBe('sports-car');
    screen.handle('confirm');                                             // garage
    screen.handle('confirm', 0); screen.handle('confirm', 1); screen.handle('confirm');
    expect(started[0]).toMatchObject({ trackId: 'shoreline', direction: 'reverse',
      playerVehicles: ['sports-car', 'jeep'], timeOfDay: 'night', weather: 'rain', slimeDensity: 'many', ai: true,
      aiDifficulty: 'rush' });
  });

  it('returns pending step focus after loading without taking it from another control', () => {
    const { screen } = mount();
    // ScreenStack supplies this programmatic focus target in the application.
    screen.node.tabIndex = -1;
    screen.setActive(true);
    screen.handle('confirm');
    previewState.ready = false;
    const go = screen.node.querySelector<HTMLButtonElement>('.sm-go')!;
    go.click();
    expect(document.activeElement).toBe(screen.node);
    previewState.ready = true; previewState.changed();
    expect(document.activeElement).toBe(go);
    screen.handle('back');
    previewState.ready = false; go.click();
    const car = screen.node.querySelector<HTMLButtonElement>('.sm-car')!;
    car.focus();
    previewState.ready = true; previewState.changed();
    expect(document.activeElement).toBe(car);
  });
  it('resolves the real route defaults, ignores stale responses, and retains per-route drafts', async () => {
    const pending = new Map<string, (value: { vehicleId: string; timeOfDay: 'day' | 'night' }) => void>();
    const { screen, q, started } = mount({ defaults: id => new Promise(resolve => pending.set(id, resolve)) });
    // Reading the track's recommended car may continue while the player enters the world step.
    expect((q('.sm-go')[0] as HTMLButtonElement).disabled).toBe(false);
    (q('.sm-item')[1] as HTMLElement).click();
    pending.get('shoreline')!({ vehicleId: 'school-bus', timeOfDay: 'day' });
    await Promise.resolve();
    pending.get('goldengate')!({ vehicleId: 'jeep', timeOfDay: 'night' });
    await Promise.resolve();
    expect(q('.sm-car.sel')[0]?.getAttribute('data-vehicle')).toBe('school-bus');
    screen.handle('confirm');
    expect((q('.sm-pane')[0] as HTMLElement).inert).toBe(true);
    expect((q('.sm-pane')[1] as HTMLElement).inert).toBe(false);
    (q('[data-vehicle="retro-van"]')[0] as HTMLElement).click();
    screen.handle('back');
    screen.handle('confirm'); screen.handle('confirm'); screen.handle('confirm');
    expect(started[0]).toMatchObject({ trackId: 'shoreline', vehicleId: 'retro-van', timeOfDay: 'day' });
  });

  it('keeps explicit time and density when going back and changing the route', () => {
    const { screen, q, started } = mount();
    screen.handle('confirm');
    (q('[data-time="night"]')[0] as HTMLElement).click();
    (q('[data-slime-density="none"]')[0] as HTMLElement).click();
    screen.handle('back');
    (q('.sm-item')[2] as HTMLElement).click();
    screen.handle('confirm'); screen.handle('confirm'); screen.handle('confirm');
    expect(started[0]).toMatchObject({ trackId: 'lombard', timeOfDay: 'night', slimeDensity: 'none' });
  });

  it('refreshes device or language copy without jumping out of the current page', () => {
    const { screen } = mount();
    screen.handle('confirm');
    screen.render();
    expect(screen.node.dataset.step).toBe('1');
    screen.reset();
    expect(screen.node.dataset.step).toBe('0');
  });

  it('keeps a prepared race confirmable during an input-device render', async () => {
    const defaults = vi.fn(async () => ({ vehicleId: 'jeep', timeOfDay: 'day' as const }));
    const { screen, started, q } = mount({ defaults });
    await Promise.resolve();
    screen.handle('confirm'); screen.handle('confirm');
    const requests = defaults.mock.calls.length;
    screen.render();
    expect(defaults).toHaveBeenCalledTimes(requests);
    expect((q('.sm-go')[0] as HTMLButtonElement).disabled).toBe(false);
    screen.handle('confirm');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ vehicleId: 'jeep', trackId: 'goldengate' });
  });

  const go = (screen: ReturnType<typeof mount>['screen']) =>
    (screen.node.querySelector('.sm-go') as HTMLButtonElement).click();

  it('hands back the route, car, time and independent weather that were picked', () => {
    const { screen, started, q } = mount();
    (q('.sm-item')[1] as HTMLElement).click();       // shoreline
    go(screen);                                                   // world
    (q('[data-time="night"]')[0] as HTMLElement).click();
    (q('[data-weather="fog"]')[0] as HTMLElement).click();
    go(screen);                                                   // garage
    (q('[data-vehicle="pickup-travel-trailer"]')[0] as HTMLElement).click();
    expect(q('.sm-stat b').some(n => n.textContent === '2500 kg')).toBe(true);
    expect(q('.sm-barval')[1]!.textContent).toBe('4 N/kg');
    go(screen);
    expect(started).toEqual([{ direction: 'forward', trackId: 'shoreline', vehicleId: 'pickup-travel-trailer', timeOfDay: 'night',
      weather: 'fog', slimeDensity: 'many', ai: true, aiDifficulty: 'relaxed' }]);
  });

  it('offers none, normal and many as a gameplay density independent of quality', () => {
    const { screen, started, q } = mount();
    go(screen);
    expect(q('[data-slime-density]').map((node) => node.textContent))
      .toEqual(['无', '普通', '很多']);
    // 'many' is already lit for a new player, so picking 'normal' is the choice that has to stick.
    expect(q('[data-slime-density="many"]')[0]!.classList.contains('on')).toBe(true);
    (q('[data-slime-density="normal"]')[0] as HTMLElement).click();
    go(screen); go(screen);
    expect(started[0]!.slimeDensity).toBe('normal');
  });

  it('offers every weather independently and starts from the saved weather', () => {
    const { screen, started, q } = mount({ initialWeather: 'snow' });
    go(screen);
    expect(q('[data-weather]').map((node) => node.textContent)).toEqual(['晴天', '大雾', '雷雨', '雪天']);
    go(screen); go(screen);
    expect(started[0]!.weather).toBe('snow');
  });

  it('changes the chase preview with real world choices and only promises a first-ever ghost', () => {
    const { screen, q } = mount({ bestLabel: () => null, ghostAvailable: () => false });
    (q('.sm-item')[1] as HTMLElement).click();
    go(screen);
    const preview = q('.sm-world-preview')[0] as HTMLElement;
    const shot = preview.querySelector<HTMLImageElement>('.sm-world-shot')!;
    expect(preview.dataset).toMatchObject({worldTime:'day', worldWeather:'clear', worldSlimes:'many',
      worldDirection:'forward', worldAi:'true'});
    (q('[data-time="night"]')[0] as HTMLElement).click();
    expect(shot.src).toMatch(/\/menu\/world\/[a-z0-9-]+\/night-clear\.webp$/);
    (q('[data-weather="rain"]')[0] as HTMLElement).click();
    expect(shot.src).toMatch(/\/menu\/world\/[a-z0-9-]+\/night-rain\.webp$/);
    (q('[data-slime-density="many"]')[0] as HTMLElement).click();
    expect(shot.src).toMatch(/\/menu\/world\/[a-z0-9-]+\/slimes-many\.webp$/);
    (q('[data-direction="reverse"]')[0] as HTMLElement).click();
    expect(preview.dataset.worldDirection).toBe('reverse');
    expect(q('[data-direction="reverse"]')[0]!.classList.contains('on')).toBe(true);
    expect(q('.sm-direction-cue')).toHaveLength(0);
    (q('[data-ai-mode="relaxed"]')[0] as HTMLElement).click();
    expect(shot.src).toMatch(/\/menu\/world\/[a-z0-9-]+\/ai-relaxed\.webp$/);
    (q('[data-ai-mode="rush"]')[0] as HTMLElement).click();
    expect(shot.src).toMatch(/\/menu\/world\/[a-z0-9-]+\/ai-rush\.webp$/);
    expect(preview.dataset).toMatchObject({worldTime:'night', worldWeather:'rain', worldSlimes:'many',
      worldDirection:'reverse', worldAi:'true'});
    expect((q('.sm-ghost-hint')[0] as HTMLElement).hidden).toBe(false);
    screen.dispose();
    const legacy = mount({ bestLabel: () => '1:00.00', ghostAvailable: () => false });
    (legacy.q('.sm-item')[1] as HTMLElement).click();
    go(legacy.screen);
    expect((legacy.q('.sm-ghost-hint')[0] as HTMLElement).hidden).toBe(true);
  });

  it('starts from the persisted clear-road choice instead of silently turning slimes back on', () => {
    const { screen, started } = mount({ initialSlimeDensity: 'none' });
    go(screen); go(screen); go(screen);
    expect(started[0]!.slimeDensity).toBe('none');
  });

  it('goes back a step without losing what was already chosen', () => {
    const { screen, started, q } = mount();
    (q('.sm-item')[2] as HTMLElement).click();
    go(screen); go(screen);
    (q('.sm-car')[0] as HTMLElement).click();
    (screen.node.querySelector('.sm-back') as HTMLButtonElement).click();
    go(screen); go(screen);   // back to garage, then start
    expect(started[0]).toMatchObject({ trackId: 'lombard', vehicleId: 'micro-hatch' });
  });

  it('will not start before a route is chosen', () => {
    const { screen } = mount({ playable: () => false });
    expect((screen.node.querySelector('.sm-go') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('keyboard and gamepad', () => {
  it('gets from the map to the road without a pointer', () => {
    const { screen, started } = mount();
    screen.handle('down');            // second route
    screen.handle('confirm');         // -> world
    screen.handle('right');           // night
    screen.handle('down');            // direction, beside time on the first row
    screen.handle('down');            // second row: weather
    screen.handle('down');            // third row: obstacles
    screen.handle('left');            // many -> normal
    screen.handle('left');            // normal -> none
    screen.handle('confirm');         // -> garage
    screen.handle('right');           // next car
    screen.handle('confirm');         // start engine
    expect(started).toEqual([{ direction: 'forward', trackId: 'shoreline', vehicleId: 'sports-car', timeOfDay: 'night',
      weather: 'clear', slimeDensity: 'none', ai: true, aiDifficulty: 'relaxed' }]);
  });

  it('takes back out of a step rather than out of the game', () => {
    const { screen } = mount();
    expect(screen.handle('back')).toBe(false);   // nothing to back out of on the first step
    screen.handle('confirm');
    expect(screen.handle('back')).toBe(true);
  });
});


describe('a friend\'s challenge', () => {
  it('opens on the challenged route and direction, keeps an open challenged car, and says what to beat', () => {
    let dare: import('../src/app/Challenge').Challenge | null = { trackId: 'lombard', direction: 'reverse', time: 95.4, rating: 4,
      score: 8200, vehicleId: 'micro-hatch', name: 'Ada' };
    const { screen, q, started } = mount({
      initialChoice: () => ({ trackId: 'shoreline', direction: 'forward', playerCount: 1, playerVehicles: ['jeep'],
        timeOfDay: 'day', weather: 'clear', slimeDensity: 'many', ai: false, aiDifficulty: 'relaxed' }),
      challenge: () => dare,
      onChallengeDismiss: () => { dare = null; },
    });
    screen.reset(); screen.render();
    expect(q('.sm-item.sel')[0]!.getAttribute('data-track')).toBe('lombard');
    const banner = q('.sm-challenge')[0] as HTMLElement;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('Ada'); expect(banner.textContent).toContain('1:35.40');
    expect(banner.textContent).toContain('★★★★☆');
    (q('.sm-challenge-accept')[0] as HTMLElement).click();                  // one press from the route step
    expect(started[0]).toMatchObject({ trackId: 'lombard', direction: 'reverse', vehicleId: 'micro-hatch' });
    (q('.sm-challenge-dismiss')[0] as HTMLElement).click();
    expect((q('.sm-challenge')[0] as HTMLElement).hidden).toBe(true);
  });

  it('keeps an open dared car on a new save once the route defaults arrive, and never pulls back after the first time', async () => {
    const dare = { trackId: 'lombard', direction: 'forward' as const, time: 95.4, rating: 4 as const, score: 8200, vehicleId: 'jeep' };
    const { screen, q, started } = mount({
      challenge: () => dare,
      defaults: async () => ({ vehicleId: 'micro-hatch', timeOfDay: 'day' as const }),
    });
    screen.reset(); screen.render();
    screen.setMap(MAP);                                  // the menu map arrives after the reset, as in the game
    await new Promise(done => setTimeout(done, 0));
    (q('.sm-challenge-accept')[0] as HTMLElement).click();
    expect(started[0], 'the dared jeep, not the route default').toMatchObject({ trackId: 'lombard', vehicleId: 'jeep' });
    // Choosing another route hides the dare: its button would start that route and never compare.
    const other = q('.sm-item').find(item => item.getAttribute('data-track') !== 'lombard') as HTMLElement;
    other.click(); screen.render();
    expect((q('.sm-challenge')[0] as HTMLElement).hidden).toBe(true);
    // Back at the menu later, the player's route stays; the dare does not drag the choice back.
    const chosenRoute = q('.sm-item.sel')[0]!.getAttribute('data-track');
    screen.reset(); screen.render();
    expect(q('.sm-item.sel')[0]!.getAttribute('data-track')).toBe(chosenRoute);
  });

  it('takes the challenged car, since every car is open', () => {
    const { screen, q, started } = mount({
      challenge: () => ({ trackId: 'shoreline', direction: 'forward', time: 80, rating: 2, score: 10, vehicleId: 'sports-car' }),
    });
    screen.reset(); screen.render();
    screen.handle('confirm'); screen.handle('confirm'); screen.handle('confirm');
    expect(started[0]!.trackId).toBe('shoreline');
    expect(started[0]!.vehicleId).toBe('sports-car');
    const banner = (q('.sm-challenge')[0] as HTMLElement).textContent!, zh = new I18n('zh');
    expect(banner).toContain(zh.t('challenge.someone'));
    // Cars differ in pace: the dare names its car.
    expect(banner).toContain(zh.t('car.sports-car.name'));
    expect((q('.sm-challenge-thumb')[0] as HTMLImageElement).src, 'a picture of the dared car').toContain('garage/sports-car.webp');
  });
});

describe('shared world and independent player choices', () => {
  it('starts two players with one confirm and preserves each player identity', () => {
    const { screen, started, q } = mount();
    screen.handle('confirm');
    (q('[data-ai-mode="rush"]')[0] as HTMLElement).click();
    screen.handle('confirm');
    (q('[data-players="2"]')[0] as HTMLElement).click();
    expect(screen.playerCount).toBe(2);
    screen.handle('right', 0); screen.handle('right', 1); screen.handle('right', 1);
    expect(q('.startup-recap-step[data-k="car"]')[0]!.getAttribute('data-state')).toBe('on');
    expect(q('.sm-confirm,[data-browse]')).toHaveLength(0);
    screen.handle('right', 0);
    screen.handle('confirm', 1);
    expect(started[0]).toMatchObject({ playerVehicles: ['lightweight-sports', 'school-bus'], // catalogue order
      ai: true, aiDifficulty: 'rush' });
    screen.reset(); screen.handle('confirm'); screen.handle('confirm');
    (q('[data-players="1"]')[0] as HTMLElement).click();
    screen.handle('confirm');
    expect(started[1]!.playerVehicles).toBeUndefined();
  });

  it('keeps the second choice out of the first player garage and updates all translated options', () => {
    const { screen, started, q, i18n } = mount({ initialAiDifficulty: 'relaxed' });
    screen.handle('confirm'); screen.handle('confirm');
    (q('[data-players="2"]')[0] as HTMLElement).click();
    screen.handle('right', 1); screen.handle('confirm', 1);
    expect(started[0]).toMatchObject({ vehicleId: 'micro-hatch', playerVehicles: ['micro-hatch', 'monster-truck'], aiDifficulty: 'relaxed' });
    i18n.set('en'); screen.render();
    expect(q('.startup-remove-player')[0]!.textContent).toBe('Remove 2P');
    expect(q('[data-ai-mode="relaxed"]')[0]!.textContent).toBe('Easy');
    expect(q('.startup-driver-row h3').map(n => (n as HTMLElement).title).join(' ')).toContain('WASD to choose');
  });
});

it('selects direction by button or keyboard and reads the matching record', () => {
  const bestLabel=vi.fn(()=>'1:00.00');
  const {screen,q,started,i18n}=mount({bestLabel});
  screen.handle('confirm');
  (q('[data-direction=reverse]')[0] as HTMLElement).click();
  expect(bestLabel).toHaveBeenLastCalledWith('goldengate','reverse','micro-hatch');
  screen.handle('confirm'); screen.handle('confirm');
  expect(started[0]!.direction).toBe('reverse');
  i18n.set('en');screen.reset();screen.render();
  expect(q('[data-direction=reverse]')[0]!.textContent).toBe('Reverse');
  screen.handle('confirm');
  screen.handle('down');screen.handle('right');   // direction is the second keyboard stop, beside time
  screen.handle('confirm'); screen.handle('confirm');
  expect(started[1]!.direction).toBe('forward');
});

it.each(['none','relaxed','rush'] as const)('one AI choice %s sets the roster options without a separate difficulty group', option => {
  const {screen,q,started}=mount();screen.handle('confirm');
  expect(q('[data-ai-mode]')).toHaveLength(3);
  expect(q('[data-ai],[data-difficulty]')).toHaveLength(0);
  (q(`[data-ai-mode="${option}"]`)[0] as HTMLButtonElement).click();
  expect(q('[data-ai-mode][aria-pressed="true"]')).toHaveLength(1);
  expect(q('[data-ai-mode][aria-pressed="true"]')[0]!.getAttribute('data-ai-mode')).toBe(option);
  screen.handle('confirm');screen.handle('confirm');
  expect(started[0]).toMatchObject({ai:option!=='none',aiDifficulty:option==='none'?'relaxed':option});
});
it('keyboard cycles all three AI choices and wraps without an extra difficulty row',()=>{
  const {screen,q}=mount();screen.handle('confirm');
  for(let i=0;i<4;i++)screen.handle('down');
  for(const option of ['rush','none','relaxed']){   // The default starts on relaxed
    screen.handle('right');expect(q('[data-ai-mode][aria-pressed="true"]')[0]!.getAttribute('data-ai-mode')).toBe(option);
  }
  screen.handle('left');expect(q('[data-ai-mode][aria-pressed="true"]')[0]!.getAttribute('data-ai-mode')).toBe('none');
  screen.handle('down');expect(q('.sm-ai-options.row')).toHaveLength(0);
  screen.handle('up');expect(q('.sm-ai-options.row')).toHaveLength(1);
});


it('adds and removes 2P in Garage without losing the first driver choice',()=>{
 const {screen,q,started}=mount();screen.handle('confirm');screen.handle('confirm');
 expect(q('.sm-pane')).toHaveLength(3);expect(q('.sm-players')).toHaveLength(0);
 expect(q('.sm-rail')).toHaveLength(0);expect(q('.startup-recap-step[data-state="on"] small')[0]!.textContent).toBe('03 车库');
 (q('[data-vehicle="jeep"]')[0] as HTMLElement).click();
 (q('.startup-add-player')[0] as HTMLElement).click();
 expect(q('.sm-car.sel').map(n=>n.getAttribute('data-vehicle'))).toEqual(['jeep','micro-hatch']);
 expect(q('.startup-garage-header .startup-remove-player')).toHaveLength(1);
 const remove=q('.startup-remove-player')[0] as HTMLButtonElement;remove.focus();screen.handle('confirm');
 expect(screen.playerCount).toBe(1);
 expect(q('.sm-car.sel')[0]!.getAttribute('data-vehicle')).toBe('jeep');
 const add=q('.startup-add-player')[0] as HTMLButtonElement;add.focus();screen.handle('confirm');
 expect(screen.playerCount).toBe(2);
 (q('.startup-remove-player')[0] as HTMLButtonElement).click();screen.handle('confirm');
 expect(started).toHaveLength(1);expect(started[0]).toMatchObject({vehicleId:'jeep'});expect(started[0]!.playerVehicles).toBeUndefined();
});
it('chooses a different second car and never joins from an ordinary arrow key',()=>{
 const {screen,q}=mount();
 screen.handle('confirm');screen.handle('confirm');screen.handle('right');expect(screen.playerCount).toBe(1);
 (q('.startup-add-player')[0] as HTMLElement).click();
 expect(q('.sm-car.sel').map(n=>n.getAttribute('data-vehicle'))).toEqual(['sports-car','micro-hatch']);
});
it('has no join control on a tablet, including when restoring a desktop two-player save',()=>{
 vi.stubGlobal('navigator',{userAgent:'iPad',platform:'MacIntel',maxTouchPoints:5});
 const {screen,q}=mount({initialChoice:()=>({trackId:'shoreline',direction:'forward',playerCount:2,
 playerVehicles:['jeep','sports-car'],timeOfDay:'day',weather:'clear',slimeDensity:'many',ai:false,aiDifficulty:'relaxed'})});
 screen.handle('confirm');screen.handle('confirm');expect(screen.playerCount).toBe(1);
 expect(q('.startup-add-player,.startup-remove-player')).toHaveLength(0);
});

it('lists every world condition in the right-hand column with no fold, and names AI levels plainly', () => {
  const { screen, i18n, q } = mount();
  screen.handle('confirm');
  expect(q('.startup-world-more, .sm-conditions details')).toHaveLength(0);
  expect(q('.sm-conditions > .sm-condition').map(node => (node as HTMLElement).dataset.condition))
    .toEqual(['start.departure', 'start.weather', 'start.slimes', 'start.ai']);
  expect(q('[data-ai-mode]').map(node => node.textContent)).toEqual(['没有 AI', '简单', '困难']);
  i18n.set('en'); screen.render();
  expect(q('[data-ai-mode]').map(node => node.textContent)).toEqual(['No AI', 'Easy', 'Hard']);
  expect(q('[data-ai-mode]').some(node => /Low|Medium|High/.test(node.textContent ?? ''))).toBe(false);
});

it('keeps the menu wordmark visible and translates its accessible name with the header switch', () => {
  const { screen, i18n, q } = mount();
  expect(q('.sm-name .brand-mark')).toHaveLength(1);
  expect((q('.sm-name')[0] as HTMLElement).textContent).toBe('Silicon Slime Rush');
  expect(q('.sm-name')[0]!.getAttribute('aria-label')).toBe('史莱姆赛车：硅谷');
  const toggle = q('.sm-stage > .language')[0] as HTMLElement;
  expect(toggle.classList.contains('lang-toggle')).toBe(true);
  expect(toggle.querySelector('.lang-option.on')!.textContent).toBe('中文');
  i18n.set('en'); screen.render();
  expect((q('.sm-name')[0] as HTMLElement).textContent).toBe('Silicon Slime Rush');
  expect(q('.sm-name')[0]!.getAttribute('aria-label')).toBe('SILICON SLIME RUSH');
  expect(toggle.querySelector('.lang-option.on')!.textContent).toBe('EN');
});

describe('quick race from the home page', () => {
  it('starts the last race in one press and says what it will start', () => {
    const { screen, q, started, i18n } = mount({
      showHome: true,
      initialChoice: () => ({ trackId: 'lombard', direction: 'reverse', playerCount: 1, playerVehicles: ['jeep'],
        timeOfDay: 'night', weather: 'rain', slimeDensity: 'many', ai: true, aiDifficulty: 'rush' }),
    });
    screen.reset(true); screen.render();
    const quick = q('.home-quick')[0] as HTMLButtonElement;
    expect(quick.hidden).toBe(false);
    expect(quick.textContent).toContain(i18n.t('home.quick'));
    expect(quick.textContent).toContain(i18n.t('car.jeep.name'));
    quick.click();
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ trackId: 'lombard', direction: 'reverse', vehicleId: 'jeep', timeOfDay: 'night',
      weather: 'rain', ai: true, aiDifficulty: 'rush' });
  });

  it('gives a first visit the route defaults (the Sedan, from the game) with the route time, and waits for them', async () => {
    let arrive: (value: { vehicleId: string; timeOfDay: 'night' }) => void = () => {};
    const { screen, q, started, i18n } = mount({ showHome: true,
      defaults: () => new Promise(done => { arrive = done; }) });
    screen.reset(true); screen.render();
    const quick = q('.home-quick')[0] as HTMLButtonElement;
    expect(quick.disabled, 'the route defaults are still loading').toBe(true);
    quick.click();
    expect(started).toHaveLength(0);
    arrive({ vehicleId: 'micro-hatch', timeOfDay: 'night' });
    await new Promise(done => setTimeout(done, 0));
    expect(quick.disabled).toBe(false);
    expect(quick.textContent).toContain(i18n.t('car.micro-hatch.name'));
    // A pad gets there with down.
    screen.handle('down'); expect(document.activeElement).toBe(quick);
    screen.handle('confirm');
    expect(started[0]).toMatchObject({ trackId: MAP.routes[0]!.id, direction: 'forward', vehicleId: 'micro-hatch', timeOfDay: 'night' });
  });

  it('shows the same default car in the three steps as the home press, and drives a car picked there', async () => {
    const { screen, q, started, i18n } = mount({ showHome: true,
      defaults: async () => ({ vehicleId: 'micro-hatch', timeOfDay: 'day' as const }) });
    screen.reset(true); screen.render();
    await new Promise(done => setTimeout(done, 0));
    expect((q('.home-quick')[0] as HTMLButtonElement).textContent).toContain(i18n.t('car.micro-hatch.name'));
    (q('.home-go')[0] as HTMLElement).click();
    screen.handle('confirm'); screen.handle('confirm');
    expect(q('.sm-car.sel')[0]?.getAttribute('data-vehicle'), 'the same car the home press offers').toBe('micro-hatch');
    (q('[data-vehicle="school-bus"]')[0] as HTMLElement).click();
    screen.reset(true); screen.render();
    const quick = q('.home-quick')[0] as HTMLButtonElement;
    expect(quick.textContent).toContain(i18n.t('car.school-bus.name'));
    quick.click();
    expect(started[0]).toMatchObject({ trackId: MAP.routes[0]!.id, vehicleId: 'school-bus' });
  });

  it('keeps a pair set up in the garage as the pair it was', async () => {
    const { screen, q, started } = mount({ showHome: true,
      defaults: async () => ({ vehicleId: 'micro-hatch', timeOfDay: 'day' as const }) });
    screen.reset(true); screen.render();
    await new Promise(done => setTimeout(done, 0));
    (q('.home-go')[0] as HTMLElement).click();
    screen.handle('confirm'); screen.handle('confirm');
    (q('[data-players="2"]')[0] as HTMLElement).click();
    const shown = q('.sm-car.sel').map(n => n.getAttribute('data-vehicle'));
    screen.reset(true); screen.render();
    (q('.home-quick')[0] as HTMLButtonElement).click();
    expect(started[0]!.playerVehicles).toEqual(shown);
  });
});
