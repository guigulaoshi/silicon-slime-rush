"""Render garage reference PNGs from delivered GLBs without rebuilding assets.

From the repository root:
  blender --background --python-exit-code 1 --python assets-src/vehicles/render_garage_references.py
Use -- --ids sports-car,jeep to render a subset.
"""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, CATALOGUE, box, material, xyz

REFERENCE_IDS = tuple(spec["id"] for spec in CATALOGUE["vehicles"])


def import_delivered(vehicle_id):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / f"game/public/models/cars/{vehicle_id}.glb"))
    imported = set(bpy.data.objects) - before
    roots = [obj for obj in imported if obj.parent is None]
    if len(roots) != 1:
        raise ValueError(f"{vehicle_id}: expected one delivered vehicle root")
    return roots[0]


def mesh_points(root):
    return [obj.matrix_world @ vertex.co for obj in root.children_recursive
            if obj.type == "MESH" for vertex in obj.data.vertices]


def hitch(root):
    # Blender adds .001 to duplicate imported node names in the second GLB.
    return next(obj for obj in root.children if obj.name.split(".")[0] == "hitch")


def assemble_trailer(pickup_root, trailer_id):
    """Keep the real coupler on the ball while resting both bodies on the floor."""
    trailer_root = import_delivered(trailer_id)
    bpy.context.view_layer.update()
    ground = min(point.z for point in mesh_points(pickup_root))
    ball = hitch(pickup_root).matrix_world.translation.copy()
    coupler = hitch(trailer_root).location.copy()
    points = mesh_points(trailer_root)

    def pose(angle):
        rotation = Matrix.Rotation(angle, 4, "X")
        offset = ball - rotation @ coupler
        return rotation, offset, min((rotation @ point + offset).z for point in points)

    # Final GLBs store fully extended suspension. A slight trailer pitch gives
    # a physical parked pose without moving wheel pivots or editing any mesh.
    low, high = -.15, .15
    if (pose(low)[2] - ground) * (pose(high)[2] - ground) > 0:
        raise ValueError("Trailer cannot rest on the floor within the parked pitch range")
    for _ in range(40):
        middle = (low + high) / 2
        if (pose(middle)[2] - ground) * (pose(low)[2] - ground) > 0:
            low = middle
        else:
            high = middle
    angle = (low + high) / 2
    rotation, offset, _ = pose(angle)
    trailer_root.matrix_world = Matrix.Translation(offset) @ rotation
    bpy.context.view_layer.update()
    print(json.dumps({"trailer_pitch_degrees": math.degrees(angle),
                      "hitch_gap": (hitch(trailer_root).matrix_world.translation - ball).length}), flush=True)
    return trailer_root


def render_reference(spec, directory):
    model_ids = [spec["id"]]
    if "trailer" in spec:
        model_ids.append(spec["trailer"]["id"])
    models = {f"{model_id}.glb": hashlib.sha256(
        (ROOT / f"game/public/models/cars/{model_id}.glb").read_bytes()).hexdigest()
        for model_id in model_ids}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    roots = [import_delivered(spec["id"])]
    if "trailer" in spec:
        roots.append(assemble_trailer(roots[0], spec["trailer"]["id"]))
    bpy.context.view_layer.update()
    points = [point for root in roots for point in mesh_points(root)]
    lower = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    upper = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    target = (lower + upper) / 2
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 853
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world = bpy.data.worlds.new("Reference world")
    scene.world.color = (.30, .30, .30)
    scene.view_settings.view_transform = "AgX"
    # Match the existing Sedan reference's neutral floor and three softboxes.
    box("Reference studio floor", (0, lower.z - .011, 0), (200, .020, 200),
        material("Reference studio grey", (.40, .43, .46), roughness=.85), None)
    # Scale the studio with the subject so long vehicles retain the same light.
    studio_scale = max(1, (upper - lower).length / 3)
    for name, location, power, size in [("Key", (-3, 4, 6), 700, 5),
                                      ("Fill", (4, 1, 4), 450, 4),
                                      ("Rim", (-1, -4, 5), 800, 3)]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = power * studio_scale**2
        data.shape = "DISK"
        data.size = size * studio_scale
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = target + Vector(location) * studio_scale
        obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()
    data = bpy.data.cameras.new("Reference camera")
    data.lens = 52
    camera = bpy.data.objects.new("Reference camera", data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    direction = Vector(xyz((2.4, 1.15, -3.3))).normalized()
    camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    # Fit the delivered bounds, including mirrors and the complete articulated
    # rig, with fixed margins rather than vehicle-specific camera guesses.
    corners = [Vector((x, y, z)) for x in (lower.x, upper.x)
               for y in (lower.y, upper.y) for z in (lower.z, upper.z)]
    near, far = .1, (upper - lower).length * 10
    for _ in range(40):
        distance = (near + far) / 2
        camera.location = target + direction * distance
        bpy.context.view_layer.update()
        frame = [world_to_camera_view(scene, camera, point) for point in corners]
        if all(.08 <= p.x <= .92 and .09 <= p.y <= .91 and p.z > 0 for p in frame):
            far = distance
        else:
            near = distance
    camera.location = target + direction * far
    directory.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(directory / f"{spec['id']}.png")
    bpy.ops.render.render(write_still=True)
    manifest_path = directory / "rendered-models.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest[spec["id"]] = {
        "models": models,
        "imageSha256": hashlib.sha256(Path(scene.render.filepath).read_bytes()).hexdigest(),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"id": spec["id"], "path": scene.render.filepath,
                      "resolution": [1280, 853]}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", default=",".join(REFERENCE_IDS))
    parser.add_argument("--output-dir", type=Path, default=Path("docs/car-reference"))
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    specs = {spec["id"]: spec for spec in CATALOGUE["vehicles"]}
    for vehicle_id in args.ids.split(","):
        if vehicle_id not in REFERENCE_IDS:
            parser.error(f"unsupported reference id: {vehicle_id}")
        render_reference(specs[vehicle_id], ROOT / args.output_dir)


if __name__ == "__main__":
    main()
