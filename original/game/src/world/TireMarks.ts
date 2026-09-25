import * as THREE from 'three';
import type { Car, WheelState } from '../physics/Car';
import type { Weather } from './Sky';
import { GroundMarkPool } from './GroundMarkPool';

export type TireMarkKind = 'skid' | 'snow';
const SPACING = .24;
const MAX_GAP = 2.2;

export function tireMarkKind(weather: Weather, speed: number,
  wheels: readonly WheelState[]): TireMarkKind | null {
  const grounded = wheels.filter(wheel => wheel.grounded);
  if (speed < 1.1 || !grounded.length) return null;
  if (weather === 'snow') return grounded.some(wheel => !wheel.weather || wheel.weather.kind === 'snow' || wheel.weather.kind === 'deepSnow') ? 'snow' : null;
  return grounded.some(wheel => wheel.skid >= .18) ? 'skid' : null;
}

interface Run { kind: TireMarkKind; handle: number; start: THREE.Vector3; end: THREE.Vector3 }
interface MarkState {
  revision: number;
  anchors: (THREE.Vector3 | null)[];
  /** The mark each wheel is still extending while it drives straight. */
  runs: (Run | null)[];
}

/** A straight run keeps growing one mark while the wheel stays within this of its line. */
export const RUN_TOLERANCE = .02;
/** ...and no mark grows past this, so a long straight still bends with the road's surface. */
export const RUN_MAX_LENGTH = 6;

const _matrix = new THREE.Matrix4();

function markMatrix(from: THREE.Vector3, to: THREE.Vector3, width: number, target: THREE.Matrix4): THREE.Matrix4 | null {
  const dx = to.x - from.x, dz = to.z - from.z;
  const direction = to.clone().sub(from);
  const length = direction.length();
  if (length < .01) return null;
  const midpoint = from.clone().add(to).multiplyScalar(.5);
  midpoint.y += .018;
  direction.normalize();
  const right = new THREE.Vector3(dz, 0, -dx).normalize();
  const normal = direction.clone().cross(right).normalize();
  return target.compose(midpoint,
    new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, normal, direction)),
    new THREE.Vector3(width, 1, length));
}

/** True when `point` continues the straight run from `start` through `end`. */
export function continuesRun(start: THREE.Vector3, end: THREE.Vector3, point: THREE.Vector3): boolean {
  const along = end.clone().sub(start);
  const total = point.clone().sub(start);
  const length = along.length();
  if (length < 1e-4 || total.length() > RUN_MAX_LENGTH) return false;
  along.divideScalar(length);
  const projection = total.dot(along);
  if (projection <= length) return false;
  return total.addScaledVector(along, -projection).length() <= RUN_TOLERANCE;
}

class MarkLayer {
  readonly pool: GroundMarkPool;

  constructor(readonly kind: TireMarkKind, color: number, opacity: number) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    // Marks stay for the race. No age, no fade, no ring that overwrites the first lap.
    const material = new THREE.MeshBasicMaterial({ color, opacity, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide });
    this.pool = new GroundMarkPool(`${kind}-tire-marks`, geometry, material);
  }

  /** Lays a mark from `from` to `to`, or stretches `run` when the wheel is still on its line. */
  add(from: THREE.Vector3, to: THREE.Vector3, width: number, run: Run | null): Run | null {
    if (run && run.end.equals(from) && continuesRun(run.start, run.end, to)) {
      if (!markMatrix(run.start, to, width, _matrix)) return run;
      this.pool.set(run.handle, _matrix);
      run.end.copy(to);
      return run;
    }
    if (!markMatrix(from, to, width, _matrix)) return run;
    return { kind: this.kind, handle: this.pool.add(_matrix), start: from.clone(), end: to.clone() };
  }
}

/** World-space wheel trails shared by humans, AI and articulated bodies. */
export class TireMarks {
  readonly root = new THREE.Group();
  private readonly snow = new MarkLayer('snow', 0x46555d, .76);
  private readonly skid = new MarkLayer('skid', 0x111417, .72);
  private states = new WeakMap<Car, MarkState>();

  constructor(private readonly weather: Weather) {
    this.root.name = 'tire-marks';
    this.root.add(this.skid.pool.root, this.snow.pool.root);
  }

  step(dt: number, cars: readonly Car[]): void {
    void dt;
    for (const car of cars) this.track(car);
    this.snow.pool.flush(); this.skid.pool.flush();
  }

  private track(car: Car): void {
    const indices = car.wheels.length >= 4 ? [car.wheels.length - 2, car.wheels.length - 1] : [0, 1];
    const wheels = indices.map(index => car.wheels[index]!).filter(Boolean);

    let state = this.states.get(car);
    if (!state || state.revision !== car.poseRevision) {
      state = { revision: car.poseRevision, anchors: wheels.map(() => null), runs: wheels.map(() => null) };
      this.states.set(car, state);
    }
    for (const [side, wheel] of wheels.entries()) {
      const kind = tireMarkKind(this.weather, car.speed, [wheel]);
      if (!wheel.grounded) { state.anchors[side] = null; state.runs[side] = null; continue; }
      const point = wheel.contact;
      const anchor = state.anchors[side];
      if (!anchor || !kind) { state.anchors[side] = point.clone(); state.runs[side] = null; continue; }
      const distance = anchor.distanceTo(point);
      if (distance > MAX_GAP) { state.anchors[side] = point.clone(); state.runs[side] = null; continue; }
      if (distance < SPACING) continue;
      const width = Math.max(.11, car.tuning.wheelRadius * .72);
      const layer = kind === 'snow' ? this.snow : this.skid;
      const run = state.runs[side];
      state.runs[side] = layer.add(anchor, point, width, run && run.kind === kind ? run : null);
      anchor.copy(point);
    }
  }

  /** Restarting a race keeps the world, so the previous race's marks are wiped here. */
  clear(): void {
    this.snow.pool.clear(); this.skid.pool.clear();
    this.states = new WeakMap();
  }

  stats(): { snow: number; skid: number; capacity: number; bytes: number; chunks: number } {
    return { snow: this.snow.pool.count, skid: this.skid.pool.count,
      capacity: this.snow.pool.limit + this.skid.pool.limit,
      bytes: this.snow.pool.bytes + this.skid.pool.bytes, chunks: this.snow.pool.chunkCount + this.skid.pool.chunkCount };
  }

  dispose(): void {
    this.root.removeFromParent();
    this.snow.pool.dispose(); this.skid.pool.dispose();
  }
}
