import numpy as np
import pytest
from shapely.geometry import Point

from sr.billboards import (FALLBACK_SLOTS, FULL_CYCLE, MAX_SUPPORT, MIN_BOARDS, MIN_SUPPORT,
                           SOCIAL_SLOTS, SLOTS, STYLES, add_to_tiles, _board_box,
                           _segment_hits_box, face_mesh, placements, sight_clearance, style_for,
                           support_mesh, validate_placements)
from sr.terrain import APRON
from sr.tiles import TileSet
from tests.test_terrain import FakeDem, straight_route


def route_with(highway, length=2000.0, half_width=6.0):
    res = straight_route(length=length, half_width=half_width)
    res.highway[:] = [highway] * len(res.P)
    return res


def flat(res, y=10.0):
    return FakeDem(res.frame, lambda x, z: np.full(np.shape(x), y))


def test_style_comes_from_the_road_class():
    assert style_for("motorway") == "pole"
    assert style_for("trunk_link") == "pole"
    assert style_for("residential") == "ground"
    assert style_for("service") == "ground"


def test_both_billboard_styles_are_twenty_percent_larger():
    assert STYLES["pole"][1:3] == (19.2, 9.6)
    assert STYLES["ground"][1:3] == (9.6, 4.8)


def test_boards_stand_clear_of_the_road_and_alternate_sides():
    """A board faces oncoming traffic, so its panel lies across the road direction: set back by only
    the clearance, the near half of a sixteen metre panel would hang over the tarmac."""
    res = route_with("motorway")
    dem = flat(res)
    road_y = np.full(len(res.P), 10.0)
    boards = placements(res, road_y, dem)
    assert boards, "a two kilometre motorway should carry boards"
    _, w, _, _, clear, _post = STYLES["pole"]
    lateral = [float(b["pos"][2]) for b in boards]         # the route runs along +x, so z is lateral
    for b, off in zip(boards, lateral):
        assert abs(off) >= res.half_width[0] + APRON + clear + w / 2 - 1e-6
    assert any(o > 0 for o in lateral) and any(o < 0 for o in lateral), "boards should use both sides"
    social = lateral[0::2]
    space = lateral[1::2]
    assert all(any(o > 0 for o in group) and any(o < 0 for o in group) for group in (social, space))


def test_board_local_z_follows_the_road_so_its_front_faces_the_driver():
    res = route_with("motorway")
    boards = placements(res, np.full(len(res.P), 10.0), flat(res))
    for board in boards:
        yaw = board["yaw"]
        local_z = np.array([np.sin(yaw), np.cos(yaw)])
        i = int(np.argmin(np.abs(res.P[:, 0] - board["pos"][0])))
        assert np.dot(local_z, res.T[i, [0, 2]]) > 0.999


def test_spacing_follows_the_style():
    for highway, style in (("motorway", "pole"), ("residential", "ground")):
        res = route_with(highway, length=3000.0)
        boards = placements(res, np.full(len(res.P), 10.0), flat(res))
        xs = sorted(float(b["pos"][0]) for b in boards)
        gaps = np.diff([0.0, *xs, 3000.0])
        assert len(boards) >= FULL_CYCLE
        assert len(boards) % 2 == 0
        assert gaps.max() < gaps.mean() * 1.15, (highway, gaps)
        assert gaps.min() > gaps.mean() * 0.85, (highway, gaps)
        assert len(boards) >= 3000.0 / STYLES[style][0] - 2


def test_no_accepted_board_hides_another_accepted_face():
    res = route_with("residential", length=3000.0)
    boards = placements(res, np.full(len(res.P), 10.0), flat(res))
    for target in boards:
        for blocker in boards:
            if blocker is target:
                continue
            box = _board_box(blocker)
            assert not any(_segment_hits_box(target["view_from"], point, box)
                           for point in target["view_samples"])


def test_a_roof_loop_gets_a_complete_fourteen_board_cycle_on_its_deck():
    res = route_with("primary", length=1300.0)
    res.bridge[:] = True
    road_y = np.full(len(res.P), 30.0)
    boards = placements(res, road_y, flat(res), on_deck=True)
    assert len(boards) >= FULL_CYCLE
    assert {b["slot"] for b in boards} == set(SLOTS)
    assert {b["style"] for b in boards} == {"ground"}
    assert all(b["pos"][1] == pytest.approx(30.0) for b in boards)


def test_a_formal_route_prefers_fourteen_fifty_fifty_and_accepts_the_ten_board_fallback():
    boards = [{"slot": SLOTS[i % len(SLOTS)]} for i in range(FULL_CYCLE)]
    validate_placements(boards, "complete")
    fallback = [{"slot": slot} for slot in FALLBACK_SLOTS]
    validate_placements(fallback, "constrained")
    assert sum(b["slot"] in SOCIAL_SLOTS for b in fallback) == 7
    with pytest.raises(ValueError, match="at least 10"):
        validate_placements(boards[:8], "short")
    with pytest.raises(ValueError, match="must be 10 or at least 14"):
        validate_placements(boards[:12], "in-between")
    with pytest.raises(ValueError, match="must be even"):
        validate_placements(boards + [{"slot": "a"}], "odd")
    with pytest.raises(ValueError, match="slots missing n"):
        validate_placements([{"slot": SLOTS[i % 13]} for i in range(14)], "missing")


def test_a_building_in_the_view_moves_every_board_to_the_clear_side():
    res = route_with("motorway", length=2400.0)
    road_y = np.full(len(res.P), 10.0)
    # Route runs +x. This long, tall box owns the whole +z verge but leaves -z clear.
    obstacle = [1200.0, 20.0, 20.0, 1200.0, 20.0, 15.0, 0.0]
    boards = placements(res, road_y, flat(res), obstacles=[obstacle])
    assert len(boards) >= FULL_CYCLE
    assert all(float(board["pos"][2]) < 0.0 for board in boards)


def test_a_building_touching_the_face_endpoint_is_still_an_obstruction():
    eye = np.array([0.0, 2.0, 0.0])
    face = np.array([100.0, 8.0, 0.0])
    # A shallow facade around the target is exactly the failure seen in the browser: most of the
    # view ray is clear, but the sign itself is embedded in the wall.
    facade = [99.5, 8.0, 0.0, 0.5, 10.0, 4.0, 0.0]
    assert _segment_hits_box(eye, face, facade)


def test_tree_exclusion_covers_each_driver_to_face_sight_line():
    res = route_with("residential", length=1800.0)
    boards = placements(res, np.full(len(res.P), 10.0), flat(res))
    clear = sight_clearance(boards)
    assert clear is not None
    for board in boards:
        midpoint = (board["view_from"] + board["face_pos"]) / 2
        assert clear.covers(Point(midpoint[0], midpoint[2]))


def test_legs_stretch_to_reach_the_ground_and_the_panel_stays_with_the_road():
    """The panel hangs at a height above the *road*; the legs are however long the ground needs.
    A fixed leg length put every board on a hillside under the tarmac."""
    res = route_with("residential")
    road_y = np.full(len(res.P), 10.0)
    _, _, h, base, _, _post = STYLES["ground"]
    for drop in (0.0, 4.0, 12.0):
        dem = FakeDem(res.frame, lambda x, z, d=drop: np.where(np.abs(z) > 8, 10.0 - d, 10.0))
        boards = placements(res, road_y, dem)
        assert boards, f"a {drop} m slope is still somewhere to stand"
        for b in boards:
            assert b["face_pos"][1] == pytest.approx(10.0 + base + h / 2)
            assert b["pos"][1] + b["support"] == pytest.approx(10.0 + base)


def test_a_board_on_a_cliff_is_dropped():
    """Legs longer than a building are not a billboard, they are a footing down a cliff."""
    res = route_with("residential")
    high = np.full(len(res.P), 200.0)
    cliff = FakeDem(res.frame, lambda x, z: np.where(np.abs(z) > 8, -2000.0, 200.0))
    assert placements(res, high, cliff) == []
    for b in placements(res, np.full(len(res.P), 10.0), flat(res)):
        assert MIN_SUPPORT <= b["support"] <= MAX_SUPPORT


def test_no_boards_on_a_bridge():
    res = route_with("residential", length=1200.0)
    res.bridge[:] = True
    assert placements(res, np.full(len(res.P), 10.0), flat(res)) == []


def test_faces_are_unit_panels_with_one_material_per_slot():
    """Slots exist because an instanced node carries exactly one material; the geometry is identical
    and only the material name tells the runtime which advert to hang on it."""
    meshes = [face_mesh(slot) for slot in SLOTS]
    assert {m.material for m in meshes} == {f"billboard_face_{s}" for s in SLOTS}
    for m in meshes:
        lo, hi = m.bounds()
        assert np.allclose(lo, [-0.5, -0.5, 0.0]) and np.allclose(hi[:2], [0.5, 0.5])
        assert m.uvs.min() == 0.0 and m.uvs.max() == 1.0
        assert m.triangle_count == 4, "the same advert on the front and back"


def test_the_advert_is_not_written_back_to_front():
    """The panel faces -z, so a viewer looking at it sees +x to their left: u has to run the other
    way along x than it looks like it should, or every advert reads in a mirror."""
    m = face_mesh("a")
    front = m.positions[:, 2] == 0.0
    left = m.positions[front][:, 0] < 0
    assert np.allclose(m.uvs[front][left][:, 0], 1.0)
    assert np.allclose(m.uvs[front][~left][:, 0], 0.0)


def test_the_back_of_a_panel_carries_the_same_unmirrored_advert():
    from sr.mesh import geometric_normals
    m = face_mesh("a")
    back = m.positions[:, 2] > 0.0
    assert back.sum() == 4
    assert m.uvs[back, 0].min() == 0.0 and m.uvs[back, 0].max() == 1.0
    assert m.uvs[back, 1].min() == 0.0 and m.uvs[back, 1].max() == 1.0
    # From +z, world +x is screen-right, so u must increase with x on the back.
    assert np.allclose(m.uvs[back & (m.positions[:, 0] < 0), 0], 0.0)
    assert np.allclose(m.uvs[back & (m.positions[:, 0] > 0), 0], 1.0)
    tris = m.indices.reshape(-1, 3)
    face_normals = geometric_normals(m.positions, tris)
    shading_normals = m.normals[tris].mean(axis=1)
    assert np.all(np.sum(face_normals * shading_normals, axis=1) > 0)
    assert np.count_nonzero(shading_normals[:, 2] < 0) == 2
    assert np.count_nonzero(shading_normals[:, 2] > 0) == 2


def test_every_board_writes_a_frame_and_a_face_instance():
    res = route_with("motorway")
    boards = placements(res, np.full(len(res.P), 10.0), flat(res))
    ts = TileSet()
    add_to_tiles(ts, boards)
    nodes = {n for tile in ts.instances.values() for n in tile}
    assert "props_billboard_pole" in nodes
    assert any(n.startswith("props_billboard_face_") for n in nodes)
    frames = sum(len(t[n]["positions"]) for t in ts.instances.values() for n in t if not n.startswith("props_billboard_face"))
    faces = sum(len(t[n]["positions"]) for t in ts.instances.values() for n in t if n.startswith("props_billboard_face"))
    # four instances a board now: legs, face, lamp steel, lamp glass
    assert faces == len(boards)
    assert frames == 3 * len(boards)


def test_the_face_sits_over_its_own_footing():
    res = route_with("residential")
    boards = placements(res, np.full(len(res.P), 10.0), flat(res))
    b = boards[0]
    assert b["face_pos"][0] == pytest.approx(b["pos"][0])
    assert b["face_pos"][2] == pytest.approx(b["pos"][2])


def test_supports_are_one_metre_tall_and_start_at_the_footing():
    """Their real height is a per-instance scale, so the mesh has to be exactly one unit."""
    for style in STYLES:
        lo, hi = support_mesh(style).bounds()
        assert lo[1] == pytest.approx(0.0, abs=1e-5), f"{style} legs must start at the footing"
        assert hi[1] == pytest.approx(1.0, abs=1e-5), f"{style} legs must be one unit tall"


def test_matching_floodlights_hang_below_both_panel_faces():
    """The gantry is authored at the panel's own size and instanced without scale.

    A lamp mesh that gets stretched with the panel turns its housings into slabs, so this checks the
    thing that would silently go wrong: the mesh has to match the style it belongs to and put the
    same number of lamps in front of each face."""
    from sr.billboards import LAMP_DROP, lamp_meshes

    for style, (_, w, h, _, _, _) in STYLES.items():
        steel, lenses = lamp_meshes(style)
        # Only the thin glass glows; the same steel instance now includes the frame.
        assert steel.material == "billboard_frame"
        assert lenses.material == "billboard_lamp"
        lo, hi = lenses.bounds()
        assert w * .5 < hi[0] - lo[0] <= w
        assert hi[1] < -h / 2, f"{style} lamps cross the advert"
        assert lo[1] > -h, f"{style} lamps hang below the available space"
        assert lo[2] < -.5 and hi[2] > .5
        frame_lo, frame_hi = steel.bounds()
        assert frame_lo[0] < -w / 2 and frame_hi[0] > w / 2
        assert frame_lo[1] < -h / 2 and frame_hi[1] > h / 2
        # Large lens faces point up and back to the panel, rather than shining at drivers.
        tris = lenses.indices.reshape(-1, 3)
        points = lenses.positions[tris]
        normals = np.cross(points[:, 1] - points[:, 0], points[:, 2] - points[:, 0])
        area = np.linalg.norm(normals, axis=1)
        front = normals[(area > .1) & (normals[:, 1] > 0)]
        assert len(front) == (3 if style == "pole" else 2) * 4
        unit = front / np.linalg.norm(front, axis=1)[:, None]
        assert np.all(unit[:, 1] > .8)
        n = 3 if style == "pole" else 2
        assert np.count_nonzero(unit[:, 2] > .2) == n * 2
        assert np.count_nonzero(unit[:, 2] < -.2) == n * 2


def test_billboard_steel_never_crosses_the_artwork_interior():
    """A two-sided panel cannot hide a rear diagonal from both viewing directions."""
    from sr.billboards import lamp_meshes

    for style, (_, w, h, _, _, _) in STYLES.items():
        steel, _ = lamp_meshes(style)
        centres = steel.positions[steel.indices.reshape(-1, 3)].mean(axis=1)
        inside_face = ((np.abs(centres[:, 0]) < w / 2 - .25)
                       & (np.abs(centres[:, 1]) < h / 2 - .25)
                       & (np.abs(centres[:, 2]) < .5))
        assert not np.any(inside_face), f"{style}: steel crosses a billboard face"


def test_supports_have_round_profiles_and_radial_shading():
    for style, (_, w, _, _, _, radius) in STYLES.items():
        mesh = support_mesh(style)
        centres = [0]
        for x in centres:
            positions = mesh.positions[np.abs(mesh.positions[:, 0] - x) < radius * 1.01]
            profile = np.unique(np.round(positions[:, [0, 2]], 5), axis=0)
            assert len(profile) == 16
            assert np.allclose(np.hypot(profile[:, 0] - x, profile[:, 1]), radius, atol=1e-5)
        assert np.allclose(mesh.normals[:, 1], 0)
        assert np.allclose(np.linalg.norm(mesh.normals, axis=1), 1)


def test_all_fitting_faces_have_outward_winding_and_finite_unit_normals():
    from sr.billboards import lamp_meshes
    from sr.mesh import geometric_normals
    for style in STYLES:
        for mesh in [support_mesh(style), *lamp_meshes(style)]:
            assert np.all(np.isfinite(mesh.positions))
            assert np.allclose(np.linalg.norm(mesh.normals, axis=1), 1, atol=1e-5)
            tris = mesh.indices.reshape(-1, 3)
            face = geometric_normals(mesh.positions, tris)
            assert np.all(np.linalg.norm(face, axis=1) > 1e-7)
            assert np.all(np.sum(face * mesh.normals[tris].mean(axis=1), axis=1) > 0)


def test_steel_fittings_do_not_have_disconnected_floating_components():
    from sr.billboards import lamp_meshes
    for style in STYLES:
        steel, _ = lamp_meshes(style)
        triangles = steel.positions[steel.indices.reshape(-1, 3)]
        lo, hi = triangles.min(axis=1), triangles.max(axis=1)
        # Broad-phase connectivity is enough to reject a brace separated from the
        # frame by an air gap, without mistaking unwelded touching parts for gaps.
        connected = np.zeros(len(triangles), dtype=bool)
        connected[0] = True
        pending = [0]
        while pending:
            i = pending.pop()
            touching = np.all(lo <= hi[i] + 1e-5, axis=1) & np.all(hi >= lo[i] - 1e-5, axis=1)
            added = np.flatnonzero(touching & ~connected)
            connected[added] = True
            pending.extend(added.tolist())
        assert np.all(connected), f"{style}: {np.count_nonzero(~connected)} floating steel triangles"


@pytest.mark.parametrize("highway", ["residential", "motorway"])
@pytest.mark.parametrize("slope", [0.0, 0.45, -0.45])
def test_actual_terrain_keeps_all_fittings_clear_and_each_column_grounded(highway, slope):
    from sr.billboards import lamp_meshes
    from sr.mesh import grid
    res = route_with(highway)
    road_y = np.full(len(res.P), 10.0)
    # Deliberately disagree with the DEM: only the exported surface is authoritative.
    heights = np.array([[10 + slope*z for _x in (0, 2000)] for z in (-60, 60)])
    terrain = grid(0, -60, 2000, 60, heights)
    boards = placements(res, road_y, flat(res, -30), terrain=terrain)
    assert len(boards) >= FULL_CYCLE
    for board in boards:
        yaw = board["yaw"]
        rotation = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0],
                             [-np.sin(yaw), 0, np.cos(yaw)]])
        for mesh in lamp_meshes(board["style"]):
            world = mesh.positions @ rotation.T + board["face_pos"]
            assert np.all(world[:, 1] >= 10 + slope * world[:, 2] + .2499)
        radius = STYLES[board["style"]][5]
        assert len(board["legs"]) == (1 if highway == "motorway" else 2)
        for pos, height in board["legs"]:
            assert pos[1] == pytest.approx(10 + slope * pos[2] - abs(slope) * radius - .05, abs=1e-5)
            assert pos[1] + height == pytest.approx(board["face_pos"][1] - board["panel"][1]/2)


def test_missing_exported_ground_does_not_fall_back_to_dem():
    from sr.mesh import grid
    res = route_with("residential")
    terrain = grid(0, -1, 2000, 1, np.full((2, 2), 10.0))
    assert placements(res, np.full(len(res.P), 10.0), flat(res), terrain=terrain) == []


def test_exported_views_preserve_each_actual_road_eye(tmp_path):
    import pygltflib
    from sr.export import write_tile_glb
    res = route_with("residential")
    boards = placements(res, np.full(len(res.P), 10.0), flat(res))
    ts = TileSet()
    add_to_tiles(ts, boards)
    views = []
    for tile in ts.tiles():
        file = tmp_path / f"{tile[0]}-{tile[1]}.glb"
        write_tile_glb(file, {}, ts.instances[tile], [], ts.extras[tile])
        gltf = pygltflib.GLTF2().load(str(file))
        views.extend(view for node in gltf.nodes for view in (node.extras or {}).get("billboardViews", []))
    assert len(views) == len(boards)
    for board in boards:
        view = next(v for v in views if np.allclose(v["face"], board["face_pos"]))
        assert np.allclose(view["eye"], board["view_from"])
        assert view["side"] == board["side"]
