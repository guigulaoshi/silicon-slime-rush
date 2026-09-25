"""The land you can see but never drive on: hills, water and the tall buildings on the skyline.

Everything else the pipeline makes lives in 256 m tiles that stream in around the car, which works
because the car is always in the middle of them. It does not work for the view: standing on the
Golden Gate you are looking at Alcatraz four kilometres away and the city eight, and neither will
ever be inside a tile. So one coarse mesh covers the whole backdrop radius, is loaded once, and
stays resident.

It is deliberately cheap. Elevation comes from zoom 12 tiles (about forty metres a pixel), the
ground is sampled every sixty metres near the route and every two hundred far away, and the only
buildings are the ones the map says are eight storeys or more -- at four kilometres a house is a
pixel, and a tower is the skyline."""
import numpy as np
from scipy.spatial import Delaunay, cKDTree
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from sr.fetch_osm import load_layer
from sr.geom import grid_chunks
from sr.landmark_data import footprints as landmark_footprints
from sr.landmarks import build as build_landmarks
from sr.mesh import Mesh, box, from_triangles, merge, orient_to, ribbon, yaw_for_x_axis
from sr.routes import load_route

NEAR_SPACING = 60.0       # ground samples close to the route
FAR_SPACING = 200.0       # and out at the edge of the world
NEAR_RADIUS = 2000.0      # where one gives way to the other
LEVEL_HEIGHT = 3.5
MIN_LEVELS = 8            # the fetch already filters to this; kept here so the two cannot drift
SHORE = -0.5              # land is never drawn deeper than this below the water
PROBE_SLACK = NEAR_SPACING / 2   # how far inside the pad a boundary triangle's probes may reach
WATER_SINK = 0.05         # the backdrop sea sits this far under the corridor's, so the overlap cannot z-fight


def sample_grid(res, radius, corridor_pad):
    """Ground sample positions: a fine lattice near the route, a coarse one out to the radius.

    Points inside the corridor are dropped outright -- the streamed tiles already cover that ground
    at 2.5 m, and two meshes of the same hillside at different resolutions z-fight all the way.

    The pad is a little *inside* where the streamed terrain stops, so the two overlap by twenty
    metres rather than meeting exactly. Meeting exactly leaves a ring of nothing wherever the two
    disagree, and three hundred metres out a seam of coarse ground over fine is scenery while a
    hole in the world is a bug.

    A lattice alone does not land on the pad, though: its nearest kept point is wherever the grid
    happens to fall, up to a whole spacing further out, and `_clear_of_corridor` then pushes the
    edge out again. That is how the overlap became a gap -- see `_corridor_ring`. So the boundary
    itself is sampled as well."""
    xz = res.P[:, [0, 2]]
    lo = xz.min(axis=0) - radius
    hi = xz.max(axis=0) + radius
    tree = cKDTree(xz)
    out = []
    for spacing, inner, outer in ((NEAR_SPACING, corridor_pad, NEAR_RADIUS),
                                  (FAR_SPACING, NEAR_RADIUS, radius)):
        for grid in grid_chunks(lo, hi, spacing):
            d = tree.query(grid, distance_upper_bound=float(outer))[0]
            out.append(grid[(d >= inner) & (d < outer)])
    out.append(_corridor_ring(res, corridor_pad))
    return np.vstack(out)


def _corridor_ring(res, pad):
    """Points along the corridor's own outer edge, so the backdrop begins exactly there.

    Without them the Golden Gate's first backdrop triangle sat 315 m from the route while the
    streamed corridor ends at 300 m: twenty metres of intended overlap had become a fifteen-metre
    ring of nothing, read from the bridge as a hairline of sky drawn across the bay and over the
    far hills.

    Two numbers here are about staying clear of PROBE_SLACK, and both were measured rather than
    guessed. `quad_segs` is high because the default four-segment quarter circle cuts five metres
    inside the pad at the route's rounded ends, and it costs nothing: the ring is sampled by arc
    length, so a rounder buffer is the same number of points. The spacing is half the lattice's
    because what eats the rest of the slack is Delaunay stringing a chord across several ring
    points out on those same end caps, and chord sag falls with the square of the span.
    """
    shape = LineString(res.P[:, [0, 2]]).buffer(pad, quad_segs=16)
    polygons = list(shape.geoms) if shape.geom_type == "MultiPolygon" else [shape]
    parts = []
    for polygon in polygons:
        for ring in (polygon.exterior, *polygon.interiors):
            steps = max(int(round(ring.length / (NEAR_SPACING / 2))), 4)
            parts.append(np.array([ring.interpolate(i / steps, normalized=True).coords[0]
                                   for i in range(steps)]))
    return np.vstack(parts)


def terrain(res, dem, radius, corridor_pad, water_level=0.0, cover=None, fallback="terrain"):
    """Distant ground and sea as one mesh each."""
    xz = sample_grid(res, radius, corridor_pad)
    if len(xz) < 4:
        return None, None
    lat, lon = res.frame.to_latlon(xz[:, 0], xz[:, 1])
    y = dem.heights(lat, lon)
    simp = Delaunay(xz).simplices
    # Slack, because the probes below are deliberately conservative: a triangle sitting on the
    # boundary has its own midpoints a little inside the pad, and out on the route's rounded ends
    # Delaunay strings chords across the ring that dip a good fifteen metres in. Testing against
    # the pad itself throws away the very triangles that close the seam.
    #
    # It costs nothing at the road, because how close the mesh comes is decided by the sample
    # points -- none of which is inside the pad at all -- and not by this threshold. All the
    # threshold picks is what to throw away, and the sheet stretched over the corridor that it
    # exists to catch has a midpoint out near the middle of the road, hundreds of metres inside
    # even the narrowest route's line.
    simp = simp[_clear_of_corridor(xz, simp, res, corridor_pad - PROBE_SLACK)]
    wet = y < water_level
    is_water = wet[simp].all(axis=1)
    up = np.array([0.0, 1.0, 0.0])

    P = np.stack([xz[:, 0], np.maximum(y, water_level + SHORE), xz[:, 1]], axis=1)
    # The distant ground wears the same cover as the near ground where the data reaches.
    # It matters more here than up close: from a high corner most of the picture *is* backdrop, and
    # a single flat colour out there undoes the split done inside the corridor. The land-use cache
    # is fetched around the route, so the far edge of the backdrop has nothing to say and keeps the
    # fallback -- which is a dry tan, not a green, for exactly that reason.
    land_tris = orient_to(P, simp[~is_water], up)
    parts = []
    if cover is not None and len(land_tris):
        from sr.landcover import classify
        cents = P[land_tris].mean(axis=1)[:, [0, 2]]
        names = classify(cents, cover)
        names[names == "terrain"] = fallback
        for material in sorted(set(names.tolist())):
            picked = land_tris[names == material]
            if len(picked):
                parts.append(from_triangles(P, picked, material, uv_scale=24.0))
    if not parts:
        parts = [from_triangles(P, land_tris, "terrain", uv_scale=24.0)]
    land = parts
    # Five centimetres under the corridor's own sea. Both are flat at the water level, so where the
    # two meshes overlap they would be exactly coplanar and z-fight along the whole seam; invisible
    # at this distance, decisive for the depth test.
    Pw = np.stack([xz[:, 0], np.full(len(xz), water_level - WATER_SINK), xz[:, 1]], axis=1)
    sea = from_triangles(Pw, orient_to(Pw, simp[is_water], up), "water", uv_scale=64.0)
    return [m for m in land if not m.is_empty()], (sea if not sea.is_empty() else None)


def _clear_of_corridor(xz, simp, res, corridor_pad):
    """Which triangles do not lie over the route.

    Dropping the *sample points* inside the corridor is not enough. Delaunay triangulates a point
    cloud, not a polygon with a hole: given a six-hundred-metre gap it cheerfully joins one side to
    the other, and the result is a sheet of coarse hillside stretched straight over the road. On
    Shoreline it came out two thirds of a metre above the tarmac, so the race started on grass --
    the car was on the road the whole time, under a lid.

    Testing centroids alone misses exactly the triangles that matter: a long thin one spanning the
    gap has its centroid out on the far side. So the edge midpoints are tested too, which is what
    a triangle crossing the corridor cannot hide.
    """
    tree = cKDTree(res.P[:, [0, 2]])
    a, b, c = xz[simp[:, 0]], xz[simp[:, 1]], xz[simp[:, 2]]
    probes = [(a + b + c) / 3.0, (a + b) / 2.0, (b + c) / 2.0, (c + a) / 2.0]
    keep = np.ones(len(simp), dtype=bool)
    for p in probes:
        keep &= tree.query(p, distance_upper_bound=float(corridor_pad))[0] >= corridor_pad
    return keep


def skyline(res, dem, route_id, corridor_pad, water_level=0.0, keep_clear=None, landmark_names=None):
    """Tall buildings out on the skyline, as oriented boxes on the coarse ground.

    They stand on the backdrop's own elevation rather than the fine one, because the fine data does
    not reach this far; a metre of error on a tower four kilometres away is invisible."""
    try:
        elements = load_layer(route_id, "backdrop")["elements"]
    except FileNotFoundError:
        return None
    from shapely.geometry import LineString

    route = LineString(res.P[:, [0, 2]])
    excluded = landmark_footprints(res.frame, names=landmark_names)
    parts = {}
    for e in elements:
        # The wide backdrop cache deliberately shares one query between tall buildings, arterial
        # roads, coastlines and water. Only the first category belongs in the skyline. Without
        # this gate Alcatraz's 461 x 368 m coastline became an eight-storey floating box, and long
        # road ways could become equally convincing fake towers on every route.
        if not e.get("tags", {}).get("building"):
            continue
        geom = e.get("geometry")
        if not geom or len(geom) < 4:
            continue
        lat = np.array([p["lat"] for p in geom]); lon = np.array([p["lon"] for p in geom])
        x, z = res.frame.to_local(lat, lon)
        pts = np.stack([x, z], axis=1)
        poly = Polygon(pts)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty or poly.area < 200.0:
            continue
        if any(shape.intersects(poly) for shape in excluded):
            continue                         # the hand-built silhouette owns this footprint
        # The box that will actually be drawn, measured against the route -- not the footprint's
        # centroid, and not the footprint either.
        #
        # A skyline building is drawn as the minimum rectangle around its footprint, which is bigger
        # than the footprint; and it was kept or dropped on where its *centre* fell. A two hundred
        # metre block three hundred metres off the road therefore passed the test and was drawn
        # straight across the road, with no collider and nothing to clip it: the road ran into a
        # wall, and every check in the pipeline said the road was clear, because every check looked
        # at the streamed tiles and this thing is in the backdrop.
        rect = poly.minimum_rotated_rectangle
        if rect.distance(route) < corridor_pad:
            continue                       # close enough that the streamed tiles own this ground
        # And never on a road, however far from the racing line it is. The distance rule is about
        # which mesh owns which ground; this one is about the thing that actually matters. A side
        # street reaches three hundred metres out, further than the distance rule looks.
        if keep_clear is not None and rect.intersects(keep_clear):
            continue
        rx, rz = np.array(rect.exterior.coords[:-1]).T
        e0 = np.array([rx[1] - rx[0], rz[1] - rz[0]])
        e1 = np.array([rx[2] - rx[1], rz[2] - rz[1]])
        la, lb = float(np.linalg.norm(e0)), float(np.linalg.norm(e1))
        if min(la, lb) < 6.0:
            continue
        cx, cz = float(rect.centroid.x), float(rect.centroid.y)
        glat, glon = res.frame.to_latlon(np.array([cx]), np.array([cz]))
        base = max(float(dem.heights(glat, glon)[0]), water_level)
        tags = e.get("tags", {})
        # The backdrop query selects both `height` and `building:levels`. Downtown San Francisco
        # mostly uses the former, but the old skyline read only the latter and collapsed towers
        # such as 555 California to the 28 m fallback. Reuse the building pipeline's one height
        # parser so a metre/foot tag cannot mean one thing nearby and another thing on the horizon.
        from sr.buildings import facade_for, parse_height
        height = parse_height(tags) or MIN_LEVELS * LEVEL_HEIGHT
        yaw = yaw_for_x_axis(e0)
        # uv_scale stays at the building default: the windows are drawn from uv, so a skyline
        # tower with its own scale gets windows of its own size and a shopfront band to match
        from sr.buildings import finish_roof, roofline_bottom
        material = facade_for(tags, poly.area, height / LEVEL_HEIGHT, (cx, cz))
        wall_height = roofline_bottom(base, base + height, material) - base
        body = box((cx, base + wall_height / 2, cz), (la / 2, wall_height / 2, lb / 2),
                   yaw=yaw, material=material)
        cap, _roof_base, _roof_top = finish_roof(rect, base, base + height, material, "flat")
        from sr.buildings import facade_identity, residential_use
        key = f"{e.get('type', 'way')}:{e.get('id', -1)}"
        for part in [body, cap]:
            facade_identity(part, key, residential_use(e.get("tags", {}), poly.area, height))
        parts.setdefault(material, []).extend([body, cap])
    return {material: merge(meshes, material) for material, meshes in parts.items()} or None


ROAD_WIDTH = {"motorway": 12.0, "trunk": 10.0, "primary": 8.0}


def arterial_roads(res, dem, route_id, corridor_pad, water_level=0.0):
    """Actual OSM arterial roads in the backdrop, simplified and draped on the coarse DEM."""
    try:
        elements = load_layer(route_id, "backdrop")["elements"]
    except FileNotFoundError:
        return None, None
    meshes, footprints = [], []
    corridor = LineString(res.P[:, [0, 2]]).buffer(corridor_pad, quad_segs=3)
    for element in elements:
        tags = element.get("tags", {})
        highway = tags.get("highway")
        geometry = element.get("geometry") or []
        if highway not in ROAD_WIDTH or len(geometry) < 2:
            continue
        # Bridge and tunnel elevation needs a deck or portal model. A DEM trace would draw a
        # second road on the sea or hillside beside the real structure, so the adjacent surface
        # segments carry the distant direction and the existing bridgework owns the span.
        if tags.get("bridge") not in (None, "no") or tags.get("tunnel") not in (None, "no"):
            continue
        lat = np.array([point["lat"] for point in geometry])
        lon = np.array([point["lon"] for point in geometry])
        x, z = res.frame.to_local(lat, lon)
        half = ROAD_WIDTH[highway] / 2
        visible = LineString(np.c_[x, z]).simplify(12.0).difference(corridor)
        lines = ([visible] if visible.geom_type == "LineString" else
                 [line for line in getattr(visible, "geoms", ()) if line.geom_type == "LineString"])
        for line in lines:
            coords = np.asarray(line.coords)
            if len(coords) < 2:
                continue
            la, lo = res.frame.to_latlon(coords[:, 0], coords[:, 1])
            y = np.maximum(dem.heights(la, lo), water_level) + .16
            P = np.c_[coords[:, 0], y, coords[:, 1]]
            delta = np.gradient(P[:, [0, 2]], axis=0)
            length = np.linalg.norm(delta, axis=1); length[length == 0] = 1
            R = np.c_[-delta[:, 1] / length, np.zeros(len(delta)), delta[:, 0] / length]
            meshes.append(ribbon(P, R, np.full(len(P), half), material="road"))
            footprints.append(line.buffer(half + 18.0, quad_segs=2))
    return (merge(meshes, "road") if meshes else None,
            unary_union(footprints) if footprints else None)


def build(res, route_id, dem, corridor_pad=280.0, water_level=0.0, keep_clear=None, cover=None):
    """Everything beyond the streamed tiles, as {node name: mesh}."""
    route = load_route(route_id)
    from sr.vistas import city_massing, profile
    vista = profile(route_id)
    radius = float(route.get("backdropM", 3000))
    # A route's `groundCover` decides unmapped ground everywhere; the vista's fallback only
    # speaks for routes that did not name one.
    from sr.landcover import route_ground
    land, sea = terrain(res, dem, radius, corridor_pad, water_level, cover, route_ground(route_id) or vista.fallback)
    roads, road_clear = arterial_roads(res, dem, route_id, corridor_pad, water_level)
    all_clear = unary_union([shape for shape in (keep_clear, road_clear) if shape is not None])
    towers = skyline(res, dem, route_id, corridor_pad, water_level, all_clear,
                     route.get("landmarks"))
    districts, _stats = city_massing(res, dem, route_id, water_level, all_clear)
    out = {}
    for mesh in land:
        # `backdrop_terrain` for unclassified ground, `backdrop_terrain_grass` and friends for the
        # rest. `collider_for` reads the first underscore-separated word, so every one of them is
        # still a backdrop -- no collider, loaded once, never streamed.
        out["backdrop_" + mesh.material] = mesh
    if sea is not None:
        out["backdrop_water"] = sea
    if roads is not None:
        out["backdrop_road"] = roads
    for material, mesh in sorted((towers or {}).items()):
        # Keep each established facade material separate so the runtime can draw its real colour
        # and window texture. All names still begin with `backdrop`, therefore none gets a collider.
        out["backdrop_buildings_" + material] = mesh
    for material, mesh in sorted(districts.items()):
        out["backdrop_vista_" + material] = mesh
    # Landmarks ride along in the backdrop: they are always this far away and always visible, which
    # is the backdrop's whole job, and they are far too few triangles to be worth their own file.
    for node, mesh in (build_landmarks(route.get("landmarks"), res.frame, dem) or {}).items():
        if mesh is not None:
            out[f"backdrop_{node}"] = mesh
    from sr.horizon import build as build_horizon
    out.update(build_horizon(res, dem, radius, water_level))
    return out
