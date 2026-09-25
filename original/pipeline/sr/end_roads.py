"""Real, non-racing streets continuing beyond an open course's timing lines."""
import numpy as np
from scipy.spatial import cKDTree

from sr.geom import cumulative_lengths, resample, rights, tangents
from sr.route import RouteResult, build_graph, load_ways, smooth_polyline
from sr.terrain import ground_height

EXTENT = 220.0


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
    for label, endpoint, sign in (("start", 0, -1), ("finish", -1, 1)):
        origin = res.P[endpoint, [0, 2]]
        distance, nearest = tree.query(origin)
        if distance > 6:
            raise ValueError(f"{route_id} {label}: endpoint is {distance:.1f} m from mapped road")
        node = nodes[int(nearest)]
        heading = res.T[endpoint, [0, 2]] * sign
        heading /= np.linalg.norm(heading)
        points, used, traversed, previous_way = [origin], {node}, 0., None
        if distance > .05:
            points.append(xy[int(nearest)])
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
        blend = np.clip(S / 45., 0., 1.)
        blend = blend * blend * (3 - 2 * blend)
        P[:, 1] = np.maximum(y, join * (1 - blend) + y * blend)
        S = cumulative_lengths(P)
        T = tangents(P)
        n = len(P)
        # The visible continuation retains the closed-stage width, including room for finishers.
        result[label] = RouteResult(route={}, frame=res.frame, P=P, S=S, T=T, R=rights(T),
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
