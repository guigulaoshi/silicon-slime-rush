import { BodySlimeCoat } from './BodySlimeCoat';
import * as THREE from 'three';
import { modelBytes, discardModelBytes } from './modelBytes';
import { disposeModel } from '../world/disposeModel';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { VehicleOcclusion } from './VehicleOcclusion';
import { modelPath, wheelCentres, type TaxiLivery, type VehicleBody } from './catalogue';
import { isVehicleGlazing, vehicleModelErrors } from './modelContract';

const GLASS_PATCHES_X = 5, GLASS_PATCHES_Y = 4;

/** One loaded body owns its resources; separate cars never share disposable meshes or materials. */
/**
 * A roof sign that reads as one: a translucent shell narrower at the top than at the base, a word on
 * both sloping faces, a dark base plate on two pads. The first version was one lit box, and a player
 * saw "just a rectangle". "TAXI" is the generic word, not an operator's name or mark.
 */
function taxiSign(width: number, colour: string): THREE.Group {
  const group = new THREE.Group();
  const H = .15, BOTTOM = .24, TOP = .13, ROUND = .03, LIFT = .045;
  const profile = new THREE.Shape();
  profile.moveTo(-BOTTOM / 2, 0); profile.lineTo(BOTTOM / 2, 0);
  profile.lineTo(TOP / 2, H - ROUND); profile.quadraticCurveTo(TOP / 2, H, TOP / 2 - ROUND, H);
  profile.lineTo(-TOP / 2 + ROUND, H); profile.quadraticCurveTo(-TOP / 2, H, -TOP / 2, H - ROUND);
  profile.closePath();
  const shellGeometry = new THREE.ExtrudeGeometry(profile, { depth: width, bevelEnabled: true, bevelSize: .012,
    bevelThickness: .012, bevelSegments: 2, curveSegments: 4 });
  shellGeometry.rotateY(Math.PI / 2); shellGeometry.translate(-width / 2, LIFT, 0);
  const shell = new THREE.Mesh(shellGeometry, new THREE.MeshStandardMaterial({ color: colour, emissive: colour,
    emissiveIntensity: .45, roughness: .35 }));
  shell.name = 'taxi-sign-shell';
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = colour; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#1d1d1f'; g.font = '900 46px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('TAXI', 128, 35);
  }
  const face = new THREE.CanvasTexture(canvas); face.colorSpace = THREE.SRGBColorSpace; face.anisotropy = 4;
  const decal = new THREE.MeshStandardMaterial({ map: face, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: .4, roughness: .35 });
  const slope = Math.atan2((BOTTOM - TOP) / 2, H);
  for (const side of [1, -1]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width * .82, H * .7), decal);
    plane.name = 'taxi-sign-word';
    plane.rotation.set(-side * slope, side > 0 ? 0 : Math.PI, 0);
    plane.position.set(0, LIFT + H * .45, side * ((BOTTOM + TOP) / 4 + .014));
    group.add(plane);
  }
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: .6, metalness: .2 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, .018, BOTTOM + .03), dark);
  plate.position.y = LIFT - .009;
  group.add(shell, plate);
  for (const x of [-width * .32, width * .32]) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(.045, .05, LIFT - .018, 10), dark);
    pad.position.set(x, (LIFT - .018) / 2, 0);
    group.add(pad);
  }
  return group;
}

export class VehicleModel {
  readonly wheels: THREE.Object3D[];
  readonly brakeLights = new THREE.Group();
  readonly windshield = new THREE.Box3();
  private readonly glazing = new Set<THREE.Object3D>();
  private readonly glassSamples: { point: THREE.Vector3; area: number }[] = [];
  private glassArea = 0;
  private readonly centres: number[][];
  private readonly root: THREE.Object3D;
  private readonly axleGroups: { node: THREE.Object3D; pivotY: number;
    wheels: readonly [number, number] }[];
  private readonly occlusion: VehicleOcclusion;
  private spin = 0;
  private revision = -1;
  private disposed = false;
  private readonly fadeMaterials = new Map<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();
  readonly bodyCoat: BodySlimeCoat;
  private readonly brakeLensMaterial = new THREE.MeshBasicMaterial({ color: 0xff1608,
    transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  // A soft round glow rather than a flat disc, so the braking halo reads as light in the air.
  private readonly brakeHaloMaterial = new THREE.MeshBasicMaterial({ color: 0xff2a12, map: brakeGlowTexture(),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    toneMapped: false, side: THREE.DoubleSide });
  private readonly brakeLenses: THREE.Mesh[] = [];
  private readonly brakeHalos: THREE.Mesh[] = [];

  constructor(readonly group: THREE.Group, readonly body: VehicleBody) {
    const errors = vehicleModelErrors(group, body);
    if (errors.length) {
      disposeModel(group);
      throw new Error(`${body.id}: ${errors.join('; ')}`);
    }
    this.root = group.getObjectByName('vehicle-root')!;
    this.occlusion = new VehicleOcclusion(group);
    this.brakeLights.name = 'brake-lights';
    const brakeGeometry = new THREE.CircleGeometry(.5, 20), glowGeometry = new THREE.PlaneGeometry(1, 1);
    for (const [index, spec] of body.lights.brakeLights.entries()) {
      const lens = new THREE.Mesh(brakeGeometry, this.brakeLensMaterial);
      lens.name = `brake-lens-${index}`;
      lens.position.set(...spec.position);
      lens.scale.set(spec.size[0], spec.size[1], 1);
      lens.renderOrder = 8;
      const halo = new THREE.Mesh(glowGeometry, this.brakeHaloMaterial);
      halo.name = `brake-halo-${index}`;
      halo.position.set(spec.position[0], spec.position[1], spec.position[2] + .008);
      halo.renderOrder = 7;
      this.brakeLenses.push(lens); this.brakeHalos.push(halo);
      this.brakeLights.add(lens, halo);
    }
    this.setBrakeLights(false, false);
    // Catalogue lamp coordinates live in vehicle-root space. The root is also the body that the visual
    // bump stop lifts and tilts under deep suspension compression; mounting these overlays on the outer
    // scene left them behind, intermittently competing with the Jeep's real tail-lamp faces.
    this.root.add(this.brakeLights);
    this.centres = wheelCentres(body);
    this.wheels = this.centres.map((_, i) => group.getObjectByName(`wheel-${i}`)!);
    this.bodyCoat = new BodySlimeCoat(group, this.wheels);
    this.axleGroups = ([['axle-front', [0, 1]], ['axle-rear', [2, 3]]] as const)
      .flatMap(([name, wheels]) => {
        const node = group.getObjectByName(name);
        if (!node || body.axles.length !== 2) return [];
        const pivotY = (this.centres[wheels[0]]![1]! + this.centres[wheels[1]]![1]!) / 2;
        return [{ node, pivotY, wheels }];
      });
    group.name = `car-${body.id}`;
    group.traverse(node => {
      if (node instanceof THREE.Mesh && node.parent !== this.brakeLights) {
        node.castShadow = true; node.receiveShadow = true;
      }
      // Export batches body parts by material, so pane object names no longer exist in the GLB.
      if (node instanceof THREE.Mesh && !Array.isArray(node.material)
        && isVehicleGlazing(node.material)) {
        // Blended glass must not cast the old opaque window-shaped cabin shadow.
        node.castShadow = false;
        this.glazing.add(node); node.updateWorldMatrix(true, false);
        const positions = node.geometry.getAttribute('position');
        const index = node.geometry.index;
        for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
          const points = [0, 1, 2].map(j => node.localToWorld(new THREE.Vector3().fromBufferAttribute(
            positions, index ? index.getX(i + j) : i + j)));
          const triangle = new THREE.Triangle(...points as [THREE.Vector3, THREE.Vector3, THREE.Vector3]);
          const sample = triangle.getMidpoint(new THREE.Vector3());
          const normalZ = triangle.getNormal(new THREE.Vector3()).z;
          const area = triangle.getArea();
          // Closed panes have narrow forward-facing return edges. They are not a
          // windshield: including them can move the target into a long bus cabin.
          const longestEdge = Math.max(points[0]!.distanceTo(points[1]!),
            points[1]!.distanceTo(points[2]!), points[2]!.distanceTo(points[0]!));
          const altitude = longestEdge > 0 ? 2 * area / longestEdge : 0;
          if (sample.z >= 0 || normalZ >= -.2
            || altitude < .002) continue;
          points.forEach(point => this.windshield.expandByPoint(point));
          this.glassSamples.push({ point: sample, area });
          this.glassArea += area;
        }
      }
    });
    this.poolGlassSamples();
  }

  /**
   * One ray per patch of windshield, not per triangle. A bevelled GLB pane is hundreds of triangles
   * and every slime hit cast three rays through each against the whole body: about 20 ms a hit on a
   * desktop, the stutter a player feels driving through slimes. Each patch of a 5 x 4 grid across the
   * windshield keeps its largest triangle's centre (a point on the glass, so the ray still ends on
   * glazing) and carries the whole patch's area.
   */
  private poolGlassSamples(): void {
    if (this.glassSamples.length <= GLASS_PATCHES_X * GLASS_PATCHES_Y) return;
    const size = this.windshield.getSize(new THREE.Vector3());
    const patches = new Map<number, { point: THREE.Vector3; area: number; largest: number }>();
    for (const { point, area } of this.glassSamples) {
      const u = Math.min(GLASS_PATCHES_X - 1, Math.floor((point.x - this.windshield.min.x) / (size.x || 1) * GLASS_PATCHES_X));
      const v = Math.min(GLASS_PATCHES_Y - 1, Math.floor((point.y - this.windshield.min.y) / (size.y || 1) * GLASS_PATCHES_Y));
      const key = v * GLASS_PATCHES_X + u, patch = patches.get(key);
      if (!patch) patches.set(key, { point, area, largest: area });
      else {
        patch.area += area;
        if (area > patch.largest) { patch.point = point; patch.largest = area; }
      }
    }
    this.glassSamples.length = 0;
    for (const { point, area } of patches.values()) this.glassSamples.push({ point, area });
  }

  /** Local splash cloud to the actual GLB glazing; bonnet/roof/body can block its rays. */
  splashCoverage(origin: THREE.Vector3, reach: number): number {
    if (this.windshield.isEmpty()) return 0;
    this.group.updateWorldMatrix(true, true);
    this.occlusion.update();
    const target = this.windshield.getCenter(new THREE.Vector3());
    const distance = target.distanceTo(origin);
    const attenuation = Math.exp(-distance * distance / (reach * reach));
    let visible = 0;
    for (const { point: sample, area } of this.glassSamples) for (const lift of [0, .35, .7]) {
      const source = origin.clone().add(new THREE.Vector3(0, reach * lift, 0));
      const worldSource = this.group.localToWorld(source);
      const worldTarget = this.group.localToWorld(sample.clone());
      const direction = worldTarget.sub(worldSource);
      const first = this.occlusion.first(new THREE.Ray(worldSource, direction.clone().normalize()), direction.length() + .01);
      if (first && this.glazing.has(first.object) && first.distance >= direction.length() - .01) visible += area;
    }
    // A bevel adds many tiny mirror triangles; coverage measures wet glass area, not face count.
    return this.glassArea > 0 ? attenuation * visible / (3 * this.glassArea) : 0;
  }

  splashBody(origin: THREE.Vector3, speed: number, color = new THREE.Color(0x8aff46), reach?: number): void {
    this.bodyCoat.hit(origin, speed, color, reach);
  }

  /** A bomb burned the paint near `origin`: matte soot, not a splash pattern. */
  scorchBody(origin: THREE.Vector3, reach: number): void {
    this.bodyCoat.hit(origin, 0, new THREE.Color(0x0b0a09), reach, true);
  }

  /** `onProgress` gets the downloaded fraction, or null while the file's size is unknown. */
  static async load(body: VehicleBody, signal?: AbortSignal,
    onStage?: (stage: 'download' | 'decode') => void,
    onProgress?: (fraction: number | null) => void): Promise<VehicleModel> {
    const url = modelPath(body);
    try {
      onStage?.('download');
      const bytes = await modelBytes(url, signal, onProgress
        && (({ loaded, total }) => onProgress(total ? loaded / total : null)));
      onStage?.('decode');
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, '');
      if (signal?.aborted) {
        disposeModel(gltf.scene);
        throw new DOMException('Vehicle load cancelled', 'AbortError');
      }
      return new VehicleModel(gltf.scene, body);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) discardModelBytes(url);
      throw error;
    }
  }

  /**
   * Wear a city's taxi livery: the body paint takes the city's colour and a roof sign is added, lit
   * at night like the lamps. Paint is found by the material names every garage body uses for it.
   */
  applyLivery(livery: TaxiLivery | undefined): void {
    if (!livery) return;
    const paint = new THREE.Color(livery.paint);
    const repaint = (m: THREE.Material): THREE.Material => {
      if (!/body paint|housing paint/i.test(m.name)) return m;
      const repainted = (m as THREE.MeshStandardMaterial).clone();
      repainted.color.copy(paint);
      return repainted;
    };
    this.group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      node.material = Array.isArray(node.material) ? node.material.map(repaint) : repaint(node.material);
    });
    const bounds = new THREE.Box3().setFromObject(this.root);
    const size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
    const sign = taxiSign(size.x * .42, livery.sign);
    sign.name = 'taxi-sign';
    sign.position.copy(this.root.worldToLocal(new THREE.Vector3(centre.x, bounds.max.y, centre.z - size.z * .06)));
    this.root.add(sign);
  }

  /** Finished AI leaves the grid; restore original glass and body materials on restart. */
  setOpacity(fraction: number): void {
    if (!this.fadeMaterials.size) this.group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!this.fadeMaterials.has(material)) this.fadeMaterials.set(material, {
          opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite,
        });
      }
    });
    this.group.visible = fraction > 0;
    for (const [material, original] of this.fadeMaterials) {
      const transparent = fraction < 1 || original.transparent;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.opacity = original.opacity * fraction;
      material.depthWrite = fraction < 1 ? false : original.depthWrite;
    }
  }

  /**
   * Tail lamps always glow a little; braking makes the lens brighter and larger and adds a soft
   * halo around it, which goes away again when the brake is released.
   */
  setBrakeLights(braking: boolean, night: boolean): void {
    this.brakeLights.visible = true;
    this.brakeLensMaterial.opacity = braking ? 1 : night ? .42 : .3;
    this.brakeHaloMaterial.opacity = braking ? night ? .95 : .8 : 0;
    const lensGrow = braking ? 1.25 : 1, haloGrow = night ? 3.6 : 3;
    // Grow by a border sized from the lamp's short side, so a round lamp scales as before (x1.25 lens,
    // x3/x3.6 halo) while a long thin light bar does not reach past the body or flood the tail (379).
    this.body.lights.brakeLights.forEach(({ size: [width, height] }, index) => {
      const minor = Math.min(width, height);
      const lens = minor * (lensGrow - 1), halo = Math.max(minor, .05) * (haloGrow - 1);
      this.brakeLenses[index]!.scale.set(width + lens, height + lens, 1);
      this.brakeHalos[index]!.scale.set(width + halo, height + halo, 1);
      this.brakeHalos[index]!.visible = braking;
    });
  }

  update(speed: number, wheelYaw: number, compression: readonly number[], dt: number, revision: number): void {
    if (revision !== this.revision) {
      this.spin = 0; this.revision = revision;
      this.bodyCoat.clear();
    }
    this.bodyCoat.update(dt, speed);
    this.spin = (this.spin - speed * dt / this.body.wheelRadius) % (Math.PI * 2);
    // A landing compresses the springs far past what any wheel arch can hold, and a wheel
    // drawn that high comes up through the wing. So a drawn wheel rises at most wheelLift -- as far
    // as that body's arches were measured to take it -- and whatever the springs compress beyond
    // that lifts the drawn body instead, so the tyres still meet the road. The physics keeps its
    // full travel; only the picture has a bump stop.
    const taken = this.bumpStop(compression);
    const lift = (i: number) => Math.min(Math.max(compression[i] ?? 0, 0) - taken[i]!, this.body.wheelLift);
    this.wheels.forEach((wheel, i) => {
      wheel.position.y = this.centres[i]![1]! + lift(i);
      wheel.rotation.order = 'YXZ';
      wheel.rotation.set(this.spin, this.body.axles.length === 2 && i < 2 ? wheelYaw : 0, 0);
    });
    for (const axle of this.axleGroups) {
      const left = lift(axle.wheels[0]);
      const right = lift(axle.wheels[1]);
      const mean = (left + right) / 2;
      const angle = Math.atan((right - left) / this.body.track);
      const cosine = Math.cos(angle);
      // Rotate around the axle centre and lengthen its local X just enough that
      // both rigid ends keep meeting wheel centres at unequal compression.
      axle.node.rotation.z = angle;
      axle.node.scale.x = 1 / cosine;
      axle.node.position.x = Math.sin(angle) * axle.pivotY;
      axle.node.position.y = axle.pivotY * (1 - cosine) + mean;
    }
  }

  /** Tilt and raise the drawn body just enough that every wheel's compression beyond wheelLift is
   *  taken up; returns, per wheel, how much of its compression the body took. */
  private bumpStop(compression: readonly number[]): number[] {
    const n = this.centres.length;
    let em = 0, xm = 0, zm = 0;
    const excess = this.centres.map((centre, i) => {
      const e = Math.max((compression[i] ?? 0) - this.body.wheelLift, 0);
      em += e / n; xm += centre[0]! / n; zm += centre[2]! / n;
      return e;
    });
    let exx = 0, xx = 0, ezz = 0, zz = 0;
    this.centres.forEach((centre, i) => {
      const dx = centre[0]! - xm, dz = centre[2]! - zm;
      exx += (excess[i]! - em) * dx; xx += dx * dx;
      ezz += (excess[i]! - em) * dz; zz += dz * dz;
    });
    const a = xx > 1e-9 ? exx / xx : 0, b = zz > 1e-9 ? ezz / zz : 0;
    const plane = this.centres.map(centre => em + a * (centre[0]! - xm) + b * (centre[2]! - zm));
    // Four corners need not lie on one plane: raise it until no wheel is left short, and let the
    // wheels it overshoots hang a little lower instead.
    const short = Math.max(0, ...excess.map((e, i) => e - plane[i]!));
    this.root.position.y = em + short - a * xm - b * zm;
    this.root.rotation.set(-Math.atan(b), 0, Math.atan(a), 'XZY');
    return plane.map(p => p + short);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bodyCoat.dispose();
    this.group.removeFromParent();
    disposeModel(this.group);
  }
}

/** A radial falloff: full at the centre, gone at the edge, eased so the glow has no visible rim. */
function brakeGlowTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4), half = (size - 1) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.min(1, Math.hypot(x - half, y - half) / half), fall = (1 - r) ** 2, at = (y * size + x) * 4;
    data[at] = data[at + 1] = data[at + 2] = 255; data[at + 3] = Math.round(255 * fall);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
