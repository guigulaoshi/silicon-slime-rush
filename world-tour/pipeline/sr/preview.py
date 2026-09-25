"""Top-down PNG of a track for eyeballing: tiles, terrain, buildings, spline, checkpoints, barriers, start."""
import os

import numpy as np
from PIL import Image, ImageDraw

from sr.tiles import TILE


ROAD_COLORS = {"motorway": (120, 90, 60), "trunk": (110, 90, 60), "primary": (100, 95, 70), "secondary": (90, 95, 80),
               "tertiary": (85, 90, 85), "residential": (70, 74, 80), "service": (58, 62, 68), "unclassified": (75, 78, 82)}


def render_preview(track, tileset, path, size=1600, margin=80.0, roads=None, snapped=None):
    """roads: optional list of (highway, (n,2) xz) polylines drawn under everything; snapped: waypoint xz list."""
    P = np.asarray(track["spline"]["points"])
    lo = P.min(axis=0) - margin; hi = P.max(axis=0) + margin
    for tile in (tileset.tiles() if tileset else []):
        b = tileset.bounds(tile); lo = np.minimum(lo, b[0]); hi = np.maximum(hi, b[1])
    w, h = hi[0] - lo[0], hi[2] - lo[2]
    scale = size / max(w, h)
    img = Image.new("RGB", (int(w * scale) + 1, int(h * scale) + 1), (24, 28, 34))
    d = ImageDraw.Draw(img)

    def px(x, z):
        return ((x - lo[0]) * scale, (z - lo[2]) * scale)

    if roads:
        for hw, xz in roads:
            col = ROAD_COLORS.get(hw.replace("_link", ""), (60, 64, 70))
            pts_r = [px(x, z) for x, z in xz]
            if len(pts_r) > 1:
                d.line(pts_r, fill=col, width=2 if hw in ("motorway", "trunk", "primary") else 1)
    c0, r0 = int(np.floor(lo[0] / TILE)), int(np.floor(lo[2] / TILE))
    c1, r1 = int(np.floor(hi[0] / TILE)), int(np.floor(hi[2] / TILE))
    for c in range(c0, c1 + 1):
        for r in range(r0, r1 + 1):
            a = px(c * TILE, r * TILE); b = px((c + 1) * TILE, (r + 1) * TILE)
            fill = (40, 48, 40) if (tileset and (c, r) in tileset.meshes) else None
            d.rectangle([a, b], outline=(60, 66, 74), fill=fill)
            d.text((a[0] + 4, a[1] + 4), f"{c},{r}", fill=(110, 118, 126))
    for tile in (tileset.tiles() if tileset else []):
        for node, mesh in tileset.merged(tile).items():
            col = {"buildings": (150, 150, 148), "water": (40, 90, 140), "bridge": (120, 120, 125)}.get(node)
            if col is None or mesh.is_empty():
                continue
            tri = mesh.positions[mesh.indices.reshape(-1, 3)]
            for t in tri:
                d.polygon([px(v[0], v[2]) for v in t], fill=col)
        for node, inst in tileset.instances[tile].items():
            for p in inst.get("positions", []):
                x, z = px(p[0], p[2]); d.ellipse([x - 3, z - 3, x + 3, z + 3], fill=(255, 120, 20))
    pts = [px(p[0], p[2]) for p in P]
    if track["spline"]["closed"]:
        pts.append(pts[0])
    d.line(pts, fill=(235, 235, 235), width=3)
    for i, cp in enumerate(track["checkpoints"]):
        x, z = px(cp["pos"][0], cp["pos"][2]); dx, dz = cp["dir"][0], cp["dir"][2]
        rx, rz = -dz * cp["halfWidth"] * scale * 1.5, dx * cp["halfWidth"] * scale * 1.5
        col = (255, 70, 70) if cp.get("stop") else (80, 220, 120)
        d.line([(x - rx, z - rz), (x + rx, z + rz)], fill=col, width=4)
        d.text((x + 6, z + 6), str(i), fill=col)
    for wx, wz in (snapped or []):
        x, z = px(wx, wz); d.ellipse([x - 5, z - 5, x + 5, z + 5], outline=(255, 220, 80), width=2)
    sx, sz = px(track["start"]["pos"][0], track["start"]["pos"][2])
    d.ellipse([sx - 6, sz - 6, sx + 6, sz + 6], outline=(90, 160, 255), width=3)
    d.text((8, img.height - 16), f"{track['id']}  length {track['spline']['length']:.0f} m  north up", fill=(200, 200, 200))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    return path
