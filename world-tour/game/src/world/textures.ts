import * as THREE from 'three';

/**
 * The texture manifest: which material wears which image, and how big it is in the world.
 *
 * Tiles carry no textures -- they name a material and the runtime hangs a shared material on it
 * (`docs/CONTRACT.md` section 3). Textures follow the same rule for the same reason: one asphalt
 * image uploaded once serves every tile that draws road, and adding one is a pipeline change that
 * needs no code. The pipeline writes this file next to the images; `pipeline/sr/textures.py`
 * generates both.
 *
 * `repeat` is in uv units and is the only field the runtime acts on. `metres` and `px` are there so
 * a person can see what the image depicts and check the arithmetic -- the pipeline derives `repeat`
 * from `metres` and the uv scale it wrote into the geometry, and a test on that side checks the
 * division. Reading `metres` here and dividing again would be a second author of the same fact
 * with no way to notice when the two disagree.
 */
export const TEXTURE_MANIFEST_URL = 'textures/manifest.json';

/** `core` must be there before the car moves; `later` may arrive after. See section 11. */
export type TextureTier = 'core' | 'later';

export interface TextureEntry {
  material: string;
  map: string;
  px: number;
  metres: number;
  repeat: [number, number];
  tier: TextureTier;
  bytes: number;
  /**
   * How polished the surface is, optional and usually a much smaller image than `map`: roughness
   * varies over metres while colour varies over centimetres. three.js reads its green channel.
   */
  roughnessMap?: string;
  roughPx?: number;
  /** Panes per image repeat (u/v), then frame width as a fraction of a pane. */
  facadePanes?: [number, number, number];
  /**
   * A city's own walls (pipeline/sr/local_style.py): up to four colour factors, one picked per building
   * from its stable identity, multiplied into the wall (not the dark glass). One street, several houses.
   */
  palette?: [number, number, number][];
  /** Tangent-space normals, OpenGL convention (green up), read as data. */
  normalMap?: string;
  /**
   * How the image is laid on the surface. `uv` (the default) reads the mesh's own uv times `repeat`.
   * `world` lays it on the world's ground plane, `metres` per image, whatever uv the mesh carries:
   * the tile terrain writes uv at 8 m and the backdrop at 24 m, and one repeat cannot serve both.
   * `triplanar` picks the plane per vertex from its normal, so a cliff face is not smeared into
   * vertical streaks by a ground-plane projection.
   */
  mapping?: 'uv' | 'world' | 'triplanar';
  /** Alpha below this is a hole (leaves): the material is cut out, two-sided, and casts a cut-out shadow. */
  cutout?: number;
}

export interface TextureManifest {
  version: number;
  textures: TextureEntry[];
}

function bad(why: string): never {
  throw new Error(`texture manifest: ${why}`);
}

/**
 * Read a manifest, or say why it cannot be read.
 *
 * Strict on purpose. A texture set that half-loads is worse than one that does not load at all:
 * the greybox colours are a coherent look and a street with two of its five materials textured is
 * not, so a manifest that is the wrong shape is refused whole and the palette stands.
 */
export function parseManifest(data: unknown): TextureManifest {
  if (typeof data !== 'object' || data === null) bad('not an object');
  const raw = data as Record<string, unknown>;
  if (raw.version !== 1) bad(`version ${String(raw.version)} is not 1`);
  if (!Array.isArray(raw.textures)) bad('no textures array');
  const textures = raw.textures.map((item, i) => {
    if (typeof item !== 'object' || item === null) bad(`textures[${i}] is not an object`);
    const e = item as Record<string, unknown>;
    const repeat = e.repeat;
    if (typeof e.material !== 'string' || !e.material) bad(`textures[${i}] has no material`);
    if (typeof e.map !== 'string' || !e.map) bad(`textures[${i}] has no map`);
    if (!Array.isArray(repeat) || repeat.length !== 2
        || !repeat.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) {
      bad(`textures[${i}] (${String(e.material)}) has no positive [u, v] repeat`);
    }
    if (e.tier !== 'core' && e.tier !== 'later') bad(`textures[${i}] tier ${String(e.tier)}`);
    if (e.roughnessMap !== undefined && (typeof e.roughnessMap !== 'string' || !e.roughnessMap)) {
      bad(`textures[${i}] (${e.material}) has a roughnessMap that is not a filename`);
    }
    if (e.normalMap !== undefined && (typeof e.normalMap !== 'string' || !e.normalMap)) {
      bad(`textures[${i}] (${e.material}) has a normalMap that is not a filename`);
    }
    if (e.mapping !== undefined && !['uv', 'world', 'triplanar'].includes(e.mapping as string)) {
      bad(`textures[${i}] (${e.material}) mapping ${String(e.mapping)}`);
    }
    if (e.mapping !== undefined && e.mapping !== 'uv' && !(typeof e.metres === 'number' && e.metres > 0)) {
      bad(`textures[${i}] (${e.material}) is laid in world space and needs positive metres`);
    }
    if (e.cutout !== undefined && !(typeof e.cutout === 'number' && e.cutout > 0 && e.cutout < 1)) {
      bad(`textures[${i}] (${e.material}) cutout ${String(e.cutout)} is not between 0 and 1`);
    }
    const panes = e.facadePanes;
    if (panes !== undefined && (!Array.isArray(panes) || panes.length !== 3
      || !panes.every(n => typeof n === 'number' && Number.isFinite(n))
      || panes[0] <= 0 || panes[1] <= 0 || panes[2] <= 0 || panes[2] >= 1)) {
      bad(`textures[${i}] (${e.material}) has invalid facadePanes`);
    }
    const palette = e.palette;
    if (palette !== undefined && (!Array.isArray(palette) || palette.length < 1 || palette.length > 4
      || !palette.every(c => Array.isArray(c) && c.length === 3 && c.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)))) {
      bad(`textures[${i}] (${e.material}) has an invalid palette`);
    }
    return {
      material: e.material, map: e.map, tier: e.tier,
      ...(panes === undefined ? {} : { facadePanes: panes as [number, number, number] }),
      ...(palette === undefined ? {} : { palette: palette as [number, number, number][] }),
      repeat: [repeat[0], repeat[1]] as [number, number],
      px: typeof e.px === 'number' ? e.px : 0,
      metres: typeof e.metres === 'number' ? e.metres : 0,
      bytes: typeof e.bytes === 'number' ? e.bytes : 0,
      ...(e.roughnessMap === undefined ? {} : { roughnessMap: e.roughnessMap }),
      ...(typeof e.roughPx === 'number' ? { roughPx: e.roughPx } : {}),
      ...(e.normalMap === undefined ? {} : { normalMap: e.normalMap as string }),
      ...(e.mapping === undefined ? {} : { mapping: e.mapping as 'uv' | 'world' | 'triplanar' }),
      ...(e.cutout === undefined ? {} : { cutout: e.cutout as number }),
    } satisfies TextureEntry;
  });
  return { version: 1, textures };
}

/**
 * Set up one loaded image to be tiled across world geometry.
 *
 * Colour, so sRGB; tiled, so both axes wrap; seen at a grazing angle down a whole street, so
 * anisotropic filtering -- a road texture without it turns to grey mush about twenty metres ahead,
 * which is exactly where the player is looking.
 */
export function configure(texture: THREE.Texture, entry: TextureEntry, anisotropy: number): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(entry.repeat[0], entry.repeat[1]);
  texture.anisotropy = Math.max(1, anisotropy);
  texture.name = entry.material;
  texture.needsUpdate = true;
  return texture;
}
