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

  constructor(spline: Spline, timeOfDay: TimeOfDay) {
    this.root.name = 'night-scenery';
    const stations = timeOfDay === 'night' ? nightLightStations(spline) : [];
    this.count = stations.length;
    this.drawCalls = stations.length ? 4 : 0;
    if (!stations.length) return;

    const bodies = new THREE.InstancedMesh(
      this.keepGeometry(lampBodyGeometry()),
      this.keepMaterial(new THREE.MeshStandardMaterial({ color: 0x343a3f, roughness: 0.48, metalness: 0.72 })),
      stations.length,
    );
    const lenses = new THREE.InstancedMesh(
      this.keepGeometry(lensGeometry()),
      this.keepMaterial(new THREE.MeshBasicMaterial({ color: 0xffd58a, toneMapped: false })),
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
    this.root.userData.headLocal = [HEAD_X - 0.20, HEAD_HEIGHT, 0];

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
      const head = new THREE.Vector3(HEAD_X - 0.20, HEAD_HEIGHT - 0.12, 0).applyMatrix4(matrix);

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
    this.root.add(bodies, lenses, cones, pools);
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
