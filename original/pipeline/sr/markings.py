"""Painted lane markings, derived from the map data rather than placed by hand.

The game is meant to read as real, and a strip of asphalt with nothing painted on it does not: no
amount of modelling makes an unmarked ribbon look like a road. So every route gets a centre line,
lane dividers and edge lines, worked out from what OpenStreetMap says about the way -- how many
lanes, and whether it is one direction or two.

The lines are thin strips of their own geometry two centimetres above the driving surface, not a
texture on it. A texture would need a second uv set, an alpha channel and a decision about what
happens where the road widens; strips follow the centreline exactly, bend with every corner, and
cost about twenty thousand triangles on a five kilometre route, which is a fifth of the terrain."""
import numpy as np

from sr.mesh import merge, ribbon
from sr.roads import ROAD_LIFT

# Real paint is 10 to 15 cm and dashes are 3 on, 9 off. These are wider and shorter-pitched,
# because the driving surface here is a design decision -- twelve to twenty-eight metres, wider
# than the real street -- and paint drawn to scale on it reads as a scratch at 250 km/h.
LINE_W = 0.22            # painted line, metres
DOUBLE_GAP = 0.18        # clear gap between the two lines of a double yellow
DASH_ON = 4.0            # a dashed lane line: four metres painted, eight clear
DASH_OFF = 8.0
EDGE_INSET = 0.35        # centre of the edge line, in from the painted edge
LANE_MIN = 3.0           # narrowest lane worth painting a divider for
# Above the *driving surface*, not above the terrain: the race ribbon is itself lifted off the
# ground, and paint set from the ground ends up four centimetres under the tarmac, showing
# through only where the road happens to dip. That is exactly what the first version did.
LIFT = ROAD_LIFT + 0.02
YELLOW = "line_yellow"
WHITE = "line_white"
STOP_BEFORE = 6.0
STOP_WIDTH = 0.55
CROSSWALK_BARS = 6
CROSSWALK_PITCH = 1.15
CROSSWALK_WIDTH = 0.55
ARROW_BEFORE = 19.0
ARROW_SHAFT = 4.2
ARROW_WIDTH = 0.42


def lane_count(usable, lane_w):
    """How many lanes fit in `usable` metres. At least one: a road always has a lane."""
    return max(1, int(round(usable / lane_w)))


def offsets(res, i, lane_w):
    """Every painted line at sample i, keyed by which line it is: key -> (offset, material, dashed).

    The key matters more than the order. Road width changes along a route, so the number of lane
    dividers changes with it; keying each line by what it is means the edge line stays one
    continuous line while a divider simply stops where its lane runs out.

    Right-hand traffic, and a divided carriageway is drawn as one road with the median on its left,
    which is why the left edge of a one-way carriageway is yellow and the right edge white."""
    half = float(res.half_width[i])
    usable = max(half - EDGE_INSET, lane_w)
    out = {}
    if res.highway[i] == "runway":
        # FAA runway paint is white: one dashed centre line and continuous edge lines. Treating a
        # 61 m runway as an eight-lane road draws motorway dividers and double yellow down it.
        out[("runway-centre", 0)] = (0.0, WHITE, True)
        out[("runway-edge", -1)] = (-usable, WHITE, False)
        out[("runway-edge", 1)] = (usable, WHITE, False)
        return out
    if res.highway[i] == "taxiway":
        # Taxiway guidance is yellow. The wider edge pair also makes the race turn legible from the
        # runway without inventing road lanes on an apron.
        out[("taxiway-centre", 0)] = (0.0, YELLOW, False)
        out[("taxiway-edge", -1)] = (-usable, YELLOW, False)
        out[("taxiway-edge", 1)] = (usable, YELLOW, False)
        return out
    if res.oneway[i]:
        lanes = lane_count(2 * usable, lane_w)
        step = 2 * usable / lanes
        for k in range(1, lanes):
            out[("divider", 0, k)] = (-usable + k * step, WHITE, True)
        out[("edge", -1)] = (-usable, YELLOW, False)       # median side of a divided road
        out[("edge", 1)] = (usable, WHITE, False)
    else:
        out[("centre", -1)] = (-(DOUBLE_GAP + LINE_W) / 2, YELLOW, False)
        out[("centre", 1)] = ((DOUBLE_GAP + LINE_W) / 2, YELLOW, False)
        lanes = lane_count(usable, lane_w)
        step = usable / lanes
        for k in range(1, lanes):
            out[("divider", -1, k)] = (-k * step, WHITE, True)
            out[("divider", 1, k)] = (k * step, WHITE, True)
        out[("edge", -1)] = (-usable, WHITE, False)
        out[("edge", 1)] = (usable, WHITE, False)
    return out


def _runs(mask, min_len=2):
    """Contiguous True ranges, as half-open index pairs."""
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    if start is not None and len(mask) - start >= min_len:
        out.append((start, len(mask)))
    return out


def _dash_mask(S):
    """The painted parts of a dashed line, at a fixed period along the route."""
    return (S % (DASH_ON + DASH_OFF)) < DASH_ON


def _strip(res, road_y, lateral, material, a, b):
    """One painted line, or one dash of one, offset sideways from the centreline."""
    sl = slice(a, b)
    P = res.P[sl].copy()
    P[:, 1] = road_y[sl]
    C = P + res.R[sl] * lateral[sl, None]
    if len(C) < 2:
        return None
    return ribbon(C, res.R[sl], np.full(len(C), LINE_W / 2), y_offset=LIFT,
                  closed=False, uv_scale=1.0, material=material, S=res.S[sl])


def _pose(res, road_y, s):
    """Route point, tangent, right and half-width interpolated at distance ``s``."""
    if res.closed:
        s %= res.length
    else:
        s = float(np.clip(s, res.S[0], res.S[-1]))
    i = min(int(np.searchsorted(res.S, s, side="right")), len(res.S) - 1)
    a = max(0, i - 1)
    b = i
    span = res.S[b] - res.S[a]
    f = 0.0 if span == 0 else (s - res.S[a]) / span
    centre = res.P[a] * (1.0 - f) + res.P[b] * f
    centre[1] = road_y[a] * (1.0 - f) + road_y[b] * f
    tangent = res.T[a] * (1.0 - f) + res.T[b] * f
    tangent[1] = 0.0
    tangent /= max(np.linalg.norm(tangent), 1e-9)
    right = res.R[a] * (1.0 - f) + res.R[b] * f
    right[1] = 0.0
    right /= max(np.linalg.norm(right), 1e-9)
    half = float(res.half_width[a] * (1.0 - f) + res.half_width[b] * f)
    return centre, tangent, right, half


def _bar(centre, axis, across, length, width):
    """One rectangular paint strip, made by the same ribbon primitive as lane lines."""
    P = np.stack([centre - axis * length / 2.0, centre + axis * length / 2.0])
    P[:, 1] = centre[1]
    R = np.stack([across, across])
    return ribbon(P, R, np.full(2, width / 2.0), y_offset=LIFT, closed=False,
                  uv_scale=1.0, material=WHITE)


def _turn_lane_centre(res, i, lane_w):
    """Centre of the rightmost lane, derived from the lane-line layout that bounds it."""
    lines = offsets(res, i, lane_w)
    if res.oneway[i]:
        boundaries = sorted(value[0] for key, value in lines.items()
                            if key[0] in {"divider", "edge"})
    else:
        boundaries = [0.0] + sorted(value[0] for key, value in lines.items()
                                  if (key[0] == "divider" and value[0] > 0.0) or
                                  key == ("edge", 1))
    return (boundaries[-2] + boundaries[-1]) / 2.0


def junction_markings(res, road_y, lane_w, junctions):
    """Stop line, zebra crossing and turn arrow at road-network-derived junctions."""
    parts = []
    for junction in junctions:
        junction_s = float(res.S[junction.route_index])

        centre, tangent, right, half = _pose(res, road_y, junction_s - STOP_BEFORE)
        parts.append(_bar(centre, right, -tangent, 2.0 * (half - EDGE_INSET), STOP_WIDTH))

        first = -(CROSSWALK_BARS - 1) * CROSSWALK_PITCH / 2.0
        for k in range(CROSSWALK_BARS):
            centre, tangent, right, half = _pose(
                res, road_y, junction_s + first + k * CROSSWALK_PITCH)
            parts.append(_bar(centre, right, -tangent,
                              2.0 * (half - EDGE_INSET), CROSSWALK_WIDTH))

        centre, tangent, right, half = _pose(res, road_y, junction_s - ARROW_BEFORE)
        lane_offset = _turn_lane_centre(res, junction.route_index, lane_w)
        centre = centre + right * lane_offset
        parts.append(_bar(centre, tangent, right, ARROW_SHAFT, ARROW_WIDTH))
        head = centre + tangent * (ARROW_SHAFT / 2.0)
        turn = right * junction.turn_side
        parts.append(_bar(head + turn * 0.7, turn, -tangent, 1.8, ARROW_WIDTH))
        tip = head + turn * 1.65
        for diagonal in (turn + tangent, turn - tangent):
            diagonal /= np.linalg.norm(diagonal)
            across = np.array([diagonal[2], 0.0, -diagonal[0]])
            parts.append(_bar(tip - diagonal * 0.55, diagonal, across, 1.1, ARROW_WIDTH))
    return merge(parts, material=WHITE) if parts else None


def markings(res, road_y, lane_w, junctions=()):
    """Every painted line on the route, merged per material.

    Lines are laid out per sample, so where the surface widens the lanes widen with it and the edge
    lines stay on the edge. That matters because the driving surface here is a design decision --
    wider than the real street -- and markings drawn for the real width would sit in the wrong
    place."""
    n = len(res.P)
    if n < 2:
        return {}
    per_point = [offsets(res, i, lane_w) for i in range(n)]
    keys = sorted({k for d in per_point for k in d}, key=repr)
    dash = _dash_mask(res.S)
    parts = {}
    for key in keys:
        present = np.array([key in d for d in per_point])
        lateral = np.array([per_point[i][key][0] if present[i] else 0.0 for i in range(n)])
        first = next(i for i in range(n) if present[i])
        material, dashed = per_point[first][key][1], per_point[first][key][2]
        mask = present & dash if dashed else present
        for a, b in _runs(mask):
            m = _strip(res, road_y, lateral, material, a, b)
            if m is not None:
                parts.setdefault(material, []).append(m)
    junction_paint = junction_markings(res, road_y, lane_w, junctions)
    if junction_paint is not None:
        parts.setdefault(WHITE, []).append(junction_paint)
    return {mat: merge(ms, material=mat) for mat, ms in parts.items()}
