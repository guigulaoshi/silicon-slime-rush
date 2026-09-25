import * as THREE from 'three';
import type { Weather } from './Sky';
import { WEATHER_GRIP } from './Sky';
import type { Spline } from '../track/Spline';
import { projectOnSample } from '../track/Progress';

export type WeatherSurfaceKind = 'dry' | 'wet' | 'puddle' | 'snow' | 'deepSnow' | 'ice';
export interface WeatherContact { kind: WeatherSurfaceKind; grip: number; depth: number }
export const SURFACE_GRIP = { dry: WEATHER_GRIP.clear, wet: WEATHER_GRIP.rain,
  puddle: .72, snow: WEATHER_GRIP.snow, deepSnow: WEATHER_GRIP.snow, ice: .43 } as const;
export interface WeatherPatch { index: number; x: number; y: number; z: number;
  radius: number; depth: number; mask?: Uint8Array; available?: boolean; kind: 'puddle' | 'ice' | 'deepSnow';
  /** Turn about the ground normal, so the few shared shapes don't all face the same way. */
  spin?: number }

/** Orientation shared by the patch mesh and contact sampling: ground normal, then the patch's own spin. */
export function patchQuaternion(spline: Spline, patch: WeatherPatch): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...spline.normal(patch.index)))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), patch.spin ?? 0));
}

// Puddle and ice layout: random gaps scaled by PATCH_SPACING (mean gap ~83 m) keep about twice the
// original count across the built tracks (2.04x puddles, 2.10x ice; hilly Lombard/Twin Peaks lack
// flat spots), radius x sqrt(2) doubles the average area. Deep snow keeps 170 m.
export const PATCH_SPACING = 100;
export const DEEP_SNOW_SPACING = 170;
export const PATCH_MAX_RADIUS = 2.4 * Math.SQRT2;
export const PATCH_HALF_WIDTH_RATIO = .6 * Math.SQRT2;

// Deep snow samples this window of a 256px GPU splatter texture; puddles and ice own a whole
// SHAPE_MASK_SIZE square (small enough to build 175 of them for bayshore-101 at race start).
const SPLATTER_ORIGIN = [.17, .5] as const, SPLATTER_SCALE = .28;
export const SHAPE_MASK_SIZE = 96;

export const PATCH_SHAPES = ['lobed', 'strip', 'bean', 'cluster'] as const;
export type PatchShape = typeof PATCH_SHAPES[number];

function random(seed: number): () => number {
  let t = seed >>> 0;
  return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
const smin = (a: number, b: number, k: number) => { const h = THREE.MathUtils.clamp(.5 + .5 * (b - a) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h); };

/**
 * Puddles and ice are one continuous sheet with a smooth outline -- not the slime splatter, whose
 * droplets read as a splash. The seed picks one of PATCH_SHAPES, then randomizes blob sizes,
 * rotation and edge wobble. Alpha is coverage, red is distance inside the edge (ice frosts its rim
 * with it), green is thickness variation.
 */
export function patchMask(seed: number, kind: 'puddle' | 'ice'): { mask: Uint8Array; shape: PatchShape } {
  const rand = random(seed * 2654435761 + (kind === 'ice' ? 97 : 13));
  const range = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const shape = PATCH_SHAPES[seed % PATCH_SHAPES.length]!;
  const spin = range(0, Math.PI);
  // Blobs as [x, y, radiusX, radiusY, angle] in the unit disc; the union is smoothed.
  const blobs: number[][] = [];
  if (shape === 'lobed') blobs.push([0, 0, range(.62, .78), range(.5, .72), spin]);
  else if (shape === 'strip') blobs.push([0, 0, range(.85, .92), range(.2, .32), spin]);
  else if (shape === 'bean') {
    const off = range(.25, .38);
    blobs.push([Math.cos(spin) * off, Math.sin(spin) * off, range(.4, .52), range(.34, .46), spin + range(-.5, .5)],
      [-Math.cos(spin) * off, -Math.sin(spin) * off, range(.3, .44), range(.26, .38), spin + range(-.5, .5)]);
  } else {
    for (let i = 0; i < 3 + Math.floor(rand() * 2); i++) {
      const t = spin + i * 2.1 + range(-.4, .4), off = i === 0 ? 0 : range(.3, .5);
      blobs.push([Math.cos(t) * off, Math.sin(t) * off, range(.24, .4), range(.2, .34), range(0, Math.PI)]);
    }
  }
  const wobble = .035;
  const phases = Array.from({ length: 6 }, () => range(0, Math.PI * 2));
  const soft = kind === 'ice' ? .012 : .03;
  const n = SHAPE_MASK_SIZE, mask = new Uint8Array(n * n * 4);
  for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
    const qx = (px / (n - 1) - .5) * 2, qy = (py / (n - 1) - .5) * 2;
    let sdf = Infinity;
    for (const [bx, by, rx, ry, angle] of blobs) {
      const c = Math.cos(angle!), sn = Math.sin(angle!), dx = qx - bx!, dy = qy - by!;
      const lx = (dx * c + dy * sn) / rx!, ly = (-dx * sn + dy * c) / ry!;
      const d = (Math.hypot(lx, ly) - 1) * Math.min(rx!, ry!);
      sdf = sdf === Infinity ? d : smin(sdf, d, .12);
    }
    sdf += wobble * (Math.sin(qx * 4.3 + phases[0]!) * Math.sin(qy * 3.7 + phases[1]!)
      + .6 * Math.sin(qx * 9.1 - qy * 2.3 + phases[2]!) + .35 * Math.sin(qy * 11.7 + qx * 5.2 + phases[3]!));
    sdf = Math.max(sdf, Math.hypot(qx, qy) - .97);
    const k = (py * n + px) * 4;
    mask[k] = Math.round(THREE.MathUtils.clamp(-sdf / .3, 0, 1) * 255);
    mask[k + 1] = Math.round((.5 + .25 * Math.sin(qx * 3.1 + phases[4]!) * Math.sin(qy * 2.7 + phases[5]!)) * 255);
    mask[k + 3] = Math.round(THREE.MathUtils.smoothstep(-sdf, -soft, soft) * 255);
  }
  return { mask, shape };
}

// One mask per shape family per kind, built once and shared by every patch on every track: cheap however long the track.
export const SHAPE_VARIANTS = PATCH_SHAPES.length;
const shapePools = new Map<'puddle' | 'ice', Uint8Array[]>();
export function shapeMasks(kind: 'puddle' | 'ice'): Uint8Array[] {
  let pool = shapePools.get(kind);
  if (!pool) shapePools.set(kind, pool = Array.from({ length: SHAPE_VARIANTS }, (_, i) => patchMask(i, kind).mask));
  return pool;
}

/**
 * Puddles and ice are scattered at random along the whole route: each gap is drawn around
 * PATCH_SPACING (sometimes a tight pair, sometimes a long dry stretch) and the patch lands anywhere
 * across the road. Seeded by the track's geometry, so a track always gets the same layout.
 * Steep grades and crests never collect standing water or sheet ice.
 */
export function weatherPatches(spline: Spline, weather: Weather): WeatherPatch[] {
  if (weather !== 'rain' && weather !== 'snow') return [];
  const kind = weather === 'rain' ? 'puddle' : 'ice';
  const start = spline.point(0), total = spline.s[spline.count - 1]!;
  const rand = random(Math.round(total * 131 + start[0] * 17 + start[2] * 29) ^ (kind === 'ice' ? 0x9e37 : 0));
  const patches: WeatherPatch[] = [];
  let lastDeepS = -Infinity, target = spline.s[20]! + PATCH_SPACING * rand();
  for (let i = 20; i < spline.count - 20; i++) {
    if (spline.s[i]! < target) continue;
    const p = spline.point(i), before = spline.point(Math.max(0, i - 15)), after = spline.point(Math.min(spline.count - 1, i + 15));
    if (Math.abs(spline.tangent(i)[1]) > .025 || p[1] > Math.min(before[1], after[1]) + .22) {
      target = spline.s[i]! + 5 + 15 * rand();
      continue;
    }
    const right = spline.right(i), half = spline.halfWidth[i]!;
    // Size in [.8, 1.18]: mean squared scale ~1, so the average area stays doubled.
    const radius = Math.min(PATCH_MAX_RADIUS, half * PATCH_HALF_WIDTH_RATIO) * (.8 + .38 * rand());
    const reach = Math.max(.5, half - radius * .65), offset = (rand() * 2 - 1) * reach;
    patches.push({ index: i, x: p[0] + right[0] * offset, y: p[1], z: p[2] + right[2] * offset,
      radius, depth: .035 + rand() * .036, kind, mask: shapeMasks(kind)[Math.floor(rand() * SHAPE_VARIANTS)]!,
      spin: rand() * Math.PI * 2 });
    if (weather === 'snow' && spline.s[i]! - lastDeepS >= DEEP_SNOW_SPACING) {
      const side = offset < 0 ? 1 : -1;
      patches.push({ index: i, x: p[0] + right[0] * side * (half + 4),
        y: p[1], z: p[2] + right[2] * side * (half + 4), radius: 3.5, depth: .24, kind: 'deepSnow' });
      lastDeepS = spline.s[i]!;
    }
    // Exponential-ish gaps: mostly short to medium, now and then a long empty stretch.
    target = spline.s[i]! + PATCH_SPACING * (.15 + 1.7 * rand() ** 1.5);
  }
  return patches;
}

export class WeatherSurface {
  readonly patches: WeatherPatch[];
  constructor(readonly spline: Spline, readonly weather: Weather) { this.patches = weatherPatches(spline, weather); }
  sample(x: number, y: number, z: number, index: number): WeatherContact {
    const base = this.weather === 'rain' ? 'wet' : this.weather === 'snow' ? 'snow' : 'dry';
    if (base === 'dry') return { kind: base, grip: SURFACE_GRIP[base], depth: 0 };
    const projection = projectOnSample(this.spline, index, x, z);
    for (const patch of this.patches) {
      if (patch.available === false) continue;
      if (Math.abs(patch.y - y) > 1.5 || Math.hypot(x - patch.x, z - patch.z) > patch.radius) continue;
      const local = new THREE.Vector3(x - patch.x, y - patch.y, z - patch.z).applyQuaternion(
        patchQuaternion(this.spline, patch).invert());
      const u = .5 + local.x / (patch.radius * 2), v = .5 + local.y / (patch.radius * 2);
      // Puddles and ice carry their own outline; the round fade is only for splatter-shaped deep snow.
      const rim = patch.kind !== 'deepSnow' ? 1 : 1 - THREE.MathUtils.smoothstep(Math.hypot((u - .5) * 2, (v - .5) * 2), .7, 1);
      const splatter = patch.kind === 'deepSnow', size = splatter ? 256 : SHAPE_MASK_SIZE;
      const px = Math.max(0, Math.min(size - 1, Math.round((splatter ? SPLATTER_ORIGIN[0] + (u - .5) * SPLATTER_SCALE : u) * (size - 1))));
      const py = Math.max(0, Math.min(size - 1, Math.round((splatter ? SPLATTER_ORIGIN[1] + (v - .5) * SPLATTER_SCALE : v) * (size - 1))));
      if (rim * (patch.mask ? patch.mask[(py * size + px) * 4 + 3]! / 255 : 1) < .08) continue;
      if (patch.kind === 'deepSnow' && Math.abs(projection.lateral) <= this.spline.halfWidth[index]!) continue;
      return { kind: patch.kind, grip: SURFACE_GRIP[patch.kind], depth: patch.depth };
    }
    return { kind: base, grip: SURFACE_GRIP[base], depth: base === 'snow' ? .025 : .002 };
  }
}

export function wheelSpray(contact: WeatherContact, speed: number): { rate: number; lift: number; gravity: number; life: number; size: number } {
  if (speed < 1.1 || contact.kind === 'dry' || contact.kind === 'ice') return { rate: 0, lift: 0, gravity: 0, life: 0, size: 0 };
  const snow = contact.kind === 'snow' || contact.kind === 'deepSnow';
  const deep = contact.kind === 'puddle' || contact.kind === 'deepSnow';
  const intensity = Math.min(speed / 25, 2);
  const depth = deep ? Math.min(contact.depth / (snow ? .24 : .06), 1.5) : 1;
  return { rate: (snow ? (deep ? 96 : 18) : (deep ? 180 : 36)) * intensity * depth,
    lift: (deep ? 2 + intensity * 3.2 : .35 + intensity * .4) * depth,
    gravity: snow ? 2.8 : 9.8, life: snow ? 1.5 : .8,
    size: snow ? (deep ? .1 : .055) : (deep ? .075 : .035) };
}
