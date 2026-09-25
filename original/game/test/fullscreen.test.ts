import { describe, expect, it, vi } from 'vitest';
import { MobileFullscreen } from '../src/app/fullscreen';
import { fitReplica } from '../src/ui/Replica';

function fakeDocument() {
  const doc = document.implementation.createHTMLDocument('fs');
  let element: Element | null = null;
  Object.defineProperty(doc, 'fullscreenElement', { get: () => element });
  Object.defineProperty(doc, 'hidden', { get: () => false, configurable: true });
  const request = vi.fn(async () => { element = doc.documentElement; doc.dispatchEvent(new Event('fullscreenchange')); });
  doc.documentElement.requestFullscreen = request as never;
  const leave = () => { element = null; doc.dispatchEvent(new Event('fullscreenchange')); };
  const tap = () => { const b = doc.createElement('button'); doc.body.append(b); b.click(); b.remove(); };
  return { doc, request, leave, tap };
}

describe('Phone fullscreen', () => {
  it('a tap on any button takes a phone fullscreen, and the button offer disappears', async () => {
    const { doc, request, tap } = fakeDocument();
    const fs = new MobileFullscreen(true, doc);
    expect(fs.offer).toBe(true);
    tap(); await Promise.resolve(); await Promise.resolve();
    expect(request).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(fs.active).toBe(true);
    expect(fs.offer).toBe(false);
  });

  it('a copy, share or new-tab button does not spend its tap on a fullscreen request', async () => {
    const { doc, request } = fakeDocument();
    new MobileFullscreen(true, doc);
    for (const make of [
      () => { const b = doc.createElement('button'); b.dataset.action = 'text'; return b; },
      () => { const b = doc.createElement('button'); b.dataset.share = 'copy'; return b; },
      () => { const b = doc.createElement('button'); b.dataset.action = 'homepage'; return b; },
      () => { const d = doc.createElement('dialog'); d.setAttribute('open', ''); const b = doc.createElement('button'); d.append(b); doc.body.append(d); return b; },
    ]) {
      const b = make(); if (!b.isConnected) doc.body.append(b); b.click(); b.remove();
    }
    await Promise.resolve(); await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });

  it('a player who leaves fullscreen is not pulled back by later taps, but the button still works', async () => {
    vi.useFakeTimers();
    const { doc, request, leave, tap } = fakeDocument();
    const fs = new MobileFullscreen(true, doc);
    tap(); await Promise.resolve(); await Promise.resolve();
    leave(); vi.advanceTimersByTime(600); vi.useRealTimers();
    tap(); await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    expect(fs.offer).toBe(true);
    expect(await fs.enter()).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('switching away from the page is not the player leaving fullscreen', async () => {
    vi.useFakeTimers();
    const { doc, request, leave, tap } = fakeDocument();
    let hidden = false;
    Object.defineProperty(doc, 'hidden', { get: () => hidden, configurable: true });
    let clock = 1000;
    new MobileFullscreen(true, doc, () => clock);
    tap(); await Promise.resolve(); await Promise.resolve();
    leave(); hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    clock += 600; vi.advanceTimersByTime(600);
    hidden = false; clock += 5000; doc.dispatchEvent(new Event('visibilitychange'));
    vi.useRealTimers();
    tap(); await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does nothing on a desktop', async () => {
    const { doc, request, tap } = fakeDocument();
    const fs = new MobileFullscreen(false, doc);
    tap(); await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
    expect(fs.offer).toBe(false);
  });
});

describe('Menu canvas follows the window', () => {
  for (const [w, h] of [[850, 327], [1400, 540], [1000, 1000], [1280, 720]] as const) it(`fills ${w}x${h} without distortion`, () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const host = document.createElement('div'), frame = document.createElement('div');
    Object.defineProperties(host, { clientWidth: { value: w }, clientHeight: { value: h } });
    fitReplica(host, frame)();
    vi.unstubAllGlobals();
    const scale = Number(/scale\(([\d.]+)\)/.exec(frame.style.transform)![1]);
    const width = parseFloat(frame.style.width), height = parseFloat(frame.style.height);
    expect(width * scale).toBeCloseTo(w, 3);
    expect(height * scale).toBeCloseTo(h, 3);
    const design = w < 1000 ? [844, 474.75] : [1024, 576];
    expect(width).toBeGreaterThanOrEqual(design[0]! - 1e-6);
    expect(height).toBeGreaterThanOrEqual(design[1]! - 1e-6);
  });
});
