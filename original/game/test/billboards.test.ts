import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Billboards, drawFace, faceForSlot, type Face, type Manifest } from '../src/world/Billboards';
import { MaterialLibrary } from '../src/world/materials';
import { BILLBOARD_SLOTS, billboardFaceMaterial } from '../src/track/types';

const shipped = () => JSON.parse(
  readFileSync(resolve(process.cwd(), 'public', 'billboards', 'manifest.json'), 'utf-8'),
) as Manifest;

const face = (id: string, kind: 'space' | 'social'): Face => ({
  id, kind,
  zh: { headline: '中文', sub: '副标题' },
  en: { headline: 'English', sub: 'subtitle' },
});

describe('the shipped manifest', () => {
  it('fills fourteen alternating slots with seven owner ads and seven available spaces', () => {
    const m = shipped();
    expect(m.faces).toHaveLength(BILLBOARD_SLOTS.length);
    expect(m.faces.filter((f) => f.kind === 'social')).toHaveLength(7);
    expect(m.faces.filter((f) => f.kind === 'space')).toHaveLength(7);
    expect(m.faces.map((f) => f.kind)).toEqual(
      Array.from({ length: 14 }, (_, i) => i % 2 === 0 ? 'social' : 'space'),
    );
    //
    // all seven platforms, one slot each, the same face whichever language the interface is in.
    const social = m.faces.filter((f) => f.kind === 'social');
    expect(social.map((f) => f.zh.platform).sort()).toEqual(
      ['bilibili', 'douyin', 'tiktok', 'wechat', 'x', 'xiaohongshu', 'youtube']);
    for (const f of social) expect(f.en, f.id).toEqual(f.zh);
  });

  it('says something in both languages on every face', () => {
    for (const f of shipped().faces) {
      for (const lang of ['zh', 'en'] as const) {
        expect(f[lang]?.headline || f[lang]?.image, `${f.id}.${lang}`).toBeTruthy();
        if (f.kind === 'social') {
          expect(f[lang].platform, `${f.id}.${lang} has no platform`).toBeTruthy();
          expect(f[lang].target, `${f.id}.${lang} has no recorded destination`).toBeTruthy();
        }
      }
      if (f.kind === 'social') {
        expect(f.zh.image).toMatch(/^billboards\/social-[a-z]+-(zh|en)\.png$/);
        expect(f.en.image).toBe(f.zh.image);
      } else {
        expect(f.zh.headline).toMatch(/[\u3400-\u9fff]/);
        expect(f.en.headline).not.toMatch(/[\u3400-\u9fff]/);
      }
    }
  });

  it('has unique ids', () => {
    const ids = shipped().faces.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * The manifest version is the images' cache key (`?v=`). both changed billboard
 * pictures without bumping it, so a returning player's browser keeps the old ones. This records the
 * pictures' content next to the version it was shipped under: change either alone and it goes red.
 */
const SHIPPED_IMAGES = { version: 8, sha256: '9ebce0d009c0234d6819883b7a221605e6c0192cf18f359305b43c4b34349de2' };

describe('the billboard cache key', () => {
  it('moves the manifest version whenever a billboard picture changes', () => {
    const manifest = shipped();
    const paths = [...new Set(manifest.faces.flatMap(face => [face.zh?.image, face.en?.image])
      .filter((path): path is string => Boolean(path)))].sort();
    const hash = createHash('sha256');
    for (const path of paths) hash.update(path + '\0').update(readFileSync(resolve(process.cwd(), 'public', path)));
    expect({ version: manifest.version, sha256: hash.digest('hex') },
      'billboard pictures changed: bump manifest.json version, then record the new pair here').toEqual(SHIPPED_IMAGES);
  });
});

describe('slot assignment', () => {
  it('gives each slot its own face when there are enough of them', () => {
    const m = shipped();
    const ids = BILLBOARD_SLOTS.map((s) => faceForSlot(m, s)?.id);
    expect(new Set(ids).size).toBe(BILLBOARD_SLOTS.length);
  });

  it('repeats when there are fewer faces than slots, and shows nothing when there are none', () => {
    const two: Manifest = { version: 1, faces: [face('a', 'space'), face('b', 'social')] };
    expect(faceForSlot(two, 'a')?.id).toBe('a');
    expect(faceForSlot(two, 'c')?.id).toBe('a');
    expect(faceForSlot({ version: 1, faces: [] }, 'a')).toBeNull();
  });
});

describe('drawing a face', () => {
  it('keeps both available-space languages on the same face in either interface language', () => {
    const calls: string[] = [];
    const layout: { font: string; y: number }[] = [];
    let font = '';
    const rectangles = vi.fn();
    const ctx = {
      fillRect: rectangles, strokeRect: () => {}, measureText: () => ({ width: 10 }),
      fillText: (t: string, _x: number, y: number) => { calls.push(t); layout.push({ font, y }); },
      set font(value: string) { font = value; }, set fillStyle(_v: string) {}, set strokeStyle(_v: string) {},
      set lineWidth(_v: number) {}, set globalAlpha(_v: number) {}, set textBaseline(_v: string) {},
      set textAlign(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    drawFace(canvas, face('x', 'space'), 'zh');
    expect(calls).toEqual(['English', '中文']);
    calls.length = 0;
    drawFace(canvas, face('x', 'space'), 'en');
    expect(calls).toEqual(['English', '中文']);
    for (const available of shipped().faces.filter(face => face.kind === 'space')) {
      for (const lang of ['zh', 'en'] as const) {
        calls.length = 0;
        drawFace(canvas, available, lang);
        expect(calls).toEqual(['AD SPACE AVAILABLE', '广告位招商']);
        const [english, chinese] = layout.slice(-2);
        expect(english!.y).toBeLessThan(chinese!.y);
        expect(Number(english!.font.split(' ')[1]!.replace('px', ''))).toBeGreaterThan(Number(chinese!.font.split(' ')[1]!.replace('px', '')));
      }
    }
    calls.length = 0;
    rectangles.mockClear();
    drawFace(canvas, { ...face('legacy-social', 'social'),
      en: { headline: 'Follow along', handle: '@handle-tbd' } }, 'en');
    expect(calls).toEqual(['AD SPACE AVAILABLE', '广告位招商']);
    expect(rectangles, 'fallback must not contain a fake QR pattern').toHaveBeenCalledTimes(1);
  });

  it('survives a browser that hands back no 2d context', () => {
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => drawFace(canvas, face('x', 'space'), 'en')).not.toThrow();
  });
});

describe('loading', () => {
  it('puts a different texture on every slot material', async () => {
    const materials = new MaterialLibrary();
    const boards = new Billboards(materials);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => shipped() });
    const loadImage = vi.fn().mockImplementation(async () => new THREE.Texture());
    expect(await boards.load('./', 'zh', fetcher as unknown as typeof fetch, loadImage)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('./billboards/manifest.json', { cache: 'no-store' });
    expect(loadImage).toHaveBeenCalledTimes(7); // one picture per platform, shared by both languages
    expect(loadImage).toHaveBeenCalledWith(`./billboards/social-x-en.png?v=${shipped().version}`);
    expect(loadImage).toHaveBeenCalledWith(`./billboards/social-douyin-zh.png?v=${shipped().version}`);
    const maps = BILLBOARD_SLOTS.map((s) => (materials.get(billboardFaceMaterial(s)) as { map?: unknown }).map);
    expect(maps.every(Boolean)).toBe(true);
    expect(new Set(maps).size).toBe(BILLBOARD_SLOTS.length);
    materials.dispose();
  });

  it('shows the same seven social pictures in either interface language', async () => {
    const materials = new MaterialLibrary();
    const boards = new Billboards(materials);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => shipped() });
    const loadImage = vi.fn().mockImplementation(async (url: string) => Object.assign(new THREE.Texture(), { name: url }));
    const shown = new Map<string, string>();
    const set = materials.setBillboardFace.bind(materials);
    vi.spyOn(materials, 'setBillboardFace').mockImplementation((slot, texture) => {
      shown.set(slot, texture?.name ?? '');
      set(slot, texture);
    });
    await boards.load('./', 'zh', fetcher as unknown as typeof fetch, loadImage);
    const chinese = new Map(shown);
    boards.setLanguage('en');
    expect(shown).toEqual(chinese);
    const pictures = [...chinese.values()].filter(Boolean);
    expect(pictures).toHaveLength(7);
    expect(new Set(pictures).size).toBe(7);
    materials.dispose();
  });

  it('uses current content and explicit available space when the manifest and images are missing', async () => {
    const materials = new MaterialLibrary();
    const boards = new Billboards(materials);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    expect(await boards.load('./', 'en', fetcher as unknown as typeof fetch,
      async () => { throw new Error('missing image'); })).toBe(false);
    for (const slot of BILLBOARD_SLOTS) {
      const map = (materials.get(billboardFaceMaterial(slot)) as THREE.MeshStandardMaterial).map;
      expect(map?.image).toBeInstanceOf(HTMLCanvasElement);
    }
    expect(boards.faces).toEqual(shipped().faces);
    warn.mockRestore();
    materials.dispose();
  });

  it('rejects an old cached placeholder manifest even when HTTP succeeds', async () => {
    const materials = new MaterialLibrary();
    const boards = new Billboards(materials);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      version: 1, faces: [{ ...face('old', 'social'),
        en: { headline: 'Follow along', handle: '@handle-tbd' } }],
    }) });
    expect(await boards.load('./', 'en', fetcher as unknown as typeof fetch,
      async () => new THREE.Texture())).toBe(false);
    expect(boards.faces).toEqual(shipped().faces);
    expect(JSON.stringify(boards.faces)).not.toContain('handle-tbd');
    warn.mockRestore();
    materials.dispose();
  });

  it('redraws in the language wanted now, not the one asked for when loading began', async () => {
    const materials = new MaterialLibrary();
    const boards = new Billboards(materials);
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((r) => { release = r; });
    const fetcher = vi.fn().mockImplementation(async () => {
      await gate;
      return { ok: true, json: async () => shipped() };
    });
    const loading = boards.load(
      './', 'en', fetcher as unknown as typeof fetch, async () => new THREE.Texture(),
    );
    boards.setLanguage('zh');            // the player switched while the manifest was in flight
    release(null);
    await loading;
    const drawn = vi.spyOn(materials, 'setBillboardFace');
    boards.setLanguage('zh');
    expect(drawn, 'already showing Chinese, so nothing to redraw').not.toHaveBeenCalled();
    drawn.mockRestore();
    materials.dispose();
  });
});
