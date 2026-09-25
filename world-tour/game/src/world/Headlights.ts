import * as THREE from 'three';
import type { TimeOfDay } from '../track/types';
import type { VehicleBody, VehicleLight } from '../vehicles/catalogue';
import type { Weather } from './Sky';

/**
 * Where a lamp's light meets the road, as a fraction of its reach. One number for the scene
 * light's aim and the rain/snow lighting cone, so the lit road and the lit precipitation always
 * land in the same place.
 */
export const ROAD_AIM = .3;

export interface LampCone { position: THREE.Vector3; direction: THREE.Vector3; cosAngle: number; reach: number }

/** Authored lenses and real road illumination; no airborne beam geometry (302). */
export class Headlights {
  readonly group = new THREE.Group();
  readonly on: boolean;
  private readonly lamps: THREE.SpotLight[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  configuredCount = 0;
  /** Actual scene lights, retained under the historical road-pool diagnostic name. */
  poolCount = 0;

  /** The combined front lamp in the car's own frame, for lighting rain and snow. */
  private front: { source: THREE.Vector3; target: THREE.Vector3; angle: number; reach: number } | null = null;

  constructor(readonly timeOfDay: TimeOfDay, readonly weather: Weather = 'clear') {
    // Drivers switch their lamps on in fog by day as well.
    this.on = timeOfDay === 'night' || weather === 'fog';
    this.group.name = 'vehicle-headlights';
  }

  fit(body: VehicleBody, illuminateRoad = false): void {
    this.clearRig();
    this.configuredCount = body.lights.headlights.length;
    if (!this.on || !this.configuredCount) return;
    const profile = body.headlightProfile!;
    const colour = new THREE.Color(profile.colour);
    const lensGeometry = new THREE.CircleGeometry(.5, 20);
    this.geometries.add(lensGeometry);
    const lensMaterial = new THREE.MeshBasicMaterial({ color: colour, transparent: true,
      opacity: .98, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.materials.add(lensMaterial);
    const ground = body.anchorY - body.suspensionRest + .018;
    // Four representatives preserve both bumper and roof origins without adding a dynamic light
    // for every roof lens. Other racers retain all visible lenses and one combined scene light.
    const specs = body.lights.headlights;
    const roof = specs.map((spec, i) => ({ spec, i })).filter(({ spec }) => spec.mount === 'roof');
    const sceneIndices = [...new Set([0, Math.min(1, specs.length - 1),
      ...(roof.length ? [roof[0]!.i, roof.at(-1)!.i] : specs.map((_, i) => i))])];
    for (const [index, spec] of specs.entries()) {
      const source = new THREE.Vector3(...spec.position);
      const lens = new THREE.Mesh(lensGeometry, lensMaterial);
      lens.name = `headlight-lens-${index}`;
      lens.position.copy(source);
      lens.rotation.y = Math.PI;
      lens.scale.set(spec.size[0], spec.size[1], 1);
      lens.renderOrder = 7;
      this.group.add(lens);
      if (illuminateRoad && sceneIndices.includes(index)) {
        const lamp = new THREE.SpotLight(colour, profile.power / sceneIndices.length,
          profile.reach * 2, Math.atan2(profile.width, profile.reach * ROAD_AIM), .78, 1.1);
        lamp.name = `headlight-light-${index}`;
        lamp.position.copy(source);
        lamp.target.position.set(source.x * .82, ground, source.z - profile.reach * ROAD_AIM);
        lamp.castShadow = false;
        this.group.add(lamp, lamp.target);
        this.lamps.push(lamp); this.poolCount++;
      }
    }
    {
      const sources = roof.length ? roof.map(({ spec }) => spec) : specs;
      const source = centroid(sources);
      this.front = { source, target: new THREE.Vector3(source.x, ground, source.z - profile.reach * ROAD_AIM),
        angle: Math.atan2(profile.width, profile.reach * ROAD_AIM), reach: profile.reach * 2 };
    }
    if (!illuminateRoad) {
      const sources = roof.length ? roof.map(({ spec }) => spec) : specs;
      const source = centroid(sources);
      const lamp = new THREE.SpotLight(colour, profile.power, profile.reach * 2, Math.atan2(profile.width, profile.reach * ROAD_AIM), .78, 1.1);
      lamp.name = 'headlight-light-combined';
      lamp.position.copy(source);
      lamp.target.position.set(source.x, ground, source.z - profile.reach * ROAD_AIM);
      this.group.add(lamp, lamp.target);
      this.lamps.push(lamp); this.poolCount++;
    }
  }

  /** The combined front lamp in world space, or null when the lamps are off. */
  frontCone(out: LampCone): LampCone | null {
    if (!this.on || !this.front) return null;
    this.group.updateMatrixWorld();
    out.position.copy(this.front.source).applyMatrix4(this.group.matrixWorld);
    out.direction.copy(this.front.target).applyMatrix4(this.group.matrixWorld).sub(out.position).normalize();
    // the lit air is wider than the road pool the scene light aims at
    out.cosAngle = Math.cos(Math.min(this.front.angle * 2.2, 1.2));
    out.reach = this.front.reach;
    return out;
  }

  follow(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    if (!this.on) return;
    this.group.position.copy(position);
    this.group.quaternion.copy(quaternion);
  }

  private clearRig(): void {
    this.group.clear();
    for (const lamp of this.lamps) lamp.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.lamps.length = 0;
    this.geometries.clear(); this.materials.clear();
    this.poolCount = 0; this.front = null;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.clearRig();
  }
}

function centroid(lights: readonly VehicleLight[]): THREE.Vector3 {
  const out = new THREE.Vector3();
  for (const light of lights) out.add(new THREE.Vector3(...light.position));
  return lights.length ? out.divideScalar(lights.length) : out;
}
