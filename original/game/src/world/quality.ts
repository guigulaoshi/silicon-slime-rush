import type { Quality } from './World';

export interface QualityLimits {
  slimes: number;
  colossi: number;
  groundEffects: number;
  particles: number;
  puddles: number;
  fallingSlimes: number;
}

/** One owner for every pool ceiling that changes with rendering quality. */
export const QUALITY_LIMITS: Readonly<Record<Quality, Readonly<QualityLimits>>> = {
  high: { slimes: 512, colossi: 12, groundEffects: 40, particles: 2000, puddles: 300, fallingSlimes: 24 },
  medium: { slimes: 512, colossi: 8, groundEffects: 24, particles: 1000, puddles: 160, fallingSlimes: 16 },
  low: { slimes: 512, colossi: 6, groundEffects: 12, particles: 400, puddles: 80, fallingSlimes: 8 },
};

/** Rendering resolution is capped per quality level: a Retina panel would otherwise draw 4K. */
export const PIXEL_RATIO_CAP: Record<Quality, number> = { high: 1.5, medium: 1.25, low: 1 };
export const SHADOWS: Record<Quality, boolean> = { high: true, medium: true, low: false };
/** Multisampling is fixed when a WebGL context is made, so changing it rebuilds the renderer. */
export const ANTIALIAS: Record<Quality, boolean> = { high: true, medium: true, low: false };

export const AUTO_SAMPLE_SECONDS = 3;

/**
 * A phone starts auto at low. Starting a phone at high for the opening sample put its GPU
 * memory at the peak exactly when the tiles, textures and shadow maps load, and an Android Chrome
 * that loses its GPU that way blocks 3D for the site until the browser restarts.
 */
export function autoQualityStart(mobile: boolean): Quality { return mobile ? 'low' : 'high'; }

/** The quality a scene is built at from the saved setting: auto starts where `autoQualityStart` says. */
export function startingQuality(setting: Quality | 'auto', mobile: boolean): Quality {
  return setting === 'auto' ? autoQualityStart(mobile) : setting;
}

/**
 * The opening sample that may move auto quality off its start -- none on a phone, whose auto stays
 * low for the whole race. let a phone rise to medium
 * three seconds in, and rising swaps in a whole new renderer mid-race, since antialiasing is fixed when
 * a WebGL context is made. The call came after a Pixel 10 Pro XL white-screened: its PowerVR driver
 * crashed Chrome's GPU process inside an instanced draw, where the Pixel 7 Pro's Mali never had.
 */
export function autoQualitySamplerFor(mobile: boolean): AutoQualitySampler | null {
  return mobile ? null : new AutoQualitySampler();
}

/**
 * Measures rendered frames for the opening three seconds, then chooses the highest tier with
 * enough headroom to stay above the 30 fps floor once the race gets busier.
 */
export class AutoQualitySampler {
  private seconds = 0;
  private frames = 0;
  private settled: Quality | null = null;

  sample(frameSeconds: number): Quality | null {
    if (this.settled) return this.settled;
    if (!(frameSeconds > 0) || !Number.isFinite(frameSeconds)) return null;
    this.seconds += Math.min(frameSeconds, 0.25);
    this.frames++;
    if (this.seconds < AUTO_SAMPLE_SECONDS) return null;
    const fps = this.frames / this.seconds;
    this.settled = fps >= 52 ? 'high' : fps >= 36 ? 'medium' : 'low';
    return this.settled;
  }
}
