"""The one reader for hand-built landmark metadata and OSM-derived footprints."""
import json
import os

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "landmarks.json")


def entries(path=None):
    path = path or PATH
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return {entry["id"]: entry for entry in json.load(f).get("landmarks", [])}


def footprints(frame, path=None, names=None):
    """Valid local polygons for named landmarks; unnamed calls retain the old all-entry behaviour."""
    import numpy as np
    from shapely.geometry import Polygon

    selected = set(names) if names is not None else None
    out = []
    for name, entry in entries(path).items():
        if selected is not None and name not in selected:
            continue
        ring = entry.get("footprint") or []
        if len(ring) < 3:
            continue
        x, z = frame.to_local([p[0] for p in ring], [p[1] for p in ring])
        poly = Polygon(np.stack([x, z], axis=1))
        if poly.is_valid and poly.area > 0:
            out.append(poly)
    return out


def model_anchor(entry):
    """The geographic pivot shared by authored GLBs and their runtime placement."""
    ring = entry.get("footprint")
    if not ring:
        return float(entry["lat"]), float(entry["lon"])
    import numpy as np
    from shapely.geometry import Polygon
    from sr.geo import LocalFrame
    frame = LocalFrame(*ring[0])
    x, z = frame.to_local(*np.asarray(ring).T)
    centre = Polygon(np.c_[x, z]).centroid
    lat, lon = frame.to_latlon(centre.x, centre.y)
    return float(lat), float(lon)
