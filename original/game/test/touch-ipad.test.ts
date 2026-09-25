import { describe, expect, it } from 'vitest';
import { barOrigin, dragSteer, STICK_ARROW_PX, STICK_HIT_SLOP_PX, TouchInput } from '../src/input/Touch';

// On an iPad, pressing the drawn ◀ / ▶ steers, and the touch listeners can cancel iOS gestures.
const bar = { left: 32, top: 278, right: 208, bottom: 322 };   // the resting bar at 844x390

describe('barOrigin', () => {
  const steerFrom = (x: number) => { const o = barOrigin(x, 300, bar); return o ? dragSteer(x - o.x) : null; };
  it('starts a press on ◀ or ▶ at full lock that way', () => {
    for (const x of [bar.left - STICK_HIT_SLOP_PX, bar.left, bar.left + 14, bar.left + STICK_ARROW_PX]) expect(steerFrom(x)).toBe(-1);
    for (const x of [bar.right + STICK_HIT_SLOP_PX, bar.right - 14, bar.right - STICK_ARROW_PX]) expect(steerFrom(x)).toBe(1);
    expect(barOrigin(bar.left + 14, 300, bar)!.y).toBe(300);          // the bar stays on its own line
  });

  it('leaves the middle of the bar and everywhere else to the floating stick, so a resting thumb steers nothing', () => {
    for (const x of [120, 120 - 30, 120 + 30, bar.left + STICK_ARROW_PX + 1, bar.right - STICK_ARROW_PX - 1]) expect(barOrigin(x, 300, bar)).toBeNull();
    expect(barOrigin(bar.right + STICK_HIT_SLOP_PX + 1, 300, bar)).toBeNull();
    expect(barOrigin(bar.left + 10, bar.top - STICK_HIT_SLOP_PX - 1, bar)).toBeNull();
    expect(barOrigin(260, 300, bar)).toBeNull();        // where touch.spec's floating-stick thumb lands
    expect(barOrigin(bar.left + 10, 300, null)).toBeNull();
  });
});

describe('TouchInput gesture cancelling', () => {
  function attached() {
    const listeners = new Map<string, (e: unknown) => void>();
    const target = {
      addEventListener: (type: string, fn: (e: unknown) => void) => { listeners.set(type, fn); },
      removeEventListener: (type: string) => { listeners.delete(type); },
    } as unknown as EventTarget;
    return { touch: new TouchInput().attach(target), listeners };
  }
  const event = (target: unknown = null) => { const e = { cancelable: true, target, prevented: false, preventDefault() { e.prevented = true; } }; return e; };

  it('cancels a touchmove while a steering or brake finger is down, and only then', () => {
    const { touch, listeners } = attached();
    const move = listeners.get('touchmove')!;
    const idle = event(); move(idle); expect(idle.prevented).toBe(false);          // menus and pause still scroll
    touch.simulate(1, 'steer', 100, 300);
    const steering = event(); move(steering); expect(steering.prevented).toBe(true);
    touch.lift(1); touch.simulate(2, 'brake');
    const braking = event(); move(braking); expect(braking.prevented).toBe(true);
    touch.lift(2);
    const after = event(); move(after); expect(after.prevented).toBe(false);
  });

  it('cancels a touchstart on a driving control and leaves any other element alone', () => {
    const { listeners } = attached();
    const start = listeners.get('touchstart')!;
    const zone = document.createElement('div'); zone.dataset.touchControl = 'brake';
    const pedal = document.createElement('button'); zone.append(pedal);
    const pause = document.createElement('button');
    const onPedal = event(pedal); start(onPedal); expect(onPedal.prevented).toBe(true);
    const onPause = event(pause); start(onPause); expect(onPause.prevented).toBe(false);
  });
});

describe('TouchInput listeners', () => {
  it('registers touchstart and touchmove as non-passive so they can cancel the browser gesture', () => {
    const seen = new Map<string, unknown>();
    const target = {
      addEventListener: (type: string, _fn: unknown, options?: unknown) => { seen.set(type, options); },
      removeEventListener: (type: string) => { seen.delete(type); },
    } as unknown as EventTarget;
    const touch = new TouchInput().attach(target);
    expect(seen.get('touchstart')).toEqual({ passive: false });
    expect(seen.get('touchmove')).toEqual({ passive: false });
    expect(seen.has('contextmenu')).toBe(true);
    touch.detach();
    expect([...seen.keys()]).toEqual([]);
  });
});
