import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { taxiLivery, vehicleFor } from '../src/vehicles/catalogue';
import { VehicleModel } from '../src/vehicles/VehicleModel';

describe('city taxis', () => {
  it('dresses the sedan, and only the sedan, as the city taxi where the city has one', () => {
    expect(taxiLivery('micro-hatch', 'new-york')?.paint).toBe('#f7b500');
    expect(taxiLivery('micro-hatch', 'amboseli')).toBeUndefined();      // no cabs on a safari track
    expect(taxiLivery('sports-car', 'new-york')).toBeUndefined();
    expect(taxiLivery('micro-hatch', undefined)).toBeUndefined();
  });

  it('repaints the body paint and adds a lit roof sign above the roof', async () => {
    const body = vehicleFor('micro-hatch')!;
    const root = new THREE.Group(); root.name = 'vehicle-root';
    const paint = new THREE.MeshStandardMaterial({ name: 'Factory body paint', color: 0x030405 });
    const trim = new THREE.MeshStandardMaterial({ name: 'Black moulded trim', color: 0x070809 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 3.2), [paint, trim]);
    shell.position.y = .55; root.add(shell);
    const model = Object.create(VehicleModel.prototype) as VehicleModel;
    Object.assign(model, { group: root, root });
    model.applyLivery(taxiLivery('micro-hatch', 'new-york'));
    const [repainted, kept] = shell.material as THREE.MeshStandardMaterial[];
    expect(`#${repainted!.color.getHexString()}`).toBe(new THREE.Color('#f7b500').getHexString().replace(/^/, '#'));
    expect(repainted).not.toBe(paint);                                   // a clone: the shared GLB material is untouched
    expect(kept).toBe(trim);
    const sign = root.getObjectByName('taxi-sign')!;
    expect(sign).toBeTruthy();
    expect(sign.position.y).toBeGreaterThan(1.1);                        // on the roof, not inside the car
    const lit = sign.getObjectByName("taxi-sign-shell") as THREE.Mesh;
    expect((lit.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(0);
    // a real sign, not one lit box: a shell narrower at the top, and the word on both sloping faces
    const words = sign.children.filter(child => child.name === 'taxi-sign-word');
    expect(words).toHaveLength(2);
    expect(Math.sign(words[0]!.position.z)).not.toBe(Math.sign(words[1]!.position.z));
    expect(body.id).toBe('micro-hatch');
  });
});
