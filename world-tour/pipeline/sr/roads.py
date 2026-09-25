"""Race surface, side roads and the barriers that close them.

The race road is one ribbon along the spline. Every other drivable way in the corridor is drawn too,
because a city with only one street on it does not read as a city; the player is kept on the route by
barriers placed thirty meters up each side road, which is how a real closed-road stage looks."""
from dataclasses import dataclass, replace

import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import Polygon

from sr.clearance import surface

from sr.mesh import box, merge, ribbon, vertical_strip, wall, yaw_for_z_axis
from sr.route import DEFAULT_LANES, LANE_W, RouteResult, load_ways
from sr.terrain import APRON, ground_height

ROAD_LIFT = 0.06          # race surface above the terrain, so the two never z-fight
# The ground mesh drops any triangle whose centroid is over the tarmac, so one straddling the edge
# goes even though its far corners were the only thing covering the join: that left slivers of sky
# along the painted edge of every route. Rather than keep ground under the road -- where a cut bank
# would poke up through it -- the road carries its own skirt down into the gap.
SKIRT = 1.2               # how far the road edge is carried down past the surface
# A city street that meets grass at the white line is missing a layer everyone knows is there.
# The pavement goes outside the guardrail -- a closed-road stage puts the barrier in front of it --
# and stops where the fast roads start, because a motorway has no pavement.
WALK_INNER = 0.55         # from the painted edge to the kerb, just behind the rail
WALK_WIDTH = 2.15
KERB = 0.15               # how far the pavement stands above the road
NO_WALK = {"motorway", "trunk", "runway", "taxiway"}
WALK_MATERIAL = "sidewalk"
SIDE_LIFT = 0.03
BARRIER_DISTANCE = 30.0   # from the edge of the race surface to the barrier line
BARRIER_HALF = (1.1, 0.45, 0.25)
BARRIER_GAP = 2.4
SIDE_MIN_LENGTH = 12.0
# An environment road is drawn on the ground, so a long viaduct the race does not use would be a road
# painted over the streets below it -- and the elevation data sees its deck as ground, so it was
# draped over a mound of its own making and broke up into pieces (Sydney's motorway interchange,
# New York's ramps). Such a viaduct is left out, and its deck is taken out of the ground
# (sr/bare_earth.py). A short bridge over a stream or a railway still draws.
FLOATING_BRIDGE_M = 60.0
FLOATING_BRIDGE_CLEAR = 15.0     # nearer to the race line than this, the bridge is the race's own deck


def floating_bridge(way, tree):
    """A bridge longer than FLOATING_BRIDGE_M that never comes near the race line (`tree` over its x/z)."""
    if not way.bridge or len(way.xy) < 2:
        return False
    xy = np.asarray(way.xy, dtype=float)
    if float(np.sum(np.linalg.norm(np.diff(xy, axis=0), axis=1))) <= FLOATING_BRIDGE_M:
        return False
    return float(tree.query(xy)[0].min()) >= FLOATING_BRIDGE_CLEAR
RACE_MATCH = 2.0          # a way running within this of the spline is the race road itself
# A real guardrail is a beam on posts, not a wall. The car's body sits between 0.15 m and 0.65 m
# above the road (it is a half-scale car), so a beam across 0.40 to 0.72 catches it just as a solid
# strip did, while leaving a gap under it and a view over it. The first version was a continuous
# metre-high slab, which stopped the car perfectly and blocked exactly the view the scenic routes
# exist for.
RAIL_HEIGHT = 0.72        # top of the rail above the driving surface
BEAM_BOTTOM = 0.40        # underside of the beam: below this you see through
POST_HALF = (0.07, 0.10)  # post, half thickness across the rail and along it
POST_EVERY = 2            # rail points between posts, so about one post every twelve metres
RAIL_OFFSET = 0.3         # outside the painted edge, so the whole road stays drivable
RAIL_STEP = 3             # samples between rail points: the road is sampled every 2 m, the rail every 6
RAIL_END_SEAM = 0.05      # remove the transverse end cap without opening either roadside rail
RAIL_CORE_MARGIN = 12.0   # preserve established interior tessellation while extending terminal beams
RAIL_MATERIAL = "guardrail"


@dataclass(frozen=True)
class RoadJunction:
    """One side road meeting the race route, expressed in the route's own coordinates."""
    route_index: int
    turn_side: int


@dataclass(frozen=True)
class JunctionLayout:
    """The one road-network pass shared by junction paint and side-road barriers."""
    junctions: tuple[RoadJunction, ...]
    barriers: tuple[tuple[np.ndarray, float, float], ...]


def side_half_width(way):
    if way.width_m > 0:
        return way.width_m / 2.0
    base = way.highway.replace("_link", "")
    lanes = way.lanes or DEFAULT_LANES.get(base, 2)
    return float(np.clip(lanes * LANE_W / 2.0, 2.0, 9.0))


def wraps(res, a, b):
    """Does this run go the whole way round a circuit, so its mesh has to join up?

    Every surface here is generated from an open polyline, which on a closed route leaves a two
    metre gap in the tarmac at exactly one place: the start line, which is the one place the car is
    guaranteed to be. The first campus circuit spawned the car over that gap, looking down through
    the hole at the scenery, and it read as the race starting on grass."""
    return bool(res.closed) and a == 0 and b == len(res.P) - 1


def race_ribbons(res, road_y):
    """The drivable surface and its skirt, split so bridge spans carry the bridge material."""
    P = res.P.copy(); P[:, 1] = road_y
    out = {}
    for material, mask in (("road", ~res.bridge), ("bridge", res.bridge)):
        parts = []
        # Materials belong to segments, not disjoint vertex runs. The last vertex of one
        # material is the first vertex of the next, including the closing circuit segment.
        segment_mask = mask if res.closed else mask[:-1]
        for a, b in _runs(segment_mask):
            indices = np.arange(a, b + 2) % len(P)
            distance = np.append(res.S, res.length)[a:b + 2]
            parts.append(ribbon(P[indices], res.R[indices], res.half_width[indices],
                                y_offset=ROAD_LIFT, S=distance, material=material, cross_step=0.75))
            for side, flip in ((-1.0, True), (1.0, False)):
                top = P[indices] + res.R[indices] * (side * res.half_width[indices])[:, None]
                top[:, 1] += ROAD_LIFT
                bottom = top.copy(); bottom[:, 1] -= SKIRT
                parts.append(vertical_strip(top, bottom, material=material, flip=flip))
        if parts:
            out[material] = merge(parts, material)
    return out



FOLD_CLEAR = 0.5
WALK_MIN = 0.2


def signed_turn(res):
    """Curvature per point, positive where the line turns towards +R."""
    T = res.T
    if res.closed:
        dT = np.roll(T, -1, axis=0) - np.roll(T, 1, axis=0)
        ds = np.roll(res.S, -1) - np.roll(res.S, 1)
        total = res.S[-1] + (res.S[1] - res.S[0] if len(res.S) > 1 else 0)
        ds[0] += total
        ds[-1] += total
    else:
        dT = np.gradient(T, axis=0)
        ds = np.gradient(res.S)
    ds = np.where(ds == 0, 1.0, ds)
    return np.sum(dT * res.R, axis=1) / np.abs(ds)


def walk_offsets(half_width, turn, side):
    """Distances from the centreline to the pavement's kerb and far edge on one side."""
    near = half_width + WALK_INNER
    far = half_width + WALK_INNER + WALK_WIDTH
    inside = side * turn > 1e-9
    reach = np.where(inside, 1.0 / np.maximum(np.abs(turn), 1e-9) - FOLD_CLEAR, np.inf)
    far = np.minimum(far, reach)
    near = np.minimum(near, far - WALK_MIN)
    near = np.maximum(near, half_width + .05)
    return near, np.maximum(far, near + WALK_MIN)


def sidewalks(res, road_y, dem):
    """A raised pavement down both sides of every street that would really have one."""
    city = np.array([str(h).replace("_link", "") not in NO_WALK for h in res.highway])
    P = res.P.copy(); P[:, 1] = road_y
    parts = []
    for a, b in _runs(city):
        if b - a < 4:
            continue
        sl = slice(a, b + 1)
        wrap = wraps(res, a, b)
        turn = signed_turn(res)[sl]
        for side, flip in ((-1.0, False), (1.0, True)):
            near_d, far_d = walk_offsets(res.half_width[sl], turn, side)
            inner = P[sl] + res.R[sl] * (side * near_d)[:, None]
            outer = P[sl] + res.R[sl] * (side * far_d)[:, None]
            mid = (inner + outer) / 2
            hw = (far_d - near_d) / 2
            # The kerb stays level with the road, the far edge follows the ground: a pavement laid
            # flat across a cross slope disappears into the verge exactly as a side road does.
            far = np.maximum(ground_height(res, road_y, dem, outer[:, [0, 2]]) - ROAD_LIFT,
                             road_y[sl] - WALK_WIDTH)
            near = np.full(b + 1 - a, 0.0) + road_y[sl]
            parts.append(ribbon(mid, res.R[sl], hw, y_offset=ROAD_LIFT + KERB,
                                closed=wrap, S=res.S[sl], material=WALK_MATERIAL,
                                edge_y=(near, far) if side < 0 else (far, near)))
            top = inner.copy(); top[:, 1] += ROAD_LIFT + KERB
            bottom = inner.copy(); bottom[:, 1] += ROAD_LIFT - 0.05
            parts.append(vertical_strip(top, bottom, material=WALK_MATERIAL, flip=flip, closed=wrap))
    return merge(parts, WALK_MATERIAL) if parts else None


def parallel_carriageway(res, way, xz, tree):
    """OSM one-way ways beside the same kind and level of racing road."""
    distance, idx = tree.query(xz)
    tangent = _tangents2(xz)
    alignment = np.abs(np.sum(tangent * res.T[idx][:, [0, 2]], axis=1))
    return (way.oneway & res.oneway[idx] & (distance > RACE_MATCH) & (distance < 60)
            & (np.asarray(res.highway)[idx] == way.highway)
            & (res.layer[idx] == way.layer) & (res.tunnel[idx] == way.tunnel)
            & (alignment > .85))


FLAT_MAX_RISE = 2.5       # a parallel carriageway this far off the racing level is on its own grade


def parallel_flat_extents(res, ways, road_y, dem):
    """How far beyond the flat shoulder each side's parallel carriageway reaches, per spline point.

    `side_roads` moves a parallel carriageway to sit just beyond the racing shoulder; this measures
    that same moved position so the terrain keeps the whole divided road on one level. Only where the
    map's ground under that carriageway is already near the racing level: split-level hill roads
    such as Twin Peaks' figure eight keep their own grade instead of being carved flat."""
    from scipy.ndimage import gaussian_filter1d, maximum_filter1d
    tree = cKDTree(res.P[:, [0, 2]])
    extents = [np.zeros(len(res.P)), np.zeros(len(res.P))]
    for way in ways:
        if way.bridge or not way.oneway:
            continue
        xz = _densify(way.xy[::-1] if way.reverse_oneway else way.xy, 4.0)
        if len(xz) < 2:
            continue
        parallel = parallel_carriageway(res, way, xz, tree)
        if not parallel.any():
            continue
        d, idx = tree.query(xz)
        lat, lon = res.frame.to_latlon(xz[:, 0], xz[:, 1])
        parallel &= np.abs(dem.heights(lat, lon) - road_y[idx]) <= FLAT_MAX_RISE
        width = side_half_width(way)
        placed = np.maximum(d, res.half_width[idx] + width + 1.0)
        reach = placed + width + 1.0 - res.half_width[idx] - APRON
        side = np.sum((xz - res.P[idx][:, [0, 2]]) * res.R[idx][:, [0, 2]], axis=1)
        for k, mask in enumerate((parallel & (side < 0), parallel & (side >= 0))):
            np.maximum.at(extents[k], idx[mask], reach[mask])
    # Way samples are 4 m apart and the spline 2 m; close those gaps, then ease the edges so the
    # flat band widens over a few tens of metres rather than stepping at a sample.
    return tuple(gaussian_filter1d(maximum_filter1d(e, 9), 3, mode="nearest") for e in extents)


def side_roads(res, road_y, dem, route_id, pad=300.0, end_roads=None):
    """Environment roads and their paint; a parallel bridge stays beside its racing deck."""
    # Import here because paint owns its widths and dash rules and imports ROAD_LIFT.
    from sr.markings import markings
    tree = cKDTree(res.P[:, [0, 2]])
    meshes, paint = [], {}
    ways = load_ways(route_id, res.frame)
    bridge_ends = {}
    for way in ways:
        if way.bridge:
            for node in (way.nodes[0], way.nodes[-1]):
                key = (way.highway, way.layer, node)
                bridge_ends[key] = bridge_ends.get(key, 0) + 1
    for way in ways:
        if floating_bridge(way, tree):
            continue
        xz = _densify(way.xy[::-1] if way.reverse_oneway else way.xy, 4.0)
        if len(xz) < 2:
            continue
        d, idx = tree.query(xz)
        parallel = parallel_carriageway(res, way, xz, tree)
        width = side_half_width(way)
        endpoint_tail = np.zeros(len(xz), dtype=bool)
        if not res.closed:
            way_tangent = _tangents2(xz)
            overlap = 4.0  # one source-road sample inside the racing ribbon closes the visual seam
            for endpoint, station, direction in ((0, res.S[idx], -1),
                                                  (-1, res.length - res.S[idx], 1)):
                delta = xz - res.P[endpoint, [0, 2]]
                tangent = res.T[endpoint, [0, 2]]
                right = res.R[endpoint, [0, 2]]
                longitudinal = np.sum(delta * tangent, axis=1)
                aligned = np.abs(np.sum(way_tangent * tangent, axis=1)) > .85
                same_level = ((res.layer[idx] == way.layer) & (res.bridge[idx] == way.bridge)
                              & (res.tunnel[idx] == way.tunnel))
                close_to_end = station <= overlap
                within_street = (np.abs(np.sum(delta * right, axis=1))
                                 <= res.half_width[endpoint] + width + 1.0)
                past_end = longitudinal * direction >= -overlap
                endpoint_tail |= aligned & same_level & close_to_end & within_street & past_end
        # Keep the portions of the same OSM street that continue beyond either route endpoint.
        # The explicit endpoint overlap prevents the nearest-route distance from leaving a gap
        # between the tail and the racing ribbon.
        keep = (d <= pad) & ((d > res.half_width[idx] + .5) | parallel | endpoint_tail)
        # The racing ribbon has widened shoulders. Move its parallel environment road just
        # beyond those shoulders so the two carriageways retain a visible median, not overlap.
        shift = np.where(parallel, np.maximum(res.half_width[idx] + width + 1.0 - d, 0), 0)
        away = xz - res.P[idx][:, [0, 2]]
        xz = xz + away * (shift / np.maximum(d, 1e-6))[:, None]
        for a, b in _runs(keep):
            piece = xz[a:b + 1]
            if len(piece) < 2 or _length(piece) < SIDE_MIN_LENGTH:
                continue
            piece = _densify(piece, 2.0 if parallel[a:b + 1].any() else 4.0)
            paired = parallel_carriageway(res, way, piece, tree)
            _, nearest = tree.query(piece)
            S = np.r_[0., np.cumsum(np.linalg.norm(np.diff(piece, axis=0), axis=1))]
            # Bridge tags end at different stations on the two carriageways. Once most of
            # this OSM bridge matches the adjacent level, carry that profile to its abutments
            # too: switching individual end samples back to terrain creates a vertical step.
            deck = way.bridge and np.mean(paired & res.bridge[nearest]) > .6
            def height(points):
                values = ground_height(res, road_y, dem, points, tree)
                if not deck:
                    return values
                target = road_y[nearest] + ROAD_LIFT - SIDE_LIFT
                # Abutments join the adjoining ground road at exactly the same height. Blend
                # each endpoint correction over at most 60 m instead of creating a step at the
                # OSM way boundary, while preserving the adjacent deck profile in the middle.
                approach = min(60., S[-1] / 2)
                first, last = (way.nodes[-1], way.nodes[0]) if way.reverse_oneway else (way.nodes[0], way.nodes[-1])
                start_join = a == 0 and bridge_ends[(way.highway, way.layer, first)] == 1
                end_join = b == len(xz) - 1 and bridge_ends[(way.highway, way.layer, last)] == 1
                correction = (np.maximum(1 - S / approach, 0) * (values[0] - target[0]) * start_join
                              + np.maximum(1 - (S[-1] - S) / approach, 0) * (values[-1] - target[-1]) * end_join)
                return np.maximum(values, target + correction)
            y = height(piece)
            P = np.column_stack([piece[:, 0], y, piece[:, 1]])
            T = _tangents2(piece)
            R = np.column_stack([T[:, 1], np.zeros(len(T)), -T[:, 0]])
            hw = np.full(len(P), width)
            edges = [height(piece + R[:, [0, 2]] * side * hw[:, None]) for side in (-1., 1.)]
            meshes.append(ribbon(P, R, hw, y_offset=SIDE_LIFT, material="road", edge_y=edges))
            if paired.any():
                section = RouteResult(route={}, frame=res.frame, P=P, S=S,
                    T=np.column_stack([T[:, 0], np.zeros(len(T)), T[:, 1]]), R=R,
                    half_width=hw, highway=[way.highway] * len(P),
                    bridge=np.full(len(P), way.bridge), tunnel=np.full(len(P), way.tunnel),
                    lanes=np.full(len(P), way.lanes), closed=False,
                    oneway=np.full(len(P), way.oneway), layer=np.full(len(P), way.layer))
                for material, mesh in markings(section, y, LANE_W).items():
                    vertices = mesh.positions
                    station = mesh.uvs[:, 0]  # markings use metres along the road as their u coordinate
                    centers = np.column_stack([np.interp(station, S, piece[:, axis]) for axis in (0, 1)])
                    rights = np.column_stack([np.interp(station, S, R[:, axis]) for axis in (0, 2)])
                    lateral = np.sum((vertices[:, [0, 2]] - centers) * rights, axis=1)
                    fraction = np.clip((lateral / width + 1) / 2, 0, 1)
                    vertices[:, 1] = (np.interp(station, S, edges[0]) * (1 - fraction)
                                      + np.interp(station, S, edges[1]) * fraction + SIDE_LIFT + .02)
                    paint.setdefault(material, []).append(mesh)
    for label, terminal in (end_roads or {}).items():
        # A short overlap inside the timing line closes independently quantised tile edges.
        join = np.stack([terminal.P[0] - terminal.T[0] * 2., terminal.P[0]])
        meshes.append(ribbon(join, np.repeat(terminal.R[:1], 2, axis=0),
                             np.repeat(terminal.half_width[:1], 2), y_offset=ROAD_LIFT, material="road"))
        meshes.extend(race_ribbons(terminal, terminal.P[:, 1]).values())
        # Outward at the start points against the race direction. Paint keeps the physical
        # carriageway's yellow/white sides instead of swapping them at the starting line.
        painted_terminal = (replace(terminal, P=terminal.P[::-1], S=terminal.length-terminal.S[::-1],
                                    T=-terminal.T[::-1], R=-terminal.R[::-1])
                            if label == "start" else terminal)
        for material, mesh in markings(painted_terminal, painted_terminal.P[:, 1], LANE_W).items():
            paint.setdefault(material, []).append(mesh)
    return merge(meshes, "road"), {key: merge(parts, key) for key, parts in paint.items()}


def rail_paths(res):
    """Follow the actual road boundary rather than clipping chords through its corners."""
    road = surface(ribbon(res.P, res.R, res.half_width, closed=res.closed))
    boundary = road.buffer(RAIL_OFFSET, join_style=2, mitre_limit=2).boundary
    geometries = [boundary]
    if not res.closed:
        # A point-to-point road must stay open in the direction of travel, but that means removing
        # only the transverse cap. The old cutter removed twelve metres of both roadside rails too;
        # at an exposed start a sedan could simply turn sideways through that car-sized opening.
        # Each narrow rectangle reaches through the buffered cap and only RAIL_END_SEAM into the
        # route, leaving both side rails close enough to the timing line that no vehicle fits past.
        depth = RAIL_OFFSET + RAIL_END_SEAM
        ends = ((0, -depth, RAIL_END_SEAM), (-1, -RAIL_END_SEAM, depth))
        full_boundary = boundary
        for index, along_min, along_max in ends:
            origin = res.P[index, [0, 2]]
            tangent = res.T[index, [0, 2]]
            right = res.R[index, [0, 2]]
            lateral = res.half_width[index] + RAIL_OFFSET + RAIL_END_SEAM

            def corner(along, across):
                return origin + tangent * along + right * across

            cap = Polygon([corner(along_min, -lateral), corner(along_max, -lateral),
                           corner(along_max, lateral), corner(along_min, lateral)])
            full_boundary = full_boundary.difference(cap)

        # Keep the old interior as its own geometry so extending the beam cannot retessellate and
        # move every collision-bearing post by a few centimetres. That tiny global phase shift was
        # enough to change Moffett's accepted sports-car breakout count. The second geometry adds
        # only the newly protected terminal pieces; together they are the cap-free full boundary.
        core_boundary = boundary
        distance = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(res.P[:, [0, 2]], axis=0), axis=1))]
        for mask in (distance <= RAIL_CORE_MARGIN, distance >= distance[-1] - RAIL_CORE_MARGIN):
            if np.count_nonzero(mask) < 2:
                continue
            opening = surface(ribbon(res.P[mask], res.R[mask], res.half_width[mask]))
            core_boundary = core_boundary.difference(opening.buffer(RAIL_OFFSET + .01, join_style=2))
        geometries = [core_boundary, full_boundary.difference(core_boundary)]

    lines = []
    for geometry in geometries:
        parts = [geometry] if geometry.geom_type == "LineString" else list(geometry.geoms)
        lines.extend(part for part in parts if part.geom_type == "LineString")
    return [np.asarray(line.simplify(.03).segmentize(RAIL_STEP * 2.0).coords)
            for line in lines if line.geom_type == "LineString" and line.length > .1]


def guardrails(res, road_y):
    """Continuous beams and posts outside the racing ribbon, open at both route ends."""
    if len(res.P) < 4 * RAIL_STEP:
        return None
    height = res.route.get("guardrailHeightM", RAIL_HEIGHT)
    beam_bottom = max(0.0, height - (RAIL_HEIGHT - BEAM_BOTTOM))
    tree = cKDTree(res.P[:, [0, 2]])
    route_station = getattr(res, "S", np.r_[0.0, np.cumsum(
        np.linalg.norm(np.diff(res.P[:, [0, 2]], axis=0), axis=1))])
    route_length = float(route_station[-1])
    parts = []
    for xz in rail_paths(res):
        _, idx = tree.query(xz)
        edge = np.column_stack([xz[:, 0], road_y[idx] + ROAD_LIFT, xz[:, 1]])
        beam = edge.copy()
        beam[:, 1] += beam_bottom
        parts.append(wall(beam, height - beam_bottom, material=RAIL_MATERIAL))
        direction = np.gradient(xz, axis=0)
        distances = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(xz, axis=0), axis=1))]
        last = -np.inf
        posts = []
        for i, distance in enumerate(distances):
            # Extending a beam must not shift every post down the whole route: posts are collision
            # geometry too, and that changed Moffett's measured breakout balance. Keep the existing
            # interior phase, then add one support at each newly covered terminal.
            if not (RAIL_CORE_MARGIN <= route_station[idx[i]] <= route_length - RAIL_CORE_MARGIN):
                continue
            if distance - last < POST_EVERY * RAIL_STEP * 2:
                continue
            last = distance
            posts.append(i)
        for terminal in (int(np.argmin(route_station[idx])), int(np.argmax(route_station[idx]))):
            if all(np.linalg.norm(xz[terminal] - xz[post]) > POST_HALF[1] * 2 for post in posts):
                posts.append(terminal)
        for i in sorted(posts):
            parts.append(box((edge[i, 0], edge[i, 1] + height / 2, edge[i, 2]),
                             (POST_HALF[0], height / 2, POST_HALF[1]),
                             yaw=yaw_for_z_axis(direction[i]), material=RAIL_MATERIAL))
    return merge(parts, RAIL_MATERIAL) if parts else None


SHIELD_TOP = 1.8          # above the driving surface: over the roof of the tallest half-scale body


def guardrail_shield(res, road_y):
    """A collision-only wall from the top of every rail beam up to SHIELD_TOP.

    The beam stays low so the view stays open, but a beam 0.72 m tall is a ramp to a car that is
    already tipping: it rolled over the top, landed outside and sat there. The node is named with the
    rail's prefix so it gets the rail's collider and breakout rule, and the runtime never draws it."""
    if len(res.P) < 4 * RAIL_STEP:
        return None
    height = res.route.get("guardrailHeightM", RAIL_HEIGHT)
    if SHIELD_TOP <= height:
        return None
    tree = cKDTree(res.P[:, [0, 2]])
    parts = []
    for xz in rail_paths(res):
        _, idx = tree.query(xz)
        top = np.column_stack([xz[:, 0], road_y[idx] + ROAD_LIFT + height, xz[:, 1]])
        parts.append(wall(top, SHIELD_TOP - height, material=RAIL_MATERIAL))
    return merge(parts, RAIL_MATERIAL) if parts else None


def junction_layout(res, route_id):
    """Find route junctions and the closure line on every arm in one road-network pass.

    Barrier placement owned this intersection walk first. Keeping its thirty-metre crossings in
    the same result means painted junctions cannot quietly grow a second definition of a side road.
    """
    tree = cKDTree(res.P[:, [0, 2]])
    barriers = []
    junctions = []
    for way in load_ways(route_id, res.frame):
        xz = _densify(way.xy, 2.0)
        if len(xz) < 2:
            continue
        dist, idx = tree.query(xz)
        clearance = dist - (res.half_width[idx] + APRON)
        if (dist < RACE_MATCH).mean() > 0.6:
            continue
        # A bridge over a street is not a junction with it. OSM already owns this answer on both
        # ways through `layer`, `bridge` and `tunnel`; comparing only the x/z projection painted
        # crossings on bridge decks and put closure blocks across them.
        same_level = ((res.layer[idx] == way.layer) & (res.bridge[idx] == way.bridge)
                      & (res.tunnel[idx] == way.tunnel))
        hw = side_half_width(way)
        arms = []
        for i in range(len(xz) - 1):
            if not (same_level[i] and same_level[i + 1]):
                continue
            a, b = clearance[i], clearance[i + 1]
            if not (min(a, b) <= BARRIER_DISTANCE <= max(a, b)):
                continue
            if min(dist[i], dist[i + 1]) > BARRIER_DISTANCE * 3:
                continue                                 # a crossing far from the route is not our junction
            f = 0.0 if a == b else (BARRIER_DISTANCE - a) / (b - a)
            p = xz[i] + (xz[i + 1] - xz[i]) * f
            d = xz[i + 1] - xz[i]
            n = np.linalg.norm(d)
            if n == 0:
                continue
            d = d / n
            arm = (p, yaw_for_z_axis(d), hw)
            if arms and np.linalg.norm(arms[-1][0] - p) < 1e-6:
                continue
            arms.append(arm)
            barriers.append(arm)

        # A nearby parallel road can cross the thirty-metre clearance contour without ever meeting
        # the race surface. It still keeps its old closure barrier, but it is not a junction to paint.
        grade_dist = np.where(same_level, dist, np.inf)
        nearest_level = int(np.argmin(grade_dist))
        if (arms and np.isfinite(grade_dist[nearest_level])
                and grade_dist[nearest_level] <= res.half_width[idx[nearest_level]] + APRON):
            route_index = int(idx[nearest_level])
            delta = arms[0][0] - res.P[route_index, [0, 2]]
            side = 1 if float(np.dot(delta, res.R[route_index, [0, 2]])) >= 0.0 else -1
            candidate = RoadJunction(route_index, side)
            if not any(np.linalg.norm(res.P[route_index, [0, 2]] -
                                      res.P[j.route_index, [0, 2]]) < 12.0 for j in junctions):
                junctions.append(candidate)
    return JunctionLayout(tuple(junctions), tuple(barriers))


def barrier_lines(res, road_y, dem, route_id, layout=None):
    """Where each side road crosses BARRIER_DISTANCE from the race surface, a row of K-rails across it.

    Placing the row at a fixed distance rather than truncating the road keeps the street visible
    behind the barrier, which is what a closed road actually looks like."""
    layout = layout or junction_layout(res, route_id)
    placements = _dedupe(layout.barriers, road_y=road_y, res=res, dem=dem)
    for road in getattr(res, "end_roads", {}).values():
        if not placements:
            break
        points = np.array([pos for pos, _ in placements])
        distance, nearest = cKDTree(road.P[:, [0, 2]]).query(points[:, [0, 2]])
        # These streets now receive finishers. Race owns the player's timing-line boundary;
        # old side-street closure blocks must not cut through the parking approach.
        keep = distance > road.half_width[nearest] + np.hypot(BARRIER_HALF[0], BARRIER_HALF[2])
        placements = [placement for placement, retained in zip(placements, keep) if retained]
    return placements


def _dedupe(placements, res, road_y, dem, min_sep=12.0):
    """One barrier line per junction: nearby crossings on parallel ways are the same closure."""
    kept = []
    for p, yaw, hw in placements:
        if any(np.hypot(*(p - q)) < min_sep for q, _, _ in kept):
            continue
        kept.append((p, yaw, hw))
    if not kept:
        return []
    pts = np.array([p for p, _, _ in kept])
    y = ground_height(res, road_y, dem, pts)
    out = []
    for (p, yaw, hw), gy in zip(kept, y):
        right = np.array([np.cos(yaw), -np.sin(yaw)])   # perpendicular to the road, in the ground plane
        n = max(int(hw * 2 / BARRIER_GAP), 1)
        for k in range(n + 1):
            off = (k - n / 2.0) * BARRIER_GAP
            q = p + right * off
            out.append(((float(q[0]), float(gy + BARRIER_HALF[1] + 0.05), float(q[1])), yaw))
    return out


def barrier_mesh():
    return box((0.0, 0.0, 0.0), BARRIER_HALF, 0.0, material="barrier")


# ---------------------------------------------------------------- helpers

def _runs(mask):
    out, start = [], None
    for i, m in enumerate(mask):
        if m and start is None:
            start = i
        if not m and start is not None:
            out.append((start, i - 1)); start = None
    if start is not None:
        out.append((start, len(mask) - 1))
    return out


def _length(xz):
    return float(np.linalg.norm(np.diff(xz, axis=0), axis=1).sum())


def _densify(xz, step):
    """Resample a 2D polyline at a fixed step, keeping both ends."""
    xz = np.asarray(xz, dtype=np.float64)
    seg = np.linalg.norm(np.diff(xz, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    if s[-1] < 1e-6:
        return xz
    t = np.arange(0.0, s[-1], step)
    if t[-1] < s[-1] - 1e-6:
        t = np.append(t, s[-1])
    return np.stack([np.interp(t, s, xz[:, 0]), np.interp(t, s, xz[:, 1])], axis=1)


def _tangents2(xz):
    d = np.gradient(np.asarray(xz, dtype=np.float64), axis=0)
    n = np.linalg.norm(d, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return d / n
