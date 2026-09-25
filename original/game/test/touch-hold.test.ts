import { describe, expect, it } from 'vitest';
import { isAppleTouchDevice, steersWithButtons } from '../src/app/device';
import { TouchInput } from '../src/input/Touch';

// IPhone and iPad steer with two hold buttons; Android keeps the drag stick.
describe('hold-button steering', () => {
  it('holds full lock while ◀ or ▶ is down, cancels when both are, and straightens on release', () => {
    const touch = new TouchInput();
    expect(touch.steer).toBe(0); expect(touch.steeringHeld).toBe(false);
    touch.pressTouch(1, 'left');
    expect(touch.steer).toBe(-1); expect(touch.steeringHeld).toBe(true);
    touch.pressTouch(2, 'brake');
    expect(touch.brake).toBe(1); expect(touch.steer).toBe(-1);
    touch.pressTouch(3, 'right');
    expect(touch.steer).toBe(0);
    touch.releaseTouch(1);
    expect(touch.steer).toBe(1);
    touch.releaseTouch(3); touch.releaseTouch(2);
    expect(touch.steer).toBe(0); expect(touch.steeringHeld).toBe(false); expect(touch.brake).toBe(0);
    touch.pressTouch(4, 'right'); touch.clear();
    expect(touch.steer).toBe(0);
  });

  it('picks the buttons for iPhone, iPad and iPadOS-as-Mac, and the stick for Android and desktop', () => {
    const nav = (userAgent: string, platform = 'Linux', maxTouchPoints = 5) => ({ userAgent, platform, maxTouchPoints });
    expect(steersWithButtons(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone'))).toBe(true);
    expect(steersWithButtons(nav('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad'))).toBe(true);
    expect(steersWithButtons(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 'MacIntel', 5))).toBe(true);
    expect(steersWithButtons(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 'MacIntel', 0))).toBe(false);
    expect(steersWithButtons(nav('Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/128.0 Mobile'))).toBe(false);
    expect(isAppleTouchDevice(nav('Mozilla/5.0 (Windows NT 10.0) Chrome/128.0', 'Win32', 10))).toBe(false);
  });
});

// Follow-up: on iPhone / iPad the visible buttons take native touches and ignore the pointer
// path, so a pointercancel / lostpointercapture right after the press (the suspected itch.io frame
// failure) no longer releases them; only the touch's own end does.
describe('native touch buttons', () => {
  const touchEvent = (type: string, identifier: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'changedTouches', { value: [{ identifier }] });
    return event;
  };
  it('stay held through pointercancel and lostpointercapture until their own touch ends', async () => {
    const { bindTouchButton } = await import('../src/input/Touch');
    const touch = new TouchInput().attach(window);
    const zone = document.createElement('div'), left = document.createElement('button'), brake = document.createElement('button');
    zone.append(left); document.body.append(zone, brake);
    bindTouchButton(left, 'left', zone); bindTouchButton(brake, 'brake');
    const start = touchEvent('touchstart', 7);
    left.dispatchEvent(start); brake.dispatchEvent(touchEvent('touchstart', 8));
    expect(start.defaultPrevented).toBe(true);
    expect([touch.steer, touch.brake, zone.dataset.held]).toEqual([-1, 1, 'true']);
    for (const type of ['pointercancel', 'lostpointercapture', 'pointerup']) for (const id of [0, 1, 7, 8]) {
      window.dispatchEvent(Object.assign(new Event(type), { pointerId: id, pointerType: 'touch' }));
    }
    expect([touch.steer, touch.brake]).toEqual([-1, 1]);
    left.dispatchEvent(touchEvent('touchend', 7));
    expect([touch.steer, touch.brake, zone.dataset.held]).toEqual([0, 1, undefined]);
    brake.dispatchEvent(touchEvent('touchcancel', 8));
    expect(touch.brake).toBe(0);
    touch.detach(); zone.remove(); brake.remove();
  });
});
