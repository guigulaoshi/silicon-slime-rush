"""Turn a route definition into a drivable centerline: snap waypoints to the OSM road graph,
shortest-path between them, smooth, resample every 2 m, and attach per-point road attributes."""
from dataclasses import dataclass, field

import networkx as nx
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.spatial import cKDTree

from sr.fetch_osm import load_layer
from sr.geo import LocalFrame
from sr.geom import cumulative_lengths, curvature, resample, rights, tangents
from sr.routes import load_route

DRIVABLE = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
            "service", "living_street", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
            "runway", "taxiway"}
DEFAULT_LANES = {"motorway": 3, "trunk": 2, "primary": 2, "secondary": 2, "tertiary": 2, "unclassified": 2,
                 "residential": 2, "service": 1, "living_street": 1}
LANE_W = 3.6
STEP = 2.0


@dataclass
class RoadWay:
    osm_id: int
    highway: str
    name: str
    nodes: list
    xy: np.ndarray  # (n, 2) local x, z
    lanes: int
    oneway: bool
    bridge: bool
    tunnel: bool
    layer: int
    refs: tuple = ()
    reverse_oneway: bool = False
    width_m: float = 0.0


@dataclass
class RouteResult:
    route: dict
    frame: LocalFrame
    P: np.ndarray            # (N,3) local, y = 0 until terrain assigns heights
    S: np.ndarray
    T: np.ndarray
    R: np.ndarray
    half_width: np.ndarray
    highway: list            # per point
    bridge: np.ndarray       # bool per point
    tunnel: np.ndarray
    lanes: np.ndarray
    closed: bool
    ways: list = field(default_factory=list)   # all drivable RoadWay in the corridor
    snapped: list = field(default_factory=list)  # snapped waypoint xz
    # One-way in the map data means a divided road's single carriageway, which is what decides
    # whether the centre of the racing surface is a double yellow or nothing at all.
    oneway: np.ndarray = None
    layer: np.ndarray = None
    # Metres of level roadbed beyond the flat shoulder on each side, per point. A divided road's
    # other carriageway runs at the racing road's own level; without this the terrain blend starts
    # sloping under it and buries the opposite lanes.
    flat_left: np.ndarray = None
    flat_right: np.ndarray = None
    # Non-racing streets beyond the timing lines still own their roadbed and clearance.
    end_roads: dict = field(default_factory=dict)

    def __post_init__(self):
        if self.oneway is None:
            self.oneway = np.zeros(len(self.P), dtype=bool)
        if self.layer is None:
            self.layer = np.zeros(len(self.P), dtype=int)
        if self.flat_left is None:
            self.flat_left = np.zeros(len(self.P))
        if self.flat_right is None:
            self.flat_right = np.zeros(len(self.P))

    @property
    def length(self):
        if not self.closed:
            return float(self.S[-1])
        return float(self.S[-1] + np.linalg.norm(self.P[0] - self.P[-1]))


def reparameterize(res):
    """Make the elevated centreline's three-dimensional arc the route's only distance scale.

    Routing and terrain profiling deliberately start on the horizontal line. Once elevation has
    been assigned, every exported consumer -- gates, tile ranges, slimes, wind and the runtime --
    must use the same cumulative distances instead of carrying that provisional scale forward.
    """
    cumulative = cumulative_lengths(res.P, res.closed)
    res.S = cumulative[:-1] if res.closed else cumulative
    return res


def _int(v, default):
    try:
        return int(str(v).split(";")[0])
    except (TypeError, ValueError):
        return default


def _float(v, default=0.0):
    try:
        return float(str(v).lower().replace("metres", "").replace("meters", "").replace("m", "").split(";")[0].strip())
    except (TypeError, ValueError):
        return default


def load_ways(route_id, frame, layer="roads"):
    ways = []
    for e in load_layer(route_id, layer)["elements"]:
        if e.get("type") != "way":
            continue
        t = e.get("tags", {})
        hw = t.get("highway") or t.get("aeroway")
        if hw not in DRIVABLE or t.get("area") == "yes":
            continue
        geom = e.get("geometry", [])
        if len(geom) < 2:
            continue
        x, z = frame.to_local([g["lat"] for g in geom], [g["lon"] for g in geom])
        base = hw.replace("_link", "")
        ways.append(RoadWay(e["id"], hw, t.get("name", ""), e.get("nodes", list(range(len(geom)))),
                            np.stack([x, z], axis=1), _int(t.get("lanes"), DEFAULT_LANES.get(base, 2)),
                            t.get("oneway") in ("yes", "1", "-1"), t.get("bridge") not in (None, "no"),
                            t.get("tunnel") not in (None, "no"), _int(t.get("layer"), 0), tuple(t.get("ref", "").split(";")),
                            t.get("oneway") == "-1", _float(t.get("width")) if t.get("aeroway") else 0.0))
    return ways


def build_graph(ways, respect_oneway=False):
    """Undirected graph of OSM nodes; the game closes roads, so oneway is ignored."""
    G = nx.DiGraph() if respect_oneway else nx.Graph()
    for w in ways:
        for i in range(len(w.nodes) - 1):
            a, b = w.nodes[i], w.nodes[i + 1]
            if respect_oneway and w.reverse_oneway:
                a, b = b, a
            d = float(np.linalg.norm(w.xy[i + 1] - w.xy[i]))
            if d == 0:
                continue
            G.add_node(w.nodes[i], xy=w.xy[i]); G.add_node(w.nodes[i + 1], xy=w.xy[i + 1])
            # prefer the shortest; motorway_links and service roads get a small penalty so the router
            # stays on the named road unless a waypoint pulls it off
            penalty = 1.0 + (0.3 if w.highway == "service" else 0.0)
            if not G.has_edge(a, b) or G[a][b]["w"] > d * penalty:
                G.add_edge(a, b, w=d * penalty, length=d, way=w, i=i)
            if respect_oneway and not w.oneway and (not G.has_edge(b, a) or G[b][a]["w"] > d * penalty):
                G.add_edge(b, a, w=d * penalty, length=d, way=w, i=i)
    return G


def snap(G, xz, exclude_classes=("service",)):
    """Nearest graph node per waypoint, restricted to the largest connected component and to
    nodes on roads outside exclude_classes, so a waypoint never lands on a parking aisle or a
    disconnected stub. Falls back to any node in the giant component if nothing else qualifies."""
    giant = max(nx.weakly_connected_components(G) if G.is_directed() else nx.connected_components(G), key=len)
    keep = set()
    for u, v, e in G.edges(data=True):
        if e["way"].highway not in exclude_classes:
            keep.add(u); keep.add(v)
    ids = [n for n in G.nodes if n in giant and (n in keep or not keep)]
    pts = np.array([G.nodes[n]["xy"] for n in ids])
    tree = cKDTree(pts)
    return [ids[int(i)] for i in tree.query(np.asarray(xz))[1]]


OFF_ROAD_PENALTY = 5.0


MAX_SPUR = 250.0       # metres: longer than this, coming back to a junction is a circuit, not a spur


def strip_backtracks(nodes, G=None, max_spur=MAX_SPUR):
    """Remove out-and-back excursions from a node path.

    Consecutive legs are routed independently, so a leg can leave a junction the way the previous one
    arrived at it. The result is a spur the centreline walks up and back down, which after smoothing
    is a spike no car can follow: measured on the first Golden Gate build, one such spur turned the
    road through 177 degrees inside two meters.

    Only *short* excursions count. Revisiting a junction is not by itself a mistake -- it is what a
    lap is -- and without a length limit the first node the closing leg shares with the opening one
    deletes the entire circuit. The Mountain View campus loop came out of this twenty metres long.
    Pass `G` to measure the excursion; without it every revisit is treated as a spur, which is the
    old behaviour and right for a point-to-point.
    """
    seen = {}
    out = []
    run = [0.0]                    # cumulative metres along `out`, so an excursion can be measured
    for n in nodes:
        if n in seen:
            back = seen[n]
            if G is not None and run[-1] - run[back] > max_spur:
                seen[n] = len(out)     # a lap, not a spur: keep going and remember the later visit
                out.append(n)
                run.append(run[-1] + _edge_len(G, out[-2], n))
                continue
            del out[back + 1:]
            del run[back + 1:]
            for m in list(seen):
                if seen[m] > back:
                    del seen[m]
        else:
            seen[n] = len(out)
            if out:
                run.append(run[-1] + _edge_len(G, out[-1], n))
            out.append(n)
    return out


def _edge_len(G, u, v):
    if G is None or not G.has_edge(u, v):
        return 0.0
    return float(G[u][v].get("w", 0.0))


def trace(G, node_ids, roads=None, closed=False):
    """Shortest path through consecutive snapped waypoints. Returns (xz polyline, per-vertex way).

    roads: optional per-waypoint road name (None for coordinates). When two consecutive waypoints sit
    on the same named road, edges off that road cost OFF_ROAD_PENALTY times more for that leg: the
    router stays on the road, can still cross a short unnamed gap, and never doubles back through
    side streets.

    closed: the last waypoint is the first one again. Coming back to where you started is the point
    of a circuit, not an out-and-back to be stripped -- left to the backtrack pass, a lap reads as
    one long excursion from the start line and collapses to a single vertex."""
    path = []
    for k, (a, b) in enumerate(zip(node_ids[:-1], node_ids[1:])):
        name = roads[k] if roads and roads[k] and roads[k] == roads[k + 1] else None
        if name and name.startswith("ref:"):
            ref = name[4:]
            road_graph = nx.subgraph_view(G, filter_edge=lambda u, v: ref in G[u][v]["way"].refs)
            leg = nx.shortest_path(road_graph, a, b, weight="w")
            path.extend(leg if not path else leg[1:])
            continue
        if name:
            def weight(u, v, e, _n=name):
                return e["w"] if e["way"].name == _n else e["w"] * OFF_ROAD_PENALTY
        else:
            weight = "w"
        leg = nx.shortest_path(G, a, b, weight=weight)
        path.extend(leg if not path else leg[1:])
    # The closing node is the start node; strip the excursions out of the open path and let the
    # resampler join the ends, which it does for a closed route anyway.
    path = strip_backtracks(path[:-1] if closed and len(path) > 1 and path[0] == path[-1] else path, G)
    xz, meta = [], []
    for u, v in zip(path[:-1], path[1:]):
        e = G[u][v]
        xz.append(G.nodes[u]["xy"]); meta.append(e["way"])
    xz.append(G.nodes[path[-1]]["xy"]); meta.append(meta[-1] if meta else None)
    return np.array(xz), meta


RACE_MIN_HALF = 6.0    # a twelve metre road: the narrowest a car doing 250 km/h can be driven on
RACE_MAX_HALF = 14.0
RACE_WIDEN = 1.25      # shoulders, kerbs and gutters, none of which we model as their own surface


def half_width_for(way, default, shared_deck=False):
    """How wide the race surface is here.

    This is a design number, not a survey, but it is anchored to one: a divided road is driven on
    one carriageway only. Where the map has two one-way ways with a median between them, the race
    surface is one of them and the other side of the barrier is not part of the road -- that is how
    a real divided road works, and the game draws it that way even where the real width differs.
    An undivided road is drivable in both directions, so it gets its whole width. `shared_deck` is
    the exception the Golden Gate needs: its two carriageways are one deck with a barrier that gets
    moved across it every day, not a median, so there the whole width is one road. Routes ask for it
    explicitly rather than the pipeline guessing, because from the map data a movable barrier and a
    concrete one look exactly alike.

    On top of that, every road gets a floor and a widening for the shoulder we do not model: a real
    two-lane street is about nine metres across, and at the speeds this game runs that is a corridor
    rather than a road."""
    if way is None:
        return default
    if way.width_m > 0:
        return float(np.clip(way.width_m / 2.0, RACE_MIN_HALF, RACE_MAX_HALF))
    base = way.highway.replace("_link", "")
    lanes = way.lanes
    if shared_deck and way.oneway and way.bridge:
        lanes *= 2
    hw = lanes * LANE_W / 2.0 * RACE_WIDEN
    if way.oneway and base not in ("motorway", "trunk"):
        hw = max(hw, LANE_W)  # one-way surface streets still get room to race
    return float(np.clip(hw, RACE_MIN_HALF, RACE_MAX_HALF))


MAX_TURN = np.radians(18.0)   # per 2 m sample: about a 6 m corner radius


def round_corners(P, max_turn=MAX_TURN, passes=180, relax=0.35):
    """Ease any corner sharper than max_turn by nudging the offending point toward its neighbours.

    A street junction is a right angle in the map data, and a centreline that turns ninety degrees at
    a single vertex is not drivable by anything. Relaxing only the points that break the limit rounds
    those corners while leaving the rest of the line exactly where the road is."""
    P = np.array(P, dtype=np.float64, copy=True)
    for _ in range(passes):
        d = np.diff(P[:, [0, 2]], axis=0)
        n = np.linalg.norm(d, axis=1, keepdims=True)
        n[n == 0] = 1.0
        u = d / n
        ang = np.arccos(np.clip(np.einsum("ij,ij->i", u[:-1], u[1:]), -1.0, 1.0))
        bad = np.where(ang > max_turn)[0] + 1
        if not len(bad):
            break
        mid = (P[bad - 1] + P[bad + 1]) / 2.0
        P[bad] += (mid - P[bad]) * relax
    return P


def smooth_polyline(xz, sigma_m=3.0):
    """Resample at 1 m, gaussian-smooth, round any remaining sharp corner, keeping endpoints."""
    P = np.column_stack([xz[:, 0], np.zeros(len(xz)), xz[:, 1]])
    P1, _ = resample(P, 1.0)
    sm = gaussian_filter1d(P1, sigma=sigma_m, axis=0, mode="nearest")
    sm[0], sm[-1] = P1[0], P1[-1]
    sm = round_corners(sm, max_turn=MAX_TURN / 3, passes=400)   # tighter than the target: the
    # relaxation runs at 1 m spacing and the line is resampled to 2 m afterwards, which sharpens it again
    sm[0], sm[-1] = P1[0], P1[-1]
    return sm


def waypoint_roads(route):
    """Road each waypoint belongs to; a junction belongs to its first-named road."""
    out = []
    for spec in route["waypoints"]:
        if isinstance(spec, dict):
            out.append("ref:" + spec["ref"] if "ref" in spec else
                       spec.get("road") or spec.get("junction", [None])[0])
        else:
            out.append(None)
    return out


def resolve_waypoints(route, ways, frame):
    """Waypoints are either [lat, lon] or {"road": name, "pick": selector}. Selectors: westmost, eastmost,
    northmost, southmost, highest (needs DEM cache), nearest:<lat>,<lon>. Picking from the road's own
    geometry keeps a waypoint on the intended road instead of wherever a guessed coordinate lands."""
    out = []
    for spec in route["waypoints"]:
        if isinstance(spec, (list, tuple)):
            x, z = frame.to_local(spec[0], spec[1]); out.append((float(x), float(z))); continue
        if "junction" in spec:
            # node shared by ways of the two names; with several, the one nearest the previous waypoint
            a_name, b_name = spec["junction"]
            a_nodes = {n for w in ways if w.name == a_name for n in w.nodes}
            b_xy = {n: w.xy[i] for w in ways if w.name == b_name for i, n in enumerate(w.nodes)}
            shared = [n for n in b_xy if n in a_nodes]
            if not shared:
                raise ValueError(f"no junction of {a_name} and {b_name} in corridor")
            ref = np.array(out[-1]) if out else np.zeros(2)
            n = min(shared, key=lambda n: float(np.hypot(*(b_xy[n] - ref))))
            out.append((float(b_xy[n][0]), float(b_xy[n][1]))); continue
        cand = [w for w in ways if spec["ref"] in w.refs] if "ref" in spec else [w for w in ways if w.name == spec["road"]]
        if not cand:
            raise ValueError(f"waypoint road not in corridor: {spec.get('road', spec.get('ref'))}")
        pts = np.vstack([w.xy for w in cand])
        pick = spec["pick"]
        if pick == "westmost": i = int(np.argmin(pts[:, 0]))
        elif pick == "eastmost": i = int(np.argmax(pts[:, 0]))
        elif pick == "northmost": i = int(np.argmin(pts[:, 1]))
        elif pick == "southmost": i = int(np.argmax(pts[:, 1]))
        elif pick == "highest":
            from sr.dem import DemSampler
            lat, lon = frame.to_latlon(pts[:, 0], pts[:, 1])
            i = int(np.argmax(DemSampler().heights(lat, lon)))
        elif pick.startswith("nearest:"):
            lat, lon = (float(v) for v in pick.split(":")[1].split(","))
            x, z = frame.to_local(lat, lon)
            i = int(np.argmin(np.hypot(pts[:, 0] - x, pts[:, 1] - z)))
        else:
            raise ValueError(f"unknown pick {pick}")
        out.append((float(pts[i, 0]), float(pts[i, 1])))
    return out


def _oneway(ways_pt, shared_deck, bridge):
    """One-way per point, with the shared-deck exception applied.

    A one-way way in the map data is one carriageway of a divided road, and the racing surface takes
    only that carriageway. Where a route declares its bridge deck shared -- the Golden Gate, whose
    barrier is moved across the deck every morning -- the deck is one road carrying both directions,
    so it is not one-way for the purpose of what gets painted down the middle of it either."""
    one = np.array([bool(w and w.oneway) for w in ways_pt])
    if shared_deck:
        one = one & ~bridge
    return one


def _build_roof_loop(route, frame, ways):
    """A closed racing line inset from an OSM courtyard building's outer roof edge.

    It still becomes the same RouteResult, ribbon, checkpoints and runtime track as a road route.
    Only the source of the centreline differs: a building outline instead of a highway graph.
    """
    from shapely.geometry import LineString, Polygon
    from sr.buildings import footprint_by_osm_id

    spec = route["roofLoop"]
    poly, _tags = footprint_by_osm_id(route["id"], frame, spec["osmRelation"])
    if not poly.interiors:
        raise ValueError(f"{route['id']}: roof loop building has no courtyard")
    inset = float(spec["outerInsetM"])
    centre = Polygon(poly.exterior).buffer(-inset, join_style="round")
    if not isinstance(centre, Polygon) or centre.is_empty:
        raise ValueError(f"{route['id']}: roof inset {inset:g} m erased the building")
    xz = np.asarray(centre.exterior.coords[:-1], dtype=np.float64)
    # Start on the east side, not at Shapely's arbitrary first buffer vertex. A stable start keeps
    # screenshots, checkpoints and best times stable when unrelated geometry changes upstream.
    start = int(np.argmax(xz[:, 0]))
    xz = np.roll(xz, -start, axis=0)
    raw = np.c_[xz[:, 0], np.zeros(len(xz)), xz[:, 1]]
    P, S = resample(raw, STEP, closed=True)
    T = tangents(P, closed=True)
    R = rights(T)
    half = np.full(len(P), float(route["halfWidthDefault"]))
    envelope = LineString(np.vstack([P[:, [0, 2]], P[:1, [0, 2]]])).buffer(float(half[0]) + 0.5)
    if not poly.buffer(0.05).contains(envelope):
        raise ValueError(f"{route['id']}: roof road does not fit between outer wall and courtyard")
    n = len(P)
    bridge = np.ones(n, dtype=bool)  # keep the natural ground below an elevated road
    return RouteResult(route, frame, P, S, T, R, half, ["trunk"] * n, bridge,
                       np.zeros(n, dtype=bool), np.full(n, 2), True, ways,
                       [P[0, [0, 2]].copy()], np.ones(n, dtype=bool), np.ones(n, dtype=int))


def _densify_airfield_section(frame, section, step=1.0):
    """Turn one surveyed airfield/road section into evenly spaced local points."""
    lat = [point[0] for point in section["points"]]
    lon = [point[1] for point in section["points"]]
    x, z = frame.to_local(lat, lon)
    xz = np.stack([x, z], axis=1)
    distance = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(xz, axis=0), axis=1))]
    if distance[-1] <= 0:
        raise ValueError("an airfield circuit section needs two distinct points")
    samples = np.arange(0.0, distance[-1], step)
    if samples[-1] < distance[-1] - 1e-6:
        samples = np.r_[samples, distance[-1]]
    points = np.stack([np.interp(samples, distance, xz[:, axis]) for axis in (0, 1)], axis=1)
    return points


def _build_airfield_circuit(route, frame, ways):
    """A closed course surveyed from OSM runway, taxiway and base-road centre lines.

    The ordinary router cannot join an aeroway to a base road when their OSM nodes stop a few
    metres apart. The route file therefore records the exact public-map centre lines and the
    intended closure connectors. They still become the same RouteResult used by every race.
    """
    sections = route["airfieldCircuit"]["sections"]
    dense, surfaces, widths = [], [], []
    for section in sections:
        points = _densify_airfield_section(frame, section)
        if dense and np.linalg.norm(dense[-1][-1] - points[0]) < 0.2:
            points = points[1:]
        dense.append(points)
        surfaces.extend([section["surface"]] * len(points))
        widths.extend([float(section["widthM"]) / 2.0] * len(points))
    xz = np.vstack(dense)
    # The published control lines contain right-angle junctions. Round them at one metre spacing,
    # including the closing seam, without moving the route far enough to cut across Hangar One.
    raw = np.c_[xz[:, 0], np.zeros(len(xz)), xz[:, 1]]
    one_m, _ = resample(raw, 1.0, closed=True)
    smooth = gaussian_filter1d(one_m, sigma=3.0, axis=0, mode="wrap")
    P, S = resample(smooth, STEP, closed=True)
    nearest = cKDTree(xz).query(P[:, [0, 2]])[1]
    surfaces = np.asarray(surfaces, dtype=object)[nearest].tolist()
    half = gaussian_filter1d(np.asarray(widths, dtype=float)[nearest], sigma=8, mode="wrap")
    measured_max = max(float(section["widthM"]) / 2.0 for section in sections)
    half = np.clip(half, RACE_MIN_HALF, measured_max)
    curve = np.abs(curvature(P, S, True))
    half = np.minimum(half, np.maximum(0.7 / np.maximum(curve, 1e-6), 3.0))
    T = tangents(P, closed=True)
    R = rights(T)
    n = len(P)
    lanes = np.array([8 if surface == "runway" else 2 for surface in surfaces])
    return RouteResult(route, frame, P, S, T, R, half, surfaces,
                       np.zeros(n, dtype=bool), np.zeros(n, dtype=bool), lanes, True, ways,
                       [P[0, [0, 2]].copy()], np.zeros(n, dtype=bool), np.zeros(n, dtype=int))


def build_route(route_id, closed=None):
    route = load_route(route_id)
    frame = LocalFrame(route["origin"]["lat"], route["origin"]["lon"])
    ways = load_ways(route_id, frame)
    if route.get("roofLoop") is not None:
        if closed is False:
            raise ValueError(f"{route_id}: a roof loop cannot be built open")
        return _build_roof_loop(route, frame, ways)
    if route.get("airfieldCircuit") is not None:
        if closed is False:
            raise ValueError(f"{route_id}: an airfield circuit cannot be built open")
        return _build_airfield_circuit(route, frame, ways)
    G = build_graph(ways, respect_oneway=route.get("respectOneway", False))
    wxz = resolve_waypoints(route, ways, frame)
    snapped_ids = snap(G, np.array(wxz), tuple(route.get("snapExclude", ["service"])))
    if "maxSnapM" in route:
        distances = np.linalg.norm(np.asarray([G.nodes[n]["xy"] for n in snapped_ids]) - np.asarray(wxz), axis=1)
        if np.any(distances > route["maxSnapM"]):
            raise ValueError(f"{route_id}: waypoint snap moved {distances.max():.1f} m, limit {route['maxSnapM']} m")
    roads = waypoint_roads(route)
    closed = route["mode"] == "loop" if closed is None else closed
    if closed and snapped_ids[0] != snapped_ids[-1]:
        snapped_ids.append(snapped_ids[0]); roads.append(roads[0])
    xz, meta = trace(G, snapped_ids, roads, closed=closed)
    # per raw vertex attributes, then carried to resampled points by nearest raw vertex
    raw = smooth_polyline(xz)
    P, S = resample(raw, STEP, closed=closed)
    tree = cKDTree(xz)
    nearest = tree.query(P[:, [0, 2]])[1]
    ways_pt = [meta[min(i, len(meta) - 1)] for i in nearest]
    default_hw = float(route.get("halfWidthDefault", RACE_MIN_HALF))
    shared = bool(route.get("sharedDeckOnBridges", False))
    hw = np.array([half_width_for(w, default_hw, shared) for w in ways_pt])
    hw = gaussian_filter1d(hw, sigma=8, mode="nearest")  # widths change over ~30 m, not at a vertex
    hw = np.clip(hw, RACE_MIN_HALF, RACE_MAX_HALF)  # smoothing reintroduces error at the clamped ends
    # A ribbon wider than the corner it goes round folds over itself on the inside, and the crease
    # behaves like a wall in the road. Lombard's switchbacks turn inside eight metres, so the twelve
    # metre floor has to give way there: a narrow road is still a road, a folded one is not.
    curve = np.abs(curvature(P, S, closed))
    hw = np.minimum(hw, np.maximum(0.7 / np.maximum(curve, 1e-6), 3.0))
    T = tangents(P, closed); R = rights(T)
    return RouteResult(route, frame, P, S, T, R, hw, [w.highway if w else "unknown" for w in ways_pt],
                       np.array([bool(w and w.bridge) for w in ways_pt]), np.array([bool(w and w.tunnel) for w in ways_pt]),
                       np.array([w.lanes if w else 2 for w in ways_pt]), closed, ways,
                       [G.nodes[n]["xy"] for n in snapped_ids],
                       _oneway(ways_pt, shared, np.array([bool(w and w.bridge) for w in ways_pt])),
                       np.array([w.layer if w else 0 for w in ways_pt]))


def must_pass(res, route):
    """How close the racing line comes to each place a route promises to show, in metres.

    A campus route exists so that someone who works there recognises their own building. That is not
    something you can check by reading the waypoints: Shoreline listed Amphitheatre Parkway and
    still passed the main buildings 541 m away, because the waypoint picked the far end of the road.
    So each route names the things it claims to show, and the build measures.

    The names are notes for whoever edits the route. They never reach the game, and they are not
    what the track is called."""
    out = []
    xz = res.P[:, [0, 2]]
    for item in route.get("mustPass", ()):
        x, z = res.frame.to_local(np.array([item["lat"]]), np.array([item["lon"]]))
        dist = float(np.hypot(xz[:, 0] - x[0], xz[:, 1] - z[0]).min())
        limit = float(item.get("maxDistM", 120.0))
        out.append({"name": item.get("name", "?"), "dist": dist, "limit": limit, "ok": dist <= limit})
    return out


def spans(mask, S):
    """Contiguous True runs of a per-point mask as [s0, s1] intervals."""
    out, start = [], None
    for i, m in enumerate(mask):
        if m and start is None:
            start = i
        if not m and start is not None:
            out.append([float(S[start]), float(S[i - 1])]); start = None
    if start is not None:
        out.append([float(S[start]), float(S[-1])])
    return out


def checkpoints_for(res, spacing=600.0, mode="p2p"):
    """Gates every `spacing` m plus start and finish (or two sector gates for loops)."""
    n = len(res.P)
    if mode == "loop":
        idx = [0, n // 3, 2 * n // 3]
    else:
        idx = list(range(0, n - 1, int(spacing / STEP))) + [n - 1]
        if len(idx) >= 2 and (n - 1 - idx[-2]) * STEP < spacing * 0.4:
            idx.pop(-2)
    cps = []
    for i in idx:
        cps.append({"s": float(res.S[i]), "pos": [float(v) for v in res.P[i]], "dir": [float(v) for v in res.T[i]],
                    "halfWidth": float(res.half_width[i]) + 1.0})
    return cps


def overlap_length(res, min_ds=100.0, radius=8.0):
    """Meters of route that run within `radius` of another part of the route at least `min_ds` further along.
    A large value means an out-and-back or a doubled segment: a routing mistake, not a feature."""
    tree = cKDTree(res.P[:, [0, 2]])
    pairs = tree.query_pairs(radius)
    hit = np.zeros(len(res.P), dtype=bool)
    for i, j in pairs:
        # only opposite directions count: a parallel on-ramp beside the freeway is fine, a U-turn is not
        if abs(res.S[i] - res.S[j]) >= min_ds and float(np.dot(res.T[i], res.T[j])) < 0:
            hit[i] = hit[j] = True
    return float(hit.sum() * STEP)


def sharpest_turn(res):
    """Largest direction change between consecutive samples, in radians.

    A racing line is only as good as its worst corner: one spike is enough to make a track
    undriveable, and an average says nothing about whether there is one."""
    d = np.diff(res.P[:, [0, 2]], axis=0)
    n = np.linalg.norm(d, axis=1, keepdims=True)
    n[n == 0] = 1.0
    u = d / n
    dots = np.clip(np.einsum("ij,ij->i", u[:-1], u[1:]), -1.0, 1.0)
    return float(np.arccos(dots).max()) if len(dots) else 0.0
