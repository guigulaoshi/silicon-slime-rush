"""How big each registered landmark looks from the route, and the modelling tier that follows.

The floor on a landmark's detail is set by the view angle at the route's closest point, decided
before modelling and re-checked whenever a route changes (a top landmark once got modelled as
skyline because nobody measured this)."""
import json
import math
import sys

import numpy as np
from shapely.geometry import LineString, Polygon

from sr.geo import LocalFrame
from sr.landmark_data import entries
from sr.routes import load_route

FLOORS = {"far": 3000, "close": 15000, "touching": 60000}


def tier(distance, height):
    angle = math.degrees(math.atan2(height, max(distance, 1.0)))
    if distance <= 30 or angle >= 60:
        return "touching", angle
    if angle >= 15:
        return "close", angle
    return "far", angle


def measure(route_id, points=None):
    route = load_route(route_id)
    frame = LocalFrame(route["origin"]["lat"], route["origin"]["lon"])
    if points is None:
        from sr.route import build_route
        points = build_route(route_id).P[:, [0, 2]]
    line = LineString(points)
    out = []
    reg = entries()
    for ident in route.get("landmarks", []):
        e = reg.get(ident)
        if not e or not e.get("footprint"):
            continue
        x, z = frame.to_local(*np.asarray(e["footprint"]).T)
        poly = Polygon(np.c_[x, z]).buffer(0)
        d = float(poly.distance(line))
        t, angle = tier(d, float(e["heightM"]))
        out.append({"id": ident, "distanceM": round(d, 1), "heightM": e["heightM"], "viewAngle": round(angle, 1),
                    "tier": t, "floor": FLOORS[t]})
    return out


if __name__ == "__main__":
    for row in measure(sys.argv[1]):
        print(json.dumps(row, ensure_ascii=False))
