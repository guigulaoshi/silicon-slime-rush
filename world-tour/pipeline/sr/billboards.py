"""Roadside billboards: where they stand, how big they are, and which content slot each one shows.

Real roads carry advertising, and a route without any reads as a closed test track rather than a
place. Two styles, chosen from the road class: a single tall column beside fast roads, a low
freestanding sign on city streets.

The pipeline only decides geometry and a slot number. What a face actually says is drawn by the
runtime from `game/public/billboards/manifest.json`, so adding an advert never means rebuilding a
track. Slots exist because instanced geometry carries one material per node: eight slots is eight
materials and eight draw calls, which is the price of showing more than one advert per track."""
import numpy as np

from shapely.geometry import LineString, Polygon, MultiPoint
from shapely.strtree import STRtree
from shapely.ops import unary_union

from sr.mesh import Mesh, box, merge, orient_by_shading, yaw_for_z_axis
from sr.bridge import tube
from sr.tiles import tile_of
from sr.terrain import APRON, ground_height

SLOTS = "abcdefghijklmn"    # seven owner adverts alternating with seven available-space faces
FULL_CYCLE = len(SLOTS)
MIN_BOARDS = 10
SOCIAL_SLOTS = SLOTS[::2]
# Seven social / three space, but still spread through the route instead of putting either class in
# one contiguous block: social, social, space repeats, then the seventh social face closes it.
FALLBACK_SLOTS = "acbegdikfm"
VIEW_DISTANCE = {"pole": 140.0, "ground": 75.0}
TREE_SIGHT_CLEARANCE = 6.5  # the largest tree crown, including its random scale
# Independent of the social/space alternation: each content class lands 3/4 or 4/3 across the two
# verges instead of social all on one side and available space all on the other.
SIDE_PATTERN = (1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0,
                -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0)

# style -> (spacing along the route, panel width, panel height, panel bottom above the *road*,
#           clearance from the painted edge to the near edge of the panel, half thickness of a post)
#
# Big, and on one fat leg. A motorway board is a landmark you read from half a kilometre out. The
# original 16 by 8 metre pole board and 8 by 4 metre street board were deliberately enlarged 20%
# so their call to action and QR code remain useful at racing speed.
STYLES = {
    "pole":   (280.0, 19.2, 9.6, 12.0, 9.0, 0.75),
    "ground": (120.0, 9.6, 4.8, 1.8, 3.5, 0.30),
}
FAST = {"motorway", "trunk", "primary"}   # _link suffixes are stripped before the lookup
LAMP_DROP = 0.75            # clearance from the panel's bottom edge down to the gantry
LAMP_OUT = 1.5              # and how far out in front (-z, the side the driver reads)
MIN_SUPPORT = 0.8           # shorter than this and the panel is sitting on the ground
MAX_SUPPORT = 25.0          # longer than this and the footing is down a cliff, not beside the road


def style_for(highway):
    """Fast roads get the tall single-column kind, everything else the low freestanding kind."""
    return "pole" if str(highway).replace("_link", "") in FAST else "ground"


def support_mesh(style):
    """The legs, authored one metre tall from the footing at the origin.

    Height is a per-instance scale rather than part of the mesh, because the panel is hung at a
    height relative to the *road* while the legs start at whatever the ground happens to be: on a
    hillside a fixed-length leg puts the advert under the tarmac, which is where the first version
    of this put every board on Twin Peaks."""
    post = STYLES[style][5]
    return tube([(0, 0, 0), (0, 1, 0)], post * np.cos(np.pi / 16),
                sides=16, material="billboard_frame")


def lamp_meshes(style):
    """Fixed-size frame and aimed floodlights for both faces share two instances."""
    _, w, h, _, _, _ = STYLES[style]
    n = 3 if style == "pole" else 2
    drop = h / 2 + LAMP_DROP
    steel = [box((0, -drop, .16), (w / 2 - .4, .09, .09), material="billboard_frame")]
    # Keep the steel on the perimeter. A diagonal can sit behind only one of the two
    # outward-facing adverts; from the other direction it crosses the artwork and its
    # shadow draws a black X over the face.
    for sign in (-1, 1):
        steel.append(box((sign * (w / 2 + .06), 0, .10), (.06, h / 2 + .12, .14),
                         material="billboard_frame"))
        steel.append(box((0, sign * (h / 2 + .06), .10), (w / 2, .06, .14),
                         material="billboard_frame"))
    for side in (-1, 1):
        steel.append(tube([(side * w * .35, -h / 2, .16),
                           (side * w * .35, -drop, .16)], .055, material="billboard_frame"))
    lenses = []
    for face_side in (-1.0, 1.0):
        for k in range(n):
            x = w * ((k + .5) / n - .5)
            lamp_z = face_side * LAMP_OUT
            centre = np.array([x, -drop + .30, lamp_z])
            aim = np.array([0.0, -centre[1], -lamp_z])
            aim /= np.linalg.norm(aim)
            # Flip local right on the rear assembly so this remains a rotation, not a reflected
            # basis: box winding and shading normals must still agree after the transform.
            right = np.array([-face_side, 0.0, 0.0])
            up = np.cross(aim, right)
            basis = np.column_stack([right, up, aim])

            def lamp_part(offset, half, material):
                part = box(offset, half, material=material)
                part.positions = (part.positions @ basis.T + centre).astype(np.float32)
                part.normals = (part.normals @ basis.T).astype(np.float32)
                return part

            # One bent central arm is enough at road distance. The old two-cheek yoke and four-piece
            # rim repeated hundreds of triangles in every tile that happened to own a board; once
            # copied to both faces that pushed Bayshore over its shipped tile budget.
            steel.append(tube([(x, -drop, .16), (x, -drop, lamp_z),
                               (x, centre[1], lamp_z)], .08, sides=4,
                              material="billboard_frame"))
            # Dark housing and a thin luminous inset: only the lens glows.
            steel.append(lamp_part((0, 0, -.025), (.55, .27, .13), "billboard_frame"))
            lenses.append(lamp_part((0, 0, .12), (.485, .205, .012), "billboard_lamp"))
    return merge(steel, material="billboard_frame"), merge(lenses, material="billboard_lamp")


def face_mesh(slot):
    """The panel: two outward-facing unit quads carrying the same advert without mirroring.

    Instances scale the quads to the panel size, which is how one mesh serves both styles.

    One mesh per slot, differing only in material name: that name is the whole mechanism by which
    the runtime puts a different advert on a different board."""
    pos = np.array([(-0.5, -0.5, 0.0), (0.5, -0.5, 0.0), (0.5, 0.5, 0.0), (-0.5, 0.5, 0.0),
                    (0.5, -0.5, 0.02), (-0.5, -0.5, 0.02), (-0.5, 0.5, 0.02), (0.5, 0.5, 0.02)])
    nor = np.vstack([np.tile([0.0, 0.0, -1.0], (4, 1)), np.tile([0.0, 0.0, 1.0], (4, 1))])
    # u runs the other way along x than you would expect: the panel faces -z, so a viewer looking
    # at it sees +x to their left. Laid out the obvious way, every advert read back to front.
    uv = np.array([(1.0, 0.0), (0.0, 0.0), (0.0, 1.0), (1.0, 1.0),
                   (1.0, 0.0), (0.0, 0.0), (0.0, 1.0), (1.0, 1.0)])
    idx = np.array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
    return orient_by_shading(Mesh(pos, nor, uv, idx, f"billboard_face_{slot}"))


def _segment_hits_box(start, end, obstacle, margin=0.35):
    """Whether a sight segment crosses one oriented building box.

    Boxes use the same yaw convention as the exported colliders. Transforming the segment into the
    box's frame turns this into the standard slab test and, unlike a footprint-only test, lets a
    tall pole board remain visible above a low building.
    """
    cx, cy, cz, hx, hy, hz, yaw = obstacle
    c, s = np.cos(yaw), np.sin(yaw)

    def local(point):
        dx, dz = point[0] - cx, point[2] - cz
        return np.array([dx * c - dz * s, point[1] - cy, dx * s + dz * c])

    a, b = local(start), local(end)
    d = b - a
    lo = np.array([-hx - margin, -hy - margin, -hz - margin])
    hi = -lo
    # Obstacles never include the board whose face is the segment endpoint, so an overlap right at
    # that endpoint is a real building swallowing the panel, not the panel hitting itself.  The old
    # 98.5% cutoff excused the last 0.7--1.8 m on an ordinary road-view ray and let two Fisherman's
    # Wharf boards sit inside mapped facades.
    t0, t1 = 0.0, 1.0
    for axis in range(3):
        if abs(d[axis]) < 1e-9:
            if a[axis] < lo[axis] or a[axis] > hi[axis]:
                return False
            continue
        enter = (lo[axis] - a[axis]) / d[axis]
        leave = (hi[axis] - a[axis]) / d[axis]
        if enter > leave:
            enter, leave = leave, enter
        t0, t1 = max(t0, enter), min(t1, leave)
        if t0 > t1:
            return False
    return True


def _view_samples(res, road_y, i, style, face_pos, width, height):
    """Driver eye and five points covering the readable part of one face."""
    target_s = max(float(res.S[i]) - VIEW_DISTANCE[style], 0.0)
    approach = int(np.searchsorted(res.S, target_s, side="left"))
    eye = np.array([res.P[approach, 0], road_y[approach] + 2.0, res.P[approach, 2]])
    right = res.R[i].copy()
    right[1] = 0.0
    right /= max(np.linalg.norm(right), 1e-9)
    points = [face_pos,
              face_pos + right * width * 0.38,
              face_pos - right * width * 0.38,
              face_pos + np.array([0.0, height * 0.30, 0.0]),
              face_pos - np.array([0.0, height * 0.30, 0.0])]
    return eye, points


def _visible(res, road_y, i, style, face_pos, width, height, obstacles):
    eye, points = _view_samples(res, road_y, i, style, face_pos, width, height)
    xs = [eye[0], *(point[0] for point in points)]
    zs = [eye[2], *(point[2] for point in points)]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    for obstacle in obstacles:
        radius = float(np.hypot(obstacle[3], obstacle[5])) + 0.5
        if obstacle[0] + radius < x0 or obstacle[0] - radius > x1:
            continue
        if obstacle[2] + radius < z0 or obstacle[2] - radius > z1:
            continue
        if any(_segment_hits_box(eye, point, obstacle) for point in points):
            return eye, points, False
    return eye, points, True


def _board_box(board):
    """The part of an accepted board that can hide a later board's face."""
    w, h = board["panel"]
    p = board["face_pos"]
    return [p[0], p[1], p[2], w / 2, h / 2, 0.18, board["yaw"]]


def placements(res, road_y, dem, on_deck=False, obstacles=(), terrain=None):
    """Every billboard on the route: style, slot, footing, how long its legs are, and its panel.

    A board faces the driver coming up to it, so its normal points back along the route. That makes
    the panel broadside to the road, which is why it is set back by its own half width plus the
    style's clearance -- otherwise the near half of a twelve metre board hangs over the tarmac."""
    S = res.S
    eligible = np.flatnonzero(~np.asarray(res.tunnel, dtype=bool) &
                              (on_deck | ~np.asarray(res.bridge, dtype=bool)))
    if not len(eligible):
        return []
    # Keep the old route-dependent density, but round it up to a complete 50/50 content cycle.
    ds = np.diff(S, prepend=S[0])
    expected = sum(ds[i] / STYLES["ground" if on_deck else style_for(res.highway[i])][0]
                   for i in eligible)
    wanted = max(FULL_CYCLE, int(np.ceil(expected)))
    if wanted % 2:
        wanted += 1
    usable_length = float(sum(ds[i] for i in eligible))
    candidate_cache = {}
    fittings = {style: merge(lamp_meshes(style)).positions for style in STYLES}
    # The rendered ground is piecewise planar; DEM samples alone miss the interpolation
    # across its triangles. Intersect the full footprint with the exported surface.
    if terrain is not None:
        triangles = terrain.positions[terrain.indices.reshape(-1, 3)]
        polygons = [Polygon(t[:, [0, 2]]) for t in triangles]
        ground_tree = STRtree(polygons)

    def ground_range(points):
        footprint = MultiPoint(points).convex_hull
        if terrain is None:
            heights = ground_height(res, road_y, dem, points)
            return float(heights.min()), float(heights.max())
        heights, area = [], 0.0
        for index in ground_tree.query(footprint, predicate="intersects"):
            hit = polygons[index].intersection(footprint)
            if hit.area <= 1e-10:
                continue
            tri = triangles[index]
            plane = np.linalg.solve(np.column_stack([tri[:, 0], tri[:, 2], np.ones(3)]), tri[:, 1])
            coords = np.asarray(hit.exterior.coords)
            heights.extend(np.column_stack([coords, np.ones(len(coords))]) @ plane)
            area += hit.area
        if not heights or area < footprint.area * .99999:
            return None
        return float(min(heights)), float(max(heights))

    def candidate(i, side):
        key = (i, side)
        if key in candidate_cache:
            return candidate_cache[key]
        style = "ground" if on_deck else style_for(res.highway[i])
        # The sight check stands the driver VIEW_DISTANCE up the road; closer to an open route's start
        # there is no road there, the eye was clamped onto the board itself and the check passed a board
        # nobody drives towards (a shortened route's first metres).
        if not res.closed and float(res.S[i]) < VIEW_DISTANCE[style]:
            candidate_cache[key] = None
            return None
        _, w, h, base, clear, _post = STYLES[style]
        # stand beyond a level parallel carriageway, never on it
        flat = res.flat_left[i] if side < 0 else res.flat_right[i]
        offset = res.half_width[i] + APRON + flat + clear + w / 2
        p = res.P[i, [0, 2]] + res.R[i, [0, 2]] * side * offset
        yaw = yaw_for_z_axis(res.T[i])
        c, sn = np.cos(yaw), np.sin(yaw)
        rotation = np.array([[c, sn], [-sn, c]])
        local = fittings[style]
        footprint = local[:, [0, 2]] @ rotation.T + p
        bounds = ((float(road_y[i]), float(road_y[i])) if on_deck else ground_range(footprint))
        if bounds is None:
            candidate_cache[key] = None
            return None
        face_y = max(float(road_y[i]) + base + h / 2, bounds[1] + .25 - local[:, 1].min())
        bottom = face_y - h / 2
        legs = []
        for x in ([0.0] if style == "pole" else [-(w / 2 - _post), w / 2 - _post]):
            centre = np.array([x, 0.0]) @ rotation.T + p
            angles = np.arange(16) * (2 * np.pi / 16)
            ring = centre + _post * np.column_stack([np.cos(angles), np.sin(angles)])
            levels = ((float(road_y[i]), float(road_y[i])) if on_deck else ground_range(ring))
            if levels is None or not MIN_SUPPORT <= bottom - levels[0] <= MAX_SUPPORT:
                candidate_cache[key] = None
                return None
            foot_y = levels[0] - (0.0 if on_deck else .05)
            legs.append((np.array([centre[0], foot_y, centre[1]]), bottom - foot_y))
        gy = min(pos[1] for pos, _height in legs)
        support = bottom - gy
        face_pos = np.array([p[0], face_y, p[1]])
        eye, samples, visible = _visible(res, road_y, i, style, face_pos, w, h, obstacles)
        if not visible:
            candidate_cache[key] = None
            return None
        result = {"style": style, "xz": p, "panel": (w, h), "base": base,
                  "yaw": yaw, "legs": legs, "side": int(side), "road_y": float(road_y[i]),
                  "support": support, "pos": np.array([p[0], gy, p[1]]),
                  "face_pos": face_pos, "view_from": eye, "view_samples": samples,
                  "route_i": i, "route_s": float(S[i])}
        candidate_cache[key] = result
        return result

    def attempt(count):
        min_route_gap = min(20.0, usable_length / count * 0.25)
        anchors = np.linspace(0, len(eligible) - 1, count + 2)[1:-1]
        used, found = set(), []
        for anchor in anchors:
            preferred_side = SIDE_PATTERN[len(found) % len(SIDE_PATTERN)]
            distance = np.abs(np.arange(len(eligible)) - anchor)
            order = np.argsort(distance)
            chosen = None
            for rank in order:
                i = int(eligible[rank])
                if i in used:
                    continue
                delta = [abs(float(S[i]) - b["route_s"]) for b in found]
                if res.closed:
                    delta = [min(gap, float(S[-1]) - gap) for gap in delta]
                if any(gap < min_route_gap for gap in delta):
                    continue
                for side in (preferred_side, -preferred_side):
                    proposed = candidate(i, side)
                    if proposed is None:
                        continue
                    board_boxes = [_board_box(board) for board in found]
                    if any(_segment_hits_box(proposed["view_from"], point, obstacle)
                           for point in proposed["view_samples"] for obstacle in board_boxes):
                        continue
                    proposed_box = _board_box(proposed)
                    if any(_segment_hits_box(board["view_from"], point, proposed_box)
                           for board in found for point in board["view_samples"]):
                        continue
                    chosen = proposed.copy()
                    break
                if chosen is not None:
                    used.add(i)
                    found.append(chosen)
                    break
            if chosen is None:
                return []
        slots = SLOTS if count >= FULL_CYCLE else FALLBACK_SLOTS
        for i, board in enumerate(found):
            board["slot"] = slots[i % len(slots)]
        return found

    # Dense urban geometry may not have room for the old preferred density. Keep the complete
    # fourteen-face cycle and even split, then use the highest even count that actually stays clear.
    for count in range(wanted, FULL_CYCLE - 1, -2):
        found = attempt(count)
        if found:
            return found
    return attempt(MIN_BOARDS)


def sight_clearance(boards):
    """Ground area where a generated tree crown would obscure an accepted face."""
    paths = [LineString([(b["view_from"][0], b["view_from"][2]),
                         (point[0], point[2])]).buffer(TREE_SIGHT_CLEARANCE, cap_style="round")
             for b in boards for point in b["view_samples"]]
    return unary_union(paths) if paths else None


def validate_placements(boards, route_id, minimum=MIN_BOARDS):
    """Fail unless a route has a full 7/7 cycle, or the explicit 7/3 constrained fallback."""
    if len(boards) < minimum:
        raise ValueError(f"{route_id}: expected at least {minimum} billboards, got {len(boards)}")
    slots = [board["slot"] for board in boards]
    if len(boards) >= FULL_CYCLE:
        if len(boards) % 2:
            raise ValueError(f"{route_id}: billboard count must be even, got {len(boards)}")
        required = set(SLOTS)
    elif len(boards) == MIN_BOARDS:
        required = set(FALLBACK_SLOTS)
        social = sum(slot in SOCIAL_SLOTS for slot in slots)
        if social != 7:
            raise ValueError(f"{route_id}: ten-board fallback must be 7 owner / 3 space, got {social}/{10-social}")
    else:
        raise ValueError(f"{route_id}: billboard count must be 10 or at least 14, got {len(boards)}")
    missing = sorted(required - set(slots))
    if missing:
        raise ValueError(f"{route_id}: billboard slots missing {', '.join(missing)}")


def add_to_tiles(ts, boards):
    """Independent column instances reach their own footing, with the panel at its
    centre, and the lamp gantry's steel and glass hanging under the panel."""
    supports = {name: support_mesh(name) for name in STYLES}
    lamps = {name: lamp_meshes(name) for name in STYLES}
    faces = {slot: face_mesh(slot) for slot in SLOTS}
    for b in boards:
        w, h = b["panel"]
        post = STYLES[b["style"]][5]
        for pos, height in b["legs"]:
            ts.add_instance(f"props_billboard_{b['style']}", pos, b["yaw"], supports[b["style"]],
                            (post, .5, post), scale=(1.0, height, 1.0))
        ts.add_instance(f"props_billboard_face_{b['slot']}", b["face_pos"], b["yaw"], faces[b["slot"]],
                        (w / 2, h / 2, 0.05), scale=(w, h, 1.0))
        node = f"props_billboard_face_{b['slot']}"
        tile = tile_of(b["face_pos"][0], b["face_pos"][2])
        ts.extras[tile].setdefault(node, {}).setdefault("billboardViews", []).append({
            "face": b["face_pos"].tolist(), "eye": b["view_from"].tolist(), "side": b["side"],
        })
        steel, lenses = lamps[b["style"]]
        lo, hi = merge([steel, lenses]).bounds()
        half = tuple(np.maximum(np.abs(lo), np.abs(hi)))
        ts.add_instance(f"props_billboard_lamps_{b['style']}", b["face_pos"], b["yaw"], steel, half)
        ts.add_instance(f"props_billboard_lamplens_{b['style']}", b["face_pos"], b["yaw"], lenses, half)
