import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Screens, MenuList } from '../src/ui/Ui';
import { ListView, introScreen, hudScreen, playerHudScreen, resultsScreen, type HudState } from '../src/ui/screens';
import { I18n } from '../src/ui/i18n';
import example from '../../pipeline/sr/schema/examples/minimal.track.json' with { type: 'json' };
import type { TrackData } from '../src/track/types';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  const root = document.createElement('div'); document.body.append(root);
  const screens = new Screens(root, new I18n('en'));
  const menu = document.createElement('div'); menu.innerHTML = '<button class="sm-go">Drive</button>';
  const pause = document.createElement('div'); pause.innerHTML = '<button>Language</button><button aria-selected="true">Resume</button>';
  screens.register('menu', menu); screens.register('pause', pause);
  return { root, screens, menu, pause };
}
it('rapid screen changes leave only the latest page interactive and focused', async () => {
  const { screens, menu, pause } = setup();
  screens.show('menu'); screens.show('pause'); screens.show('menu'); await Promise.resolve();
  expect(menu.hidden).toBe(false); expect(menu.inert).toBe(false);
  expect(pause.hidden).toBe(true); expect(pause.inert).toBe(true);
  expect(document.activeElement).toBe(menu.firstElementChild);
});
it('focuses the selected pause action ahead of the header language button', async () => {
  const { screens, pause } = setup();
  screens.show('pause'); await Promise.resolve();
  expect(document.activeElement).toBe(pause.querySelector('[aria-selected="true"]'));
});
it('does not move focus out of a blocking device overlay', async () => {
  const { root, screens } = setup(); const guard = document.createElement('button'); document.body.append(guard);
  guard.focus(); root.inert = true; screens.show('pause'); await Promise.resolve();
  expect(document.activeElement).toBe(guard);
});
it('keeps the settings backdrop visible but inert, then restores it on return', () => {
  const { screens, menu } = setup(); const settings = document.createElement('section');
  screens.register('settings', settings); screens.show('menu'); screens.show('settings', 'menu');
  expect(menu.hidden).toBe(false); expect(menu.inert).toBe(true);
  expect(settings.hidden).toBe(false); expect(settings.inert).toBe(false);
  screens.show('menu'); expect(menu.inert).toBe(false); expect(settings.hidden).toBe(true);
});
it('a focused button consumes Enter once without leaking a second game action', async () => {
  const { screens, menu } = setup(); screens.show('menu'); await Promise.resolve();
  const click = vi.fn(); const leaked = vi.fn(); menu.firstElementChild!.addEventListener('click', click);
  window.addEventListener('keydown', leaked);
  for (const repeat of [false, true]) menu.firstElementChild!.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'Enter', bubbles: true, cancelable: true, repeat,
  }));
  window.removeEventListener('keydown', leaked);
  expect(click).toHaveBeenCalledTimes(1); expect(leaked).not.toHaveBeenCalled();
});
it('keyboard focus and list selection agree, and a disabled row cannot activate', async () => {
  const list = new MenuList([{ id: 'resume', label: 'Resume' }, { id: 'quit', label: 'Quit' },
    { id: 'locked', label: 'Locked', disabled: true }]);
  const pick = vi.fn(); const view = new ListView(list, pick); document.body.append(view.node); view.render();
  const rows = view.node.querySelectorAll('button'); rows.forEach(row => { row.scrollIntoView = vi.fn(); }); rows[1]!.focus();
  expect(list.current?.id).toBe('quit'); list.move(-1); view.render();
  expect(document.activeElement).toBe(rows[0]); rows[2]!.click(); expect(pick).not.toHaveBeenCalled();
  await Promise.resolve();
});
it('intro starts only through its explicit action and can return independently', () => {
  const start = vi.fn(); const back = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const intro = introScreen(new I18n('en'), () => ({ track: example as TrackData, 
    best: null, device: 'keyboard' }), start, back, vi.fn());
  document.body.append(intro.node); intro.render(); intro.node.click(); expect(start).not.toHaveBeenCalled();
  const buttons = intro.node.querySelectorAll('button'); buttons[0]!.click(); buttons[1]!.click();
  expect(start).toHaveBeenCalledTimes(1); expect(back).toHaveBeenCalledTimes(1);
});

it('keeps placeholder focus while the menu primary action is still loading', async () => {
  const { screens, menu } = setup();
  (menu.firstElementChild as HTMLButtonElement).disabled = true;
  menu.append(document.createElement('button'));
  screens.show('menu'); await Promise.resolve();
  expect(document.activeElement).toBe(menu);
});

it('switches the live HUD speed value together with its language unit', () => {
  const i18n = new I18n('en');
  const state: HudState = {
    score: 0, slimeHits: 0, scoreAwards: [], reducedMotion: false, time: 0, speedKmh: 100, checkpoint: 1, checkpoints: 4, lap: 1, laps: 1,
    wrongWay: false, notice: '', alert: '', countdown: '', device: 'keyboard',
    route: null, view: { x: 0, z: 0, headingX: 0, headingZ: 1, s: 0 },
  };
  const hud = hudScreen(i18n, () => state, () => {});
  hud.render(); expect(hud.node.querySelector('.hud-speed-line')!.textContent).toBe('62mph');
  i18n.set('zh'); hud.render();
  expect(hud.node.querySelector('.hud-speed-line')!.textContent).toBe('100km/h');
});

it('shows roadside rescue over wrong-way advice as a warning', () => {
  const state: HudState = {
    score: 0, slimeHits: 0, scoreAwards: [], reducedMotion: false, time: 0,
    speedKmh: 20, checkpoint: 0, checkpoints: 4, lap: 1, laps: 1,
    wrongWay: true, rescueWarning: true, notice: 'Off route — roadside rescue is almost here',
    alert: '', countdown: '', device: 'keyboard', route: null,
    view: { x: 0, z: 0, headingX: 0, headingZ: 1, s: 0 },
  };
  const hud = hudScreen(new I18n('en'), () => state, () => {});
  hud.render();
  expect(hud.node.querySelector('.hud-notice')!.textContent).toBe(state.notice);
  expect(hud.node.querySelector('.hud-notice')!.classList.contains('hud-warn')).toBe(true);
});


it('shows the live combo from the second slime in a chain and hides it when the chain lapses', () => {
  const state: HudState = {
    score: 450, slimeHits: 3, reducedMotion: true, time: 10,
    scoreAwards: [
      { id: 1, points: 100, total: 100, source: 'slime', combo: 1, at: 8 },
      { id: 2, points: 125, total: 225, source: 'slime', combo: 2, at: 9 },
      { id: 3, points: 225, total: 450, source: 'slime', combo: 3, at: 9.5 },
      { id: 4, points: 300, total: 750, source: 'clean-corner' },
    ],
    speedKmh: 60, checkpoint: 0, checkpoints: 4, lap: 1, laps: 1,
    wrongWay: false, rescueWarning: false, notice: '', alert: '', countdown: '', device: 'keyboard', route: null,
    view: { x: 0, z: 0, headingX: 0, headingZ: 1, s: 0 },
  };
  const hud = hudScreen(new I18n('en'), () => state, () => {});
  hud.render();
  const combo = hud.node.querySelector<HTMLElement>('.hud-combo')!;
  expect(combo.hidden).toBe(false);
  expect(combo.textContent).toBe('×3');
  expect(combo.dataset.tier).toBe('cool');
  state.time = 13.4; hud.render();
  expect(combo.hidden, 'still inside the 4 s window').toBe(false);
  state.time = 13.6; hud.render();
  expect(combo.hidden, 'the chain lapsed').toBe(true);
  state.scoreAwards = [{ id: 1, points: 100, total: 100, source: 'slime', combo: 1, at: 13 }]; state.time = 13.2; hud.render();
  expect(combo.hidden, 'a lone slime is not a combo').toBe(true);
  state.scoreAwards = [{ id: 1, points: 100, total: 100, source: 'slime', combo: 2, at: 13 }]; hud.render();
  expect(combo.hidden).toBe(false);
  state.finished = true; hud.render();
  expect(combo.hidden, 'a finished split-screen racer keeps a frozen clock; the combo must not hang').toBe(true);
});

it('renders the same score in the current language at finish', () => {
  const i18n = new I18n('en');
  const facts = { trackId: 'shoreline', time: 20, best: null, isBest: true,
    score: 1234, slimeHits: 6, achievements: ['slime-total-25'], newAchievements: ['no-rescue'],
    ghostNext: true,
    standings: [
      {id:'ai-jeep', role:'ai' as const, vehicleId:'jeep', finished:true, time:19},
      {id:'player-1', role:'human' as const, vehicleId:'sports-car', player:0, finished:true, time:20},
      {id:'ai-bus', role:'ai' as const, vehicleId:'school-bus', finished:false, time:null},
    ] };
  const screen = resultsScreen(i18n, () => facts, new MenuList([]), () => {});
  screen.render(); expect(screen.node.querySelector('.result-score')!.textContent).toBe('1234 points · 6 slimes');
  expect(screen.node.querySelector('.score-number span')!.textContent, 'the total carries corner points too').toBe('POINTS');
  i18n.set('zh'); screen.render();
  expect(screen.node.querySelector('.result-score')!.textContent).toBe('1234 分 · 撞到 6 只史莱姆');
  expect(screen.node.querySelector('.score-number span')!.textContent).toBe('得分');
  expect(screen.node.querySelector('.result-progress')!.textContent).toContain('不用拖车');
  expect([...screen.node.querySelectorAll('.result-standing-car')].map(node => node.textContent))
    .toEqual(['越野车', '高性能跑车', '校车']);
  expect(screen.node.querySelector('.result-standing-time')!.textContent).toBe('0:19.00');
  expect(screen.node.querySelector('.result-ghost')!.textContent).toContain('下次');
});

it('renders the exact bilingual Big Tech Rooftop name at finish', () => {
  const i18n = new I18n('en');
  const facts = { trackId: 'wolfe-pruneridge', time: 20, best: null,
    isBest: false, score: 0, slimeHits: 0 };
  const screen = resultsScreen(i18n, () => facts, new MenuList([]), () => {});
  screen.render();
  expect(screen.node.querySelector('.result-track')!.textContent).toBe('Big Tech Rooftop');
  i18n.set('zh'); screen.render();
  expect(screen.node.querySelector('.result-track')!.textContent).toBe('大厂楼顶');
});

it('reveals earned stars in order and skips the animation with reduced motion', () => {
  vi.useFakeTimers();
  const sound = vi.fn();
  const facts = { trackId: 'shoreline', time: 80, best: null, isBest: true,
    score: 1200, slimeHits: 4, rating: 3 as const, bestRating: 4 as const, maxCombo: 2,
    cleanCorners: 3, reducedMotion: false };
  const screen = resultsScreen(new I18n('en'), () => facts, new MenuList([]), () => {}, sound);
  screen.render();
  const stars = screen.node.querySelector('.result-stars')!;
  expect(stars.querySelectorAll('[data-revealed=true]')).toHaveLength(0);
  vi.advanceTimersByTime(0); expect(stars.querySelectorAll('[data-revealed=true]')).toHaveLength(1);
  vi.advanceTimersByTime(560); expect(stars.querySelectorAll('[data-revealed=true]')).toHaveLength(3);
  expect(sound).toHaveBeenCalledTimes(3);
  expect(screen.node.querySelector('.result-rating-meta')!.textContent)
    .toContain('Clean corners 3');
  screen.render(); vi.advanceTimersByTime(1000);
  expect(sound).toHaveBeenCalledTimes(3);
  expect(screen.node.querySelectorAll('.result-stars [data-revealed=true]')).toHaveLength(3);
  facts.reducedMotion = true; screen.render();
  expect(stars.isConnected).toBe(false);
  expect(screen.node.querySelectorAll('.result-stars [data-revealed=true]')).toHaveLength(3);
  vi.useRealTimers();
});

it('attaches only active player HUDs and keeps their values separate across mode changes', () => {
  const base: HudState = { score: 0, slimeHits: 0, scoreAwards: [], reducedMotion: false, time: 0, speedKmh: 100, checkpoint: 1,
    checkpoints: 4, lap: 1, laps: 1, wrongWay: false, notice: '', alert: '', countdown: '',
    device: 'keyboard', route: null, view: { x: 0, z: 0, headingX: 0, headingZ: 1, s: 0 } };
  let states = [base];
  const hud = playerHudScreen(new I18n('zh'), () => states, () => {});
  hud.render(); expect(hud.node.querySelectorAll('.hud-speed')).toHaveLength(1);
  states = [base, { ...base, speedKmh: 40, rpm: 5100, rpmFraction: .67, gear: 4, drive: 'fwd', score: 123 }]; hud.render();
  expect([...hud.node.querySelectorAll('.hud-speed-line')].map(node => node.textContent)).toEqual(['100km/h', '40km/h']);
  expect(hud.node.querySelector('[data-player="2"] .hud-power-line')!.textContent).toBe('G4前驱5.1k');
  expect((hud.node.querySelector('[data-player="2"] .hud-rev-fill') as HTMLElement).style.width).toBe('67%');
  expect(hud.node.querySelector('[data-player="2"] .hud-score')!.textContent).toContain('123');
  states = [base]; hud.render(); expect(hud.node.querySelectorAll('.hud-speed')).toHaveLength(1);
});

it('shows converging speed lines only for each player whose red rocket boost is active', () => {
  const base: HudState = { score: 0, slimeHits: 0, scoreAwards: [], reducedMotion: false, 
    time: 0, speedKmh: 220, checkpoint: 1, checkpoints: 4, lap: 1, laps: 1, wrongWay: false,
    notice: '', alert: '', countdown: '', device: 'keyboard', route: null,
    cameraFeedback: { mode: 'chase', speed: 1, boost: 0, shake: 0 },
    view: { x: 0, z: 0, headingX: 0, headingZ: 1, s: 0 } };
  let states = [base, { ...base, cameraFeedback: { mode: 'chase' as const, speed: 0, boost: .8, shake: 0 } }];
  const hud = playerHudScreen(new I18n('en'), () => states, () => {});
  hud.render();
  const feedback = hud.node.querySelectorAll<HTMLElement>('.camera-feedback');
  expect(feedback[0]!.style.getPropertyValue('--camera-feedback-opacity')).toBe('0.000');
  expect(feedback[1]!.style.getPropertyValue('--camera-feedback-opacity')).toBe('0.800');
  states = [{ ...base, cameraFeedback: { mode: 'chase', speed: 1, boost: 0, shake: 0 } }];
  hud.render();
  expect(hud.node.querySelector<HTMLElement>('.camera-feedback')!.style
    .getPropertyValue('--camera-feedback-opacity')).toBe('0.000');
});

it('keeps time and score together in the centre, announces a hit, then raises the score', () => {
  vi.useFakeTimers();
  const state: HudState = { score: 0, slimeHits: 0, scoreAwards: [], reducedMotion: false, time: 12.3, speedKmh: 40, checkpoint: 1,
    checkpoints: 4, lap: 1, laps: 1, wrongWay: false, notice: '', alert: '', countdown: '',
    device: 'keyboard', route: null, view: { x: 0, z: 0, headingX: 0, headingZ: 1, s: 0 } };
  const hud = hudScreen(new I18n('en'), () => state, () => {});
  hud.render();
  const board = hud.node.querySelector('.hud-scoreboard')!;
  expect(board.querySelector('.hud-time')!.textContent).toBe('0:12.30');
  expect(board.querySelector('.hud-score')!.textContent).toContain('0');
  state.score = 300; state.slimeHits = 1;
  state.scoreAwards = [{id: 1, points: 300, total: 300, source: 'slime'}]; hud.render();
  expect(board.querySelector('.hud-score-gain')!.textContent).toBe('+300');
  expect(board.querySelector('.hud-hits')!.textContent).toContain('1');
  expect(board.querySelector('.hud-score')!.textContent).toContain('0');
  vi.advanceTimersByTime(560);
  expect(board.querySelector('.hud-score')!.textContent).toContain('300');
  vi.useRealTimers();
});

it('plays every queued slime award once and reveals scores immediately with reduced motion', () => {
  vi.useFakeTimers();
  const state: HudState = { score: 0, slimeHits: 0, scoreAwards: [], reducedMotion: false, time: 0,
    speedKmh: 0, checkpoint: 0, checkpoints: 1, lap: 1, laps: 1, wrongWay: false, notice: '',
    alert: '', countdown: '', device: 'keyboard', route: null,
    view: { x: 0, z: 0, headingX: 0, headingZ: 1, s: 0 } };
  const hud = hudScreen(new I18n('en'), () => state, () => {}); hud.render();
  state.score = 500; state.scoreAwards = [{id:1, points:200, total:200, source:'slime'},
    {id:2, points:300, total:500, source:'clean-corner'}];
  hud.render(); hud.render();
  expect(hud.node.querySelector('.hud-score-gain')!.textContent).toBe('+200');
  vi.advanceTimersByTime(620);
  expect(hud.node.querySelector('.hud-score-gain')!.textContent).toBe('+300');
  vi.advanceTimersByTime(620); hud.render();
  expect(hud.node.querySelector('.hud-score')!.textContent).toContain('500');
  expect(hud.node.querySelector('.hud-score-gain')!.textContent).not.toBe('+0');
  state.reducedMotion = true; state.score = 900;
  state.scoreAwards = [...state.scoreAwards, {id:3, points:400, total:900, source:'slime'}]; hud.render();
  expect(hud.node.querySelector('.hud-score')!.textContent).toContain('900');
  vi.useRealTimers();
});


it('a menu that owns confirmation keeps both keyboard identities instead of clicking a focused car', () => {
  const root = document.createElement('div'), menu = document.createElement('div');
  const button = document.createElement('button'); menu.append(button); document.body.append(root);
  menu.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Enter') e.preventDefault(); });
  new Screens(root, new I18n('en')).register('menu', menu);
  const click = vi.fn(), sampled: string[] = [];
  button.addEventListener('click', click);
  const collect = (e: KeyboardEvent) => sampled.push(e.code);
  window.addEventListener('keydown', collect);
  for (const code of ['Space', 'Enter']) button.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
  window.removeEventListener('keydown', collect);
  expect(click).not.toHaveBeenCalled(); expect(sampled).toEqual(['Space', 'Enter']);
});


it('renders each live place, updates it on the next render and hides an uncontested place', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const base: HudState = { score: 0, slimeHits: 0, scoreAwards: [], reducedMotion: false, 
    time: 0, speedKmh: 0, checkpoint: 1, checkpoints: 2, lap: 1, laps: 1, wrongWay: false,
    notice: '', alert: '', countdown: '', device: 'keyboard', route: null,
    view: { x: 0, z: 0, headingX: 0, headingZ: -1, s: 0 } };
  let states = [{ ...base, standing: { rank: 2, total: 3 } }, { ...base, standing: { rank: 1, total: 3 } }];
  const hud = playerHudScreen(new I18n('en'), () => states, () => {});
  hud.render();
  expect([...hud.node.querySelectorAll('.hud-standing')].map(n => n.textContent)).toEqual(['Position 2 / 3', 'Position 1 / 3']);
  states[0]!.standing.rank = 1; states[1]!.standing.rank = 2; hud.render();
  expect(hud.node.querySelector('.hud-standing')!.textContent).toBe('Position 1 / 3');
  const solo = hudScreen(new I18n('zh'), () => base, () => {}); solo.render();
  expect((solo.node.querySelector('.hud-standing') as HTMLElement).hidden).toBe(true);
});

it('draws no rank badge over other cars while keeping the player standing', () => {
  const state: HudState = {
    score: 0, slimeHits: 0, scoreAwards: [], reducedMotion: false, time: 0, speedKmh: 90, checkpoint: 1, checkpoints: 4, lap: 1, laps: 1,
    wrongWay: false, notice: '', alert: '', countdown: '', device: 'keyboard',
    route: null, view: { x: 0, z: 0, headingX: 0, headingZ: 1, s: 0 },
    standing: { rank: 2, total: 3 },
    rivals: [{ id: 'ai-bus', x: 0, z: -30, rank: 1 }, { id: 'ai-jeep', x: 4, z: 10, rank: 3 }],
  };
  const hud = hudScreen(new I18n('en'), () => state, () => {});
  hud.render();
  expect(hud.node.querySelector('.hud-standing')!.textContent).toContain('2');
  expect(hud.node.querySelectorAll('.hud-rival, .hud-rivals')).toHaveLength(0);
  expect(hud.node.textContent).not.toMatch(/Position 1|Position 3/);
});
