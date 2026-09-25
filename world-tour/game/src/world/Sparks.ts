import * as THREE from 'three';

const MAX = 160;          // live particles; a scrape throws a handful a frame, not a firework
const LIFE = 0.38;        // seconds
const SIZE = 0.04;        // impact sparks must remain legible from the chase camera
const GRAVITY = -14;
const MIN_RUB = 0.12;      // intensity below which a contact is not a scrape
const MIN_HIT = 0.035;

/**
 * Sparks off the guardrail.
 *
 * They exist to say "you are touching the wall" without saying it in words, which matters more now
 * that touching the wall no longer throws the car across the road: the penalty is a quiet loss of
 * speed, and a quiet penalty the player cannot see is one they will think is a bug.
 *
 * One instanced quad mesh, a fixed pool, no allocation while driving.
 */
export class Sparks {
  readonly mesh: THREE.InstancedMesh;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  // Starts full of dead particles. A zero age means "just born", so an untouched array is a
  // hundred and sixty sparks sitting at the origin until the first update sweeps them. Filled well
  // past LIFE rather than with it: float32 rounds 0.38 down, and the array would come back alive.
  private readonly age = new Float32Array(MAX).fill(LIFE * 4);
  private readonly size = new Float32Array(MAX).fill(1);
  private readonly streak = new Uint8Array(MAX);
  private next = 0;
  private burstCount = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor() {
    const geom = new THREE.PlaneGeometry(SIZE, SIZE);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffa23c, transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geom, material, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sparks';
    this.hideAll();
  }

  /** How many particles are alive. Read by tests; the renderer uses `mesh.visible`. */
  get live(): number {
    let n = 0;
    for (let i = 0; i < MAX; i++) if ((this.age[i] ?? LIFE) < LIFE) n++;
    return n;
  }

  get impacts(): number { return this.burstCount; }

  /** Throw a few particles from a contact point. `intensity` is 0..1 and sets how many and how fast. */
  emit(x: number, y: number, z: number, intensity: number, forward: THREE.Vector3): void {
    // Nothing below a rub. Contact is measured every step, so a car parked against the rail was
    // throwing a spark sixty times a second while standing still; steel does not do that. The
    // intensity is the speed along the wall over thirty metres a second, so this is about twelve
    // kilometres an hour -- below that it is leaning on the barrier, not scraping it.
    if (intensity < MIN_RUB) return;
    const count = Math.max(1, Math.round(intensity * 6));
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      // mostly straight back along the car, with a spray outward and up
      const speed = 3 + intensity * 9;
      this.vel[i * 3] = -forward.x * speed + (Math.random() - 0.5) * 4;
      this.vel[i * 3 + 1] = Math.random() * 3.5;
      this.vel[i * 3 + 2] = -forward.z * speed + (Math.random() - 0.5) * 4;
      this.size[i] = 0.7 + intensity * 0.8;
      this.streak[i] = 0;
      this.age[i] = 0;
    }
  }

  /** A brief radial burst for one collision start. Count, size and speed all carry its weight. */
  impact(x: number, y: number, z: number, intensity: number, normal: THREE.Vector3,
    forward: THREE.Vector3): void {
    if (intensity < MIN_HIT) return;
    this.burstCount++;
    const count = 3 + Math.round(intensity * 18);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const speed = 4 + intensity * 13;
      const outward = speed * (0.55 + Math.random() * 0.45);
      this.vel[i * 3] = normal.x * outward - forward.x * speed * 0.25 + (Math.random() - 0.5) * 5;
      this.vel[i * 3 + 1] = 1.5 + Math.random() * (3 + intensity * 6);
      this.vel[i * 3 + 2] = normal.z * outward - forward.z * speed * 0.25 + (Math.random() - 0.5) * 5;
      this.size[i] = 1.4 + intensity * 1.6;
      this.streak[i] = 1;
      this.age[i] = 0;
    }
  }

  update(dt: number): void {
    let live = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i]! >= LIFE) { this.hide(i); continue; }
      this.age[i]! += dt;
      this.vel[i * 3 + 1]! += GRAVITY * dt;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      const t = 1 - this.age[i]! / LIFE;
      this.p.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
      const size = Math.max(t, 0) * this.size[i]!;
      if (this.streak[i]) this.scale.set(size * 0.35, size * 1.5, size);
      else this.scale.setScalar(size);
      this.m.compose(this.p, this.q, this.scale);
      this.mesh.setMatrixAt(i, this.m);
      live++;
    }
    this.mesh.visible = live > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Face the camera, so a flat quad reads as a point of light from any angle. */
  faceCamera(camera: THREE.Camera): void {
    this.q.copy(camera.quaternion);
  }

  private hide(i: number): void {
    this.scale.setScalar(0);
    this.m.compose(this.p.set(0, -1e4, 0), this.q, this.scale);
    this.mesh.setMatrixAt(i, this.m);
  }

  private hideAll(): void {
    for (let i = 0; i < MAX; i++) this.hide(i);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
