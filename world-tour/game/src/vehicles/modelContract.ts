import * as THREE from 'three';
import { wheelCentres, type VehicleBody } from './catalogue';

/** The two authored window materials include both clear doors and the dark canopy. */
export function isVehicleGlazing(material: THREE.Material): boolean {
  return material.name === 'Blue grey smoked glazing'
    || material.name === 'Blue grey smoked glazing canopy';
}

/** Validate the actual loaded hierarchy, not exporter metadata claiming that it is correct. */
export function vehicleModelErrors(scene: THREE.Object3D, body: VehicleBody): string[] {
  const errors: string[] = [];
  scene.updateMatrixWorld(true);
  const nodes = new Map<string, THREE.Object3D[]>();
  scene.traverse(node => nodes.set(node.name, [...(nodes.get(node.name) ?? []), node]));
  const root = nodes.get('vehicle-root');
  if (root?.length !== 1) return ['exactly one vehicle-root required'];
  const origin = root[0]!;
  const identity = new THREE.Matrix4();
  if (origin.matrixWorld.elements.some((n, i) => Math.abs(n - identity.elements[i]!) > 0.001)) {
    errors.push('vehicle-root must have identity world transform');
  }
  const expected = wheelCentres(body);
  for (let i = 0; i < expected.length; i++) {
    const list = nodes.get(`wheel-${i}`);
    if (list?.length !== 1) { errors.push(`wheel-${i}: missing or duplicated`); continue; }
    const wheel = list[0]!;
    if (wheel.parent !== origin) errors.push(`wheel-${i}: must be a direct child of vehicle-root`);
    if (wheel.position.distanceTo(new THREE.Vector3(...expected[i]!)) > 0.005) {
      errors.push(`wheel-${i}: centre differs from catalogue`);
    }
    if (wheel.quaternion.angleTo(new THREE.Quaternion()) > 0.001 ||
        wheel.scale.distanceTo(new THREE.Vector3(1, 1, 1)) > 0.001) {
      errors.push(`wheel-${i}: bake rotation and scale into geometry, preserving local X spin axis`);
    }
    const box = new THREE.Box3().setFromObject(wheel);
    const size = box.getSize(new THREE.Vector3());
    if (box.isEmpty() || Math.abs(size.x - body.wheelWidth) > 0.025 ||
        Math.abs(size.y - 2 * body.wheelRadius) > 0.025 ||
        Math.abs(size.z - 2 * body.wheelRadius) > 0.025) {
      errors.push(`wheel-${i}: geometry must match tyre width/radius along X/Y/Z`);
    }
  }
  for (const name of nodes.keys()) {
    if (/^wheel-\d+$/.test(name) && Number(name.slice(6)) >= expected.length) {
      errors.push(`${name}: unexpected moving wheel`);
    }
  }
  if (body.hitch) {
    const hitch = nodes.get('hitch');
    if (hitch?.length !== 1 || hitch[0]!.parent !== origin ||
        hitch[0]!.position.distanceTo(new THREE.Vector3(...body.hitch)) > 0.005) {
      errors.push('hitch: missing or misaligned');
    }
  }
  const shell = nodes.get('body');
  if (shell?.length !== 1 || shell[0]!.parent !== origin ||
      new THREE.Box3().setFromObject(shell[0]!).isEmpty()) errors.push('body: visible shell required');
  const bounds = new THREE.Box3().setFromObject(origin);
  const size = bounds.getSize(new THREE.Vector3());
  // Hitch tongues and mirrors may extend beyond the main body length/width.
  if (bounds.isEmpty() || [size.x, size.y, size.z].some((n, i) =>
    n < body.size[i]! * 0.8 || n > body.size[i]! * 1.3)) errors.push('model bounds differ from catalogue');
  const ground = body.anchorY - body.suspensionRest;
  for (const [kind, lights] of [['headlight', body.lights.headlights],
    ['brake light', body.lights.brakeLights]] as const) for (const light of lights) {
    const [x, y, z] = light.position;
    const roof = kind === 'headlight' && light.mount === 'roof';
    const expectedEnd = roof ? z < 0 && z >= bounds.min.z
      : kind === 'headlight' ? z < -body.size[2]! * .35 : z > body.size[2]! * .35;
    if (Math.abs(x) > body.size[0]! * .65 || y < (roof ? ground + body.size[1]! * .75 : ground - .1)
      || y > (roof ? bounds.max.y + .01 : ground + body.size[1]! + .1)
      || !expectedEnd) errors.push(`${kind}: catalogue position misses authored body end`);
  }
  return errors;
}
