import type RAPIER from '@dimforge/rapier3d-compat';
import type { ColliderSink, TileColliders } from './colliders';

let rapier: typeof RAPIER | null = null;

/** Load the Rapier wasm once per session. Everything physics is unavailable until this resolves. */
export async function initPhysics(): Promise<typeof RAPIER> {
  if (!rapier) {
    const mod = await import('@dimforge/rapier3d-compat');
    await mod.init();
    rapier = mod;
  }
  return rapier;
}

export interface StepResult {
  /** how many fixed steps ran this frame */
  steps: number;
  /** game time the physics actually advanced; may be less than the requested dt after a stall */
  elapsed: number;
  /** 0..1 position between the last two fixed states, for render interpolation */
  alpha: number;
}

export interface WorldSurfaceHit {
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

export type CollisionRole = 'car' | 'ground' | 'wall' | 'guardrail' | 'slime-popper' | 'slime-burst'
  | 'slime-slick' | 'slime-colossus' | 'slime-bounce' | 'slime-falling' | 'slime-debris';
export type CarCollisionKind = Exclude<CollisionRole, 'ground'>;

export interface CarCollision {
  kind: CarCollisionKind;
  started: boolean;
  /* */
  other: number;
  /** World-space solver contact. Sensors fall back to the other collider's centre. */
  point: { x: number; y: number; z: number };
  /** World-space normal pointing away from the other collider and back toward this car. */
  normal: { x: number; y: number; z: number };
  /** Pre-solve closing speed along the contact normal, in metres per second. */
  closingSpeed: number;
}

const GROUP = { world: 1 << 0, car: 1 << 1, slimeSensor: 1 << 2, colossus: 1 << 3, slimeBody: 1 << 4, debris: 1 << 5 } as const;
const groups = (membership: number, filter: number): number => (membership << 16) | filter;
const ALL_DRIVABLE = GROUP.world | GROUP.slimeSensor | GROUP.colossus | GROUP.slimeBody;

export const COLLISION_GROUPS: Readonly<Record<CollisionRole, number>> = {
  car: groups(GROUP.car, ALL_DRIVABLE),
  ground: groups(GROUP.world, GROUP.car | GROUP.slimeBody | GROUP.debris),
  wall: groups(GROUP.world, GROUP.car | GROUP.slimeBody | GROUP.debris),
  guardrail: groups(GROUP.world, GROUP.car | GROUP.slimeBody | GROUP.debris),
  'slime-popper': groups(GROUP.slimeSensor, GROUP.car),
  'slime-burst': groups(GROUP.slimeSensor, GROUP.car),
  'slime-slick': groups(GROUP.slimeSensor, GROUP.car),
  'slime-colossus': groups(GROUP.colossus, GROUP.car),
  'slime-bounce': groups(GROUP.slimeBody, GROUP.world | GROUP.car),
  'slime-falling': groups(GROUP.debris, GROUP.world),
  'slime-debris': groups(GROUP.debris, GROUP.world),
};

/**
 * The physics world and its fixed-rate clock.
 *
 * The car is integrated at a fixed 60 Hz no matter what the display does, because grip and
 * suspension behave differently at different step sizes and a car that handles differently on a
 * 144 Hz screen than a 60 Hz one is not tunable. Rendering interpolates between the last two
 * states rather than stepping physics to match the frame.
 */
export class PhysicsWorld implements ColliderSink {
  readonly world: RAPIER.World;
  readonly api: typeof RAPIER;
  readonly timestep: number;
  private accumulator = 0;
  private origin = { x: 0, y: 0, z: 0 };
  private readonly tiles = new Map<string, RAPIER.RigidBody[]>();
  private readonly events: RAPIER.EventQueue;
  private readonly colliderRoles = new Map<number, CollisionRole>();
  private readonly pending = new Map<number, CarCollision[]>();
  private readonly carVelocities = new Map<number, { x: number; y: number; z: number }>();
  private readonly silentCarPairs = new Set<string>();

  constructor(api: typeof RAPIER, gravity = -19.6, timestep = 1 / 60) {
    this.api = api;
    this.timestep = timestep;
    this.world = new api.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = timestep;
    this.events = new api.EventQueue(true);
  }

  /** Rendering, track data and gameplay use world metres; Rapier integrates near the driver. */
  toLocal(point: RAPIER.Vector): RAPIER.Vector {
    return { x: point.x - this.origin.x, y: point.y, z: point.z - this.origin.z };
  }

  toWorld(point: RAPIER.Vector): RAPIER.Vector {
    return { x: point.x + this.origin.x, y: point.y, z: point.z + this.origin.z };
  }

  bodyPosition(body: RAPIER.RigidBody): RAPIER.Vector {
    return this.toWorld(body.translation());
  }

  setBodyPosition(body: RAPIER.RigidBody, point: RAPIER.Vector): void {
    body.setTranslation(this.toLocal(point), true);
  }

  createRigidBody(desc: RAPIER.RigidBodyDesc): RAPIER.RigidBody {
    desc.translation = this.toLocal(desc.translation);
    return this.world.createRigidBody(desc);
  }

  createCollider(desc: RAPIER.ColliderDesc, parent?: RAPIER.RigidBody): RAPIER.Collider {
    if (!parent) desc.translation = this.toLocal(desc.translation);
    return this.world.createCollider(desc, parent);
  }

  castRayAndGetNormal(...args: Parameters<RAPIER.World['castRayAndGetNormal']>):
    ReturnType<RAPIER.World['castRayAndGetNormal']> {
    const [ray, ...filters] = args;
    return this.world.castRayAndGetNormal(new this.api.Ray(this.toLocal(ray.origin), ray.dir), ...filters);
  }

  private rebase(): void {
    // Minimise the farthest driver's local coordinates when the field spreads along a long road.
    const positions: RAPIER.Vector[] = [];
    for (const [handle, role] of this.colliderRoles) {
      if (role !== 'car') continue;
      const body = this.world.getCollider(handle)?.parent();
      if (body) positions.push(body.translation());
    }
    if (!positions.length) return;
    const x = (Math.min(...positions.map(p => p.x)) + Math.max(...positions.map(p => p.x))) / 2;
    const z = (Math.min(...positions.map(p => p.z)) + Math.max(...positions.map(p => p.z))) / 2;
    if (Math.max(Math.abs(x), Math.abs(z)) < 256) return;
    const dx = Math.round(x / 128) * 128, dz = Math.round(z / 128) * 128;
    this.world.forEachRigidBody(body => {
      const p = body.translation();
      body.setTranslation({ x: p.x - dx, y: p.y, z: p.z - dz }, false);
    });
    this.world.forEachCollider(collider => {
      if (collider.parent()) return;
      const p = collider.translation();
      collider.setTranslation({ x: p.x - dx, y: p.y, z: p.z - dz });
    });
    this.origin.x += dx;
    this.origin.z += dz;
  }

  /** Register one collider with both collision filtering and event classification. */
  registerCollider(collider: RAPIER.Collider, role: CollisionRole): void {
    collider.setCollisionGroups(COLLISION_GROUPS[role]);
    this.colliderRoles.set(collider.handle, role);
    if (role === 'car') collider.setActiveEvents(this.api.ActiveEvents.COLLISION_EVENTS);
  }

  unregisterCollider(collider: RAPIER.Collider): void {
    this.colliderRoles.delete(collider.handle);
    this.carVelocities.delete(collider.handle);
  }

  collisionRole(collider: RAPIER.Collider): CollisionRole | undefined {
    return this.colliderRoles.get(collider.handle);
  }

  /** Connected tow bodies must still stop one another when the hitch folds. */
  setVehicleContacts(collider: RAPIER.Collider, enabled: boolean): void {
    collider.setCollisionGroups(groups(GROUP.car, ALL_DRIVABLE | (enabled ? GROUP.car : 0)));
  }

  /** Capture the velocity Rapier is about to integrate, so impacts use pre-solve relative motion. */
  recordCarVelocity(collider: RAPIER.Collider, velocity: RAPIER.Vector): void {
    this.carVelocities.set(collider.handle, { x: velocity.x, y: velocity.y, z: velocity.z });
  }

  /** A towing body and its own trailer touch at full lock but are one vehicle to the player. */
  suppressCarImpact(a: RAPIER.Collider, b: RAPIER.Collider, suppressed: boolean): void {
    const key = this.carPairKey(a.handle, b.handle);
    if (suppressed) this.silentCarPairs.add(key); else this.silentCarPairs.delete(key);
  }

  /** Events involving this car since its previous update. */
  takeCarCollisions(car: RAPIER.Collider): CarCollision[] {
    const out = this.pending.get(car.handle) ?? [];
    this.pending.delete(car.handle);
    return out;
  }

  /** Sweep a small camera volume against the same loaded ground and buildings as the cars. */
  cameraPosition(start: RAPIER.Vector, desired: RAPIER.Vector): RAPIER.Vector {
    const delta = { x: desired.x - start.x, y: desired.y - start.y, z: desired.z - start.z };
    // Photo mode also opens before the first physics step, when Rapier's world query index is
    // still empty. Query the registered solids directly, without advancing the frozen race.
    this.world.propagateModifiedBodyPositionsToColliders();
    const origin = this.toLocal(start), shape = new this.api.Ball(0.4);
    let closest = 1, blocked = false;
    for (const [handle, role] of this.colliderRoles) {
      if (role !== 'ground' && role !== 'wall' && role !== 'guardrail') continue;
      const collider = this.world.getCollider(handle);
      if (!collider || collider.isSensor() || !collider.isEnabled()) continue;
      const hit = collider.castShape({x: 0, y: 0, z: 0}, shape, origin,
        {x: 0, y: 0, z: 0, w: 1}, delta, 0.05, closest, true);
      if (hit) { closest = hit.time_of_impact; blocked = true; }
    }
    const fraction = blocked ? Math.max(0, closest - 0.001) : 1;
    return {x: start.x + delta.x * fraction, y: start.y + delta.y * fraction, z: start.z + delta.z * fraction};
  }

  /** Highest loaded solid surface at x/z. Visual effects use the same geometry the car hits. */
  surfaceAt(x: number, z: number, top = 250, bottom = -250): WorldSurfaceHit | null {
    const ray = new this.api.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 });
    const hit = this.castRayAndGetNormal(ray, top - bottom, true,
      this.api.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined, undefined, undefined, collider => this.colliderRoles.get(collider.handle) === 'ground'
        || this.colliderRoles.get(collider.handle) === 'wall'
        || this.colliderRoles.get(collider.handle) === 'guardrail');
    if (!hit) return null;
    const toi = (hit as unknown as { timeOfImpact?: number; toi?: number }).timeOfImpact
      ?? (hit as unknown as { toi: number }).toi;
    const normal = (hit as unknown as { normal: { x: number; y: number; z: number } }).normal;
    return { point: { x, y: top - toi, z }, normal: { x: normal.x, y: normal.y, z: normal.z } };
  }

  private drainEvents(): void {
    this.events.drainCollisionEvents((a, b, started) => {
      const ra = this.colliderRoles.get(a);
      const rb = this.colliderRoles.get(b);
      if (ra === 'car' && rb === 'car') {
        if (this.silentCarPairs.has(this.carPairKey(a, b))) return;
        this.queueCollision(a, b, 'car', started);
        this.queueCollision(b, a, 'car', started);
        return;
      }
      const car = ra === 'car' ? a : rb === 'car' ? b : null;
      const other = ra === 'car' ? rb : rb === 'car' ? ra : null;
      if (car === null || !other || other === 'ground') return;
      this.queueCollision(car, ra === 'car' ? b : a, other, started);
    });
  }

  private carPairKey(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  private queueCollision(carHandle: number, otherHandle: number, kind: CarCollisionKind,
    started: boolean): void {
    const car = this.world.getCollider(carHandle), other = this.world.getCollider(otherHandle);
    if (!car || !other) return;
    const carPosition = car.translation(), otherPosition = other.translation();
    let localPoint = { x: (carPosition.x + otherPosition.x) / 2, y: (carPosition.y + otherPosition.y) / 2,
      z: (carPosition.z + otherPosition.z) / 2 };
    let normal = { x: carPosition.x - otherPosition.x, y: carPosition.y - otherPosition.y,
      z: carPosition.z - otherPosition.z };
    this.world.contactPair(car, other, manifold => {
      const count = manifold.numSolverContacts();
      const contact = count > 0 ? manifold.solverContactPoint(0) : null;
      if (contact) localPoint = { x: contact.x, y: contact.y, z: contact.z };
      const n = manifold.normal();
      normal = { x: n.x, y: n.y, z: n.z };
    });
    const towardCar = { x: carPosition.x - otherPosition.x, y: carPosition.y - otherPosition.y,
      z: carPosition.z - otherPosition.z };
    if (normal.x * towardCar.x + normal.y * towardCar.y + normal.z * towardCar.z < 0) {
      normal = { x: -normal.x, y: -normal.y, z: -normal.z };
    }
    const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
    normal = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
    const carVelocity = this.carVelocities.get(carHandle) ?? { x: 0, y: 0, z: 0 };
    const otherVelocity = this.carVelocities.get(otherHandle) ?? { x: 0, y: 0, z: 0 };
    const relative = { x: carVelocity.x - otherVelocity.x, y: carVelocity.y - otherVelocity.y,
      z: carVelocity.z - otherVelocity.z };
    const closingSpeed = Math.abs(relative.x * normal.x + relative.y * normal.y + relative.z * normal.z);
    const point = this.toWorld(localPoint);
    const list = this.pending.get(carHandle) ?? [];
    list.push({ kind, started, other: otherHandle, point, normal, closingSpeed });
    this.pending.set(carHandle, list);
  }

  /** Run whole fixed steps for the elapsed time, calling `before` ahead of each one. */
  /**
   * Advance the fixed-step simulation by `dt` seconds of game time.
   *
   * `maxSteps` is the ceiling on how much of a stall gets replayed: better to lose time than to
   * teleport the car. It is a parameter rather than a constant because the automated run asks for
   * game time to pass faster than wall time, and the ceiling has to rise with it or the extra time
   * is simply thrown away.
   */
  step(dt: number, before?: (h: number) => void, maxSteps = 5, after?: (h: number) => void): StepResult {
    this.accumulator = Math.min(this.accumulator + dt, this.timestep * maxSteps);
    let steps = 0;
    while (this.accumulator >= this.timestep) {
      before?.(this.timestep);
      // Queries in before() used the previous origin. The step now updates collider transforms
      // and the broad phase together before any after() callback or next-frame query runs.
      this.rebase();
      this.world.step(this.events);
      this.drainEvents();
      after?.(this.timestep);
      this.accumulator -= this.timestep;
      steps++;
    }
    return { steps, elapsed: steps * this.timestep, alpha: this.accumulator / this.timestep };
  }

  add(key: string, colliders: TileColliders): void {
    if (this.tiles.has(key)) this.remove(key);
    const bodies: RAPIER.RigidBody[] = [];
    for (const t of colliders.trimeshes) {
      if (t.indices.length === 0) continue;
      // A floating world origin does not improve a mesh's internal coordinates. Keep each
      // streamed tile local as well, so CCD does not subtract kilometre-sized vertices at impact.
      const low = [Infinity, Infinity, Infinity];
      const high = [-Infinity, -Infinity, -Infinity];
      t.vertices.forEach((value, index) => {
        const axis = index % 3;
        low[axis] = Math.min(low[axis]!, value);
        high[axis] = Math.max(high[axis]!, value);
      });
      const center = low.map((value, axis) => (value + high[axis]!) / 2);
      const vertices = t.vertices.map((value, index) => value - center[index % 3]!);
      const body = this.createRigidBody(this.api.RigidBodyDesc.fixed()
        .setTranslation(center[0]!, center[1]!, center[2]!));
      // FIX_INTERNAL_EDGES, or the seams inside the mesh become walls. A triangle soup has no idea
      // which of its edges are real edges and which are the joins between neighbouring triangles,
      // and a box sliding over a join catches on it: the car meets a normal pointing straight back
      // down the road and stops dead in one step, on flat ground, with nothing there. It reads as
      // hitting something invisible, and it is the single worst thing the physics can do.
      const collider = this.createCollider(
        this.api.ColliderDesc.trimesh(vertices, t.indices, this.api.TriMeshFlags.FIX_INTERNAL_EDGES),
        body,
      );
      this.registerCollider(collider, t.role ?? 'ground');
      bodies.push(body);
    }
    for (const b of colliders.boxes) {
      const half = b.half;
      const body = this.createRigidBody(
        this.api.RigidBodyDesc.fixed()
          .setTranslation(b.center[0], b.center[1], b.center[2])
          .setRotation(yawQuaternion(b.yaw)),
      );
      const collider = this.createCollider(this.api.ColliderDesc.cuboid(half[0], half[1], half[2]), body);
      this.registerCollider(collider, b.role ?? 'wall');
      bodies.push(body);
    }
    this.tiles.set(key, bodies);
  }

  remove(key: string): void {
    const bodies = this.tiles.get(key);
    if (!bodies) return;
    for (const b of bodies) {
      for (let i = 0; i < b.numColliders(); i++) this.colliderRoles.delete(b.collider(i).handle);
      this.world.removeRigidBody(b);
    }
    this.tiles.delete(key);
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  dispose(): void {
    for (const key of [...this.tiles.keys()]) this.remove(key);
    this.pending.clear();
    this.carVelocities.clear();
    this.silentCarPairs.clear();
    this.events.free();
    this.world.free();
  }
}

export function yawQuaternion(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
