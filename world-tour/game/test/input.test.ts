import { describe, expect, it } from 'vitest';
import { BUTTON, GamepadInput, deadzone } from '../src/input/Gamepad';
import { Input } from '../src/input/Input';
import { Keyboard } from '../src/input/Keyboard';
import { dragSteer, STEER_DEAD_PX, STEER_FULL_PX } from '../src/input/Touch';

function fakePad(over: Partial<{ axes: number[]; buttons: number[] }> = {}): Gamepad {
  const axes = over.axes ?? [0, 0, 0, 0];
  const values = over.buttons ?? [];
  return {
    connected: true, id: 'fake', index: 0, mapping: 'standard', timestamp: 0,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: (values[i] ?? 0) > 0.5, touched: false, value: values[i] ?? 0,
    })),
    hapticActuators: [], vibrationActuator: null,
  } as unknown as Gamepad;
}

describe('deadzone', () => {
  it('ignores the resting wobble and still reaches full lock', () => {
    expect(deadzone(0.1)).toBe(0);
    expect(deadzone(1)).toBeCloseTo(1);
    expect(deadzone(-1)).toBeCloseTo(-1);
    expect(deadzone(0.59)).toBeGreaterThan(0.4);
  });
});

describe('Keyboard', () => {
  it('reports held keys and hands out presses once', () => {
    const k = new Keyboard();
    k.press('KeyW');
    expect(k.isDown(['KeyW'])).toBe(true);
    expect(k.takePressed()).toEqual(['KeyW']);
    expect(k.takePressed()).toEqual([]);
    k.release('KeyW');
    expect(k.isDown(['KeyW'])).toBe(false);
  });

  it('maps keys to menu actions', () => {
    expect(Keyboard.menuAction('ArrowDown')).toBe('down');
    expect(Keyboard.menuAction('Enter')).toBe('confirm');
    expect(Keyboard.menuAction('KeyQ')).toBeNull();
  });
});

describe('Input', () => {
  it('ramps keyboard steering instead of snapping to full lock', () => {
    const input = new Input(new GamepadInput(() => []));
    input.keyboard.press('KeyD');
    const first = input.read(1 / 60).car.steer;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.2);
    for (let i = 0; i < 60; i++) input.read(1 / 60);
    expect(input.read(1 / 60).car.steer).toBeCloseTo(1, 1);
    input.keyboard.release('KeyD');
    for (let i = 0; i < 60; i++) input.read(1 / 60);
    expect(Math.abs(input.read(1 / 60).car.steer)).toBeLessThan(0.05);
  });

  it('takes the trigger and the stick from a pad', () => {
    let pad = fakePad({ axes: [-1, 0], buttons: [] });
    const input = new Input(new GamepadInput(() => [pad]));
    (pad.buttons[BUTTON.rt] as { value: number; pressed: boolean }).value = 0.8;
    const c = input.read(1 / 60);
    expect(c.car.throttle).toBeCloseTo(0.8);
    expect(c.car.steer).toBeCloseTo(-1);
    expect(c.device).toBe('gamepad');
  });

  it('an analogue stick beats a half-ramped key, and a key beats a resting stick', () => {
    const pad = fakePad({ axes: [0.9, 0] });
    const input = new Input(new GamepadInput(() => [pad]));
    input.keyboard.press('KeyA');
    expect(input.read(1 / 60).car.steer).toBeCloseTo(0.9, 1);
    const noPad = new Input(new GamepadInput(() => []));
    noPad.keyboard.press('KeyA');
    for (let i = 0; i < 60; i++) noPad.read(1 / 60);
    expect(noPad.read(1 / 60).car.steer).toBeCloseTo(-1, 1);
  });

  it('reports reset and restart once per press', () => {
    const input = new Input(new GamepadInput(() => []));
    input.keyboard.press('KeyR');
    expect(input.read(1 / 60).reset).toBe(true);
    expect(input.read(1 / 60).reset).toBe(false);
  });

  it('cycles the camera once from C or the right shoulder button', () => {
    const keyboard = new Input(new GamepadInput(() => []));
    keyboard.keyboard.press('KeyC');
    expect(keyboard.read(1 / 60).camera).toBe(true);
    expect(keyboard.read(1 / 60).camera).toBe(false);
    const pad = fakePad({ buttons: [] });
    const input = new Input(new GamepadInput(() => [pad]));
    (pad.buttons[BUTTON.rb] as { pressed: boolean }).pressed = true;
    expect(input.read(1 / 60).camera).toBe(true);
    expect(input.read(1 / 60).camera).toBe(false);
  });

  it('turns keys and pad buttons into menu actions', () => {
    const input = new Input(new GamepadInput(() => []));
    input.keyboard.press('ArrowDown');
    input.keyboard.press('Enter');
    expect(input.read(1 / 60).actions).toEqual(['down', 'confirm']);

    const pad = fakePad({ buttons: [] });
    (pad.buttons[BUTTON.a] as { pressed: boolean }).pressed = true;
    const padded = new Input(new GamepadInput(() => [pad]));
    expect(padded.read(1 / 60).actions).toContain('confirm');
    expect(padded.read(1 / 60).actions).not.toContain('confirm');   // held, not pressed again
  });

  it('makes exactly one action out of escape', () => {
    /* */
    const input = new Input(new GamepadInput(() => []));
    input.keyboard.press('Escape');
    expect(input.read(1 / 60).actions).toEqual(['pause']);
  });
});

// Retired the ◀ ▶ buttons for a floating left/right stick; these assert the stick instead.
describe('phone steering stick', () => {
  it('maps horizontal drag to steer with a dead zone, symmetric full lock and half lock between', () => {
    expect(dragSteer(0)).toBe(0);
    expect(dragSteer(STEER_DEAD_PX)).toBe(0);
    expect(dragSteer(-STEER_DEAD_PX)).toBe(0);
    expect(dragSteer(STEER_FULL_PX)).toBe(1);
    expect(dragSteer(-STEER_FULL_PX)).toBe(-1);
    expect(dragSteer(400)).toBe(1);
    const half = (STEER_DEAD_PX + STEER_FULL_PX) / 2;
    expect(dragSteer(half)).toBeCloseTo(.5, 6);
    expect(dragSteer(-half)).toBeCloseTo(-.5, 6);
    expect(STEER_FULL_PX).toBeGreaterThanOrEqual(60); expect(STEER_FULL_PX).toBeLessThanOrEqual(80);
  });

  it('follows the thumb without a ramp, straightens on lift, and brakes with an independent finger', () => {
    const input = new Input(new GamepadInput(() => []));
    expect(input.read(1 / 60).car.throttle).toBe(0);
    input.touch.simulate(1, 'steer', 100, 300); input.touch.simulate(2, 'brake');
    input.touch.drag(1, -(STEER_DEAD_PX + STEER_FULL_PX) / 2);
    const half = input.read(1 / 60).car;
    expect(half.steer).toBeCloseTo(-.5, 6);
    expect(half.brake).toBe(1); expect(half.throttle).toBe(0);
    input.touch.drag(1, 300);
    expect(input.read(1 / 60).car.steer).toBe(1);
    input.touch.lift(1);
    expect(input.read(1 / 60).car.steer).toBe(0);
    input.touch.lift(2);
    expect(input.read(1 / 60).car).toEqual({ throttle: 1, brake: 0, steer: 0 });
  });

  it('keeps steering when the drag leaves the zone, ignores mouse and non-control touches, clears on cancel and blur', () => {
    const root = document.createElement('div');
    const zone = document.createElement('div'); zone.dataset.touchControl = 'steer';
    const brake = document.createElement('button'); brake.dataset.touchControl = 'brake';
    const other = document.createElement('div');
    root.append(zone, brake, other); document.body.append(root);
    const input = new Input(new GamepadInput(() => [])).attachTouch(root);
    const fire = (target: EventTarget, type: string, id: number, x = 0, pointerType = 'touch') => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: id, pointerType, clientX: x, clientY: 200 }); target.dispatchEvent(event);
    };
    fire(zone, 'pointerdown', 1, 100, 'mouse'); expect(input.touch.used).toBe(false);
    fire(other, 'pointerdown', 2, 100); expect(input.touch.steer).toBe(0); expect(input.touch.brake).toBe(0);
    fire(zone, 'pointerdown', 3, 100);
    expect(zone.dataset.held).toBe('true');
    fire(other, 'pointermove', 3, 100 + 500);   // far outside the left half: still this finger's stick
    expect(input.read(1 / 60).car.steer).toBe(1);
    expect(input.touch.stick).toEqual({ originX: 100, originY: 200, dx: 500 });
    fire(zone, 'pointerdown', 4, 50); fire(other, 'pointermove', 4, -400);
    expect(input.touch.steer).toBe(1);             // a second finger cannot take the stick over
    fire(zone, 'pointercancel', 3); expect(input.touch.steer).toBe(0);
    expect(zone.dataset.held).toBeUndefined(); expect(input.touch.stick).toBeNull();
    fire(brake, 'pointerdown', 5); expect(input.touch.brake).toBe(1); expect(brake.dataset.held).toBe('true');
    fire(zone, 'pointerdown', 6, 100); fire(other, 'pointermove', 6, 20);
    window.dispatchEvent(new Event('blur'));
    expect(zone.dataset.held).toBeUndefined(); expect(brake.dataset.held).toBeUndefined();
    expect(input.read(1 / 60).car).toEqual({ throttle: 1, brake: 0, steer: 0 });
    fire(zone, 'pointerdown', 7, 100); fire(zone, 'lostpointercapture', 7); expect(input.touch.steeringHeld).toBe(false);
    input.detach(); root.remove();
  });
});

describe('two keyboard players', () => {
  it('keeps simultaneous steering, pedals, confirmation and rescue edges with their owner', () => {
    const input = new Input(new GamepadInput(() => []));
    for (const key of ['KeyW', 'KeyA', 'ArrowDown', 'ArrowRight', 'Space', 'Slash']) input.keyboard.press(key);
    const [left, right] = input.readPlayers(.1, 2);
    expect(left!.car).toEqual({ throttle: 1, brake: 0, steer: -.45 });
    expect(right!.car).toEqual({ throttle: 0, brake: 1, steer: .45 });
    expect(left!.actions).toEqual(['up', 'left', 'confirm']);
    expect(right!.actions).toEqual(['down', 'right']);
    expect([left!.reset, right!.reset]).toEqual([false, true]);
    input.keyboard.press('KeyC'); input.keyboard.press('Period');
    expect(input.readPlayers(.1, 2).map(player => player.camera)).toEqual([true, true]);
    input.keyboard.press('Enter'); input.keyboard.press('KeyR'); input.keyboard.press('Escape');
    const second = input.readPlayers(.1, 2);
    expect(second.map(player => player.actions)).toEqual([['pause'], ['confirm']]);
    expect(second.map(player => player.reset)).toEqual([true, false]);
    expect(input.readPlayers(.1, 2).every(player => player.actions.length === 0 && !player.reset)).toBe(true);
  });

  it('clears held and pending input on blur and explicit pause, and returns to original single-player keys', () => {
    const input = new Input(new GamepadInput(() => [])).attach().attachTouch();
    try {
      for (const key of ['KeyW', 'ArrowUp', 'KeyA', 'ArrowRight', 'Space']) input.keyboard.press(key);
      input.readPlayers(.1, 2);
      input.keyboard.press('Enter');
      window.dispatchEvent(new Event('blur'));
      expect(input.readPlayers(.1, 2).map(player => player.car)).toEqual([
        { throttle: 0, brake: 0, steer: 0 }, { throttle: 0, brake: 0, steer: 0 },
      ]);
      input.keyboard.press('KeyW'); input.keyboard.press('ArrowRight'); input.clearHeld();
      expect(input.readPlayers(.1, 2).every(player => player.actions.length === 0 && player.car.throttle === 0 && player.car.steer === 0)).toBe(true);
      input.keyboard.press('ArrowUp'); input.keyboard.press('KeyD');
      expect(input.readPlayers(.1, 1)[0]!.car).toEqual({ throttle: 1, brake: 0, steer: .45 });
    } finally { input.detach(); }
  });
});
