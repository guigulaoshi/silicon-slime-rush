import { type Page } from '@playwright/test';
import { checkMaximum, checkMinimum } from '../test-support/resource-limit';

export const SOFTWARE_RENDERER = /swiftshader|software|llvmpipe/i;

export interface FrameSample {
  at: number;
  fps: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  slowFramesPct: number;
  frames: number;
  triangles: number;
  drawCalls: number;
  tilesLoaded: number;
}


export async function rendererFacts(page: Page) {
  return page.evaluate(() => {
    const w = window.game.session.world;
    const gl = w.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
      renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
      userAgent: navigator.userAgent,
    };
  });
}


export async function captureFrames(page: Page, at: number, durationMs = 6000, passes = 1): Promise<FrameSample> {
  return page.evaluate(([s, duration, renderPasses]: number[]) => new Promise<FrameSample>((done) => {
    const intervals: number[] = [];
    let last = performance.now();
    const started = last;
    let triangles = 0;
    let drawCalls = 0;
    let tilesLoaded = 0;
    const frame = (now: number) => {
      intervals.push(now - last);
      last = now;
      const w = window.game.session.world;
      // The game already rendered once in its own callback. Repeat the complete scene to put a
      // declared, reproducible GPU safety factor on the local phone load profile.
      for (let pass = 1; pass < renderPasses!; pass++) w.render();
      triangles = Math.max(triangles, w.renderer.info.render.triangles);
      drawCalls = Math.max(drawCalls, w.renderer.info.render.calls);
      tilesLoaded = Math.max(tilesLoaded, w.streamer.stats.loaded);
      if (now - started < duration!) { requestAnimationFrame(frame); return; }
      const sorted = intervals.slice(1).sort((a, b) => a - b);
      const percentile = (p: number) => sorted[Math.min(sorted.length - 1,
        Math.floor((sorted.length - 1) * p))] ?? 0;
      const elapsed = sorted.reduce((sum, value) => sum + value, 0);
      done({
        at: s!, fps: Number((sorted.length * 1000 / elapsed).toFixed(1)),
        medianMs: Number(percentile(0.5).toFixed(2)),
        p95Ms: Number(percentile(0.95).toFixed(2)),
        p99Ms: Number(percentile(0.99).toFixed(2)),
        slowFramesPct: Number((sorted.filter((ms) => ms > 20).length / sorted.length * 100).toFixed(1)),
        frames: sorted.length, triangles, drawCalls, tilesLoaded,
      });
    };
    requestAnimationFrame(frame);
  }), [at, durationMs, passes]);
}

export function reportDesktopFrames(fps: number, p95: number, label: string): void {
  checkMinimum(fps, 'desktop_min_fps', label);
  checkMaximum(p95, 'desktop_max_p95_ms', `${label} p95`);
}
