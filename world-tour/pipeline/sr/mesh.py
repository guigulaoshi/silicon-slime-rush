"""Minimal triangle mesh container and generators used by the pipeline."""
from dataclasses import dataclass, field

import numpy as np


RIBBON_UV_METRES = 4.0
""

BUILDING_UV_METRES = 3.0
""


def _ground_direction(direction):
    """Return a non-zero (x, z) direction from either a 2D or 3D vector."""
    d = np.asarray(direction, dtype=np.float64).reshape(-1)
    if len(d) == 2:
        x, z = d
    elif len(d) == 3:
        x, z = d[0], d[2]
    else:
        raise ValueError("a ground direction must have two or three components")
    if np.hypot(x, z) < 1e-9:
        raise ValueError("cannot orient geometry along a zero direction")
    return float(x), float(z)


def yaw_for_x_axis(direction):
    """Yaw that sends a mesh's local +x axis along a world-ground direction.

    ``box`` and glTF/Three.js use ``(cos(yaw), -sin(yaw))`` for local +x. Keeping this
    conversion here prevents the common quarter-turn error caused by assuming ``(cos, sin)``.
    """
    x, z = _ground_direction(direction)
    return float(np.arctan2(-z, x))


def yaw_for_z_axis(direction):
    """Yaw that sends a mesh's local +z axis along a world-ground direction."""
    x, z = _ground_direction(direction)
    return float(np.arctan2(x, z))


@dataclass
class Mesh:
    positions: np.ndarray  # (N,3) float32
    normals: np.ndarray    # (N,3) float32
    uvs: np.ndarray        # (N,2) float32
    indices: np.ndarray    # (M,) uint32, triangles
    material: str = "building"
    facade: np.ndarray | None = None  # (N,2): stable building seed / 1024, residential flag

    def __post_init__(self):
        self.positions = np.asarray(self.positions, dtype=np.float32).reshape(-1, 3)
        self.normals = np.asarray(self.normals, dtype=np.float32).reshape(-1, 3)
        self.uvs = np.asarray(self.uvs, dtype=np.float32).reshape(-1, 2)
        self.indices = np.asarray(self.indices, dtype=np.uint32).reshape(-1)
        if self.facade is not None:
            self.facade = np.asarray(self.facade, dtype=np.float32).reshape(-1, 2)
            if len(self.facade) != len(self.positions):
                raise ValueError("facade metadata must match mesh vertices")

    @property
    def triangle_count(self):
        return len(self.indices) // 3

    def is_empty(self):
        return len(self.indices) == 0

    def bounds(self):
        return self.positions.min(axis=0), self.positions.max(axis=0)


def geometric_normals(P, tris):
    """Unnormalised face normals, (b - a) x (c - a). Their direction is what backface culling reads."""
    P = np.asarray(P, dtype=np.float64).reshape(-1, 3)
    tris = np.asarray(tris, dtype=np.int64).reshape(-1, 3)
    a, b, c = P[tris[:, 0]], P[tris[:, 1]], P[tris[:, 2]]
    return np.cross(b - a, c - a)


def orient_to(P, tris, want):
    """Flip the winding of triangles whose face normal opposes `want` (one vector, or one per triangle).

    Renderers decide which side of a triangle to draw from the winding alone; shading normals do not
    enter into it. A ground mesh wound the wrong way is not dark, it is absent."""
    tris = np.asarray(tris, dtype=np.int64).reshape(-1, 3).copy()
    if len(tris) == 0:
        return tris
    d = np.einsum("ij,ij->i", geometric_normals(P, tris), np.broadcast_to(np.asarray(want, dtype=np.float64), (len(tris), 3)))
    flip = d < 0
    tris[flip] = tris[flip][:, [0, 2, 1]]
    return tris


def orient_by_shading(mesh):
    """Make every triangle face the way its own vertex normals say it should. Returns the mesh."""
    if mesh.is_empty():
        return mesh
    tris = mesh.indices.reshape(-1, 3)
    want = mesh.normals[tris].mean(axis=1)
    mesh.indices = orient_to(mesh.positions, tris, want).reshape(-1).astype(np.uint32)
    return mesh


def merge(meshes, material=None):
    meshes = [m for m in meshes if m is not None and not m.is_empty()]
    if not meshes:
        return Mesh(np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0, 2)), np.zeros(0), material or "building")
    pos, nor, uv, idx, off = [], [], [], [], 0
    for m in meshes:
        pos.append(m.positions); nor.append(m.normals); uv.append(m.uvs); idx.append(m.indices + off)
        off += len(m.positions)
    facade = None
    if any(m.facade is not None for m in meshes):
        facade = np.vstack([m.facade if m.facade is not None else np.zeros((len(m.positions), 2))
                            for m in meshes])
    return Mesh(np.vstack(pos), np.vstack(nor), np.vstack(uv), np.concatenate(idx),
                material or meshes[0].material, facade)


def ribbon(P, R, half_widths, y_offset=0.0, closed=False, uv_scale=RIBBON_UV_METRES,
           material="road", S=None,
           edge_y=None, cross_step=None):
    """A strip along polyline P with right vectors R and per-point half widths.

    By default both edges sit at the centreline height. That is what a racing surface wants: it is
    a designed plane, deliberately flat across so the car does not slide sideways on a cross slope,
    and the terrain is blended up to meet it.

    `edge_y` is for the ribbons that have to do the opposite and follow the ground -- side roads
    and pavements. Given `(left_y, right_y)` each edge takes its own height. Without it, a nine
    metre street drawn across a twenty percent cross slope has its uphill half nearly two metres
    inside the hill, which is how a road ends up buried under a green field.

    `cross_step` adds intermediate rows across a wide strip. A two-vertex cross section is enough
    for paint and level ground, but a climbing hairpin twists each full-width quad: its two large
    triangles meet at a ridge under the wheels. Dividing only the width preserves the same road
    outline and smooth surface while keeping those collider facets smaller.
    """
    P = np.asarray(P, dtype=np.float64); R = np.asarray(R, dtype=np.float64)
    hw = np.asarray(half_widths, dtype=np.float64).reshape(-1)
    n = len(P)
    columns = max(1, int(np.ceil(2 * float(np.max(hw)) / cross_step))) if cross_step else 1
    across = np.linspace(-1.0, 1.0, columns + 1)
    pos = P[:, None, :] + R[:, None, :] * (hw[:, None, None] * across[None, :, None])
    if edge_y is None:
        pos[:, :, 1] = P[:, None, 1] + y_offset
    else:
        left_y = np.asarray(edge_y[0], dtype=np.float64)
        right_y = np.asarray(edge_y[1], dtype=np.float64)
        amount = (across + 1.0) / 2.0
        pos[:, :, 1] = left_y[:, None] * (1 - amount) + right_y[:, None] * amount + y_offset
    pos = pos.reshape(-1, 3)
    if S is None:
        S = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    uv = np.empty((n, columns + 1, 2))
    uv[:, :, 0] = np.asarray(S)[:, None] / uv_scale
    # across the strip in metres, signed from the centreline -- see RIBBON_UV_METRES
    uv[:, :, 1] = hw[:, None] * across[None, :] / uv_scale
    uv = uv.reshape(-1, 2)
    nor = np.tile(np.array([0.0, 1.0, 0.0]), (len(pos), 1))
    segs = n if closed else n - 1
    tri = []
    for i in range(segs):
        j = (i + 1) % n
        for column in range(columns):
            a = i * (columns + 1) + column
            b = a + 1
            c = j * (columns + 1) + column
            d = c + 1
            tri += [a, c, b, b, c, d]
    return orient_by_shading(Mesh(pos, nor, uv, np.array(tri), material))


def wall(base, height, material="barrier", uv_scale=2.0, closed=False):
    ""
    base = np.asarray(base, dtype=np.float64)
    n = len(base)
    top = base.copy(); top[:, 1] += height
    pos = np.empty((2 * n, 3)); pos[0::2] = base; pos[1::2] = top
    S = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(base[:, [0, 2]], axis=0), axis=1))])
    uv = np.empty((2 * n, 2)); uv[0::2, 0] = S / uv_scale; uv[1::2, 0] = S / uv_scale
    uv[0::2, 1] = 1.0; uv[1::2, 1] = 0.0
    segs = n if closed else n - 1
    tri = []
    for i in range(segs):
        j = (i + 1) % n
        a, b, c, d = 2 * i, 2 * i + 1, 2 * j, 2 * j + 1
        tri += [a, c, b, b, c, d]
    # Flat side normals would light both faces the same; the strip is lit as if it faced the road,
    # which is the side that matters and the only side a player normally sees.
    nor = np.zeros((2 * n, 3))
    d = np.gradient(base[:, [0, 2]], axis=0)
    ln = np.linalg.norm(d, axis=1); ln[ln == 0] = 1.0
    nor[0::2, 0] = -d[:, 1] / ln; nor[0::2, 2] = d[:, 0] / ln
    nor[1::2] = nor[0::2]
    return Mesh(pos, nor, uv, np.array(tri), material)


def box(center, half, yaw=0.0, material="building", uv_scale=BUILDING_UV_METRES):
    """Axis box rotated about y by yaw. 24 vertices with flat normals."""
    cx, cy, cz = center; hx, hy, hz = half
    c, s = np.cos(yaw), np.sin(yaw)
    def rot(x, z):
        return (c * x + s * z, -s * x + c * z)
    faces = [  # normal, four corners (u,v scaled by face size)
        ((0, 1, 0), [(-hx, hy, -hz), (hx, hy, -hz), (hx, hy, hz), (-hx, hy, hz)]),
        ((0, -1, 0), [(-hx, -hy, hz), (hx, -hy, hz), (hx, -hy, -hz), (-hx, -hy, -hz)]),
        ((1, 0, 0), [(hx, -hy, -hz), (hx, -hy, hz), (hx, hy, hz), (hx, hy, -hz)]),
        ((-1, 0, 0), [(-hx, -hy, hz), (-hx, -hy, -hz), (-hx, hy, -hz), (-hx, hy, hz)]),
        ((0, 0, 1), [(hx, -hy, hz), (-hx, -hy, hz), (-hx, hy, hz), (hx, hy, hz)]),
        ((0, 0, -1), [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz)]),
    ]
    pos, nor, uv, idx = [], [], [], []
    for (nx, ny, nz), corners in faces:
        base = len(pos)
        rnx, rnz = rot(nx, nz)
        for k, (x, y, z) in enumerate(corners):
            rx, rz = rot(x, z)
            pos.append((cx + rx, cy + y, cz + rz)); nor.append((rnx, ny, rnz))
            w = (2 * hz if abs(nx) else 2 * hx) / uv_scale; h = (2 * hz if abs(ny) else 2 * hy) / uv_scale
            uv.append(((k in (1, 2)) * w, (k in (2, 3)) * h))
        idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    return orient_by_shading(Mesh(np.array(pos), np.array(nor), np.array(uv), np.array(idx), material))


def pitched_roof(center, half, yaw=0.0, rise=2.4, kind="gable", material="building"):
    """A crisp low-poly gable or hip roof on a rectangular wall top."""
    return merge(pitched_roof_parts(center, half, yaw, rise, kind, material), material)


def pitched_roof_parts(center, half, yaw=0.0, rise=2.4, kind="gable", material="building", end_material=None):
    """The roof, and when `end_material` is given its gable ends and underside as a wall-coloured part.

    A gable end is the house wall carried up to the ridge, not roofing: drawn in slate, the
    rear house's gable seen over a front roofline from down the hill read as a dark floating wedge.
    Hip roofs have no vertical ends, so they stay one part.
    """
    if kind not in ("gable", "hip"):
        raise ValueError(f"unknown roof kind {kind!r}")
    cx, cy, cz = center
    hx, hz = float(half[0]), float(half[1])
    if hx <= 0 or hz <= 0 or rise <= 0:
        raise ValueError("roof dimensions must be positive")
    if hz > hx:                         # the ridge below runs along local x
        hx, hz = hz, hx
        yaw += np.pi / 2
    c, s = np.cos(yaw), np.sin(yaw)

    def world(point):
        x, y, z = point
        return np.array((cx + c * x + s * z, cy + y, cz - s * x + c * z), dtype=np.float64)

    lo = [(-hx, 0.0, -hz), (hx, 0.0, -hz), (hx, 0.0, hz), (-hx, 0.0, hz)]
    inset = max(0.0, hx - hz) if kind == "hip" else hx
    ridge = [(-inset, rise, 0.0), (inset, rise, 0.0)]
    # The underside closes the solid. Without it an eave that overhangs its wall, as an oriented box
    # does around any non-rectangular footprint, showed the sky through the roof from below.
    faces = ([lo[0], lo[1], ridge[1], ridge[0]],
             [lo[3], ridge[0], ridge[1], lo[2]],
             [lo[0], ridge[0], lo[3]], [lo[1], lo[2], ridge[1]],
             list(lo))
    split = end_material is not None and kind == "gable"
    parts = []
    for group, group_material in ((faces[:2], material), (faces[2:], end_material)) if split else ((faces, material),):
        parts.append(_roof_faces(group, world, rise, group_material))
    return parts


def _roof_faces(faces, world, rise, material):
    pos, nor, uv, idx = [], [], [], []
    inside = world((0.0, rise / 3.0, 0.0))
    for face in faces:
        points = [world(p) for p in face]
        # Newell's normal: a square hip collapses its ridge to one point, and the first three corners
        # of a reversed slope then coincide and give a zero cross product.
        normal = sum(np.cross(a, b) for a, b in zip(points, points[1:] + points[:1]))
        # Every face points away from the roof's own interior. Testing only for a downward
        # normal left the vertical gable ends facing inward: from outside the near gable was culled,
        # and through that hole the far gable's inner face showed as a dark floating shard.
        if np.dot(normal, np.mean(points, axis=0) - inside) < 0:
            points.reverse()
            normal = -normal
        normal /= max(np.linalg.norm(normal), 1e-9)
        base = len(pos)
        pos.extend(points); nor.extend([normal] * len(points)); uv.extend([(0.02, 0.02)] * len(points))
        if len(points) == 3:
            idx.extend((base, base + 1, base + 2))
        else:
            idx.extend((base, base + 1, base + 2, base, base + 2, base + 3))
    return orient_by_shading(Mesh(np.asarray(pos), np.asarray(nor), np.asarray(uv), np.asarray(idx), material))


def quad(x0, z0, x1, z1, y=0.0, material="terrain", uv_scale=8.0):
    pos = np.array([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)])
    nor = np.tile(np.array([0.0, 1.0, 0.0]), (4, 1))
    uv = np.array([(x0, z0), (x1, z0), (x1, z1), (x0, z1)]) / uv_scale
    return orient_by_shading(Mesh(pos, nor, uv, np.array([0, 2, 1, 0, 3, 2]), material))


def grid(x0, z0, x1, z1, heights, material="terrain", uv_scale=8.0):
    """Height grid (rows along z, cols along x) as a triangle mesh with smooth normals."""
    H = np.asarray(heights, dtype=np.float64)
    rows, cols = H.shape
    xs = np.linspace(x0, x1, cols); zs = np.linspace(z0, z1, rows)
    X, Z = np.meshgrid(xs, zs)
    pos = np.stack([X.ravel(), H.ravel(), Z.ravel()], axis=1)
    uv = np.stack([X.ravel(), Z.ravel()], axis=1) / uv_scale
    dzdx = np.gradient(H, xs, axis=1); dzdz = np.gradient(H, zs, axis=0)
    nor = np.stack([-dzdx.ravel(), np.ones(rows * cols), -dzdz.ravel()], axis=1)
    nor /= np.linalg.norm(nor, axis=1, keepdims=True)
    idx = []
    for r in range(rows - 1):
        for c in range(cols - 1):
            a = r * cols + c; b = a + 1; d = a + cols; e = d + 1
            idx += [a, e, b, a, d, e]
    return orient_by_shading(Mesh(pos, nor, uv, np.array(idx), material))


def split_by_tile(mesh, tile_of):
    """Split a mesh into per-tile meshes by triangle centroid. tile_of(x, z) -> key."""
    P = mesh.positions; I = mesh.indices.reshape(-1, 3)
    cent = P[I].mean(axis=1)
    keys = [tile_of(float(c[0]), float(c[2])) for c in cent]
    out = {}
    for key in set(keys):
        sel = np.array([k == key for k in keys])
        tris = I[sel]
        used, inv = np.unique(tris, return_inverse=True)
        out[key] = Mesh(P[used], mesh.normals[used], mesh.uvs[used], inv.reshape(-1), mesh.material,
                         None if mesh.facade is None else mesh.facade[used])
    return out

def from_triangles(P, tris, material="terrain", uv_scale=8.0):
    """Mesh from a shared vertex array and triangle indices, with area-weighted smooth normals.
    Unreferenced vertices are dropped and indices remapped."""
    P = np.asarray(P, dtype=np.float64).reshape(-1, 3)
    tris = np.asarray(tris, dtype=np.int64).reshape(-1, 3)
    if len(tris) == 0:
        return Mesh(np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0, 2)), np.zeros(0), material)
    used, inv = np.unique(tris, return_inverse=True)
    V = P[used]
    T = inv.reshape(-1, 3)
    a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    face_n = np.cross(b - a, c - a)  # length is twice the area, so this weights by area
    nor = np.zeros_like(V)
    for k in range(3):
        np.add.at(nor, T[:, k], face_n)
    ln = np.linalg.norm(nor, axis=1, keepdims=True)
    ln[ln == 0] = 1.0
    nor /= ln
    uv = V[:, [0, 2]] / uv_scale
    return Mesh(V, nor, uv, T.reshape(-1), material)


def vertical_strip(top, bottom, material="terrain", uv_scale=RIBBON_UV_METRES, flip=False, closed=False):
    """A wall between two matching polylines: `top` above, `bottom` below, one quad per segment.

    The default is the ribbon's scale rather than a 4.0 of its own, because these walls are the
    edges of ribbons -- the road skirt, the kerb face under a sidewalk -- and they wear the same
    material as the ribbon beside them. One tiling texture covers both, so the two have to agree on
    metres per u or the joints in one stop lining up with the joints in the other.

    `flip` chooses which side the wall faces: walls beside a road face the road. `closed` joins the
    last point back to the first, which is what the skirt of a circuit needs."""
    top = np.asarray(top, dtype=np.float64); bottom = np.asarray(bottom, dtype=np.float64)
    n = len(top)
    if n < 2:
        return Mesh(np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0, 2)), np.zeros(0), material)
    pos = np.empty((2 * n, 3)); pos[0::2] = top; pos[1::2] = bottom
    run = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(top[:, [0, 2]], axis=0), axis=1))])
    uv = np.empty((2 * n, 2))
    uv[0::2, 0] = run / uv_scale; uv[1::2, 0] = run / uv_scale
    uv[0::2, 1] = 0.0; uv[1::2, 1] = np.abs(top[:, 1] - bottom[:, 1]) / uv_scale
    # horizontal outward normal, perpendicular to the run
    d = np.gradient(top[:, [0, 2]], axis=0)
    ln = np.linalg.norm(d, axis=1, keepdims=True); ln[ln == 0] = 1.0
    d = d / ln
    face = np.stack([-d[:, 1], np.zeros(n), d[:, 0]], axis=1) * (-1.0 if flip else 1.0)
    nor = np.empty((2 * n, 3)); nor[0::2] = face; nor[1::2] = face
    tri = []
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        a, b, c, d2 = 2 * i, 2 * i + 1, 2 * j, 2 * j + 1
        tri += [a, c, b, b, c, d2]
    return orient_by_shading(Mesh(pos, nor, uv, np.array(tri), material))
