import * as THREE from 'three';
import type { WorldSurfaceHit } from '../physics/PhysicsWorld';
import type { Car } from '../physics/Car';
import { SplatterRenderer } from './SplatterRenderer';
import { SHAPE_MASK_SIZE, WeatherSurface, patchQuaternion, wheelSpray } from './WeatherSurface';

const CAPACITY = 5000;
/** Fixed pool fed by actual wheel contacts, shared by every driver and trailer. */
export class WeatherEffects {
  readonly root = new THREE.Group();
  private readonly positions = new Float32Array(CAPACITY * 3);
  private readonly velocities = new Float32Array(CAPACITY * 3);
  private readonly floors = new Float32Array(CAPACITY);
  private readonly ages = new Float32Array(CAPACITY);
  private readonly lives = new Float32Array(CAPACITY);
  private readonly sizes = new Float32Array(CAPACITY);
  private readonly snow = new Float32Array(CAPACITY);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly patches: { mesh: THREE.Mesh; target?: THREE.WebGLRenderTarget; generated: boolean; shaped?: THREE.DataTexture }[] = [];
  private readonly shapeTextures = new Map<Uint8Array, THREE.DataTexture>();
  private readonly generator = new SplatterRenderer();
  private readonly clock = { value: 0 };
  private readonly debts = new WeakMap<Car, number[]>();
  private cursor = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly fittedAt = new WeakMap<THREE.Mesh, number>();
  private groundQuery: ((x: number, z: number, top: number, bottom: number) => WorldSurfaceHit | null) | null = null;
  setGroundQuery(query: (x: number, z: number, top: number, bottom: number) => WorldSurfaceHit | null): void { this.groundQuery = query; }
  private fitGround(x: number, z: number): void {
    if (!this.groundQuery) return;
    for (const [i, item] of this.patches.entries()) {
      const patch = this.surface.patches[i]!;
      if (Math.hypot(patch.x - x, patch.z - z) > 100) continue;
      const now = performance.now();
      if (patch.available && now - (this.fittedAt.get(item.mesh) ?? -Infinity) < 500) continue;
      this.fittedAt.set(item.mesh, now);
      const ground = this.groundQuery(patch.x, patch.z, patch.y + 1.5, patch.y - 3);
      item.mesh.visible = !!ground && ground.normal.y > .95;
      patch.available = item.mesh.visible;
      if (!ground || !item.mesh.visible) continue;
      patch.y = ground.point.y;
      item.mesh.position.y = patch.y + .025;
      const vertices = item.mesh.geometry.getAttribute('position');
      for (let j = 0; j < vertices.count; j++) {
        const local = new THREE.Vector3(vertices.getX(j), vertices.getY(j), 0);
        const point = local.clone().applyQuaternion(item.mesh.quaternion).add(item.mesh.position);
        const hit = this.groundQuery(point.x, point.z, patch.y + 1.5, patch.y - 3);
        if (hit && hit.normal.y > .95) {
          point.y = hit.point.y + .025;
          local.copy(point).sub(item.mesh.position).applyQuaternion(item.mesh.quaternion.clone().invert());
          vertices.setXYZ(j, local.x, local.y, local.z);
        }
      }
      vertices.needsUpdate = true; item.mesh.geometry.computeVertexNormals();
    }
  }
  emitted = { water: 0, snow: 0 };

  constructor(readonly surface: WeatherSurface) {
    this.root.name = 'weather-wheel-effects';
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('particleSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('snowParticle', new THREE.BufferAttribute(this.snow, 1));
    this.material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      vertexShader: `attribute float particleSize;attribute float snowParticle;varying float snow;varying float alive;
        void main(){snow=snowParticle;alive=particleSize;vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;
          gl_PointSize=clamp(particleSize*650.0/max(1.0,-p.z),0.0,25.0);}`,
      fragmentShader: `varying float snow;varying float alive;void main(){if(alive<.001)discard;float d=length(gl_PointCoord-.5)*2.0;if(d>1.0)discard;
        float a=mix(.32,.9,snow)*(1.0-smoothstep(.35,1.0,d));
        gl_FragColor=vec4(mix(vec3(.57,.76,.87),vec3(.96,.98,1.0),snow),a);}` });
    const particles = new THREE.Points(this.geometry, this.material);
    particles.frustumCulled = false; this.root.add(particles);
    for (const patch of surface.patches) {
      const frozen = patch.kind === 'ice', deep = patch.kind === 'deepSnow';
      // Puddles and ice come with a CPU shape mask; only deep snow still uses the GPU splatter.
      let shaped = !deep && patch.mask ? this.shapeTextures.get(patch.mask) : undefined;
      if (!deep && patch.mask && !shaped) {
        shaped = new THREE.DataTexture(patch.mask, SHAPE_MASK_SIZE, SHAPE_MASK_SIZE);
        shaped.magFilter = shaped.minFilter = THREE.LinearFilter; shaped.needsUpdate = true;
        this.shapeTextures.set(patch.mask, shaped);
      }
      const target = shaped ? undefined : new THREE.WebGLRenderTarget(256, 256, { depthBuffer: false });
      const material = new THREE.MeshStandardMaterial({ color: deep ? 0xf4f6ff : frozen ? 0x6f93a3 : 0x324f5b,
        roughness: deep ? .95 : frozen ? .04 : .12, metalness: deep ? 0 : .32,
        transparent: true, opacity: deep ? .88 : frozen ? .78 : .82, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2 });
      material.onBeforeCompile = shader => {
        shader.uniforms.weatherMask = { value: shaped ?? target!.texture }; shader.uniforms.weatherTime = this.clock;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 weatherUv;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nweatherUv=uv;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
          '#include <common>\nuniform sampler2D weatherMask;uniform float weatherTime;varying vec2 weatherUv;')
          .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
            vec2 q=(weatherUv-.5)*2.0;vec4 weatherTexel=texture2D(weatherMask,${deep ? 'vec2(.17,.5)+(weatherUv-.5)*.28' : 'weatherUv'});
            float rim=${!deep ? '1.0' : '1.0-smoothstep(.7,1.0,length(q))'};
            diffuseColor.a*=rim*weatherTexel.a;if(diffuseColor.a<.025)discard;
            ${!frozen && !deep ? `float ripple=0.0;
              for(int i=0;i<5;i++){float f=float(i);vec2 c=vec2(sin(f*17.3),cos(f*9.7))*.65;
                float age=fract(weatherTime*.72+f*.213);float r=length(q-c);
                ripple+=exp(-abs(r-age*.48)*95.0)*(1.0-age)*.22;}
              diffuseColor.rgb+=vec3(ripple);` : frozen ? `float frost=1.0-smoothstep(0.0,.12,weatherTexel.r);float crack=0.0;
              for(int i=0;i<4;i++){float f=float(i);vec2 c=vec2(sin(f*5.1+1.3),cos(f*3.7+.4))*.35;
                float a=f*1.9+.6;vec2 n=vec2(cos(a),sin(a));vec2 d=q-c;
                crack+=exp(-abs(dot(d,n))*420.0)*(1.0-smoothstep(.12,.34,abs(dot(d,vec2(-n.y,n.x)))));}
              diffuseColor.rgb=mix(diffuseColor.rgb*(.8+.4*weatherTexel.g),vec3(.9,.95,.98),min(1.0,frost*.4+crack*.5));
              diffuseColor.a=min(1.0,diffuseColor.a*(.85+frost*.15)+crack*.2);` : ''}`);
      };
      material.customProgramCacheKey = () => `weather-patch-${patch.kind}`;
      const geometry = new THREE.PlaneGeometry(patch.radius * 2, patch.radius * 2, 6, 6);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(patch.x, patch.y + .035, patch.z);
      mesh.quaternion.copy(patchQuaternion(surface.spline, patch));
      mesh.name = `weather-${patch.kind}`; this.root.add(mesh); this.patches.push({ mesh, target, generated: !!shaped, shaped });
    }
  }

  /** Draw the deep-snow masks again: they live only in render targets, which a restored context left empty. */
  regenerate(): void { this.renderer = null; }

  render(renderer: THREE.WebGLRenderer, camera?: THREE.Camera): void {
    if (this.renderer !== renderer) {
      this.renderer = renderer;
      for (const patch of this.patches) patch.generated = !!patch.shaped;
    }
    if (camera) this.fitGround(camera.position.x, camera.position.z);
    for (const [i, patch] of this.patches.entries()) if (!patch.generated) {
      this.generator.generate(renderer, 288 + i * 71, 0, patch.target!);
      const pixels = new Uint8Array(256 * 256 * 4);
      renderer.readRenderTargetPixels(patch.target!, 0, 0, 256, 256, pixels);
      this.surface.patches[i]!.mask = pixels;
      patch.generated = true;
    }
  }

  step(dt: number, cars: readonly Car[]): void {
    this.clock.value += dt;
    for (let i = 0; i < CAPACITY; i++) {
      if (this.lives[i]! <= 0) continue;
      this.ages[i]! += dt;
      if (this.ages[i]! >= this.lives[i]! || this.positions[i * 3 + 1]! < this.floors[i]!) { this.lives[i] = 0; this.sizes[i] = 0; continue; }
      const k = i * 3, snow = this.snow[i]!;
      this.velocities[k + 1]! -= dt * (snow ? 2.8 : 9.8);
      const drag = Math.exp(-dt * (snow ? 1.7 : .4));
      for (let axis = 0; axis < 3; axis++) { this.positions[k + axis]! += this.velocities[k + axis]! * dt; this.velocities[k + axis]! *= drag; }
      this.sizes[i]! *= Math.exp(-dt * (snow ? .55 : 1.2));
    }
    for (const car of cars) {
      this.fitGround(car.position.x, car.position.z);
      let debt = this.debts.get(car); if (!debt) { debt = car.wheels.map(() => 0); this.debts.set(car, debt); }
      const velocity = car.body.linvel();
      for (const [wheelIndex, wheel] of car.wheels.entries()) {
        if (!wheel.grounded || !wheel.weather) { debt[wheelIndex] = 0; continue; }
        const spray = wheelSpray(wheel.weather, car.speed);
        if (!spray.rate) { debt[wheelIndex] = 0; continue; }
        debt[wheelIndex]! += spray.rate * dt;
        while (debt[wheelIndex]! >= 1) {
          debt[wheelIndex]!--;
          const i = this.cursor++ % CAPACITY, k = i * 3;
          const snow = wheel.weather.kind === 'snow' || wheel.weather.kind === 'deepSnow';
          const sideways = (wheelIndex % 2 ? 1 : -1) * (1 + Math.random() * spray.lift);
          const f = car.forward;
          this.positions.set([wheel.contact.x, wheel.contact.y + .05, wheel.contact.z], k);
          this.velocities.set([velocity.x * .15 - f.z * sideways,
            spray.lift * (.7 + Math.random() * .6), velocity.z * .15 + f.x * sideways], k);
          this.floors[i] = wheel.contact.y;
          this.ages[i] = 0; this.lives[i] = spray.life; this.sizes[i] = spray.size * (.7 + Math.random()); this.snow[i] = snow ? 1 : 0;
          this.emitted[snow ? 'snow' : 'water']++;
        }
      }
    }
    for (const name of ['position', 'particleSize', 'snowParticle']) this.geometry.getAttribute(name).needsUpdate = true;
  }
  stats(): { active: number; water: number; snow: number; patches: number } {
    return { active: this.lives.filter(life => life > 0).length, ...this.emitted, patches: this.patches.length };
  }
  dispose(): void {
    this.root.removeFromParent(); this.geometry.dispose(); this.material.dispose(); this.generator.dispose();
    for (const patch of this.patches) { patch.mesh.geometry.dispose(); (patch.mesh.material as THREE.Material).dispose(); patch.target?.dispose(); }
    for (const texture of this.shapeTextures.values()) texture.dispose();
  }
}
