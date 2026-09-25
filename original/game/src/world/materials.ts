import * as THREE from 'three';
import { MATERIAL_NAMES, billboardFaceMaterial, type BillboardSlot,
  type MaterialName, type TimeOfDay } from '../track/types';
import { TEXTURE_MANIFEST_URL, configure, parseManifest,
  type TextureEntry, type TextureManifest } from './textures';
import type { Weather } from './Sky';

/**
 * A billboard face is lit from the front and often in the dark, so it carries a little emissive:
 * an unlit white panel at night reads as grey card, which is the one thing an advert must not do.
 */
const FACE: THREE.MeshStandardMaterialParameters = {
  color: 0xffffff, roughness: 0.9, metalness: 0, emissive: 0x222222,
};

/** Greybox palette. 0.3 swaps these for textured materials under the same names. */
const GREYBOX: Record<MaterialName, THREE.MeshStandardMaterialParameters> = {
  road: { color: 0x37373b, roughness: 0.95, metalness: 0 },
  /* */
  terrain: { color: 0x8a8460, roughness: 1, metalness: 0 },
  terrain_grass: { color: 0x5f7a3f, roughness: 1, metalness: 0 },   // 剪过的绿地：公园、球场、草坪
  terrain_scrub: { color: 0x8c8253, roughness: 1, metalness: 0 },   // 加州旱季的坡地：灌木、干草
  terrain_wood: { color: 0x374f35, roughness: 1, metalness: 0 },   // 成片的树冠，比草地深得多
  terrain_sand: { color: 0xc2b48e, roughness: 1, metalness: 0 },   // 沙滩和沙丘
  terrain_rock: { color: 0x7f7871, roughness: 1, metalness: 0 },   // 裸岩和采石面
  terrain_saltpond: { color: 0xb87470, roughness: 1, metalness: 0 },   // 盐田和湿地那种粉橘
  terrain_paved: { color: 0x6b6b6e, roughness: 1, metalness: 0 },   // 停车场、铁路场站这类硬化地面
  water: { color: 0x1d4d6b, roughness: 0.16, metalness: 0.35 },
  building: { color: 0x9e9e99, roughness: 0.85, metalness: 0 },
  barrier: { color: 0xf26b1d, roughness: 0.7, metalness: 0 },
  // The deck of a bridge is asphalt like any other road, a shade lighter because it is newer and
  // gets no dirt off a verge. It was reddish here, which made the Golden Gate look painted orange
  // all the way across, including the part you drive on.
  bridge: { color: 0x3c3c40, roughness: 0.92, metalness: 0 },
  billboard_frame: { color: 0x4c4f55, roughness: 0.6, metalness: 0.2 },
  // The floodlight housings under a board. Their glow is set from the time of day, like the faces
  // they light: a lamp that is on at midday reads as a bug, and one that is off at dusk reads as a
  // board nobody pays for any more.
  billboard_lamp: { color: 0xeee6d2, roughness: 0.4, metalness: 0.1 },
  // The fourteen slots are listed one by one rather than generated, so that adding a slot to the
  // contract fails to compile here instead of quietly rendering one board magenta.
  billboard_face_a: FACE, billboard_face_b: FACE, billboard_face_c: FACE, billboard_face_d: FACE,
  billboard_face_e: FACE, billboard_face_f: FACE, billboard_face_g: FACE, billboard_face_h: FACE,
  billboard_face_i: FACE, billboard_face_j: FACE, billboard_face_k: FACE, billboard_face_l: FACE,
  billboard_face_m: FACE, billboard_face_n: FACE,
  // Road paint is retroreflective: it throws light back at you and reads far brighter than the
  // asphalt around it, in shade as much as in sun. Lit purely by the sky it comes out blue-grey and
  // all but invisible on dark tarmac, which is what the first version of these looked like, so most
  // of their brightness is emissive rather than reflected.
  line_white: { color: 0xf4f4f0, roughness: 0.9, metalness: 0, emissive: 0x6e6e6a },
  line_yellow: { color: 0xf0bc20, roughness: 0.9, metalness: 0, emissive: 0x6a4e08 },
  // International Orange, painted steel: matte, and a touch metallic so the towers pick up the sun
  bridge_steel: { color: 0xc0362c, roughness: 0.62, metalness: 0.15 },
  bridge_metal: { color: 0x9aa1a6, roughness: 0.55, metalness: 0.45 },
  // Bay Area green is grey-green, not the emerald of a lawn: cypress, eucalyptus and dry scrub.
  foliage: { color: 0x2e4a26, roughness: 1, metalness: 0 },
  foliage_dark: { color: 0x1a3824, roughness: 1, metalness: 0 },
  foliage_palm: { color: 0x346b3d, roughness: 0.95, metalness: 0, side: THREE.DoubleSide },
  foliage_orchard: { color: 0x587b33, roughness: 1, metalness: 0 },
  foliage_scrub: { color: 0x645f38, roughness: 1, metalness: 0 },
  flower_pink: { color: 0xf24893, roughness: 0.86, metalness: 0, emissive: 0x2d0717 },
  flower_white: { color: 0xf3ecd7, roughness: 0.88, metalness: 0, emissive: 0x222019 },
  flower_blue: { color: 0x5c99ef, roughness: 0.84, metalness: 0, emissive: 0x091936 },
  flower_purple: { color: 0x9e57d1, roughness: 0.86, metalness: 0, emissive: 0x1e092b },
  slime_scenery: { color: 0x52c733, roughness: 0.62, metalness: 0,
    emissive: 0x0b2408 },
  trunk: { color: 0x453529, roughness: 1, metalness: 0 },
  /* */
  guardrail: { color: 0x9aa1a6, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide },
  sidewalk: { color: 0xa8a49b, roughness: 0.95, metalness: 0 },
  // The five facades. Their colours are only what shows before their textures arrive (and in a
  // tree that never generated them), so they are the average of each image rather than a palette
  // choice: mirrored glass, painted render, board-formed concrete, ribbed metal, parking deck.
  house_roof_slate: { color: 0x424953, roughness: .92, metalness: 0 },
  house_roof_tile: { color: 0x975a43, roughness: .96, metalness: 0 },
  house_trim: { color: 0xd5ceba, roughness: .82, metalness: 0 },
  building_glass: { color: 0x33505a, roughness: 0.25, metalness: 0.1 },
  building_stucco: { color: 0xb3a48c, roughness: 0.95, metalness: 0 },
  building_concrete: { color: 0x9a9793, roughness: 0.9, metalness: 0 },
  building_metal: { color: 0x9ea3a6, roughness: 0.5, metalness: 0.35 },
  building_parking: { color: 0x86837e, roughness: 0.92, metalness: 0 },
  // A landmark cannot go through the generic building palette: its colour is part of its shape.
  // These averages match the generated maps below and keep a coherent fallback before they load.
  building_landmark_glass: { color: 0x1e404a, roughness: 0.22, metalness: 0.12,
    emissive: 0x071012 },
  building_landmark_pale: { color: 0xc8c1ae, roughness: 0.88, metalness: 0 },
  building_landmark_solar: { color: 0x2a3344, roughness: 0.42, metalness: 0.28,
    emissive: 0x242b2c },
  building_landmark_metal: { color: 0xc5c7c3, roughness: 0.48, metalness: 0.38,
    emissive: 0x252624 },
  building_landmark_roof: { color: 0xc7c7bf, roughness: 0.72, metalness: 0.08,
    emissive: 0x20201e },
};

const SNOW_COVER = new Set<string>([
  'house_roof_slate', 'house_roof_tile', 'house_trim',
  'road', 'bridge', 'sidewalk', 'terrain', 'terrain_grass', 'terrain_scrub', 'terrain_wood',
  'terrain_sand', 'terrain_rock', 'terrain_paved',
]);

/**
 * One material per name for the whole session.
 *
 * Tiles ship without textures and name their material instead, so every tile that draws asphalt
 * shares one material and one texture upload. A name with no entry gets magenta rather than a
 * silent default, because a missing material is a pipeline bug and has to be visible.
 */
/**
 * Ripples on the water, done in the shader rather than with a normal map.
 *
 * The bay is half of what this game looks at and a flat colour reads as painted card. Three sine
 * waves crossing at different angles and speeds are enough to break up the reflection and make the
 * sun scatter across it; a texture would be another download and would tile visibly over a
 * kilometre of water.
 */
function rippleWater(material: THREE.MeshStandardMaterial): (t: number) => void {
  const time = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterPos;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWaterPos;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWaterPos.xz;
          vec2 slope = vec2(0.0);
          // direction, wavelength and speed of each train; amplitudes fall with wavelength so the
          // small ripples only ever ruffle the big swell
          slope += 0.055 * vec2(0.62, 0.79) * cos(dot(p, vec2(0.062, 0.079)) + uTime * 0.55);
          slope += 0.032 * vec2(-0.88, 0.47) * cos(dot(p, vec2(-0.185, 0.099)) - uTime * 0.9);
          slope += 0.018 * vec2(0.31, -0.95) * cos(dot(p, vec2(0.121, -0.372)) + uTime * 1.7);
          // A distant pixel covers many waves; average them instead of drawing moire stripes.
          float pixelMetres = max(length(dFdx(p)), length(dFdy(p)));
          slope *= exp(-pixelMetres * 0.04);
          normal = normalize(normal + vec3(slope.x, 0.0, slope.y));
        }`);
  };
  material.customProgramCacheKey = () => 'ripple-water';
  return (t: number) => { time.value = t; };
}

/* */
export const FACADE_UV_METRES = 3.0;

/**
 * Windows on the greybox buildings, drawn in the shader from the wall's own uv.
 *
 * A city of blank boxes is the last thing that says "greybox" once the roads are painted and the
 * hillsides are green, and the buildings here come from footprints that carry no facade data at
 * all. Floors every 3.5 m and a column of glass every 3 m is enough for a block to read as
 * offices from a moving car, and it costs nothing to download.
 *
 * Both axes of the pattern come from uv rather than from world position, and the roof test uses a
 * world-space normal rather than `vNormal`:
 *
 * - `vNormal` is in *view* space, so a rule shaped like "does this wall face x or z" answered a
 *   different question every time the camera turned. Picking the wrong axis made `fract` almost
 *   constant across a whole wall, which drew one window the size of the building, or none at all
 *   -- and a wall with no windows keeps the full base colour while its neighbours are darkened,
 *   so it also read as a floodlit block. Facing the same building from another direction changed
 *   what it looked like.
 * - A world axis is not the wall's axis either. Projecting a 3 m column spacing onto x or z
 *   stretches it to 3/cos(theta) for a wall at theta to the axis: 4.2 m at 45 degrees, 6 m at 60.
 *   Campus footprints are full of such walls. `uv.x` is arc length along the wall, so it is 3 m on
 *   every wall at every angle.
 * - Floors counted from absolute world y drift against a building that stands on a hill: the
 *   pavement band at 3-4.2 m sat underground on anything above it, and shoreline is already at
 *   3.6-7.3 m while Twin Peaks and Sand Hill are far higher. `uv.y` is measured from each
 *   building's own base, so a tower on a hilltop gets the same ground floor as one at sea level.
 */
function windowedBuilding(material: THREE.MeshStandardMaterial): (dark: number) => void {
  const night = { value: 0 };
  const panes = { value: new THREE.Vector3() };
  material.userData.facadePanes = panes;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.uniforms.uFacadePanes = panes;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        #ifndef USE_UV1
        attribute vec2 uv1;
        #endif
        varying vec2 vFacadeUv;
        varying vec2 vFacadeIdentity;
        varying vec3 vFacadeNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFacadeUv = uv;
        vFacadeIdentity = uv1;
        vFacadeNormal = mat3(modelMatrix) * objectNormal;`);
    // facadeFarAxes: a phone at low quality draws a distant row of windows with less than
    // a pixel each and no antialiasing, so every pixel landed on a pane or a frame, a lit room or a
    // dark one, by chance -- and the chance changed with every centimetre the camera moved, which is a
    // wall of flickering black and white dots. Far away the pattern turns into what it averages to, the
    // way a mipmap does for an image. Per axis, because a wall seen along a street loses its columns
    // long before its floors. This note lives out here because comments inside the shader string ship.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        uniform vec3 uFacadePanes;
        varying vec2 vFacadeUv;
        varying vec2 vFacadeIdentity;
        varying vec3 vFacadeNormal;
        float facadeHash(vec2 p) {
          p = fract(p * vec2(.1031, .11369));
          p += dot(p, p.yx + 19.19);
          return fract(p.x * p.y);
        }
        // How much of a window one pixel covers, per axis: 0 while windows are several pixels wide, 1 at about one.
        vec2 facadeFarAxes(vec2 grid) { return smoothstep(vec2(.3), vec2(.75), fwidth(grid)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 facadeNormal = abs(normalize(vFacadeNormal));
        float facadeWall = clamp((max(facadeNormal.x, facadeNormal.z) - facadeNormal.y) * 3.0, 0.0, 1.0);
        vec2 facadeMetres = vFacadeUv * ${FACADE_UV_METRES.toFixed(1)};
        vec2 facadeGrid = vec2(facadeMetres.x / 3.0, (facadeMetres.y - 1.2) / 3.5);
        vec2 facadeCell = fract(facadeGrid);
        float facadeGlass = 0.0;
        // the per-window lights fade to their average once either axis is past resolving
        float facadeFar = 0.0;
        #ifndef USE_MAP
          vec2 far = facadeFarAxes(facadeGrid);
          facadeFar = max(far.x, far.y);
          // half a pixel either side of each edge: a hard step up close, a box-filtered one far out
          vec2 soft = fwidth(facadeGrid) * .5 + 1e-4;
          vec2 pane = smoothstep(vec2(.12) - soft, vec2(.12) + soft, facadeCell)
            * (vec2(1.0) - smoothstep(vec2(.66, .52) - soft, vec2(.66, .52) + soft, facadeCell));
          pane = mix(pane, vec2(.54, .40), far);
          facadeGlass = pane.x * pane.y * facadeWall;
          float ground = 1.0 - smoothstep(3.0, 4.2, facadeMetres.y);
          float shopfront = smoothstep(.1 - soft.x, .1 + soft.x, facadeCell.x)
            * (1.0 - smoothstep(.9 - soft.x, .9 + soft.x, facadeCell.x));
          facadeGlass = max(facadeGlass, ground * facadeWall * mix(shopfront, .8, far.x));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.30, .36, .42), facadeGlass);
        #else
          // The texture producer supplies its pane layout; concrete and metal have no windows.
          if (uFacadePanes.x > 0.0) {
            facadeGrid = vMapUv * uFacadePanes.xy;
            facadeCell = fract(facadeGrid);
            vec2 edge = abs(facadeCell - .5) * 2.0;
            // uniform branch, so the derivatives are defined
            vec2 far = facadeFarAxes(facadeGrid);
            facadeFar = max(far.x, far.y);
            // the frame edge is at least a pixel soft, and near by exactly the .06 it always was
            vec2 frameEdge = vec2(1.0 - uFacadePanes.z - .03);
            vec2 soft = max(vec2(.03), fwidth(facadeGrid));
            vec2 pane = vec2(1.0) - smoothstep(frameEdge - soft, frameEdge + soft, edge);
            pane = mix(pane, frameEdge, far);
            facadeGlass = pane.x * pane.y * facadeWall;
          }
        #endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, .075, facadeGlass);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, .22, facadeGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Quantized glTF UVs have ample room between these 1024 stable identity buckets.
          float seed = floor(vFacadeIdentity.x * 1024.0 + .5);
          vec2 room = floor(facadeGrid);
          bool residential = vFacadeIdentity.y > .5;
          vec2 group = residential ? room : vec2(floor(room.x / 4.0), room.y);
          float occupied = step(residential ? .48 : .36, facadeHash(group + vec2(seed, seed * .37)));
          occupied = mix(occupied, residential ? .52 : .64, facadeFar);
          float buildingTone = facadeHash(vec2(seed, 17.0));
          vec3 officeColor = mix(vec3(.70, .84, 1.0), vec3(1.0, .84, .62), buildingTone);
          float household = mix(facadeHash(room + vec2(seed * .73, 41.0)), .5, facadeFar);
          vec3 homeColor = mix(vec3(1.0, .72, .43), vec3(1.0, .91, .73), household);
          vec3 lightColor = residential ? homeColor : officeColor;
          float brightness = residential ? mix(.48, .78, household)
            : mix(.58, .88, facadeHash(vec2(seed, 31.0))) * mix(.92, 1.08, facadeHash(group + seed));
          totalEmissiveRadiance += lightColor * brightness * facadeGlass * occupied * uNight;
        }`);
  };
  material.customProgramCacheKey = () => 'windowed-building';
  return (dark: number) => { night.value = dark; };
}

/** A venue's flood wash follows its authored vertex colours, including red seats and green turf. */
export function lightAuthoredLandmark(material: THREE.MeshStandardMaterial, time: TimeOfDay): void {
  if (time !== 'night') return;
  // A baked wash costs no extra lights, shadow maps or draws. Glass reads as a softly lit lobby.
  if (material.name === 'building_landmark_glass') material.emissive.setRGB(0.035, 0.022, 0.010);
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.065;');
  };
  material.customProgramCacheKey = () => 'authored-landmark-night-wash-v1';
  material.needsUpdate = true;
}

export class MaterialLibrary {
  private readonly cache = new Map<string, THREE.Material>();
  private readonly animated: ((t: number) => void)[] = [];
  private readonly facadeNight: ((dark: number) => void)[] = [];
  private textured = 0;
  private weather: Weather = 'clear';
  readonly missing: THREE.Material;

  constructor() {
    this.missing = new THREE.MeshStandardMaterial({ color: 0xff00ff, roughness: 0.5 });
    for (const name of MATERIAL_NAMES) {
      // keep the contract name on the material: it is how a scene dump, a test, or a bug report
      // says which of these a mesh ended up with
      const material = new THREE.MeshStandardMaterial({ ...GREYBOX[name], name });
      if (name === 'water') this.animated.push(rippleWater(material));
      // Every facade material gets the pattern; the shader itself stands down once a texture
      // arrives, so this is also what a tree with no generated textures falls back to.
      if (name.startsWith('building')) this.facadeNight.push(windowedBuilding(material));
      this.cache.set(name, material);
    }
  }

  /**
   * Turn the roadside lighting up or down for the track's time of day.
   *
   * Billboards are lit: by day the floodlights are dead metal and the face is a picture in the
   * sun, by night both come up and the advert is the brightest thing on the road.
   */
  lightFor(timeOfDay: TimeOfDay): void {
    const dark = timeOfDay === 'night' ? 1 : 0;
    for (const setNight of this.facadeNight) setNight(dark);
    for (const [name, material] of this.cache) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (name === 'billboard_lamp') material.emissive.setScalar(0.1 + 0.85 * dark);
      else if (name.startsWith('billboard_face_')) material.emissive.setScalar(0.13 + 0.62 * dark);
    }
  }

  private applyWeather(name: string, material: THREE.MeshStandardMaterial): void {
    const base = GREYBOX[name as MaterialName];
    if (SNOW_COVER.has(name)) {
      material.color.set(this.weather === 'snow' ? 0xe1e9ec : material.map ? 0xffffff : base?.color ?? 0xffffff);
      material.emissive.set(this.weather === 'snow' ? 0x7d898d : base?.emissive ?? 0x000000);
      material.emissiveIntensity = this.weather === 'snow' ? .72 : 1;
    }
    if (['road', 'bridge', 'terrain_paved'].includes(name)) {
      material.roughness = this.weather === 'rain' ? .28 : this.weather === 'snow' ? .82
        : material.roughnessMap ? 1 : (base?.roughness ?? 1);
      material.metalness = this.weather === 'rain' ? .08 : (base?.metalness ?? 0);
    }
    material.needsUpdate = true;
  }

  /** Wet asphalt reflects the storm; snow visibly covers the road, verge, and open ground. */
  weatherFor(weather: Weather): void {
    this.weather = weather;
    for (const [name, material] of this.cache) {
      if (material instanceof THREE.MeshStandardMaterial) this.applyWeather(name, material);
    }
  }

  /** Move anything that moves. `seconds` is wall time since the track loaded. */
  animate(seconds: number): void {
    for (const tick of this.animated) tick(seconds);
  }

  get(name: string | undefined): THREE.Material {
    if (!name) return this.missing;
    return this.cache.get(name) ?? this.missing;
  }

  /**
   * Hang an advert on one billboard slot. Every board in that slot, in every tile, changes at once,
   * which is the point of the slots: the picture is session state, not tile data.
   */
  setBillboardFace(slot: BillboardSlot, texture: THREE.Texture | null): void {
    const mat = this.cache.get(billboardFaceMaterial(slot)) as THREE.MeshStandardMaterial | undefined;
    if (!mat) return;
    mat.map?.dispose();
    mat.map = texture;
    // The advert is its own emissive map, so what glows at dusk is the picture rather than a white
    // rectangle behind it. Without this a lit board is a lightbox with an image switched off.
    mat.emissiveMap = texture;
    mat.color.set(texture ? 0xffffff : 0xd8d8d4);
    mat.needsUpdate = true;
  }

  /**
   * Hang the generated textures on the materials that have one.
   *
   * Same shape as the billboard manifest and for the same reason: a missing or broken file leaves
   * the greybox palette standing rather than failing a race. 0.3 is the version that stops being
   * greybox, and every step of that is one more entry in a manifest the pipeline writes -- no code
   * changes as textures arrive.
   *
   * Not awaited by the caller. A street that gains its concrete a second late is better than a
   * second of nothing, which is the same trade the backdrop makes.
   */
  async loadTextures(baseUrl: string, anisotropy = 8,
                     fetcher: typeof fetch = fetch,
                     load: (url: string) => Promise<THREE.Texture>
                       = (url) => new THREE.TextureLoader().loadAsync(url)): Promise<number> {
    const base = baseUrl.replace(/\/$/, '');
    let manifest: TextureManifest;
    try {
      const res = await fetcher(`${base}/${TEXTURE_MANIFEST_URL}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = parseManifest(await res.json());
    } catch (err) {
      console.warn('textures: none loaded, the greybox palette stands', err);
      return 0;
    }
    const dir = `${base}/${TEXTURE_MANIFEST_URL.replace(/\/[^/]*$/, '')}`;
    const applied = await Promise.all(manifest.textures.map(async (entry): Promise<number> => {
      if (!this.cache.has(entry.material)) {
        console.error(`textures: no material named "${entry.material}" to put ${entry.map} on`);
        return 0;
      }
      try {
        const [map, rough] = await Promise.all([
          load(`${dir}/${entry.map}`),
          entry.roughnessMap ? load(`${dir}/${entry.roughnessMap}`) : Promise.resolve(null),
        ]);
        this.applyTexture(entry, configure(map, entry, anisotropy),
          rough && configure(rough, entry, anisotropy));
        return 1;
      } catch (err) {
        console.error(`textures: ${entry.map} did not load`, err);
        return 0;
      }
    }));
    return applied.reduce((a, b) => a + b, 0);
  }

  /**
   * The base colour goes white when a map arrives: `map` and `color` multiply, so leaving the
   * greybox tint on would darken the image by it and no texture would ever look like its own file.
   */
  private applyTexture(entry: TextureEntry, texture: THREE.Texture,
                       roughness: THREE.Texture | null): void {
    const mat = this.cache.get(entry.material) as THREE.MeshStandardMaterial | undefined;
    if (!mat) return;
    if (!mat.map) this.textured++;
    mat.map?.dispose();
    mat.map = texture;
    const panes = mat.userData.facadePanes as { value: THREE.Vector3 } | undefined;
    if (panes) panes.value.fromArray(entry.facadePanes ?? [0, 0, 0]);
    mat.color.setScalar(1);
    if (roughness) {
      // The map is greyscale data, not a picture: sRGB decoding would bend every value.
      roughness.colorSpace = THREE.NoColorSpace;
      mat.roughnessMap?.dispose();
      mat.roughnessMap = roughness;
      // `roughness` and `roughnessMap` multiply, exactly like `color` and `map`. The greybox
      // scalar was tuned for a material with no map; left there it would scale the whole map down
      // by it and make every textured surface glossier than its own file says.
      mat.roughness = 1;
    }
    this.applyWeather(entry.material, mat);
  }

  /** How many materials are wearing a texture. The empty-world guard reads it; see e2e/world.ts. */
  get texturedCount(): number {
    return this.textured;
  }

  /** Names asked for that the library does not have; the loader reports these once per track. */
  unknown(names: Iterable<string>): string[] {
    return [...new Set([...names].filter((n) => !this.cache.has(n)))];
  }

  dispose(): void {
    for (const m of this.cache.values()) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      (m as THREE.MeshStandardMaterial).roughnessMap?.dispose();
      m.dispose();
    }
    this.missing.dispose();
    this.cache.clear();
  }
}
