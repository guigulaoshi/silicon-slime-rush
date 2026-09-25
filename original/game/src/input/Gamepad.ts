import type { MenuAction } from './types';

/** Standard-layout button indices, the only layout the browser promises. */
export const BUTTON = {
  a: 0, b: 1, x: 2, y: 3,
  lb: 4, rb: 5, lt: 6, rt: 7,
  back: 8, start: 9,
  up: 12, down: 13, left: 14, right: 15,
} as const;

const MENU_BUTTONS: [number, MenuAction][] = [
  [BUTTON.up, 'up'], [BUTTON.down, 'down'], [BUTTON.left, 'left'], [BUTTON.right, 'right'],
  [BUTTON.a, 'confirm'], [BUTTON.b, 'back'], [BUTTON.start, 'pause'],
];

const STICK_DEADZONE = 0.18;
const STICK_MENU_THRESHOLD = 0.6;

export interface PadSnapshot {
  connected: boolean;
  steer: number;
  throttle: number;
  brake: number;
  reset: boolean;
  restart: boolean;
  camera: boolean;
  actions: MenuAction[];
  /* */
  active: boolean;
}

const EMPTY: PadSnapshot = {
  connected: false, steer: 0, throttle: 0, brake: 0,
  reset: false, restart: false, camera: false, actions: [], active: false,
};

/** Analogue sticks never rest at exactly zero, and the rescale keeps full range past the deadzone. */
export function deadzone(v: number, zone = STICK_DEADZONE): number {
  const a = Math.abs(v);
  if (a <= zone) return 0;
  return Math.sign(v) * ((a - zone) / (1 - zone));
}

/**
 * Reads the first connected gamepad.
 *
 * The Gamepad API has no events for button state, only a snapshot that must be polled, so edge
 * detection has to be done here by remembering the previous frame.
 */
export class GamepadInput {
  private previous: boolean[] = [];

  /** `source` exists so tests can supply pads without a browser. */
  constructor(private readonly source: () => (Gamepad | null)[] = () => navigator.getGamepads?.() ?? []) {}

  read(): PadSnapshot {
    const pad = this.source().find((p): p is Gamepad => !!p && p.connected);
    if (!pad) {
      this.previous = [];
      return EMPTY;
    }
    const axis = (i: number) => deadzone(pad.axes[i] ?? 0);
    const button = (i: number) => pad.buttons[i]?.pressed ?? false;
    const value = (i: number) => pad.buttons[i]?.value ?? (button(i) ? 1 : 0);

    const justPressed = (i: number) => button(i) && !this.previous[i];
    const actions: MenuAction[] = [];
    for (const [index, action] of MENU_BUTTONS) if (justPressed(index)) actions.push(action);
    // the left stick also drives menus, but only as a flick, not while it is being held
    const lx = axis(0), ly = axis(1);
    if (lx > STICK_MENU_THRESHOLD && !this.stickWas('right')) actions.push('right');
    if (lx < -STICK_MENU_THRESHOLD && !this.stickWas('left')) actions.push('left');
    if (ly > STICK_MENU_THRESHOLD && !this.stickWas('down')) actions.push('down');
    if (ly < -STICK_MENU_THRESHOLD && !this.stickWas('up')) actions.push('up');
    this.stick = { right: lx > STICK_MENU_THRESHOLD, left: lx < -STICK_MENU_THRESHOLD,
                   down: ly > STICK_MENU_THRESHOLD, up: ly < -STICK_MENU_THRESHOLD };

    const snapshot: PadSnapshot = {
      connected: true,
      steer: lx,
      throttle: value(BUTTON.rt),
      brake: value(BUTTON.lt),
      reset: justPressed(BUTTON.y),
      restart: justPressed(BUTTON.x),
      camera: justPressed(BUTTON.rb),
      actions,
      active: false,
    };
    snapshot.active = snapshot.throttle > 0.02 || snapshot.brake > 0.02 || Math.abs(snapshot.steer) > 0
      || actions.length > 0 || snapshot.reset || snapshot.restart || snapshot.camera;
    this.previous = pad.buttons.map((b) => b.pressed);
    return snapshot;
  }

  private stick = { up: false, down: false, left: false, right: false };
  private stickWas(dir: keyof typeof this.stick): boolean {
    return this.stick[dir];
  }
}
