import * as THREE from 'three';
import type {Weather} from './Sky';

/** Distance scattering for geographical scenery; nearby weather visibility keeps its own owner. */
export function scatteringDistance(weather: Weather): number {
  return weather === 'rain' ? 6500 : weather === 'snow' ? 5500 : 26000;
}

/** These clones belong to one backdrop; shared street/terrain materials remain untouched. */
export class FarAtmosphere {
  private readonly clones = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>();
  constructor(private readonly weather: Weather, private readonly fog: THREE.Fog) {}

  material(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const existing = this.clones.get(base);
    if (existing) return existing;
    const material = base.clone();
    material.name = base.name + '-atmosphere';
    material.fog = false;
    material.onBeforeCompile = (shader, renderer) => {
      // Water keeps the shared animation callback and clock, while owning this shader's haze.
      base.onBeforeCompile.call(base, shader, renderer);
      Object.assign(shader.uniforms, {
        uFarAir: {value:this.fog.color}, uFarScatter: {value:scatteringDistance(this.weather)},
        uFarFog: {value:this.weather === 'fog' ? 1 : 0},
        uFarNear: {value:this.fog.near}, uFarEnd: {value:this.fog.far},
      });
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nvarying float vAirDistance;').replace('#include <project_vertex>',
        '#include <project_vertex>\nvAirDistance = length(mvPosition.xyz);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying float vAirDistance;
        uniform vec3 uFarAir;
        uniform float uFarScatter, uFarFog, uFarNear, uFarEnd;`)
        .replace('#include <fog_fragment>', `#include <fog_fragment>
          float haze = uFarFog > .5 ? smoothstep(uFarNear, uFarEnd, vAirDistance)
            : 1.0 - exp(-vAirDistance / uFarScatter);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uFarAir, 1.0)).rgb, haze);`);
    };
    material.customProgramCacheKey = () => base.customProgramCacheKey() + ':far-atmosphere';
    this.clones.set(base, material);
    return material;
  }

  dispose(): void {
    for (const material of this.clones.values()) material.dispose();
    this.clones.clear();
  }
}
