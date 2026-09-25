import * as THREE from 'three';

/** Move persistent RGBA8 pixels while both contexts are alive, one temporary tile at a time. */
export function transferRenderTargets(source: THREE.WebGLRenderer, destination: THREE.WebGLRenderer,
  targets: Iterable<THREE.WebGLRenderTarget>): void {
  for (const target of targets) {
    const pixels = new Uint8Array(target.width * target.height * 4);
    source.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
    const snapshot = new THREE.DataTexture(pixels, target.width, target.height);
    snapshot.needsUpdate = true;
    destination.initRenderTarget(target);
    destination.copyTextureToTexture(snapshot, target.texture);
    snapshot.dispose();
  }
}
