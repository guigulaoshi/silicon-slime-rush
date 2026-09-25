import { afterEach, expect, it, vi } from 'vitest';
import { isMobileDevice } from '../src/app/device';
import { LandscapeGuard } from '../src/ui/LandscapeGuard';
import { I18n } from '../src/ui/i18n';
import { Input } from '../src/input/Input';
import { GamepadInput } from '../src/input/Gamepad';

let guard: LandscapeGuard | undefined;
afterEach(() => { guard?.dispose(); guard = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });
function resize(width: number, height: number) {
  vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', height);
  window.dispatchEvent(new Event('resize'));
}

it('identifies phones and tablets without treating a narrow desktop as mobile', () => {
  expect(isMobileDevice({ userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 }, false, true)).toBe(true);
  expect(isMobileDevice({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }, false, true)).toBe(true);
  expect(isMobileDevice({ userAgent: 'Android', platform: 'Linux', maxTouchPoints: 5 }, true, false)).toBe(true);
  resize(390, 844);
  expect(isMobileDevice({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 }, false, true)).toBe(false);
});

it('blocks the underlying phone UI in portrait and announces both orientation transitions', () => {
  resize(390, 844);
  const ui = document.createElement('div'); document.body.append(ui);
  const changed = vi.fn();
  guard = new LandscapeGuard(new I18n('en'), ui, changed, true);
  expect(guard.node.hidden).toBe(false); expect(ui.inert).toBe(true);
  expect(changed).toHaveBeenLastCalledWith(true);
  resize(844, 390);
  expect(guard.node.hidden).toBe(true); expect(ui.inert).toBe(false);
  expect(changed).toHaveBeenLastCalledWith(false);
  resize(390, 844); expect(changed).toHaveBeenCalledTimes(3);
});

it('leaves desktop portrait layouts accessible', () => {
  resize(390, 844);
  const ui = document.createElement('div'); const changed = vi.fn();
  guard = new LandscapeGuard(new I18n('en'), ui, changed, false);
  expect(guard.blocked).toBe(false); expect(guard.node.hidden).toBe(true);
  expect(ui.inert).toBe(false); expect(changed).not.toHaveBeenCalled();
});

it('keeps a current-language manual fallback after the browser rejects orientation lock', async () => {
  resize(390, 844);
  const full = vi.fn(async () => {});
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: full });
  const lock = vi.fn(async () => { throw new Error('NotSupportedError'); });
  vi.stubGlobal('screen', { orientation: { lock } });
  const i18n = new I18n('zh');
  guard = new LandscapeGuard(i18n, document.createElement('div'), () => {}, true);
  const button = guard.node.querySelector('button')!; button.click();
  await vi.waitFor(() => expect(guard!.node.textContent).toContain('请手动横放'));
  expect(full).toHaveBeenCalledOnce(); expect(lock).toHaveBeenCalledWith('landscape');
  expect(button.disabled).toBe(false); expect(guard.blocked).toBe(true);
  i18n.set('en'); guard.render();
  expect(guard.node.textContent).toContain('Please turn your device sideways');
  expect(guard.node.textContent).not.toContain('横放');
  delete (document.documentElement as any).requestFullscreen;
});

it('clears held fingers and digital steering together', () => {
  const input = new Input(new GamepadInput(() => []));
  input.touch.simulate(1, 'brake'); input.touch.simulate(2, 'steer'); input.touch.drag(2, 90);
  input.keyboard.press('ArrowRight');
  expect(input.read(.2).car.brake).toBe(1);
  input.clearHeld();
  expect(input.read(1 / 60).car).toEqual({ throttle: 1, brake: 0, steer: 0 });
  expect(input.read(1 / 60).actions).toEqual([]);
});
