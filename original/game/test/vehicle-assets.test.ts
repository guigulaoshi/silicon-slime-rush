import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import data from '../src/vehicles/catalogue.json' with { type: 'json' };
import { catalogueErrors, defaultVehicle, modelPath, resolveVehicle, VEHICLES,
  vehicleGeometry, wheelAnchors, wheelCentres, type VehicleBody } from '../src/vehicles/catalogue';
import { isVehicleGlazing, vehicleModelErrors } from '../src/vehicles/modelContract';
import { VehicleOcclusion } from '../src/vehicles/VehicleOcclusion';
import { VehicleModel } from '../src/vehicles/VehicleModel';
import { TUNINGS, tuningFor } from '../src/physics/CarTuning';
import type { CarKind } from '../src/track/types';
import { checkMaximum } from '../test-support/resource-limit';

function fixture(body: VehicleBody): THREE.Group {
  const scene = new THREE.Group();
  const root = new THREE.Group(); root.name = 'vehicle-root'; scene.add(root);
  const shellHeight = body.size[1]! - body.wheelRadius;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(body.size[0], shellHeight, body.size[2]));
  shell.position.y = body.anchorY - body.suspensionRest + body.wheelRadius + shellHeight / 2;
  shell.name = 'body'; root.add(shell);
  for (const light of body.lights.headlights.filter(light => light.mount === 'roof')) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(light.size[0] / 2, 8, 6));
    lens.position.set(...light.position); root.add(lens);
  }
  wheelCentres(body).forEach((centre, i) => {
    const geometry = new THREE.CylinderGeometry(body.wheelRadius, body.wheelRadius, body.wheelWidth, 24);
    geometry.rotateZ(Math.PI / 2);
    const wheel = new THREE.Mesh(geometry); wheel.name = `wheel-${i}`;
    wheel.position.set(...centre); root.add(wheel);
  });
  if (body.hitch) {
    const hitch = new THREE.Object3D(); hitch.name = 'hitch';
    hitch.position.set(...body.hitch as [number, number, number]); root.add(hitch);
  }
  return scene;
}

/** Sample cabin window panes, not the deliberately embedded backs/bevels of solid mirror inserts. */
function expectVisibleGlazing(scene: THREE.Object3D, body: VehicleBody): void {
  scene.updateMatrixWorld(true);
  const glass: THREE.Mesh[] = [];
  scene.traverse(node => {
    if (node instanceof THREE.Mesh && !Array.isArray(node.material)
      && isVehicleGlazing(node.material)) glass.push(node);
  });
  expect(glass.length, `${body.id}: no glazing examined`).toBeGreaterThan(0);
  const surfaces = new THREE.Group();
  scene.getObjectByName('body')!.traverse(node => {
    if (!(node instanceof THREE.Mesh) || Array.isArray(node.material)
      || !(node.material.name.startsWith('Factory body paint') || isVehicleGlazing(node.material))) return;
    const copy = node.clone(false);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(node.matrixWorld);
    surfaces.add(copy);
  });
  surfaces.updateMatrixWorld(true);
  const visibility = new VehicleOcclusion(surfaces);
  visibility.update();
  const cabin = new THREE.Box3();
  glass.forEach(mesh => cabin.union(new THREE.Box3().setFromObject(mesh)));
  const cabinCentre = cabin.getCenter(new THREE.Vector3());
  let samples = 0;
  for (const mesh of glass) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const vertices = [0, 1, 2].map(j => new THREE.Vector3()
        .fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld));
      const triangle = new THREE.Triangle(...vertices as [THREE.Vector3, THREE.Vector3, THREE.Vector3]);
      // The mirror insert is a small bevelled solid, whose buried faces should not be visible.
      // Require window-scale triangles and at least four complete panes below.
      // Curved cabin glazing follows the roof and sides as small curved patches.
      const curved = (body.id === 'micro-hatch' || body.id === 'sports-car'
        || body.id === 'lightweight-sports' || body.id === 'city-pod');
      if (triangle.getArea() < body.size[0]! * body.size[1]! * (curved ? 0.00003 : 0.005)) continue;
      const normal = triangle.getNormal(new THREE.Vector3());
      const longestEdge = Math.max(vertices[0]!.distanceTo(vertices[1]!),
        vertices[1]!.distanceTo(vertices[2]!), vertices[2]!.distanceTo(vertices[0]!));
      // The 1.2 mm manufactured rim is embedded in the seal, not a viewing surface.
      const viewingSurface = 2 * triangle.getArea() / longestEdge > .003;
      const shading = geometry.getAttribute('normal');
      for (let corner = 0; corner < 3; corner++) {
        const vertex = index ? index.getX(i + corner) : i + corner;
        expect(new THREE.Vector3().fromBufferAttribute(shading, vertex).transformDirection(mesh.matrixWorld)
          .dot(normal), `${body.id}: glazing shading differs from its surface`)
          .toBeGreaterThan(curved ? Math.cos(40 * Math.PI / 180) : 0.999);

        // Thin solid panes now have an inner face too. Its normal points across the cabin,
        // so extending that normal by a car length probes through the opposite body panel.
        // Keep normal checks on both faces; outside-visibility applies to the outward face.
        if (!viewingSurface || normal.dot(triangle.getMidpoint(new THREE.Vector3()).sub(cabinCentre)) <= 0) continue;
        const point = new THREE.Vector3();
        vertices.forEach((v, j) => point.addScaledVector(v, j === corner ? 0.8 : 0.1));
        const ray = new THREE.Ray(point.clone().addScaledVector(normal, body.size[2]!),
          normal.clone().negate());
        // Index only paint and glass; pillars, seals and spares can legitimately cover a pane.
        // VehicleOcclusion is checked against Three's raycaster later in this same test.
        const hit = visibility.first(ray, body.size[2]! * 2);
        const hitMaterial = (hit?.object as THREE.Mesh | undefined)?.material;
        expect.soft(!!hitMaterial && !Array.isArray(hitMaterial) && isVehicleGlazing(hitMaterial),
          `${body.id}: glass obscured near ${point.toArray().join(',')}; normal ${normal.toArray()}; hit ${hit?.point.toArray()}`)
          .toBe(true);
        samples++;
      }
    }
  }
  expect(samples, `${body.id}: fewer than four window panes examined`).toBeGreaterThanOrEqual(24);
}

/** Check the delivered silhouette after Blender has consolidated its named source parts. */
function expectSchoolBusSilhouette(scene: THREE.Object3D, body: VehicleBody): void {
  if (body.id !== 'school-bus') return;
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse(node => { if (node instanceof THREE.Mesh) meshes.push(node); });
  const materialMeshes = (name: string): THREE.Mesh[] => {
    const matches = meshes.filter(mesh => !Array.isArray(mesh.material) && mesh.material.name === name);
    expect(matches.length, `school-bus: actual exported ${name} geometry`).toBeGreaterThan(0);
    return matches;
  };
  const boundsOf = (parts: THREE.Mesh[]) => {
    const bounds = new THREE.Box3();
    parts.forEach(part => bounds.union(new THREE.Box3().setFromObject(part)));
    return bounds;
  };
  // Locate the broad forward-facing windshield triangles, excluding small mirror inserts.
  const windshield: THREE.Vector3[] = [];
  for (const mesh of meshes.filter(mesh => !Array.isArray(mesh.material) && isVehicleGlazing(mesh.material))) {
    const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const points = [0, 1, 2].map(j => mesh.localToWorld(new THREE.Vector3()
        .fromBufferAttribute(position, index ? index.getX(i + j) : i + j)));
      const triangle = new THREE.Triangle(...points as [THREE.Vector3, THREE.Vector3, THREE.Vector3]);
      if (triangle.getArea() > .03 && triangle.getNormal(new THREE.Vector3()).z < -.8
        && points.every(point => point.z < -body.size[2]! * .2)) windshield.push(...points);
    }
  }
  expect(windshield.length, 'broad forward windshield was examined').toBeGreaterThanOrEqual(6);
  const nose = new THREE.Box3().setFromObject(scene).min.z;
  expect(Math.min(...windshield.map(point => point.z)) - nose,
    'visible bonnet occupies under 19% of the vehicle length').toBeLessThan(body.size[2]! * .19);
  const red = materialMeshes('STOP sign enamel red');
  const sign = boundsOf(red), white = boundsOf(materialMeshes('STOP sign reflective white'));
  expect(sign.max.x, 'paddle sits outside the driver-side body').toBeLessThan(-body.size[0]! * .48);
  expect(sign.max.z, 'paddle is at the front of the passenger cabin').toBeLessThan(-body.size[2]! * .1);
  expect(sign.min.y).toBeGreaterThan(wheelCentres(body)[0]![1]);
  expect(sign.max.y - sign.min.y, 'visible traffic sign, not a tiny badge').toBeGreaterThan(body.size[1]! * .12);
  expect(white.max.y - white.min.y).toBeGreaterThan(sign.max.y - sign.min.y);
  expect(white.min.x, 'STOP lettering projects in front of the red face').toBeLessThan(sign.min.x);
  const centre = sign.getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster(new THREE.Vector3(-body.size[0]! * 2, centre.y, centre.z), new THREE.Vector3(1, 0, 0));
  expect(ray.intersectObjects(red).length, 'red face points outwards toward the driver-side camera').toBeGreaterThan(0);
}

/** Read the exported PBR values so the player-visible glass fix cannot regress in Blender unnoticed. */
function expectGlassMaterials(scene: THREE.Object3D, body: VehicleBody): void {
  const materials = new Set<THREE.MeshStandardMaterial>();
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh) || Array.isArray(node.material)
      || !isVehicleGlazing(node.material)) return;
    materials.add(node.material as THREE.MeshStandardMaterial);
  });
  expect(materials.size, `${body.id}: glass materials examined`).toBeGreaterThan(0);
  for (const material of materials) {
    expect(material.transparent, `${body.id}: windows transmit the cabin`).toBe(true);
    expect(material.opacity, `${body.id}: windows are not opaque panels`).toBeLessThan(.65);
    expect(material.opacity, `${body.id}: windows retain visible glass`).toBeGreaterThan(.15);
    expect(material.metalness, `${body.id}: glass is not metallic plastic`).toBeLessThanOrEqual(.01);
    expect(material.roughness, `${body.id}: glass highlight remains sharp`).toBeCloseTo(.075, 3);
    expect((material as THREE.MeshPhysicalMaterial).clearcoat,
      `${body.id}: glass carries a reflective clear coat`).toBeCloseTo(.35, 3);
    expect((material as THREE.MeshPhysicalMaterial).clearcoatRoughness,
      `${body.id}: glass clear coat remains crisp`).toBeCloseTo(.055, 3);
  }
  if (body.id === 'city-pod') {
    expect([...materials].every(material => material.transparent)).toBe(true);
    const opacities = [...materials].map(material => material.opacity).sort();
    expect(opacities).toHaveLength(2);
    expect(opacities[0]).toBeCloseTo(.24, 3);
    expect(opacities[1]).toBeCloseTo(.34, 3);
  }
}

/** Inspect exported normals on the actual painted shell and rubber, not Blender flags. */
function expectCurvedNormals(scene: THREE.Object3D, id: string): void {
  const counts = { paint: 0, rubber: 0 };
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh) || Array.isArray(node.material)) return;
    const kind = node.material.name.startsWith('Factory body paint') ? 'paint'
      : node.material.name === 'Tyre rubber' ? 'rubber' : null;
    if (!kind) return;
    const position = node.geometry.getAttribute('position');
    const normal = node.geometry.getAttribute('normal');
    const index = node.geometry.index;
    expect(normal, `${id}: exported normals missing`).toBeDefined();
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const indices = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
      const vertices = indices.map(n => new THREE.Vector3().fromBufferAttribute(position, n));
      const triangle = new THREE.Triangle(...vertices as [THREE.Vector3, THREE.Vector3, THREE.Vector3]);
      if (triangle.getArea() < 1e-9) continue;
      const face = triangle.getNormal(new THREE.Vector3());
      for (const n of indices) {
        const shading = new THREE.Vector3().fromBufferAttribute(normal, n);
        expect(shading.length(), `${id}: invalid surface normal`).toBeCloseTo(1, 3);
        if (face.dot(shading) < 0.9995) counts[kind]++;
      }
    }
  });
  expect(counts.paint, `${id}: painted curves still have only flat face normals`).toBeGreaterThan(30);
  expect(counts.rubber, `${id}: tyres still have only flat face normals`).toBeGreaterThan(100);
}

describe('single vehicle catalogue', () => {
  it('defines nine selectable cars and ten separately exported bodies', () => {
    expect(catalogueErrors(data)).toEqual([]);
    expect(VEHICLES.map(v => v.id)).toEqual([
      'micro-hatch', 'sports-car', 'lightweight-sports', 'jeep', 'pickup-travel-trailer', 'monster-truck', 'school-bus', 'retro-van', 'city-pod',
    ]);
    expect(VEHICLES.flatMap(v => [v, ...(v.trailer ? [v.trailer] : [])])).toHaveLength(10);
  });
  it('requires an explicit valid drive layout for every selectable car', () => {
    const copy = structuredClone(data);
    copy.vehicles[0]!.handling.drive = 'hover';
    expect(catalogueErrors(copy)).toContain('micro-hatch: invalid drive');
  });
  it('maps every retained track default and falls back from invalid saved choices', () => {
    for (const car of Object.keys(TUNINGS) as CarKind[]) {
      expect(VEHICLES).toContain(defaultVehicle({ car }));
      expect(resolveVehicle('retired-id', { car })).toBe(defaultVehicle({ car }));
      expect(resolveVehicle('jeep', { car }).id).toBe('jeep');
      expect(tuningFor(car)).toEqual(TUNINGS[car]);
    }
  });
  it('rejects duplicate identifiers, missing defaults and tuning references', () => {
    const copy = structuredClone(data);
    copy.vehicles[1]!.id = copy.vehicles[0]!.id;
    copy.legacyDefaults.sedan = 'missing'; copy.fallback = 'missing';
    copy.vehicles[0]!.tuning = 'missing';
    expect(catalogueErrors(copy)).toEqual(expect.arrayContaining([
      'duplicate vehicle: micro-hatch', 'duplicate asset: micro-hatch',
      'invalid default: sedan', 'invalid fallback vehicle', 'micro-hatch: unknown tuning',
    ]));
  });
  it('rejects malformed geometry and missing trailer anchors', () => {
    const copy = structuredClone(data);
    copy.vehicles[0]!.wheelRadius = 0; copy.vehicles[0]!.axles = [1, 2];
    delete copy.vehicles.find(vehicle => vehicle.id === 'pickup-travel-trailer')!.hitch;
    expect(catalogueErrors(copy)).toEqual(expect.arrayContaining([
      'micro-hatch: invalid wheelRadius', 'micro-hatch: invalid axles',
      'pickup-travel-trailer: both hitch anchors required',
    ]));
  });
  it('shares axle ordering and suspension offsets without exposing mutable geometry', () => {
    for (const body of VEHICLES) {
      const geometry = vehicleGeometry(body);
      expect(geometry.wheels).toEqual(wheelAnchors(body));
      expect(geometry.wheels).toHaveLength(4);
      expect(geometry.wheels[0]![2]).toBeLessThan(0);
      // Car.step computes compression = rest - rayHitDistance. The tyre bottom must meet that hit.
      const hitDistance = body.suspensionRest * 0.7;
      const compression = body.suspensionRest - hitDistance;
      expect(wheelCentres(body)[0]![1] + compression - body.wheelRadius)
        .toBeCloseTo(body.anchorY - hitDistance);
      geometry.chassisHalf[0] = 99;
      expect(body.chassisHalf[0]).not.toBe(99);
      expect(modelPath(body)).toBe(`./models/cars/${body.id}.glb`);
    }
  });
});

describe('loaded model contract', () => {
  const bodies = VEHICLES.flatMap(v => [v, ...(v.trailer ? [v.trailer] : [])]);
  it('accepts compatible wheel and hitch hierarchies for all production bodies', () => {
    for (const body of bodies) expect(vehicleModelErrors(fixture(body), body)).toEqual([]);
  });
  it('rejects roof lamps outside the actual model or facing the rear', () => {
    const body = structuredClone(VEHICLES.find(vehicle => vehicle.id === 'jeep')!);
    const scene = fixture(body);
    body.lights.headlights.find(light => light.mount === 'roof')!.position[1] += 2;
    expect(vehicleModelErrors(scene, body)).toContain('headlight: catalogue position misses authored body end');
    const other = structuredClone(VEHICLES.find(vehicle => vehicle.id === 'monster-truck')!);
    other.lights.headlights.find(light => light.mount === 'roof')!.position[2] = 1;
    expect(vehicleModelErrors(fixture(other), other)).toContain('headlight: catalogue position misses authored body end');
  });
  it('rejects missing, displaced or wrongly oriented moving wheels', () => {
    const body = VEHICLES[0]!; const scene = fixture(body);
    scene.getObjectByName('wheel-0')!.removeFromParent();
    scene.getObjectByName('wheel-1')!.position.x += 1;
    scene.getObjectByName('wheel-2')!.rotation.z = Math.PI / 2;
    const errors = vehicleModelErrors(scene, body);
    expect(errors).toContain('wheel-0: missing or duplicated');
    expect(errors).toContain('wheel-1: centre differs from catalogue');
    expect(errors.some(e => e.includes('local X spin axis'))).toBe(true);
  });
  it('rejects wrong scale, a missing shell, and disconnected hitch anchors', () => {
    const body = VEHICLES.find(vehicle => vehicle.id === 'pickup-travel-trailer')!;
    const scene = fixture(body);
    scene.getObjectByName('vehicle-root')!.scale.setScalar(2);
    scene.getObjectByName('body')!.removeFromParent();
    scene.getObjectByName('hitch')!.position.z += 1;
    expect(vehicleModelErrors(scene, body)).toEqual(expect.arrayContaining([
      'vehicle-root must have identity world transform', 'body: visible shell required',
      'hitch: missing or misaligned', 'model bounds differ from catalogue',
    ]));
  });
  it('samples broad windshield panes without including thin side-window return edges', () => {
    const body = VEHICLES.find(vehicle => vehicle.id === 'school-bus')!;
    const scene = fixture(body);
    const glass = new THREE.MeshPhysicalMaterial({ name: 'Blue grey smoked glazing', transparent: true, opacity: .28 });
    const front = new THREE.Mesh(new THREE.BoxGeometry(body.size[0]! * .8, .45, .00144), glass);
    front.position.set(0, .4, -body.size[2]! * .335);
    const side = new THREE.Mesh(new THREE.BoxGeometry(.00144, .45, 2), glass);
    side.position.set(body.size[0]! * .475, .4, -1.05);
    scene.getObjectByName('vehicle-root')!.add(front, side);
    const model = new VehicleModel(scene, body);
    expect(model.windshield.isEmpty()).toBe(false);
    expect(model.windshield.min.z).toBeCloseTo(front.position.z - .00072, 4);
    expect(model.windshield.max.z).toBeCloseTo(front.position.z - .00072, 4);
    model.dispose();
  });
  // The player looks down on the car from a close chase camera, and a wheel arch with no
  // roof over it shows the bare tyre from up there. Straight-down rays over each tyre's own
  // footprint: whatever they hit first is what the player sees.
  async function overheadTyreExposure(body: VehicleBody) {
    const path = resolve('public', modelPath(body));
    const bytes = readFileSync(path);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
    gltf.scene.updateMatrixWorld(true);
    const wheels: THREE.Mesh[] = [], shell: THREE.Mesh[] = [];
    gltf.scene.traverse(node => {
      if (!(node as THREE.Mesh).isMesh) return;
      let onWheel = false;
      for (let p: THREE.Object3D | null = node; p; p = p.parent) if (/^wheel-\d/.test(p.name)) onWheel = true;
      // Glazing is see-through, so it hides nothing: a tyre under glass still reads as a tyre.
      if (onWheel) wheels.push(node as THREE.Mesh);
      else if (![(node as THREE.Mesh).material].flat().every(isVehicleGlazing)) shell.push(node as THREE.Mesh);
    });
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const top = body.size[1]! + 5;
    let exposed = 0, samples = 0;
    for (const centre of wheelCentres(body)) {
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 11; j++) {
          const x = centre[0]! + body.wheelWidth * ((i + .5) / 7 - .5);
          const z = centre[2]! + 2 * body.wheelRadius * ((j + .5) / 11 - .5);
          raycaster.set(new THREE.Vector3(x, top, z), down);
          const first = raycaster.intersectObjects([...wheels, ...shell], true)[0];
          samples++;
          if (first && wheels.includes(first.object as THREE.Mesh)) exposed++;
        }
      }
    }
    return exposed / samples;
  }

  // Ten GLBs decoded and 77 downward rays per wheel: real work, and the 5s default turns a busy
  // machine into a false red.
  it('keeps every tyre roofed by its own wheel arch when seen from straight overhead', async () => {
    const seen: Record<string, number> = {};
    for (const body of bodies) {
      if (!existsSync(resolve('public', modelPath(body)))) continue;
      seen[body.id] = Number((await overheadTyreExposure(body)).toFixed(3));
    }
    // The monster truck is an open-wheel truck: its tyres stand outside the body on purpose.
    expect(seen['monster-truck'], 'monster truck keeps its open wheels').toBeGreaterThan(.2);
    for (const [id, exposure] of Object.entries(seen)) {
      if (id === 'monster-truck') continue;
      expect(exposure, `${id}: tyre visible from straight above (${(exposure * 100).toFixed(1)}% of its footprint)`)
        .toBeLessThanOrEqual(.02);
    }
  }, 60_000);

  // The suspension raises each drawn wheel into its arch, up to that body's wheelLift, and
  // past the height its arch was built for the tread comes out through the wing. Look at every tyre
  // from above, from the chase camera and from the side-above, once with the wheels extended and
  // once raised to wheelLift: a tyre that gets more visible on the way up is coming through the body.
  // (A tyre moving up inside an open arch only hides more of itself.)
  async function tyreSeen(body: VehicleBody, lifts: readonly number[]) {
    const path = resolve('public', modelPath(body));
    const bytes = readFileSync(path);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const scene = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '')).scene;
    const wheels: THREE.Mesh[] = [], shell: THREE.Mesh[] = [];
    scene.traverse(node => {
      if (!(node as THREE.Mesh).isMesh) return;
      let onWheel = false;
      for (let p: THREE.Object3D | null = node; p; p = p.parent) if (/^wheel-\d/.test(p.name)) onWheel = true;
      if (onWheel) wheels.push(node as THREE.Mesh);
      else if (![(node as THREE.Mesh).material].flat().every(isVehicleGlazing)) shell.push(node as THREE.Mesh);
    });
    const views = {
      above: new THREE.Vector3(0, -1, 0),
      chase: new THREE.Vector3(0, -Math.sin(.45), -Math.cos(.45)),
      side: new THREE.Vector3(Math.cos(.5), -Math.sin(.5), 0),
    };
    const centres = wheelCentres(body);
    const raycaster = new THREE.Raycaster();
    return lifts.map(lift => {
      centres.forEach((centre, i) => { scene.getObjectByName(`wheel-${i}`)!.position.y = centre[1]! + lift; });
      scene.updateMatrixWorld(true);
      return Object.fromEntries(Object.entries(views).map(([view, direction]) => {
        const across = new THREE.Vector3().crossVectors(direction,
          new THREE.Vector3(...(view === 'above' ? [1, 0, 0] : [0, 1, 0]) as [number, number, number])).normalize();
        const up = new THREE.Vector3().crossVectors(direction, across);
        const reach = body.wheelRadius * 1.3, grid = 11;
        let seen = 0, samples = 0;
        for (const centre of centres) for (let i = 0; i < grid; i++) for (let j = 0; j < grid; j++) {
          raycaster.set(new THREE.Vector3(centre[0]!, centre[1]! + lift, centre[2]!)
            .addScaledVector(across, reach * ((i + .5) / grid * 2 - 1))
            .addScaledVector(up, reach * ((j + .5) / grid * 2 - 1))
            .addScaledVector(direction, -10), direction);
          const first = raycaster.intersectObjects([...wheels, ...shell], true)[0];
          samples++;
          if (first && wheels.includes(first.object as THREE.Mesh)) seen++;
        }
        return [view, seen / samples];
      }));
    });
  }

  it('keeps each tyre inside its arch while the suspension lifts it to wheelLift', async () => {
    const grew: string[] = [];
    // The monster truck's tyres stand outside its body on purpose, so there is nothing to come through.
    for (const body of bodies.filter(body => body.id !== 'monster-truck')) {
      if (!existsSync(resolve('public', modelPath(body)))) continue;
      const [extended, lifted] = await tyreSeen(body, [0, body.wheelLift]);
      for (const view of Object.keys(extended!)) {
        const more = lifted![view]! - extended![view]!;
        if (more > .01) grew.push(`${body.id} ${view} +${(more * 100).toFixed(1)}%`);
      }
    }
    expect(grew, 'tyre comes out through the body before reaching wheelLift').toEqual([]);
  }, 120_000);

  it('draws no wheel above wheelLift and lifts the body by the rest, so the tyres stay on the road', () => {
    for (const body of bodies) {
      const model = new VehicleModel(fixture(body), body);
      const centres = wheelCentres(body);
      const root = model.group.getObjectByName('vehicle-root')!;
      const bottoms = (compression: number[]) => {
        model.update(0, 0, compression, 1 / 60, 0);
        model.group.updateMatrixWorld(true);
        return model.wheels.map((wheel, i) => {
          expect(wheel.position.y, `${body.id} wheel ${i}`).toBeLessThanOrEqual(centres[i]![1]! + body.wheelLift + 1e-9);
          // Where the tyre touches the road, relative to where the springs say the road is.
          return wheel.getWorldPosition(new THREE.Vector3()).y - body.wheelRadius
            - (centres[i]![1]! - body.wheelRadius + compression[i]!);
        });
      };
      // A hard, lopsided landing: one corner nearly bottomed out, the rest part of the way.
      const landing = centres.map((_, i) => body.suspensionRest * (i === 0 ? .95 : .6));
      for (const gap of bottoms(landing)) expect(Math.abs(gap), body.id).toBeLessThan(.005);
      expect(root.position.y, `${body.id}: body raised on landing`).toBeGreaterThan(0);
      // Within the arch nothing moves but the wheels.
      for (const gap of bottoms(centres.map(() => body.wheelLift / 2))) expect(Math.abs(gap)).toBeLessThan(1e-6);
      expect(root.position.y).toBe(0);
      model.dispose();
    }
  });

  it('checks every present GLB and fails if an explicitly requested asset is absent', async () => {
    const requested = (process.env.VEHICLE_ASSET_IDS ?? bodies.map(body => body.id).join(',')).split(',').filter(Boolean);
    for (const id of requested) expect(bodies.some(b => b.id === id), `unknown requested asset ${id}`).toBe(true);
    for (const body of bodies) {
      const path = resolve('public', modelPath(body));
      if (!existsSync(path) && !requested.includes(body.id)) continue;
      expect(existsSync(path), `missing requested model: ${path}`).toBe(true);
      const bytes = readFileSync(path);
      // Construct in this test's browser realm: Node Buffer's backing ArrayBuffer fails
      // GLTFLoader's instanceof check under jsdom, despite containing a valid GLB.
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
      expect(vehicleModelErrors(gltf.scene, body), body.id).toEqual([]);
      expect(gltf.animations, `${body.id}: moving parts are driven by physics`).toHaveLength(0);
      expectVisibleGlazing(gltf.scene, body);
      expectGlassMaterials(gltf.scene, body);
      expectSchoolBusSilhouette(gltf.scene, body);
      expectCurvedNormals(gltf.scene, body.id);
      // Compare the index with Three on all production exports and moving wheel transforms.
      const occlusion = new VehicleOcclusion(gltf.scene);
      const centre = new THREE.Box3().setFromObject(gltf.scene).getCenter(new THREE.Vector3());
      for (const transformed of [false, true]) {
        if (transformed) {
          gltf.scene.position.set(11, 2, -8); gltf.scene.rotation.set(.08, .7, -.03);
          gltf.scene.getObjectByName('wheel-0')!.rotation.set(.4, .2, 0);
        }
        gltf.scene.updateMatrixWorld(true); occlusion.update();
        for (let i = 0; i < 33; i++) {
          const direction = new THREE.Vector3(Math.cos(i * 2.4), (i % 5 - 2) * .3, Math.sin(i * 2.4)).normalize();
          const origin = gltf.scene.localToWorld(centre.clone().addScaledVector(direction, i === 32 ? 0 : body.size[2]! * 1.5));
          const target = gltf.scene.localToWorld(centre.clone());
          const ray = new THREE.Raycaster(origin, i === 32 ? direction : target.sub(origin).normalize());
          const expected = ray.intersectObject(gltf.scene, true)[0];
          const actual = occlusion.first(ray.ray, Infinity);
          expect(!!actual, `${body.id}: indexed hit ${i}, transformed ${transformed}`).toBe(!!expected);
          if (expected) {
            expect(actual!.distance).toBeCloseTo(expected.distance, 5);
            expect(actual!.point.distanceTo(expected.point)).toBeLessThan(1e-5);
            const normal = expected.face!.normal.clone().applyNormalMatrix(
              new THREE.Matrix3().getNormalMatrix(expected.object.matrixWorld));
            expect(actual!.normal.dot(normal)).toBeGreaterThan(.99999);
            expect(actual!.object.material).toBe((expected.object as THREE.Mesh).material);
            expect(occlusion.first(ray.ray, expected.distance * .5)).toBeNull();
          }
        }
      }
      gltf.scene.position.set(0, 0, 0); gltf.scene.rotation.set(0, 0, 0);
      gltf.scene.getObjectByName('wheel-0')!.rotation.set(0, 0, 0); gltf.scene.updateMatrixWorld(true);

      for (let i = 0; i < wheelCentres(body).length; i++) {
        const wheel = gltf.scene.getObjectByName(`wheel-${i}`)!;
        let exposedFaces = 0, fastenerCapFaces = 0;
        wheel.traverse(node => {
          if (!(node instanceof THREE.Mesh)) return;
          const position = node.geometry.getAttribute('position');
          const index = node.geometry.index;
          for (let n = 0; n < (index?.count ?? position.count); n += 3) {
            const points = [0, 1, 2].map(j => wheel.worldToLocal(node.localToWorld(new THREE.Vector3()
              .fromBufferAttribute(position, index ? index.getX(n + j) : n + j))));
            const triangle = new THREE.Triangle(...points as [THREE.Vector3, THREE.Vector3, THREE.Vector3]);
            const normal = triangle.getNormal(new THREE.Vector3());
            const centre = triangle.getMidpoint(new THREE.Vector3());
            const radial = Math.hypot(centre.y, centre.z);
            if (Math.abs(normal.x) > .999 && centre.x * normal.x > 0
              && radial > body.wheelRadius * .14 && radial < body.wheelRadius * .28
              && triangle.getArea() < body.wheelRadius ** 2 * .01) fastenerCapFaces++;
            // The exposed axial face of a rim/spoke points out, unlike recessed back faces.
            if (Math.abs(centre.x) < body.wheelWidth * 0.48 || Math.abs(normal.x) < 0.999) continue;
            expect(centre.x * normal.x, `${body.id}: wheel-${i} exposed rim/spoke faces inward`)
              .toBeGreaterThan(0);
            exposedFaces++;
          }
        });
        expect(exposedFaces, `${body.id}: wheel-${i} rim faces not examined`).toBeGreaterThan(0);
        if (['micro-hatch', 'sports-car', 'lightweight-sports', 'jeep'].includes(body.id)) {
          expect(fastenerCapFaces, `${body.id}: wheel-${i} recessed fastener caps`).toBeGreaterThanOrEqual(20);
        }
      }
      if (body.id === 'sports-car') {
        // Wheel-well cutters must not punch through the centre of the low bonnet.
        for (const x of [0, -body.track / 2, body.track / 2]) {
          const ray = new THREE.Raycaster(new THREE.Vector3(x, body.size[1]!, body.axles[0]!),
            new THREE.Vector3(0, -1, 0));
          const hits = ray.intersectObject(gltf.scene.getObjectByName('body')!, true);
          expect(hits.length, `sports-car: missing bonnet/fender at x=${x}`).toBeGreaterThan(0);
          expect(hits[0]!.point.y, `sports-car: bonnet/fender cut through at x=${x}`)
            .toBeGreaterThan(body.anchorY - body.suspensionRest + body.wheelRadius * (x === 0 ? 1 : 2));
        }
      }
      if (body.id === 'monster-truck') {
        /* */
        const centres = wheelCentres(body).map(point => new THREE.Vector3(...point));
        const structural = new Set(['Clean powder coated silver frame', 'Anodized orange shock body']);
        let examined = 0, insideTyre = 0;
        gltf.scene.traverse(node => {
          if (!(node instanceof THREE.Mesh) || ![node.material].flat().some(material => structural.has(material.name))) return;
          const position = node.geometry.getAttribute('position');
          for (let vertex = 0; vertex < position.count; vertex++) {
            const point = new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(node.matrixWorld);
            examined++;
            if (centres.some(centre => {
              const radial = Math.hypot(point.y - centre.y, point.z - centre.z);
              return Math.abs(point.x - centre.x) < body.wheelWidth / 2
                && radial > body.wheelRadius * .49 && radial < body.wheelRadius;
            })) insideTyre++;
          }
        });
        expect(examined, 'monster-truck: actual frame and shock vertices examined').toBeGreaterThan(500);
        expect(insideTyre, 'monster-truck: frame or shocks occupy the tyre rubber').toBe(0);

        const model = new VehicleModel(gltf.scene, body);
        model.update(0, 0, [.20, .40, .10, .30], 1 / 60, 0);
        for (const [name, wheels] of [['axle-front', [0, 1]], ['axle-rear', [2, 3]]] as const) {
          const axle = gltf.scene.getObjectByName(name)!;
          for (const wheel of wheels) {
            const sign = wheel % 2 ? 1 : -1;
            const end = new THREE.Vector3(sign * body.track / 2,
              wheelCentres(body)[wheel]![1]!, body.axles[Math.floor(wheel / 2)]!);
            axle.localToWorld(end);
            const centre = gltf.scene.getObjectByName(`wheel-${wheel}`)!.getWorldPosition(new THREE.Vector3());
            expect(end.distanceTo(centre), `${name} end ${wheel} meets the compressed hub`).toBeLessThan(1e-6);
          }
        }
        model.dispose();
      }
    }
  }, 60000);
  it('reports the combined exported body and garage-card size', () => {
    const bytes = bodies.map(body => readFileSync(resolve('public', modelPath(body))).byteLength);
    expect(bytes).toHaveLength(10);
    const menuBytes = VEHICLES.map(vehicle => readFileSync(resolve('public/garage', `${vehicle.id}.webp`)).byteLength);
    expect(menuBytes).toHaveLength(9);
    checkMaximum([...bytes, ...menuBytes].reduce((sum, size) => sum + size, 0),
      'garage_assets_bytes', 'all exported bodies and garage cards');
  });
});

// A successful model export must not leave yesterday's photograph in the menu.
it('every catalogue thumbnail was rendered from its current production bodies', () => {
  const records = JSON.parse(readFileSync('../docs/car-reference/rendered-models.json', 'utf8')) as
    Record<string, { models: Record<string, string>; imageSha256: string; thumbnailSha256: string }>;
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  expect(Object.keys(records).sort()).toEqual(VEHICLES.map(vehicle => vehicle.id).sort());
  for (const vehicle of VEHICLES) {
    const entry = records[vehicle.id]!;
    const bodies = [vehicle, ...(vehicle.trailer ? [vehicle.trailer] : [])];
    expect(entry.models, `${vehicle.id}: rerender the reference after changing the GLB`).toEqual(
      Object.fromEntries(bodies.map(body => [body.id + '.glb', sha('public/' + modelPath(body))])));
    expect(entry.imageSha256).toBe(sha(`../docs/car-reference/${vehicle.id}.png`));
    expect(entry.thumbnailSha256, `${vehicle.id}: rerun tools/garage_images.py`).toBe(
      sha(`public/garage/${vehicle.id}.webp`));
  }
});
