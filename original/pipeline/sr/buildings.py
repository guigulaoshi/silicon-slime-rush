"""OpenStreetMap building footprints extruded to greybox volumes with oriented box colliders.

Only about two thirds of the footprints here carry a height or a storey count, so the rest are
estimated from what the building is and how big its footprint is. Getting a two storey house wrong
by a meter is invisible; getting a tower wrong is not, and towers are the ones that are tagged."""
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
from sr.mesh import (BUILDING_UV_METRES, Mesh, from_triangles, merge, orient_by_shading,
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


def estimate_height(tags, area):
    storeys = TYPE_STOREYS.get(str(tags.get("building", "")).lower())
    if storeys is None:
        storeys = next((s for limit, s in AREA_STOREYS if area <= limit), 5)
    return max(storeys * LEVEL_HEIGHT, MIN_HEIGHT)


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
        if "building" not in tags and "building:part" not in tags or flattened_outline(tags):
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


def extrude(poly, base, top, material="building", uv_scale=BUILDING_UV_METRES, sink=SINK):
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
    roof_tris = _roof_triangles(poly)
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
    roof_relation = route.get("roofLoop", {}).get("osmRelation")
    excluded_osm_ids = () if roof_relation is None else (roof_relation,)
    if keep_clear is None:
        # Only a road resting on the ground owns the footprint below it. Elevated bridge decks can
        # cross buildings without cutting their visual mesh or collider; vertical separation keeps
        # the two physical shapes apart.
        keep_clear = road_footprint(res, include_bridges=False)
    keep = []
    for poly, tags in footprints(route_id, res.frame, layer, exclude_osm_ids=excluded_osm_ids):
        c = poly.centroid
        if not contains_xy(corridor, c.x, c.y):
            continue
        if any(x.intersects(poly) for x in excluded):
            continue
        # The road wins, and it has to win in the geometry as well as in the physics.
        #
        # The collider below already refuses to put a box over the racing surface, but the mesh was
        # drawn from the raw footprint: a building whose corner reaches into the road was drawn
        # standing in it and had nothing to hit, so the player saw a wall across the road and then
        # drove straight through it. It happened on nine of the eleven routes -- a hundred and
        # eleven buildings between them -- because the racing surface is deliberately wider than
        # the street it is based on, so a building set back from the real kerb still lands on ours.
        use = residential_use(tags, poly.area, parse_height(tags) or estimate_height(tags, poly.area))
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
    for (poly, tags, c), b, centre_y, d in zip(keep, base, centre_ground, dist):
        h = parse_height(tags) or estimate_height(tags, poly.area)
        top = centre_y + min(h, MAX_HEIGHT)
        material = facade_for(tags, area=poly.area, storeys=h / LEVEL_HEIGHT, at=(c.x, c.y))
        if tags["sr:residential"]:
            material = "building_stucco"
        # The windowed wall ends where its opaque roof band begins. Two full-height shells
        # on the same footprint make their different facade UVs fight for the same depth.
        m = extrude(poly, b, roofline_bottom(b, top, material), material=material)
        if m is None:
            continue
        roof_kind = "flat"
        if tags["sr:residential"]:
            roof_kind = choose_roof(route_id, f"{c.x:.1f}:{c.y:.1f}", near=True)
        style = house_style(route_id, roof_kind, h)
        effective_roof = roof_kind
        if roof_kind != "flat":
            rect = poly.minimum_rotated_rectangle
            # A roof using the rectangle around an L-shaped or road-clipped footprint hangs over
            # its yard and road. Keep those uncommon shapes flat; ordinary rectangular houses use
            # the same centre, axes and extents as their established collision owner.
            if not (rect.area > 0 and poly.area / rect.area >= .94
                    and not rect.intersects(keep_clear)):
                effective_roof = "flat"
        finish, roof_base, roof_top = finish_roof(poly, b, top, material, effective_roof)
        m = merge([m, finish], material)
        if effective_roof != "flat":
            rect = poly.minimum_rotated_rectangle
            if rect.area > 0:
                (roof_x, _roof_y, roof_z), (roof_hx, _roof_hy, roof_hz), roof_yaw = \
                    oriented_box(poly, b - SINK, top)
                rise = max(1.2, min(3.6, 0.36 * min(roof_hx, roof_hz)))
                for roof in pitched_roof_parts((roof_x, roof_base, roof_z), (roof_hx, roof_hz), roof_yaw, rise,
                                               effective_roof, roof_material(style), end_material=material):
                    if roof.material == material:
                        facade_identity(roof, tags["sr:facade-id"], tags["sr:residential"])
                    by_material[roof.material].append(roof)
                roof_top = roof_base + rise
        facade_identity(m, tags["sr:facade-id"], tags["sr:residential"])
        by_material[material].append(m)
        if tags["sr:residential"]:
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
