import * as THREE from 'three';

export interface VehicleHit { object: THREE.Mesh; distance: number; point: THREE.Vector3; normal: THREE.Vector3 }

type Face = { triangle: THREE.Triangle; centre: THREE.Vector3 };
type Branch = { box: THREE.Box3; faces?: Face[]; children?: Branch[] };

function branch(faces: Face[]): Branch {
  const box = new THREE.Box3();
  for (const { triangle: t } of faces) box.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
  if (faces.length <= 12) return { box, faces };
  const extent = box.getSize(new THREE.Vector3());
  const axis = extent.x >= extent.y && extent.x >= extent.z ? 'x' : extent.y >= extent.z ? 'y' : 'z';
  faces.sort((a, b) => a.centre[axis] - b.centre[axis]);
  const middle = Math.floor(faces.length / 2);
  return { box, children: [branch(faces.slice(0, middle)), branch(faces.slice(middle))] };
}

/** Index the loaded triangles once; moving wheels retain their current object transforms. */
export class VehicleOcclusion {
  private readonly meshes: { mesh: THREE.Mesh; tree: Branch; inverse: THREE.Matrix4 }[] = [];
  private readonly localRay = new THREE.Ray();
  private readonly hit = new THREE.Vector3();
  private readonly boxHit = new THREE.Vector3();

  constructor(group: THREE.Object3D) {
    group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const position = node.geometry.getAttribute('position');
      const index = node.geometry.index;
      const faces: Face[] = [];
      for (let i = 0; i < (index?.count ?? position.count); i += 3) {
        const points = [0, 1, 2].map(j => new THREE.Vector3()
          .fromBufferAttribute(position, index ? index.getX(i + j) : i + j));
        const triangle = new THREE.Triangle(points[0]!, points[1]!, points[2]!);
        faces.push({ triangle, centre: triangle.getMidpoint(new THREE.Vector3()) });
      }
      this.meshes.push({ mesh: node, tree: branch(faces), inverse: new THREE.Matrix4() });
    });
  }

  update(): void {
    for (const entry of this.meshes) entry.inverse.copy(entry.mesh.matrixWorld).invert();
  }

  first(ray: THREE.Ray, far: number): VehicleHit | null {
    let closest: VehicleHit | null = null;
    for (const { mesh, tree, inverse } of this.meshes) {
      this.localRay.copy(ray).applyMatrix4(inverse);
      const material = mesh.material as THREE.Material;
      const visit = (node: Branch): void => {
        if (!this.localRay.intersectBox(node.box, this.boxHit)) return;
        // An origin inside a box has a zero lower bound, not its exit distance.
        if (!node.box.containsPoint(this.localRay.origin)
          && this.boxHit.applyMatrix4(mesh.matrixWorld).distanceTo(ray.origin) > (closest?.distance ?? far)) return;
        if (node.children) { for (const child of node.children) visit(child); return; }
        for (const { triangle: t } of node.faces!) {
          const hit = material.side === THREE.BackSide
            ? this.localRay.intersectTriangle(t.c, t.b, t.a, true, this.hit)
            : this.localRay.intersectTriangle(t.a, t.b, t.c, material.side !== THREE.DoubleSide, this.hit);
          if (!hit) continue;
          const distance = hit.applyMatrix4(mesh.matrixWorld).distanceTo(ray.origin);
          if (distance <= far && (!closest || distance < closest.distance)) closest = { object: mesh, distance,
            point: hit.clone(), normal: t.getNormal(new THREE.Vector3())
              .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)) };
        }
      };
      visit(tree);
    }
    return closest;
  }
}
