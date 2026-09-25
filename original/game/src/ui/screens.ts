import type { MapRacer } from './RacerMarkers';
import type { RaceDirection } from '../track/Direction';
import type { Challenge } from '../app/Challenge';
import type { SlimeKind } from '../world/Slimes';
import { type StarRating } from '../track/Rating';
import { CREDITS } from './Credits';
import { creatorSocials } from './CreatorSocials';
import { renderBrandSignature } from './Replica';
import { isMobileDevice, steersWithButtons } from '../app/device';
import type { Commands } from '../input/types';
import { bindTouchButton, STEER_FULL_PX, type TouchStick } from '../input/Touch';
import type { DriveType } from '../physics/CarTuning';
import type { CameraFeedback, CameraMode } from '../world/ChaseCamera';
import { COMBO_WINDOW_SECONDS, formatTime, type ScoreAward } from '../track/Race';
import type { I18n } from './i18n';
import { MiniMap, type MiniMapRoute, type MiniMapView } from './MiniMap';
import { NavMap } from './NavMap';
export type { MiniMapRoute, MiniMapView } from './MiniMap';
import { MenuList, el, type MenuItem } from './Ui';
import { loadingBar } from './LoadingBar';
import { RouteDetails } from './RouteDetails';
import type { TrackData } from '../track/types';

/** A screen that owns a piece of DOM and knows how to redraw itself. */
export interface Screen {
  node: HTMLElement;
  render(): void;
  dispose?(): void;
}

export interface BootScreen extends Screen {
  /** Show the current loading operation, or clear it with null. */
  setStatus(text: string | null): void;
  setStage(key: string): void;
  /** Real loading progress, 0..1; 0 starts a new load. */
  setProgress(fraction: number): void;
  setTrack(id: string, track: TrackData | null): void;
  setFailure(retry: (() => void) | null): void;
  /**
   * The same screen, opening the game rather than a race. The route card and the departure
   * button belong to a drive the player asked for; on the way in nobody has asked for anything yet,
   * so what is left is the game's name and the bar.
   */
  setOpening(on: boolean): void;
}

function panel(children: HTMLElement[], centred = false): HTMLElement {
  const wrap = el('div');
  wrap.appendChild(el('div', 'veil'));
  const p = el('div', centred ? 'panel center' : 'panel');
  for (const c of children) p.appendChild(c);
  wrap.appendChild(p);
  return wrap;
}

/** Draws a MenuList, and wires clicks so the mouse works everywhere the keyboard does. */
export class ListView {
  readonly node = el('div', 'list');
  private rows: { id: string; row: HTMLButtonElement }[] = [];

  constructor(private readonly list: MenuList, private readonly onPick: (item: MenuItem) => void) {}

  /**
   * Redraw, reusing the rows whenever the items are the same ones in the same order.
   *
   * Rebuilding the whole list is what made the pause menu unclickable: moving the pointer onto a
   * row selects it, selecting redraws, and redrawing threw away the very button that was about to
   * be clicked. The click then landed on nothing at all.
   */
  render(): void {
    const items = this.list.items;
    const same = this.rows.length === items.length && this.rows.every((r, i) => r.id === items[i]!.id);
    if (!same) {
      this.node.replaceChildren();
      this.rows = items.map((item) => {
        const row = el('button', 'row') as HTMLButtonElement;
        row.type = 'button';
        row.dataset.action = item.id;
        row.append(el('div'), el('div', 'note'));
        row.onclick = () => {
          const current = this.list.items.find((x) => x.id === item.id);
          if (!current || current.disabled) return;
          this.list.select(item.id);
          this.render();
          this.onPick(current);
        };
        row.onfocus = () => {
          if (this.list.current?.id !== item.id) { this.list.select(item.id); this.render(); }
        };
        row.onmouseenter = () => {
          const current = this.list.items.find((x) => x.id === item.id);
          if (!current || current.disabled) return;
          this.list.select(item.id);
          this.render();
        };
        this.node.appendChild(row);
        return { id: item.id, row };
      });
    }

    const keepFocus = this.node.contains(document.activeElement);
    items.forEach((item, i) => {
      const row = this.rows[i]!.row;
      const selected = i === this.list.index;
      row.setAttribute('aria-selected', String(selected));
      row.disabled = !!item.disabled;
      if (item.disabled) row.setAttribute('aria-disabled', 'true');
      else row.removeAttribute('aria-disabled');
      const left = row.firstElementChild!;
      const parts = [el('div', 'name', item.label)];
      if (item.detail) parts.push(el('div', 'detail', item.detail));
      left.replaceChildren(...parts);
      const note = row.lastElementChild as HTMLElement;
      note.textContent = item.note ?? '';
      note.hidden = !item.note;
      if (selected) {
        if (keepFocus) row.focus({ preventScroll: true });
        queueMicrotask(() => { if (!this.node.closest('[hidden]')) row.scrollIntoView({ block: 'nearest' }); });
      }
    });
  }
}

export function bootScreen(i18n: I18n, onCancel: () => void): BootScreen {
  const details = new RouteDetails(i18n);
  const bar = loadingBar();
  const percent = el('span', 'loading-percent', '0%');
  const statusLine = el('p', 'tagline');
  statusLine.setAttribute('role', 'status');
  const cancel = el('button', 'cta');
  cancel.onclick = onCancel;
  const retry = el('button', 'cta departure-retry') as HTMLButtonElement; retry.hidden = true; retry.disabled = true;
  const ready = el('button', 'cta departure-go') as HTMLButtonElement; ready.disabled = true;
  const actions = el('div', 'actions'); actions.append(ready, retry, cancel);
  const label = el('div', 'departure-progress-label'); label.append(statusLine, percent);
  const progress = el('div', 'departure-progress'); progress.append(label, bar.node);
  // The game's own wordmark, from its one owner, so the opening screen is recognisably this game
  // and not a bare progress bar.
  const opening = el('h1', 'boot-name'); opening.hidden = true;
  renderBrandSignature(opening, i18n, true);
  const node = panel([opening, details.node, progress, actions]); node.classList.add('departure');
  let status: string | null = null;
  let stage: string | null = null;
  // The number counts up to the real progress instead of jumping, so a fast (cached) load still
  // visibly starts at 0% rather than appearing at 100%. Full scale takes at most ~0.4 s.
  let shown = 0, counting = 0, countedAt = 0;
  const countUp = (now: number) => {
    // A frame's timestamp is when the frame began, which can be earlier than the performance.now()
    // `setProgress` read: a negative step then showed "-2%" for a frame.
    shown = Math.max(shown, Math.min(bar.value, shown + Math.max(0, now - countedAt) / 400));
    countedAt = Math.max(countedAt, now);
    percent.textContent = `${Math.round(shown * 100)}%`;
    counting = shown < bar.value ? requestAnimationFrame(countUp) : 0;
  };
  return {
    node,
    setTrack(id, track) { details.setTrack(id, track); },
    setOpening(on) {
      opening.hidden = !on;
      // `hidden` alone loses to the panel's own display rule, and this node has one.
      details.node.style.display = on ? 'none' : '';
      ready.hidden = on;
      //
      // A race's loading screen keeps it: there the player came from the garage and can go back to it.
      cancel.hidden = on;
    },
    setFailure(onRetry) {
      retry.hidden = !onRetry; ready.hidden = !!onRetry; bar.node.hidden = !!onRetry; percent.hidden = !!onRetry;
      retry.disabled = !onRetry;
      retry.onclick = onRetry;
      if (onRetry) { stage = 'departure.failed'; statusLine.textContent = i18n.t(stage); }
    },
    setStatus(text) { stage = null; status = text; statusLine.textContent = text ?? ''; },
    setStage(key) { stage = key; statusLine.textContent = i18n.t(key); },
    setProgress(fraction) {
      if (fraction <= 0) {
        bar.reset(); cancelAnimationFrame(counting); counting = 0; shown = 0; percent.textContent = '0%';
        return;
      }
      bar.set(fraction);
      if (!counting) { countedAt = performance.now(); counting = requestAnimationFrame(countUp); }
    },
    render() {
      details.render();
      statusLine.textContent = stage ? i18n.t(stage) : status ?? '';
      cancel.textContent = i18n.t('start.back');
      ready.textContent = i18n.t('departure.wait');
      retry.textContent = i18n.t('departure.retry');
    },
  };
}

export interface IntroFacts {
  direction?: RaceDirection;
  track: TrackData;
  best: number | null;
  /** which prompt to show, and it matters: a phone has no Enter key to press */
  device: Commands['device'];
}

export function introScreen(i18n: I18n, facts: () => IntroFacts, onStart: () => void, onBack: () => void, onPause: () => void): Screen {
  const details = new RouteDetails(i18n);
  const best = el('div', 'hint');
  const prompt = el('p', 'hint');
  const cta = el('button', 'cta departure-go');
  const back = el('button', 'cta secondary');
  cta.onclick = onStart; back.onclick = onBack;
  const pause = el('button', 'cta secondary departure-pause'); pause.onclick = onPause;
  const actions = el('div', 'actions'); actions.append(cta, back, pause);
  const node = panel([details.node, best, actions, prompt]); node.classList.add('departure');
  return {
    node,
    render() {
      const f = facts();
      details.setTrack(f.track.id, f.track, f.direction);
      best.textContent = f.best === null ? i18n.t('menu.noBest')
        : i18n.t('menu.best', { time: formatTime(f.best) });
      back.textContent = i18n.t('start.back');
      cta.textContent = i18n.t('departure.go');
      pause.textContent = i18n.t('photo.pause');
      prompt.textContent = i18n.t(f.device === 'touch' ? 'intro.startTouch' : 'intro.start');
    },
  };
}

export interface HudState {
  standing?: { rank: number; total: number };
  /** Other racers for the minimap and navigation map; no label is drawn over their cars. */
  rivals?: readonly MapRacer[];
  playerCount?: number;
  playerIndex?: number;
  score: number;
  slimeHits: number;
  scoreAwards: readonly ScoreAward[];
  /** This racer crossed the line; its race clock stops, so time-windowed HUD cues must not hang. */
  finished?: boolean;
  reducedMotion: boolean;
  time: number;
  speedKmh: number;
  rpm?: number;
  rpmFraction?: number;
  gear?: number;
  drive?: DriveType;
  checkpoint: number;
  checkpoints: number;
  lap: number;
  laps: number;
  wrongWay: boolean;
  rescueWarning?: boolean;
  notice: string;
  /**
   * The standing "your map data is behind" line, or ''. It has a slot of its own rather than
   * sharing `notice`, because the two have opposite lifetimes: `notice` is a two-second toast that
   * anything newer may replace, this one has to be there whenever the player looks up. Sharing one
   * slot meant a stale tree silently swallowed every checkpoint, lap and error message for the rest
   * of the session, and「开反了」covered it exactly when a lost player turned around to look for the
   * road that was never drawn.
   */
  alert: string;
  countdown: string;
  device: Commands['device'];
  /** the route to draw in the corner, and where the car is on it */
  route: MiniMapRoute | null;
  view: MiniMapView;
  cameraMode?: CameraMode;
  cameraFeedback?: CameraFeedback;
  /** The phone stick under a finger, in client pixels; null while nothing holds it. */
  touchStick?: TouchStick | null;
  /** Which drag-to-steer hint to play: the first races' countdown, or a reminder when stuck. */
  touchGuide?: 'countdown' | 'reminder' | null;
}

export function playerHudScreen(i18n: I18n, states: () => HudState[], onPause: () => void): Screen {
  const node = el('div');
  node.id = 'hud';
  const views = [0, 1].map(index => {
    const view = hudScreen(i18n, () => states()[index]!, onPause);
    view.node.removeAttribute('id');
    view.node.className = 'player-hud';
    view.node.dataset.player = String(index + 1);
    return view;
  });
  return { node, render() {
    const count = states().length;
    node.classList.toggle('split-hud', count === 2);
    for (const [index, view] of views.entries()) {
      if (index >= count) view.node.remove();
      else { if (view.node.parentElement !== node) node.append(view.node); view.render(); }
    }
  } };
}

export function hudScreen(i18n: I18n, state: () => HudState, onPause: () => void): Screen {
  // Two panels, because they answer two different questions: the nav view says which street this
  // is, the route map says how much of the route is left.
  const map = new MiniMap();
  const nav = new NavMap();
  const expandableNav = !isMobileDevice();
  const labelNav = () => {
    nav.node.setAttribute('aria-pressed', String(nav.expanded));
    nav.node.setAttribute('aria-label', i18n.t(nav.expanded ? 'hud.navCollapse' : 'hud.navExpand'));
  };
  if (expandableNav) {
    nav.node.setAttribute('role', 'button');
    nav.node.tabIndex = 0;
    nav.node.onclick = () => { nav.setExpanded(!nav.expanded); labelNav(); };
  }
  // how much route is left, in words as well as in the dimmed line: a player glancing at a shape
  // cannot tell four hundred metres from a kilometre
  const score = el('div', 'hud-score');
  score.setAttribute('aria-live', 'polite');
  const scoreGain = el('div', 'hud-score-gain');
  // The live combo: shown from the second slime in a chain until the chain lapses.
  const combo = el('div', 'hud-combo');
  combo.hidden = true;
  const scoreboard = el('div', 'hud-scoreboard');
  const standing = el('div', 'hud-standing');
  const remaining = el('div', 'hud-remaining');
  // A phone has no escape key, so without this there is no way out of a race at all.
  const pause = el('button', 'hud-pause') as HTMLButtonElement;
  pause.type = 'button';
  pause.onclick = onPause;
  const time = el('div', 'hud-time');
  const hits = el('div', 'hud-hits');
  const meta = el('div', 'hud-meta');
  // Top left is the route and the clock, together, because they answer the same question: how far
  // in am I. Top right is the nav view on its own, where a driver's eyes go for the next junction.
  // The time and score joined that column; top centre is where the road meets the horizon,
  // so only passing notices and the countdown use it. The combo and the "+points" pop stack to its right.
  const pops = el('div', 'hud-pops');
  pops.append(combo, scoreGain);
  scoreboard.append(standing, time, score, hits, pops);
  const clock = el('div', 'hud-clock');
  clock.append(scoreboard, meta, remaining);
  const top = el('div', 'hud-top');
  top.append(map.node, clock);
  const speed = el('div', 'hud-speed');
  const speedValue = el('strong', 'hud-speed-value');
  const speedUnit = el('span', 'hud-speed-unit');
  const gear = el('strong', 'hud-gear');
  const drive = el('span', 'hud-drive');
  const rpm = el('span', 'hud-rpm');
  const revFill = el('i', 'hud-rev-fill');
  const revs = el('div', 'hud-revs');
  revs.append(revFill);
  const speedLine = el('div', 'hud-speed-line');
  const powerLine = el('div', 'hud-power-line');
  speedLine.append(speedValue, speedUnit);
  powerLine.append(gear, drive, rpm);
  speed.append(speedLine, powerLine, revs);
  const notice = el('div', 'hud-notice');
  const alert = el('div', 'hud-alert');
  const controls = el('div', 'hud-controls');
  const countdown = el('div', 'countdown');
  const cameraFeedback = el('div', 'camera-feedback');
  cameraFeedback.setAttribute('aria-hidden', 'true');
  const touchControls = el('div', 'touch-controls');
  // The whole lower-left of the screen is the stick. The bar is always drawn at its resting
  // place so a player sees where to put a thumb; a held finger moves it under the finger.
  const steerZone = el('div', 'touch-steer-zone');
  steerZone.dataset.touchControl = 'steer';
  const stick = el('div', 'touch-stick');
  stick.setAttribute('aria-hidden', 'true');
  stick.dataset.touchAnchor = 'steer';   // A press on the resting bar's arrows steers from its centre
  const stickKnob = el('span', 'touch-stick-knob');
  stick.append(el('span', 'touch-stick-arrow touch-stick-left', '◀'), stickKnob, el('span', 'touch-stick-arrow touch-stick-right', '▶'));
  // The whole lower right under the speedometer brakes, so a thumb that misses the drawn
  // pedal still brakes; the pedal sits up and in from the corner, clear of the phone's home-swipe edge.
  const brakeZone = el('div', 'touch-brake-zone');
  brakeZone.dataset.touchControl = 'brake';
  const brakeButton = el('button', 'touch-button touch-brake') as HTMLButtonElement;
  brakeButton.type = 'button';
  brakeZone.append(brakeButton);
  // No camera button on the phone HUD: it sat on the speedometer, and the
  // camera is chosen in pause -> settings. Keyboard C / . and gamepad RB still cycle it live.
  const guide = el('div', 'touch-guide');
  guide.setAttribute('aria-hidden', 'true');
  const guideText = el('span', 'touch-guide-text');
  guide.append(el('span', 'touch-guide-hand', '☝'), guideText);
  guide.hidden = true;
  // On iPhone and iPad the stick gives way to two hold buttons, built the same way as the
  // brake: a wide zone that takes the thumb, with the drawn button inside it.
  const holdSteer = steersWithButtons();
  const holdButtons = (['left', 'right'] as const).map(dir => {
    const zone = el('div', `touch-hold-zone touch-hold-${dir}`);
    const button = el('button', 'touch-button touch-hold', dir === 'left' ? '◀' : '▶') as HTMLButtonElement;
    button.type = 'button'; button.tabIndex = -1;
    zone.append(button);
    // iPhone / iPad: the visible button takes native touches itself; the zone only lays it out.
    bindTouchButton(button, dir, zone);
    return { dir, zone, button };
  });
  if (holdSteer) { delete brakeZone.dataset.touchControl; bindTouchButton(brakeButton, 'brake', brakeZone); }
  touchControls.dataset.steer = holdSteer ? 'buttons' : 'drag';
  if (holdSteer) touchControls.append(...holdButtons.map(b => b.zone), brakeZone, guide);
  else touchControls.append(steerZone, stick, brakeZone, guide);
  const node = el('div');
  node.id = 'hud';
  node.append(cameraFeedback, top, nav.node, pause, speed, notice, alert, controls,
    countdown, touchControls);
  let visibleScore: number | null = null;
  const queuedAwards: ScoreAward[] = [];
  let seenAward = 0;
  let animating = false;
  let animationGeneration = 0;
  const showScore = (value: number) => { score.textContent = i18n.t('hud.score', { score: value }); };
  const animateScore = (): void => {
    if (animating || !queuedAwards.length || visibleScore === null) return;
    const award = queuedAwards.shift()!;
    const target = award.total;
    const generation = animationGeneration;
    scoreGain.textContent = `+${award.points}`;
    scoreGain.classList.remove('show'); void scoreGain.offsetWidth; scoreGain.classList.add('show');
    animating = true;
    window.setTimeout(() => {
      if (generation !== animationGeneration) return;
      visibleScore = target; showScore(target);
      score.classList.remove('bump'); void score.offsetWidth; score.classList.add('bump');
      window.setTimeout(() => {
        if (generation !== animationGeneration) return;
        animating = false; animateScore();
      }, 260);
    }, 360);
  };
  return {
    node,
    render() {
      const s = state();
      const feedback = s.cameraFeedback ?? { mode: s.cameraMode ?? 'chase', speed: 0, boost: 0, shake: 0 };
      const cameraMode = s.cameraMode ?? feedback.mode;
      cameraFeedback.dataset.mode = cameraMode;
      cameraFeedback.style.setProperty('--speed-feedback', feedback.speed.toFixed(3));
      cameraFeedback.style.setProperty('--boost-feedback', feedback.boost.toFixed(3));
      cameraFeedback.style.setProperty('--shake-feedback', feedback.shake.toFixed(3));
      // Ordinary high speed changes the chase camera only. Converging streaks belong exclusively
      // to the red rocket-slime state and disappear with that state.
      cameraFeedback.style.setProperty('--camera-feedback-opacity', feedback.boost.toFixed(3));
      cameraFeedback.style.setProperty('--camera-feedback-scale',
        (1 + feedback.boost * .055).toFixed(3));
      cameraFeedback.style.setProperty('--camera-feedback-glow',
        `${Math.round(42 + feedback.boost * 70)}px`);
      const lastAward = s.scoreAwards.at(-1)?.id ?? 0;
      if (s.reducedMotion) {
        animationGeneration++; animating = false; queuedAwards.length = 0; visibleScore = s.score;
        seenAward = lastAward; scoreGain.classList.remove('show'); showScore(visibleScore);
      } else if (visibleScore === null || s.score < visibleScore || (!lastAward && seenAward)) {
        animationGeneration++; animating = false; queuedAwards.length = 0; visibleScore = s.score;
        seenAward = lastAward;
        scoreGain.classList.remove('show'); showScore(visibleScore);
      } else {
        const unseen = s.scoreAwards.filter(award => award.id > seenAward);
        queuedAwards.push(...unseen); seenAward = lastAward; animateScore();
        if (!animating) showScore(visibleScore);
      }
      const lastSlime = [...s.scoreAwards].reverse().find(award => award.source === 'slime');
      const chain = lastSlime?.combo ?? 0;
      const live = !s.finished && chain >= 2 && lastSlime!.at !== undefined
        && s.time - lastSlime!.at <= COMBO_WINDOW_SECONDS;
      combo.hidden = !live;
      if (live) {
        const text = `×${chain}`;
        if (combo.textContent !== text) {
          combo.textContent = text;
          combo.dataset.combo = String(chain);
          combo.dataset.tier = chain >= 9 ? 'hot' : chain >= 5 ? 'warm' : 'cool';
          if (!s.reducedMotion) { combo.classList.remove('bump'); void combo.offsetWidth; combo.classList.add('bump'); }
        }
      } else { combo.textContent = ''; delete combo.dataset.combo; delete combo.dataset.tier; }
      standing.hidden = !s.standing;
      standing.textContent = s.standing ? i18n.t('hud.standing', s.standing) : '';
      time.textContent = formatTime(s.time);
      hits.textContent = i18n.t('hud.slimeHits', { count: s.slimeHits });
      const bits = [i18n.t('hud.checkpoint', { index: s.checkpoint, total: s.checkpoints })];
      if (s.laps > 1) bits.unshift(i18n.t('hud.lap', { lap: s.lap, total: s.laps }));
      meta.replaceChildren(...bits.map((b) => el('span', '', b)));
      const displayedSpeed = i18n.speed(s.speedKmh);
      speedValue.textContent = String(displayedSpeed.value);
      speedUnit.textContent = displayedSpeed.unit;
      gear.textContent = `G${s.gear ?? 1}`;
      drive.textContent = i18n.t(`drive.${s.drive ?? 'awd'}.short`);
      rpm.textContent = `${((s.rpm ?? 900) / 1000).toFixed(1)}k`;
      revFill.style.width = `${Math.round((s.rpmFraction ?? 0) * 100)}%`;
      notice.textContent = s.rescueWarning ? s.notice : s.wrongWay ? i18n.t('hud.wrongWay') : s.notice;
      notice.className = s.wrongWay || s.rescueWarning ? 'hud-notice hud-warn' : 'hud-notice';
      alert.textContent = s.alert;
      countdown.textContent = s.countdown;
      controls.textContent = i18n.t(s.playerCount === 2 ? `controls.player${(s.playerIndex ?? 0) + 1}`
        : s.device === 'touch' && holdSteer ? 'controls.touchButtons' : `controls.${s.device}`);
      steerZone.setAttribute('aria-label', i18n.t('touch.steer'));
      for (const b of holdButtons) b.button.setAttribute('aria-label', i18n.t(b.dir === 'left' ? 'touch.steerLeft' : 'touch.steerRight'));
      brakeButton.setAttribute('aria-label', i18n.t('touch.brake'));
      brakeButton.textContent = i18n.t('touch.brake');
      const held = s.touchStick ?? null;
      stick.dataset.held = String(held !== null);
      if (held) {
        const box = node.getBoundingClientRect();
        stick.style.left = `${held.originX - box.left}px`;
        stick.style.top = `${held.originY - box.top}px`;
        stickKnob.style.transform = `translateX(${Math.max(-STEER_FULL_PX, Math.min(STEER_FULL_PX, held.dx))}px)`;
      } else {
        stick.style.left = ''; stick.style.top = ''; stickKnob.style.transform = '';
      }
      guide.hidden = !s.touchGuide;
      guide.dataset.kind = s.touchGuide ?? '';
      guideText.textContent = i18n.t(holdSteer ? 'touch.holdToSteer' : 'touch.dragToSteer');
      pause.hidden = s.device !== 'touch';
      pause.setAttribute('aria-label', i18n.t('pause.title'));
      pause.textContent = '❙❙';
      map.setRoute(s.route);
      nav.setStreets(s.route?.streets ?? null);
      if (expandableNav) labelNav();
      if (s.route) {
        const lap = s.route.closed ? s.view.s % s.route.length : s.view.s;
        let left = Math.max(0, s.route.length - lap);
        // Standing on the start line of a circuit is a whole lap to go, not none. The projection
        // reads the seam from either side, so at the line it can answer "a metre short of a lap".
        if (s.route.closed && left < 5) left = s.route.length;
        remaining.textContent = left >= 1000 ? `${(left / 1000).toFixed(1)} km` : `${Math.round(left)} m`;
      }
      top.hidden = s.route === null;
      nav.node.hidden = !s.route?.streets;
      if (s.route) {
        map.draw(s.view, s.rivals, s.playerIndex);
        if (s.route.streets) nav.draw(s.view, s.rivals, s.playerIndex);
      }
    },
  };
}

export interface ResultRating {
  impactKinds?: Partial<Record<SlimeKind, number>>;
  sections?: {seconds: number; distance: number}[];
  rating?: StarRating;
  maxCombo?: number;
  cleanCorners?: number;
  bestRating?: StarRating;
}
export interface ResultFacts extends ResultRating {
  direction?: RaceDirection;
  capturedAt?: string;
  textCopied?: boolean;
  players?: ({ time: number; score: number; slimeHits: number; name?: string } & ResultRating)[];
  /** The solo driver's nickname, when one is set. */
  name?: string;
  score: number;
  slimeHits: number;
  trackId: string;
  time: number;
  best: number | null;
  isBest: boolean;
  reducedMotion?: boolean;
  achievements?: string[];
  newAchievements?: string[];
  standings?: ResultStanding[];
  ghostNext?: boolean;
  /** The run this one was racing against, when the player came in through a challenge. */
  challenge?: Pick<Challenge, 'time' | 'rating' | 'score' | 'name' | 'vehicleId'>;
  /** This run as a challenge for the next person: the code, and the link it travels in. */
  challengeCode?: string;
  challengeUrl?: string;
  /** The car this run was driven in: cars differ in pace, so a dare always names it. */
  challengeVehicleId?: string;
  /** Seconds of drive the browser has recorded and can hand over as a video. */
  clipSeconds?: number;
}

/** The card's place line: this human's position when AI racers ran, otherwise nothing. */
export function resultPlace(result: Pick<ResultFacts, 'standings'>, player = 0): { rank: number; total: number } | null {
  const standings = result.standings ?? [];
  if (!standings.some(racer => racer.role === 'ai')) return null;
  const rank = standings.findIndex(racer => racer.role === 'human' && (racer.player ?? 0) === player) + 1;
  return rank > 0 ? { rank, total: standings.length } : null;
}

export interface ResultStanding {
  id: string;
  role: 'human' | 'ai';
  vehicleId: string;
  player?: number;
  finished: boolean;
  time: number | null;
}

export { resultsScreen } from './ResultsScreen';

export interface SettingsState {
  language: string;
  quality: string;
  volume: number;
  musicVolume: number;
  effectsVolume: number;
  muted: boolean;
  reducedMotion?: boolean;
  showGhost?: boolean;
  cameraModes: readonly CameraMode[];
  playerCount: number;
  names?: readonly [string, string];
}

export { settingsScreen } from './SettingsScreen';

/**
 * Who a result belongs to on a card: the nickname when set, else "left/right driver" in a
 * two-player result, else nothing -- a solo card without a name reads as it always has.
 */
/**
 * What a solo result set: a personal best, or the route's first finish. A run that did not
 * beat the record is null, so the ceremony is not shouted every lap.
 */
export function resultRecord(result: Pick<ResultFacts, 'players' | 'isBest' | 'best' | 'time'>): { kind: 'best' | 'first'; seconds: number } | null {
  if (result.players || !result.isBest) return null;
  return result.best === null ? { kind: 'first', seconds: 0 } : { kind: 'best', seconds: result.best - result.time };
}

/** The banner's words for a record, so page, picture and text never word it differently. */
export function recordText(t: I18n, feat: { kind: 'best' | 'first'; seconds: number }, share = false): string {
  if (feat.kind === 'first') return t.t(share ? 'results.recordShareFirst' : 'results.recordFirst');
  if (feat.seconds < .005) return t.t(share ? 'results.recordShareTiny' : 'results.recordTiny');
  return t.t(share ? 'results.recordShare' : 'results.recordBest', { seconds: feat.seconds.toFixed(2) });
}

export function personLabel(t: I18n, result: Pick<ResultFacts, 'players' | 'name'>, index: number): string | null {
  const name = result.players ? result.players[index]?.name : result.name;
  return name || (result.players ? t.t(`results.player${index + 1}`) : null);
}

export function aboutScreen(i18n: I18n, onBack: () => void, onShare?: () => void): Screen {
  const title = el('h2'), story = el('p'), made = el('p'), version = el('p', 'about-version');
  const data = el('p'), marks = el('p'), assets = el('p');
  const close = el('button', 'cta about-close', '×') as HTMLButtonElement;
  close.type = 'button'; close.onclick = onBack;
  const links = el('div', 'about-links'), software = el('ul', 'about-software');
  // Every account the creator runs, one tap each; the names follow the interface language.
  const followTitle = el('p', 'about-follow-title'), socials = el('div', 'about-socials');
  const socialLinks = creatorSocials().map(social => {
    const link = el('a', 'about-social') as HTMLAnchorElement;
    link.href = social.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    socials.append(link);
    return {social, link};
  });
  const notices = el('a', 'about-notices') as HTMLAnchorElement;
  notices.href = './credits.txt'; notices.target = '_blank'; notices.rel = 'noopener noreferrer';
  for (const source of CREDITS.sourceLinks) {
    const link = el('a', '', source.name) as HTMLAnchorElement;
    link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link);
  }
  for (const lib of CREDITS.libraries) software.append(el('li', '', `${lib.name} ${lib.version} — ${lib.license}`));
  // The game's share card, the same one the home page offers.
  const share = el('button', 'cta about-share') as HTMLButtonElement;
  share.hidden = !onShare; if (onShare) share.onclick = onShare;
  for (const node of [socials, links, notices, share]) node.addEventListener('keydown', event => {
    if (event.code === 'Enter' || event.code === 'Space') event.stopPropagation();
  });
  const back = el('button', 'cta'); back.onclick = onBack;
  // Back first: the screen focuses its first button, and Enter here has always meant back.
  const actions = el('div', 'about-actions'); actions.append(back, share);
  const node = panel([title, story, made, followTitle, socials, version, data, links, assets, software, notices, marks, actions]);
  node.classList.add('about-screen'); node.append(close);
  return { node, render() {
    title.textContent = i18n.t('about.title'); story.textContent = i18n.t('home.story');
    made.textContent = i18n.t('about.made');
    followTitle.textContent = i18n.t('about.follow');
    for (const {social, link} of socialLinks) link.textContent = i18n.t(`about.social.${social.id}`);
    version.textContent = i18n.t('about.version', {version: CREDITS.version}) + (CREDITS.dirty ? i18n.t('about.local') : '');
    data.textContent = i18n.t('about.data'); assets.textContent = i18n.t('about.assets');
    notices.textContent = i18n.t('about.notices');
    marks.textContent = i18n.t('about.trademarks'); back.textContent = i18n.t('about.back');
    close.setAttribute('aria-label', i18n.t('share.close'));
    share.textContent = i18n.t('results.share');
  }};
}
