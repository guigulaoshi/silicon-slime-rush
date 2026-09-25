import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VEHICLES } from '../src/vehicles/catalogue';
import { Headlights } from '../src/world/Headlights';
import { tireMarkKind } from '../src/world/TireMarks';
import type { WheelState } from '../src/physics/Car';

function wheel(skid = 0): WheelState {
  return { grounded: true, compression: 0, load: 1000, slip: 0, skid,
    contact: new THREE.Vector3() };
}

describe('vehicle lights and tyre marks', () => {
  it('gives every authored headlight its own night lens and ground footprint without airborne beams', () => {
    for (const body of VEHICLES) {
      const night = new Headlights('night');
      night.fit(body, false);
      expect(night.configuredCount, body.id).toBe(body.lights.headlights.length);
      expect(night.poolCount, body.id).toBe(1);
      expect(night.group.children.filter(child => child.name.startsWith('headlight-cone-')),
        body.id).toHaveLength(0);
      night.dispose();

      const day = new Headlights('day');
      day.fit(body, true);
      expect(day.configuredCount, body.id).toBe(body.lights.headlights.length);
      expect(day.group.children).toHaveLength(0);
      day.dispose();
    }
  });

  it('keeps no airborne beam geometry in fog either (302)', () => {
    for (const body of VEHICLES) {
      const fog = new Headlights('night', 'fog');
      fog.fit(body, true);
      expect(fog.group.children.some(child => child.name.startsWith('fog-beam-')), body.id).toBe(false);
      fog.dispose();
    }
  });

  it('keeps every car distinct and roof bars stronger and longer than ordinary headlights', () => {
    const profiles = VEHICLES.map(body => body.headlightProfile!);
    expect(new Set(profiles.map(profile => JSON.stringify(profile))).size).toBe(VEHICLES.length);
    const jeep = VEHICLES.find(body => body.id === 'jeep')!;
    const monster = VEHICLES.find(body => body.id === 'monster-truck')!;
    for (const body of VEHICLES.filter(body => body !== jeep && body !== monster)) {
      expect(jeep.headlightProfile!.reach).toBeGreaterThan(body.headlightProfile!.reach);
      expect(jeep.headlightProfile!.power).toBeGreaterThan(body.headlightProfile!.power);
    }
    expect(monster.headlightProfile!.reach).toBeGreaterThan(jeep.headlightProfile!.reach);
    expect(monster.headlightProfile!.power).toBeGreaterThan(jeep.headlightProfile!.power);
    for (const body of VEHICLES) {
      const rig = new Headlights('night'); rig.fit(body, true);
      const spots = rig.group.children.filter((child): child is THREE.SpotLight => child instanceof THREE.SpotLight);
      expect(spots.length).toBeLessThanOrEqual(4);
      expect(spots.reduce((sum, light) => sum + light.intensity, 0)).toBe(body.headlightProfile!.power);
      expect(spots.every(light => light.distance >= 100)).toBe(true);
      expect(rig.group.children.filter(child => child instanceof THREE.Mesh)).toHaveLength(body.lights.headlights.length);
      expect(rig.poolCount).toBe(spots.length);
      for (const spot of spots) expect(spot.target.position.y).toBeCloseTo(body.anchorY - body.suspensionRest + .018);
      if (body === jeep || body === monster) {
        const roofY = Math.max(...body.lights.headlights.map(light => light.position[1]));
        expect(spots.filter(light => light.position.y === roofY)).toHaveLength(2);
        expect(body.lights.headlights.filter(light => light.position[1] === roofY)).toHaveLength(body === jeep ? 5 : 8);
      }
      rig.dispose(); expect(rig.group.children).toHaveLength(0);
    }
  });

  it('leaves snow tracks while rolling but dry marks only from real tyre skid', () => {
    const rolling = [wheel(), wheel()];
    expect(tireMarkKind('snow', 8, rolling)).toBe('snow');
    expect(tireMarkKind('clear', 8, rolling)).toBeNull();
    expect(tireMarkKind('rain', 8, [wheel(.35), wheel()])).toBe('skid');
    expect(tireMarkKind('snow', .4, [wheel(1), wheel(1)])).toBeNull();
  });
});
