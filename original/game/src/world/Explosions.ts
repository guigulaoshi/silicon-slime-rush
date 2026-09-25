import * as THREE from 'three';

/**
 * A bomb's fireball.
 *
 * Built the way real-time explosions usually are, in layers that each live for a different time:
 * a white-yellow flash for a tenth of a second; a cluster of soft camera-facing fire puffs that swell
 * while their colour cools from white through yellow and orange to a dark red, drawn premultiplied so
 * young puffs glow and old red ones cover the sky rather than tinting it; a warm glow on the ground under it that stands in for a light; and a few
 * dark smoke puffs that rise and thin out. Every layer is gone within two seconds -- slimes do not burn
 *So nothing is left alight. Sparks and the scorch stay with `SlimeEffects`.
 *
 * One instanced quad pool per blend mode and no real light: a point light would add a per-fragment
 * cost to every lit material in the world and a shader recompile the first time it appears.
 */
export const EXPLOSION_POOL = 384;
/** Seconds each layer lives; every layer ends by the last. */
export const EXPLOSION_LIFETIMES = { flash: .12, fire: .95, glow: .6, smoke: 1.8 } as const;
const FIRE_PUFFS = 14;
const SMOKE_PUFFS = 7;

type Layer = 'flash' | 'fire' | 'glow' | 'smoke';
const LAYERS: readonly Layer[] = ['flash', 'fire', 'glow', 'smoke'];

const vertexShader = `
  uniform float uTime;
  attribute vec3 puffOrigin;
  attribute vec3 puffVelocity;
  attribute float puffBorn;
  attribute float puffLife;
  attribute vec2 puffSize;
  attribute float puffLayer;
  attribute float puffSeed;
  varying vec2 vUv;
  varying float vAge;
  varying float vLayer;
  varying float vSeed;
  void main() {
    float age = (uTime - puffBorn) / puffLife;
    float alive = step(0.0, age) * (1.0 - step(1.0, age));
    float t = clamp(age, 0.0, 1.0);
    vAge = t; vLayer = puffLayer; vSeed = puffSeed; vUv = uv;
    // Fire and smoke slow as they spread; smoke keeps rising.
    float eased = 1.0 - (1.0 - t) * (1.0 - t);
    vec3 centre = puffOrigin + puffVelocity * eased * puffLife;
    float size = mix(puffSize.x, puffSize.y, eased) * alive;
    vec3 world;
    if (puffLayer > 1.5 && puffLayer < 2.5) {
      // The ground glow lies flat on the road.
      world = centre + vec3(position.x, 0.0, -position.y) * size;
    } else {
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      float spin = puffSeed * 6.2831 + t * (puffSeed - 0.5) * 2.0;
      vec2 p = vec2(cos(spin) * position.x - sin(spin) * position.y, sin(spin) * position.x + cos(spin) * position.y);
      world = centre + (right * p.x + up * p.y) * size;
    }
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fireFragment = `
  varying vec2 vUv;
  varying float vAge;
  varying float vLayer;
  varying float vSeed;
  // White-hot, yellow, orange, deep red: the colours a fireball cools through.
  vec3 fireRamp(float t) {
    vec3 hot = vec3(1.0, 0.96, 0.78);
    vec3 yellow = vec3(1.0, 0.78, 0.22);
    vec3 orange = vec3(1.0, 0.42, 0.06);
    vec3 red = vec3(0.62, 0.09, 0.02);
    if (t < 0.06) return mix(hot, yellow, t / 0.06);
    if (t < 0.25) return mix(yellow, orange, (t - 0.06) / 0.19);
    return mix(orange, red, (t - 0.25) / 0.5);
  }
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    float angle = atan(d.y, d.x);
    // A lumpy edge, different for every puff, so the cluster does not read as circles.
    float lumps = 0.82 + 0.1 * sin(angle * 5.0 + vSeed * 31.0) + 0.08 * sin(angle * 9.0 - vSeed * 17.0);
    float body = 1.0 - smoothstep(lumps * 0.55, lumps, r);
    vec3 colour;
    float strength;
    if (vLayer < 0.5) {
      colour = vec3(1.0, 0.86, 0.55);
      strength = (1.0 - vAge) * (1.0 - smoothstep(0.0, 1.0, r)) * 0.8;
    } else if (vLayer < 1.5) {
      float core = 1.0 - smoothstep(0.0, 0.7, r);
      colour = fireRamp(clamp(vAge + (1.0 - core) * 0.3, 0.0, 1.0));
      // Fourteen puffs overlap additively; each stays dim enough that the pile reads orange, not white.
      strength = body * (0.38 + core * 0.22 * (1.0 - vAge)) * (1.0 - smoothstep(0.55, 1.0, vAge));
    } else {
      colour = vec3(1.0, 0.5, 0.14);
      strength = (1.0 - smoothstep(0.0, 1.0, r)) * (1.0 - vAge) * 0.55;
    }
    if (strength <= 0.002) discard;
    // Young fire adds light (alpha below its brightness); old fire becomes opaque, darker red. The
    // flash and the ground glow only ever add light.
    float cover = vLayer > 0.5 && vLayer < 1.5 ? mix(0.35, 1.0, smoothstep(0.15, 0.6, vAge)) : 0.0;
    if (vLayer > 0.5 && vLayer < 1.5) colour *= 1.0 - 0.35 * smoothstep(0.4, 1.0, vAge);
    gl_FragColor = vec4(colour * strength, strength * cover);
    #include <colorspace_fragment>
  }
`;

const smokeFragment = `
  varying vec2 vUv;
  varying float vAge;
  varying float vSeed;
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    float angle = atan(d.y, d.x);
    float lumps = 0.85 + 0.08 * sin(angle * 6.0 + vSeed * 23.0);
    float body = 1.0 - smoothstep(lumps * 0.35, lumps, r);
    // Fades in behind the fire, then thins away.
    float alpha = body * smoothstep(0.05, 0.25, vAge) * (1.0 - smoothstep(0.45, 1.0, vAge)) * 0.5;
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(vec3(0.16, 0.14, 0.13), alpha);
    #include <colorspace_fragment>
  }
`;

class PuffPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly origin: THREE.InstancedBufferAttribute;
  private readonly velocity: THREE.InstancedBufferAttribute;
  private readonly born: THREE.InstancedBufferAttribute;
  private readonly life: THREE.InstancedBufferAttribute;
  private readonly size: THREE.InstancedBufferAttribute;
  private readonly layer: THREE.InstancedBufferAttribute;
  private readonly seed: THREE.InstancedBufferAttribute;
  private next = 0;

  constructor(name: string, fragmentShader: string, blending: THREE.Blending, time: { value: number }) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const attribute = (size: number, fill = 0) =>
      new THREE.InstancedBufferAttribute(new Float32Array(EXPLOSION_POOL * size).fill(fill), size);
    this.origin = attribute(3);
    this.velocity = attribute(3);
    this.born = attribute(1, -100);
    this.life = attribute(1, 1);
    this.size = attribute(2);
    this.layer = attribute(1);
    this.seed = attribute(1);
    geometry.setAttribute('puffOrigin', this.origin);
    geometry.setAttribute('puffVelocity', this.velocity);
    geometry.setAttribute('puffBorn', this.born);
    geometry.setAttribute('puffLife', this.life);
    geometry.setAttribute('puffSize', this.size);
    geometry.setAttribute('puffLayer', this.layer);
    geometry.setAttribute('puffSeed', this.seed);
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.ShaderMaterial({
      uniforms: { uTime: time },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending,
      side: THREE.DoubleSide,
    }), EXPLOSION_POOL);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
  }

  write(at: number, layer: Layer, origin: THREE.Vector3, velocity: THREE.Vector3,
    life: number, from: number, to: number, seed: number): void {
    const i = this.next;
    this.next = (this.next + 1) % EXPLOSION_POOL;
    this.origin.setXYZ(i, origin.x, origin.y, origin.z);
    this.velocity.setXYZ(i, velocity.x, velocity.y, velocity.z);
    this.born.setX(i, at);
    this.life.setX(i, life);
    this.size.setXY(i, from, to);
    this.layer.setX(i, LAYERS.indexOf(layer));
    this.seed.setX(i, seed);
  }

  commit(): void {
    for (const attribute of [this.origin, this.velocity, this.born, this.life, this.size, this.layer, this.seed]) {
      attribute.needsUpdate = true;
    }
  }

  /** The layer of every puff still on screen at `time`. */
  liveLayers(time: number): Layer[] {
    const out: Layer[] = [];
    for (let i = 0; i < EXPLOSION_POOL; i++) {
      const age = time - this.born.getX(i);
      if (age >= 0 && age < this.life.getX(i)) out.push(LAYERS[this.layer.getX(i)]!);
    }
    return out;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export class ExplosionEffects {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly fire: PuffPool;
  private readonly smoke: PuffPool;
  private serial = 0;

  constructor() {
    // Premultiplied: bright early puffs still glow, but late red fire covers the sky instead of adding
    // to it (additive red over blue sky reads pink).
    this.fire = new PuffPool('explosion-fire', fireFragment, THREE.CustomBlending, this.time);
    const fire = this.fire.mesh.material as THREE.ShaderMaterial;
    fire.blendSrc = THREE.OneFactor; fire.blendDst = THREE.OneMinusSrcAlphaFactor;
    fire.blendSrcAlpha = THREE.OneFactor; fire.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.smoke = new PuffPool('explosion-smoke', smokeFragment, THREE.NormalBlending, this.time);
    // Smoke first so the glowing fire draws over it.
    this.smoke.mesh.renderOrder = 1;
    this.fire.mesh.renderOrder = 2;
    this.group.add(this.smoke.mesh, this.fire.mesh);
    this.group.name = 'explosions';
  }

  /** `scale` is the bomb's effect scale, the same number its sparks and scorch use. */
  spawn(centre: THREE.Vector3, ground: THREE.Vector3, scale: number): void {
    const now = this.time.value;
    const size = THREE.MathUtils.clamp(scale / 2, .45, 2.5);
    const serial = ++this.serial;
    const seed = (n: number) => {
      const x = Math.sin(serial * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    const zero = new THREE.Vector3();
    this.fire.write(now, 'flash', centre, zero, EXPLOSION_LIFETIMES.flash, 3 * size, 4.5 * size, seed(0));
    this.fire.write(now, 'glow', ground.clone().add(new THREE.Vector3(0, .05, 0)), zero,
      EXPLOSION_LIFETIMES.glow, 7 * size, 10 * size, seed(1));
    for (let i = 0; i < FIRE_PUFFS; i++) {
      const angle = i * 2.399963 + seed(i + 2) * .6;
      const outward = (1.2 + seed(i + 40) * 2.2) * size;
      const velocity = new THREE.Vector3(Math.cos(angle) * outward, (1.4 + seed(i + 80) * 2.2) * size,
        Math.sin(angle) * outward);
      const start = centre.clone().addScaledVector(velocity, .08);
      const life = EXPLOSION_LIFETIMES.fire * (.7 + seed(i + 120) * .3);
      this.fire.write(now + i * .006, 'fire', start, velocity, life,
        (.9 + seed(i + 160) * .6) * size, (2.6 + seed(i + 200) * 1.4) * size, seed(i + 240));
    }
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const angle = i * 2.399963 + 1.1;
      const velocity = new THREE.Vector3(Math.cos(angle) * .8 * size, (1.6 + seed(i + 300) * .9) * size,
        Math.sin(angle) * .8 * size);
      this.smoke.write(now + .08, 'smoke', centre.clone().add(new THREE.Vector3(0, .6 * size, 0)), velocity,
        EXPLOSION_LIFETIMES.smoke * (.8 + seed(i + 340) * .2), 1.4 * size, 4.2 * size, seed(i + 380));
    }
    this.fire.commit();
    this.smoke.commit();
  }

  update(dt: number): void {
    this.time.value += dt;
  }

  /** Layers still on screen, for tests and the debug report. */
  get liveLayers(): Layer[] {
    return [...this.fire.liveLayers(this.time.value), ...this.smoke.liveLayers(this.time.value)];
  }

  dispose(): void {
    this.fire.dispose();
    this.smoke.dispose();
  }
}
