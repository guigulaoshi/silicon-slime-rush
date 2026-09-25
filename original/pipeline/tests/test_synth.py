import json
import os
import tempfile

import pygltflib
import numpy as np
import pytest

from sr.schema import track_errors
from sr.route import RACE_MIN_HALF
from sr.geom import resample, rights, tangents
from sr import synth
from sr.synth import _build_world, ellipse, generate

MATERIALS = {"road", "terrain", "water", "building", "barrier", "bridge", "guardrail"}
# read from the contract rather than repeated here: the last copy of this table that drifted
# shipped a guardrail with no collider at all
from sr.export import NODE_COLLIDER

PREFIXES = set(NODE_COLLIDER)


def test_side_road_barrier_rows_are_perpendicular_to_the_stubs_they_close():
    P, S = resample(ellipse(), 2.0, closed=True)
    T = tangents(P, True)
    ts = _build_world(P, S, T, rights(T), True, RACE_MIN_HALF)
    rows = []
    for tile in ts.instances.values():
        inst = tile.get("props_barrier")
        if inst:
            rows.extend(zip(inst["positions"], inst["yaws"]))
    assert len(rows) == 6
    for start in range(0, len(rows), 3):
        row = rows[start:start + 3]
        positions = np.asarray([item[0] for item in row])
        yaw = row[0][1]
        along = np.array([np.sin(yaw), np.cos(yaw)])
        span = positions[-1, [0, 2]] - positions[0, [0, 2]]
        assert abs(float(np.dot(span, along))) < 1e-6
        assert np.linalg.norm(span) == pytest.approx(4.0)


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("tracks"); prev = tmp_path_factory.mktemp("prev")
    docs = generate(str(out), str(prev))
    return out, prev, docs


def tile_gltf(out, track_id, entry):
    """Read one tile back the way the runtime does: one file per tile.

    The packed shape (`tiles.bin` plus byte ranges) is written by `npm run build`, not by the
    pipeline, so it is checked on that side -- `game/test/packTiles.test.ts`."""
    with open(os.path.join(out, track_id, "tiles", entry["name"] + ".glb"), "rb") as fh:
        blob = fh.read()
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as tmp:
        tmp.write(blob)
        path = tmp.name
    try:
        return pygltflib.GLTF2().load(path)
    finally:
        os.remove(path)


def test_three_tracks_validate(built):
    out, _, docs = built
    assert [d["id"] for d in docs] == ["synth-loop", "synth-p2p", "synth-stops"]
    for d in docs:
        with open(os.path.join(out, d["id"], "track.json"), encoding="utf-8") as f:
            assert track_errors(json.load(f)) == []


def test_modes_and_checkpoints(built):
    _, _, docs = built
    loop, p2p, stops = docs
    assert loop["mode"] == "loop" and loop["spline"]["closed"] and loop["laps"] == 3
    assert p2p["mode"] == "p2p" and not p2p["spline"]["closed"]
    assert stops["mode"] == "multistop" and sum(1 for c in stops["checkpoints"] if c.get("stop")) == 3
    assert abs(loop["spline"]["length"] - 1440) < 30


def test_fixture_uses_the_narrowest_production_road(built):
    _, _, docs = built
    for doc in docs:
        assert set(doc["spline"]["halfWidth"]) == {RACE_MIN_HALF}, doc["id"]


def test_glb_nodes_follow_contract(built):
    out, _, docs = built
    for d in docs:
        assert d["tiles"], d["id"]
        # Loose files, and no pack: packing is what `npm run build` does on its way into dist/
        #A rebuild here rewrites one tile, not one blob for the whole track.
        assert "tilePack" not in d, d["id"]
        assert not os.path.exists(os.path.join(out, d["id"], "tiles.bin")), d["id"]
        for t in d["tiles"]:
            assert "offset" not in t and "length" not in t, (d["id"], t["name"])
            at = os.path.join(out, d["id"], "tiles", t["name"] + ".glb")
            assert os.path.getsize(at) > 0, at
        for t in d["tiles"]:
            g = tile_gltf(out, d["id"], t)
            assert g.scenes and g.nodes
            for node in g.nodes:
                assert any(node.name == prefix or node.name.startswith(prefix + "_")
                           for prefix in PREFIXES), node.name
                assert "collider" in (node.extras or {}), node.name
            for m in g.materials:
                assert m.name in MATERIALS
            assert "EXT_meshopt_compression" in (g.extensionsRequired or []), "tiles must be meshopt compressed"


def test_instancing_and_boxes_present(built):
    out, _, docs = built
    saw_inst = saw_boxes = saw_kill = False
    slime_nodes = set()
    for t in docs[0]["tiles"]:
        g = tile_gltf(out, "synth-loop", t)
        for node in g.nodes:
            if node.name == "props_barrier":
                saw_inst = True
                assert "EXT_mesh_gpu_instancing" in (node.extensions or {})
                assert node.extras["halfExtents"] == [1.0, 0.45, 0.25]
            if node.name.startswith("props_slime_"):
                slime_nodes.add(node.name)
                assert node.extras["collider"] == "none"
                assert "SCALE" in node.extensions["EXT_mesh_gpu_instancing"]["attributes"]
            if node.name == "buildings" and node.extras.get("boxes"):
                saw_boxes = True
            if node.name == "water":
                saw_kill = node.extras.get("killY") == -0.2
    assert saw_inst and saw_boxes and saw_kill
    kinds = ("popper", "slick", "burst", "boost", "colossus")
    assert slime_nodes == ({f"props_slime_{kind}" for kind in kinds}
                           | {f"props_slime_many_{kind}" for kind in kinds})


def test_preview_written(built):
    _, prev, docs = built
    for d in docs:
        assert os.path.getsize(os.path.join(prev, d["id"], "preview.png")) > 10000


def test_synthetic_stops_exercises_shared_collidable_landmarks(built):
    _, _, docs = built
    track = next(doc for doc in docs if doc['id'] == 'synth-stops')
    refs = track['landmarks']
    assert len(refs) == 2
    assert refs[0]['file'] == refs[1]['file']
    assert refs[0]['pos'] != refs[1]['pos']
    assert all(ref['collision'] for ref in refs)
    assert track_errors(track) == []


def test_stop_gates_keep_their_approach_and_overshoot_clear_of_slimes(monkeypatch, tmp_path):
    """A boost before a delivery and a giant after it made synth-stops undeliverable (every run reset)."""
    placed = {}
    route_ids = iter(["synth-loop", "synth-p2p", "synth-stops"])
    monkeypatch.setattr(synth, "add_slimes", lambda ts, items: placed.setdefault(next(route_ids), list(items)))
    monkeypatch.setattr(synth, "_write", lambda track, ts, out_root, preview_root: track)
    tracks = {track["id"]: track for track in synth.generate(str(tmp_path), str(tmp_path))}
    stops = [cp["s"] for cp in tracks["synth-stops"]["checkpoints"] if cp.get("stop")]
    assert len(stops) == 3
    for item in placed["synth-stops"]:
        for stop in stops:
            assert not -synth.STOP_APPROACH_CLEAR_M <= item.s - stop <= synth.STOP_OVERSHOOT_CLEAR_M, (item.kind, item.s, stop)
    assert any(item.kind == "colossus" for item in placed["synth-stops"]), "the drive still needs a giant"
    assert any(-60 <= item.s - stop <= 70 for item in placed["synth-p2p"] for stop in stops), \
        "the clearance is for delivery gates only"
