import { tone } from './theme';
import { isMobileDevice } from '../app/device';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { bakeReflection } from '../world/Reflection';
import { ANTIALIAS, PIXEL_RATIO_CAP, SHADOWS } from '../world/quality';
import type { Quality } from '../world/World';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VehicleModel } from '../vehicles/VehicleModel';
import { taxiLivery, trailerRestOffset, type VehicleDefinition } from '../vehicles/catalogue';
import type { I18n } from './i18n';
import { loadingBar } from './LoadingBar';
import { el } from './Ui';

/**
 * One turntable for every vehicle, sized to hold the largest rig -- the pickup and its trailer -- as it
 * turns. The camera is fitted to this stage and never to the selected vehicle: fitted per vehicle, a
 * city pod filled the same frame as the school bus and read as the bigger car
 *Garage-preview.test.ts fails if a rig outgrows it.
 */
export const GARAGE_STAGE = { radius: 4.25, height: 2.65 } as const;

/** Where the camera starts: a low three-quarter view from the front left. */
const GARAGE_VIEW = new THREE.Vector3(1.5, .58, -2.3).normalize();

/** Rim points of the stage's floor and ceiling; a rotating rig never leaves this cylinder. */
const STAGE_RIM = [0, GARAGE_STAGE.height].flatMap(y => Array.from({ length: 48 }, (_, i) =>
  new THREE.Vector3(Math.cos(i / 24 * Math.PI) * GARAGE_STAGE.radius, y,
    Math.sin(i / 24 * Math.PI) * GARAGE_STAGE.radius)));

/**
 * The aim height and camera distance that keep the whole stage in frame from `direction` (target to
 * camera). A rim point p relative to the aim is inside the frustum once distance >= p.direction plus
 * its screen offset over the half-angle tangent, so the fit is exact rather than a bounding sphere's
 * worst case. That bound is convex in the aim height, so a ternary search finds the closest camera.
 */
function stageFit(direction: THREE.Vector3, fov: number, aspect: number): { aim: number; distance: number } {
  const tanY = Math.tan(THREE.MathUtils.degToRad(fov / 2)), tanX = tanY * aspect;
  const right = new THREE.Vector3().crossVectors(direction, THREE.Object3D.DEFAULT_UP).negate().normalize();
  const up = new THREE.Vector3().crossVectors(right, direction).negate();
  const point = new THREE.Vector3();
  const distance = (aim: number): number => Math.max(...STAGE_RIM.map(rim => {
    point.set(rim.x, rim.y - aim, rim.z);
    return Math.max(Math.abs(point.dot(right)) / tanX, Math.abs(point.dot(up)) / tanY) * 1.06
      + point.dot(direction);
  }));
  let low = 0, high: number = GARAGE_STAGE.height;
  for (let i = 0; i < 32; i++) {
    const a = low + (high - low) / 3, b = high - (high - low) / 3;
    if (distance(a) < distance(b)) high = b; else low = a;
  }
  const aim = (low + high) / 2;
  return { aim, distance: distance(aim) };
}

/**
 * How long a model may take before the card shows a progress bar. Under it -- a cached car, a
 * fast connection -- the bar never appears rather than flickering on every pick.
 */
export const GARAGE_PROGRESS_DELAY_MS = 250;

/** A selected production model, owned only while the garage is visible. */
export class GaragePreview {
  private reflection?: THREE.WebGLRenderTarget;
  private renderer?: THREE.WebGLRenderer;
  private controls?: OrbitControls;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private observer?: ResizeObserver;
  private request?: AbortController;
  private models: VehicleModel[] = [];
  private floor?: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  private beam?: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private turntable?: THREE.Group;
  private animation?: number;
  private previousFrame?: number;
  private selected?: VehicleDefinition;
  private trackId: string | undefined;
  private active = false;
  private state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private readonly message = el('p', 'sm-model-message');
  private readonly retry = el('button', 'sm-model-retry') as HTMLButtonElement;
  /**
   * On a slow connection the card stayed an empty panel while a model downloaded, on entering
   * the garage and on every pick. The bar sits inside the card, not on the full-screen loader, and shows
   * the real fraction of bytes received; when the server does not say how big the file is it slides
   * without claiming a number.
   */
  private readonly progress = el('div', 'sm-model-progress');
  private readonly bar = loadingBar();
  private revealProgress?: ReturnType<typeof setTimeout>;
  /**
   * A restored WebGL context gets textures and buffers back from three.js, whose pixels still
   * live on the CPU, but the baked room reflection is a render target that only ever lived on the GPU.
   * Paint and glass read it, so they went dark until the garage was left. Rebake before the next draw,
   * after three.js has rebuilt its own state.
   */
  private contextRestored = false;
  private readonly onContextRestored = (): void => {
    this.contextRestored = true;
    // A reduced-motion turntable has no frame loop to pick this up, so ask for one frame.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => this.draw());
    else this.draw();
  };
  /**
   * Touch-action alone did not keep a drag on the car from being taken as a page scroll when
   * the game sits in a scrolling page on an iPad (itch.io), where iOS Safari starts its own gestures from
   * touchstart/touchmove. Cancel those for a finger on the model itself -- not on the retry button, whose
   * click a cancelled touchstart would swallow -- as does for the driving controls. Registered on
   * the card with passive:false, so the cancel is honoured.
   */
  private readonly onTouch = (e: TouchEvent): void => {
    if (e.cancelable && this.renderer && e.target === this.renderer.domElement) e.preventDefault();
  };

  constructor(readonly node: HTMLElement, private readonly i18n: I18n,
    private readonly changed: () => void, private readonly quality: () => Quality) {
    node.setAttribute('role', 'group');
    this.message.setAttribute('role', 'status');
    this.retry.addEventListener('click', () => { if (this.active) void this.load(); });
    this.progress.append(this.bar.node);
    node.append(this.progress, this.message, this.retry);
    node.addEventListener('touchstart', this.onTouch, { passive: false });
    node.addEventListener('touchmove', this.onTouch, { passive: false });
  }

  get ready(): boolean { return this.state === 'ready'; }

  /** `trackId` dresses the car as that city's taxi when it is (the same livery the race loads). */
  show(vehicle: VehicleDefinition, active: boolean, trackId?: string): void {
    const changed = this.selected?.id !== vehicle.id || this.trackId !== trackId;
    this.selected = vehicle;
    this.trackId = trackId;
    this.node.setAttribute('aria-label', this.i18n.t('garage.model', {
      car: this.i18n.t('car.' + vehicle.id + '.name'),
    }));
    if (!active) {
      if (this.active) this.release();
      this.active = false;
    } else if (!this.active || changed) {
      this.active = true;
      void this.load();
    }
    this.labels();
  }

  private labels(): void {
    this.node.dataset.state = this.state;
    this.message.textContent = this.i18n.t(this.state === 'failed' ? 'garage.failed'
      : this.state === 'ready' ? 'garage.drag' : 'garage.loading');
    this.retry.hidden = this.state !== 'failed';
    if (this.state !== 'loading') this.hideProgress();
    this.retry.textContent = this.i18n.t('garage.retry');
    this.node.setAttribute('aria-busy', String(this.state === 'loading'));
  }

  private setState(state: typeof this.state): void {
    this.state = state;
    this.labels();
    this.changed();
  }

  private async load(): Promise<void> {
    this.release();
    const vehicle = this.selected!;
    const request = new AbortController();
    this.request = request;
    this.setState('loading');
    const bodies = [vehicle, ...(vehicle.trailer ? [vehicle.trailer] : [])];
    this.bar.reset();
    this.progress.dataset.indeterminate = 'true';
    this.revealProgress = setTimeout(() => {
      if (this.request === request) this.node.dataset.progress = 'shown';
    }, GARAGE_PROGRESS_DELAY_MS);
    const loaded: VehicleModel[] = [];
    try {
      // Keep the same loader, model validation and disposable ownership as the race.
      // A pickup and its trailer are two files fetched one after the other; each fills its share of the bar.
      for (const [index, body] of bodies.entries()) {
        const model = await VehicleModel.load(body, request.signal, undefined, fraction => {
          if (this.request !== request) return;
          if (fraction === null) { this.progress.dataset.indeterminate = 'true'; return; }
          delete this.progress.dataset.indeterminate;
          this.bar.set((index + fraction) / bodies.length);
        });
        model.applyLivery(taxiLivery(body.id, this.trackId));
        loaded.push(model);
      }
      if (request.signal.aborted) { loaded.forEach(model => model.dispose()); return; }
      this.models = loaded;
      const scene = this.scene = new THREE.Scene();
      scene.background = new THREE.Color(tone('night', 'mist', 0.1));
      const turntable = this.turntable = new THREE.Group();
      turntable.name = 'garage-turntable';
      scene.add(turntable);
      for (const model of loaded) turntable.add(model.group);
      if (vehicle.trailer) {
        loaded[1]!.group.position.fromArray(trailerRestOffset(vehicle));
      }
      const bounds = new THREE.Box3();
      loaded.forEach(model => bounds.union(new THREE.Box3().setFromObject(model.group)));
      const centre = bounds.getCenter(new THREE.Vector3());
      // Put the whole rig around one pivot so a pickup and trailer rotate as one parked exhibit,
      // standing on the stage floor: every vehicle then sits in the same place under the same camera.
      loaded.forEach(model => model.group.position.sub(centre.setY(bounds.min.y)));
      const { radius, height } = GARAGE_STAGE;
      // A longer lens from a little lower: the one stage has to hold an 8 m rig pointing at the camera,
      // and less perspective and a flatter view of the floor give every car more of the frame.
      const camera = this.camera = new THREE.PerspectiveCamera(24, 1, .05, radius * 30);
      // The race's quality setting governs this preview too:
      // low draws without antialiasing or shadows at 1x, medium caps density at the race's 1.25x, and
      // high is the garage as it was. Read on every build, and the preview is rebuilt whenever the menu
      // comes back from settings, so a changed setting shows at once.
      const quality = this.quality();
      const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: ANTIALIAS[quality] });
      // Two of these can be open at once beside the menu; a phone at 3x density need not draw them at 2x.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobileDevice() ? 1.25 : 2,
        quality === 'high' ? Infinity : PIXEL_RATIO_CAP[quality]));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.25;
      renderer.shadowMap.enabled = SHADOWS[quality];
      renderer.shadowMap.type = THREE.PCFShadowMap;
      this.bakeRoom(renderer, scene);
      renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      this.node.prepend(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xe6f1ff, 0x526378, 2.1));
      // The stage's light, floor and beam are the same for every vehicle, so the lit pool is a size cue too.
      const lightHeight = height + radius * 2.4;
      /* */
      const pool = radius;
      const light = new THREE.SpotLight(0xffe4b5, radius * radius * 34, radius * 7,
        Math.atan2(pool, lightHeight), .58, 1.15);
      light.name = 'garage-spotlight';
      light.position.set(0, lightHeight, 0);
      light.target.position.set(0, height / 2, 0);
      light.castShadow = SHADOWS[quality];
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.camera.near = .05;
      light.shadow.camera.far = radius * 7;
      scene.add(light, light.target);
      const floor = this.floor = new THREE.Mesh(new THREE.CircleGeometry(pool, 64),
        new THREE.MeshStandardMaterial({ color: 0x253442, roughness: .85 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, -.015, 0);
      floor.receiveShadow = true;
      scene.add(floor);
      const beam = this.beam = new THREE.Mesh(new THREE.ConeGeometry(pool,
        lightHeight, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe8bf,
        transparent: true, opacity: .055, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending }));
      beam.name = 'garage-spotlight-beam';
      beam.position.y = lightHeight / 2;
      beam.renderOrder = 5;
      scene.add(beam);
      const controls = this.controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.enableZoom = false;
      controls.minPolarAngle = .25;
      controls.maxPolarAngle = Math.PI / 2 - .03;
      controls.addEventListener('change', this.orbitChanged);
      camera.position.copy(controls.target).add(GARAGE_VIEW);
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(this.node);
      this.resize();
      this.node.dataset.modelVehicle = vehicle.id;
      this.node.dataset.bodies = loaded.map(model => model.body.id).join(',');
      this.setState('ready');
      this.previousFrame = undefined;
      if (this.motionAllowed() && typeof requestAnimationFrame === 'function') {
        this.animation = requestAnimationFrame(this.animate);
      }
    } catch (error) {
      loaded.forEach(model => model.dispose());
      if (request.signal.aborted) return;
      this.release();
      this.setState('failed');
      console.error('Garage model failed', error);
    }
  }

  private bakeRoom(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const room = new RoomEnvironment();
    try { this.reflection = bakeReflection(renderer, room); }
    finally { room.dispose(); }
    scene.environment = this.reflection.texture;
  }

  private hideProgress(): void {
    if (this.revealProgress !== undefined) clearTimeout(this.revealProgress);
    this.revealProgress = undefined;
    delete this.node.dataset.progress;
  }

  private resize = (): void => {
    const { renderer, camera, controls } = this;
    if (!renderer || !camera || !controls) return;
    // The canvas fills the whole card; the drag hint floats over its foot instead of taking a strip.
    const width = this.node.clientWidth, height = this.node.clientHeight;
    if (width <= 0 || height <= 0) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    this.fit();
    controls.update();
    this.draw();
  };

  private fit(): void {
    const { camera, controls } = this;
    if (!camera || !controls) return;
    const direction = camera.position.clone().sub(controls.target).normalize();
    // Fitted to the stage cylinder, so the rig stays in frame at every turntable angle -- and the
    // camera stands exactly as far from a city pod as from the bus. Dragging down to a side view
    // never comes closer than the opening view, which would push a long rig under the details card;
    // dragging up to look down backs away as far as the whole stage needs.
    const { aim, distance } = stageFit(direction, camera.fov, camera.aspect);
    controls.target.set(0, aim, 0);
    camera.position.copy(controls.target).addScaledVector(direction,
      Math.max(distance, stageFit(GARAGE_VIEW, camera.fov, camera.aspect).distance));
  }

  private orbitChanged = (): void => {
    this.fit();
    this.draw();
  };

  private draw = (): void => {
    if (this.active && this.renderer && this.scene && this.camera) {
      if (this.contextRestored) {
        this.contextRestored = false;
        // Not disposed: its GPU objects died with the lost context.
        this.bakeRoom(this.renderer, this.scene);
      }
      this.renderer.render(this.scene, this.camera);
    }
  };

  private motionAllowed(): boolean {
    return document.documentElement.dataset.reducedMotion !== 'true'
      && !(typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  private animate = (time: number): void => {
    if (!this.active || !this.turntable || !this.renderer) return;
    if (this.previousFrame !== undefined) {
      this.turntable.rotation.y = (this.turntable.rotation.y
        + Math.min(time - this.previousFrame, 50) * .00022) % (Math.PI * 2);
    }
    this.previousFrame = time;
    this.draw();
    this.animation = requestAnimationFrame(this.animate);
  };

  private release(): void {
    this.request?.abort();
    this.request = undefined;
    this.hideProgress();
    this.contextRestored = false;
    this.renderer?.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.observer?.disconnect();
    this.observer = undefined;
    this.controls?.dispose();
    this.controls = undefined;
    if (this.animation !== undefined && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.animation);
    }
    this.animation = undefined;
    this.previousFrame = undefined;
    this.models.forEach(model => model.dispose());
    this.models = [];
    this.floor?.geometry.dispose();
    this.floor?.material.dispose();
    this.floor = undefined;
    this.beam?.geometry.dispose();
    this.beam?.material.dispose();
    this.beam = undefined;
    this.turntable = undefined;
    this.scene?.traverse(node => {
      if (node instanceof THREE.SpotLight) node.shadow.dispose();
    });
    this.reflection?.dispose();
    this.reflection = undefined;
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer?.domElement.remove();
    this.renderer = undefined;
    this.scene = undefined;
    this.camera = undefined;
    this.state = 'idle';
    delete this.node.dataset.modelVehicle;
    delete this.node.dataset.bodies;
  }

  dispose(): void {
    this.active = false;
    this.release();
  }
}
