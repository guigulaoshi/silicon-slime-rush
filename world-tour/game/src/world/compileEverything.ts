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
export async function compileEverything(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null = null): Promise<void> {
  const restore = reveal(scene, camera);
  try {
    // A program is built for where it draws: into the grade pass's HDR target it has no tone mapping and a
    // linear output, on screen it has both. Desktop high draws every frame into that target, so compiling
    // only for the screen left everything first seen mid-race (the ghost car, the giants' wheel marks)
    // to compile on its first frame there. Build both: quality can still drop to the screen path mid-race.
    for (const at of target ? [target, null] : [undefined]) {
      if (at !== undefined) renderer.setRenderTarget(at);
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
    }
  } finally {
    if (target) renderer.setRenderTarget(null);
    restore();
  }
}

/** The same preparation inside one task, for moments without a loading screen (restart, renderer swap) where a loop frame must not see the revealed scene. */
export function compileEverythingNow(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null = null): void {
  const restore = reveal(scene, camera);
  try {
    for (const at of target ? [target, null] : [undefined]) {
      if (at !== undefined) renderer.setRenderTarget(at);
      renderer.compile(scene, camera);
      renderer.render(scene, camera);
    }
  } finally {
    if (target) renderer.setRenderTarget(null);
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
