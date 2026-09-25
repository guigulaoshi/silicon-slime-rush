"""Terrarium elevation tiles (Mapzen / AWS Open Data) at zoom 15, cached under cache/dem/15/x/y.png.

Decoding: height_m = R * 256 + G + B / 256 - 32768."""
import math
import os
import sys
import time
import urllib.request

import numpy as np
from PIL import Image

from sr.routes import CACHE_DIR, bbox, fetch_boxes, load_route

ZOOM = 15
# The distant scenery is sampled every sixty metres or so, and a zoom 15 tile is five metres a
# pixel: covering a six kilometre radius at that detail would be three hundred tiles of data
# nobody can see. Zoom 12 is about forty metres a pixel and six tiles.
BACKDROP_ZOOM = 12
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_xy(lat, lon, z=ZOOM):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2.0 * n)
    return x, y


def tile_bounds_deg(x, y, z=ZOOM):
    """(south, west, north, east) of a slippy tile."""
    n = 2 ** z
    west = x / n * 360.0 - 180.0; east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return south, west, north, east


def tiles_for_bbox(s, w, n, e, z=ZOOM):
    x0, y0 = tile_xy(n, w, z); x1, y1 = tile_xy(s, e, z)
    return [(x, y) for x in range(min(x0, x1), max(x0, x1) + 1) for y in range(min(y0, y1), max(y0, y1) + 1)]


def tile_path(x, y, z=ZOOM):
    return os.path.join(CACHE_DIR, "dem", str(z), str(x), f"{y}.png")


def fetch_tile(x, y, z=ZOOM, log=print, force=False):
    path = tile_path(x, y, z)
    if os.path.exists(path) and not force:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(URL.format(z=z, x=x, y=y), timeout=60) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            return path
        except Exception as ex:  # noqa: BLE001
            log(f"  dem {z}/{x}/{y} attempt {attempt + 1}: {ex}"); time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"dem tile {z}/{x}/{y} failed")


def fetch_route(route_id, log=print, force=False):
    route = load_route(route_id)
    tiles = sorted({tile for box in fetch_boxes(route, route.get("padM", 300) + 200)
                    for tile in tiles_for_bbox(*box)})
    log(f"dem {route_id}: {len(tiles)} tiles at z{ZOOM}")
    for x, y in tiles:
        fetch_tile(x, y, log=log, force=force)
    tiles += fetch_backdrop(route_id, log=log, force=force)
    return tiles


def fetch_backdrop(route_id, log=print, force=False):
    """Coarse elevation out to the backdrop radius, for the land you can see but never drive on."""
    route = load_route(route_id)
    from sr.horizon import RADIUS, FETCH_MARGIN
    radius = max(route.get("backdropM", 3000), RADIUS + FETCH_MARGIN)
    tiles = sorted({tile for box in fetch_boxes(route, radius)
                    for tile in tiles_for_bbox(*box, BACKDROP_ZOOM)})
    log(f"dem {route_id} backdrop: {len(tiles)} tiles at z{BACKDROP_ZOOM}")
    for x, y in tiles:
        fetch_tile(x, y, z=BACKDROP_ZOOM, log=log, force=force)
    return tiles


def decode(path):
    """Terrarium PNG -> float32 heights in meters, shape (256, 256)."""
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    return a[:, :, 0] * 256.0 + a[:, :, 1] + a[:, :, 2] / 256.0 - 32768.0


if __name__ == "__main__":
    fetch_route(sys.argv[1], force="--force" in sys.argv)
