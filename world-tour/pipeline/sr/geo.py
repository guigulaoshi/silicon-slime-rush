"""Geographic projection: lat/lon <-> local Three.js meters (x east, y up, z south) around a route origin."""
import numpy as np
from pyproj import Transformer


class LocalFrame:
    def __init__(self, lat, lon):
        self.lat, self.lon = float(lat), float(lon)
        proj = f"+proj=aeqd +lat_0={self.lat} +lon_0={self.lon} +datum=WGS84 +units=m +no_defs"
        self._fwd = Transformer.from_crs("EPSG:4326", proj, always_xy=True)
        self._inv = Transformer.from_crs(proj, "EPSG:4326", always_xy=True)

    def to_local(self, lat, lon):
        """Arrays or scalars of lat/lon -> (x, z) with x east and z south."""
        e, n = self._fwd.transform(np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
        return np.asarray(e), -np.asarray(n)

    def to_latlon(self, x, z):
        lon, lat = self._inv.transform(np.asarray(x, dtype=float), -np.asarray(z, dtype=float))
        return np.asarray(lat), np.asarray(lon)

    def local_bbox(self, south, west, north, east):
        xs, zs = self.to_local([south, north, south, north], [west, west, east, east])
        return float(xs.min()), float(zs.min()), float(xs.max()), float(zs.max())
