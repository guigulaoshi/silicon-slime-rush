import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { minimumVehicleMass } from '../vehicles/catalogue';
import { roundSlimeScale } from './slimeShape';

export interface SlimeBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export type SlimeMotion = 'debris' | 'elastic' | 'settling';

const PRIOR_MAX_ELASTIC_VOLUME = roundSlimeScale(.875).reduce((volume, axis) => volume * axis, 1);

/** Keep volume scaling, but halve the purple body mass, including every volume-scaled split child. */
export function elasticSlimeMass(scale: readonly number[]): number {
  const volume = scale.reduce((product, axis) => product * axis, 1);
  return minimumVehicleMass() * (.35 / 6) * volume / PRIOR_MAX_ELASTIC_VOLUME;
}

/** Cohesive bodies and large liquid fragments use the same loaded road/wall collision world. */
export function createSlimeBody(physics: PhysicsWorld, position: THREE.Vector3,
  scale: readonly number[], motion: SlimeMotion, yaw = 0): SlimeBody {
  const elastic = motion === 'elastic';
  const settling = motion === 'settling';
  const hull = slimeHull(physics, scale);
  if (elastic) hull.setMass(elasticSlimeMass(scale));
  else hull.setDensity(settling ? 5 : 12);
  const body = physics.createRigidBody(physics.api.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
    .setCcdEnabled(true).setLinearDamping(elastic ? .25 : settling ? .32 : .18)
    .setAngularDamping(elastic ? .5 : settling ? 1.1 : 1.4));
  const collider = physics.createCollider(hull
    .setRestitution(elastic ? .58 : settling ? .52 : .12)
    .setFriction(elastic ? 0 : settling ? .78 : .65)
    .setRestitutionCombineRule(elastic || settling
      ? physics.api.CoefficientCombineRule.Max : physics.api.CoefficientCombineRule.Average)
    .setFrictionCombineRule(elastic
      ? physics.api.CoefficientCombineRule.Min : physics.api.CoefficientCombineRule.Average), body);
  physics.registerCollider(collider, elastic ? 'slime-bounce'
    : settling ? 'slime-falling' : 'slime-debris');
  return { body, collider };
}

/** The same ellipsoid hull supplies dormant sensors and airborne collision bodies. */
export function slimeHull(physics: PhysicsWorld, scale: readonly number[]): RAPIER.ColliderDesc {
  const geometry = new THREE.SphereGeometry(1, 12, 8);
  const vertices = geometry.getAttribute('position');
  const points = new Float32Array(vertices.count * 3);
  for (let i = 0; i < vertices.count; i++) {
    points[i * 3] = vertices.getX(i) * scale[0]!;
    points[i * 3 + 1] = vertices.getY(i) * scale[1]!;
    points[i * 3 + 2] = vertices.getZ(i) * scale[2]!;
  }
  geometry.dispose();
  return physics.api.ColliderDesc.convexHull(points)!;
}

export function removeSlimeBody(physics: PhysicsWorld, item: SlimeBody): void {
  physics.unregisterCollider(item.collider);
  physics.world.removeRigidBody(item.body);
}

export function slimeContact(physics: PhysicsWorld, item: SlimeBody):
  { point: THREE.Vector3; normal: THREE.Vector3; role: ReturnType<PhysicsWorld['collisionRole']> } | null {
  let result: { point: THREE.Vector3; normal: THREE.Vector3;
    role: ReturnType<PhysicsWorld['collisionRole']> } | null = null;
  physics.world.contactPairsWith(item.collider, (other) => {
    if (result || other.isSensor() || other.parent()?.isDynamic()) return;
    physics.world.contactPair(item.collider, other, (manifold, flipped) => {
      if (result) return;
      // Trimesh edge correction may retain geometric contacts but expose no solver-contact array.
      // Use the actual touching point on the world collider, transformed from its local frame.
      for (let i = 0; i < manifold.numContacts(); i++) {
        if (manifold.contactDist(i) > .025) continue;
        const local = flipped ? manifold.localContactPoint1(i) : manifold.localContactPoint2(i);
        if (!local) continue;
        const origin = other.translation();
        const point = new THREE.Vector3(local.x, local.y, local.z)
          .applyQuaternion(new THREE.Quaternion().copy(other.rotation()))
          .add(new THREE.Vector3(origin.x, origin.y, origin.z));
        const centre = item.body.translation();
        const normal = manifold.normal();
        const n = new THREE.Vector3(normal.x, normal.y, normal.z);
        if (n.dot(new THREE.Vector3(centre.x, centre.y, centre.z).sub(point)) < 0) n.negate();
        point.copy(physics.toWorld(point));
        result = { point, normal: n, role: physics.collisionRole(other) };
        break;
      }
    });
  });
  return result;
}
