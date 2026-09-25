"""Small, self-authored props that make the Moffett racing line read as an active airfield."""
import numpy as np

from sr.mesh import box, merge


def _runway_lights(res, road_y):
    bulb = merge([
        box((0.0, 0.16, 0.0), (0.07, 0.16, 0.07), material="line_white"),
        box((0.0, 0.36, 0.0), (0.13, 0.05, 0.13), material="line_white"),
    ], "line_white")
    mask = np.asarray(res.highway) == "runway"
    indices = np.flatnonzero(mask)
    if not len(indices):
        return bulb, []
    picked = []
    last_s = -1e9
    for i in indices:
        if res.S[i] - last_s >= 30.0:
            picked.append(i)
            last_s = res.S[i]
    placements = []
    for i in picked:
        for side in (-1.0, 1.0):
            point = res.P[i] + res.R[i] * side * (res.half_width[i] + 1.0)
            placements.append((float(point[0]), float(road_y[i] + 0.06), float(point[2])))
    return bulb, placements


def _service_vehicle(kind):
    if kind == "tug":
        return merge([
            box((0.0, 0.35, 0.0), (1.05, 0.35, 1.65), material="line_yellow"),
            box((0.0, 0.82, 0.65), (0.82, 0.47, 0.72), material="line_yellow"),
        ], "line_yellow")
    return merge([
        box((0.0, 0.65, -0.55), (1.25, 0.65, 1.65), material="line_yellow"),
        box((0.0, 0.95, 1.25), (1.15, 0.95, 1.0), material="line_yellow"),
    ], "line_yellow")


def add_to_tiles(tiles, res, road_y, dem, route):
    """Add runway edge lights and parked airport vehicles declared by the route."""
    if route.get("airfieldCircuit") is None:
        return {"lights": 0, "vehicles": 0}
    light, placements = _runway_lights(res, road_y)
    for position in placements:
        tiles.add_instance("scenery_runway_light", position, 0.0, light, (0.13, 0.41, 0.13))

    vehicles = 0
    meshes = {kind: _service_vehicle(kind) for kind in ("tug", "truck")}
    for spec in route.get("airportVehicles", []):
        x, z = res.frame.to_local(spec["lat"], spec["lon"])
        y = float(dem.heights(np.array([spec["lat"]]), np.array([spec["lon"]]))[0])
        mesh = meshes[spec["kind"]]
        lo, hi = mesh.bounds()
        half = tuple(np.maximum(np.abs(lo), np.abs(hi)))
        tiles.add_instance(f"scenery_airport_{spec['kind']}", (x, y, z), np.radians(spec["yawDeg"]),
                           mesh, half)
        vehicles += 1
    return {"lights": len(placements), "vehicles": vehicles}
