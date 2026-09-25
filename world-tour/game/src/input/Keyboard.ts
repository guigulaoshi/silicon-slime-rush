import type { MenuAction } from './types';

export const KEY_BINDINGS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  reset: ['KeyR'],
  restart: ['Enter'],
  camera: ['KeyC'],
  pause: ['Escape'],
  confirm: ['Enter', 'Space'],
  back: ['Escape', 'Backspace'],
} as const;

export const PLAYER_KEYS = [
  { throttle: ['KeyW'], brake: ['KeyS'], left: ['KeyA'], right: ['KeyD'], reset: ['KeyR'], camera: ['KeyC'], confirm: ['Space'] },
  { throttle: ['ArrowUp'], brake: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], reset: ['Slash'], camera: ['Period'], confirm: ['Enter'] },
] as const;

const MENU_KEYS: Record<string, MenuAction> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', Space: 'confirm',
  // Escape is deliberately not here. It is turned into a single 'pause' action instead, because one
  // key press has to make one action: emitting 'back' and 'pause' together made the phase machine
  // resume and then pause again in the same frame, so escape could never get out of the pause menu.
  Backspace: 'back',
};

/**
 * Keyboard state, read as a set rather than as events.
 *
 * Driving wants to know whether a key is down right now; menus want to know that it went down once.
 * Keeping both here means the rest of the game never listens to the DOM directly, which is also what
 * lets the automated driver stand in for a player without any special case.
 */
export class Keyboard {
  private readonly down = new Set<string>();
  private readonly pressed: string[] = [];
  private attached = false;

  private readonly onDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressed.push(e.code);
    // space scrolls the page and the arrows move the scroll position inside an itch.io frame
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  };
  private readonly onUp = (e: KeyboardEvent) => { this.down.delete(e.code); };
  private readonly onBlur = () => this.down.clear();

  attach(target: EventTarget = window): this {
    if (this.attached) return this;
    target.addEventListener('keydown', this.onDown as unknown as EventListener);
    target.addEventListener('keyup', this.onUp as unknown as EventListener);
    target.addEventListener('blur', this.onBlur);
    this.attached = true;
    return this;
  }

  detach(target: EventTarget = window): void {
    target.removeEventListener('keydown', this.onDown as unknown as EventListener);
    target.removeEventListener('keyup', this.onUp as unknown as EventListener);
    target.removeEventListener('blur', this.onBlur);
    this.attached = false;
    this.down.clear();
  }

  clear(): void { this.down.clear(); this.pressed.length = 0; }

  isDown(codes: readonly string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** Keys that went down since the last call, then forgotten. */
  takePressed(): string[] {
    const out = this.pressed.slice();
    this.pressed.length = 0;
    return out;
  }

  static menuAction(code: string): MenuAction | null {
    return MENU_KEYS[code] ?? null;
  }

  /** Test seam: pretend a key went down. */
  press(code: string): void {
    this.down.add(code);
    this.pressed.push(code);
  }

  release(code: string): void {
    this.down.delete(code);
  }
}
