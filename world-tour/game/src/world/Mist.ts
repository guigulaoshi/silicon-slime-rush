import * as THREE from 'three';
import type { TimeOfDay } from '../track/types';

/** A route's valley mist (`track.mist`): cloud sheets at fixed elevations, drifting. */
export interface MistSpec {
  /** Elevations of the sheets in metres, the same numbers the track's y uses. */
  layersM: number[];
  /** How far from the route's middle the sheets reach, metres. */
  radiusM?: number;
  colour?: string;
  /** Opacity of one sheet where its cloud is thickest. */
  opacity?: number;
}

/**
 * The sea of cloud a karst valley fills with, which the pillars rise out of. It is not a flat ground
 * fog: it lies in the gorges at a height of its own, the road runs above it, and the lower pillars
 * disappear into it while the taller ones stand clear (research card, Zhangjiajie).
 *
 * A few horizontal sheets, each a disc of drifting two-scale noise. Stacked a few metres apart they
 * read as a layer with depth, and a pillar passing through them is swallowed gradually instead of
 * cut by one hard line. A sheet thins out as the camera comes level with it, so looking along its
 * plane never shows it as a line across the picture. Scene fog applies, so the far edge of the cloud
 * goes the way of the hills behind it.
 */
export class Mist {
  readonly root = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly materials: THREE.ShaderMaterial[] = [];
  /** How many sheets this was built with (MIST_SHEETS at the quality level of the moment). */
  readonly sheets: number;

  constructor(spec: MistSpec, centre: THREE.Vector3, timeOfDay: TimeOfDay, sheets: number) {
    this.root.name = 'mist';
    const radius = spec.radiusM ?? 4000;
    const colour = new THREE.Color(spec.colour ?? '#e9edf0');
    // Mist at night is lit only by the sky: a pale sheet at midnight glows like a lamp.
    const light = timeOfDay === 'night' ? .16 : 1;
    const layers = spec.layersM.slice(0, Math.max(1, sheets));
    this.sheets = sheets;
    const geometry = new THREE.CircleGeometry(radius, 96);
    geometry.rotateX(-Math.PI / 2);
    layers.forEach((y, i) => {
      const material = new THREE.ShaderMaterial({
        name: 'mist',
        transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
          uColour: { value: colour.clone().multiplyScalar(light) },
          uOpacity: { value: (spec.opacity ?? .8) / Math.sqrt(layers.length) },
          uCentre: { value: new THREE.Vector2(centre.x, centre.z) },
          uRadius: { value: radius },
          uSeed: { value: i * 17.3 },
        }]),
        vertexShader: MIST_VERTEX,
        fragmentShader: MIST_FRAGMENT,
      });
      material.uniforms.uTime = this.time;
      this.materials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(centre.x, y, centre.z);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      mesh.name = `mist-${i}`;
      this.root.add(mesh);
    });
  }

  /** `seconds` since the track loaded. */
  update(seconds: number): void { this.time.value = seconds; }

  dispose(): void {
    for (const child of this.root.children) (child as THREE.Mesh).geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.root.clear();
  }
}

const MIST_VERTEX = `
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const MIST_FRAGMENT = `
  #include <fog_pars_fragment>
  uniform vec3 uColour;
  uniform float uOpacity, uTime, uRadius, uSeed;
  uniform vec2 uCentre;
  varying vec3 vWorld;
  float mHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float mNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mHash(i), mHash(i + vec2(1, 0)), f.x), mix(mHash(i + vec2(0, 1)), mHash(i + vec2(1, 1)), f.x), f.y);
  }
  float mFbm(vec2 p) { return .5 * mNoise(p) + .25 * mNoise(p * 2.07) + .125 * mNoise(p * 4.13) + .0625 * mNoise(p * 8.3); }
  void main() {
    vec2 p = vWorld.xz + uSeed * 31.0;
    // two scales drifting at different speeds: banks of cloud, and the wisps along their edges
    float banks = mFbm(p / 420.0 + vec2(uTime * .004, uTime * .0017));
    float wisps = mFbm(p / 95.0 - vec2(uTime * .011, -uTime * .006));
    float cloud = smoothstep(.46, .8, banks * .75 + wisps * .35);
    float edge = 1.0 - smoothstep(.7, 1.0, length(vWorld.xz - uCentre) / uRadius);
    // thin out as the eye comes level with the sheet, so it never shows as a line
    float level = smoothstep(4.0, 45.0, abs(cameraPosition.y - vWorld.y));
    float alpha = cloud * edge * level * uOpacity;
    if (alpha < .004) discard;
    gl_FragColor = vec4(uColour * (.92 + .08 * wisps), alpha);
    #include <fog_fragment>
  }`;
