import { afterEach, expect, it, vi } from 'vitest';
import { loadingBar } from '../src/ui/LoadingBar';
import { bootScreen } from '../src/ui/screens';
import { I18n } from '../src/ui/i18n';

it('never moves the loading bar backwards except on reset', () => {
  const bar = loadingBar();
  bar.set(0.4);
  bar.set(0.2);
  expect(bar.value).toBe(0.4);
  expect(bar.node.getAttribute('aria-valuenow')).toBe('40');
  bar.set(3);
  expect(bar.value).toBe(1);
  bar.reset();
  expect(bar.node.getAttribute('aria-valuenow')).toBe('0');
});

afterEach(() => { vi.unstubAllGlobals(); });

it('the percentage starts at 0%, counts up instead of jumping to 100%, and a new load starts over at 0%', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => { frames.length = 0; });
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const screen = bootScreen(new I18n('en'), () => {});
  const text = () => screen.node.querySelector('.loading-percent')!.textContent;
  const fill = screen.node.querySelector('.loading-bar-fill') as HTMLElement;
  expect(text(), 'before any progress').toBe('0%');
  const frame = (t: number) => frames.splice(0).forEach(cb => cb(t));
  screen.setProgress(1);
  expect(text(), 'a load that finishes at once still shows 0% first').toBe('0%');
  frame(100); expect(text()).toBe('25%');
  frame(200); expect(text()).toBe('50%');
  frame(500); expect(text()).toBe('100%');
  expect(frames).toHaveLength(0);
  // Second load: the old 100% is cleared on the spot, with no animated slide back down.
  screen.setProgress(0);
  expect(text()).toBe('0%');
  expect(fill.style.width).toBe('0%');
  expect(fill.style.transition).toBe('');
  expect(screen.node.querySelector('.loading-bar')!.hasAttribute('data-complete')).toBe(false);
  screen.setProgress(.57); frame(1000); frame(2000);
  expect(text()).toBe('57%');
  expect(fill.style.width).toBe('57%');
  vi.restoreAllMocks();
});

it('never shows a negative or falling percentage when a frame is stamped before the load started counting', () => {
  // RequestAnimationFrame hands over the time the frame began, which can be earlier than the
  // performance.now() read in setProgress; the count then stepped backwards and showed "-2%".
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => { frames.length = 0; });
  vi.spyOn(performance, 'now').mockReturnValue(1000);
  const screen = bootScreen(new I18n('en'), () => {});
  const text = () => screen.node.querySelector('.loading-percent')!.textContent!;
  const frame = (t: number) => frames.splice(0).forEach(cb => cb(t));
  const seen: number[] = [];
  screen.setProgress(.6);
  for (const t of [992, 996, 1040, 1030, 1100, 1300]) { frame(t); seen.push(Number(text().replace('%', ''))); }
  expect(text()).toBe('60%');
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
  vi.restoreAllMocks();
});
