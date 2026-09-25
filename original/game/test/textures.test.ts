import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaterialLibrary } from '../src/world/materials';
import { configure, parseManifest, type TextureEntry } from '../src/world/textures';

/**
 * The texture manifest, and what happens when it is not there.
 *
 * Textures are build output (`python -m sr.cli textures`, gitignored), which is the same shape of
 * asset that produced's car-in-an-empty-sky screenshot. So the interesting cases here are
 * all the ones where something is missing or wrong: the greybox palette has to survive them whole,
 * because a street with two of its five materials textured looks worse than one with none.
 */
const ENTRY: TextureEntry = {
  material: 'sidewalk', map: 'sidewalk.webp', px: 512,
  metres: 2, repeat: [2, 1.075], tier: 'core', bytes: 7886,
};

const manifest = (textures: unknown[] = [ENTRY]) => ({ version: 1, textures });

/** A fetch that hands back one JSON body, or refuses the way a missing file does. */
function fetching(body: unknown | null, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300, status, json: async () => body,
  })) as unknown as typeof fetch;
}

const loader = () => vi.fn(async (_url: string) => new THREE.Texture());

afterEach(() => vi.restoreAllMocks());

describe('reading the manifest', () => {
  it('takes the shape the pipeline writes', () => {
    const m = parseManifest(manifest());
    expect(m.textures).toHaveLength(1);
    expect(m.textures[0]!.repeat).toEqual([2, 1.075]);
  });

  it.each([
    ['not an object', 42],
    ['a version it does not know', { version: 2, textures: [] }],
    ['no textures array', { version: 1 }],
    ['an entry with no material', manifest([{ map: 'a.webp', repeat: [1, 1], tier: 'core' }])],
    ['an entry with no map', manifest([{ material: 'road', repeat: [1, 1], tier: 'core' }])],
    ['a repeat that is not a pair', manifest([{ ...ENTRY, repeat: [2] }])],
    ['a repeat of zero', manifest([{ ...ENTRY, repeat: [2, 0] }])],
    ['a tier nobody defined', manifest([{ ...ENTRY, tier: 'soon' }])],
    ['an invalid pane frame width', manifest([{ ...ENTRY, facadePanes: [2, 1, 1] }])],
    ['a missing pane dimension', manifest([{ ...ENTRY, facadePanes: [2, 1] }])],
    ['a roughnessMap that is not a filename', manifest([{ ...ENTRY, roughnessMap: 7 }])],
  ])('refuses %s', (_why, data) => {
    expect(() => parseManifest(data)).toThrow(/texture manifest/);
  });
});

it('loads the texture producer pane layout into the shared facade shader', async () => {
  const lib = new MaterialLibrary();
  const entry = { ...ENTRY, material: 'building_stucco', repeat: [1, 1], facadePanes: [1, 1, .34] };
  await lib.loadTextures('.', 8, fetching(manifest([entry])), loader());
  const mat = lib.get('building_stucco') as THREE.MeshStandardMaterial;
  expect(mat.userData.facadePanes.value.toArray()).toEqual([1, 1, .34]);
  const noPanes = lib.get('building_concrete') as THREE.MeshStandardMaterial;
  expect(noPanes.userData.facadePanes.value.toArray()).toEqual([0, 0, 0]);
  lib.dispose();
});

describe('the optional roughness map', () => {
  const ROUGH: TextureEntry = { ...ENTRY, material: 'road', map: 'road.webp', px: 1024,
    metres: 4, repeat: [1, 1], roughnessMap: 'road_rough.webp', roughPx: 512 };

  it('is loaded and hung beside the colour map', async () => {
    const lib = new MaterialLibrary();
    const load = loader();
    expect(await lib.loadTextures('.', 8, fetching(manifest([ROUGH])), load)).toBe(1);
    const mat = lib.get('road') as THREE.MeshStandardMaterial;
    expect(load.mock.calls.map((c) => c[0])).toEqual(['./textures/road.webp', './textures/road_rough.webp']);
    expect(mat.roughnessMap).not.toBeNull();
    // greybox `road` is roughness 0.95; `roughness` and `roughnessMap` multiply, so leaving it
    // there would darken every value in the map by it
    expect(mat.roughness).toBe(1);
  });

  it('is data rather than a picture, so it is not sRGB-decoded', async () => {
    const lib = new MaterialLibrary();
    await lib.loadTextures('.', 8, fetching(manifest([ROUGH])), loader());
    const mat = lib.get('road') as THREE.MeshStandardMaterial;
    expect(mat.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(mat.map!.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('leaves roughness alone on a material that has no roughness map', async () => {
    const lib = new MaterialLibrary();
    await lib.loadTextures('.', 8, fetching(manifest()), loader());
    const mat = lib.get('sidewalk') as THREE.MeshStandardMaterial;
    expect(mat.roughnessMap).toBeNull();
    expect(mat.roughness).toBe(0.95);
  });

  it('fails the whole material when its roughness map will not load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const lib = new MaterialLibrary();
    const load = vi.fn(async (url: string) => {
      if (url.endsWith('_rough.webp')) throw new Error('404');
      return new THREE.Texture();
    });
    expect(await lib.loadTextures('.', 8, fetching(manifest([ROUGH])), load)).toBe(0);
    // half a material -- colour with no roughness -- is the inconsistent state the manifest rule
    // exists to avoid, so the road stays greybox rather than going white and shiny
    const mat = lib.get('road') as THREE.MeshStandardMaterial;
    expect(mat.map).toBeNull();
    expect(mat.color.getHex()).toBe(0x37373b);
  });
});

describe('setting a loaded image up to tile', () => {
  it('wraps on both axes, repeats what the manifest says, and stays colour', () => {
    const t = configure(new THREE.Texture(), ENTRY, 8);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
    expect(t.wrapT).toBe(THREE.RepeatWrapping);
    expect([t.repeat.x, t.repeat.y]).toEqual([2, 1.075]);
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(t.anisotropy).toBe(8);
  });
});

describe('hanging them on the materials', () => {
  it('puts the map on the named material and lets the image carry the colour', async () => {
    const lib = new MaterialLibrary();
    const n = await lib.loadTextures('.', 8, fetching(manifest()), loader());
    const mat = lib.get('sidewalk') as THREE.MeshStandardMaterial;
    expect(n).toBe(1);
    expect(lib.texturedCount).toBe(1);
    expect(mat.map).not.toBeNull();
    // greybox `sidewalk` is 0xa8a49b; left there it would multiply the image and darken every
    // texture by its own placeholder colour
    expect(mat.color.getHex()).toBe(0xffffff);
  });

  it('asks for the file next to the manifest, not next to the track', async () => {
    const load = loader();
    const fetcher = fetching(manifest());
    await new MaterialLibrary().loadTextures('./', 8, fetcher, load);
    expect((fetcher as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0])
      .toBe('./textures/manifest.json');
    expect(load.mock.calls[0]![0]).toBe('./textures/sidewalk.webp');
  });

  it('leaves the greybox palette alone when there is no manifest', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lib = new MaterialLibrary();
    const n = await lib.loadTextures('.', 8, fetching(null, 404), loader());
    expect(n).toBe(0);
    expect(lib.texturedCount).toBe(0);
    expect((lib.get('sidewalk') as THREE.MeshStandardMaterial).map).toBeNull();
    expect((lib.get('sidewalk') as THREE.MeshStandardMaterial).color.getHex()).toBe(0xa8a49b);
  });

  it('applies none of a manifest it cannot read, rather than the part it understood', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lib = new MaterialLibrary();
    const broken = manifest([ENTRY, { ...ENTRY, material: 'road', tier: 'whenever' }]);
    expect(await lib.loadTextures('.', 8, fetching(broken), loader())).toBe(0);
    expect(lib.texturedCount).toBe(0);
  });

  it('reports a material name the library does not have instead of dropping it quietly', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lib = new MaterialLibrary();
    const n = await lib.loadTextures('.', 8, fetching(manifest([{ ...ENTRY, material: 'kerb' }])), loader());
    expect(n).toBe(0);
    expect(error.mock.calls[0]![0]).toContain('kerb');
  });

  it('survives one image that will not load and keeps the others', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const lib = new MaterialLibrary();
    const load = vi.fn(async (url: string) => {
      if (url.endsWith('road.webp')) throw new Error('404');
      return new THREE.Texture();
    });
    const two = manifest([ENTRY, { ...ENTRY, material: 'road', map: 'road.webp' }]);
    expect(await lib.loadTextures('.', 8, fetching(two), load)).toBe(1);
    expect((lib.get('road') as THREE.MeshStandardMaterial).map).toBeNull();
  });
});
