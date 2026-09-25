import * as THREE from 'three';

/**
 * The fog weather used Three's linear fog alone -- clear at 28 m, a flat wall of one colour
 * from ~220 m -- so it read as a white screen, not air. Dense fog now thickens exponentially with
 * distance, thins with height above the road the camera is on (roof lines and tree tops come out of
 * it) and varies in world-anchored patches, so driving moves through thicker and thinner air.
 *
 * It lives in Three's own fog chunks, so every fogged material follows without per-material hooks.
 * No new uniform: how much of the layered model applies is read from `fog.far`, which only the fog
 * weather sets short (<= 220 m, Sky.ts). Rain, snow and clear keep far >= 400 m and take the old
 * path unchanged, because the branch below is skipped at layer amount 0.
 */
export const LAYERED_FOG_FULL_FAR = 220;
export const LAYERED_FOG_NONE_FAR = 400;

/** The same ramp the shader applies: 1 for the fog weather, 0 for any ordinary view distance. */
export function layeredFogAmount(far: number): number {
  return THREE.MathUtils.clamp((LAYERED_FOG_NONE_FAR - far) / (LAYERED_FOG_NONE_FAR - LAYERED_FOG_FULL_FAR), 0, 1);
}

const PARS_VERTEX = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogView;
#endif
`;

const VERTEX = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogView = mvPosition.xyz;
#endif
`;

const PARS_FRAGMENT = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogView;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
		float srFogHash(vec3 p) {
			p = fract(p * .3183099 + .1);
			p *= 17.0;
			return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
		}
		float srFogNoise(vec3 x) {
			vec3 i = floor(x);
			vec3 f = fract(x);
			f = f * f * (3.0 - 2.0 * f);
			return mix(mix(mix(srFogHash(i), srFogHash(i + vec3(1, 0, 0)), f.x),
					mix(srFogHash(i + vec3(0, 1, 0)), srFogHash(i + vec3(1, 1, 0)), f.x), f.y),
				mix(mix(srFogHash(i + vec3(0, 0, 1)), srFogHash(i + vec3(1, 0, 1)), f.x),
					mix(srFogHash(i + vec3(0, 1, 1)), srFogHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
		}
		float srFogPatch(vec3 p) {
			return (srFogNoise(p / vec3(70.0, 26.0, 70.0)) + .45 * srFogNoise(p / vec3(23.0, 11.0, 23.0))) / 1.45;
		}
		float srLayeredFog(vec3 view, float near, float far) {
			// view space is a rotation of world space, so the transpose recovers the world offset
			vec3 offset = (vec4(view, 0.0) * viewMatrix).xyz;
			float dist = max(length(offset), 1e-3);
			vec3 dir = offset / dist;
			// density halves every ~20 m above a ground 3 m under the chase camera; the average along
			// the ray is the closed-form integral of that exponential
			float k = .035;
			float kd = k * offset.y;
			float along = abs(kd) < 1e-3 ? 1.0 : (1.0 - exp(-kd)) / kd;
			float height = clamp(exp(-k * 3.0) * along, .35, 1.6);
			// patches anchored in the world: one at the surface, one halfway along the near stretch
			float reach = min(dist, 160.0);
			float patchy = .6 * srFogPatch(cameraPosition + offset) + .4 * srFogPatch(cameraPosition + dir * reach * .5);
			// The chase camera sits about 8 m behind the car and most of what a driver reads is 30-100 m
			// away, so the air starts close: ~1/3 hidden at 40 m, ~2/3 at 80 m, ~9/10 at 150 m.
			float density = 4.0 / far * height * mix(.35, 1.65, patchy);
			float thick = 1.0 - exp(-density * max(dist - near * .3, 0.0));
			return max(thick, smoothstep(far, far * 2.2, dist));
		}
	#endif
#endif
`;

const FRAGMENT = /* glsl */`
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		float fogLayer = clamp( ( ${LAYERED_FOG_NONE_FAR.toFixed(1)} - fogFar ) / ${(LAYERED_FOG_NONE_FAR - LAYERED_FOG_FULL_FAR).toFixed(1)}, 0.0, 1.0 );
		if ( fogLayer > 0.0 ) fogFactor = mix( fogFactor, srLayeredFog( vFogView, fogNear, fogFar ), fogLayer );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

/** Installed at import, before any program compiles; chunk text is read when a program is built. */
Object.assign(THREE.ShaderChunk, {
  fog_pars_vertex: PARS_VERTEX,
  fog_vertex: VERTEX,
  fog_pars_fragment: PARS_FRAGMENT,
  fog_fragment: FRAGMENT,
});
