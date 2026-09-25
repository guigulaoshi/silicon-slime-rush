import type { CarInput } from '../physics/Car';
import { GamepadInput } from './Gamepad';
import { KEY_BINDINGS, PLAYER_KEYS, Keyboard } from './Keyboard';
import { TouchInput } from './Touch';
import type { Commands, MenuAction } from './types';

const STEER_RATE = 4.5;      // how fast a key press ramps the wheel, per second
const STEER_RETURN = 7.0;    // and how fast it comes back when released

/**
 * One place the rest of the game asks "what does the player want".
 *
 * Keyboard steering is ramped rather than instant. A digital key gives full lock the moment it is
 * pressed, which at speed is a spin; ramping gives the same feel as an analogue stick and means the
 * two devices can share one set of handling numbers.
 */
export class Input {
  readonly keyboard = new Keyboard();
  readonly gamepad: GamepadInput;
  readonly touch = new TouchInput();
  private steer = 0;
  private touchSteered = false;
  private readonly playerSteer = [0, 0];
  private device: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  private readonly onBlur = (): void => { this.clearHeld(); };
  private readonly onVisibility = (): void => { if (document.hidden) this.clearHeld(); };

  constructor(gamepad = new GamepadInput()) {
    this.gamepad = gamepad;
  }

  attach(target: EventTarget = window): this {
    this.keyboard.attach(target);
    return this;
  }

  /** DOM controls live above the canvas, so their pointer events are collected on the window. */
  attachTouch(surface: EventTarget = window): this {
    this.touch.attach(surface);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    return this;
  }

  detach(target: EventTarget = window): void {
    this.keyboard.detach(target);
    this.touch.detach();
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  clearHeld(): void {
    this.touch.clear(); this.keyboard.clear(); this.steer = 0; this.touchSteered = false; this.playerSteer.fill(0);
  }

  /** Split mode samples the keyboard once, preserving both players' independent input edges. */
  readPlayers(dt: number, count: number): Commands[] {
    if (count < 2) return [this.read(dt)];
    const pressed = this.keyboard.takePressed();
    return PLAYER_KEYS.map((keys, index) => {
      const throttle = this.keyboard.isDown(keys.throttle) ? 1 : 0;
      const brake = this.keyboard.isDown(keys.brake) ? 1 : 0;
      const target = Number(this.keyboard.isDown(keys.right)) - Number(this.keyboard.isDown(keys.left));
      const step = (target === 0 ? STEER_RETURN : STEER_RATE) * dt;
      const previous = this.playerSteer[index]!;
      const steer = previous + Math.max(-step, Math.min(step, target - previous));
      this.playerSteer[index] = steer;
      const ownCodes: readonly string[] = [...keys.throttle, ...keys.brake, ...keys.left, ...keys.right, ...keys.confirm];
      const actions = pressed.filter(code => ownCodes.includes(code))
        .map(code => Keyboard.menuAction(code)).filter((action): action is MenuAction => action !== null);
      // Pause belongs to the shared world and is emitted once even with two input consumers.
      if (index === 0 && pressed.includes('Escape')) actions.push('pause');
      return { car: { throttle, brake, steer }, actions,
        reset: pressed.some(code => (keys.reset as readonly string[]).includes(code)),
        restart: false,
        camera: pressed.some(code => (keys.camera as readonly string[]).includes(code)),
        device: 'keyboard' };
    });
  }

  read(dt: number): Commands {
    const pad = this.gamepad.read();
    const keys = this.keyboard;

    const keyThrottle = keys.isDown(KEY_BINDINGS.throttle) ? 1 : 0;
    const keyBrake = keys.isDown(KEY_BINDINGS.brake) ? 1 : 0;
    const keyLeft = keys.isDown(KEY_BINDINGS.left);
    const keyRight = keys.isDown(KEY_BINDINGS.right);
    const keyTouched = keyThrottle > 0 || keyBrake > 0 || keyLeft || keyRight;

    const target = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
    const rate = target === 0 ? STEER_RETURN : STEER_RATE;
    const step = rate * dt;
    this.steer += Math.max(-step, Math.min(step, target - this.steer));
    // A phone stick is analogue like a pad: it follows the thumb with no ramp, which would
    // only make it feel sticky. Keys still win while held.
    if (!keyLeft && !keyRight && (this.touch.steeringHeld || this.touchSteered)) {
      this.steer = this.touch.steer;   // and lifting the thumb straightens at once
    }
    this.touchSteered = this.touch.steeringHeld;

    const pressed = keys.takePressed();
    const actions: MenuAction[] = [];
    for (const code of pressed) {
      const action = Keyboard.menuAction(code);
      if (action) actions.push(action);
    }
    if (pressed.includes('Escape')) actions.push('pause');
    actions.push(...pad.actions);

    // Mobile drivers hold a direction or brake; releasing the brake restores automatic throttle.
    const touchBrake = this.touch.brake;
    const autoThrottle = this.touch.used && touchBrake === 0 ? 1 : 0;

    if (pad.active) this.device = 'gamepad';
    else if (keyTouched || pressed.length) this.device = 'keyboard';
    else if (this.touch.used) this.device = 'touch';

    const steers = [this.steer, pad.steer];
    const car: CarInput = {
      throttle: Math.max(keyThrottle, pad.throttle, autoThrottle),
      brake: Math.max(keyBrake, pad.brake, touchBrake),
      steer: steers.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0),
    };

    return {
      car,
      actions,
      reset: pressed.some((c) => (KEY_BINDINGS.reset as readonly string[]).includes(c)) || pad.reset,
      restart: pressed.some((c) => (KEY_BINDINGS.restart as readonly string[]).includes(c)) || pad.restart,
      camera: pressed.some((c) => (KEY_BINDINGS.camera as readonly string[]).includes(c)) || pad.camera,
      device: this.device,
    };
  }
}
