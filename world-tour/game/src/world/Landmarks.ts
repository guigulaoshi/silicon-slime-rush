import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { LandmarkRef, TimeOfDay } from '../track/types';
import type { ColliderSink, TrimeshCollider } from '../physics/colliders';
import { disposeModel } from './disposeModel';
import { lightAuthoredLandmark } from './materials';
import { trimeshFrom } from './tileContent';
import { environmentCastsShadow } from './environmentShadows';
import type { Quality } from './World';

interface InstanceState { key: string; model?: THREE.Group; loading?: Promise<void>; wanted: boolean; retryAfter?: number }
interface Template { controller: AbortController; loading: Promise<THREE.Group>; model?: THREE.Group }

/** One decoded template per file; streamed instances share it until this world retires. */
export class Landmarks {
  readonly root = new THREE.Group();
  private readonly states = new Map<LandmarkRef, InstanceState>();
  private readonly templates = new Map<string, Template>();
  private disposed = false;

  private quality: Quality;

  constructor(refs: readonly LandmarkRef[], private readonly baseUrl: string,
    private readonly time: TimeOfDay = 'day', private readonly colliders?: ColliderSink, quality: Quality = 'high') {
    this.quality = quality;
    this.root.name = 'landmarks';
    refs.forEach((ref, index) => this.states.set(ref, { key: `landmark:${index}`, wanted: false }));
  }

  update(x: number, z: number): void { this.updateMany([{ x, z }]); }

  /**
   * Landmarks cast the sun's shadow by the same rule as a streamed building. They load down their own
   * path, which in the original only ever said "receive": dozens of landmarks threw no shadow and a
   * metres-deep gateway read flat in the sun while the ordinary houses beside it had shadows.
   */
  setQuality(quality: Quality): void {
    this.quality = quality;
    for (const state of this.states.values()) if (state.model) this.shade(state.model);
  }

  private shade(model: THREE.Object3D): void {
    const cast = environmentCastsShadow(`landmark_${model.name}`, this.quality);
    model.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = cast; node.receiveShadow = true; } });
  }

  updateMany(positions: readonly { x: number; z: number }[]): void {
    if (this.disposed) return;
    for (const [ref, state] of this.states) {
      const distance = Math.min(...positions.map(({ x, z }) => Math.hypot(x - ref.pos[0], z - ref.pos[2])));
      if (distance <= ref.loadRadius) {
        state.wanted = true;
        if (!state.model && !state.loading && performance.now() >= (state.retryAfter ?? 0)) {
          state.loading = this.load(ref, state);
        }
      } else if (distance > ref.loadRadius * 1.25) {
        state.wanted = false;
        this.detach(state);
      }
    }
  }

  /** Optional models retain their existing fallback if a download fails. */
  async prepare(positions: readonly { x: number; z: number }[]): Promise<void> {
    this.updateMany(positions);
    await Promise.all([...this.states.values()].map(state => state.loading));
  }

  /**
   * Every landmark on the route decoded behind the loading screen, not only those in range of the
   * grid: one that came into range mid-race was downloaded, parsed and compiled on the spot (a
   * 400 ms frame on Shanghai at 4.9 s). Placing it later is then a clone and its colliders.
   */
  async preloadAll(): Promise<void> {
    await Promise.all([...this.states.keys()].map(ref => this.template(ref).catch(() => undefined)));
  }

  /** Hidden stand-ins for the decoded landmarks not placed yet, so the loading screen compiles their programs and uploads their textures. */
  warmGroup(): THREE.Group {
    const group = new THREE.Group();
    const placed = new Set([...this.states.values()].filter(state => state.model).map(state => state.model!.name));
    for (const [ref] of this.states) {
      const model = this.templates.get(ref.file)?.model;
      if (!model || placed.has(ref.id)) continue;
      const stand = model.clone(true);
      stand.position.fromArray(ref.pos);
      this.shade(stand);
      group.add(stand);
    }
    return group;
  }

  private template(ref: LandmarkRef): Promise<THREE.Group> {
    const cached = this.templates.get(ref.file);
    if (cached) return cached.loading;
    const controller = new AbortController();
    const entry: Template = { controller, loading: undefined! };
    entry.loading = (async () => {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/${ref.file}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`${ref.id}: HTTP ${response.status}`);
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const { scene } = await loader.parseAsync(await response.arrayBuffer(), '');
      if (this.disposed) {
        disposeModel(scene);
        throw new DOMException('World disposed', 'AbortError');
      }
      const prepared = new Set<THREE.Material>();
      const bounds = new THREE.Box3().setFromObject(scene);
      const height = bounds.isEmpty() ? 0 : bounds.max.y - bounds.min.y;
      scene.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.receiveShadow = true;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material instanceof THREE.MeshStandardMaterial && !prepared.has(material)) {
            lightAuthoredLandmark(material, this.time, height); prepared.add(material);
          }
        }
      });
      entry.model = scene;
      return scene;
    })().catch(error => {
      if (this.templates.get(ref.file) === entry) this.templates.delete(ref.file);
      throw error;
    });
    this.templates.set(ref.file, entry);
    return entry.loading;
  }

  private async load(ref: LandmarkRef, state: InstanceState): Promise<void> {
    try {
      const template = await this.template(ref);
      if (this.disposed || !state.wanted) return;
      const scene = template.clone(true);
      scene.name = ref.id;
      scene.position.fromArray(ref.pos);
      scene.rotation.y = ref.yaw;
      scene.updateWorldMatrix(true, true);
      if (ref.collision && this.colliders) {
        const trimeshes: TrimeshCollider[] = [];
        scene.traverse(node => {
          if (node instanceof THREE.Mesh) {
            const collider = trimeshFrom(node, 'wall');
            if (collider) trimeshes.push(collider);
          }
        });
        this.colliders.add(state.key, { trimeshes, boxes: [] });
      }
      this.shade(scene);
      state.model = scene;
      this.root.add(scene);
    } catch (error) {
      if (!this.disposed) {
        state.retryAfter = performance.now() + 10_000;
        console.warn(`landmark ${ref.id}: not loaded`, error);
      }
    } finally { state.loading = undefined; }
  }

  private detach(state: InstanceState): void {
    if (!state.model) return;
    state.model.removeFromParent();
    state.model = undefined;
    this.colliders?.remove(state.key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const state of this.states.values()) this.detach(state);
    for (const template of this.templates.values()) {
      template.controller.abort();
      if (template.model) disposeModel(template.model);
    }
    this.templates.clear();
    this.states.clear();
    this.root.clear();
  }
}
