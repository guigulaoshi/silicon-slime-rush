"""Landmarks: the few shapes that tell you which city you are looking at.

These are not buildings. A building is a footprint the map already knows about and the pipeline
extrudes; a landmark is a silhouette a person recognises from six kilometres away, and the map
records it as either nothing at all (a lattice tower is not a building) or as a footprint that
extrudes into a box telling you nothing (a prison block is a box).

So they are written here by hand and generated straight into the backdrop mesh. Position and the
footprint come from public map data; colour, roof form and facade rhythm are observations from the
reference pages recorded in docs/landmark-reference.md. Every solid here is closed. A one-sided
roof is not a cheap landmark: from the road it is a hole cut in the world.
"""
import numpy as np
from shapely.geometry import Point, Polygon

from sr.buildings import extrude
from sr.landmark_data import entries
from sr.mesh import box, from_triangles, merge, orient_to, yaw_for_x_axis

MATERIAL_STEEL = "bridge_steel"
MATERIAL_BRIDGE_METAL = "bridge_metal"
MATERIAL_GLASS = "building_landmark_glass"
MATERIAL_PALE = "building_landmark_pale"
MATERIAL_SOLAR = "building_landmark_solar"
MATERIAL_METAL = "building_landmark_metal"
MATERIAL_ROOF = "building_landmark_roof"

# OSM bridge axes, refined with the tower breaks visible in the mapped carriageways. Dimensions
# come from the public-agency references recorded in docs/landmark-reference.md. Keeping these in
# latitude/longitude makes the sight line independent of whichever route asks for the landmark.
GOLDEN_GATE = {
    "anchors": ((37.81098, -122.47691), (37.82858, -122.47963)),
    "towers": ((37.81406, -122.47768), (37.82550, -122.47920)),
    "deck_y": 67.0,
    "tower_y": 227.0,
    "half_width": 13.5,
}
BAY_BRIDGE_WEST = {
    "anchors": ((37.78648, -122.39037), (37.79727, -122.37882),
                (37.80806, -122.36726)),
    # Two back-to-back suspension bridges meet at the central anchorage. The four tower positions
    # follow the mapped 3.14 km west-span axis and its two equal 704 m channel spans.
    "towers": ((37.78892, -122.38776), (37.79376, -122.38258),
               (37.80078, -122.37506), (37.80562, -122.36988)),
    "deck_y": 67.0,
    "tower_y": 160.0,
    "half_width": 16.5,
}


def _at(frame, lat, lon):
    x, z = frame.to_local(np.array([lat]), np.array([lon]))
    return float(x[0]), float(z[0])


def _beam(start, end, radius=0.7, material=MATERIAL_METAL):
    """Closed square steel member between arbitrary 3D points."""
    a, b = np.asarray(start, dtype=float), np.asarray(end, dtype=float)
    w = b - a
    length = float(np.linalg.norm(w))
    if length < 1e-6:
        return None
    w /= length
    reference = np.array([0.0, 1.0, 0.0]) if abs(w[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(w, reference); u /= np.linalg.norm(u); u *= radius
    v = np.cross(w, u); v /= np.linalg.norm(v); v *= radius
    points = np.asarray([a-u-v, a+u-v, a+u+v, a-u+v,
                         b-u-v, b+u-v, b+u+v, b-u+v])
    faces = [([0, 2, 1, 0, 3, 2], -w), ([4, 5, 6, 4, 6, 7], w),
             ([0, 1, 5, 0, 5, 4], -v), ([3, 7, 6, 3, 6, 2], v),
             ([0, 4, 7, 0, 7, 3], -u), ([1, 2, 6, 1, 6, 5], u)]
    triangles = []
    for indices, want in faces:
        face = np.asarray(indices).reshape(-1, 3)
        triangles.append(orient_to(points, face, want))
    return from_triangles(points, np.vstack(triangles), material=material)


def _geo_point(frame, point, y):
    x, z = _at(frame, *point)
    return np.array([x, y, z], dtype=float)


def _suspension_unit(frame, anchor_a, tower_a, tower_b, anchor_b, *, deck_y,
                     tower_y, half_width, material):
    """A distant suspension span with two portal towers, twin cables and vertical suspenders."""
    points = [_geo_point(frame, p, deck_y) for p in (anchor_a, tower_a, tower_b, anchor_b)]
    axis = points[-1] - points[0]
    axis[1] = 0.0
    axis /= np.linalg.norm(axis)
    side = np.array([-axis[2], 0.0, axis[0]])
    parts = [_beam(points[0], points[-1], 3.2, material),
             _beam(points[0] - side * half_width, points[-1] - side * half_width, 2.2, material),
             _beam(points[0] + side * half_width, points[-1] + side * half_width, 2.2, material)]

    # Portal legs and three narrowing cross-members preserve the Art Deco / truss silhouette at
    # several kilometres without paying for hidden rivets or roadway detail.
    for centre in points[1:3]:
        for sign in (-1.0, 1.0):
            foot = centre + side * (half_width * sign)
            crown = centre + side * (half_width * sign * 0.72)
            foot[1], crown[1] = 0.0, tower_y
            parts.append(_beam(foot, crown, 2.7, material))
        for y, width in ((deck_y + 34.0, 0.94), (deck_y + 78.0, 0.84),
                         (tower_y - 7.0, 0.73)):
            parts.append(_beam(centre + side * (-half_width * width) + [0.0, y - deck_y, 0.0],
                               centre + side * (half_width * width) + [0.0, y - deck_y, 0.0],
                               2.0, material))

    # Cable height is a parabola: it reaches the tower crowns, sags close to the deck at midspan,
    # and falls to the anchor blocks across each side span. This is the feature that distinguishes
    # a suspension bridge from a row of generic piers at normal game distance.
    cable_radius = 1.25
    segments = ((points[0], points[1]), (points[1], points[2]), (points[2], points[3]))
    for side_sign in (-1.0, 1.0):
        lateral = side * (half_width * side_sign)
        for index, (start, end) in enumerate(segments):
            steps = max(4, int(np.linalg.norm(end - start) // 55))
            cable = []
            for i in range(steps + 1):
                t = i / steps
                p = start * (1.0 - t) + end * t + lateral
                if index == 1:
                    p[1] = (deck_y + 10.0) + (tower_y - deck_y - 10.0) * (2.0 * t - 1.0) ** 2
                else:
                    q = t if index == 0 else 1.0 - t
                    p[1] = (deck_y + 5.0) + (tower_y - deck_y - 5.0) * q ** 2
                cable.append(p)
            for a, b in zip(cable, cable[1:]):
                parts.append(_beam(a, b, cable_radius, material))
            for p in cable[1:-1:2]:
                if p[1] > deck_y + 5.0:
                    deck = p.copy(); deck[1] = deck_y
                    parts.append(_beam(deck, p, 0.42, material))
    return parts


def golden_gate_bridge(frame, _dem):
    spec = GOLDEN_GATE
    return _suspension_unit(frame, spec["anchors"][0], spec["towers"][0], spec["towers"][1],
                            spec["anchors"][1], deck_y=spec["deck_y"],
                            tower_y=spec["tower_y"], half_width=spec["half_width"],
                            material=MATERIAL_STEEL)


def bay_bridge_west(frame, _dem):
    spec = BAY_BRIDGE_WEST
    parts = []
    for unit in range(2):
        parts += _suspension_unit(frame, spec["anchors"][unit], spec["towers"][unit * 2],
                                  spec["towers"][unit * 2 + 1], spec["anchors"][unit + 1],
                                  deck_y=spec["deck_y"], tower_y=spec["tower_y"],
                                  half_width=spec["half_width"], material=MATERIAL_BRIDGE_METAL)
    # The concrete centre anchorage is visible between the paired suspension units.
    centre = _geo_point(frame, spec["anchors"][1], 43.0)
    parts.append(box(centre, (19.0, 43.0, 19.0), material=MATERIAL_PALE))
    return parts


def alcatraz(frame, dem):
    """The island's cell house and lighthouse.

    The rock itself is already in the backdrop terrain; what makes the island read as Alcatraz is
    the long pale block along its spine with the lighthouse standing off one end."""
    cx, cz = _at(frame, 37.82670, -122.42300)
    sampled = float(dem.heights(np.array([37.82670]), np.array([-122.42300]))[0])
    base = max(sampled, 12.0)       # the coarse elevation flattens a five hundred metre island
    foundation = min(sampled - 1.0, 0.0)
    # `box` yaw rotates its long local Z axis. 24 degrees pointed that axis almost exactly at
    # Fisherman's Wharf, so the route saw a square end wall instead of Alcatraz's long west facade.
    yaw = np.radians(114.0)
    # The long pale cellhouse, stepped hospital/admin wings and dark shallow roof are the three
    # bands visible from the water. At the real Fisherman's Wharf sight line the low-resolution
    # island terrain hides roughly the first forty metres, so the recognisable upper storeys start
    # slightly below the sampled ridge and rise a full twenty-two metres above it. The former solid
    # foundation technically existed but read as bare island because only its top few pixels escaped.
    parts = [
        # Keep a buried foundation so the prison can never float above the coarse backdrop.
        box((cx, (foundation + base + 22.0) / 2, cz),
            (20.0, (base + 22.0 - foundation) / 2, 67.0), yaw=yaw,
            material=MATERIAL_PALE),
        box((cx - 15.0, base + 16.0, cz + 8.0), (9.0, 6.0, 39.0), yaw=yaw,
            material=MATERIAL_PALE),
        box((cx + 7.0, base + 20.0, cz - 8.0), (11.0, 5.0, 34.0), yaw=yaw,
            material=MATERIAL_PALE),
        box((cx, base + 23.0, cz), (18.0, 1.0, 64.0), yaw=yaw, material=MATERIAL_ROOF),
    ]
    # Three rows of dark cell windows give the long block its prison rhythm at telephoto distance.
    # They are deliberately broad enough to survive a 932-pixel phone render from 2.2 km away.
    # The outer pane also stands .85 m off the wall: .33 m lost against depth precision
    # at that distance and broke the old windows into flickering black triangles.
    c, s = np.cos(yaw), np.sin(yaw)
    for side in (-1.0, 1.0):
        for y in (base + 7.0, base + 13.0, base + 19.0):
            for along in np.linspace(-57.0, 57.0, 19):
                local_x, local_z = side * 20.55, along
                wx, wz = cx + c * local_x + s * local_z, cz - s * local_x + c * local_z
                parts.append(box((wx, y, wz), (0.3, 1.25, 1.5), yaw=yaw,
                                 material=MATERIAL_GLASS))
    lx, lz = _at(frame, 37.82620, -122.42200)
    for y0, y1, radius in ((foundation, base + 14.0, 4.8),
                           (base + 14.0, base + 31.0, 3.7),
                           (base + 31.0, base + 38.0, 2.9)):
        parts.append(extrude(Point(lx, lz).buffer(radius, quad_segs=8), y0, y1,
                             material=MATERIAL_PALE))
    lantern = Point(lx, lz).buffer(4.5, quad_segs=8)
    parts.append(extrude(lantern, base + 37.0, base + 42.0, material=MATERIAL_GLASS))
    parts.append(box((lx, base + 43.0, lz), (5.2, 1.0, 5.2), material=MATERIAL_ROOF))
    # The water tower is small but breaks the prison block's roofline in every island profile.
    wx, wz = _at(frame, 37.82702, -122.42355)
    leg_bottom, leg_top = base + 14.0, base + 40.0
    for ox in (-3.8, 3.8):
        for oz in (-3.8, 3.8):
            parts.append(_beam((wx + ox, leg_bottom, wz + oz),
                               (wx + ox * 0.65, leg_top, wz + oz * 0.65),
                               0.45, MATERIAL_METAL))
    tank = Point(wx, wz).buffer(5.8, quad_segs=16)
    parts.append(extrude(tank, base + 40.0, base + 46.0, material=MATERIAL_METAL))
    for y in (base + 40.1, base + 45.8):
        ring = Point(wx, wz).buffer(6.05, quad_segs=16).difference(
            Point(wx, wz).buffer(5.65, quad_segs=16))
        parts.append(extrude(ring, y, y + .3, material=MATERIAL_PALE))
    # Cross-braced legs and circular tank replace the generic square-topped scaffold.
    for sign in (-1., 1.):
        for y0, y1 in ((leg_bottom, (leg_bottom+leg_top)/2), ((leg_bottom+leg_top)/2, leg_top)):
            for reverse in (-1., 1.):
                parts.append(_beam((wx-3.2*reverse, y0, wz+sign*3.2),
                                   (wx+3.2*reverse, y1, wz+sign*3.2), .22, MATERIAL_METAL))
                parts.append(_beam((wx+sign*3.2, y0, wz-3.2*reverse),
                                   (wx+sign*3.2, y1, wz+3.2*reverse), .22, MATERIAL_METAL))
    # Pale piers and floor cornices articulate the three-storey cellhouse from the bay.
    for side in (-1., 1.):
        for along in np.linspace(-64.,64.,9):
            px, pz = cx+c*side*20.25+s*along, cz-s*side*20.25+c*along
            parts.append(box((px,base+12.,pz),(.35,10.,.55),yaw=yaw,material=MATERIAL_PALE))
        for y in (base+3.,base+22.):
            px,pz=cx+c*side*20.2,cz-s*side*20.2
            parts.append(box((px,y,pz),(.4,.24,67.),yaw=yaw,material=MATERIAL_PALE))
    balcony = Point(lx,lz).buffer(5.5,quad_segs=16).difference(Point(lx,lz).buffer(4.5,quad_segs=16))
    parts.append(extrude(balcony,base+36.6,base+37.,material=MATERIAL_PALE))
    for angle in np.linspace(0,2*np.pi,20,endpoint=False):
        px,pz=lx+5.2*np.cos(angle),lz+5.2*np.sin(angle)
        parts.append(_beam((px,base+37.,pz),(px,base+38.,pz),.1,MATERIAL_METAL))
    rim=Point(lx,lz).buffer(5.3,quad_segs=16).difference(Point(lx,lz).buffer(5.1,quad_segs=16))
    parts.append(extrude(rim,base+37.9,base+38.05,material=MATERIAL_METAL))
    return parts


def sutro_tower(frame, dem):
    """Three splayed legs and the two crossbars, on the ridge above the city.

    It is 297 m of open lattice, so a solid model would read as a slab. Three tapering legs and the
    two horizontal platforms are the whole silhouette; there is nothing else to see at this range."""
    cx, cz = _at(frame, 37.75520, -122.45280)
    base = float(dem.heights(np.array([37.75520]), np.array([-122.45280]))[0])
    top = 270.0                       # 298 m total including the antenna crown
    spread = 31.0                     # how far the feet stand from the centre
    parts = []
    for k in range(3):
        a = np.radians(90.0 + k * 120.0)
        fx, fz = cx + np.cos(a) * spread, cz + np.sin(a) * spread
        steps = 12
        for i in range(steps):
            t0, t1 = i / steps, (i + 1) / steps
            # the legs lean in: at the foot they are `spread` out, at the top they meet
            r0, r1 = spread * (1 - t0), spread * (1 - t1)
            x0, z0 = cx + np.cos(a) * r0, cz + np.sin(a) * r0
            x1, z1 = cx + np.cos(a) * r1, cz + np.sin(a) * r1
            band_material = MATERIAL_STEEL if i % 2 == 0 else MATERIAL_ROOF
            parts.append(_beam((x0, base + top * t0, z0), (x1, base + top * t1, z1),
                               1.15, band_material))
            # An X on every face, between this leg and the next. These members must slope in y;
            # horizontal yaw-only boxes made the old tower look like three telephone ladders.
            a2 = np.radians(90.0 + ((k + 1) % 3) * 120.0)
            q0 = (cx + np.cos(a2) * r0, base + top * t0, cz + np.sin(a2) * r0)
            q1 = (cx + np.cos(a2) * r1, base + top * t1, cz + np.sin(a2) * r1)
            parts.append(_beam((x0, base + top * t0, z0), q1, 0.48, band_material))
            parts.append(_beam(q0, (x1, base + top * t1, z1), 0.48, band_material))
    for frac, half in ((0.34, 25.0), (0.55, 20.0), (0.72, 15.0)):
        material = MATERIAL_STEEL if int(frac * steps) % 2 == 0 else MATERIAL_ROOF
        parts.append(box((cx, base + top * frac, cz), (half, 2.2, half),
                         material=material, uv_scale=8.0))
    # Aviation paint continues through the crown as the same orange-white cadence as the frame.
    for i in range(4):
        material = MATERIAL_STEEL if i % 2 == 0 else MATERIAL_ROOF
        parts.append(box((cx, base + top + 3.5 + i * 7.0, cz), (1.2, 3.5, 1.2),
                         material=material))
    return parts


def _polygon(entry, frame):
    ring = entry["footprint"]
    x, z = frame.to_local([p[0] for p in ring], [p[1] for p in ring])
    poly = Polygon(np.stack([x, z], axis=1))
    return poly.buffer(-float(entry.get("insetM", 0.0)), join_style="mitre")


def _base(poly, frame, dem):
    lat, lon = frame.to_latlon(np.array([poly.centroid.x]), np.array([poly.centroid.y]))
    return float(dem.heights(lat, lon)[0])


def _overlook(entry, frame, dem):
    poly = _polygon(entry, frame)
    base = _base(poly, frame, dem)
    rail_top = base + float(entry["heightM"])
    # Christmas Tree Point is an open paved overlook edged by low stone and steel, not a building.
    # A full 1.2 m extrusion made the road-level silhouette a roofed beige box. Keep only a thin
    # closed deck; the space between its rails stays actual sky.
    deck_top = base + 0.16
    parts = [extrude(poly, base, deck_top, material=MATERIAL_PALE)]
    rect = np.asarray(poly.minimum_rotated_rectangle.exterior.coords[:-1])
    for i in range(4):
        a, b = rect[i], rect[(i + 1) % 4]
        d = b - a
        length = float(np.linalg.norm(d))
        # Two slender horizontal members plus regularly spaced posts are readable on a phone while
        # remaining visibly open. `_beam` closes every member at arbitrary orientation.
        for y in (base + 0.62, rail_top):
            parts.append(_beam((a[0], y, a[1]), (b[0], y, b[1]), 0.07, MATERIAL_METAL))
        # Regular stone coping blocks add a visible, low edge without closing the sky above it.
        inward = np.asarray(poly.centroid.coords[0]) - (a+b)/2
        inward /= np.linalg.norm(inward)
        blocks = max(1, int(length / 2.5))
        for t in (np.arange(blocks)+.5)/blocks:
            p = a+d*t+inward*.25
            parts.append(box((p[0],base+.30,p[1]),(length/blocks*.47,.14,.3),
                             yaw=yaw_for_x_axis(d),material=MATERIAL_PALE))
        if length > 20 and i % 2 == 0:
            for t in (.3,.7):
                p = a+d*t+inward*2.0
                bench_yaw=yaw_for_x_axis(d)
                parts.append(box((p[0],base+.7,p[1]),(1.8,.10,.43),yaw=bench_yaw,material=MATERIAL_ROOF))
                for sign in (-1,1):
                    q=p+d/length*sign*1.35
                    parts.append(box((q[0],base+.42,q[1]),(.13,.28,.35),yaw=bench_yaw,material=MATERIAL_METAL))
        post_count = max(2, int(np.ceil(length / 3.0)) + 1)
        for t in np.linspace(0.0, 1.0, post_count):
            p = a + d * t
            parts.append(_beam((p[0], deck_top, p[1]),
                               (p[0], rail_top + 0.07, p[1]), 0.07, MATERIAL_METAL))
    return parts


REGISTRY = {"alcatraz": alcatraz, "sutro-tower": sutro_tower,
            "golden-gate-bridge": golden_gate_bridge, "bay-bridge-west": bay_bridge_west}
KINDS = {"overlook": _overlook}


def build(names, frame, dem):
    """Merged geometry for the named landmarks, or None if a route asks for none of them."""
    parts = []
    specs = entries()
    for name in names or ():
        make = REGISTRY.get(name)
        if make is not None:
            parts += make(frame, dem)
            continue
        entry = specs.get(name)
        if entry is not None and entry.get("kind") == "glb":
            continue
        if entry is None or entry.get("kind") not in KINDS:
            known = sorted(set(REGISTRY) | set(specs))
            raise KeyError(f"unknown landmark {name!r}; known: {known}")
        parts += KINDS[entry["kind"]](entry, frame, dem)
    if not parts:
        return None
    nodes = {MATERIAL_STEEL: "landmark_steel", MATERIAL_BRIDGE_METAL: "landmark_bridge_metal",
             MATERIAL_GLASS: "landmark_glass",
             MATERIAL_PALE: "landmark_pale", MATERIAL_SOLAR: "landmark_solar",
             MATERIAL_METAL: "landmark_metal", MATERIAL_ROOF: "landmark_roof"}
    return {nodes[material]: merge([p for p in parts if p.material == material], material)
            for material in nodes if any(p.material == material for p in parts)}
