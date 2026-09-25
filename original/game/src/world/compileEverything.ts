import * as THREE from 'three';

let shadowProbes: THREE.Mesh[] | null = null;

/**
 * Tiny casters covering the shadow-depth variants streamed tiles can bring after the loading window:
 * plain, textured and cut-out surfaces, each drawn singly and instanced. Three shares one depth material
 * whose variant follows the caster's map and alphaTest, and drops a cut-out variant when its source
 * material is disposed, so these stay alive for the page's lifetime.
 */
function probes(): THREE.Mesh[] {
  if (shadowProbes) return shadowProbes;
  const geometry = new THREE.BoxGeometry(.01, .01, .01);
  const map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const materials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial({ map }),
    new THREE.MeshStandardMaterial({ map, alphaTest: .5 })];
  shadowProbes = materials.flatMap(material => [new THREE.Mesh(geometry, material), new THREE.InstancedMesh(geometry, material, 1)]);
  for (const probe of shadowProbes) {
    probe.castShadow = true;
    probe.frustumCulled = false;
  }
  return shadowProbes;
}

/**
 * Prepare every program the scene can need, including objects hidden until something happens
 * (splashes, ground marks, pooled effects, the personal-best ghost) and objects outside today's view
 *WebGLRenderer.compile only visits visible objects and never builds shadow-depth programs,
 * so those compiled on first appearance mid-race. After the compile, one throwaway frame draws
 * everything unculled, which builds the shadow variants and uploads buffers; the caller's own frame
 * overwrites it. Lights keep their visibility: a light's presence is part of every lit program.
 */
export async function compileEverything(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
  const restore = reveal(scene, camera);
  try {
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
  } finally {
    restore();
  }
}

/** The same preparation inside one task, for moments without a loading screen (restart, renderer swap) where a loop frame must not see the revealed scene. */
export function compileEverythingNow(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  const restore = reveal(scene, camera);
  try {
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
  } finally {
    restore();
  }
}

function reveal(scene: THREE.Scene, camera: THREE.Camera): () => void {
  const hidden: THREE.Object3D[] = [];
  const culled: THREE.Object3D[] = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Light) return;
    if (!node.visible) { hidden.push(node); node.visible = true; }
    if (node.frustumCulled) { culled.push(node); node.frustumCulled = false; }
  });
  const casters = probes();
  for (const probe of casters) {
    probe.position.copy(camera.position);
    scene.add(probe);
  }
  return () => {
    for (const probe of casters) probe.removeFromParent();
    for (const node of hidden) node.visible = false;
    for (const node of culled) node.frustumCulled = true;
  };
}
