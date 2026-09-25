import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { LandmarkRef, TimeOfDay } from '../track/types';
import type { ColliderSink, TrimeshCollider } from '../physics/colliders';
import { disposeModel } from './disposeModel';
import { lightAuthoredLandmark } from './materials';
import { trimeshFrom } from './tileContent';

interface InstanceState { key: string; model?: THREE.Group; loading?: Promise<void>; wanted: boolean; retryAfter?: number }
interface Template { controller: AbortController; loading: Promise<THREE.Group>; model?: THREE.Group }

/** One decoded template per file; streamed instances share it until this world retires. */
export class Landmarks {
  readonly root = new THREE.Group();
  private readonly states = new Map<LandmarkRef, InstanceState>();
  private readonly templates = new Map<string, Template>();
  private disposed = false;

  constructor(refs: readonly LandmarkRef[], private readonly baseUrl: string,
    private readonly time: TimeOfDay = 'day', private readonly colliders?: ColliderSink) {
    this.root.name = 'landmarks';
    refs.forEach((ref, index) => this.states.set(ref, { key: `landmark:${index}`, wanted: false }));
  }

  update(x: number, z: number): void { this.updateMany([{ x, z }]); }

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
      scene.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.receiveShadow = true;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material instanceof THREE.MeshStandardMaterial && !prepared.has(material)) {
            lightAuthoredLandmark(material, this.time); prepared.add(material);
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
