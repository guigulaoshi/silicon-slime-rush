"""Pull OpenStreetMap data for a route into cache/<route>/ via Overpass, with mirror rotation and backoff.

Two layers. The corridor layer is everything within padM of the waypoint bbox, split into four
queries so each stays small. The backdrop layer is a wider bbox with only tall buildings, major
roads and the coastline. Responses are raw Overpass JSON with inline geometry, gzip-compressed,
and committed so generation never needs the network again."""
import gzip
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from sr.routes import CACHE_DIR, bbox, corridor_points, load_route

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
TIMEOUT = 180

CORRIDOR = {
    # Airfield routes share the road renderer and closure logic. Runways and taxiways are linear
    # OSM ways just like roads; aprons stay in landuse because their closed polygons are scenery,
    # not graph edges.
    "roads": '(way["highway"]({bb});way["aeroway"~"^(runway|taxiway)$"]({bb}););out geom;',
    "buildings": '(way["building"]({bb});relation["building"]({bb}););out geom;',
    "landuse": '(way["landuse"]({bb});relation["landuse"]({bb});way["natural"]({bb});relation["natural"]({bb});'
               'way["leisure"]({bb});relation["leisure"]({bb});way["amenity"="parking"]({bb});'
               'relation["amenity"="parking"]({bb});way["aeroway"="apron"]({bb});'
               'relation["aeroway"="apron"]({bb});way["waterway"]({bb}););out geom;',
    "trees": '(node["natural"="tree"]({bb});way["natural"="tree_row"]({bb}););out geom;',
}
BACKDROP = {
    "backdrop": '(way["building"]["building:levels"~"^([8-9]|[1-9][0-9]+)$"]({bb});'
                'relation["building"]["building:levels"~"^([8-9]|[1-9][0-9]+)$"]({bb});'
                'way["building"]["height"~"^([2-9][5-9]|[3-9][0-9]|[1-9][0-9]{{2,}})"]({bb});'
                'relation["building"]["height"~"^([2-9][5-9]|[3-9][0-9]|[1-9][0-9]{{2,}})"]({bb});'
                'way["highway"~"^(motorway|trunk|primary)$"]({bb});way["natural"="coastline"]({bb});'
                'relation["natural"="water"]["water"~"^(bay|lagoon|lake|reservoir)$"]({bb}););out geom;',
}


def _query(q, log=print):
    """POST an Overpass query, rotating mirrors with exponential backoff. Returns parsed JSON."""
    delay = 5.0
    mirrors = MIRRORS[:]
    for attempt in range(8):
        url = mirrors[attempt % len(mirrors)]
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(),
                                         headers={"User-Agent": "silicon-rush-pipeline/0.1"})
            with urllib.request.urlopen(req, timeout=TIMEOUT + 30) as r:
                data = json.load(r)
            if "elements" not in data:
                raise RuntimeError("no elements in response")
            if data.get("remark", "").lower().find("error") >= 0:
                raise RuntimeError(data["remark"])
            return data
        except Exception as ex:  # noqa: BLE001
            log(f"  {url.split('/')[2]} attempt {attempt + 1}: {ex}")
            time.sleep(delay + random.uniform(0, 2)); delay = min(delay * 1.8, 90)
    raise RuntimeError("Overpass failed on all mirrors")


def fetch_layer(route, name, template, pad_m, log=print, force=False, box=None):
    out_dir = os.path.join(CACHE_DIR, route["id"])
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{name}.json.gz")
    if os.path.exists(path) and not force and box is None:
        log(f"  {name}: cached"); return path
    s, w, n, e = box if box is not None else bbox(route, pad_m)
    bb = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
    region = bb
    if route.get("corridorFetch"):
        from shapely.geometry import LineString
        from sr.geo import LocalFrame
        import numpy as np
        frame = LocalFrame(route["origin"]["lat"], route["origin"]["lon"])
        lat, lon = np.array(corridor_points(route)).T
        x, z = frame.to_local(lat, lon)
        polygon = LineString(np.c_[x, z]).buffer(pad_m).simplify(10)
        coords = np.asarray(polygon.exterior.coords)
        lat, lon = frame.to_latlon(coords[:, 0], coords[:, 1])
        region = 'poly:"' + ' '.join(f'{a:.6f} {b:.6f}' for a, b in zip(lat, lon)) + '"'
    q = f"[out:json][timeout:{TIMEOUT}];" + template.format(bb=region)
    log(f"  {name}: bbox {bb}")
    data = _query(q, log)
    data["_meta"] = {"route": route["id"], "layer": name, "bbox": [s, w, n, e], "fetched": time.strftime("%Y-%m-%d")}
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(data, f)
    log(f"  {name}: {len(data['elements'])} elements, {os.path.getsize(path) // 1024} KB")
    time.sleep(3)
    return path


def fetch_route(route_id, force=False, log=print):
    route = load_route(route_id)
    log(f"fetch {route_id}")
    for name, template in CORRIDOR.items():
        fetch_layer(route, name, template, route.get("padM", 300), log, force)
    for name, template in BACKDROP.items():
        fetch_layer(route, name, template, route.get("backdropM", 3000), log, force)
    extend_to_corridor(route_id, log)


def cached_box(route_id, layer):
    """(south, west, north, east) a cached layer was fetched for, or None."""
    try:
        return tuple(load_layer(route_id, layer)["_meta"]["bbox"])
    except (FileNotFoundError, KeyError):
        return None


def corridor_box(res, pad_m):
    """The lat/lon box round the line that is actually built, padded by the terrain band.

    The line follows real streets and wanders outside the rectangle its waypoints span, so a cache
    fetched round the waypoints can stop short of the corridor the build draws."""
    import numpy as np
    from shapely.geometry import LineString
    poly = LineString(res.P[:, [0, 2]]).buffer(pad_m, quad_segs=4)
    xs, zs = np.asarray(poly.exterior.coords).T
    lat, lon = res.frame.to_latlon(xs, zs)
    return (float(lat.min()), float(lon.min()), float(lat.max()), float(lon.max()))


def shortfall_m(have, need, lat0):
    """How many metres `need` pokes outside `have` on its worst side (0 when covered)."""
    import math
    if have is None:
        return float("inf")
    ky, kx = 111_320.0, 111_320.0 * math.cos(math.radians(lat0))
    return max(0.0, (have[0] - need[0]) * ky, (have[1] - need[1]) * kx,
               (need[2] - have[2]) * ky, (need[3] - have[3]) * kx)


def coverage(route_id, res=None):
    """{layer: metres short} for every corridor layer whose cache does not reach the built corridor."""
    route = load_route(route_id)
    if res is None:
        from sr.route import build_route
        res = build_route(route_id)
    need = corridor_box(res, float(route.get("terrainPadM", 300)))
    lat0 = (need[0] + need[2]) / 2
    out = {}
    for layer in CORRIDOR:
        gap = shortfall_m(cached_box(route_id, layer), need, lat0)
        if gap > 1.0:
            out[layer] = gap
    return out


def extend_to_corridor(route_id, log=print):
    """Re-fetch only the layers that stop short of the built corridor, never shrinking any of them.

    The new box is the union of the old box, the waypoint box and the corridor: fetching only the new
    area threw away everything the old cache held elsewhere -- one route dropped from 15214 buildings
    to 1139 -- and re-fetched streets can reroute the line, so look at the preview again afterwards."""
    route = load_route(route_id)
    try:
        short = coverage(route_id)
    except Exception as ex:  # noqa: BLE001 -- a route that does not build yet cannot be measured
        log(f"  coverage: not measured ({ex})")
        return {}
    if not short:
        log("  coverage: every layer reaches the built corridor")
        return {}
    from sr.route import build_route
    need = corridor_box(build_route(route_id), float(route.get("terrainPadM", 300)))
    wp = bbox(route, route.get("padM", 300))
    for layer, gap in short.items():
        old = cached_box(route_id, layer) or need
        box = (min(old[0], wp[0], need[0]), min(old[1], wp[1], need[1]),
               max(old[2], wp[2], need[2]), max(old[3], wp[3], need[3]))
        log(f"  {layer}: {gap:.0f} m short of the corridor, re-fetching the union")
        fetch_layer(route, layer, CORRIDOR[layer], route.get("padM", 300), log, box=box)
    return short


def load_layer(route_id, name):
    with gzip.open(os.path.join(CACHE_DIR, route_id, f"{name}.json.gz"), "rt", encoding="utf-8") as f:
        return json.load(f)


if __name__ == "__main__":
    fetch_route(sys.argv[1], force="--force" in sys.argv)
