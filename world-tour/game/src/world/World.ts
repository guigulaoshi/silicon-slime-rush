import { Landmarks } from './Landmarks';
import * as THREE from 'three';
import { RecordingColliderSink, type ColliderSink } from '../physics/colliders';
import { Spline, buildSafetyNet } from '../track/Spline';
import type { TimeOfDay, TrackData } from '../track/types';
import { Backdrop } from './Backdrop';
import { Billboards } from './Billboards';
import { Headlights, type LampCone } from './Headlights';
import { MaterialLibrary } from './materials';
import { NightScenery } from './NightScenery';
import { Sky, type Weather } from './Sky';
import { TileStreamer } from './TileStreamer';
import type { StreamWindow } from './streaming';
import type { StreamPosition } from './streaming';
import { ANTIALIAS, MIST_SHEETS, PIXEL_RATIO_CAP, POST_GRADE, QUALITY_LIMITS, SHADOWS, type QualityLimits } from './quality';
import { PostGrade } from './PostGrade';
import { Mist } from './Mist';
import type { SlimeDensity } from '../app/Save';
import type { VehicleBody } from '../vehicles/catalogue';
import { WeatherSurface } from './WeatherSurface';
import { WeatherEffects } from './WeatherEffects';
import { TireMarks } from './TireMarks';

export type Quality = 'high' | 'medium' | 'low';


/**
 * Which time of day a race actually runs in.
 *
 * Its own function because the whole point of
 * is that one value beats another, and a rule about precedence with no name is a rule nothing can
 * be pointed at. `World` is a WebGL object and cannot be built in a test; this can.
 */
export function timeOfDayFor(track: Pick<TrackData, 'timeOfDay'>, options: WorldOptions = {}): TimeOfDay {
  return options.timeOfDay ?? track.timeOfDay;
}

export interface WorldOptions {
  quality?: Quality;
  colliders?: ColliderSink;
  /**
   * What the player chose on the opening screen, overriding the route's own `timeOfDay`.
   *
   * The route still carries a value -- the
   * pipeline needs one to build against, and the automated runs use it -- but it stops deciding
   * what a player sees. Absent here means "whatever the route says", which is what every test and
   * every bot run still means.
   */
  timeOfDay?: TimeOfDay;
  /** Controls which authored gameplay population is extracted from tile transport meshes. */
  slimeDensity?: SlimeDensity;
  /**
   * How much of the route is kept loaded. Absent means the driving window, which is what a race
   * wants: it follows a car on the ground. The home page's camera hangs ninety metres up and looks
   * kilometres down the bridge, so it needs the whole route -- outside the window there
   * is no ground at all, and the backdrop deliberately leaves the corridor to the tiles, so what
   * the player saw through the gap was the sky.
   */
  streamWindow?: Partial<StreamWindow>;
  /** Independent from time of day: every weather can be run by day or night. */
  weather?: Weather;
}

/**
 * The rendered world for one track: renderer, scene, lighting and the streamed tiles.
 *
 * It owns no gameplay. Something else decides where the car is and tells this where to look,
 * which is what lets the same class serve the race, the menu backdrop and the automated tests.
 */
export class World {
  renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cameras: THREE.PerspectiveCamera[] = [];
  readonly viewHosts: HTMLDivElement[] = [];
  readonly spline: Spline;
  readonly materials = new MaterialLibrary();
  /** What the roadside boards say. Loaded from its own manifest; see Billboards. */
  readonly billboards = new Billboards(this.materials);
  /** Hills, water and skyline past the streamed tiles. Loaded once and left there. */
  readonly backdrop = new Backdrop(this.materials);
  readonly streamer: TileStreamer;
  readonly landmarks: Landmarks;
  /**
   * How many textures actually landed, and null until the load settles. Zero *after* it settles
   * means the manifest never arrived, which is half of what puts a car in an empty sky
   * (`app/dataHealth.ts`); zero before it settles is just a boot in progress.
   */
  texturesApplied: number | null = null;
  readonly sceneryReady: Promise<unknown>;
  readonly sky: Sky;
  private mist: Mist | null = null;
  /** The car's own headlights. Only exist at night; see Headlights. */
  readonly headlights: Headlights;
  readonly playerHeadlights: Headlights[] = [];
  readonly racerHeadlights: Headlights[] = [];
  readonly nightScenery: NightScenery;
  readonly tireMarks: TireMarks;
  readonly weatherEffects: WeatherEffects;
  readonly colliders: ColliderSink;

  onRendererChange?: (previous: THREE.WebGLRenderer, next: THREE.WebGLRenderer) => void;
  private reflection: THREE.WebGLRenderTarget;
  private quality: Quality;
  private readonly born = performance.now();
  private readonly onResize = () => this.resize();
  /**
   * A restored context gets every texture and buffer back from three.js, because their
   * pixels still live on the CPU -- but a render target's pixels only ever lived on the GPU. The
   * baked sky reflection is one, and every reflecting surface reads it: glass walls went black and
   * the whole street lost its sky light until the page was reloaded. Rebake on the next frame
   * rather than inside the event, after three.js has rebuilt its own state.
   */
  private contextRestored = false;
  private readonly onContextRestored = () => { this.contextRestored = true; };

  constructor(
    private readonly container: HTMLElement,
    readonly track: TrackData,
    baseUrl: string,
    options: WorldOptions = {},
  ) {
    this.quality = options.quality ?? 'high';
    this.colliders = options.colliders ?? new RecordingColliderSink();
    this.spline = new Spline(track);

    this.renderer = this.createRenderer(this.quality);
    container.appendChild(this.renderer.domElement);

    // The far plane has to clear the backdrop and the sky dome outside it. Near is 0.6 rather
    // than 0.5 to claw back a little depth precision now that far is measured in kilometres.
    const view = track.backdrop?.radiusM ?? 2100;
    const horizon = track.backdrop?.horizonRadiusM;
    const skyRadius = horizon ? horizon + this.spline.length : view;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.6, Math.max(4000, skyRadius * 1.6));
    this.cameras.push(this.camera);
    const timeOfDay = timeOfDayFor(track, options);
    const weather = options.weather ?? 'clear';
    this.sky = new Sky(this.scene, timeOfDay, undefined, track.backdrop?.radiusM, weather, skyRadius, track.origin?.lat, track.sky);
    this.backdrop.configureAtmosphere(weather, this.scene.fog as THREE.Fog);
    this.buildMist();
    this.reflection = this.sky.reflection(this.renderer);
    this.scene.environment = this.reflection.texture;
    this.sky.setShadowQuality(this.quality);
    this.materials.lightFor(timeOfDay);
    this.materials.tintFor(track.tint);
    this.materials.weatherFor(weather);
    this.headlights = new Headlights(timeOfDay, weather);
    this.playerHeadlights.push(this.headlights);
    this.racerHeadlights.push(this.headlights);
    this.nightScenery = new NightScenery(this.spline, timeOfDay, track.lampStyle);
    this.tireMarks = new TireMarks(weather);
    this.weatherEffects = new WeatherEffects(new WeatherSurface(this.spline, weather));
    this.scene.add(this.weatherEffects.root);
    if (this.headlights.on) this.scene.add(this.headlights.group);
    if (this.nightScenery.count) this.scene.add(this.nightScenery.root);
    this.streamer = new TileStreamer(
      track, baseUrl, this.materials, this.colliders, options.streamWindow, options.slimeDensity ?? 'normal',
      this.quality);
    this.landmarks = new Landmarks(track.landmarks ?? [], baseUrl, timeOfDay, this.colliders, this.quality);
    this.scene.add(this.streamer.root, this.backdrop.root, this.landmarks.root, this.tireMarks.root);
    const backdropReady = this.backdrop.load(track, baseUrl);
    // Textures are global rather than per-track, so they hang off the site root, not the track
    // directory. Anisotropy is asked of the renderer rather than assumed: without it a tiled
    // surface goes to mush about twenty metres ahead, which is where the player is looking.
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    // A city's own walls, ground floors and roofs travel with the track (`tracks/<id>/textures/`,
    // pipeline/sr/local_style.py); a track without them keeps the shared facades.
    const texturesReady = Promise.all([
      this.materials.loadTextures('.', anisotropy),
      track.localTextures ? this.materials.loadTextures(baseUrl, anisotropy) : Promise.resolve(0),
    ])
      // Settles either way: left null forever, a rejected load would look like "still loading" and
      // the greybox warning would never appear -- which is the silence exists to end.
      .then(([shared, local]) => { this.texturesApplied = shared + local; }, () => { this.texturesApplied = 0; });

    this.sceneryReady = Promise.all([backdropReady, texturesReady]);

    // the net goes in before any tile does, so there is ground under the car from the first frame
    const ends = !this.spline.closed && track.endRoads ? Object.values(track.endRoads) : [];
    const safetyNets = ends.length
      ? [buildSafetyNet(this.spline, undefined, 2, 0, 0), ...ends.map(spline =>
        buildSafetyNet(new Spline({...track, spline}), undefined, 2, 0, 0))]
      : [buildSafetyNet(this.spline)];
    this.colliders.add('safety-net', { trimeshes: safetyNets, boxes: [] });

    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  setQuality(quality: Quality): void {
    const antialias = ANTIALIAS[quality];
    if (this.renderer.getContextAttributes()?.antialias !== antialias) {
      const old = this.renderer;
      this.renderer = this.createRenderer(quality);
      this.reflection.dispose();
      this.reflection = this.sky.reflection(this.renderer);
      this.scene.environment = this.reflection.texture;
      this.onRendererChange?.(old, this.renderer);
      old.domElement.replaceWith(this.renderer.domElement);
      old.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
      old.dispose(); old.forceContextLoss();
      this.resize();
    }
    this.quality = quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP[quality]));
    this.renderer.shadowMap.enabled = SHADOWS[quality];
    this.sky.setShadowQuality(quality);
    this.streamer.setQuality(quality);
    this.landmarks.setQuality(quality);
    // the sheets are full-screen transparent layers: a machine dropped to a lower level sheds them too
    if (this.mist && this.mist.sheets !== MIST_SHEETS[quality]) this.buildMist();
  }

  /** The track's valley mist, as many sheets as this quality level draws. */
  private buildMist(): void {
    this.mist?.dispose(); this.mist?.root.removeFromParent(); this.mist = null;
    const spec = this.track.mist;
    if (!spec) return;
    const points = this.track.spline.points;
    const centre = points.reduce((sum, p) => sum.add(new THREE.Vector3(p[0], 0, p[2])), new THREE.Vector3())
      .divideScalar(points.length);
    this.mist = new Mist(spec, centre, this.sky.timeOfDay, MIST_SHEETS[this.quality]);
    this.scene.add(this.mist.root);
  }

  get currentQuality(): Quality { return this.quality; }
  get qualityLimits(): Readonly<QualityLimits> { return QUALITY_LIMITS[this.quality]; }

  private createRenderer(quality: Quality): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({ antialias: ANTIALIAS[quality], powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP[quality]));
    renderer.shadowMap.enabled = SHADOWS[quality];
    // Three 0.185 maps the deprecated soft constant to this implementation and warns every page.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    return renderer;
  }

  /** Tell the world where the car is: what to stream, and where to put the shadow volume. */
  follow(s: number, x: number, y: number, z: number, positions?: readonly StreamPosition[]): void {
    if (positions) this.streamer.updateMany(positions);
    else this.streamer.update(s, x, z);
    this.landmarks.updateMany(positions ?? [{ x, z }]);
    this.sky.follow(x, y, z);
  }

  setViewCount(count: number): void {
    while (this.cameras.length < count) this.cameras.push(this.camera.clone());
    this.cameras.length = count;
    for (const host of this.viewHosts) host.remove();
    this.viewHosts.length = 0;
    for (let index = 0; index < count; index++) {
      const host = document.createElement('div');
      host.className = 'race-viewport';
      host.dataset.player = String(index + 1);
      Object.assign(host.style, { position: 'absolute', top: '0', bottom: '0',
        left: `${index * 100 / count}%`, width: `${100 / count}%`, overflow: 'hidden', pointerEvents: 'none' });
      this.container.append(host);
      this.viewHosts.push(host);
    }
    this.resize();
  }

  private readonly lampCones: LampCone[] = [0, 1].map(() => ({ position: new THREE.Vector3(),
    direction: new THREE.Vector3(), cosAngle: 1, reach: 0 }));

  /** Hand the human front lamps to the sky, so night rain and snow light up inside them. */
  syncLampCones(): void {
    this.sky.setLampCones(this.lampCones.map((cone, i) => this.playerHeadlights[i]?.frontCone(cone) ?? null));
  }

  /** Real road illumination for every racer; human rigs preserve individual bumper and roof origins. */
  setRacerHeadlights(racers: readonly { body: VehicleBody; human: boolean }[]): void {
    for (const lights of this.racerHeadlights.slice(1)) lights.dispose();
    this.racerHeadlights.length = 0;
    this.playerHeadlights.length = 0;
    for (const [index, racer] of racers.entries()) {
      const lights = index === 0 ? this.headlights : new Headlights(this.headlights.timeOfDay, this.headlights.weather);
      lights.fit(racer.body, racer.human);
      this.racerHeadlights.push(lights);
      if (racer.human) this.playerHeadlights.push(lights);
      if (lights.on && !lights.group.parent) this.scene.add(lights.group);
    }
  }

  /** Redraw what only ever lived on the GPU; see `contextRestored`. */
  private restoreGpuOnlyPixels(): void {
    this.contextRestored = false;
    // Not disposed: its GPU objects died with the lost context, and deleting them again only makes
    // WebGL warn that they belong to another context.
    this.reflection = this.sky.reflection(this.renderer);
    this.scene.environment = this.reflection.texture;
    this.weatherEffects.regenerate();
  }

  render(beforeView?: (index: number, camera: THREE.PerspectiveCamera) => number | void): void {
    if (this.contextRestored) this.restoreGpuOnlyPixels();
    const pixelRatio = Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP[this.quality]);
    if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    this.materials.animate((performance.now() - this.born) / 1000);
    this.mist?.update((performance.now() - this.born) / 1000);
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    // One reported frame includes every viewport, not only the last renderer.render call.
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    const post = this.postGrade();
    post?.begin();
    this.renderer.setScissorTest(true);
    for (const [index, camera] of this.cameras.entries()) {
      const left = Math.floor(width * index / this.cameras.length);
      const right = Math.floor(width * (index + 1) / this.cameras.length);
      this.renderer.setViewport(left, 0, right - left, height);
      this.renderer.setScissor(left, 0, right - left, height);
      camera.aspect = (right - left) / height;
      camera.updateProjectionMatrix();
      const speed = beforeView?.(index, camera);
      this.sky?.beforeCamera(camera, typeof speed === 'number' ? speed : 0);
      this.renderer.render(this.scene, camera);
    }
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
    post?.end();
  }

  /** Where this quality level draws the scene each frame: the grade pass's HDR target, or null for the screen. */
  sceneTarget(): THREE.WebGLRenderTarget | null {
    const post = this.postGrade();
    if (!post) return null;
    const target = post.begin();
    this.renderer.setRenderTarget(null);
    return target;
  }

  private grade: PostGrade | null = null;
  private gradeRenderer: THREE.WebGLRenderer | null = null;

  /** The bloom-and-grade pass when this quality level runs it (desktop high), built on first use. */
  private postGrade(): PostGrade | null {
    if (!POST_GRADE[this.quality] || new URLSearchParams(location.search).get('grade') === '0') {
      this.grade?.dispose(); this.grade = null;
      return null;
    }
    if (!this.grade || this.gradeRenderer !== this.renderer) {
      this.grade?.dispose();
      this.grade = new PostGrade(this.renderer, this.sky.timeOfDay);
      this.gradeRenderer = this.renderer;
    }
    return this.grade;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    for (const camera of this.cameras) {
      camera.aspect = w / this.cameras.length / h;
      camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.streamer.clear();
    this.grade?.dispose();
    this.reflection.dispose();
    this.scene.environment = null;
    this.sky.dispose();
    this.mist?.dispose();
    this.racerHeadlights.forEach(lights => lights.dispose());
    this.nightScenery.dispose();
    this.tireMarks.dispose();
    this.weatherEffects.dispose();
    this.backdrop.dispose();
    this.landmarks.dispose();
    this.materials.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.viewHosts.forEach(host => host.remove());
  }
}
