import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Car } from './Car';
import type { PhysicsWorld } from './PhysicsWorld';
import { trailerRestOffset, vehicleTuning, type VehicleDefinition } from '../vehicles/catalogue';

/** A passive axle and an unconstrained ball hitch, never a replay of the towing car's path. */
export class Trailer {
  readonly car: Car;
  private joint: RAPIER.ImpulseJoint;
  private revision: number;
  private disposed = false;
  private readonly towingAnchor: THREE.Vector3;
  private readonly trailerAnchor: THREE.Vector3;
  private readonly towingCcd: boolean;
  private readonly towingPrediction: number;

  constructor(private readonly physics: PhysicsWorld, private readonly towing: Car,
    private readonly vehicle: VehicleDefinition) {
    const body = vehicle.trailer!;
    this.towingCcd = towing.body.isCcdEnabled();
    this.towingPrediction = towing.body.softCcdPrediction();
    this.towingAnchor = new THREE.Vector3(...vehicle.hitch as [number, number, number]);
    this.trailerAnchor = new THREE.Vector3(...body.hitch as [number, number, number]);
    const tuning = vehicleTuning(body);
    this.car = new Car(physics, tuning, { pos: [0, 0, 0], yaw: 0 }, true);
    this.revision = towing.poseRevision;
    this.place();
    towing.body.setAdditionalSolverIterations(12);
    this.car.body.setAdditionalSolverIterations(12);
    // Hard CCD subdivided a trailer landing into tiny time slices: joint corrections reversed
    // the whole rig from -20 to +91 m/s. Predictive contacts keep both bodies on the same step.
    // Two metres cover a boosted road-speed step plus rotation without a scene-wide broad phase.
    for (const car of [towing, this.car]) {
      car.body.enableCcd(false);
      car.body.setSoftCcdPrediction(2);
    }
    physics.setVehicleContacts(towing.collider, true);
    physics.setVehicleContacts(this.car.collider, true);
    physics.suppressCarImpact(towing.collider, this.car.collider, true);
    this.joint = this.connect();
  }

  private connect(): RAPIER.ImpulseJoint {
    const joint = this.physics.world.createImpulseJoint(this.physics.api.JointData.spherical(
      this.towingAnchor, this.trailerAnchor), this.towing.body, this.car.body, true);
    joint.setContactsEnabled(true);
    return joint;
  }

  private place(): void {
    const q = this.towing.quaternion;
    const p = new THREE.Vector3(...trailerRestOffset(this.vehicle)).applyQuaternion(q)
      .add(this.towing.position);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    this.car.reset([p.x, p.y, p.z], Math.atan2(-forward.x, -forward.z));
  }

  /** Reset both sides' relation even when a QA teleport bypasses Game's reset entry points. */
  syncReset(): void {
    if (this.revision === this.towing.poseRevision) return;
    this.physics.world.removeImpulseJoint(this.joint, true);
    this.place();
    this.joint = this.connect();
    this.revision = this.towing.poseRevision;
  }

  update(dt: number): void {
    this.syncReset();
    this.car.update(dt, { throttle: 0, brake: this.towing.braking, steer: 0, parkingBrake: this.towing.parked });
  }

  get hitchGap(): number {
    const a = this.towingAnchor.clone().applyQuaternion(this.towing.quaternion).add(this.towing.position);
    const b = this.trailerAnchor.clone().applyQuaternion(this.car.quaternion).add(this.car.position);
    return a.distanceTo(b);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.physics.world.removeImpulseJoint(this.joint, true);
    this.physics.unregisterCollider(this.car.collider);
    this.physics.takeCarCollisions(this.car.collider);
    this.physics.suppressCarImpact(this.towing.collider, this.car.collider, false);
    this.physics.world.removeRigidBody(this.car.body);
    this.physics.setVehicleContacts(this.towing.collider, false);
    this.towing.body.enableCcd(this.towingCcd);
    this.towing.body.setSoftCcdPrediction(this.towingPrediction);
  }
}
