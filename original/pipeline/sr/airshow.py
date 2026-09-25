"""Place authored aircraft parking bays outside the actual airfield guardrails."""
import math

import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point
from shapely.ops import nearest_points, unary_union

from sr.buildings import box_polygon
from sr.landmark_data import entries
from sr.roads import rail_paths
from sr.terrain import ground_height


def placements(res, dem, obstacles=()):
    rows = res.route.get("aircraftDisplays", [])
    if not rows:
        return [], []
    metadata = entries()
    rails = unary_union([LineString(points) for points in rail_paths(res)])
    tree = cKDTree(res.P[:, [0, 2]])
    blocked = [box_polygon(b[0], b[2], b[3], b[5], b[6]) for b in obstacles]
    for vehicle in res.route.get("airportVehicles", []):
        x, z = res.frame.to_local(vehicle["lat"], vehicle["lon"])
        blocked.append(Point(float(x), float(z)).buffer(4))
    models, bays = [], []
    for row in rows:
        section = res.route["airfieldCircuit"]["sections"][row["section"]]
        lat, lon = section["points"][0]
        x, z = res.frame.to_local(lat, lon)
        start = float(res.S[tree.query([x, z])[1]])
        half_w, half_l = row["bayWidthM"] / 2, row["bayLengthM"] / 2
        for number, station in enumerate(np.linspace(*row["rangeM"], row["count"])):
            # Small along-row shifts preserve spacing while clearing existing service vehicles.
            accepted = None
            for shift in (0, 5, -5, 10, -10, 15, -15):
                s = start + station + shift
                point = np.array([np.interp(s, res.S, res.P[:, axis]) for axis in (0, 2)])
                outward = np.array([np.interp(s, res.S, res.R[:, axis]) for axis in (0, 2)]) * row["side"]
                outward /= np.linalg.norm(outward)
                crossings = LineString([point, point + outward * 100]).intersection(rails)
                if crossings.is_empty:
                    continue
                edge = np.array(nearest_points(Point(point), crossings)[1].coords[0])
                centre = edge + outward * (row["clearanceM"] + half_l)
                yaw = math.atan2(float(outward[0]), float(outward[1]))
                bay = box_polygon(*centre, half_w, half_l, yaw)
                if bay.distance(rails) < row["clearanceM"] - 2:
                    continue
                if any(bay.intersects(other) for other in blocked):
                    continue
                accepted = centre, yaw, bay
                break
            if accepted is None:
                raise ValueError(f"{res.route['id']}: no clear parking bay in {row['name']} slot {number}")
            centre, yaw, bay = accepted
            name = row["models"][number % len(row["models"])]; entry = metadata[name]
            y = float(ground_height(res, res.P[:, 1], dem, [centre], tree=tree,
                                    water_level=res.route.get("waterLevelM", 0.0))[0])
            models.append({"id": name, "file": entry["file"], "pos": [float(centre[0]), y, float(centre[1])],
                           "yaw": yaw, "loadRadius": entry["loadRadius"], "collision": True})
            bays.append([float(centre[0]), y + 7, float(centre[1]), half_w, 7, half_l, yaw])
            blocked.append(bay)
    return models, bays
