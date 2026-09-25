import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Spline } from '../track/Spline';
import type { TimeOfDay } from '../track/types';

const MAX_LIGHTS = 96;
const POLE_HEIGHT = 5.7;
const HEAD_X = 1.95;
const HEAD_HEIGHT = 5.28;

/** Evenly spaced stations leave neither a dark final kilometre nor a dense seam on loop tracks. */
const LIGHT_SPACING = 56;

/** Evenly spaced stations; every track is lit at one spacing since tracks stopped being classed (349). */
export function nightLightStations(spline: Spline): number[] {
  const spacing = LIGHT_SPACING;
  const count = Math.min(MAX_LIGHTS, Math.max(0, Math.floor(spline.length / spacing)));
  return Array.from({ length: count }, (_, i) => (i + 0.5) * spline.length / count);
}

/**
 * What a street's lamps look like, by route. The original's cobra-head is a Bay Area
 * arterial lamp, and it stood on every street in the world; the route's `lampStyle` picks the
 * local one. `head` is where the light comes from, in the lamp's own frame (x towards the road).
 */
export interface LampStyle {
  body(): THREE.BufferGeometry;
  lens(): THREE.BufferGeometry;
  head: [number, number];
  bodyColor: number;
  metalness: number;
  lensColor: number;
  /** The glass by day, when it is not the default milk glass: a lantern's clear panes read dark. */
  dayLens?: { color: number; roughness: number; metalness: number };
}

export const LAMP_STYLES = {
  cobra: {
    body: lampBodyGeometry, lens: lensGeometry, head: [HEAD_X - 0.20, HEAD_HEIGHT - 0.12],
    bodyColor: 0x343a3f, metalness: 0.72, lensColor: 0xffd58a,
  },
  // Chang'an Avenue's huabiao lamps (photographs, Wikimedia Commons "Tiananmen lamp post.jpg" and
  // "Beijing lamp - panoramio.jpg"): a cream-painted column, and above it the part that says Beijing --
  // a gilded head: fluted gold shaft, a lotus cup, S-scroll arms and a gold holder under each of
  // thirteen milk-glass globes (eight low, four high, one on top). Sizes are estimates from the photos.
  // The body carries per-vertex colour and metalness, so cream paint and gold stay one draw.
  huabiao: {
    body: huabiaoBody, lens: huabiaoGlobes, head: [0, 7.9],
    bodyColor: 0xffffff, metalness: 1, lensColor: 0xfff1d8,
  },
  // The old European city's cast-iron post with a lantern on top (Paris, Rome; photographs).
  lantern: {
    body: lanternBody, lens: lanternGlass, head: [0, 4.35],
    bodyColor: 0x1d2320, metalness: 0.55, lensColor: 0xffd9a0,
    dayLens: { color: 0x7d8b8c, roughness: 0.08, metalness: 0.35 },
  },
} satisfies Record<string, LampStyle>;
export type LampStyleName = keyof typeof LAMP_STYLES;

function merged(parts: THREE.BufferGeometry[], what: string): THREE.BufferGeometry {
  const out = mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
  for (const g of parts) g.dispose();
  if (!out) throw new Error(`${what} geometry could not be merged`);
  out.computeBoundingSphere();
  return out;
}

const CREAM = new THREE.Color(0xe6dcc4), GOLD = new THREE.Color(0xc9a14a);
// lower ring: 8 globes at radius .9; upper ring: 4 at radius .5; one on top
const HB_LOW = { n: 8, r: 0.9, y: 7.72 }, HB_HIGH = { n: 4, r: 0.5, y: 8.22 }, HB_TOP = 8.66, HB_GLOBE = 0.22;

/** Paint one part: its colour and how metallic it is (1 gold, 0 paint), read by the lamp material. */
function tint(g: THREE.BufferGeometry, color: THREE.Color, metal: number): THREE.BufferGeometry {
  const geometry = g.index ? g.toNonIndexed() : g;
  const n = geometry.getAttribute('position').count;
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => color.toArray()[i % 3]!), 3));
  geometry.setAttribute('metal', new THREE.Float32BufferAttribute(new Array(n).fill(metal), 1));
  if (g !== geometry) g.dispose();
  return geometry;
}

/** A lathe from (radius, height) pairs, with optional petals round its rim (`lobes`, `depth`). */
function lathe(profile: [number, number][], lobes = 0, depth = 0, segments = 24): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  if (lobes) {
    const p = g.getAttribute('position'), top = profile[profile.length - 1]![1], low = profile[0]![1];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = (y - low) / Math.max(1e-6, top - low);
      const k = 1 + depth * t * t * Math.cos(lobes * Math.atan2(z, x));
      p.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
  }
  return g;
}

/** A fluted shaft: `flutes` shallow grooves round a cylinder. */
function fluted(r: number, h: number, y: number, flutes: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, flutes * 4, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), k = 1 - 0.12 * Math.max(0, Math.cos(flutes * Math.atan2(z, x)));
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  g.computeVertexNormals(); g.translate(0, y, 0);
  return g;
}

/** A gilded arm from the shaft out to one globe's holder: out, down a little, then up (an S-scroll). */
function scrollArm(from: [number, number], to: [number, number], angle: number): THREE.BufferGeometry {
  const [r0, y0] = from, [r1, y1] = to;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(r0, y0, 0), new THREE.Vector3(r0 + (r1 - r0) * .35, y0 - .22, 0),
    new THREE.Vector3(r0 + (r1 - r0) * .8, y1 - .3, 0), new THREE.Vector3(r1, y1, 0)]);
  const g = new THREE.TubeGeometry(curve, 12, 0.035, 6, false);
  g.rotateY(angle);
  return g;
}

/** The gold holder under a globe: a small flared cup with petals. */
function holder(r: number, y: number, angle: number): THREE.BufferGeometry {
  const g = lathe([[0.03, 0], [0.06, 0.05], [0.09, 0.14], [0.16, 0.24]], 6, 0.18, 18);
  g.translate(r, y, 0); g.rotateY(angle);
  return g;
}

function huabiaoBody(): THREE.BufferGeometry {
  const cream: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = [];
  // stepped plinth and a tapering painted column
  const plinth = new THREE.BoxGeometry(0.86, 0.5, 0.86); plinth.translate(0, 0.25, 0); cream.push(plinth);
  cream.push(lathe([[0.36, 0.5], [0.36, 0.62], [0.3, 0.7], [0.24, 0.95], [0.19, 1.05]], 0, 0, 16));
  const column = new THREE.CylinderGeometry(0.14, 0.18, 5.0, 16); column.translate(0, 1.05 + 2.5, 0); cream.push(column);
  // the gilded head
  gold.push(lathe([[0.15, 6.05], [0.22, 6.12], [0.2, 6.2]], 0, 0, 20));
  gold.push(fluted(0.19, 0.75, 6.58, 16));
  gold.push(lathe([[0.2, 6.95], [0.24, 7.02], [0.16, 7.08]], 0, 0, 20));
  gold.push(lathe([[0.12, 7.05], [0.22, 7.12], [0.36, 7.28], [0.46, 7.42]], 8, 0.16));   // lotus cup
  const stem = new THREE.CylinderGeometry(0.055, 0.075, HB_TOP - 7.2, 10); stem.translate(0, (HB_TOP + 7.2) / 2 - 0.3, 0); gold.push(stem);
  gold.push(lathe([[0.05, 7.95], [0.12, 8.02], [0.07, 8.1]], 0, 0, 14));
  for (let k = 0; k < HB_LOW.n; k++) {
    const a = (k + .5) * Math.PI * 2 / HB_LOW.n;
    gold.push(scrollArm([0.12, 7.2], [HB_LOW.r, HB_LOW.y - HB_GLOBE - .22], a), holder(HB_LOW.r, HB_LOW.y - HB_GLOBE - .24, a));
  }
  for (let k = 0; k < HB_HIGH.n; k++) {
    const a = k * Math.PI * 2 / HB_HIGH.n;
    gold.push(scrollArm([0.06, 7.75], [HB_HIGH.r, HB_HIGH.y - HB_GLOBE - .22], a), holder(HB_HIGH.r, HB_HIGH.y - HB_GLOBE - .24, a));
  }
  gold.push(holder(0, HB_TOP - HB_GLOBE - .24, 0));
  return merged([...cream.map(g => tint(g, CREAM, 0)), ...gold.map(g => tint(g, GOLD, 1))], 'huabiao body');
}

function huabiaoGlobes(): THREE.BufferGeometry {
  const globe = (r: number, y: number, angle: number) => {
    const g = new THREE.SphereGeometry(HB_GLOBE, 14, 10); g.translate(r, y, 0); g.rotateY(angle); return g;
  };
  return merged([
    ...Array.from({ length: HB_LOW.n }, (_, k) => globe(HB_LOW.r, HB_LOW.y, (k + .5) * Math.PI * 2 / HB_LOW.n)),
    ...Array.from({ length: HB_HIGH.n }, (_, k) => globe(HB_HIGH.r, HB_HIGH.y, k * Math.PI * 2 / HB_HIGH.n)),
    globe(0, HB_TOP, 0),
  ], 'huabiao globes');
}

function lanternBody(): THREE.BufferGeometry {
  const foot = new THREE.CylinderGeometry(0.2, 0.3, 0.8, 10); foot.translate(0, 0.4, 0);
  const post = new THREE.CylinderGeometry(0.075, 0.11, 3.1, 10); post.translate(0, 0.8 + 1.55, 0);
  const collar = new THREE.CylinderGeometry(0.16, 0.09, 0.3, 10); collar.translate(0, 3.95, 0);
  const cap = new THREE.ConeGeometry(0.36, 0.42, 6); cap.translate(0, 4.83, 0);
  const finial = new THREE.SphereGeometry(0.07, 6, 4); finial.translate(0, 5.1, 0);
  // The cast-iron frame round the glass: a ring at the foot and the lip, and a bar up each corner.
  // Without it the lantern read as a solid white block by day (the same fault as Beijing's globes).
  const base = new THREE.CylinderGeometry(0.22, 0.2, 0.05, 6); base.translate(0, 4.04, 0);
  const lip = new THREE.CylinderGeometry(0.33, 0.31, 0.05, 6); lip.translate(0, 4.62, 0);
  const bars = Array.from({ length: 6 }, (_, k) => {
    const a = k * Math.PI / 3;
    const from = new THREE.Vector3(0.205 * Math.cos(a), 4.04, 0.205 * Math.sin(a));
    const to = new THREE.Vector3(0.305 * Math.cos(a), 4.62, 0.305 * Math.sin(a));
    const bar = new THREE.CylinderGeometry(0.014, 0.014, from.distanceTo(to), 4);
    bar.translate(0, from.distanceTo(to) / 2, 0);
    bar.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
    bar.translate(from.x, from.y, from.z);
    return bar;
  });
  return merged([foot, post, collar, cap, finial, base, lip, ...bars], 'lantern body');
}

function lanternGlass(): THREE.BufferGeometry {
  // six panes widening upwards, the Paris lantern's shape, a little inside the frame
  const glass = new THREE.CylinderGeometry(0.29, 0.195, 0.56, 6, 1); glass.translate(0, 4.33, 0);
  return glass;
}

function lampBodyGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.065, 0.085, POLE_HEIGHT, 8);
  pole.translate(0, POLE_HEIGHT / 2, 0);

  // The arm starts vertically, sweeps over the road and finishes pointing down. A TubeGeometry
  // gives the bend a real silhouette from every driving angle instead of faking it with a sprite.
  const arm = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, POLE_HEIGHT - 0.12, 0),
    new THREE.Vector3(0.03, POLE_HEIGHT + 0.34, 0),
    new THREE.Vector3(0.48, POLE_HEIGHT + 0.62, 0),
    new THREE.Vector3(1.18, POLE_HEIGHT + 0.55, 0),
    new THREE.Vector3(1.72, POLE_HEIGHT + 0.20, 0),
    new THREE.Vector3(HEAD_X, HEAD_HEIGHT + 0.12, 0),
  ]), 14, 0.075, 7, false);
  const head = new THREE.BoxGeometry(0.72, 0.20, 0.40);
  head.translate(HEAD_X - 0.20, HEAD_HEIGHT, 0);
  const merged = mergeGeometries([pole, arm, head]);
  pole.dispose();
  arm.dispose();
  head.dispose();
  if (!merged) throw new Error('streetlamp body geometry could not be merged');
  merged.computeBoundingSphere();
  return merged;
}

function lensGeometry(): THREE.BufferGeometry {
  const lens = new THREE.SphereGeometry(0.24, 10, 6);
  lens.scale(1.45, 0.24, 0.80);
  lens.translate(HEAD_X - 0.20, HEAD_HEIGHT - 0.12, 0);
  return lens;
}

function coneGeometry(): THREE.BufferGeometry {
  // Open-ended shell: the radial pool below supplies the bright centre, while the side shell only
  // makes suspended moisture visible. It therefore reads as illuminated air, not plastic.
  const cone = new THREE.CylinderGeometry(0.025, 1, 1, 32, 1, true);
  cone.translate(0, 0.5, 0);
  return cone;
}

function coneMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'night-light-volume-material',
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uOpacity: { value: 0.085 },
      uFadeNear: { value: 70 },
      uFadeFar: { value: 155 },
    },
    vertexShader: `
      varying vec2 vLampUv;
      varying vec3 vLampNormal;
      varying vec3 vLampView;
      varying float vLampDistance;
      void main() {
        vLampUv = uv;
        vec4 viewPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        // Cofactors preserve normals when the beam is sheared toward the road centre.
        mat3 basis = mat3(instanceMatrix);
        mat3 cofactors = mat3(cross(basis[1], basis[2]), cross(basis[2], basis[0]),
          cross(basis[0], basis[1]));
        vLampNormal = normalize(normalMatrix * cofactors * normal);
        vLampView = normalize(-viewPosition.xyz);
        vLampDistance = length(viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec2 vLampUv;
      varying vec3 vLampNormal;
      varying vec3 vLampView;
      varying float vLampDistance;
      uniform float uOpacity;
      uniform float uFadeNear;
      uniform float uFadeFar;
      void main() {
        float distanceFade = 1.0 - smoothstep(uFadeNear, uFadeFar, vLampDistance);
        if (distanceFade <= 0.001) discard;
        float endFade = smoothstep(0.0, 0.14, vLampUv.y) * (1.0 - smoothstep(0.78, 1.0, vLampUv.y));
        float facing = abs(dot(normalize(vLampNormal), normalize(vLampView)));
        float silhouetteFade = pow(smoothstep(0.02, 0.72, facing), 1.4);
        float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float suspendedDust = 0.82 + 0.18 * grain;
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.55),
          uOpacity * distanceFade * endFade * silhouetteFade * suspendedDust);
      }
    `,
  });
}

/**
 * Pool lift above the spline centre. The finished road is crowned a few centimetres above the
 * centreline it was built from, so the old 0.075 m sat only 2 cm clear of the crown.
 */
export const POOL_CLEARANCE = 0.12;

/** Local z of the four bend knots; the centre knot is the pool plane itself. */
export const POOL_BEND_KNOTS = [-1, -0.5, 0.5, 1] as const;

/**
 * Height of the draped pool above its own flat plane at local z, piecewise linear through the
 * knots (`poolBend.xyzw` in `POOL_BEND_KNOTS` order). The vertex shader compiles this text, and
 * the unit test evaluates the same text, so there is one formula rather than a GLSL and a TS copy.
 */
export const POOL_BEND_GLSL = `z < -0.5 ? mix(poolBend.y, poolBend.x, (-z - 0.5) * 2.0)
          : z < 0.0 ? poolBend.y * -z * 2.0
          : z < 0.5 ? poolBend.z * z * 2.0
          : mix(poolBend.z, poolBend.w, (z - 0.5) * 2.0)`;

function poolGeometry(): THREE.BufferGeometry {
  // A polar grid rather than a centre-and-rim fan: the pool bends along the road, and a fan has
  // no vertices inside the rim to bend with.
  const rings = 4, segments = 32;
  const positions: number[] = [0, 0, 0];
  const uvs: number[] = [0.5, 0.5];
  const index: number[] = [];
  for (let ring = 1; ring <= rings; ring++) {
    const r = ring / rings;
    for (let k = 0; k < segments; k++) {
      const a = k / segments * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      positions.push(x, 0, z);
      uvs.push((x + 1) / 2, (z + 1) / 2);
    }
  }
  const at = (ring: number, k: number) => ring ? 1 + (ring - 1) * segments + (k % segments) : 0;
  for (let k = 0; k < segments; k++) index.push(0, at(1, k + 1), at(1, k));
  for (let ring = 1; ring < rings; ring++) {
    for (let k = 0; k < segments; k++) {
      index.push(at(ring, k), at(ring, k + 1), at(ring + 1, k));
      index.push(at(ring, k + 1), at(ring + 1, k + 1), at(ring + 1, k));
    }
  }
  const pool = new THREE.BufferGeometry();
  pool.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  pool.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  pool.setIndex(index);
  pool.computeBoundingSphere();
  return pool;
}

function poolMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'night-light-pool-material',
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    // A little depth bias keeps the lift from being lost to precision at grazing driving angles.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uOpacity: { value: 0.38 },
      uFadeNear: { value: 70 },
      uFadeFar: { value: 155 },
    },
    // The pool is draped over the road's rise and fall: a flat pool on a changing grade ran
    // into the tarmac, which cut it off in a straight line across the road. The note sits here rather
    // than inside the shader string, because comments in a shader string ship in the build.
    vertexShader: `
      attribute vec4 poolBend;
      varying vec2 vPoolUv;
      varying float vPoolDistance;
      void main() {
        vPoolUv = uv;
        float z = position.z;
        float bend = ${POOL_BEND_GLSL};
        vec3 draped = vec3(position.x, position.y + bend, position.z);
        vec4 viewPosition = modelViewMatrix * instanceMatrix * vec4(draped, 1.0);
        vPoolDistance = length(viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec2 vPoolUv;
      varying float vPoolDistance;
      uniform float uOpacity;
      uniform float uFadeNear;
      uniform float uFadeFar;
      void main() {
        float distanceFade = 1.0 - smoothstep(uFadeNear, uFadeFar, vPoolDistance);
        if (distanceFade <= 0.001) discard;
        float radius = length((vPoolUv - 0.5) * 2.0);
        float softEdge = 1.0 - smoothstep(0.16, 1.0, radius);
        float centreWeighted = pow(max(softEdge, 0.0), 1.25);
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.55), uOpacity * distanceFade * centreWeighted);
      }
    `,
  });
}

/**
 * The lamp's metal. A body that paints its own parts (`color` and `metal` per vertex, the huabiao's
 * cream column and gilded head) scales metalness by that attribute; every other lamp is one colour.
 */
function bodyMaterial(style: LampStyle, geometry: THREE.BufferGeometry): THREE.MeshStandardMaterial {
  if (!geometry.getAttribute('metal')) return new THREE.MeshStandardMaterial({ color: style.bodyColor, roughness: 0.48, metalness: style.metalness });
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.4, metalness: 1 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float metal;\nvarying float vMetal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMetal = metal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vMetal;')
      .replace('float metalnessFactor = metalness;', 'float metalnessFactor = metalness * vMetal;')
      .replace('float roughnessFactor = roughness;', 'float roughnessFactor = mix(0.62, 0.32, vMetal);');
  };
  material.customProgramCacheKey = () => 'lamp-painted-metal';
  return material;
}

/**
 * Road lighting that reads as a full pole-to-ground light chain without one real light per lamp.
 *
 * Every route uses four instanced draws: metal assemblies, lenses, volume shells and soft pools.
 * The count does not change across quality tiers, and lamp dynamic-light/shadow cost stays zero.
 */
export class NightScenery {
  readonly root = new THREE.Group();
  readonly count: number;
  readonly drawCalls: number;
  readonly dynamicLights = 0;
  private readonly geometry: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(spline: Spline, timeOfDay: TimeOfDay, styleName?: LampStyleName) {
    this.root.name = 'night-scenery';
    const style: LampStyle = LAMP_STYLES[styleName ?? 'cobra'] ?? LAMP_STYLES.cobra;
    const night = timeOfDay === 'night';
    // A route that names its lamps shows their posts by day too: a street's lamps are
    // part of what says which city it is -- two draws, the posts and their unlit glass. A route that
    // names none keeps the original's day, which has no lamps: the cobra-head stands at a fixed
    // offset from the centreline, over a cutting or a bridge's edge where a street has no pavement.
    const stations = night || styleName ? nightLightStations(spline) : [];
    this.count = stations.length;
    this.drawCalls = stations.length ? (night ? 4 : 2) : 0;
    if (!stations.length) return;

    const bodies = new THREE.InstancedMesh(
      this.keepGeometry(style.body()),
      this.keepMaterial(bodyMaterial(style, this.geometry[this.geometry.length - 1]!)),
      stations.length,
    );
    const lenses = new THREE.InstancedMesh(
      this.keepGeometry(style.lens()),
      this.keepMaterial(night ? new THREE.MeshBasicMaterial({ color: style.lensColor, toneMapped: false })
        : new THREE.MeshStandardMaterial(style.dayLens ?? { color: 0xe9e6de, roughness: 0.25, metalness: 0.1 })),
      stations.length,
    );
    const cones = new THREE.InstancedMesh(
      this.keepGeometry(coneGeometry()), this.keepMaterial(coneMaterial()), stations.length,
    );
    const pools = new THREE.InstancedMesh(
      this.keepGeometry(poolGeometry()), this.keepMaterial(poolMaterial()), stations.length,
    );
    bodies.name = 'night-lamp-bodies';
    lenses.name = 'night-lamp-lenses';
    cones.name = 'night-light-cones';
    pools.name = 'night-light-pools';
    cones.renderOrder = 2;
    pools.renderOrder = 3;
    this.root.userData.headLocal = [style.head[0], style.head[1] + 0.12, 0];

    // Keep instance translations near the route centre: distant world coordinates lose
    // millimetres in Float32 and separate the lens from its beam.
    const bounds = new THREE.Box3();
    for (const s of stations) bounds.expandByPoint(new THREE.Vector3(...spline.point(spline.indexAt(s))));
    bounds.getCenter(this.root.position);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const localX = new THREE.Vector3(1, 0, 0);
    const centre = new THREE.Vector3();
    const bend = new Float32Array(stations.length * 4);
    stations.forEach((s, index) => {
      const i = spline.indexAt(s);
      const p = spline.point(i);
      const r = spline.right(i);
      const side = index % 2 ? 1 : -1;
      const shoulder = spline.halfWidth[i]! + 1.25;
      const inward = new THREE.Vector3(-r[0] * side, 0, -r[2] * side).normalize();
      const lampRotation = new THREE.Quaternion().setFromUnitVectors(localX, inward);
      const base = new THREE.Vector3(
        p[0] + r[0] * shoulder * side, p[1], p[2] + r[2] * shoulder * side,
      ).sub(this.root.position);

      matrix.compose(base, lampRotation, scale);
      bodies.setMatrixAt(index, matrix);
      lenses.setMatrixAt(index, matrix);
      const head = new THREE.Vector3(style.head[0], style.head[1], 0).applyMatrix4(matrix);

      // Light reaches both lane edges: aim at the centre, with a broad footprint following slope.
      const normal = new THREE.Vector3(...spline.normal(i)).normalize();
      const poolX = inward.clone().addScaledVector(normal, -inward.dot(normal)).normalize();
      const poolZ = new THREE.Vector3().crossVectors(poolX, normal).normalize();
      const poolRotation = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(poolX, normal, poolZ),
      );
      position.set(...p).sub(this.root.position).addScaledVector(normal, POOL_CLEARANCE);
      const across = spline.halfWidth[i]! * 1.55 + 1;
      const along = Math.max(11, spline.halfWidth[i]! * 1.4);
      matrix.compose(position, poolRotation, new THREE.Vector3(across, 1, along));
      pools.setMatrixAt(index, matrix);
      const forward = Math.sign(new THREE.Vector3(...spline.tangent(i)).dot(poolZ)) || 1;
      POOL_BEND_KNOTS.forEach((z, knot) => {
        const road = roadPointAt(spline, spline.s[i]! + forward * z * along);
        bend[index * 4 + knot] = road.sub(centre.set(...p)).dot(normal);
      });

      // Unit cone y=0 is the road ellipse; y=1 is the actual lens. A sheared basis keeps both
      // endpoints attached on wide and sloping roads without tilting the footprint off the tarmac.
      matrix.makeBasis(poolX.clone().multiplyScalar(across), head.clone().sub(position),
        poolZ.clone().multiplyScalar(along));
      matrix.setPosition(position);
      cones.setMatrixAt(index, matrix);
    });
    bodies.instanceMatrix.needsUpdate = true;
    lenses.instanceMatrix.needsUpdate = true;
    cones.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
    pools.geometry.setAttribute('poolBend', new THREE.InstancedBufferAttribute(bend, 4));
    this.root.add(bodies, lenses);
    if (night) this.root.add(cones, pools);
  }

  private keepGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometry.push(geometry);
    return geometry;
  }

  private keepMaterial<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  dispose(): void {
    this.root.clear();
    for (const geometry of this.geometry) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}

/** The spline centreline at arc length `s`, interpolated between samples rather than snapped. */
function roadPointAt(spline: Spline, s: number): THREE.Vector3 {
  const d = spline.wrapS(s);
  let i = spline.indexAt(d);
  if (spline.s[i]! > d && i > 0) i--;
  if (d > spline.s[spline.count - 1]!) i = spline.count - 1;
  const last = i + 1 >= spline.count;
  const j = last ? (spline.closed ? 0 : i) : i + 1;
  const s0 = spline.s[i]!, s1 = last ? (spline.closed ? spline.length : s0) : spline.s[j]!;
  const t = s1 > s0 ? THREE.MathUtils.clamp((d - s0) / (s1 - s0), 0, 1) : 0;
  return new THREE.Vector3(...spline.point(i)).lerp(new THREE.Vector3(...spline.point(j)), t);
}
