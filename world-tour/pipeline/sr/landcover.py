"""What kind of ground is under each patch of terrain, from OpenStreetMap land use.

0.3 is meant to look like the place it is copied from, and the single biggest thing stopping that
outside the road itself is that every square metre beside it is one flat green (`terrain`,
`0x6f7d57`): the salt ponds, the Presidio, a campus car park and a hillside of dry scrub are the
same colour. Real aerial imagery would fix that too, but it costs a download per track and its
licensing is a question (USGS and Copernicus are usable, Google/Apple/Bing are not) -- while OSM
already tags the ground, this pipeline already caches those tags for the trees, and a category is
a few bytes rather than a few megabytes.

So this module answers one question -- "what is this patch" -- and since it is wired to the
thing that asks: `sr.build` hands `patches()` to `build_terrain` and to the backdrop, and the ground
comes back split by what it is made of.

This is also the only reader of those rings. `sr.vegetation` imports `rings()` from here, so terrain
and trees agree on the tag-key order and a new source cannot quietly reach one without the other.
"""
from shapely.geometry import Polygon

from sr.fetch_osm import load_layer

# OSM tag value -> the terrain material that ground wears. Grouped rather than one-to-one, because
# a driver at 200 km/h sees five kinds of ground, not fifty: mown green, dry California hillside,
# tree cover, sand, bare rock, the salt ponds, and anything paved.
COVER = {}
for _k in ("grass", "meadow", "village_green", "common", "recreation_ground", "pitch", "garden",
           "greenfield", "farmland", "orchard", "vineyard", "allotments", "cemetery", "park"):
    COVER[_k] = "terrain_grass"
for _k in ("scrub", "shrubbery", "heath", "grassland", "moor"):
    COVER[_k] = "terrain_scrub"
for _k in ("wood", "forest", "tree_row"):
    COVER[_k] = "terrain_wood"
for _k in ("sand", "beach", "dune"):
    COVER[_k] = "terrain_sand"
for _k in ("bare_rock", "rock", "scree", "cliff", "quarry"):
    COVER[_k] = "terrain_rock"
for _k in ("salt_pond", "wetland", "mud", "basin", "reservoir"):
    COVER[_k] = "terrain_saltpond"
# Only surfaces, never zoning. `landuse=industrial`, `residential`, `commercial` and friends say
# what may be built there, not what the ground is made of, and they are drawn enormous: the salt
# works behind the Dumbarton is one `industrial` polygon of fifteen square kilometres, which would
# have painted the whole of that route as tarmac including the ponds inside it.
for _k in ("railway", "construction", "brownfield", "landfill", "parking", "garages", "apron"):
    COVER[_k] = "terrain_paved"
DEFAULT_COVER = "terrain"

# Tag keys that can carry a land-use value, in the order OSM itself prefers them. A park tagged
# `leisure=park` often has no `landuse` at all, and parks are most of the green in a city.
KEYS = ("natural", "landuse", "leisure", "aeroway")

# Below this a patch is not ground cover, it is a garden feature. Measured, not guessed: the
# sand-hill corridor alone carries 745 `leisure=swimming_pool` polygons, almost all of them a few
# square metres in somebody's back garden, and colouring the terrain under each one costs a
# triangle group for something no one will ever see from the road.
MIN_AREA = 400.0


def cover_for(tags):
    """The terrain material for one OSM element's tags, or the fallback. Never raises."""
    for key in KEYS:
        value = str(tags.get(key, "")).lower()
        if value in COVER:
            return COVER[value]
    return DEFAULT_COVER


def rings(route_id, wanted=None, keys=KEYS, relations=False):
    """Closed land-use rings as (kind, [(lat, lon), ...]).

    `wanted` filters by raw OSM value and is what `sr.vegetation` uses (it cares about the exact
    kind, not the group); leaving it None returns everything tagged with one of `keys`.

    `relations` also returns the outer rings of multipolygon relations. Big campuses are mapped that
    way (Google at Shoreline is three outer ways), and a relation carries no `geometry` of its own,
    so without it the trees skipped them entirely. Inner rings are not subtracted: a
    courtyard inside a campus is still campus ground. The terrain's cover keeps its old behaviour.
    """
    out = []
    for e in load_layer(route_id, "landuse")["elements"]:
        tags = e.get("tags", {})
        kind = next((tags[k] for k in keys if k in tags), None)
        if kind is None or (wanted is not None and kind not in wanted):
            continue
        if "geometry" in e:
            ring = [(p["lat"], p["lon"]) for p in e["geometry"]]
            if len(ring) >= 4:
                out.append((kind, ring))
        elif relations and e.get("type") == "relation":
            out += [(kind, ring) for ring in _outer_rings(e)]
    return out


def _outer_rings(relation):
    """Join a multipolygon relation's outer member ways into closed (lat, lon) rings."""
    from shapely.geometry import LineString
    from shapely.ops import linemerge, polygonize
    lines = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
             for m in relation.get("members", [])
             if m.get("role") in ("outer", "") and len(m.get("geometry", [])) >= 2]
    if not lines:
        return []
    return [[(lat, lon) for lon, lat in poly.exterior.coords]
            for poly in polygonize(linemerge(lines)) if len(poly.exterior.coords) >= 4]


def patches(route_id, frame):
    """(material, polygon) for every patch big enough to matter, in local metres.

    Sorted largest first, so that a small polygon drawn inside a big one -- a car park inside a
    campus, a pond inside a park -- wins when a triangle falls in both.
    """
    out = []
    for kind, ring in rings(route_id):
        material = cover_for({KEYS[0]: kind, KEYS[1]: kind, KEYS[2]: kind})
        if material == DEFAULT_COVER:
            continue
        lat = [p[0] for p in ring]
        lon = [p[1] for p in ring]
        x, z = frame.to_local(lat, lon)
        poly = Polygon(zip(x, z))
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty or poly.area < MIN_AREA:
            continue
        out.append((material, poly))
    ground = route_ground(route_id)
    if ground:
        #
        # the route names one colour for its hillsides. Dry scrub wears it, and so does the unmapped
        # ground, through a patch under everything that every specific patch still overwrites.
        out = [(ground if material in HILLSIDE else material, poly) for material, poly in out]
        out.append((ground, Polygon([(-HILLSIDE_EXTENT, -HILLSIDE_EXTENT), (HILLSIDE_EXTENT, -HILLSIDE_EXTENT),
                                     (HILLSIDE_EXTENT, HILLSIDE_EXTENT), (-HILLSIDE_EXTENT, HILLSIDE_EXTENT)])))
    out.sort(key=lambda mp: -mp[1].area)
    return out


# How far past a mapped bridge support the sea still wins. The elevation tiles are a few metres a pixel
# and blur a pier's concrete into a hump that sits about ten metres off its OSM outline.
SUPPORT_MARGIN = 12.0


def bridge_supports(route_id, frame, margin=SUPPORT_MARGIN):
    """Local polygons of every OSM `bridge:support` in the land-use layer, grown by `margin`.

    The elevation data reads a tower pier standing in the strait as ground a metre above the sea, and
    the terrain drew it as a strip of grass under the bridge. The bridge is ours to draw; its supports are not islands.
    """
    out = []
    for _, ring in rings(route_id, keys=("bridge:support",)):
        x, z = frame.to_local([p[0] for p in ring], [p[1] for p in ring])
        poly = Polygon(zip(x, z))
        if not poly.is_valid:
            poly = poly.buffer(0)
        if not poly.is_empty:
            out.append(poly.buffer(margin))
    return out


# The covers a route's `groundCover` repaints: what the unmapped hillside and the mapped scrub wear.
HILLSIDE = {DEFAULT_COVER, "terrain_scrub"}
# Local metres either way; far past any route's backdrop radius.
HILLSIDE_EXTENT = 50_000.0


def route_ground(route_id):
    """The material a route asks its hillsides to wear, or None to keep the dry default."""
    from sr.routes import load_route
    try:
        value = load_route(route_id).get("groundCover")
    except FileNotFoundError:
        return None
    if value is not None and value not in set(COVER.values()):
        raise ValueError(f"{route_id}: groundCover {value!r} is not a terrain material")
    return value


def classify(centroids, patch_list):
    """One material name per triangle, from where its centroid falls.

    `centroids` is (N, 2) in local metres, `patch_list` is what `patches()` returned. Assignment
    walks the patches largest first and lets later ones overwrite, so the car park inside the
    campus and the pond inside the park win over the ground they sit on -- the small polygon is
    always the more specific statement about that spot.

    Centroids rather than whole triangles: the terrain triangulation is adaptive and its triangles
    are metres across where the road is and tens of metres out at the edge, so a triangle straddling
    a boundary has to pick a side either way. Picking by centroid keeps it one lookup instead of an
    intersection test per patch, on a mesh with tens of thousands of triangles.
    """
    import numpy as np
    from shapely.geometry import Point
    from shapely.prepared import prep
    from shapely.strtree import STRtree

    out = np.full(len(centroids), DEFAULT_COVER, dtype=object)
    if not patch_list or len(centroids) == 0:
        return out
    points = [Point(x, z) for x, z in centroids]
    tree = STRtree(points)
    for material, poly in patch_list:
        inside = prep(poly)
        for i in tree.query(poly):
            if inside.contains(points[i]):
                out[i] = material
    return out


# ---------------------------------------------------------------- inland water
#
# The elevation data only knows the sea: below zero is water, the zero line is the shore. A lake at
# 830 m or a river through a city reads as ground, so the original drew every inland lake and river
# as land. They come from the map instead: OSM water polygons, each at its own level.

INLAND_MIN_AREA = 2000.0      # below this it is a pond in a garden
INLAND_BED = 2.0              # the ground inside is pressed this far under the surface
INLAND_ROAD_CAP = 1.0         # a surface is never more than this above the road beside it
INLAND_PERCENTILE = 20


def _is_water(tags):
    return (tags.get("natural") == "water" or tags.get("waterway") == "riverbank"
            or tags.get("landuse") in ("reservoir", "basin") and tags.get("water") is not None)


def _water_rings(route_id, layer):
    try:
        elements = load_layer(route_id, layer)["elements"]
    except FileNotFoundError:
        return []
    out = []
    for e in elements:
        tags = e.get("tags", {})
        if not _is_water(tags):
            continue
        if "geometry" in e:
            ring = [(p["lat"], p["lon"]) for p in e["geometry"]]
            if len(ring) >= 4 and ring[0] == ring[-1]:
                out.append(ring)
        elif e.get("type") == "relation":
            out += _outer_rings(e)
    return out


def inland_water(route_id, frame, dem, res=None, road_y=None, sea_level=0.0):
    """[(polygon, level)] for every inland lake and river polygon, in local metres.

    The level is the 20th percentile of the downloaded elevation inside the outline (the surface of
    a lake reads flat, its shore reads higher), never more than a metre above a road beside it."""
    import numpy as np
    from shapely.ops import unary_union
    polys = []
    for layer in ("landuse", "backdrop"):
        for ring in _water_rings(route_id, layer):
            x, z = frame.to_local([p[0] for p in ring], [p[1] for p in ring])
            poly = Polygon(zip(x, z))
            if not poly.is_valid:
                poly = poly.buffer(0)
            if not poly.is_empty and poly.area >= INLAND_MIN_AREA:
                polys.append(poly)
    if not polys:
        return []
    merged = unary_union(polys)
    parts = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
    road_tree = None
    if res is not None and road_y is not None:
        from scipy.spatial import cKDTree
        road_tree = cKDTree(res.P[:, [0, 2]])
    out = []
    for poly in parts:
        if poly.area < INLAND_MIN_AREA:
            continue
        x0, z0, x1, z1 = poly.bounds
        step = max(5.0, (poly.area ** 0.5) / 25.0)
        gx, gz = np.meshgrid(np.arange(x0, x1, step), np.arange(z0, z1, step))
        pts = np.c_[gx.ravel(), gz.ravel()]
        from shapely import contains_xy
        pts = pts[contains_xy(poly, pts[:, 0], pts[:, 1])]
        if len(pts) < 3:
            c = poly.representative_point()
            pts = np.array([[c.x, c.y]])
        lat, lon = frame.to_latlon(pts[:, 0], pts[:, 1])
        h = dem.heights(lat, lon)
        if hasattr(dem, "known"):
            h = h[dem.known(lat, lon)]
        if not len(h):
            continue
        level = float(np.percentile(h, INLAND_PERCENTILE))
        if level <= sea_level + 0.5:
            continue                           # at sea level the bathymetry already draws it
        if road_tree is not None:
            ring = np.asarray(poly.exterior.coords)
            d, i = road_tree.query(ring)
            near = d < 60.0
            if near.any():
                level = min(level, float(np.min(road_y[i[near]])) + INLAND_ROAD_CAP)
        out.append((poly, level))
    return out
