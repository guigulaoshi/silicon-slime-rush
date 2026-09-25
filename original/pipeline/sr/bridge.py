"""Suspension bridge ironwork: towers, main cables, suspender ropes and the stiffening truss.

The deck alone is a grey ribbon over water. What makes a bridge recognisable from the car is
everything above and below it -- two towers going past, the main cable sweeping down to meet the
deck at mid-span and back up, and the ropes ticking by. So this is generated from the route itself
rather than modelled by hand: the geometry lands exactly on the deck the pipeline actually built,
at whatever height the profile gave it.

Everything here stands outside the guardrail and carries no collider. A suspender rope is a
centimetres-thick cable at the edge of the roadway; a car that could hit one would be undriveable,
and the barrier at the deck edge already stops the car reaching them."""
import numpy as np

from sr.mesh import Mesh, box, merge, orient_by_shading, yaw_for_x_axis
from sr.roads import ROAD_LIFT

CLEAR = 1.5              # cables and towers stand this far outside the painted edge
CABLE_HALF = 0.45        # main cable, half thickness
ROPE_HALF = 0.09         # suspender rope
LEG_TOP_HALF = (2.2, 3.2)    # tower leg, half size at the top (across the road, along it)
LEG_BASE_HALF = (3.6, 5.0)   # and at the waterline: real towers taper as they rise
LEG_STEPS = 9
BRACE_HALF_Y = 1.6       # portal brace between the legs
PORTAL_CLEAR = 7.5       # lowest brace above the deck: high enough to drive under
TRUSS_HALF = 0.5         
TRUSS_TOP_CLEAR = 0.25
UPPER_CHORD_DROP = ROAD_LIFT + TRUSS_TOP_CLEAR + TRUSS_HALF
PIER_HALF = (2.4, 4.0)   # approach viaduct pier, half size across the road and along it
MATERIAL = "bridge_steel"


def yaw_across(right):
    """Yaw whose local x axis follows the route's right vector."""
    # `mesh.box` rotates local x to (cos(yaw), -sin(yaw)) in world x/z. The previous atan2(R.x,
    # R.z) assumes the more usual (cos, sin), turning a Golden Gate portal 90 degrees so its long
    # axis floated parallel to traffic instead of joining the two tower legs.
    return yaw_for_x_axis(right)


def _span(res):
    """First and last sample of the bridged part of the route, as one run.

    The map data breaks the deck into several ways and sometimes leaves a couple of metres
    untagged between them, which is a data seam and not a gap in the bridge."""
    idx = np.flatnonzero(res.bridge)
    return (int(idx[0]), int(idx[-1])) if len(idx) else None


def _nearest(res, lat, lon):
    x, z = res.frame.to_local(np.array([lat]), np.array([lon]))
    d = np.hypot(res.P[:, 0] - x[0], res.P[:, 2] - z[0])
    return int(np.argmin(d))


def cable_height(S, s_towers, s_ends, top, mid, anchor):
    """Height of the main cable above the deck at each arc length.

    Between the towers it is the familiar parabola dipping to just above the deck at mid-span;
    outside them it runs from the tower top down to the anchorage. A parabola rather than a true
    catenary because a loaded suspension cable really is close to parabolic, and over a kilometre
    the difference is centimetres."""
    a, b = s_towers
    s0, s1 = s_ends
    midpoint = (a + b) / 2
    out = np.full(len(S), anchor, dtype=float)
    main = (S >= a) & (S <= b)
    half = max(b - midpoint, 1e-6)
    out[main] = mid + (top - mid) * ((S[main] - midpoint) / half) ** 2
    for s_end, s_tower in ((s0, a), (s1, b)):
        side = (S >= min(s_end, s_tower)) & (S <= max(s_end, s_tower))
        reach = s_tower - s_end
        if abs(reach) < 1e-6:
            continue
        out[side] = anchor + (top - anchor) * ((S[side] - s_end) / reach) ** 2
    return out


def tube(points, half, material=MATERIAL, sides=4):
    """A polygonal tube swept along a polyline, following its slope exactly.

    Yawed boxes were the first attempt and they cannot pitch: near the towers, where the main cable
    climbs about as fast as it runs, the cable came out as a visible staircase. Four sides keep a
    structural chord square; six or eight sides give a cable a round silhouette and radial normals,
    so painted steel catches a moving highlight instead of reading as a flat strip."""
    P = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    if len(P) < 2:
        return None
    d = np.gradient(P, axis=0)
    ln = np.linalg.norm(d, axis=1, keepdims=True); ln[ln == 0] = 1.0
    d = d / ln
    up = np.tile(np.array([0.0, 1.0, 0.0]), (len(P), 1))
    r = np.cross(up, d)
    rn = np.linalg.norm(r, axis=1, keepdims=True)
    r = np.where(rn > 1e-6, r / np.maximum(rn, 1e-9), np.array([1.0, 0.0, 0.0]))
    u = np.cross(d, r)
    angles = np.arange(sides, dtype=float) * (2 * np.pi / sides) + np.pi / sides
    radial = [r * np.cos(angle) + u * np.sin(angle) for angle in angles]
    radius = half / np.cos(np.pi / sides)  # `half` stays the distance from centre to each face
    pos = np.concatenate([P + normal * radius for normal in radial])
    nor = np.concatenate(radial)
    n = len(P)
    tri = []
    for i in range(n - 1):
        for k in range(sides):
            a = k * n + i; b = k * n + i + 1
            c = ((k + 1) % sides) * n + i; e = ((k + 1) % sides) * n + i + 1
            tri += [a, b, c, b, e, c]
    uv = np.zeros((len(pos), 2))
    return orient_by_shading(Mesh(pos, nor, uv, np.array(tri), material))


def tower(res, road_y, i, top_above_deck, offset):
    """Two tapering legs standing in the water, with portal braces across them."""
    parts = []
    P = res.P[i]
    R = res.R[i]
    yaw = yaw_across(R)
    deck = float(road_y[i])
    top = deck + top_above_deck
    for side in (-1.0, 1.0):
        base = P + R * side * offset
        for k in range(LEG_STEPS):
            y0, y1 = top * k / LEG_STEPS, top * (k + 1) / LEG_STEPS
            t = (y0 + y1) / 2 / top
            ha = LEG_BASE_HALF[0] + (LEG_TOP_HALF[0] - LEG_BASE_HALF[0]) * t
            hb = LEG_BASE_HALF[1] + (LEG_TOP_HALF[1] - LEG_BASE_HALF[1]) * t
            parts.append(box((base[0], (y0 + y1) / 2, base[2]), (ha, (y1 - y0) / 2, hb),
                             yaw=yaw, material=MATERIAL))
    # The lowest brace above the deck is the portal traffic drives through, so it has to clear the
    # roadway: a strut two metres over the tarmac reads as a bar across the road even with no
    # collider on it. The rest climb the tower.
    for y in [deck * 0.45, deck + PORTAL_CLEAR] + [deck + (top - deck) * f for f in (0.35, 0.7, 0.98)]:
        if 0 < y <= top:
            parts.append(box((P[0], y, P[2]), (offset, BRACE_HALF_Y, LEG_TOP_HALF[1] * 0.7),
                             yaw=yaw, material=MATERIAL))
    return parts


def piers(res, road_y, sl, keep, step):
    """Columns under the approach viaducts, where the deck is not hung from anything.

    Without them the run-up to the bridge is a ribbon floating over the water, which is the first
    thing anyone notices from the hairpins looking back."""
    parts = []
    S = res.S[sl]
    deck = np.asarray(road_y)[sl]
    P = res.P[sl]
    R = res.R[sl]
    for s in np.arange(S[0] + step / 2, S[-1], step):
        k = int(np.searchsorted(S, s))
        if k >= len(S) or keep[k]:
            continue
        yaw = yaw_across(R[k])
        top = float(deck[k]) - TRUSS_HALF
        if top <= 1.0:
            continue
        parts.append(box((P[k][0], top / 2, P[k][2]), (PIER_HALF[0], top / 2, PIER_HALF[1]),
                         yaw=yaw, material=MATERIAL))
    return parts


def stiffening_truss(line, deck, depth):
    """The two chords running under the deck edge, top and bottom of the stiffening truss.

    `line` is the deck edge polyline, `deck` the deck datum at each of its points. The upper chord
    hangs by UPPER_CHORD_DROP, which already contains its own half-thickness -- see that constant
    for what happens when it does not."""
    out = []
    for drop in (UPPER_CHORD_DROP, depth):
        chord = line.copy()
        chord[:, 1] = deck - drop
        out.append(tube(chord[::8], TRUSS_HALF))
    return out


def suspension(res, road_y, spec):
    """Every piece of ironwork on the bridge, merged into one mesh.

    `spec` is the route's `suspension` block: the two tower positions as lat/lon, how far the towers
    rise above the deck, how close the cable comes to the deck at mid-span, and the truss depth."""
    run = _span(res)
    if run is None or not spec:
        return None
    i0, i1 = run
    sl = slice(i0, i1 + 1)
    S = res.S[sl]
    deck = np.asarray(road_y)[sl]
    P = res.P[sl].copy()
    P[:, 1] = deck
    R = res.R[sl]
    hw = res.half_width[sl] + CLEAR

    i_towers = [_nearest(res, lat, lon) for lat, lon in spec["towers"]]
    s_towers = sorted(float(res.S[i]) for i in i_towers)
    top = float(spec.get("towerAboveDeckM", 160.0))
    mid = float(spec.get("midCableAboveDeckM", 3.0))
    anchor = float(spec.get("anchorAboveDeckM", 0.5))
    step = float(spec.get("suspenderStepM", 15.0))
    truss = float(spec.get("trussDepthM", 7.6))
    # The suspended structure is the main span plus one side span at each end. Beyond that the deck
    # is carried on an approach viaduct, and running the cable out to the last bridge sample would
    # hang nine hundred metres of rope over a road that is really sitting on columns.
    side_span = float(spec.get("sideSpanM", 343.0))
    ends = (max(float(S[0]), s_towers[0] - side_span), min(float(S[-1]), s_towers[1] + side_span))
    hung = (S >= ends[0]) & (S <= ends[1])

    above = cable_height(S, s_towers, ends, top, mid, anchor)
    parts, cables = [], []
    for side in (-1.0, 1.0):
        line = P + R * side * hw[:, None]
        cable = line[hung].copy()
        cable[:, 1] = deck[hung] + above[hung]
        cables.append(tube(cable[::4], CABLE_HALF, sides=8))
        for s in np.arange(ends[0] + step, ends[1], step):
            k = int(np.searchsorted(S, s))
            if k >= len(S) or above[k] < 2.5:
                continue
            rod = np.repeat(line[k:k + 1], 2, axis=0)
            rod[:, 1] = [deck[k], deck[k] + above[k]]
            parts.append(tube(rod, ROPE_HALF, sides=6))
        cables.extend(stiffening_truss(line, deck, truss))

    parts += piers(res, road_y, sl, hung, float(spec.get("pierStepM", 60.0)))
    for i in i_towers:
        parts += tower(res, road_y, i, top, float(res.half_width[i] + CLEAR))
    return merge(parts + [c for c in cables if c is not None], material=MATERIAL)
