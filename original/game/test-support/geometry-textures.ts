import { Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { vi } from 'vitest';

/** jsdom cannot decode images. Geometry checks retain materials and UVs;
 * aircraft-markings.spec.ts verifies actual embedded-image decoding in Chromium. */
export function geometryTexturesOnly(): void {
  const parse = GLTFLoader.prototype.parseAsync;
  vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockImplementation(function (this: GLTFLoader, data, path) {
    this.register(() => ({ name: 'geometry-test-textures', loadTexture: async () => new Texture() }));
    return parse.call(this, data, path);
  });
}
