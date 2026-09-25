/** Lossless final packaging for Blender models. No quantization or simplification. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';
import { NodeIO } from '../game/node_modules/@gltf-transform/core/dist/index.js';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '../game/node_modules/@gltf-transform/extensions/dist/index.js';
import { reorder } from '../game/node_modules/@gltf-transform/functions/dist/index.js';
import { MeshoptEncoder, MeshoptDecoder } from '../game/node_modules/meshoptimizer/index.js';

// Compare oriented triangles, including every per-corner attribute, independently
// of index/vertex order. This catches changed positions, normals, colors or winding.
function geometryDigest(document) {
  const meshes = document.getRoot().listMeshes().map(mesh => mesh.listPrimitives().map(primitive => {
    const semantics = primitive.listSemantics().sort();
    const attributes = semantics.map(semantic => primitive.getAttribute(semantic));
    const indices = primitive.getIndices().getArray();
    const vertex = index => JSON.stringify(attributes.map(attribute => {
      const size = attribute.getElementSize();
      return Array.from(attribute.getArray().subarray(index * size, (index + 1) * size));
    }));
    const triangles = [];
    for (let i = 0; i < indices.length; i += 3) {
      const corners = [vertex(indices[i]), vertex(indices[i + 1]), vertex(indices[i + 2])];
      triangles.push([0, 1, 2].map(start => [0, 1, 2].map(offset => corners[(start + offset) % 3]).join('|')).sort()[0]);
    }
    return {
      material: primitive.getMaterial()?.getName(),
      mode: primitive.getMode(),
      attributes: attributes.map((attribute, index) => [semantics[index], attribute.getType(), attribute.getComponentType(), attribute.getNormalized()]),
      triangles: triangles.sort(),
    };
  }));
  return createHash('sha256').update(JSON.stringify(meshes)).digest('hex');
}

const [input, output] = process.argv.slice(2);
assert(input && output && input !== output, 'Usage: node compress_models.mjs raw.glb packed.glb');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
const document = await io.read(input);
const before = geometryDigest(document);
async function structure(document) {
  const { json } = await io.writeJSON(document);
  return { nodes: json.nodes, scenes: json.scenes, scene: json.scene, materials: json.materials };
}
const originalStructure = await structure(document);
await document.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
// QUANTIZE is the codec mode name; deliberately do not run the lossy quantize()
// transform. Original float32 attributes are encoded exactly, with no filters.
document.createExtension(EXTMeshoptCompression).setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
const packed = await io.writeBinary(document);
const decoded = await io.readBinary(packed);
assert.equal(geometryDigest(decoded), before, 'Compressed model changed triangle attributes');
assert.deepEqual(await structure(decoded), originalStructure, 'Compressed model changed nodes, pivots or materials');
await writeFile(output, packed);
console.log(JSON.stringify({ input, output, rawBytes: (await stat(input)).size,
  packedBytes: (await stat(output)).size, geometrySHA256: before, structureUnchanged: true, lossless: true }));
