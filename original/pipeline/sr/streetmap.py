""
import json
import os

import numpy as np
from shapely.geometry import LineString

# what a road is drawn as, by OSM class. Three weights is all a small canvas can tell apart.
CLASSES = {
    "motorway": "a", "trunk": "a",
    "primary": "b", "secondary": "b",
}
SKIP = {"footway", "path", "steps", "cycleway", "pedestrian", "track", "bridleway", "corridor"}
SIMPLIFY = 4.0        # metres: the error a line may pick up when its points are thinned
MIN_LENGTH = 25.0     # metres: shorter ways are junction stubs and only add noise


def road_class(highway):
    return CLASSES.get(str(highway).replace("_link", ""), "c")


def street_map(res, line=None):
    """Roads near the route as `{class, name, points}`, plus the racing line and the bounds.

    Coordinates are the game's own local metres, rounded to whole ones and stored as flat pairs:
    a small map cannot draw a centimetre, and the difference is a third of the file size."""
    roads = []
    for w in res.ways:
        hw = str(w.highway).replace("_link", "")
        if hw in SKIP:
            continue
        xy = np.asarray(w.xy, dtype=float)
        if len(xy) < 2:
            continue
        geom = LineString(xy)
        if geom.length < MIN_LENGTH:
            continue
        pts = np.asarray(geom.simplify(SIMPLIFY).coords).round().astype(int)
        entry = {"c": road_class(w.highway), "p": [int(v) for v in pts.reshape(-1)]}
        if w.name:
            entry["n"] = w.name
        roads.append(entry)

    if line is None:
        line = res.P[:, [0, 2]]
    racing = np.asarray(LineString(np.asarray(line, dtype=float)).simplify(SIMPLIFY).coords)
    racing = racing.round().astype(int)

    xs = [p for r in roads for p in r["p"][0::2]] or [0]
    zs = [p for r in roads for p in r["p"][1::2]] or [0]
    return {
        "bounds": [int(min(xs)), int(min(zs)), int(max(xs)), int(max(zs))],
        "roads": roads,
        "line": [int(v) for v in racing.reshape(-1)],
        "closed": bool(res.closed),
    }


def write(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    return os.path.getsize(path)
