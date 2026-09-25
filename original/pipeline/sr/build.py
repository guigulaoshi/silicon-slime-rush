"""Assemble one route into the files the game loads: tiles.bin, track.json and a preview image."""
import os

import numpy as np
from shapely.ops import unary_union

from sr.backdrop import build as build_backdrop
from sr.airfield import add_to_tiles as add_airfield_to_tiles
from sr.airshow import placements as aircraft_placements
from sr.billboards import (add_to_tiles as add_billboards, placements as billboard_placements,
                           sight_clearance as billboard_sight_clearance,
                           validate_placements as validate_billboards)
from sr.bridge import suspension
from sr.buildings import (build_buildings, estimate_height, extrude,
                          footprint_by_osm_id, load_landmark_footprints, oriented_box,
                          parse_height, road_footprint, roof_fascia)
from sr.clearance import buildings_over_the_road, surface as _surface
from sr.dem import DemSampler
from sr.end_roads import continuations as end_road_continuations, document as end_road_document
from sr.fetch_dem import BACKDROP_ZOOM
from sr.export import ROOT, export_track, write_backdrop
from sr import landcover
from sr.mesh import BUILDING_UV_METRES, merge, yaw_for_z_axis
from sr.markings import markings
from sr.preview import render_preview
from sr.roads import (barrier_lines, barrier_mesh, guardrails, junction_layout, race_ribbons,
                      side_roads, sidewalks, BARRIER_HALF, parallel_flat_extents)
from sr.route import LANE_W, build_route, checkpoints_for, must_pass
from sr.routes import load_route
from sr.slimes import (add_scenery_to_tiles, add_to_tiles as add_slimes,
                       placements as slime_placements, scenery_placements)
from sr.streetmap import street_map, write as write_map
from sr.terrain import build_terrain, corridor_polygon, road_profile
from sr.vegetation import (add_flowers_to_tiles, add_to_tiles as add_trees,
                           lombard_flowers, positions as tree_positions)
from sr.tiles import TileSet

WATER_KILL_Y = -1.0                        # relative to the water surface: below this the car is in the sea
ATTRIBUTION = ["Map data © OpenStreetMap contributors (ODbL)",
               "Elevation: Mapzen Terrain Tiles via AWS Open Data"]


def tree_obstacles(res, route_id, corridor, boxes):
    """Streets and building footprints a planted yard or campus tree must keep off."""
    from shapely.geometry import LineString
    from shapely.ops import unary_union
    from sr.buildings import box_polygon
    from sr.roads import side_half_width
    from sr.route import load_ways
    from sr.vegetation import BUILDING_CLEAR, STREET_CLEAR
    shapes = [box_polygon(b[0], b[2], b[3], b[5], b[6]).buffer(BUILDING_CLEAR) for b in boxes]
    for way in load_ways(route_id, res.frame):
        if len(way.xy) >= 2:
            shapes.append(LineString(way.xy).buffer(side_half_width(way) + STREET_CLEAR, cap_style="flat"))
    return unary_union(shapes).intersection(corridor) if shapes else None


def road_markings(res, road_y, route_id):
    """Run the shared junction analysis and feed its route positions into the paint generator."""
    layout = junction_layout(res, route_id)
    # An airfield circuit has its own runway/taxiway paint. Nearby mapped service roads still need
    # closure barriers, but must not turn into street crossings on the runway.
    painted_junctions = () if res.route.get("airfieldCircuit") is not None else layout.junctions
    return markings(res, road_y, LANE_W, painted_junctions), layout


SUPPORT_ROOF_DROP_M = 0.5


def _panel_uvs(mesh):
    """Lay the panel texture across the field's upward faces in world metres.

    extrude() gives every roof one constant UV, which is right for a plain roof and turned the
    photovoltaic texture into a single flat colour. Walls keep their own arc-length UVs.
    """
    if mesh is None:
        return None
    up = mesh.normals[:, 1] > 0.9
    mesh.uvs[up, 0] = mesh.positions[up, 0] / BUILDING_UV_METRES
    mesh.uvs[up, 1] = mesh.positions[up, 2] / BUILDING_UV_METRES
    return mesh


def roof_support(route, res, dem):
    """The courtyard building under a roof-sourced route, plus its one level roof elevation."""
    spec = route.get("roofLoop")
    if spec is None:
        return None, None
    poly, tags = footprint_by_osm_id(route["id"], res.frame, spec["osmRelation"])
    ring = np.asarray(poly.exterior.coords[:-1])
    lat, lon = res.frame.to_latlon(ring[:, 0], ring[:, 1])
    base = float(dem.heights(lat, lon).min())
    height = parse_height(tags) or estimate_height(tags, poly.area)
    top = base + height
    # Apple Park is not an anonymous office block. Its continuous dark curved glass is one of the
    # three bands that makes the ring recognisable, so it uses the observed landmark facade rather
    # than whichever generic facade the sparse OSM tags happen to select.
    # Its own flat roof stops under the photovoltaic field: at the driving plane it capped
    # the panels, so the roof past the rail showed glass. The fascia still covers this edge.
    return extrude(poly, base, top - SUPPORT_ROOF_DROP_M, material="building_landmark_glass"), top


def roof_support_details(route, res, roof_y):
    """Apple Park's pale floor bands and the solar roof left beside the racing line."""
    spec = route.get("roofLoop")
    if spec is None or roof_y is None:
        return {}
    poly, _tags = footprint_by_osm_id(route["id"], res.frame, spec["osmRelation"])

    # Four thin rings produce the real facade's horizontal silver-white strata on both the outer
    # wall and courtyard. They protrude slightly so they stay visible over the glass shell.
    bands = [extrude(poly.buffer(0.35, join_style="round"), roof_y - level * 6.0 - 0.18,
                     roof_y - level * 6.0 + 0.18, material="building_landmark_pale")
             for level in range(1, 5)]

    # The route occupies only a strip of the annular roof. Keep the photovoltaic field on the
    # remainder, slightly below the asphalt so it cannot cover the racing line. It is also the flat
    # roof a car lands on past the rail, so it is a `deck` node with ground collision,
    # and it reaches to within a hand of the road so no wheel-sized slot is left between the two.
    solar_area = poly.difference(road_footprint(res, margin=0.3))
    solar_polys = ([solar_area] if solar_area.geom_type == "Polygon" else
                   [p for p in solar_area.geoms if p.geom_type == "Polygon"])
    solar = [_panel_uvs(extrude(p, roof_y - 0.45, roof_y - 0.08, material="building_landmark_solar"))
             for p in solar_polys if p.area > 4.0]
    top_band = roof_fascia(poly, roof_y)
    return {"roof_floor_bands": merge(bands, "building_landmark_pale"),
            "deck_roof_solar": merge(solar, "building_landmark_solar"),
            "roof_top_band": top_band}


def build(route_id, stage="greybox", out_root=None, preview_root=None, compress=True, log=print):
    route = load_route(route_id)
    dem = DemSampler()
    res = build_route(route_id)
    support, roof_y = roof_support(route, res, dem)
    road_y = (np.full(len(res.P), roof_y) if roof_y is not None else
              road_profile(res, dem, route.get("bridgeDeckM"), route.get("bridgeMinLengthM", 200.0)))
    res.P[:, 1] = road_y                      # the spline carries elevation from here on
    # Steering was calibrated against this field before 229. It is not an interval or progress
    # scale, so keep that behaviour while replacing every consumer of route distance below.
    res.export_curvature = _curvature(res)
    # The web payload rounds points to centimetres. Parameterise those exact points so exported s,
    # length, gates and runtime projection cannot drift from the coordinates the browser receives.
    res.P[:] = np.round(res.P, 2)
    road_y = res.P[:, 1].copy()
    from sr.route import reparameterize
    reparameterize(res)
    res.flat_left, res.flat_right = parallel_flat_extents(res, res.ways, road_y, dem)
    corridor_pad = float(route.get("terrainPadM", 300))
    corridor = corridor_polygon(res, pad=corridor_pad)
    water_level = float(route.get("waterLevelM", 0.0))
    log(f"{route_id}: {res.length:.0f} m, {len(res.P)} points, {road_y.min():.0f}..{road_y.max():.0f} m")

    # A route that no longer goes past the thing it exists to show is a broken route, and the only
    # way anyone found out before was by driving it and not recognising anything.
    checks = must_pass(res, route)
    for c in checks:
        log(f"  {'ok  ' if c['ok'] else 'MISS'} {c['name']}: {c['dist']:.0f} m (limit {c['limit']:.0f})")
    missed = [c for c in checks if not c["ok"]]
    if missed:
        raise ValueError(f"{route_id}: the racing line misses "
                         + "; ".join(f"{c['name']} by {c['dist'] - c['limit']:.0f} m" for c in missed))

    ts = TileSet()
    end_roads = end_road_continuations(res, road_y, dem, route_id)
    res.end_roads = end_roads
    cover = landcover.patches(route_id, res.frame)
    terrain = build_terrain(res, dem, road_y, corridor, pad=corridor_pad, water_level=water_level, cover=cover,
                            sea=landcover.bridge_supports(route_id, res.frame))
    # One node per kind of ground: `terrain_grass`, `terrain_wood`, `terrain_paved`…
    # `collider_for` splits on the underscore, so every one of them is still a trimesh, and the
    # runtime looks each name up in the same material library as everything else.
    for material, mesh in sorted(terrain.covers.items()):
        ts.add_mesh(material, mesh)
    ts.add_mesh("water", terrain.water)
    for tile in list(ts.meshes):
        if "water" in ts.meshes[tile]:
            ts.extras[tile]["water"] = {"killY": water_level + WATER_KILL_Y}
    log(f"  terrain {terrain.terrain.triangle_count} tris in {len(terrain.covers)} covers "
        f"({', '.join(sorted(terrain.covers))}), water {terrain.water.triangle_count}")

    if support is not None:
        # The road and guardrails own collision. The shell is visual support below them; treating a
        # 480 m courtyard ring as one box collider would fill its garden and wall off the course.
        ts.add_mesh("roof_support", support)
        for name, detail in roof_support_details(route, res, roof_y).items():
            ts.add_mesh(name, detail)
        log(f"  roof support {support.triangle_count} tris at {roof_y:.1f} m")

    ribbons = race_ribbons(res, road_y)
    for material, mesh in ribbons.items():
        ts.add_mesh("bridge" if material == "bridge" else "road", mesh)
    sides, side_paint = side_roads(res, road_y, dem, route_id, pad=corridor_pad, end_roads=end_roads)
    ts.add_mesh("road", sides)
    for material, mesh in side_paint.items():
        ts.add_mesh(f"markings_{material.split('_')[1]}", mesh)
    log(f"  race surface + side roads {sides.triangle_count} tris")

    walk = sidewalks(res, road_y, dem)
    if walk is not None:
        ts.add_mesh("sidewalk", walk)
        log(f"  pavement {walk.triangle_count} tris")

    painted, junctions = road_markings(res, road_y, route_id)
    for material, mesh in painted.items():
        ts.add_mesh(f"markings_{material.split('_')[1]}", mesh)   # one node per paint colour
    log(f"  markings {sum(m.triangle_count for m in painted.values())} tris at "
        f"{len(junctions.junctions)} road junctions ({', '.join(sorted(painted)) or 'none'})")

    airport = add_airfield_to_tiles(ts, res, road_y, dem, route)
    if airport["lights"] or airport["vehicles"]:
        log(f"  airfield {airport['lights']} edge lights, {airport['vehicles']} service vehicles")

    iron = suspension(res, road_y, route.get("suspension"))
    if iron is not None:
        ts.add_mesh("bridgeworks", iron)
        log(f"  bridge ironwork {iron.triangle_count} tris")

    rail = guardrails(res, road_y) if route.get("guardrails", True) else None
    ts.add_mesh("guardrail", rail)
    log(f"  guardrail {rail.triangle_count if rail else 0} tris")

    bar = barrier_mesh()
    placements = barrier_lines(res, road_y, dem, route_id, junctions)
    for pos, yaw in placements:
        ts.add_instance("props_barrier", pos, yaw, bar, BARRIER_HALF)
    log(f"  {len(placements)} barriers")

    slimes = slime_placements(res, route, junctions.junctions)
    add_slimes(ts, slimes)
    log(f"  {len(slimes)} slimes")

    # Every surface drawn as tarmac, not just the one the race is run on. A side street is scenery
    # the car never has to touch, but it is a street the player can see and can drive onto, and a
    # street that ends in a wall reads as the road being cut in half -- which is exactly what it
    # looked like at the top of the Mountain View loop, where the racing line turns off and the
    # street carries straight on into a building.
    drivable = unary_union([road_footprint(res), _surface(sides)])
    # The route surface is also used as a backdrop exclusion below, where its plan shadow is right.
    # Building clipping needs vertical meaning: Fort Point sits under the Golden Gate, so the
    # elevated bridge must not cut forty percent out of the fort while ground roads and side roads
    # still keep every wall off their tarmac.
    building_clear = unary_union([
        road_footprint(res, include_bridges=False), _surface(sides),
    ])
    # A roof loop's support shell already owns the building under the road. Feeding that same OSM
    # relation through the ordinary building pass clips the road out of a second 30 m extrusion,
    # leaving two full-height walls along the inner and outer edges. The result looks like a road
    # at ground level in a trench and hides both the courtyard and the streets below.
    by_facade, boxes, visual_boxes = build_buildings(
        res, road_y, dem, route_id, corridor, keep_clear=building_clear, return_visual_boxes=True,
    )
    # One node per facade material, because a node carries exactly one material (docs/CONTRACT.md
    # section 3). They all keep the `buildings` prefix, which is what decides the collider kind on
    # both sides, so the box colliders below are unaffected by the split.
    for material, mesh in sorted(by_facade.items()):
        ts.add_mesh("buildings" if material == "building" else material.replace("building_", "buildings_"),
                    mesh)
    for b in boxes:
        ts.add_box_collider(b[:3], b[3:6], b[6])
    buildings = merge(list(by_facade.values()), "building")
    log(f"  buildings {buildings.triangle_count} tris in {len(by_facade)} facades, {len(boxes)} colliders")

    # A roof loop is marked as bridge so terrain stays below it, but its road surface is the roof
    # the signs stand on. Ordinary bridges still carry no boards. Buildings are deliberately built
    # first: their real exported boxes decide where a face can be read from the road.
    landmark_boxes = []
    for footprint in load_landmark_footprints(res.frame, names=route.get("landmarks", [])):
        (cx, _cy, cz), (hx, _hy, hz), yaw = oriented_box(footprint, -10_000.0, 10_000.0)
        landmark_boxes.append([cx, 0.0, cz, hx, 10_000.0, hz, yaw])
    aircraft, aircraft_bays = aircraft_placements(res, dem, [*visual_boxes, *landmark_boxes])
    boards = billboard_placements(
        res, road_y, dem, on_deck=route.get("roofLoop") is not None,
        obstacles=[*visual_boxes, *landmark_boxes, *aircraft_bays], terrain=terrain.terrain,
    )
    validate_billboards(boards, route_id)
    add_billboards(ts, boards)
    log(f"  {len(boards)} billboards")

    # Trees are scenery, so they yield to the sight line of an accepted board. This preserves real
    # buildings and moves only generated vegetation instead of pretending an advert can erase a
    # mapped structure.
    trees = tree_positions(
        res, road_y, dem, route_id, corridor, sight_clear=billboard_sight_clearance(boards),
        occupied=tree_obstacles(res, route_id, corridor, [*visual_boxes, *landmark_boxes]),
    )
    add_trees(ts, trees)
    log(f"  {len(trees)} trees")

    flowers = lombard_flowers(res, road_y, dem, route_id, sight_clear=billboard_sight_clearance(boards))
    add_flowers_to_tiles(ts, flowers)
    if flowers:
        log(f"  {len(flowers)} hydrangea bushes")

    scenery_slimes = scenery_placements(res, dem, visual_boxes, route_id, water_level)
    add_scenery_to_tiles(ts, scenery_slimes)
    log(f"  {len(scenery_slimes)} static distant slimes")

    # Nothing may stand on the ground the car drives on. Checked on the assembled geometry, not on
    # the footprints it came from: everything between the two has been wrong at least once.
    # This validator is deliberately plan-view only, so feed it only road surfaces that own the
    # ground below them. An elevated bridge crossing a low building is not a collision: Fort Point
    # is 15 m tall below the Golden Gate's 67 m deck. The physics boxes retain their real y ranges.
    ground_ribbons = [mesh for name, mesh in ribbons.items() if name != "bridge"]
    on_road = buildings_over_the_road([*ground_ribbons, sides], buildings)
    if on_road:
        worst = ", ".join(f"{a:.0f} m2 at ({x:.0f}, {z:.0f})" for a, x, z in on_road[:3])
        raise ValueError(f"{route_id}: {len(on_road)} building triangles stand on the road -- {worst}")
    log("  road clear of buildings")

    track = _track_document(route, res, road_y)
    if end_roads:
        track["endRoads"] = end_road_document(end_roads)
    from sr.landmark_data import entries as landmark_entries, model_anchor
    models = list(aircraft)
    displayed = {model["id"] for model in aircraft}
    for name in route.get("landmarks", []):
        if name in displayed:
            continue
        entry = landmark_entries().get(name, {})
        if entry.get("kind") != "glb":
            continue
        lat, lon = model_anchor(entry)
        x, z = res.frame.to_local(lat, lon)
        y = float(dem.heights(np.array([lat]), np.array([lon]))[0])
        models.append({"id": name, "file": entry["file"], "pos": [float(x), y, float(z)],
                       "yaw": float(entry.get("yaw", 0)), "loadRadius": entry["loadRadius"]})
    if models:
        track["landmarks"] = models
    out_root = out_root or os.path.join(ROOT, "game", "public", "tracks")
    preview_root = preview_root or os.path.join(ROOT, "pipeline", "out")
    out_dir = os.path.join(out_root, route_id)
    os.makedirs(out_dir, exist_ok=True)

    far = build_backdrop(res, route_id, DemSampler(BACKDROP_ZOOM, require_complete=True), water_level=water_level,
                         keep_clear=drivable, cover=cover, corridor_pad=corridor_pad - 20)
    # The backdrop is checked too. It was not, and that is how a two hundred metre skyline block
    # ended up drawn straight across the road while every other check reported the road clear: they
    # all looked at the streamed tiles, and this thing lives in the mesh that is loaded once and
    # never streamed.
    for name, mesh in (far or {}).items():
        if "building" not in name and "landmark" not in name:
            continue
        # Airport aprons and service lanes may legitimately finish at a hangar door. A landmark
        # must stay off the racing surface, while ordinary backdrop buildings must also stay off
        # every visible side road so they cannot cut a street in half.
        checked_surfaces = ground_ribbons if "landmark" in name else [*ground_ribbons, sides]
        far_on_road = buildings_over_the_road(checked_surfaces, mesh)
        if far_on_road:
            worst = ", ".join(f"{a:.0f} m2 at ({x:.0f}, {z:.0f})" for a, x, z in far_on_road[:3])
            raise ValueError(f"{route_id}: backdrop node {name} stands on the road -- {worst}")
    if far:
        write_backdrop(os.path.join(out_dir, "backdrop.glb"), far, compress=compress)
        from sr.horizon import RADIUS
        track["backdrop"] = {"file": "backdrop.glb", "radiusM": float(route.get("backdropM", 3000)),
                             "horizonRadiusM": RADIUS}
        log(f"  backdrop {sum(m.triangle_count for m in far.values())} tris "
            f"({', '.join(k.split('_')[1] for k in far)})")

    # the streets around the route, for the map panels: see sr/streetmap.py
    map_bytes = write_map(os.path.join(out_dir, "map.json"), street_map(res))
    track["map"] = {"file": "map.json"}
    log(f"  street map {map_bytes / 1e3:.0f} kB")

    doc = export_track(track, ts, out_dir, compress=compress)
    render_preview(doc, ts, os.path.join(preview_root, route_id, "preview.png"),
                   roads=[(w.highway, w.xy) for w in res.ways], snapped=res.snapped)
    tiles_dir = os.path.join(out_dir, "tiles")
    total = sum(os.path.getsize(os.path.join(tiles_dir, f)) for f in os.listdir(tiles_dir))
    log(f"  {len(doc['tiles'])} tiles, {total / 1e6:.1f} MB, "
        f"{len(doc['checkpoints'])} checkpoints")
    return doc


def _track_document(route, res, road_y):
    T0 = res.T[0]
    doc = {
        "id": route["id"], "version": 1, "editions": route.get("editions", ["full"]),
        "category": route["category"], "mode": route["mode"], "laps": int(route.get("laps", 1)),
        "name": route["name"], "blurb": route["blurb"],
        "origin": route["origin"], "timeOfDay": route["timeOfDay"], "car": route["car"],
        "spline": {
            "points": np.round(res.P, 2).tolist(),
            "s": res.S.tolist(),
            "halfWidth": np.round(res.half_width, 2).tolist(),
            "curvature": np.round(_curvature(res), 6).tolist(),
            "closed": bool(res.closed),
            "length": float(res.length),
        },
        "start": {"pos": [float(res.P[0][0]), float(road_y[0] + 0.6), float(res.P[0][2])],
                  "yaw": yaw_for_z_axis(-T0)},
        "checkpoints": checkpoints_for(res, mode=route["mode"]),
        "attribution": ATTRIBUTION,
    }
    if route["category"] == "mission":
        doc["story"] = route["story"]
        doc["countdown"] = {"seconds": float(route.get("countdownS", 300))}
    if route.get("camera") is not None:
        doc["camera"] = route["camera"]
    return doc


def _curvature(res):
    from sr.geom import curvature
    return getattr(res, "export_curvature", curvature(res.P, res.S, res.closed))
