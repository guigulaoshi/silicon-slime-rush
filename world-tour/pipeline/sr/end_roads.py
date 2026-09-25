"""Real, non-racing streets continuing beyond an open course's timing lines."""
import numpy as np
from scipy.spatial import cKDTree

from sr.geom import cumulative_lengths, resample, rights, tangents
from sr.route import RouteResult, build_graph, load_ways, smooth_polyline
from sr.terrain import ground_height, limit_slope, smooth_profile

EXTENT = 220.0
SEAM_FLOOR_SLACK = 5.0   # metres the ground floor sits below the eased profile right at the seam


def continuations(res, road_y, dem, route_id):
    """Follow connected cached OSM roads outward, without changing the racing graph."""
    if res.closed:
        return {}
    # Wider backdrop data supplies streets outside the original racing-data bbox. Keeping it
    # separate matters: adding it to build_route would move waypoints selected as 'southmost'.
    ways = {w.osm_id: w for w in load_ways(route_id, res.frame, "backdrop")}
    ways.update({w.osm_id: w for w in res.ways})
    graph = build_graph(ways.values())
    nodes = list(graph.nodes)
    xy = np.array([graph.nodes[node]["xy"] for node in nodes])
    tree = cKDTree(xy)
    result = {}
    edges = [(u, v) for u, v in graph.edges]
    ea = np.array([graph.nodes[u]["xy"] for u, _ in edges])
    eb = np.array([graph.nodes[v]["xy"] for _, v in edges])
    for label, endpoint, sign in (("start", 0, -1), ("finish", -1, 1)):
        origin = res.P[endpoint, [0, 2]]
        heading = res.T[endpoint, [0, 2]] * sign
        heading /= np.linalg.norm(heading)
        # Measure to the nearest stretch of road, not the nearest junction: a start line in the middle
        # of a long straight is on the road even when both junctions are far away.
        ab = eb - ea
        t = np.clip(np.einsum("ij,ij->i", origin - ea, ab) / np.maximum(np.einsum("ij,ij->i", ab, ab), 1e-9), 0, 1)
        foot = ea + ab * t[:, None]
        gaps = np.linalg.norm(foot - origin, axis=1)
        k = int(np.argmin(gaps))
        distance = float(gaps[k])
        if distance > 6:
            raise ValueError(f"{route_id} {label}: endpoint is {distance:.1f} m from mapped road")
        u, v = edges[k]
        # Leave the stretch through whichever end faces outward; the part walked counts as travelled.
        towards_v = float(np.dot(eb[k] - ea[k], heading)) >= 0
        node = v if towards_v else u
        points, used, previous_way = [origin], {node, u, v}, graph[u][v]["way"]
        traversed = float(np.linalg.norm(graph.nodes[node]["xy"] - foot[k]))
        # A timing line on a bridge continues on the same deck: the mapped bridge ways carry on at the
        # deck's own height instead of easing down to the ground under them. Easing from the Harbour
        # Bridge's start sank the continuation 2.5 m below the deck within 15 m.
        on_deck = bool(res.bridge[endpoint]) and bool(getattr(previous_way, "bridge", False))
        deck_until = traversed if on_deck else 0.0
        if distance > .05:
            points.append(foot[k])
        points.append(graph.nodes[node]["xy"])
        while traversed < EXTENT:
            choices = []
            for other, edge in graph[node].items():
                if other in used:
                    continue
                delta = graph.nodes[other]["xy"] - graph.nodes[node]["xy"]
                length = float(np.linalg.norm(delta))
                direction = delta / length
                alignment = float(np.dot(direction, heading))
                if alignment < -.35:
                    continue
                way = edge["way"]
                continuity = .15 if previous_way and way.name and way.name == previous_way.name else 0.
                choices.append((alignment + continuity, other, direction, length, way))
            if not choices:
                if traversed >= 200.:
                    break
                # A real dead end is a route-authoring problem, never an invitation to invent road.
                raise ValueError(f"{route_id} {label}: mapped continuation ends after {traversed:.1f} m")
            _, node, heading, length, previous_way = max(choices, key=lambda choice: choice[0])
            on_deck = on_deck and bool(getattr(previous_way, "bridge", False))
            if on_deck:
                deck_until = min(EXTENT, traversed + length)
            used.add(node)
            point = graph.nodes[node]["xy"]
            if traversed + length > EXTENT:
                point = points[-1] + heading * (EXTENT - traversed)
            points.append(point)
            traversed += length
        P, S = resample(smooth_polyline(np.asarray(points)), 2.)
        # The authored course and cached street were smoothed separately. Meet the timing line
        # with its existing tangent before easing onto the mapped street, so their wide edges join.
        outward = res.T[endpoint, [0, 2]] * sign
        outward /= np.linalg.norm(outward)
        aligned = origin + S[:, None] * outward
        turn = np.clip((S - 4.) / 20., 0., 1.)
        turn = turn * turn * (3 - 2 * turn)
        P[:, [0, 2]] = aligned * (1 - turn[:, None]) + P[:, [0, 2]] * turn[:, None]
        y = ground_height(res, road_y, dem, P[:, [0, 2]])
        # Meet the existing deck exactly, then ease back to the actual terrain height. Carry the
        # measured approach grade through the join rather than creating a step at a bridge end.
        grade = float(res.T[endpoint, 1] * sign)
        join = float(road_y[endpoint]) + grade * S
        blend = np.clip((S - deck_until) / 45., 0., 1.)
        blend = blend * blend * (3 - 2 * blend)
        # The seam is exactly the racing height; the ground is only a floor that fades in with the
        # blend. Taking max(ground, seam) lifted one join a metre above the course and left a car's
        # rear wheels hanging off the step at full throttle.
        floor = y - (1 - blend) * SEAM_FLOOR_SLACK
        eased = np.maximum(join * (1 - blend) + y * blend, floor)
        eased[0] = float(road_y[endpoint])
        # The continuation is road too: smoothed and slope limited like the course, seam pinned.
        eased = limit_slope(S, smooth_profile(S, eased))
        eased = eased + (float(road_y[endpoint]) - eased[0]) * (1 - blend)
        P[:, 1] = limit_slope(S, eased)
        S = cumulative_lengths(P)
        T = tangents(P)
        n = len(P)
        # The visible continuation retains the closed-stage width, including room for finishers.
        paint = {k: v for k, v in (res.route or {}).items() if k in ("centreLine", "traffic")}
        result[label] = RouteResult(route=paint, frame=res.frame, P=P, S=S, T=T, R=rights(T),
            half_width=np.full(n, res.half_width[endpoint]), highway=[res.highway[endpoint]] * n,
            bridge=np.zeros(n, dtype=bool), tunnel=np.zeros(n, dtype=bool),
            lanes=np.full(n, res.lanes[endpoint]), closed=False,
            oneway=np.full(n, res.oneway[endpoint]), layer=np.full(n, res.layer[endpoint]))
    return result


def document(roads):
    """Both paths point outward, so reverse travel exchanges them without reversing their points."""
    return {name: {"points": road.P.tolist(), "s": road.S.tolist(),
                   "halfWidth": road.half_width.tolist(), "closed": False,
                   "length": road.length} for name, road in roads.items()}
