"""Bilinear elevation sampling from cached Terrarium tiles, vectorised over point arrays."""
import math
import os

import numpy as np

from sr.fetch_dem import BACKDROP_ZOOM, ZOOM, decode, tile_path


class DemSampler:
    """Samples cached Terrarium tiles.

    A point whose fine tile was never downloaded falls back to the coarse backdrop tiles, which cover
    tens of kilometres round every route. Only a point neither covers reads 0 m -- and 0 m is exactly
    what the sea reads, so anything deciding "is this water" asks `known()` first: one remix turned
    five rivers into sea because the tiles under them had simply not been fetched."""

    def __init__(self, zoom=ZOOM, require_complete=False, fallback_zoom=BACKDROP_ZOOM):
        self.zoom = zoom
        self.require_complete = require_complete
        self._tiles = {}
        self._fallback = (DemSampler(fallback_zoom, False, None)
                          if fallback_zoom is not None and fallback_zoom != zoom and not require_complete else None)

    def _tile(self, x, y):
        key = (x, y)
        if key not in self._tiles:
            p = tile_path(x, y, self.zoom)
            if self.require_complete and not os.path.exists(p):
                raise FileNotFoundError(f"missing required elevation tile: {p}; run sr fetch <route>")
            self._tiles[key] = decode(p) if os.path.exists(p) else None
        return self._tiles[key]

    def _pixel_coords(self, lat, lon):
        """Global pixel coordinates at this zoom: 256 px per tile."""
        lat = np.clip(np.asarray(lat, dtype=np.float64), -85.05, 85.05)
        lon = np.asarray(lon, dtype=np.float64)
        n = 2 ** self.zoom
        px = (lon + 180.0) / 360.0 * n * 256.0
        lat_r = np.radians(lat)
        py = (1.0 - np.log(np.tan(lat_r) + 1.0 / np.cos(lat_r)) / np.pi) / 2.0 * n * 256.0
        return px, py

    def heights(self, lat, lon):
        """Bilinear elevation in meters for arrays of lat/lon, grouped by tile so each tile decodes once."""
        out = self._heights(lat, lon)
        if self._fallback is not None:
            have = self._covered(lat, lon)
            if not have.all():
                lat_a = np.broadcast_to(np.asarray(lat, dtype=np.float64), out.shape)
                lon_a = np.broadcast_to(np.asarray(lon, dtype=np.float64), out.shape)
                out = np.where(have, out, self._fallback._heights(lat_a, lon_a))
        return out

    def known(self, lat, lon):
        """True where the elevation comes from a downloaded tile (fine or coarse), not a default 0."""
        have = self._covered(lat, lon)
        if self._fallback is not None:
            have = have | self._fallback._covered(lat, lon)
        return have

    def _covered(self, lat, lon):
        px, py = self._pixel_coords(lat, lon)
        tx = np.floor_divide(np.floor(px).astype(np.int64), 256)
        ty = np.floor_divide(np.floor(py).astype(np.int64), 256)
        keys = np.stack([tx, ty], axis=-1).reshape(-1, 2)
        uniq, inverse = np.unique(keys, axis=0, return_inverse=True)
        ok = np.array([self._tile(int(x), int(y)) is not None for x, y in uniq], dtype=bool)
        return ok[inverse.reshape(-1)].reshape(np.shape(px))

    def _heights(self, lat, lon):
        px, py = self._pixel_coords(lat, lon)
        out = np.zeros(px.shape, dtype=np.float64)
        # bilinear on the global pixel grid: sample centers sit at +0.5
        fx = px - 0.5
        fy = py - 0.5
        x0 = np.floor(fx).astype(np.int64)
        y0 = np.floor(fy).astype(np.int64)
        wx = fx - x0
        wy = fy - y0
        for dy in (0, 1):
            for dx in (0, 1):
                gx = x0 + dx
                gy = y0 + dy
                w = (wx if dx else 1 - wx) * (wy if dy else 1 - wy)
                out += w * self._gather(gx, gy)
        return out

    def _gather(self, gx, gy):
        """Elevation at integer global pixel coordinates, tile by tile."""
        tx = np.floor_divide(gx, 256)
        ty = np.floor_divide(gy, 256)
        ix = gx - tx * 256
        iy = gy - ty * 256
        vals = np.zeros(gx.shape, dtype=np.float64)
        keys = np.stack([tx, ty], axis=-1).reshape(-1, 2)
        uniq, inverse = np.unique(keys, axis=0, return_inverse=True)
        flat = vals.reshape(-1)
        fix = ix.reshape(-1)
        fiy = iy.reshape(-1)
        for k, (x, y) in enumerate(uniq):
            t = self._tile(int(x), int(y))
            if t is None:
                continue
            sel = inverse == k
            flat[sel] = t[fiy[sel], fix[sel]]
        return vals

    def height(self, lat, lon):
        return float(self.heights(np.array([lat]), np.array([lon]))[0])
