import * as THREE from 'three';

export interface BillboardAudit {
  key: string;
  material: string;
  side: -1 | 1;
  blockedSamples: number;
  blockers: string[];
}

const materialName = (object: THREE.Object3D): string => {
  const material = (object as THREE.Mesh).material;
  return Array.isArray(material) ? material[0]?.name ?? '' : material?.name ?? '';
};

const isOccluder = (object: THREE.Object3D): object is THREE.Mesh => {
  if (!(object as THREE.Mesh).isMesh) return false;
  const name = materialName(object);
  return name.startsWith('billboard_face_') || name.startsWith('building') ||
    name.startsWith('foliage') || name === 'trunk';
};

/** Audit every currently streamed face from the same road approach used by the placement pipeline. */
export function auditLoadedBillboards(scene: THREE.Scene): BillboardAudit[] {
  scene.updateMatrixWorld(true);
  const occluders: THREE.Object3D[] = [];
  const targets: THREE.InstancedMesh[] = [];
  scene.traverse((object) => {
    if (!isOccluder(object)) return;
    occluders.push(object);
    if ((object as THREE.InstancedMesh).isInstancedMesh && materialName(object).startsWith('billboard_face_')) {
      targets.push(object as THREE.InstancedMesh);
    }
  });

  const ray = new THREE.Raycaster();
  const localSamples = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.38, 0, 0), new THREE.Vector3(-0.38, 0, 0),
    new THREE.Vector3(0, 0.30, 0), new THREE.Vector3(0, -0.30, 0),
  ];
  const audits: BillboardAudit[] = [];
  for (const target of targets) {
    for (let instanceId = 0; instanceId < target.count; instanceId++) {
      const local = new THREE.Matrix4();
      target.getMatrixAt(instanceId, local);
      const matrix = target.matrixWorld.clone().multiply(local);
      const face = new THREE.Vector3().setFromMatrixPosition(matrix);
      const view = billboardView(target.userData.billboardViews, face);
      target.geometry.computeBoundingBox();
      const bounds = target.geometry.boundingBox!;
      const geometrySize = bounds.getSize(new THREE.Vector3());
      const geometryCentre = bounds.getCenter(new THREE.Vector3());
      const eye = new THREE.Vector3().fromArray(view.eye);
      const side = view.side;
      const blockers: string[] = [];
      let blockedSamples = 0;
      for (const sample of localSamples) {
        const end = sample.clone().multiply(geometrySize).add(geometryCentre).applyMatrix4(matrix);
        const direction = end.clone().sub(eye);
        const distance = direction.length();
        ray.set(eye, direction.normalize());
        ray.far = distance + 0.5;
        const first = ray.intersectObjects(occluders, false)[0];
        const reachesTarget = first?.object === target && first.instanceId === instanceId;
        if (!reachesTarget) {
          blockedSamples++;
          blockers.push(first
            ? `${materialName(first.object)}:${first.instanceId ?? '-'}@${first.point.x.toFixed(2)},${first.point.y.toFixed(2)},${first.point.z.toFixed(2)}`
            : 'no-face-hit');
        }
      }
      audits.push({
        key: `${materialName(target)}:${face.x.toFixed(2)},${face.y.toFixed(2)},${face.z.toFixed(2)}`,
        material: materialName(target), side, blockedSamples, blockers,
      });
    }
  }
  return audits;
}


interface BillboardView {face: [number,number,number]; eye: [number,number,number]; side: -1 | 1}

/** Read the pipeline's actual acceptance eye; compressed instances may be reordered. */
export function billboardView(views: BillboardView[] | undefined, face: THREE.Vector3): BillboardView {
  const found = views?.find(view => face.distanceTo(new THREE.Vector3().fromArray(view.face)) < .1);
  if (!found) throw new Error(`Missing authoring view for billboard ${face.toArray()}`);
  return found;
}
