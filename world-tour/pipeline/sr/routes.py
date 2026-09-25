"""Route definition files: pipeline/routes/<id>.json."""
import json
import math
import os

ROUTES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routes")
CACHE_DIR = os.path.join(os.path.dirname(ROUTES_DIR), "cache")


def load_route(route_id):
    with open(os.path.join(ROUTES_DIR, f"{route_id}.json"), encoding="utf-8") as f:
        return json.load(f)


def all_route_ids():
    return sorted(f[:-5] for f in os.listdir(ROUTES_DIR) if f.endswith(".json"))


def corridor_points(route):
    """Lat/lon pairs defining the corridor for fetching. Waypoints given as road-name selectors cannot be
    resolved before the data exists, so a route using them must list bboxPoints covering the same ground."""
    pts = []
    for w in route["waypoints"]:
        if isinstance(w, (list, tuple)):
            pts.append(tuple(w))
        elif w.get("pick", "").startswith("nearest:"):
            pts.append(tuple(float(v) for v in w["pick"].split(":")[1].split(",")))
    pts += [tuple(w) for w in route.get("bboxPoints", [])]
    if not pts:
        raise ValueError(f"route {route['id']}: no coordinate waypoints and no bboxPoints")
    return pts


def bbox(route, pad_m):
    """(south, west, north, east) around the corridor points, padded in meters."""
    pts = corridor_points(route)
    lats = [p[0] for p in pts]; lons = [p[1] for p in pts]
    lat0 = sum(lats) / len(lats)
    dlat = pad_m / 111_320.0
    dlon = pad_m / (111_320.0 * math.cos(math.radians(lat0)))
    return (min(lats) - dlat, min(lons) - dlon, max(lats) + dlat, max(lons) + dlon)


def fetch_boxes(route, pad_m):
    """Long routes fetch a chain of padded segments instead of the whole peninsula rectangle."""
    if not route.get("corridorFetch"):
        return [bbox(route, pad_m)]
    pts = corridor_points(route)
    return [bbox({"waypoints": [a, b]}, pad_m) for a, b in zip(pts, pts[1:])]
