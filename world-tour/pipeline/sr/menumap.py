"""The one map the player sees before driving: the world, with every city's route on it.

The opening screen is a map, not a list, because the promise of this game is 「路是真的」.
For a world tour the map that says where a route is, is the world: the continents drawn from the
same elevation data every track stands on (land is where the ground reads above sea level), a pin
and a name for each city, and the routes themselves -- too small to see at this scale, so the screen
rings the chosen one and draws it big beside the map.

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

# The window the menu map is cut to, as (south, west, north, east): the world with its seam in the
# Pacific, where no route is. Wide enough east for Sydney and west for New York and Machu Picchu, and
# tall enough that a square drawing of it is mostly map rather than empty band.
REGION = (-60.0, -100.0, 78.0, 170.0)
# Land from the Terrarium elevation tiles at zoom 3 (about 20 km a pixel), sampled every quarter
# degree. The Caspian and the Dead Sea read below zero and come out as water, which they are; so does
# the Black Sea, whose bathymetry the tiles carry.
LAND_ZOOM = 3
LAND_STEP = 0.25
# A quarter-degree grid drawn 1000 units across 270 degrees: under a unit per cell, so the outline is
# simplified to half a degree and islands under two square degrees (a few pixels) are dropped.
LAND_TOLERANCE = 0.3
MIN_LAND_AREA = 2.0
LAND_CACHE = os.path.join(ROOT, "pipeline", "cache", "world", "land.json.gz")
# A route drawn on a screen-wide map needs its shape, not its samples: the pipeline stores a point
# every two metres, and 140 of them is more than a 900-pixel-wide map can resolve.
ROUTE_POINTS = 140
# An island simplifies to fewer than this many points when it is a rock, not a place.
MIN_ISLAND_POINTS = 5


def fetch_land(force=False, log=print):
    """The continents as rings, from the elevation tiles, cached like every other layer."""
    if os.path.exists(LAND_CACHE) and not force:
        return LAND_CACHE
    import numpy as np
    from shapely.geometry import box
    from shapely.ops import unary_union
    from sr.dem import DemSampler
    from sr.fetch_dem import fetch_tile
    s, w, n, e = REGION
    tiles = 2 ** LAND_ZOOM
    for x in range(tiles):
        for y in range(tiles):
            fetch_tile(x, y, LAND_ZOOM, log=lambda *_: None)
    dem = DemSampler(LAND_ZOOM, fallback_zoom=None)
    lats = np.arange(s + LAND_STEP / 2, n, LAND_STEP)
    lons = np.arange(w + LAND_STEP / 2, e, LAND_STEP)
    cells = []
    for lat in lats:
        land = dem.heights(np.full(len(lons), lat), lons) > 0
        # One rectangle per run of land cells in a row: a few thousand boxes instead of 400 thousand.
        edges = np.flatnonzero(np.diff(np.r_[0, land.astype(int), 0]))
        for i0, i1 in zip(edges[::2], edges[1::2]):
            cells.append(box(w + i0 * LAND_STEP, lat - LAND_STEP / 2, w + i1 * LAND_STEP, lat + LAND_STEP / 2))
    # Simplified by more than a cell, so the outline is a coast and not the grid's staircase.
    merged = unary_union(cells).simplify(LAND_STEP * 1.2)
    polys = [merged] if merged.geom_type == "Polygon" else list(merged.geoms)
    rnd = lambda coords: [[round(x, 3), round(y, 3)] for x, y in coords]
    from shapely.geometry import Polygon
    rings = [rnd(poly.exterior.coords) for poly in polys if poly.area >= MIN_LAND_AREA]
    # The seas a continent closes round -- the Mediterranean, the Black Sea, the Caspian, Hudson Bay --
    # are holes in its outline. Dropping them paints the Mediterranean as desert.
    seas = [rnd(hole.coords) for poly in polys if poly.area >= MIN_LAND_AREA
            for hole in poly.interiors if Polygon(hole).area >= MIN_LAND_AREA]
    os.makedirs(os.path.dirname(LAND_CACHE), exist_ok=True)
    with gzip.open(LAND_CACHE, "wt", encoding="utf-8") as fh:
        json.dump({"version": 2, "region": list(REGION), "zoom": LAND_ZOOM, "step": LAND_STEP,
                   "rings": rings, "seas": seas}, fh)
    log(f"land: {len(rings)} rings, {len(seas)} enclosed seas, {sum(len(r) for r in rings + seas)} points")
    return LAND_CACHE


def land_rings(path=None, key="rings"):
    """The cached continents (`rings`) or the seas they close round (`seas`)."""
    path = path or LAND_CACHE
    if not os.path.exists(path):
        return []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return [[tuple(p) for p in ring] for ring in json.load(fh).get(key, [])]


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


def build(tracks_root=None, cache=None, tolerance=LAND_TOLERANCE):
    """The whole document: the sea as the ground, the continents on it, every city and its route.

    Names and blurbs are deliberately absent -- they live in the i18n files and the runtime reads
    them from there (docs/CONTRACT.md section 6).
    """
    rings = land_rings(cache)
    if not rings:
        raise RuntimeError(f"no land at {cache or LAND_CACHE}; "
                           "run: .venv/bin/python -c 'from sr import menumap; menumap.fetch_land()'")
    s, w, n, e = REGION
    land = [r for r in (simplify_ring(r, tolerance) for r in rings) if len(r) >= MIN_ISLAND_POINTS]
    seas = [r for r in (simplify_ring(r, tolerance) for r in land_rings(cache, "seas")) if len(r) >= MIN_ISLAND_POINTS]
    root = tracks_root or os.path.join(ROOT, "game", "public", "tracks")
    routes, pins = [], []
    for path in sorted(glob.glob(os.path.join(root, "*", "track.json"))):
        with open(path, encoding="utf-8") as fh:
            track = json.load(fh)
        if track["id"].startswith("synth"):
            continue                       # test fixtures, not places
        routes.append({
            "id": track["id"],
            "category": track.get("category"),
            # A loop's spline is one physical lap, while this number is what the player is signing up to drive.
            "km": round(track["spline"]["length"] * int(track.get("laps", 1)) / 1000.0, 2),
            "checkpoints": len(track.get("checkpoints", [])),
            "line": route_line(track),
            "streets": nearby_streets(track, os.path.join(os.path.dirname(path), "map.json")),
        })
        # One pin per city, at its track's origin; the label is the i18n key `place.<track id>`.
        pins.append({"id": track["id"], "lon": round(track["origin"]["lon"], 4), "lat": round(track["origin"]["lat"], 4)})
    rnd = lambda ring: [[round(x, 3), round(y, 3)] for x, y in ring]
    # A world map is sea with land on it: the ground is water, the continents are drawn on it, and
    # `water` is the enclosed seas drawn back over the land (the runtime paints in that order).
    return {"version": 5, "world": True, "region": list(REGION),
            "water": [rnd(r) for r in seas],
            "land": [rnd(r) for r in land], "roads": [],
            "places": pins, "routes": routes}


def write(out_path=None, tracks_root=None, cache=None):
    doc = build(tracks_root, cache)
    path = out_path or OUT
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
    return doc
