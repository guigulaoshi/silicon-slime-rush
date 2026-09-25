import * as THREE from 'three';
import { BILLBOARD_SLOTS, type BillboardSlot } from '../track/types';
import type { Language } from '../ui/i18n';
import type { MaterialLibrary } from './materials';
declare const __BILLBOARD_MANIFEST__: Manifest;

/**
 * What a billboard says.
 *
 * The pipeline places boards and stamps each with one of fourteen slots; everything a player reads is
 * here, loaded at runtime from `public/billboards/manifest.json`. That split is the whole point:
 * adding an advert is a line of JSON, not a rebuild of eleven tracks.
 */
export interface FaceCopy {
  /** A finished picture, relative to `public/`. Given one, the layout fields below are ignored. */
  image?: string;
  headline?: string;
  sub?: string;
  /** Legacy fields are retained for old data, but never drawn as substitute social artwork. */
  qr?: string;
  handle?: string;
  bg?: string;
  fg?: string;
  /** Where a social face leads.: a social face carries the same copy under both languages. */
  platform?: string;
  target?: string;
}

export interface Face {
  id: string;
  kind: 'space' | 'social';
  zh: FaceCopy;
  en: FaceCopy;
}

export interface Manifest { version: number; faces: Face[] }

export const MANIFEST_URL = 'billboards/manifest.json';
const SHIPPED = __BILLBOARD_MANIFEST__;
const AVAILABLE = SHIPPED.faces.find(face => face.kind === 'space')!;
const W = 1024;
const H = 512;   // every panel in the pipeline is 2:1, both styles, so one canvas shape serves all

/** Slot i shows face i. Fewer faces than slots repeat; more than slots are simply not seen. */
export function faceForSlot(manifest: Manifest, slot: BillboardSlot): Face | null {
  if (!manifest.faces.length) return null;
  const i = BILLBOARD_SLOTS.indexOf(slot);
  return manifest.faces[i % manifest.faces.length] ?? null;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, weight: string, max: number, start: number): number {
  let size = start;
  do {
    ctx.font = `${weight} ${size}px system-ui, "PingFang SC", "Noto Sans SC", sans-serif`;
    if (ctx.measureText(text).width <= max) break;
    size -= 4;
  } while (size > 12);
  return size;
}

/**
 * Draw one face onto a canvas.
 *
 * Available space is explicitly bilingual, independent of the interface language. Social faces
 * must use their real finished artwork; a missing picture falls back to available space.
 */
export function drawFace(canvas: HTMLCanvasElement, face: Face, _lang: Language): void {
  const available = face.kind === 'space' ? face : AVAILABLE;
  const copy = available.zh;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const bg = copy.bg ?? '#1d2a3a';
  const fg = copy.fg ?? '#ffffff';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = fg;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, W - 28, H - 28);
  ctx.globalAlpha = 1;

  ctx.fillStyle = fg;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  const englishSize = fitText(ctx, available.en.headline!, '800', W - 128, 96);
  ctx.fillText(available.en.headline!, W / 2, 238);
  fitText(ctx, available.zh.headline!, '600', W - 128, Math.floor(englishSize * 0.6));
  ctx.fillText(available.zh.headline!, W / 2, 334);
}

function textureFrom(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Holds the manifest and keeps all fourteen slot materials drawn.
 *
 * The manifest still has a zh and en copy per face, so the runtime follows the interface language,
 * but every social face gives both the same picture: all seven platforms show once
 * per cycle whatever language the player picked. Available space is bilingual on one face anyway.
 */
export class Billboards {
  private manifest: Manifest = SHIPPED;
  private images = new Map<string, THREE.Texture>();
  /** The language the boards should be showing; the manifest may still be in flight. */
  private wanted: Language = 'en';
  private drawn = false;
  ready = false;

  constructor(private readonly materials: MaterialLibrary) {}

  get faces(): Face[] {
    return this.manifest.faces;
  }

  /** Use the build's copy if a preview/cache serves an older manifest, never legacy placeholders. */
  async load(
    baseUrl: string,
    lang: Language,
    fetcher: typeof fetch = fetch,
    loadImage: (url: string) => Promise<THREE.Texture> = (url) => new THREE.TextureLoader().loadAsync(url),
  ): Promise<boolean> {
    this.wanted = lang;
    const base = baseUrl.replace(/\/$/, '');
    this.draw(lang);
    let fresh = true;
    try {
      const res = await fetcher(`${base}/${MANIFEST_URL}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Manifest;
      if (!Array.isArray(data.faces) || !data.faces.length || !Number.isInteger(data.version) || data.version < SHIPPED.version ||
          !data.faces.every(face => (face.kind === 'space' || face.kind === 'social')
            && face.zh && face.en && (face.kind === 'space'
              ? (typeof face.zh.headline === 'string' && face.zh.headline.length > 0 &&
                 typeof face.en.headline === 'string' && face.en.headline.length > 0)
              : [face.zh, face.en].every(copy => typeof copy.image === 'string' && copy.image.length > 0
                && typeof copy.platform === 'string' && copy.platform.length > 0
                && typeof copy.target === 'string' && copy.target.length > 0)))) {
        throw new Error('old or invalid content manifest');
      }
      this.manifest = data;
    } catch (err) {
      console.warn('billboards: using current bundled content', err);
      this.manifest = SHIPPED;
      fresh = false;
    }
    const paths = new Set(this.manifest.faces.flatMap((face) =>
      [face.zh?.image, face.en?.image].filter((path): path is string => Boolean(path)),
    ));
    await Promise.all([...paths].map(async (path) => {
      try {
        const texture = await loadImage(`${base}/${path}?v=${this.manifest.version}`);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        this.images.set(path, texture);
      } catch (err) {
        console.warn(`billboards: could not load ${path}`, err);
      }
    }));
    // the player may have switched language while this was in flight, so draw what is wanted now
    this.draw(this.wanted);
    this.ready = true;
    return fresh;
  }

  setLanguage(lang: Language): void {
    if (lang === this.wanted && this.drawn) return;
    this.wanted = lang;
    if (this.manifest.faces.length) this.draw(lang);
  }

  private draw(lang: Language): void {
    this.drawn = true;
    for (const slot of BILLBOARD_SLOTS) {
      const face = faceForSlot(this.manifest, slot);
      if (!face) { this.materials.setBillboardFace(slot, null); continue; }
      const copy = face[lang] ?? face.en;
      if (face.kind === 'social' && copy.target && copy.image) {
        const source = this.images.get(copy.image);
        const texture = source?.clone() ?? null;
        if (texture) texture.needsUpdate = true;
        if (texture) { this.materials.setBillboardFace(slot, texture); continue; }
      }
      const canvas = document.createElement('canvas');
      drawFace(canvas, face, lang);
      this.materials.setBillboardFace(slot, textureFrom(canvas));
    }
  }
}
