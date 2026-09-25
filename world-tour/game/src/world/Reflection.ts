import * as THREE from 'three';

/** Bake once per renderer, then reuse the filtered sky/room for every reflecting surface. */
export function bakeReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene): THREE.WebGLRenderTarget {
  const generator = new THREE.PMREMGenerator(renderer);
  try { return generator.fromScene(scene, .02, .1, 1000, { size: 128 }); }
  finally { generator.dispose(); }
}
