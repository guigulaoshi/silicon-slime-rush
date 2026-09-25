import * as THREE from 'three';
import type { TimeOfDay } from '../track/types';
import type { Quality } from './World';
import { bakeReflection } from './Reflection';
import { SHADOW_RADIUS } from './environmentShadows';
import type { LampCone } from './Headlights';
import './LayeredFog';

export const WEATHERS = ['clear', 'fog', 'rain', 'snow'] as const;
export type Weather = typeof WEATHERS[number];

export const WEATHER_GRIP: Readonly<Record<Weather, number>> = {
  clear: 1,
  fog: 1,
  rain: .82,
  snow: .62,
};

export interface SkyPreset {
  elevation: number;
  azimuth: number;
  sunColor: number;
  sunIntensity: number;
  skyColor: number;
  zenithColor: number;
  groundColor: number;
  ambient: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
}

export interface SkyStats {
  weather: Weather;
  rainStreaks: number;
  snowFlakes: number;
  lightning: number;
  fogNear: number;
  fogFar: number;
}

export const DOME = 1.4;

export const SKY_PRESETS: Record<TimeOfDay, SkyPreset> = {
  day: { elevation: 46, azimuth: 218, sunColor: 0xfff1dc, sunIntensity: 2.9, skyColor: 0x9dbcd8,
    zenithColor: 0x3b76b4, groundColor: 0x6d6b5c, ambient: 0.55, fogColor: 0x8faac4,
    fogNear: 380, fogFar: 3100 },
  night: { elevation: 52, azimuth: 305, sunColor: 0xbfd0ff, sunIntensity: 0.42, skyColor: 0x2a3a5c,
    zenithColor: 0x070c18, groundColor: 0x14161c, ambient: 0.40, fogColor: 0x1c2740,
    fogNear: 300, fogFar: 2400 },
};

/**
 * The afternoon sun for a track's latitude. The original placed one sun for every track, tuned to a
 * Bay Area afternoon (46 degrees up, 218 = south-west). Nearer the equator the afternoon sun stands
 * higher, further from it lower; south of the equator it is in the north-west. The Bay Area itself
 * keeps exactly the original numbers.
 */
/**
 * A route's own daylight sky over the shared preset: Lhasa's thin-air deep blue, Beijing's haze, the
 * pale dust over Dubai and Giza. "Whose common sense is this colour?" -- one blue for every city was
 * the Bay Area's. Night keeps the shared preset; a lit city's night sky is its lights, not its air.
 */
export function withTint(preset: SkyPreset, timeOfDay: TimeOfDay,
  tint?: { zenithColor?: string; skyColor?: string; fogColor?: string }): SkyPreset {
  if (!tint || timeOfDay !== 'day') return preset;
  const hex = (value: string | undefined, fallback: number) => value ? new THREE.Color(value).getHex() : fallback;
  return { ...preset, zenithColor: hex(tint.zenithColor, preset.zenithColor), skyColor: hex(tint.skyColor, preset.skyColor),
    fogColor: hex(tint.fogColor, preset.fogColor) };
}

export function presetForLatitude(timeOfDay: TimeOfDay, latitude: number | undefined): SkyPreset {
  const base = SKY_PRESETS[timeOfDay] ?? SKY_PRESETS.day;
  if (latitude === undefined || !Number.isFinite(latitude)) return base;
  const reference = 37.8;
  const elevation = THREE.MathUtils.clamp(base.elevation + (reference - Math.abs(latitude)) * .6, 28, 64);
  const tropical = Math.abs(latitude) < 10;
  const north = latitude >= 0;
  const fromSouth = base.azimuth - 180;                  // 38 degrees west of south, by day
  const azimuth = north ? (tropical ? base.azimuth + 30 : base.azimuth)
    : (360 - fromSouth - (tropical ? 30 : 0)) % 360;
  return { ...base, elevation, azimuth: timeOfDay === 'day' ? azimuth : base.azimuth };
}

export function sunDirection(preset: SkyPreset): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(preset.elevation);
  const az = THREE.MathUtils.degToRad(preset.azimuth);
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el),
    -Math.cos(el) * Math.cos(az)).normalize();
}

function skyDome(preset: SkyPreset, sun: THREE.Vector3, radius: number, timeOfDay: TimeOfDay,
  weather: Weather): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(preset.zenithColor) },
      uHorizon: { value: new THREE.Color(preset.fogColor) },
      uSunColor: { value: new THREE.Color(preset.sunColor) },
      uSunDir: { value: sun.clone() },
      uNight: { value: timeOfDay === 'night' ? 1 : 0 },
      uWeather: { value: WEATHERS.indexOf(weather) },
      uTime: { value: 0 },
      uLightning: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform float uNight;
      uniform float uWeather;
      uniform float uTime;
      uniform float uLightning;
      varying vec3 vDir;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise21(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
      }
      float cloudField(vec2 p) {
        return noise21(p) * .56 + noise21(p * 2.07 + 19.3) * .29
          + noise21(p * 4.11 - 7.4) * .15;
      }
      void main() {
        vec3 d = normalize(vDir);
        float clearSky = 1.0 - step(0.5, uWeather);
        float zenithMix = uNight < .5 && clearSky > .5
          ? smoothstep(-.01, .28, d.y) : pow(clamp(d.y, 0.0, 1.0), .55);
        vec3 col = mix(uHorizon, uZenith, zenithMix);
        col = mix(uHorizon, col, smoothstep(-0.06, 0.06, d.y));

        float rainSky = step(1.5, uWeather);
        float toLight = max(dot(d, normalize(uSunDir)), 0.0);
        float disc = smoothstep(.9987, .9994, toLight);
        float glare = pow(toLight, uNight > .5 ? 13.0 : 20.0);
        col += uSunColor * (disc * (uNight > .5 ? 1.15 : 1.7)
          + glare * (uNight > .5 ? .28 : .18)) * clearSky;

        vec2 starUv = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * vec2(118.0, 170.0);
        float starSeed = hash21(floor(starUv));
        vec2 starCell = fract(starUv) - .5;
        float star = smoothstep(.075, .0, length(starCell)) * step(.988, starSeed);
        star *= .78 + .22 * sin(uTime * (1.2 + starSeed * 2.2) + starSeed * 31.0);

        vec2 cloudUv = d.xz / max(.18, d.y + .30) * 4.8 + vec2(uTime * .012, 0.0);
        float field = cloudField(cloudUv);
        float cloudStart = uNight < .5 && clearSky > .5 ? .82 : .64;
        float sparseCloud = smoothstep(cloudStart, cloudStart + .11, field) * smoothstep(.02, .20, d.y);
        float stormCloud = smoothstep(.34, .72, field) * smoothstep(-.02, .14, d.y);
        float cloud = mix(sparseCloud, stormCloud, rainSky);
        vec3 dayCloud = mix(vec3(.82, .87, .92), vec3(.98), field);
        vec3 moonCloud = mix(vec3(.10, .13, .21), vec3(.34, .43, .62), field * (.42 + .58 * glare));
        vec3 storm = mix(vec3(.115, .135, .16), vec3(.28, .31, .34), field);
        vec3 cloudColour = rainSky > .5 ? storm : mix(dayCloud, moonCloud, uNight);
        col = mix(col, cloudColour, cloud * mix(.62, .94, rainSky));
        col += vec3(star) * uNight * clearSky * (1.0 - sparseCloud) * smoothstep(.06, .24, d.y);

        if (uWeather > .5 && uWeather < 1.5) col = mix(col, uHorizon, .72);
        col += vec3(.72, .80, .94) * uLightning * (.28 + cloud * .55);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 20), material);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}

/** Precipitation lives in world space inside a box that wraps around each camera, so a
 *  moving camera drives through it. Heights are relative to the camera, bottom and period. */
export const RAIN_BOX = { half: 45, bottom: -12, height: 50 } as const;
export const SNOW_BOX = { half: 44, bottom: -8, height: 48 } as const;

/** `value` moved by whole periods into [bottom, bottom + period) around `centre`. */
export function wrapInto(value: number, centre: number, bottom: number, period: number): number {
  const offset = (value - centre - bottom) % period;
  return bottom + (offset < 0 ? offset + period : offset);
}

function seeded(seed: number): () => number {
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), seed | 1);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
}

/** World-space drop tops (x, y, z) and streak lengths, spread evenly through the rain box. */
function rainField(count: number): { tops: Float32Array; lengths: Float32Array } {
  const random = seeded(0x6d2b79f5);
  const tops = new Float32Array(count * 3), lengths = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    tops[i * 3] = (random() * 2 - 1) * RAIN_BOX.half;
    tops[i * 3 + 1] = RAIN_BOX.bottom + random() * RAIN_BOX.height;
    tops[i * 3 + 2] = (random() * 2 - 1) * RAIN_BOX.half;
    lengths[i] = 1.5 + random() * 2.6;
  }
  return { tops, lengths };
}

/** World-space flake positions, spread evenly through the snow box. */
function snowField(count: number): Float32Array {
  const random = seeded(0x91e10da5);
  const flakes = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    flakes[i * 3] = (random() * 2 - 1) * SNOW_BOX.half;
    flakes[i * 3 + 1] = SNOW_BOX.bottom + random() * SNOW_BOX.height;
    flakes[i * 3 + 2] = (random() * 2 - 1) * SNOW_BOX.half;
  }
  return flakes;
}

function pointGeometry(vertices: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3)
    .setUsage(THREE.DynamicDrawUsage));
  return geometry;
}

function snowflakeTexture(): THREE.DataTexture {
  const size = 16;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - 7.5, y - 7.5) / 7.5;
      const alpha = Math.round(255 * THREE.MathUtils.clamp(1 - distance, 0, 1) ** .55);
      const at = (y * size + x) * 4;
      pixels[at] = 255; pixels[at + 1] = 255; pixels[at + 2] = 255; pixels[at + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/** The complete sky and weather system. It owns no downloaded textures or samples. */
export class Sky {
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly snow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly snowflake = snowflakeTexture();
  private readonly rainField = rainField(760);
  private readonly snowField = snowField(900);
  private readonly direction: THREE.Vector3;
  private activeShadowRadius: number;
  private elapsed = 0;
  private lightningTime = 0;
  private nextLightning = 2.8;
  private visibleRain = 760;
  private visibleSnow = 900;
  private readonly baseSunIntensity: number;
  /** Nearby giants as centre + radii/yaw, so rain and snow skip their bodies. */
  private readonly giantUniforms = {
    uGiantCentre: { value: Array.from({ length: GIANT_SLOTS }, () => new THREE.Vector4()) },
    uGiantShape: { value: Array.from({ length: GIANT_SLOTS }, () => new THREE.Vector4()) },
  };
  private readonly lampUniforms = {
    uLampPosReach: { value: Array.from({ length: LAMP_SLOTS }, () => new THREE.Vector4()) },
    uLampDirCos: { value: Array.from({ length: LAMP_SLOTS }, () => new THREE.Vector4()) },
  };
  private readonly baseAmbient: number;

  constructor(private readonly scene: THREE.Scene, readonly timeOfDay: TimeOfDay, shadowRadius = 90,
    viewRadius?: number, readonly weather: Weather = 'clear', horizonRadius?: number, latitude?: number,
    tint?: { zenithColor?: string; skyColor?: string; fogColor?: string }) {
    const preset = withTint(presetForLatitude(timeOfDay, latitude), timeOfDay, tint);
    this.direction = sunDirection(preset);
    this.activeShadowRadius = shadowRadius;
    this.baseSunIntensity = weather === 'rain' ? preset.sunIntensity * .34
      : weather === 'snow' ? preset.sunIntensity * .30
        : weather === 'fog' ? preset.sunIntensity * .52 : preset.sunIntensity;
    this.baseAmbient = weather === 'rain' ? preset.ambient * .72
      : weather === 'snow' ? preset.ambient * .86 : preset.ambient;

    const view = viewRadius ?? 2100;
    const fogNear = weather === 'fog' ? Math.min(28, view * .025)
      : weather === 'rain' ? view * .055 : weather === 'snow' ? view * .075 : view * .14;
    const fogFar = weather === 'fog' ? Math.max(150, Math.min(220, view * .15))
      : weather === 'rain' ? Math.max(460, view * .42)
        : weather === 'snow' ? Math.max(520, view * .48) : view * .94;
    const fogColor = weather === 'fog'
      ? (timeOfDay === 'night' ? 0x4a5566 : 0xc1cbd0)
      : weather === 'rain' ? (timeOfDay === 'night' ? 0x111b29 : 0x687581)
        : weather === 'snow' ? (timeOfDay === 'night' ? 0x1d2838 : 0x9caab5) : preset.fogColor;
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);
    const zenithColor = weather === 'rain' ? (timeOfDay === 'night' ? 0x090f18 : 0x384652)
      : weather === 'snow' ? (timeOfDay === 'night' ? 0x121a28 : 0x647582)
        : weather === 'fog' && timeOfDay === 'day' ? 0xb5c3cc : preset.zenithColor;
    this.dome = skyDome({ ...preset, fogColor, zenithColor }, this.direction, DOME * (horizonRadius ?? view),
      timeOfDay, weather);
    scene.add(this.dome);

    this.hemisphere = new THREE.HemisphereLight(
      weather === 'rain' ? (timeOfDay === 'night' ? 0x26364f : 0x788997)
        : weather === 'snow' ? (timeOfDay === 'night' ? 0x39465a : 0xb9c5cd)
          : weather === 'fog' && timeOfDay === 'day' ? 0xb5c3cc : preset.skyColor,
      preset.groundColor, this.baseAmbient);
    this.sun = new THREE.DirectionalLight(preset.sunColor, this.baseSunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -shadowRadius; cam.right = shadowRadius;
    cam.top = shadowRadius; cam.bottom = -shadowRadius;
    cam.near = 1; cam.far = shadowRadius * 6;
    this.sun.shadow.bias = -0.0006;

    const rainMaterial = new THREE.LineBasicMaterial({
      color: 0xb9d8ef, transparent: true, opacity: timeOfDay === 'night' ? .34 : .46,
      depthWrite: false, fog: false,
    });
    this.rain = new THREE.LineSegments(pointGeometry(760 * 2), rainMaterial);
    this.rain.visible = weather === 'rain';
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 8;
    const snowMaterial = new THREE.PointsMaterial({
      color: 0xf5fbff, size: .34, map: this.snowflake, alphaTest: .04, transparent: true,
      opacity: timeOfDay === 'night' ? .78 : .94, depthWrite: false, fog: false,
    });
    this.snow = new THREE.Points(pointGeometry(900), snowMaterial);
    // At night a drop or flake crossing a player's headlight cone catches the light.
    // None falls inside a giant's body, in any light.
    const gains = timeOfDay === 'night' ? [4, 2.6] : [0, 0];
    precipitationShader(rainMaterial, { ...this.lampUniforms, ...this.giantUniforms }, gains[0]!);
    precipitationShader(snowMaterial, { ...this.lampUniforms, ...this.giantUniforms }, gains[1]!);
    this.snow.visible = weather === 'snow';
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 8;
    scene.add(this.hemisphere, this.sun, this.sun.target, this.rain, this.snow);
  }

  /** Reflect the same authored sky and weather, without capturing cars or streamed tiles. */
  reflection(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
    const scene = new THREE.Scene();
    const dome = this.dome.clone();
    dome.position.set(0, 0, 0);
    dome.scale.setScalar(100 / this.dome.geometry.parameters.radius);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600),
      new THREE.MeshBasicMaterial({ color: this.hemisphere.groundColor }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    scene.add(dome, ground);
    try { return bakeReflection(renderer, scene); }
    finally { ground.geometry.dispose(); ground.material.dispose(); }
  }

  /** Advance weather once per displayed frame. Returns true once when thunder should sound. */
  update(dt: number): boolean {
    const step = Math.min(Math.max(dt, 0), .1);
    this.elapsed += step;
    this.dome.material.uniforms.uTime!.value = this.elapsed;
    if (this.weather === 'snow') {
      const array = this.snowField;
      for (let i = 0; i < array.length; i += 3) {
        array[i + 1]! -= (2.8 + (i % 17) * .11) * step;
        array[i]! += Math.sin(this.elapsed * .9 + i * 1.73) * .55 * step;
        array[i + 2]! += Math.cos(this.elapsed * .72 + i * 2.11) * .38 * step;
      }
      return false;
    }
    if (this.weather !== 'rain') return false;

    const tops = this.rainField.tops;
    for (let i = 0; i < tops.length; i += 3) {
      tops[i + 1]! -= (25 + ((i / 3) % 9) * 1.7) * step;
      tops[i]! -= 2.2 * step;
    }

    let thunder = false;
    this.nextLightning -= step;
    if (this.nextLightning <= 0) {
      this.lightningTime = .34;
      this.nextLightning = 8.5 + (Math.sin(this.elapsed * 7.13) * .5 + .5) * 5.5;
      thunder = true;
    }
    this.lightningTime = Math.max(0, this.lightningTime - step);
    const flash = this.lightningTime > .25 ? .9 : this.lightningTime > .17 ? .12
      : this.lightningTime > .07 ? .68 : this.lightningTime > 0 ? .18 : 0;
    this.dome.material.uniforms.uLightning!.value = flash;
    this.sun.intensity = this.baseSunIntensity + flash * 2.2;
    this.hemisphere.intensity = this.baseAmbient + flash * .8;
    return thunder;
  }

  /* */
  beforeCamera(camera: THREE.Camera, speedMps = 0): void {
    if (!this.rain.visible && !this.snow.visible) return;
    const eye = camera.getWorldPosition(new THREE.Vector3());
    this.rain.position.copy(eye);
    this.snow.position.copy(eye);
    if (this.snow.visible) {
      const flakes = this.snowField;
      const positions = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = positions.array as Float32Array;
      for (let i = 0; i < flakes.length; i += 3) {
        const x = wrapInto(flakes[i]!, eye.x, -SNOW_BOX.half, SNOW_BOX.half * 2);
        let y = wrapInto(flakes[i + 1]!, eye.y, SNOW_BOX.bottom, SNOW_BOX.height);
        const z = wrapInto(flakes[i + 2]!, eye.z, -SNOW_BOX.half, SNOW_BOX.half * 2);
        // A flake that wraps in right at the lens would fill the screen for a frame; park it overhead.
        if (x * x + y * y + z * z < 6.25) y = SNOW_BOX.bottom + SNOW_BOX.height - 1;
        array[i] = x; array[i + 1] = y; array[i + 2] = z;
      }
      positions.needsUpdate = true;
      return;
    }
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > .001) forward.normalize();
    const slant = THREE.MathUtils.clamp(speedMps / 45, 0, 1) * 3.2;
    const { tops, lengths } = this.rainField;
    const positions = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    const array = positions.array as Float32Array;
    for (let i = 0, at = 0; i < lengths.length; i++, at += 6) {
      const x = wrapInto(tops[i * 3]!, eye.x, -RAIN_BOX.half, RAIN_BOX.half * 2);
      const y = wrapInto(tops[i * 3 + 1]!, eye.y, RAIN_BOX.bottom, RAIN_BOX.height);
      const z = wrapInto(tops[i * 3 + 2]!, eye.z, -RAIN_BOX.half, RAIN_BOX.half * 2);
      array[at] = x; array[at + 1] = y; array[at + 2] = z;
      array[at + 3] = x - .22 - forward.x * slant;
      array[at + 4] = y - lengths[i]!;
      array[at + 5] = z + .1 - forward.z * slant;
    }
    positions.needsUpdate = true;
  }

  /** The giants nearest the camera about to render: precipitation inside them is not drawn. */
  setGiants(giants: readonly { position: readonly number[]; scale: readonly number[]; yaw: number }[]): void {
    const [centres, shapes] = [this.giantUniforms.uGiantCentre.value, this.giantUniforms.uGiantShape.value];
    for (let i = 0; i < GIANT_SLOTS; i++) {
      const giant = giants[i];
      if (!giant) { centres[i]!.set(0, 0, 0, 0); continue; }
      centres[i]!.set(giant.position[0]!, giant.position[1]!, giant.position[2]!, 1);
      shapes[i]!.set(giant.scale[0]!, giant.scale[1]!, giant.scale[2]!, giant.yaw);
    }
  }

  /** Up to two human front lamp cones, in world space, for the precipitation lighting. */
  setLampCones(cones: readonly (LampCone | null)[]): void {
    const [posReach, dirCos] = [this.lampUniforms.uLampPosReach.value, this.lampUniforms.uLampDirCos.value];
    for (let i = 0; i < LAMP_SLOTS; i++) {
      const cone = cones[i];
      if (!cone) { posReach[i]!.set(0, 0, 0, 0); continue; }
      posReach[i]!.set(cone.position.x, cone.position.y, cone.position.z, cone.reach);
      dirCos[i]!.set(cone.direction.x, cone.direction.y, cone.direction.z, cone.cosAngle);
    }
  }

  follow(x: number, y: number, z: number): void {
    this.dome.position.set(x, y, z);
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + this.direction.x * 260, y + this.direction.y * 260,
      z + this.direction.z * 260);
    this.sun.target.updateMatrixWorld();
  }

  setShadowQuality(quality: Quality): void {
    const radius = SHADOW_RADIUS[quality];
    this.sun.castShadow = quality !== 'low';
    this.activeShadowRadius = radius;
    this.visibleRain = quality === 'high' ? 760 : quality === 'medium' ? 480 : 260;
    this.visibleSnow = quality === 'high' ? 900 : quality === 'medium' ? 600 : 350;
    this.rain.geometry.setDrawRange(0, this.visibleRain * 2);
    this.snow.geometry.setDrawRange(0, this.visibleSnow);
    if (radius === 0) return;
    const cam = this.sun.shadow.camera;
    cam.left = -radius; cam.right = radius;
    cam.top = radius; cam.bottom = -radius;
    cam.updateProjectionMatrix();
  }

  get shadowRadius(): number { return this.activeShadowRadius; }
  /**
   * How bright the world's own light is right now, 1 being a clear day, and it already carries both
   * halves: the time-of-day preset (day 2.9 vs night 0.42) and the weather factor applied above
   * (rain.34, snow.30, fog.52). scales the giants' ground ripple by this rather than
   * inventing its own weather table.
   */
  get daylight(): number {
    return this.baseSunIntensity / SKY_PRESETS.day.sunIntensity;
  }

  get stats(): SkyStats {
    const fog = this.scene.fog as THREE.Fog;
    return { weather: this.weather, rainStreaks: this.rain.visible ? this.visibleRain : 0,
      snowFlakes: this.snow.visible ? this.visibleSnow : 0,
      lightning: Number(this.dome.material.uniforms.uLightning!.value), fogNear: fog.near, fogFar: fog.far };
  }

  dispose(): void {
    this.scene.remove(this.hemisphere, this.sun, this.sun.target, this.dome, this.rain, this.snow);
    this.sun.dispose(); this.hemisphere.dispose();
    this.dome.geometry.dispose(); this.dome.material.dispose();
    this.rain.geometry.dispose(); this.rain.material.dispose();
    this.snow.geometry.dispose(); this.snow.material.dispose(); this.snowflake.dispose();
  }
}

const LAMP_SLOTS = 2;

const GIANT_SLOTS = 4;

/* */
function precipitationShader(material: THREE.Material, uniforms: object, gain: number): void {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLampWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const lamps = gain > 0 ? `
        float lampLit = 0.0;
        for (int i = 0; i < ${LAMP_SLOTS}; i++) {
          if (uLampPosReach[i].w <= 0.0) continue;
          vec3 toward = vLampWorld - uLampPosReach[i].xyz;
          float dist = length(toward);
          float inside = smoothstep(uLampDirCos[i].w, mix(uLampDirCos[i].w, 1.0, .2), dot(toward / max(dist, 1e-3), uLampDirCos[i].xyz));
          lampLit += inside * (1.0 - smoothstep(uLampPosReach[i].w * .5, uLampPosReach[i].w, dist));
        }
        diffuseColor.rgb *= 1.0 + ${gain.toFixed(2)} * lampLit;
        diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + 1.4 * lampLit));` : '';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLampWorld;
        uniform vec4 uLampPosReach[${LAMP_SLOTS}];
        uniform vec4 uLampDirCos[${LAMP_SLOTS}];
        uniform vec4 uGiantCentre[${GIANT_SLOTS}];
        uniform vec4 uGiantShape[${GIANT_SLOTS}];`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        for (int i = 0; i < ${GIANT_SLOTS}; i++) {
          if (uGiantCentre[i].w <= 0.0) continue;
          vec3 d = vLampWorld - uGiantCentre[i].xyz;
          float c = cos(uGiantShape[i].w), s = sin(uGiantShape[i].w);
          vec3 local = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z) / uGiantShape[i].xyz;
          if (dot(local, local) < 1.0) discard;
        }${lamps}`);
  };
  material.customProgramCacheKey = () => `precipitation-${gain}`;
}
