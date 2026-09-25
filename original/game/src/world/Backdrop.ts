import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { TrackData } from '../track/types';
import type { MaterialLibrary } from './materials';
import { readTile } from './tileContent';
import { FarAtmosphere } from './FarAtmosphere';
import type { Weather } from './Sky';

/**
 * The distant scenery: loaded once, never unloaded, never collided with.
 *
 * Streamed tiles work because the car is always in the middle of them. The view is not like that --
 * from the Golden Gate you are looking at an island four kilometres away and a skyline eight -- so
 * the far scenery is one coarse mesh that is simply always there. It goes in behind everything
 * else: `renderOrder` keeps it from sorting in front of the tiles it overlaps at the seam.
 */
export class Backdrop {
  readonly root = new THREE.Group();
  private loaded = false;
  private atmosphere: FarAtmosphere | null = null;

  constructor(private readonly materials: MaterialLibrary) {
    this.root.name = 'backdrop';
  }

  configureAtmosphere(weather: Weather, fog: THREE.Fog): void {
    this.atmosphere?.dispose();
    this.atmosphere = new FarAtmosphere(weather, fog);
  }

  get ready(): boolean {
    return this.loaded;
  }

  /**
   * Fetch and add it. A missing or broken backdrop leaves the horizon empty rather than failing
   * the track: it is scenery, and no view is worth not being able to drive.
   */
  async load(track: TrackData, baseUrl: string): Promise<boolean> {
    const file = track.backdrop?.file;
    if (!file) return false;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    try {
      const gltf = await loader.loadAsync(`${baseUrl.replace(/\/$/, '')}/${file}`);
      // readTile gives the shared materials and, because every backdrop node is declared
      // collider "none" in the contract, no colliders at all
      const { group } = readTile(gltf.scene, this.materials);
      group.traverse((o) => {
        o.renderOrder = -1;
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = false; mesh.receiveShadow = false;
          const material = mesh.material;
          if (track.backdrop?.horizonRadiusM && this.atmosphere
              && material instanceof THREE.MeshStandardMaterial
              && (material.name.startsWith('terrain') || material.name === 'water')) {
            mesh.material = this.atmosphere.material(material);
          }
        }
      });
      this.root.add(group);
      this.loaded = true;
      return true;
    } catch (err) {
      console.warn('backdrop: not loaded, the horizon stays empty', err);
      return false;
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.root.clear();
    this.atmosphere?.dispose();
    this.atmosphere = null;
    this.loaded = false;
  }
}
