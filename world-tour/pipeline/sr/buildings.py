"""OpenStreetMap building footprints extruded to greybox volumes with oriented box colliders.

Only about two thirds of the footprints here carry a height or a storey count, so the rest are
estimated from what the building is and how big its footprint is. Getting a two storey house wrong
by a meter is invisible; getting a tower wrong is not, and towers are the ones that are tagged."""
import math
import re
import zlib

from collections import defaultdict

import numpy as np
from shapely import affinity
from shapely.geometry import Polygon, box as shapely_box
from shapely.geometry.polygon import orient
from shapely.ops import triangulate

from sr.fetch_osm import load_layer
from sr.landmark_data import footprints as landmark_footprints
from sr.mesh import (BUILDING_UV_METRES, Mesh, box, from_triangles, merge, orient_by_shading,
                     orient_to, pitched_roof, pitched_roof_parts, yaw_for_x_axis)
from sr.terrain import ground_height

LEVEL_HEIGHT = 3.5
MIN_HEIGHT = 3.0
MAX_HEIGHT = 260.0
MAX_TAG_HEIGHT = 1000.0     # parser validity; rendering caps belong to each producer
SINK = 1.5                # how far the walls continue below ground, so slopes never show a gap
COLLIDER_RADIUS = 60.0    # buildings further than this from the route get no collider
MIN_AREA = 12.0

# footprint area in square meters -> storeys, for the buildings nobody has tagged
AREA_STOREYS = ((60, 1), (150, 2), (400, 2), (1200, 3), (4000, 4))
TYPE_STOREYS = {"house": 2, "detached": 2, "residential": 3, "apartments": 4, "garage": 1, "garages": 1,
                "shed": 1, "hut": 1, "roof": 1, "carport": 1, "greenhouse": 1, "school": 2, "church": 2,
                "chapel": 2, "retail": 1, "commercial": 3, "office": 4, "industrial": 2, "warehouse": 2,
                "hotel": 5, "hospital": 4, "university": 3, "civic": 3, "public": 3}


# Which facade a footprint wears, from the same OSM tag that already estimates its height.
#
# Five kinds, because five is what a street in this part of the world actually looks like: mirrored
# curtain wall on the office parks, painted render on the houses, board-formed concrete on schools
# and hospitals, ribbed metal on the warehouses, and the horizontal slots of a parking structure.
# Anything untagged or unusual keeps the plain `building` material and the procedural window grid
# the runtime draws on it, which is what the whole city looked like before this.
FACADE = {}
for _k in ("office", "commercial", "retail", "supermarket", "hotel"):
    FACADE[_k] = "building_glass"
for _k in ("house", "detached", "residential", "apartments", "terrace", "semidetached_house",
           "bungalow", "dormitory"):
    FACADE[_k] = "building_stucco"
for _k in ("school", "university", "college", "hospital", "civic", "public", "church", "chapel"):
    FACADE[_k] = "building_concrete"
for _k in ("industrial", "warehouse", "manufacture", "hangar", "shed", "greenhouse"):
    FACADE[_k] = "building_metal"
for _k in ("parking", "garage", "garages", "carport"):
    FACADE[_k] = "building_parking"
DEFAULT_FACADE = "building"

# What an untagged footprint wears, by how big and how tall it is, with a stable jitter.
#
# `building=yes` is not a rare case, it is the overwhelming majority: 2813 of lombard's 2967
# footprints, 4457 of twin-peaks' 4540, 6635 of sand-hill's 7423. Mapping only the tags that say
# something left 80.7% of every wall in the game on the untextured fallback -- a whole city block
# still the one beige with one window grid, which is the exact thing this was supposed to end.
#
# So the shape decides instead, from numbers the pipeline already has. A tuple rather than one
# answer per size, and the choice inside it comes from the footprint's own position: a street of
# identical blocks reads as wallpaper however good the texture is, and real streets are mixed.
SHAPE_FACADES = (
    # (max footprint m2, max storeys, choices)
    (400.0, 3, ("building_stucco", "building_stucco", "building_stucco", "building_concrete")),
    (400.0, 99, ("building_concrete", "building_glass", "building_stucco")),
    (2000.0, 2, ("building_metal", "building_concrete")),
    (2000.0, 99, ("building_glass", "building_concrete", "building_glass")),
    (1e12, 3, ("building_metal", "building_metal", "building_concrete")),
    (1e12, 99, ("building_glass", "building_glass", "building_concrete")),
)


RUIN = "ruin_stone"


def is_ruin(tags):
    # `ruins=temple` and friends: what it was, and that it is now a ruin
    return tags.get("building") == "ruins" or tags.get("ruins") not in (None, "no") or tags.get("historic") == "ruins"


def ruin_zones(route, frame):
    """A route's `architecture.ruinZones`: circles ({lat, lon, radiusM}) where a plain mapped building
    is an ancient tomb or wall, not a house -- a necropolis maps its mastabas as `building=yes`."""
    out = []
    for z in (route.get("architecture") or {}).get("ruinZones", ()):
        x, y = frame.to_local(np.array([z["lat"]]), np.array([z["lon"]]))
        out.append((float(x[0]), float(y[0]), float(z["radiusM"])))
    return out


def in_ruin_zone(tags, centre, zones):
    if not zones or str(tags.get("building", "yes")) not in ("yes", "tomb", "ruins") \
            or parse_height(tags) or tags.get("amenity") or tags.get("tourism"):
        return False
    return any(math.hypot(centre.x - x, centre.y - z) <= r for x, z, r in zones)


def _local_building(poly, tags, t, base, ground_y, tagged, guessed, at, towards, near, keep_clear, by_material):
    """One footprint in its city's own style (sr/local_style.py). Returns the top for its collider."""
    from sr import local_style as L
    slot = t["slot"]
    wall, ground_mat, roof_mat = L.WALL.format(slot), L.GROUND.format(slot), L.ROOF.format(slot)
    ground_m, storeys, total = L.storeys_for(t, tagged, guessed, at, tags)
    storey_m = float(t.get("storeyM", 3.2))
    top = ground_y + min(total, MAX_HEIGHT)
    d = t.get("details") or {}
    # upper floors jettied out over the street (`upperOverhangM`), never over the road
    overhang = float(t.get("upperOverhangM", 0))
    upper_poly = poly
    if overhang > 0 and storeys:
        grown = poly.buffer(overhang, join_style="mitre")
        if keep_clear is not None:
            grown = grown.difference(keep_clear)
        grown = max(getattr(grown, "geoms", [grown]), key=lambda g: g.area) if not grown.is_empty else poly
        if grown.geom_type == "Polygon" and grown.area > poly.area:
            upper_poly = grown
    # night windows: homes light warm and scattered, offices in rows; the type knows which it is
    residential = bool(t["residential"]) if "residential" in t else bool(tags.get("sr:residential"))
    ident = tags["sr:facade-id"]
    band = extrude(poly, ground_y, ground_y + ground_m, material=ground_mat, sink=ground_y - base + SINK,
                   caps=storeys == 0)
    if band is not None:
        facade_identity(band, ident, residential)
        by_material[ground_mat].append(band)
    if storeys:
        upper = extrude(upper_poly, ground_y + ground_m, top, material=wall, sink=0.0)
        if upper is not None:
            facade_identity(upper, ident, residential)
            by_material[wall].append(upper)
    wall_top_mat = wall if storeys else ground_mat
    roof = t.get("roof") or {}
    kind = roof.get("kind", "flat")
    roof_top = top
    pitched = False
    if kind != "flat":
        poly = upper_poly
        rect = poly.minimum_rotated_rectangle
        eave = float(roof.get("eaveM", .4))
        # A roof on the rectangle round a clipped or L-shaped footprint hangs over the road (the build's
        # "building triangles stand on the road" check): only a near-rectangle whose roof, eaves and
        # all, stays off the road gets one; the eaves come in first, then the outline roof takes over.
        (rx, _ry, rz), (hx, _hy, hz), yaw = oriented_box(poly, base, top)
        blocked = lambda grow: keep_clear is not None and box_polygon(rx, rz, hx + grow, hz + grow, yaw).intersects(keep_clear)
        if blocked(eave):
            eave = 0.0
        if rect.area > 0 and poly.area / rect.area >= .9 and not blocked(0.0):
            finish, roof_base, _ = finish_roof(poly, ground_y, top, wall_top_mat, "hip")
            by_material[wall_top_mat].append(finish)
            half = (hx + eave, hz + eave)
            rise = math.tan(math.radians(float(roof.get("pitchDeg", 30)))) * min(hx, hz)
            if kind == "mansard":
                lower, inset = float(roof.get("lowerM", 2.8)), float(roof.get("insetM", .9))
                parts = L.mansard_parts((rx, roof_base, rz), half, yaw, lower, inset, float(roof.get("topM", .7)), roof_mat)
                roof_top = roof_base + lower + float(roof.get("topM", .7))
                if roof.get("dormers") and near:
                    bay = float((t.get("window") or {}).get("bay", 3.0))
                    parts.extend(L.dormers((rx, 0, rz), half, yaw, roof_base, lower, inset, bay,
                                           L.DETAIL_LIGHT, roof_mat))
            else:
                shape = "gable" if kind in ("gable", "curved") else "hip"
                parts = pitched_roof_parts((rx, roof_base, rz), half, yaw, max(rise, .4), shape, roof_mat,
                                           end_material=wall_top_mat)
                roof_top = roof_base + max(rise, .4)
                if roof.get("dormers") and near:
                    # dormers in a pitched roof, `dormerSpacingM` apart along its long sides
                    bay = float(roof.get("dormerSpacingM", (t.get("window") or {}).get("bay", 3.0)))
                    # centred where the slope is half way up, so the front of each stands out of it
                    parts.extend(L.dormers((rx, 0, rz), (hx, hz), yaw, roof_base - .3, max(rise, .4),
                                           min(hx, hz) * .9, bay, L.DETAIL_LIGHT, roof_mat))
                if kind == "curved":
                    # the dark ridge of a tiled Chinese roof, raised at both ends
                    long_x = hx >= hz
                    length = (hx if long_x else hz) + eave
                    ridge_yaw = yaw if long_x else yaw + math.pi / 2
                    parts.append(box((rx, roof_top + .12, rz), (length, .14, .16), yaw=ridge_yaw, material=L.DETAIL_DARK))
                    for side in (-1, 1):
                        ex = rx + math.cos(ridge_yaw) * side * length
                        ez = rz - math.sin(ridge_yaw) * side * length
                        parts.append(box((ex, roof_top + .35, ez), (.25, .3, .18), yaw=ridge_yaw, material=L.DETAIL_DARK))
            for part in parts:
                if part.material == roof_mat:
                    L.planar_uv(part)
                by_material[part.material].append(part)
            pitched = True
        elif kind in ("hip", "gable", "mansard", "curved"):
            finish, roof_base, _ = finish_roof(poly, ground_y, top, wall_top_mat, "hip")
            by_material[wall_top_mat].append(finish)
            hip = outline_hip_roof(poly, roof_base, roof_mat)
            if hip is not None:
                L.planar_uv(hip)
                by_material[roof_mat].append(hip)
                roof_top = float(hip.positions[:, 1].max())
                pitched = True
    if not pitched:
        finish, _, roof_top = finish_roof(poly, ground_y, top, wall_top_mat, "flat")
        by_material[wall_top_mat].append(finish)
        if kind == "dome":
            # a lead dome on a low drum, centred on the roof (tombs, bath-houses)
            (rx, _ry, rz), (hx, _hy, hz), _yaw = oriented_box(poly, base, top)
            r = .42 * min(hx, hz) * 2 * float(roof.get("domeShare", 1.0))
            drum = L.cylinder(rx, top, rz, r * 1.02, float(roof.get("drumM", .8)), wall_top_mat, sides=16)
            cap = L.dome(rx, top + float(roof.get("drumM", .8)), rz, r, roof_mat)
            L.planar_uv(cap)
            by_material[wall_top_mat].append(drum)
            by_material[roof_mat].append(cap)
            roof_top = top + float(roof.get("drumM", .8)) + r
    band = t.get("band") or {}
    if band.get("where") == "roof":
        # the dark band round the top of a wall (a Tibetan parapet): from band height up over the
        # roof edge, in the accent colour (`detailColours.local_detail_accent`)
        ring = upper_poly.buffer(.04, join_style="mitre")
        top_y = top + (PARAPET_HEIGHT if not pitched else PITCHED_EAVE_HEIGHT) + .02
        strip = extrude(ring, top - float(band.get("h", .7)), top_y, material=L.ACCENT, sink=0.0, caps=False)
        if strip is not None:
            by_material[L.ACCENT].append(strip)
    cornice = float(roof.get("corniceM", 0))
    if cornice > 0:
        # the stone cornice under the roof: a slab out from the wall, never over the road
        ring = upper_poly.buffer(cornice, join_style="mitre").difference(upper_poly.buffer(-.05, join_style="mitre"))
        if keep_clear is not None:
            ring = ring.difference(keep_clear)
        slab = _pinned_extrusion(ring, top - float(roof.get("corniceH", .5)), top, wall_top_mat)
        if slab is not None:
            by_material[wall_top_mat].append(slab)
    if near:
        roof_y = top + FLAT_CAP_HEIGHT if not pitched else (top + roof_top) / 2
        parts = L.rooftop(poly, roof_y, t, at, not pitched, storeys, roof_top, keep_clear)
        parts += L.facade_parts(poly, ground_y, ground_m, storey_m, storeys, t, at, towards, keep_clear)
        if not pitched and L._hash01(at, "battlements") < float(d.get("battlements", 0)):
            parts += L.battlements(poly, top + PARAPET_HEIGHT, wall_top_mat)
        floors = [f for f in d.get("balconyFloors", ()) if f < storeys]
        if floors and L._hash01(at, "balconies") < float(d.get("balconyShare", 1.0)):
            parts += L.balconies(poly, [ground_y + ground_m + f * storey_m for f in floors],
                                 float(d.get("balconyDepth", .7)), towards, keep_clear)
        if L._hash01(at, "fireescape") < float(d.get("fireEscape", 0)):
            parts += L.fire_escape(poly, ground_y, ground_m, storey_m, storeys, towards, keep_clear)
        if d.get("awnings"):
            parts += L.awnings(poly, ground_y, ground_m, float((t.get("window") or {}).get("bay", 3.0)),
                               towards, keep_clear, float(d["awnings"]), at, float(d.get("awningDepthM", 1.3)))
        for part in parts:
            by_material[part.material].append(part)
    return roof_top


def facade_for_route(route, tags, area=None, storeys=None, at=None):
    """`facade_for`, with the route's own palette for untagged buildings (`architecture.facades`).

    The shape table above was written for the Bay Area: office glass on anything big. A route in
    another city says what its ordinary buildings are made of, as {material: share}; a tag that
    names the use still wins, and glass is still only allowed where the shape says office-sized."""
    named = FACADE.get(str(tags.get("building", "")).lower())
    arch = route.get("architecture") or {}
    palette = arch.get("facades")
    # `facadesForAll`: in a city whose shops and offices are the same stone blocks as its flats
    # (a commercial building on the Champs-Elysees was a dark glass box), the palette covers tagged
    # uses too -- except the ones that really look different wherever they are.
    keeps_own = named in ("building_metal", "building_parking") or not arch.get("facadesForAll")
    if (named and keeps_own) or not palette or at is None:
        return facade_for(tags, area, storeys, at)
    value = (zlib.crc32(b"%.1f,%.1f:facade" % (at[0], at[1])) % 10000) / 10000.0
    total = 0.0
    for material, share in palette.items():
        total += float(share)
        if value < total:
            return material
    return list(palette)[-1]


# Materials a route may pin a mapped object to (`architecture.walls` / `architecture.byId`): solid,
# windowless walls. OSM draws a palace wall or a reviewing stand as `building=*`, and the facade
# table then gives it office windows and a roof -- Beijing's vermilion walls either side of
# Tiananmen came out as beige blocks with windows.
SOLID_WALLS = ("house_wall_red", "house_trim")


def pinned_wall(route, tags):
    """The solid-wall material the route pins this footprint to, or None.

    `architecture.byId` names single objects ("way:<id>"); `architecture.walls` covers everything OSM
    maps as `building=wall`. Without either key every building is built as before."""
    arch = route.get("architecture") or {}
    by_id = arch.get("byId") or {}
    named = [*by_id.values(), *([arch["walls"]] if arch.get("walls") else [])]
    bad = [m for m in named if m not in SOLID_WALLS]
    if bad:
        raise ValueError(f"{route.get('id')}: architecture walls/byId name {bad}; a wall is one of {SOLID_WALLS}")
    if tags.get("sr:facade-id") in by_id:
        return by_id[tags["sr:facade-id"]]
    if arch.get("walls") and str(tags.get("building", "")).lower() == "wall":
        return arch["walls"]
    return None


def facade_for(tags, area=None, storeys=None, at=None):
    """The material name for one footprint.

    A tag that names the use wins. Otherwise the shape decides, and `at` -- the footprint's centroid
    -- picks within that shape's choices, so the answer is stable across builds and different for
    neighbours. Nothing here can fail: OSM's `building` values are open-ended and a value nobody has
    seen before must cost that building a plain wall, not cost the route its build.
    """
    named = FACADE.get(str(tags.get("building", "")).lower())
    if named:
        return named
    if area is None or storeys is None or at is None:
        return DEFAULT_FACADE
    for max_area, max_storeys, choices in SHAPE_FACADES:
        if area <= max_area and storeys <= max_storeys:
            return choices[zlib.crc32(b"%.1f,%.1f" % (at[0], at[1])) % len(choices)]
    return DEFAULT_FACADE


def parse_height(tags):
    """Metres from a height tag, tolerating units and ranges. None when the tag is absent or unusable."""
    for key in ("height", "building:height"):
        raw = tags.get(key)
        if not raw:
            continue
        text = str(raw).strip().lower()
        # the unit has to be read before the number is extracted: "105'" parses as 105, then converts
        feet = text.endswith("'") or "ft" in text or "feet" in text
        m = re.search(r"\d+(?:\.\d+)?", text.split(";")[0])
        if not m:
            continue
        v = float(m.group()) * (0.3048 if feet else 1.0)
        if 1.0 <= v <= MAX_TAG_HEIGHT:
            return v
    for key in ("building:levels", "levels"):
        raw = tags.get(key)
        if not raw:
            continue
        m = re.search(r"\d+(?:\.\d+)?", str(raw).split(";")[0])
        if not m:
            continue
        levels = float(m.group())
        if 0 < levels <= 80:
            return levels * LEVEL_HEIGHT
    return None


def estimate_height(tags, area, table=AREA_STOREYS):
    storeys = TYPE_STOREYS.get(str(tags.get("building", "")).lower())
    if storeys is None:
        storeys = next((s for limit, s in table if area <= limit), table[-1][1] + 1 if table else 5)
    return max(storeys * LEVEL_HEIGHT, MIN_HEIGHT)


def route_height_guess(route, frame):
    """A per-route height guess for buildings the map gives no height: (tags, area, (x, z)) -> metres.

    AREA_STOREYS was tuned where a big footprint means a big building. In an old town a big footprint
    is a ring of one-storey rooms round a courtyard, and the table doubled a landmark's neighbours.
    A route may give its own table (`unmappedStoreys`) and declare low-rise circles (`lowRise`:
    lat, lon, radiusM, maxStoreys, why). A real `height` or `building:levels` tag always wins."""
    table = tuple(tuple(x) for x in route.get("unmappedStoreys", AREA_STOREYS))
    zones = []
    for zone in route.get("lowRise", ()):
        x, z = frame.to_local(zone["lat"], zone["lon"])
        zones.append((float(x), float(z), float(zone["radiusM"]), float(zone["maxStoreys"]) * LEVEL_HEIGHT))

    def guess(tags, area, at):
        h = estimate_height(tags, area, table)
        for x, z, r, cap in zones:
            if (at[0] - x) ** 2 + (at[1] - z) ** 2 <= r * r:
                h = min(h, max(cap, MIN_HEIGHT))
        return h
    return guess


def residential_use(tags, area, height):
    use = str(tags.get("building", "")).lower()
    return (use in ("house", "detached", "residential", "apartments", "terrace",
                    "semidetached_house", "bungalow")
            or use in ("yes", "") and area <= 520 and height <= 3 * LEVEL_HEIGHT)


def facade_identity(mesh, key, residential=False):
    """Encode a quantization-safe, stable per-building lighting identity before merging tiles."""
    seed = 1 + zlib.crc32(str(key).encode("utf-8")) % 1023
    mesh.facade = np.tile(np.array([seed / 1024, float(residential)], dtype=np.float32),
                          (len(mesh.positions), 1))
    return mesh


def underground(tags):
    """Mapped below the ground: a negative `layer`, or `location=underground`. Such an outline is a
    basement mall or a metro station box; drawn as a building it stood as a windowless block nobody
    could name beside Tiananmen Square (a player's screenshot) -- 28 of them across the World Tour's
    cities. Nothing of it shows above ground, so neither the town nor the backdrop draws it.
    """
    if str(tags.get("location", "")).lower() in ("underground", "underwater"):
        return True
    m = re.match(r"\s*(-?\d+(?:\.\d+)?)", str(tags.get("layer", "")))
    return bool(m) and float(m.group(1)) < 0


def flattened_outline(tags):
    """A Simple 3D Buildings outline its mapper pressed flat: `building:parts=yes` with a height under
    a metre. The parts carry the real shape; the outline is only there to be replaced by them.


    Both Golden Gate tower piers are mapped this way (height 0.01), and with the tag read as absent the
    height estimate stood a windowed office block on each pier in the strait. They are the only two
    such outlines in any route's cache; a plain building with a stray small height is not one of them.
    """
    if str(tags.get("building:parts", "")).lower() != "yes":
        return False
    for key in ("height", "building:height"):
        m = re.search(r"\d+(?:\.\d+)?", str(tags.get(key, "")))
        if m and float(m.group()) < 1.0:
            return True
    return False


def footprints(route_id, frame, layer="buildings", exclude_osm_ids=()):
    """(polygon, tags) for every building in a cached layer, in local meters."""
    excluded_ids = {int(osm_id) for osm_id in exclude_osm_ids}
    out = []
    try:
        elements = load_layer(route_id, layer)["elements"]
    except FileNotFoundError:
        return out
    for e in elements:
        if int(e.get("id", -1)) in excluded_ids:
            continue
        tags = {**e.get("tags", {}), "sr:facade-id": f"{e.get('type', 'way')}:{e.get('id', -1)}"}
        if "building" not in tags and "building:part" not in tags or flattened_outline(tags) or underground(tags):
            continue
        out.extend((poly, tags) for poly in element_polygons(e, frame))
    return out


def element_polygons(element, frame):
    """Turn one OSM way or multipolygon relation into valid local building polygons."""
    outers, inners = _rings(element)
    holes = [_local(frame, ring) for ring in inners if len(ring) >= 4]
    out = []
    for ring in outers:
        if len(ring) < 4:
            continue
        shell = _local(frame, ring)
        shell_poly = Polygon(shell)
        # Courtyards are holes, and a hole that is thrown away is a filled-in courtyard: the
        # building becomes a solid slab the size of the whole block. Shapely wants each hole
        # inside the shell it belongs to, so they are matched rather than handed over wholesale.
        poly = Polygon(shell, [hole for hole in holes if shell_poly.contains(Polygon(hole).centroid)])
        if not poly.is_valid:
            poly = poly.buffer(0)
        if isinstance(poly, Polygon) and poly.area >= MIN_AREA:
            out.append(poly)
    return out


def footprint_by_osm_id(route_id, frame, osm_id, layer="buildings"):
    """The one cached OSM building named by id, including any courtyard holes."""
    matches = [element for element in load_layer(route_id, layer).get("elements", [])
               if int(element.get("id", -1)) == int(osm_id)]
    if len(matches) != 1:
        raise ValueError(f"{route_id}: expected one OSM {layer} element {osm_id}, found {len(matches)}")
    polygons = element_polygons(matches[0], frame)
    if len(polygons) != 1:
        raise ValueError(f"{route_id}: OSM element {osm_id} produced {len(polygons)} polygons")
    return polygons[0], matches[0].get("tags", {})


def _local(frame, ring):
    x, z = frame.to_local([p["lat"] for p in ring], [p["lon"] for p in ring])
    return np.stack([x, z], axis=1)


def _rings(element):
    """(outer rings, inner rings). A way is one outer ring; a relation names its own."""
    if element.get("type") == "way":
        return _join_rings([element.get("geometry") or []]), []
    relation_type = element.get("tags", {}).get("type")
    if relation_type == "building":
        # A building relation groups one overall outline with optional building parts. Parts carry
        # their own heights and are not alternative outer rings; merging them under the relation's
        # tags duplicated Fisherman's Wharf and turned 50 Golden Gate bridge parts into fake towers.
        outlines = [member.get("geometry") or [] for member in element.get("members", [])
                    if member.get("role") == "outline" and member.get("geometry")]
        return _join_rings(outlines), []
    outers, inners = [], []
    for m in element.get("members", []):
        g = m.get("geometry") or []
        if not g:
            continue
        if m.get("role") == "outer":
            outers.append(g)
        elif m.get("role") == "inner":
            inners.append(g)
    return _join_rings(outers), _join_rings(inners)


def _point_key(point):
    return round(float(point["lat"]), 8), round(float(point["lon"]), 8)


def _join_rings(parts):
    """Join split multipolygon members; never invent the missing edge of an open chain.

    Overpass returns each relation member with its own geometry. Many real building relations split
    one outline across several ways, sometimes with either way reversed. Passing those fragments to
    ``Polygon`` separately silently closes every fragment with a long straight chord — the giant
    one-face buildings seen across Fisherman's Wharf and the Golden Gate approach.
    """
    chains = [list(part) for part in parts if len(part) >= 2]
    closed = []
    while chains:
        chain = chains.pop(0)
        while _point_key(chain[0]) != _point_key(chain[-1]):
            joined = False
            for i, other in enumerate(chains):
                a0, a1 = _point_key(chain[0]), _point_key(chain[-1])
                b0, b1 = _point_key(other[0]), _point_key(other[-1])
                if a1 == b0:
                    chain.extend(other[1:])
                elif a1 == b1:
                    chain.extend(reversed(other[:-1]))
                elif a0 == b1:
                    chain = other[:-1] + chain
                elif a0 == b0:
                    chain = list(reversed(other[1:])) + chain
                else:
                    continue
                chains.pop(i)
                joined = True
                break
            if not joined:
                break
        if len(chain) >= 4 and _point_key(chain[0]) == _point_key(chain[-1]):
            closed.append(chain)
    return closed



SHOULDER = 3.7


DECK_CLEAR = 3.0     # a roof within this of a deck above it (or higher) is cut back from the deck


def bridge_decks(res, road_y, margin=SHOULDER):
    """[(plan polygon, lowest deck height)] for each continuous bridge run of the racing line."""
    from shapely.geometry import LineString
    bridge = np.asarray(res.bridge, dtype=bool)
    out = []
    i = 0
    while i < len(bridge):
        if not bridge[i]:
            i += 1
            continue
        j = i
        while j < len(bridge) and bridge[j]:
            j += 1
        if j - i >= 2:
            piece = res.P[i:j, [0, 2]]
            width = float(np.max(res.half_width[i:j])) + margin
            out.append((LineString(piece).buffer(width, cap_style="flat"), float(np.min(road_y[i:j]))))
        i = j
    return out


ROOF_PITCH = 0.55          # rise per metre in from the eave: about 29 degrees
ROOF_MAX_RISE = 3.6
ROOF_RING_STEP = 1.2


def outline_hip_roof(poly, eave_y, material, pitch=ROOF_PITCH, max_rise=ROOF_MAX_RISE):
    """A hipped roof that fits any outline: the eave is the outline itself, and the surface rises
    with the distance in from the nearest eave. Samples on inset rings keep the ridges where the
    rings fold; triangles are kept only when their centroid and edge midpoints are inside, so a
    concave notch is never bridged."""
    from scipy.spatial import Delaunay
    from shapely import contains_xy
    from shapely.geometry import Polygon as P
    from sr.mesh import from_triangles, orient_to
    if poly.is_empty or poly.area < 4:
        return None
    pts = []
    d = 0.0
    while True:
        ring = poly.buffer(-d, join_style="mitre") if d else poly
        if ring.is_empty:
            break
        for part in getattr(ring, "geoms", [ring]):
            coords = np.asarray(part.exterior.coords)[:-1]
            step = max(1, int(len(coords) / 200))
            pts.extend(coords[::step].tolist())
            n = max(int(part.exterior.length / 2.0), 3)
            pts.extend([part.exterior.interpolate(i / n, normalized=True).coords[0] for i in range(n)])
        d += ROOF_RING_STEP
        if d * pitch > max_rise + ROOF_RING_STEP * pitch:
            break
    c = poly.representative_point()
    pts.append((c.x, c.y))
    xz = np.unique(np.round(np.asarray(pts, dtype=np.float64), 3), axis=0)
    if len(xz) < 3:
        return None
    tri = Delaunay(xz).simplices
    a, b, cc = xz[tri[:, 0]], xz[tri[:, 1]], xz[tri[:, 2]]
    keep = np.ones(len(tri), dtype=bool)
    shrunk = poly.buffer(1e-3)
    for probe in ((a + b + cc) / 3, (a + b) / 2, (b + cc) / 2, (cc + a) / 2):
        keep &= contains_xy(shrunk, probe[:, 0], probe[:, 1])
    tri = tri[keep]
    if not len(tri):
        return None
    boundary = poly.exterior
    dist = np.array([boundary.distance(__import__("shapely").geometry.Point(x, z)) for x, z in xz])
    y = eave_y + np.minimum(dist * pitch, max_rise)
    positions = np.c_[xz[:, 0], y, xz[:, 1]]
    return from_triangles(positions, orient_to(positions, tri, [0, 1, 0]), material)


def road_footprint(res, margin=SHOULDER, include_bridges=True):
    """The ground the race surface covers, plus its shoulder, as a polygon.

    A single buffer at the widest point was fine while the widest point was nine metres; once the
    bridge deck is fourteen it sweeps a thirty metre corridor clean of buildings for the whole route.
    Widths change slowly, so buffering runs of similar width and unioning them costs little and keeps
    the buildings that a nine metre street never came near.

    Building clipping passes ``include_bridges=False``: an elevated deck may cross a real building
    far below it. Fort Point sits directly under the Golden Gate, and clipping its footprint against
    the bridge's plan shadow deleted 40% of the fort even though their heights never meet."""
    from shapely.geometry import LineString, Polygon
    from shapely.ops import unary_union

    xz = res.P[:, [0, 2]]
    hw = np.asarray(res.half_width)
    step = np.round(hw * 2) / 2.0          # half-metre bands, so a run is long
    bridge = np.asarray(res.bridge, dtype=bool)
    parts = []
    start = 0
    for i in range(1, len(step) + 1):
        if (i < len(step) and step[i] == step[start]
                and (include_bridges or bridge[i] == bridge[start])):
            continue
        piece = xz[start:min(i + 1, len(xz))]
        if len(piece) >= 2 and (include_bridges or not bridge[start]):
            parts.append(LineString(piece).buffer(float(hw[start:i].max()) + margin, quad_segs=4))
        start = i
    if parts:
        return unary_union(parts)
    return (LineString(xz).buffer(float(hw.max()) + margin)
            if include_bridges else Polygon())


def load_landmark_footprints(frame, path=None, names=None):
    """Areas covered by a hand-built landmark model; OSM buildings inside them are dropped."""
    return landmark_footprints(frame, path, names=names)


# Where a roof samples its facade texture. One point, so the whole roof is one flat colour.
#
# A facade texture is a wall seen from the street, and a roof's uvs are world x/z, so tiling the
# same image across a roof lays curtain wall or the horizontal slots of a parking deck flat on top
# of every building in the city. The runtime's procedural window grid already knew this and skipped
# anything facing up, but that rule is compiled out wherever a texture is present, so nothing was
# left to catch it. Pinning the roof to one texel puts each roof in its own building's colour --
# dark on a glass tower, pale on a stucco house -- for the cost of two numbers. The point sits on
# the mullion of the glass and on the spandrel of the parking deck, both of which are the grey a
# roof should be; it is never inside a window.
ROOF_UV = (0.02, 0.02)


def extrude(poly, base, top, material="building", uv_scale=BUILDING_UV_METRES, sink=SINK, caps=True):
    """A closed building volume with vertical walls, a flat roof and a buried floor.

    The floor is below the terrain and normally invisible. It still matters: without it every
    building is an open shell, so a clipped hillside or a camera below the local terrain can look
    straight through the whole block into the sky. A real building may have foundations we never
    draw, but it is never a one-sided lampshade.
    """
    if len(poly.exterior.coords) < 4:
        return None
    # OSM does not promise winding, and Shapely repairs/boolean operations may change it. All wall
    # geometry is single-sided, so make the exterior CCW and every courtyard CW at the one entry
    # point used by generic buildings and programmatic landmarks.
    poly = orient(poly, sign=1.0)
    pos, nor, uv, idx = [], [], [], []
    # the outside and every courtyard: an interior ring winds the other way, so the same normal
    # formula turns its walls inward, which is where the courtyard is looked at from
    for boundary in [poly.exterior, *poly.interiors]:
        ring = np.asarray(boundary.coords[:-1], dtype=np.float64)
        n = len(ring)
        if n < 3:
            continue
        run = 0.0
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            edge = b - a
            seg = float(np.hypot(*edge))
            if seg < 1e-6:
                continue
            d = edge / seg
            normal = (d[1], 0.0, -d[0])
            base_i = len(pos)
            for corner, y, u in ((a, base - sink, run), (b, base - sink, run + seg),
                                 (b, top, run + seg), (a, top, run)):
                pos.append((corner[0], y, corner[1]))
                nor.append(normal)
                uv.append((u / uv_scale, (y - base) / uv_scale))
            idx += [base_i, base_i + 1, base_i + 2, base_i, base_i + 2, base_i + 3]
            run += seg
    if not pos:
        return None
    walls = orient_by_shading(Mesh(np.array(pos), np.array(nor), np.array(uv), np.array(idx), material))
    roof_tris = _roof_triangles(poly) if caps else None
    if roof_tris:
        rp, ri, bp, bi = [], [], [], []
        for t in roof_tris:
            c = np.asarray(t.exterior.coords[:-1], dtype=np.float64)
            k = len(rp)
            rp += [(p[0], top, p[1]) for p in c]
            ri += [k, k + 2, k + 1]
            k = len(bp)
            bp += [(p[0], base - sink, p[1]) for p in c]
            bi += [k, k + 1, k + 2]
        rp = np.array(rp)
        roof = from_triangles(rp, orient_to(rp, np.array(ri).reshape(-1, 3), [0.0, 1.0, 0.0]), material, uv_scale)
        roof.uvs[:] = ROOF_UV
        bp = np.array(bp)
        floor = from_triangles(bp, orient_to(bp, np.array(bi).reshape(-1, 3), [0.0, -1.0, 0.0]), material, uv_scale)
        floor.uvs[:] = ROOF_UV
        return merge([walls, roof, floor], material)
    return walls


WINDOW_TEXTURES = {"building_glass", "building_stucco", "building_parking",
                   "building_landmark_glass"}
FLAT_CAP_HEIGHT = .42
PARAPET_HEIGHT = .94
PITCHED_EAVE_HEIGHT = .18


def _shape_polygons(shape):
    if isinstance(shape, Polygon):
        return [shape]
    return [part for part in getattr(shape, "geoms", ()) if isinstance(part, Polygon)]


def _pinned_extrusion(shape, bottom, top, material):
    meshes = []
    for poly in _shape_polygons(shape):
        if poly.area <= .01:
            continue
        mesh = extrude(poly, bottom, top, material=material, sink=0.0)
        if mesh is not None:
            mesh.uvs[:] = ROOF_UV
            meshes.append(mesh)
    return merge(meshes, material) if meshes else None


def roofline_bottom(base, top, material):
    """Lowest no-window fascia height that removes an incomplete top row, in world metres."""
    height = max(0.0, float(top - base))
    if material == "building":
        # The shader's complete panes end at 3.02 + 3.5 n metres above each building base.
        completed = 3.02 + np.floor((height - 3.02) / 3.5) * 3.5 if height >= 3.02 else 0.0
    elif material in WINDOW_TEXTURES:
        # Textured facades repeat every three metres. Start just inside the frame at the last full
        # repeat, so a partial next repeat is covered as one roof band instead of half a window.
        completed = max(0.0, np.floor(height / BUILDING_UV_METRES) * BUILDING_UV_METRES - .18)
    else:
        completed = max(0.0, height - .55)
    return float(base + min(completed, max(0.0, height - .08)))


def finish_roof(poly, base, top, material, kind="flat"):
    """Visible eave plus either a flat parapet or the base for a pitched roof.

    The cap replaces the last partial facade repeat within the surveyed footprint; callers end
    their windowed walls at roofline_bottom. Flat buildings get
    a real raised parapet; pitched buildings get a thin eave and return the y where slopes begin.
    """
    # Stay inside the footprint that has already been clipped against the race surface. Even a
    # fourteen-centimetre decorative overhang can put triangles back onto a road at a flush kerb.
    shell = poly
    cap_top = top + (FLAT_CAP_HEIGHT if kind == "flat" else PITCHED_EAVE_HEIGHT)
    cap = _pinned_extrusion(shell, roofline_bottom(base, top, material), cap_top, material)
    if kind != "flat":
        return cap, cap_top, cap_top

    inset = shell.buffer(-.34, join_style="mitre")
    edge = shell if inset.is_empty else shell.difference(inset)
    parapet = _pinned_extrusion(edge, cap_top, top + PARAPET_HEIGHT, material)
    return merge([cap, parapet], material), cap_top, top + PARAPET_HEIGHT


def roof_fascia(poly, top):
    """A no-window band around an occupied roof without filling the drivable roof surface."""
    outer = poly.buffer(.35, join_style="round")
    inner = poly.buffer(-.35, join_style="round")
    edge = outer if inner.is_empty else outer.difference(inner)
    
    return _pinned_extrusion(edge, top - BUILDING_UV_METRES, top + .10,
                             "building_landmark_roof")


def _roof_triangles(poly, depth=0):
    """A roof that stays inside its own outline.

    shapely's triangulate is a Delaunay of the *vertices*: it knows nothing about which edges are
    real. On a convex footprint that is the same answer; on a clipped one -- an L, or a block with
    the road bitten out of it -- it produces triangles whose centroid is inside the shape and whose
    corner sticks out across the notch. The notch is the road, so the roof was hanging over it after
    the footprint had been correctly clipped away from it.

    Triangles that are not fully inside are re-triangulated against the piece that is. Two passes
    take the leftovers below a quarter of a square metre, which is the size the build's own
    clearance check calls a sliver.
    """
    out = []
    for t in triangulate(poly):
        if not poly.intersects(t):
            continue
        if poly.covers(t):
            out.append(t)
            continue
        if depth >= 2:
            continue
        piece = poly.intersection(t)
        for part in getattr(piece, "geoms", [piece]):
            if isinstance(part, Polygon) and part.area > 1e-6:
                out.extend(_roof_triangles(part, depth + 1))
    return out


def yaw_for_long_axis(e0):
    """Yaw that puts a box's local x axis along `e0`.

    A yaw rotates local x to (cos, -sin) in world (x, z) -- the same convention the mesh generator
    and Rapier use. Deriving it any other way silently turns every box a quarter turn, which for a
    long building means its length lies across the street instead of along it."""
    return yaw_for_x_axis(e0)


def oriented_box(poly, base, top):
    """Minimum-area rectangle of the footprint as (center, half extents, yaw)."""
    rect = np.asarray(poly.minimum_rotated_rectangle.exterior.coords[:-1], dtype=np.float64)
    if len(rect) != 4:
        c = poly.centroid
        r = np.sqrt(poly.area) / 2
        return (c.x, (base + top) / 2, c.y), (r, (top - base) / 2, r), 0.0
    e0 = rect[1] - rect[0]
    e1 = rect[2] - rect[1]
    if np.hypot(*e0) < np.hypot(*e1):
        e0, e1 = e1, e0
    center = rect.mean(axis=0)
    return ((center[0], (base + top) / 2, center[1]),
            (float(np.hypot(*e0)) / 2, (top - base) / 2, float(np.hypot(*e1)) / 2), yaw_for_long_axis(e0))


CELL = 3.0                # grid step when a footprint has to be broken into several boxes
MAX_CELL_BOXES = 48


def decompose_boxes(poly, base, top, cell=CELL, max_boxes=MAX_CELL_BOXES):
    """Cover a footprint with axis-aligned-in-its-own-frame boxes that stay inside it.

    One oriented box per building is cheap and right for the rectangular ones, but a courtyard, an
    L or anything curved has a bounding box far larger than the building, and on a street that box
    reaches across the road. Rows of smaller boxes follow the outline instead."""
    rect = poly.minimum_rotated_rectangle
    coords = np.asarray(rect.exterior.coords[:-1], dtype=np.float64)
    if len(coords) != 4:
        return []
    e0 = coords[1] - coords[0]
    e1 = coords[2] - coords[1]
    if np.hypot(*e0) < np.hypot(*e1):
        e0 = e1
    yaw_world = yaw_for_long_axis(e0)
    centre = poly.centroid
    # work in a frame where the long edge is horizontal, then rotate the pieces back
    angle = np.degrees(np.arctan2(e0[1], e0[0]))
    local = affinity.rotate(poly, -angle, origin=centre, use_radians=False)
    x0, y0, x1, y1 = local.bounds
    cols = max(int(np.ceil((x1 - x0) / cell)), 1)
    rows = max(int(np.ceil((y1 - y0) / cell)), 1)
    if cols * rows > 4000:
        return []
    out = []
    for r in range(rows):
        ry0 = y0 + r * cell
        ry1 = min(ry0 + cell, y1)
        run_start = None
        for c in range(cols + 1):
            cx0 = x0 + c * cell
            # the cell has to be wholly inside: a collider that pokes out of its own building is
            # exactly the failure this decomposition exists to avoid
            inside = c < cols and local.contains(shapely_box(cx0, ry0, min(cx0 + cell, x1), ry1).buffer(-0.05))
            if inside and run_start is None:
                run_start = cx0
            elif not inside and run_start is not None:
                out.append((run_start, ry0, cx0, ry1))
                run_start = None
        if len(out) > max_boxes:
            return []
    boxes = []
    for bx0, by0, bx1, by1 in out:
        piece = affinity.rotate(shapely_box(bx0, by0, bx1, by1), angle, origin=centre, use_radians=False)
        pc = piece.centroid
        boxes.append([pc.x, (base + top) / 2, pc.y,
                      (bx1 - bx0) / 2, (top - base) / 2, (by1 - by0) / 2, yaw_world])
    return boxes


def build_buildings(res, road_y, dem, route_id, corridor, layer="buildings", collider_radius=COLLIDER_RADIUS,
                    keep_clear=None, return_visual_boxes=False):
    """Extruded footprints plus box colliders for the ones close enough to hit.

    The optional third result covers every drawn building, including distant non-colliders. It is
    used for billboard sight lines, where a wall can hide a face without being close enough for the
    car to hit it.
    """
    from shapely import contains_xy
    from scipy.spatial import cKDTree

    tree = cKDTree(res.P[:, [0, 2]])
    from sr.routes import load_route
    route = load_route(route_id)
    excluded = landmark_footprints(res.frame, names=route.get("landmarks"))
    # No current route declares a `roofLoop` (the OSM relation whose ordinary footprint this used
    # to exclude, so the roof-support shell's own extrusion did not get a second walled copy from
    # the generic building pass); `footprints()` still accepts `exclude_osm_ids` generically.
    excluded_osm_ids = ()
    if keep_clear is None:
        # Only a road resting on the ground owns the footprint below it. Elevated bridge decks can
        # cross buildings without cutting their visual mesh or collider; vertical separation keeps
        # the two physical shapes apart.
        keep_clear = road_footprint(res, include_bridges=False)
    decks = bridge_decks(res, road_y)
    guess = route_height_guess(route, res.frame)
    keep = []
    for poly, tags in footprints(route_id, res.frame, layer, exclude_osm_ids=excluded_osm_ids):
        c = poly.centroid
        if not contains_xy(corridor, c.x, c.y):
            continue
        if any(x.intersects(poly) for x in excluded):
            continue
        # An elevated deck passes over low buildings, but a building whose roof reaches the deck
        # (within DECK_CLEAR of it, or above) stands in it: cut it back like any road. Height
        # separation alone let one wall poke through a viaduct's deck.
        for deck, deck_y in decks:
            if not deck.intersects(poly):
                continue
            ground = float(ground_height(res, road_y, dem, np.array([[c.x, c.y]]), tree)[0])
            height = parse_height(tags) or guess(tags, poly.area, (c.x, c.y))
            if ground + height >= deck_y - DECK_CLEAR:
                poly = poly.difference(deck)
        if poly.is_empty:
            continue
        if poly.geom_type != "Polygon":
            parts = [g for g in getattr(poly, "geoms", []) if g.geom_type == "Polygon" and g.area >= 12.0]
            if not parts:
                continue
            poly = max(parts, key=lambda g: g.area)
        # The road wins, and it has to win in the geometry as well as in the physics.
        #
        # The collider below already refuses to put a box over the racing surface, but the mesh was
        # drawn from the raw footprint: a building whose corner reaches into the road was drawn
        # standing in it and had nothing to hit, so the player saw a wall across the road and then
        # drove straight through it. It happened on nine of the eleven routes -- a hundred and
        # eleven buildings between them -- because the racing surface is deliberately wider than
        # the street it is based on, so a building set back from the real kerb still lands on ours.
        use = residential_use(tags, poly.area, parse_height(tags) or guess(tags, poly.area, (c.x, c.y)))
        for part in _outside(poly, keep_clear):
            keep.append((part, {**tags, "sr:facade-id": tags.get("sr:facade-id",
                        f"{route_id}:{c.x:.3f}:{c.y:.3f}"), "sr:residential": use}, part.centroid))
    if not keep:
        return ({}, [], []) if return_visual_boxes else ({}, [])
    centres = np.array([[c.x, c.y] for _, _, c in keep])
    centre_ground = ground_height(res, road_y, dem, centres, tree)
    # A centroid is enough for a lamp post, not for a city block on a hill. Put each floor below the
    # lowest finished-ground sample around its own outline so no downhill camera can see the dark
    # underside floating in the air. The roof still follows the centroid datum, preserving height.
    base = np.array([_building_base(res, road_y, dem, poly, tree) for poly, _, _ in keep])
    dist = tree.query(centres)[0]
    by_material, boxes, visual_boxes = defaultdict(list), [], []
    from sr.vistas import choose_roof
    from sr.architecture import house_style, roof_material, house_details
    arch = route.get("architecture") or {}
    from sr import local_style
    local_types = local_style.localise(local_style.types(route), res.frame)
    zones = ruin_zones(route, res.frame)
    for (poly, tags, c), b, centre_y, d in zip(keep, base, centre_ground, dist):
        if is_ruin(tags) or in_ruin_zone(tags, c, zones):
            # Walls a few metres high with no roof and no windows: an excavated tomb field or a forum
            # built as houses was the first thing one remix's pyramids and ruins were seen beside.
            h = min(parse_height(tags) or float(np.clip(1.6 + .12 * poly.area ** .5, 2.0, 6.0)), 12.0)
            m = extrude(poly, b, centre_y + h, material=RUIN)
            if m is not None:
                by_material[RUIN].append(m)
                (cx, cy, cz), (hx, hy, hz), yaw = oriented_box(poly, b - SINK, centre_y + h)
                visual_boxes.append([cx, cy, cz, hx, hy, hz, yaw])
                if d <= collider_radius and not box_polygon(cx, cz, hx, hz, yaw).intersects(keep_clear):
                    boxes.append([cx, cy, cz, hx, hy, hz, yaw])
            continue
        tagged = parse_height(tags)
        guessed = guess(tags, poly.area, (c.x, c.y))
        local = None
        if local_types and not pinned_wall(route, tags) \
                and FACADE.get(str(tags.get("building", "")).lower()) not in ("building_metal", "building_parking"):
            local = local_style.choose(local_types, tags, (tagged or guessed) / LEVEL_HEIGHT, poly.area, (c.x, c.y))
        if local is not None:
            nearest = res.P[tree.query([c.x, c.y])[1], [0, 2]]
            roof_top = _local_building(poly, tags, local, b, centre_y, tagged, guessed, (c.x, c.y), nearest,
                                       d <= local_style.DETAIL_RADIUS, keep_clear, by_material)
            (cx, cy, cz), (hx, hy, hz), yaw = oriented_box(poly, b - SINK, roof_top)
            visual_boxes.append([cx, cy, cz, hx, hy, hz, yaw])
            if d > collider_radius:
                continue
            if box_polygon(cx, cz, hx, hz, yaw).intersects(keep_clear):
                boxes.extend(q for q in decompose_boxes(poly, b - SINK, roof_top)
                             if not box_polygon(q[0], q[2], q[3], q[5], q[6]).intersects(keep_clear))
                continue
            boxes.append([cx, cy, cz, hx, hy, hz, yaw])
            continue
        h = tagged or guessed
        top = centre_y + min(h, MAX_HEIGHT)
        material = facade_for_route(route, tags, area=poly.area, storeys=h / LEVEL_HEIGHT, at=(c.x, c.y))
        if tags["sr:residential"] and not arch.get("facades"):
            material = "building_stucco"
        # A wall is a wall: no windows, no pitched roof, no porch (`architecture.walls` / `byId`).
        pinned = pinned_wall(route, tags)
        if pinned:
            material = pinned
        # The windowed wall ends where its opaque roof band begins. Two full-height shells
        # on the same footprint make their different facade UVs fight for the same depth.
        m = extrude(poly, b, roofline_bottom(b, top, material), material=material)
        if m is None:
            continue
        roof_kind = "flat"
        if tags["sr:residential"] and not pinned:
            roof_kind = choose_roof(route_id, f"{c.x:.1f}:{c.y:.1f}", near=True)
        pitched = arch.get("pitched")
        if pitched and not pinned and h / LEVEL_HEIGHT <= float(pitched.get("maxStoreys", 4)) \
                and (zlib.crc32(b"%.1f,%.1f:roof" % (c.x, c.y)) % 1000) / 1000.0 < float(pitched.get("share", 0)):
            # the city's own roofscape: tiled or slated roofs on its low buildings, tagged or not
            roof_kind = pitched.get("kind", "hip")
        style = house_style(route_id, roof_kind, h)
        effective_roof = roof_kind
        outline_roof = False
        if roof_kind != "flat":
            rect = poly.minimum_rotated_rectangle
            # A roof on the rectangle round an L-shaped or road-clipped footprint hangs over its yard
            # and the road. Those get a hip roof grown from their own outline instead -- the original
            # made them flat, a third of one remix's houses by area.
            if not (rect.area > 0 and poly.area / rect.area >= .94
                    and not rect.intersects(keep_clear)):
                effective_roof, outline_roof = "flat", True
        finish, roof_base, roof_top = finish_roof(poly, b, top, material, effective_roof)
        m = merge([m, finish], material)
        if effective_roof != "flat":
            rect = poly.minimum_rotated_rectangle
            if rect.area > 0:
                (roof_x, _roof_y, roof_z), (roof_hx, _roof_hy, roof_hz), roof_yaw = \
                    oriented_box(poly, b - SINK, top)
                rise = max(1.2, min(3.6, 0.36 * min(roof_hx, roof_hz)))
                roof_mat = (arch.get("pitched") or {}).get("roofMaterial") or roof_material(style)
                for roof in pitched_roof_parts((roof_x, roof_base, roof_z), (roof_hx, roof_hz), roof_yaw, rise,
                                               effective_roof, roof_mat, end_material=material):
                    if roof.material == material:
                        facade_identity(roof, tags["sr:facade-id"], tags["sr:residential"])
                    by_material[roof.material].append(roof)
                roof_top = roof_base + rise
        if outline_roof:
            # the city's own roofing, as the rectangular branch above uses: the style default is tile,
            # and it put red roofs on most of one remix's slate-and-zinc city (non-rectangular blocks)
            hip = outline_hip_roof(poly, roof_base, (arch.get("pitched") or {}).get("roofMaterial") or roof_material(style))
            if hip is not None:
                by_material[hip.material].append(hip)
                roof_top = float(hip.positions[:, 1].max())
        facade_identity(m, tags["sr:facade-id"], tags["sr:residential"])
        by_material[material].append(m)
        if tags["sr:residential"] and not pinned:
            nearest = tree.query([c.x, c.y])[1]
            accents = house_details(poly, centre_y, roof_base, style,
                                    res.P[nearest, [0, 2]], keep_clear,
                                    lambda points: ground_height(res, road_y, dem, points, tree))
            for accent in accents:
                facade_identity(accent, tags["sr:facade-id"], True)
                by_material[accent.material].append(accent)
                # Trim may stand in the setback; it must not become a drive-through porch.
                points = accent.positions
                shape = Polygon(points[:, [0, 2]]).convex_hull
                if shape.area <= .001:
                    continue
                cc, hh, yy = oriented_box(shape, float(points[:, 1].min()), float(points[:, 1].max()))
                bounds = [*cc, *hh, yy]
                visual_boxes.append(bounds)
                if d <= collider_radius and not box_polygon(cc[0], cc[2], hh[0], hh[2], yy).intersects(keep_clear):
                    boxes.append(bounds)
        (cx, cy, cz), (hx, hy, hz), yaw = oriented_box(poly, b - SINK, roof_top)
        visual_boxes.append([cx, cy, cz, hx, hy, hz, yaw])
        if d > collider_radius:
            continue
        if box_polygon(cx, cz, hx, hz, yaw).intersects(keep_clear):
            # this building's bounding box reaches over the road, so cover it with smaller ones
            pieces = [q for q in decompose_boxes(poly, b - SINK, top)
                      if not box_polygon(q[0], q[2], q[3], q[5], q[6]).intersects(keep_clear)]
            boxes.extend(pieces)
            continue
        boxes.append([cx, cy, cz, hx, hy, hz, yaw])
    result = ({name: merge(parts, name) for name, parts in sorted(by_material.items())}, boxes)
    return (*result, visual_boxes) if return_visual_boxes else result


def _building_base(res, road_y, dem, poly, tree, spacing=8.0):
    """Lowest finished ground around a footprint, sampled densely enough for city terrain."""
    samples = []
    for boundary in [poly.exterior, *poly.interiors]:
        ring = np.asarray(boundary.coords, dtype=np.float64)
        for a, b in zip(ring[:-1], ring[1:]):
            steps = max(1, int(np.ceil(np.hypot(*(b - a)) / spacing)))
            samples.extend(a + (b - a) * (i / steps) for i in range(steps))
    samples.append(np.asarray(poly.centroid.coords[0], dtype=np.float64))
    return float(ground_height(res, road_y, dem, np.asarray(samples), tree).min())


def _outside(poly, road):
    """The parts of a footprint that are not on the racing surface, as whole polygons.

    Slivers are dropped rather than drawn: clipping a corner off a building leaves the odd
    half-metre triangle behind the kerb, which is a few triangles and a Z-fighting seam for
    something nobody can see."""
    if not poly.intersects(road):
        return [poly]
    rest = poly.difference(road)
    if rest.is_empty:
        return []
    parts = list(getattr(rest, "geoms", [rest]))
    return [p for p in parts if isinstance(p, Polygon) and p.area >= MIN_AREA]


def box_polygon(cx, cz, hx, hz, yaw):
    """Footprint a box collider actually occupies, using the engine's own rotation convention."""
    c, s = np.cos(yaw), np.sin(yaw)
    pts = []
    for dx, dz in ((-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)):
        pts.append((cx + dx * c + dz * s, cz - dx * s + dz * c))
    return Polygon(pts)
