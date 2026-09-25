"""Axis-aligned 256 m tile grid and per-tile buckets of geometry, instances and collider metadata."""
import math
from collections import defaultdict

import numpy as np

from sr.mesh import merge, split_by_tile

TILE = 256.0


def tile_of(x, z):
    return int(math.floor(x / TILE)), int(math.floor(z / TILE))


def tile_rect(col, row):
    return col * TILE, row * TILE, (col + 1) * TILE, (row + 1) * TILE


def tile_name(col, row):
    return f"t_{col}_{row}"


def s_ranges_for_tile(P, S, col, row, closed=False, margin=TILE, pad=None):
    """Arc-length intervals over which the spline is within `margin` of the tile rectangle.

    Containment alone is not enough: a tile beside the road holds the scenery the driver is looking
    at, and would otherwise carry no interval and load only once the car was already past it."""
    x0, z0, x1, z1 = tile_rect(col, row)
    dx = np.maximum(np.maximum(x0 - P[:, 0], P[:, 0] - x1), 0.0)
    dz = np.maximum(np.maximum(z0 - P[:, 2], P[:, 2] - z1), 0.0)
    near = np.hypot(dx, dz) <= margin
    if not near.any():
        return []
    step = float(S[1] - S[0]) if len(S) > 1 else 2.0
    pad = step if pad is None else pad
    length = float(S[-1] + (np.linalg.norm(P[0] - P[-1]) if closed else 0.0))
    runs, start = [], None
    for i, flag in enumerate(near):
        if flag and start is None:
            start = i
        if not flag and start is not None:
            runs.append((start, i - 1)); start = None
    if start is not None:
        runs.append((start, len(near) - 1))
    return [[max(0.0, float(S[a]) - pad), min(length, float(S[b]) + pad)] for a, b in runs]


class TileSet:
    """Collects geometry per tile. Meshes are keyed by node prefix; each node has one material."""

    def __init__(self):
        self.meshes = defaultdict(lambda: defaultdict(list))      # tile -> node -> [Mesh]
        self.instances = defaultdict(lambda: defaultdict(dict))   # tile -> node -> {"positions","yaws","halfExtents","mesh"}
        self.boxes = defaultdict(list)                            # tile -> [[cx,cy,cz,hx,hy,hz,yaw]]
        self.extras = defaultdict(dict)                           # tile -> node -> extras dict

    def add_mesh(self, node, mesh, tile=None):
        if mesh is None or mesh.is_empty():
            return
        if tile is not None:
            self.meshes[tile][node].append(mesh); return
        for key, part in split_by_tile(mesh, tile_of).items():
            self.meshes[key][node].append(part)

    def add_box_collider(self, center, half, yaw):
        self.boxes[tile_of(center[0], center[2])].append([*map(float, center), *map(float, half), float(yaw)])

    def add_instance(self, node, position, yaw, mesh, half_extents, scale=None):
        """One placement of `mesh`. `scale` lets one authored mesh serve several sizes, which is how
        a single unit quad becomes every billboard face; it is written per instance, so half_extents
        (which are per node) describe the unscaled mesh and the runtime scales them."""
        tile = tile_of(position[0], position[2])
        inst = self.instances[tile][node]
        inst.setdefault("positions", []).append([float(v) for v in position])
        inst.setdefault("yaws", []).append(float(yaw))
        inst.setdefault("scales", []).append([float(v) for v in (scale or (1.0, 1.0, 1.0))])
        inst["mesh"] = mesh
        inst["halfExtents"] = [float(v) for v in half_extents]

    def tiles(self):
        return sorted(set(self.meshes) | set(self.instances) | set(self.boxes))

    def merged(self, tile):
        return {node: merge(parts) for node, parts in self.meshes[tile].items()}

    def bounds(self, tile):
        pts = [m.positions for m in self.merged(tile).values() if not m.is_empty()]
        for inst in self.instances[tile].values():
            pts.append(np.asarray(inst["positions"], dtype=np.float32))
        if not pts:
            x0, z0, x1, z1 = tile_rect(*tile)
            return [[x0, 0.0, z0], [x1, 0.0, z1]]
        allp = np.vstack(pts)
        return [allp.min(axis=0).tolist(), allp.max(axis=0).tolist()]
