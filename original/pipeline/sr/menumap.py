"""The one map the player sees before driving: every route drawn on the real Bay Area coastline.

The opening screen is a map, not a list. That map has to be the actual
coastline and the actual routes, because the whole promise of this game is 「路是真的」 -- a
hand-drawn bay would be the first thing a player sees and the first thing that is not true.

Everything here already exists in the repository, which is why this is a hundred lines and not a
data-gathering project: the coastline is in the OSM layers the vegetation and backdrop passes
already cache, and the routes are the splines the pipeline just built. This only picks them up,
puts them in one coordinate system, and throws away the detail a 900-pixel map cannot show.

Output is `game/public/menu-map.json`, in lat/lon. The runtime projects; a menu that has to be
re-generated because the panel resized would be the wrong split.
"""
from __future__ import annotations

import glob
import gzip
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "game", "public", "menu-map.json")

# How far a simplified coastline may stray from the real one, in degrees. The map is 1000 units
# wide across 1.3 degrees of longitude, so one unit is about 115 m: 0.0007 (78 m) is under a unit,
# and it takes the Bay's 35k shoreline vertices down to 2.3k.
COAST_TOLERANCE = 0.0007
# The window the menu map is cut to, as (south, west, north, east). It is the Bay Area a player
# would recognise: the Golden Gate and Point Bonita in the north-west, San Pablo and Suisun in the
# north-east, the south bay down to San Jose. Monterey sits outside it on purpose -- 150 km south,
# and framing on it would shrink the Bay into a smudge (the screen draws an edge marker instead).
REGION = (37.15, -122.85, 38.25, -121.55)
# Fetch wider than the window so every coastline chain *ends* outside it. A chain that stops inside
# has no boundary crossing to close its polygon against, and would tear a hole in the water.
FETCH_PAD = 0.2
REGION_CACHE = os.path.join(ROOT, "pipeline", "cache", "bayarea", "coast.json.gz")
ROADS_CACHE = os.path.join(ROOT, "pipeline", "cache", "bayarea", "roads.json.gz")
PLACES_CACHE = os.path.join(ROOT, "pipeline", "cache", "bayarea", "places.json.gz")
# The anchors on the locator map, by their OSM `name`.
#
# That feeling comes from the names you would use yourself to say where something is-- so this is a chosen list rather than "the eight biggest". Population alone drops
# Palo Alto and Mountain View, which is where half the routes are, and keeps Concord and Antioch,
# which are nowhere near any of them. The coordinates still come from OSM; only the choice is ours.
PLACE_NAMES = ("San Francisco", "Oakland", "Berkeley", "San Mateo",
               "Palo Alto", "Mountain View", "San Jose", "Fremont")
# The big roads only.
# -- the job is to make the land read as land, and at 115 m a pixel anything smaller than a highway
# is a smudge. Motorway, trunk and primary is the Bay Area's skeleton: 101, 280, 880, 680, 92, 84.
ROAD_KINDS = "^(motorway|trunk|primary)$"
# Coarser than the shoreline: these lines are drawn at 20% opacity to say "there is a road network
# here", not to be navigated. 0.0015 deg is about 170 m, one and a half pixels.
ROAD_TOLERANCE = 0.0015
# Under this many points after simplification a road is a slip lane, and it only adds noise.
MIN_ROAD_POINTS = 3
# A route drawn on a screen-wide map needs its shape, not its samples: the pipeline stores a point
# every two metres, and 140 of them is more than a 900-pixel-wide map can resolve.
ROUTE_POINTS = 140
# An island simplifies to fewer than this many points when it is a rock, not a place.
MIN_ISLAND_POINTS = 5


def fetch_region(force=False, log=print):
    """One Overpass call for every coastline way in the region, cached like every other OSM layer.

    Separate from the per-route layers on purpose: those are fetched around each track, so their
    coastline is whatever happens to be near a race. The menu map is a map of the Bay, and half a
    Bay drawn in light blue lines tells a player nothing about where their route is
    「那些浅蓝色的线要把它画完整」).
    """
    if os.path.exists(REGION_CACHE) and not force:
        return REGION_CACHE
    from sr.fetch_osm import _query
    s, w, n, e = REGION
    bb = f"{s - FETCH_PAD:.4f},{w - FETCH_PAD:.4f},{n + FETCH_PAD:.4f},{e + FETCH_PAD:.4f}"
    log(f"coastline: bbox {bb}")
    data = _query(f'[out:json][timeout:180];(way["natural"="coastline"]({bb}););out geom;', log)
    ways = [[[round(g["lon"], 5), round(g["lat"], 5)] for g in el["geometry"]]
            for el in data["elements"] if el.get("geometry")]
    os.makedirs(os.path.dirname(REGION_CACHE), exist_ok=True)
    with gzip.open(REGION_CACHE, "wt", encoding="utf-8") as fh:
        json.dump({"version": 1, "bbox": [s - FETCH_PAD, w - FETCH_PAD, n + FETCH_PAD, e + FETCH_PAD],
                   "ways": ways}, fh)
    log(f"coastline: {len(ways)} ways, {sum(len(x) for x in ways)} points, "
        f"{os.path.getsize(REGION_CACHE) // 1024} KB")
    return REGION_CACHE


def simplify(points, tolerance):
    """Douglas-Peucker. Keeps the shape of a shoreline; a plain stride would eat its headlands."""
    if len(points) < 3:
        return list(points)
    (x0, y0), (x1, y1) = points[0], points[-1]
    dx, dy = x1 - x0, y1 - y0
    span = math.hypot(dx, dy) or 1e-12
    worst, at = 0.0, 0
    for i in range(1, len(points) - 1):
        x, y = points[i]
        d = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / span
        if d > worst:
            worst, at = d, i
    if worst <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[:at + 1], tolerance)[:-1] + simplify(points[at:], tolerance)


def fetch_region_roads(force=False, log=print):
    """One Overpass call for the region's major roads, cached beside the coastline."""
    if os.path.exists(ROADS_CACHE) and not force:
        return ROADS_CACHE
    from sr.fetch_osm import _query
    s, w, n, e = REGION
    bb = f"{s - FETCH_PAD:.4f},{w - FETCH_PAD:.4f},{n + FETCH_PAD:.4f},{e + FETCH_PAD:.4f}"
    log(f"roads: bbox {bb}")
    data = _query(f'[out:json][timeout:180];(way["highway"~"{ROAD_KINDS}"]({bb}););out geom;', log)
    ways = [[[round(g["lon"], 5), round(g["lat"], 5)] for g in el["geometry"]]
            for el in data["elements"] if el.get("geometry")]
    os.makedirs(os.path.dirname(ROADS_CACHE), exist_ok=True)
    with gzip.open(ROADS_CACHE, "wt", encoding="utf-8") as fh:
        json.dump({"version": 1, "bbox": [s - FETCH_PAD, w - FETCH_PAD, n + FETCH_PAD, e + FETCH_PAD],
                   "ways": ways}, fh)
    log(f"roads: {len(ways)} ways, {sum(len(x) for x in ways)} points, "
        f"{os.path.getsize(ROADS_CACHE) // 1024} KB")
    return ROADS_CACHE


def fetch_region_places(force=False, log=print):
    """Every city and town node in the region, cached beside the coastline and the roads."""
    if os.path.exists(PLACES_CACHE) and not force:
        return PLACES_CACHE
    from sr.fetch_osm import _query
    s, w, n, e = REGION
    bb = f"{s:.4f},{w:.4f},{n:.4f},{e:.4f}"
    log(f"places: bbox {bb}")
    data = _query(f'[out:json][timeout:180];(node["place"~"^(city|town)$"]({bb}););out;', log)
    rows = [{"name": (el.get("tags") or {}).get("name", ""),
             "lon": round(el["lon"], 5), "lat": round(el["lat"], 5)}
            for el in data["elements"] if (el.get("tags") or {}).get("name")]
    os.makedirs(os.path.dirname(PLACES_CACHE), exist_ok=True)
    with gzip.open(PLACES_CACHE, "wt", encoding="utf-8") as fh:
        json.dump({"version": 1, "bbox": list(REGION), "places": rows}, fh)
    log(f"places: {len(rows)} nodes, {os.path.getsize(PLACES_CACHE) // 1024} KB")
    return PLACES_CACHE


def slug(name):
    return name.lower().replace(" ", "-")


def places(path=None):
    """The anchors, in PLACE_NAMES order, as {id, lon, lat}. Missing names are simply absent."""
    path = path or PLACES_CACHE
    if not os.path.exists(path):
        return []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        rows = json.load(fh).get("places", [])
    by_name = {}
    for r in rows:
        by_name.setdefault(r["name"], r)
    out = []
    for name in PLACE_NAMES:
        r = by_name.get(name)
        if r:
            out.append({"id": slug(name), "lon": r["lon"], "lat": r["lat"]})
    return out


def road_lines(path=None, rect=None, tolerance=ROAD_TOLERANCE):
    """The region's major roads, joined, cut to the frame and thinned to what the map can show."""
    rect = rect or REGION
    ways = _load_region_ways(path or ROADS_CACHE)
    out = []
    for chain in chains(ways):
        for piece in clip_chain(chain, rect):
            simple = simplify(piece, tolerance)
            if len(simple) >= MIN_ROAD_POINTS:
                out.append(simple)
    return out


def simplify_ring(ring, tolerance):
    """Douglas-Peucker for a closed ring.

    Straight to `simplify` a ring collapses to nothing: its first and last point are the same, so
    the base line every distance is measured against has zero length and every distance comes out
    zero. Cutting the ring at its farthest point first gives two open lines with real ends.
    """
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else list(ring)
    if len(pts) < 4:
        return list(ring)
    x0, y0 = pts[0]
    far = max(range(1, len(pts)), key=lambda i: (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2)
    head = simplify(pts[:far + 1], tolerance)
    tail = simplify(pts[far:] + [pts[0]], tolerance)
    return head[:-1] + tail


def _load_region_ways(path=None):
    """The cached region coastline as raw ways, or nothing if it was never fetched."""
    path = path or REGION_CACHE
    if not os.path.exists(path):
        return []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return [[tuple(p) for p in way] for way in json.load(fh).get("ways", []) if len(way) >= 2]


def chains(ways):
    """Join coastline ways end to end, forwards and backwards.

    OSM stores a shoreline as thousands of separate ways, and the direction of each one carries the
    only fact that matters here: **land is on the left**. Joining keeps that fact and turns the
    pieces into a handful of long shorelines. Joining in one direction only is not enough -- start
    from a way in the middle and the shoreline splits in two, and the half that ends *inside* the
    frame has no boundary crossing to close its polygon against.
    """
    by_start, by_end = {}, {}
    for w in ways:
        by_start.setdefault(w[0], []).append(w)
        by_end.setdefault(w[-1], []).append(w)
    used, out = set(), []
    for w in ways:
        if id(w) in used:
            continue
        used.add(id(w))
        chain = list(w)
        while chain[-1] != chain[0]:
            nxt = next((c for c in by_start.get(chain[-1], []) if id(c) not in used), None)
            if nxt is None:
                break
            used.add(id(nxt)); chain.extend(nxt[1:])
        while chain[-1] != chain[0]:
            prev = next((c for c in by_end.get(chain[0], []) if id(c) not in used), None)
            if prev is None:
                break
            used.add(id(prev)); chain[:0] = prev[:-1]
        out.append(chain)
    return out


def _clip_segment(p, q, rect):
    """Liang-Barsky: the part of segment p->q inside the rect, as (t0, t1), or None."""
    s, w, n, e = rect
    dx, dy = q[0] - p[0], q[1] - p[1]
    t0, t1 = 0.0, 1.0
    for num, den in ((p[0] - w, -dx), (e - p[0], dx), (p[1] - s, -dy), (n - p[1], dy)):
        if den == 0:
            if num < 0:
                return None
        else:
            r = num / den
            if den < 0:
                if r > t1:
                    return None
                t0 = max(t0, r)
            else:
                if r < t0:
                    return None
                t1 = min(t1, r)
    return (t0, t1) if t1 > t0 else None


def clip_chain(chain, rect):
    """A chain cut to the rect: a list of polylines, each entering and leaving at the boundary."""
    pieces, cur = [], None
    for p, q in zip(chain, chain[1:]):
        got = _clip_segment(p, q, rect)
        if got is None:
            if cur:
                pieces.append(cur); cur = None
            continue
        t0, t1 = got
        dx, dy = q[0] - p[0], q[1] - p[1]
        a = (p[0] + dx * t0, p[1] + dy * t0)
        b = (p[0] + dx * t1, p[1] + dy * t1)
        if cur is None or t0 > 0:
            if cur:
                pieces.append(cur)
            cur = [a]
        if cur[-1] != b:
            cur.append(b)
        if t1 < 1:
            pieces.append(cur); cur = None
    if cur:
        pieces.append(cur)
    return [p for p in pieces if len(p) >= 2]


def _edge_t(pt, rect, eps=1e-9):
    """Where a boundary point sits on the rect, as a number in [0, 4) going *clockwise* from the
    north-west corner. Clockwise is the whole trick: land is on the left of a coastline, so water is
    on its right, and a ring that follows the shore and then turns clockwise along the frame keeps
    the water inside it."""
    s, w, n, e = rect
    x, y = pt
    wide, tall = (e - w) or 1e-12, (n - s) or 1e-12
    if abs(y - n) <= eps:
        return (x - w) / wide
    if abs(x - e) <= eps:
        return 1 + (n - y) / tall
    if abs(y - s) <= eps:
        return 2 + (e - x) / wide
    if abs(x - w) <= eps:
        return 3 + (y - s) / tall
    return None


def _corners(rect):
    s, w, n, e = rect
    return [(0.0, (w, n)), (1.0, (e, n)), (2.0, (e, s)), (3.0, (w, s))]


def water_rings(chains_in, rect, eps=1e-7):
    """Every stretch of water inside the rect, as closed rings, plus the islands sitting in it.

    Returns (water, islands). The water rings are assembled from the clipped shoreline: follow a
    piece from where it enters the frame to where it leaves, then run clockwise along the frame
    edge to wherever the next piece enters, and keep going until the ring closes. Islands are the
    coastline ways that close on themselves -- they are land, and get drawn on top of the water.
    """
    pieces, islands = [], []
    for chain in chains_in:
        closed = chain[0] == chain[-1]
        for piece in clip_chain(chain, rect):
            a, b = _edge_t(piece[0], rect, eps), _edge_t(piece[-1], rect, eps)
            if a is None or b is None:
                if closed and piece[0] == piece[-1]:
                    islands.append(piece)      # an island wholly inside the frame
                continue                       # a fragment with a loose end: nothing to close it
            pieces.append((a, b, piece))
    pieces.sort(key=lambda x: x[0])
    corners = _corners(rect)
    water, done = [], set()
    for i in range(len(pieces)):
        if i in done:
            continue
        ring, at = [], i
        while at not in done:
            done.add(at)
            _, out_t, poly = pieces[at]
            ring.extend(poly)
            nxt = min(range(len(pieces)),
                      key=lambda j: ((pieces[j][0] - out_t) % 4.0) or 4.0)
            in_t = pieces[nxt][0]
            span = (in_t - out_t) % 4.0
            for ct, pt in corners:
                if 0 < (ct - out_t) % 4.0 <= span:
                    ring.append(pt)
            at = nxt
        if len(ring) >= 4:
            ring.append(ring[0])
            water.append(ring)
    return water, islands


def local_line(track, points, limit=None):
    """Local x/z metre pairs as lat/lon, optionally thinned to `limit` points."""
    lat0, lon0 = track["origin"]["lat"], track["origin"]["lon"]
    k = math.cos(math.radians(lat0))
    stride = max(1, len(points) // limit) if limit else 1
    return [[round(lon0 + p[0] / (111320.0 * k), 5), round(lat0 - p[1] / 111320.0, 5)]
            for p in points[::stride]]


def route_line(track, points=ROUTE_POINTS):
    """A track's spline as lat/lon, thinned to `points`.

    The spline is in local metres about the track's own origin, so each track converts with its own
    latitude scale -- one shared scale would shear Monterey against Berkeley by a whole street.
    """
    return local_line(track, [[p[0], p[2]] for p in track["spline"]["points"]], points)


def nearby_streets(track, map_path, margin=0.3):
    """Roads intersecting the route's padded frame, in the exact same coordinates as the route.

    The per-track street map already contains all OSM streets around the drive. Keeping only roads
    near the route stops a wide OSM fetch rectangle from shrinking the selected circuit into a dot;
    the UI clips the remaining overshoot at the frame edge.
    """
    if not os.path.exists(map_path):
        return []
    with open(map_path, encoding="utf-8") as fh:
        doc = json.load(fh)
    route = [[p[0], p[2]] for p in track["spline"]["points"]]
    xs, zs = [p[0] for p in route], [p[1] for p in route]
    dx, dz = max(xs) - min(xs), max(zs) - min(zs)
    px, pz = max(100.0, dx * margin), max(100.0, dz * margin)
    frame = (min(xs) - px, min(zs) - pz, max(xs) + px, max(zs) + pz)
    out = []
    for road in doc.get("roads", []):
        flat = road.get("p", [])
        line = [[flat[i], flat[i + 1]] for i in range(0, len(flat) - 1, 2)]
        if len(line) < 2:
            continue
        rx, rz = [p[0] for p in line], [p[1] for p in line]
        if max(rx) < frame[0] or min(rx) > frame[2] or max(rz) < frame[1] or min(rz) > frame[3]:
            continue
        out.append({"class": road.get("c", "c"), "line": local_line(track, line)})
    return out


def build(tracks_root=None, cache=None, tolerance=COAST_TOLERANCE):
    """The whole document: the Bay drawn as water and land, with every route on it.

    Names and blurbs are deliberately absent -- they live in the i18n files and the runtime reads
    them from there (docs/CONTRACT.md section 6).
    """
    ways = _load_region_ways(cache)
    if not ways:
        raise RuntimeError(f"no region coastline at {cache or REGION_CACHE}; "
                           "run: .venv/bin/python -c 'from sr import menumap; menumap.fetch_region()'")
    water, islands = water_rings(chains(ways), REGION)
    roads = road_lines(rect=REGION)
    anchors = places()
    water = [simplify_ring(r, tolerance) for r in water]
    land = [r for r in (simplify_ring(r, tolerance) for r in islands) if len(r) >= MIN_ISLAND_POINTS]
    root = tracks_root or os.path.join(ROOT, "game", "public", "tracks")
    routes = []
    for path in sorted(glob.glob(os.path.join(root, "*", "track.json"))):
        with open(path, encoding="utf-8") as fh:
            track = json.load(fh)
        if track["id"].startswith("synth"):
            continue                       # test fixtures, not places
        routes.append({
            "id": track["id"],
            "category": track.get("category"),
            # A loop's spline is one physical lap, while this number is what the player is signing
            # up to drive. The roof ring is deliberately three short laps: showing 1.3 km here for
            # a 4.0 km race makes the opening map lie about its length.
            "km": round(track["spline"]["length"] * int(track.get("laps", 1)) / 1000.0, 2),
            "checkpoints": len(track.get("checkpoints", [])),
            "line": route_line(track),
            "streets": nearby_streets(track, os.path.join(os.path.dirname(path), "map.json")),
        })
    rnd = lambda ring: [[round(x, 5), round(y, 5)] for x, y in ring]
    return {"version": 5, "region": list(REGION), "water": [rnd(r) for r in water],
            "land": [rnd(r) for r in land], "roads": [rnd(r) for r in roads],
            "places": anchors, "routes": routes}


def write(out_path=None, tracks_root=None, cache=None):
    doc = build(tracks_root, cache)
    path = out_path or OUT
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
    return doc
