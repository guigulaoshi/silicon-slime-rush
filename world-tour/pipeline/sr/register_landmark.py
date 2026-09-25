"""Register a GLB landmark from its OSM outline: `python -m sr.register_landmark <route> <id> <osm type> <osm id> ...`,
or, for an object the map has only as a node, `... <route> <id> point <lat>,<lon> --size W,D [--yaw deg]`.

pipeline/landmarks.json is one shared file and several modelling agents work at once, so every write
goes through here, under a file lock: read, change one entry, write, release. The footprint is copied
from the route's own cached OSM element (outer ring), so the model, the pipeline's exclusion of the
ordinary OSM building and the build's clearance checks all use the same outline."""
import argparse
import fcntl
import gzip
import json
import os

import numpy as np

from sr.fetch_osm import load_layer
from sr.geo import LocalFrame
from sr.landmark_data import PATH
from sr.routes import ROUTES_DIR, load_route


def outline(route_id, osm_type, osm_id):
    """Outer ring (lat, lon) of a cached OSM way or multipolygon relation, largest part."""
    from sr.buildings import element_polygons
    route = load_route(route_id)
    frame = LocalFrame(route["origin"]["lat"], route["origin"]["lon"])
    for layer in ("buildings", "landuse", "backdrop"):
        try:
            elements = load_layer(route_id, layer)["elements"]
        except FileNotFoundError:
            continue
        for e in elements:
            if e.get("type") == osm_type and int(e.get("id", -1)) == int(osm_id):
                polys = element_polygons(e, frame)
                if not polys:
                    raise ValueError(f"{osm_type} {osm_id}: no polygon")
                poly = max(polys, key=lambda p: p.area)
                x, z = np.asarray(poly.exterior.coords).T
                lat, lon = frame.to_latlon(x, z)
                return [[round(float(a), 7), round(float(b), 7)] for a, b in zip(lat, lon)], e.get("tags", {})
    raise ValueError(f"{route_id}: {osm_type} {osm_id} is not in the cached layers")


def point_outline(route_id, lat, lon, width, depth, yaw_deg=0.0):
    """A width x depth rectangle round a point, for an object the map has only as a node (a statue, a
    stupa gate): the outline the pipeline clears and checks is then the object's own measured base."""
    route = load_route(route_id)
    frame = LocalFrame(route["origin"]["lat"], route["origin"]["lon"])
    cx, cz = frame.to_local(lat, lon)
    a = np.radians(yaw_deg)
    u, v = np.array([np.cos(a), -np.sin(a)]), np.array([np.sin(a), np.cos(a)])   # east-ish, south-ish
    corners = [np.array([float(cx), float(cz)]) + u * su * width / 2 + v * sv * depth / 2
               for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1))]
    lat_, lon_ = frame.to_latlon(np.array([c[0] for c in corners]), np.array([c[1] for c in corners]))
    return [[round(float(a), 7), round(float(b), 7)] for a, b in zip(lat_, lon_)], {}


def register(route_id, ident, osm_type, osm_id, height, load_radius, collision=True, extra=None, size=None, yaw=0.0):
    if osm_type == "point":
        lat, lon = (float(v) for v in str(osm_id).split(","))
        if not size:
            raise ValueError("a point landmark needs --size WIDTH,DEPTH in metres")
        ring, tags = point_outline(route_id, lat, lon, size[0], size[1], yaw)
    else:
        ring, tags = outline(route_id, osm_type, osm_id)
    entry = {"id": ident, "kind": "glb", "file": f"../../models/landmarks/{ident}.glb",
             "loadRadius": float(load_radius), "heightM": float(height),
             "source": (f"measured base round {osm_id}" if osm_type == "point" else
                        f"OpenStreetMap {osm_type} {osm_id}" + (f" ({tags.get('name')})" if tags.get("name") else "")),
             "footprint": ring}
    if not collision:
        entry["collision"] = False
    entry.update(extra or {})
    with open(PATH + ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = json.load(open(PATH, encoding="utf-8")) if os.path.exists(PATH) else {"landmarks": []}
        data["landmarks"] = [e for e in data["landmarks"] if e["id"] != ident] + [entry]
        with open(PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
        route_path = os.path.join(ROUTES_DIR, f"{route_id}.json")
        route = json.load(open(route_path, encoding="utf-8"))
        names = route.get("landmarks", [])
        if ident not in names:
            route["landmarks"] = names + [ident]
            with open(route_path, "w", encoding="utf-8") as f:
                json.dump(route, f, ensure_ascii=False, indent=1)
        fcntl.flock(lock, fcntl.LOCK_UN)
    return entry


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("route"); ap.add_argument("id"); ap.add_argument("osm_type"); ap.add_argument("osm_id")
    ap.add_argument("--height", type=float, required=True)
    ap.add_argument("--load-radius", type=float, default=1800)
    ap.add_argument("--no-collision", action="store_true")
    ap.add_argument("--level-ground", action="store_true",
                    help="stand it on a level pad: the elevation data reads the building itself as a hill")
    ap.add_argument("--size", help="osm_type point only: WIDTH,DEPTH of the base in metres (osm_id is LAT,LON)")
    ap.add_argument("--yaw", type=float, default=0.0, help="osm_type point only: degrees the base is turned from east")
    a = ap.parse_args()
    size = [float(v) for v in a.size.split(",")] if a.size else None
    e = register(a.route, a.id, a.osm_type, a.osm_id, a.height, a.load_radius, not a.no_collision, size=size, yaw=a.yaw,
                 extra={"levelGround": True} if a.level_ground else None)
    print(a.id, len(e["footprint"]), "points,", e["source"])
