"""Tests for tools/assets.py: it decides whether what is on disk may be run, so every way it could
say "fresh" about something stale is a test.

The three failures it exists to catch are the three the queue entry named: products **missing**,
products **stale** (there, but written by code that has since changed), and products **half
written**. The first and third are the ones a "does the file exist" check gets right by accident;
the middle one is the one that put a car in an empty sky, and it is the reason the
question is a hash comparison rather than a directory listing.

Nothing here runs the real pipeline -- a real build is 27 seconds and this file is milliseconds. The
build step is replaced by a stub that writes the products a build would write, which is exactly the
seam the module already has for it.
"""
import json
import gzip
from pathlib import Path
import os

import pytest

import assets as S


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A miniature of the real layout: pipeline sources, one route, a cache, an empty store."""
    generator_source = Path(S.PIPELINE, "sr", "menumap.py").read_bytes()
    root = tmp_path / "repo"
    for rel in ("pipeline/sr/schema", "pipeline/routes", "pipeline/cache/only", "pipeline/cache/dem", "pipeline/cache/bayarea",
                "game/public/tracks", "game/public/textures", "store"):
        (root / rel).mkdir(parents=True)
    (root / "pipeline/sr/schema/slime-population.json").write_text('{"popper": 75}')
    (root / "pipeline/sr/schema/slime-shapes.json").write_text('{"flattening": .15}')
    (root / "pipeline/sr/menumap.py").write_bytes(generator_source)
    for name, data in {"coast": {"ways": [[[-123, 37.7], [-121, 37.7]]]},
                       "roads": {"ways": []}, "places": {"places": []}}.items():
        with gzip.open(root / f"pipeline/cache/bayarea/{name}.json.gz", "wt") as fh:
            json.dump(data, fh)
    (root / "pipeline/sr/build.py").write_text("# geometry\n")
    (root / "pipeline/sr/mesh.py").write_text("# shared geometry constants\n")
    (root / "pipeline/sr/textures.py").write_text("from sr import mesh\n# textures\n")
    (root / "pipeline/sr/cli.py").write_text("# command adapter\n")
    (root / "pipeline/sr/social_billboards.py").write_text("# independent sign generator\n")
    (root / "pipeline/sr/routes.py").write_bytes(Path(S.PIPELINE, "sr", "routes.py").read_bytes())
    (root / "pipeline/sr/landmark_data.py").write_bytes(
        Path(S.PIPELINE, "sr", "landmark_data.py").read_bytes())
    (root / "pipeline/routes/only.json").write_text(
        '{"id": "only", "landmarks": ["used"]}')
    (root / "pipeline/landmarks.json").write_text(json.dumps({"landmarks": [
        {"id": "used", "kind": "hangar", "heightM": 10},
        {"id": "elsewhere", "kind": "glb", "file": "elsewhere.glb"},
    ]}))
    (root / "pipeline/cache/only/roads.json.gz").write_bytes(b"osm")
    (root / "pipeline/cache/dem/tile.png").write_bytes(b"dem")
    monkeypatch.setattr(S, "ROOT", str(root))
    monkeypatch.setattr(S, "PIPELINE", str(root / "pipeline"))
    monkeypatch.setattr(S, "TRACKS", str(root / "game/public/tracks"))
    monkeypatch.setattr(S, "TEXTURES", str(root / "game/public/textures"))
    monkeypatch.setattr(S, "store_dir", lambda: str(root / "store"))
    monkeypatch.setattr(S, "track_ids", lambda: ["only"])
    return root


def write_products(root, track="only", tiles=("t_0_0", "t_1_0"), body=b"GLB"):
    d = root / "game/public/tracks" / track
    (d / "tiles").mkdir(parents=True, exist_ok=True)
    for name in tiles:
        (d / "tiles" / f"{name}.glb").write_bytes(body)
    (d / "track.json").write_text(json.dumps({"id": track, "origin": {"lat": 37.5, "lon": -122.1}, "spline": {"length": 100, "points": [[0, 0, 0], [100, 0, 0]]}, "tiles": [{"name": n} for n in tiles]}))


@pytest.fixture
def fake_build(repo, monkeypatch):
    """A build that writes what a build writes, and counts how often it was asked to."""
    calls = []

    def build(track, log=S.say):
        calls.append(track)
        write_products(repo, track, body=b"GLB" + str(len(calls)).encode())

    def textures(log=S.say):
        calls.append("textures")
        (repo / "game/public/textures/manifest.json").write_text("{}")

    monkeypatch.setattr(S, "build_track", build)
    monkeypatch.setattr(S, "build_textures", textures)
    return calls


def test_a_missing_product_is_not_fresh(repo):
    assert S.state("only", S.build_id("only")) == "missing"


def test_a_half_written_product_is_not_fresh(repo):
    # The index names two tiles and only one of them is there. Every "is the directory present"
    # check passes this; it is the shape a build interrupted halfway leaves behind.
    write_products(repo, tiles=("t_0_0", "t_1_0"))
    os.remove(repo / "game/public/tracks/only/tiles/t_1_0.glb")
    ident = S.build_id("only")
    (repo / "game/public/tracks/only/.build-id").write_text(ident)
    assert S.state("only", ident) == "missing"


def test_a_product_written_by_different_code_is_stale(repo):
    write_products(repo)
    ident = S.build_id("only")
    (repo / "game/public/tracks/only/.build-id").write_text(ident)
    assert S.state("only", ident) == "fresh"
    # The exact failure of: nothing about the files changed, the code that wrote them did.
    (repo / "pipeline/sr/build.py").write_text("# geometry, differently\n")
    assert S.state("only", S.build_id("only")) == "stale"


@pytest.mark.parametrize("what", ["pipeline/sr/schema/slime-population.json", "pipeline/sr/schema/slime-shapes.json", "pipeline/sr/build.py",
                                  "pipeline/cache/only/roads.json.gz", "pipeline/cache/bayarea/coast.json.gz"])
def test_every_input_moves_the_build_id(repo, what):
    before = S.build_id("only")
    (repo / what).write_bytes(b"changed")
    assert S.build_id("only") != before, what


def test_route_changes_move_the_build_id(repo):
    before = S.build_id("only")
    path = repo / "pipeline/routes/only.json"
    route = json.loads(path.read_text())
    route["padM"] = 123
    path.write_text(json.dumps(route))
    assert S.build_id("only") != before


def test_referenced_landmark_metadata_moves_the_build_id(repo):
    before = S.build_id("only")
    path = repo / "pipeline/landmarks.json"
    document = json.loads(path.read_text())
    document["landmarks"][0]["heightM"] = 11
    path.write_text(json.dumps(document))
    assert S.build_id("only") != before


def test_unreferenced_landmark_metadata_does_not_invalidate_the_track(repo):
    before = S.build_id("only")
    path = repo / "pipeline/landmarks.json"
    document = json.loads(path.read_text())
    document["landmarks"][1]["file"] = "different.glb"
    path.write_text(json.dumps(document))
    assert S.build_id("only") == before


def test_unrelated_generator_does_not_invalidate_maps_or_textures(repo):
    track_before = S.build_id("only")
    textures_before = S.textures_id()
    (repo / "pipeline/sr/social_billboards.py").write_text("# changed sign generator\n")
    assert S.build_id("only") == track_before
    assert S.textures_id() == textures_before


def test_imported_pipeline_source_invalidates_its_product(repo):
    (repo / "pipeline/sr/build.py").write_text("from sr import geometry_helper\n")
    helper = repo / "pipeline/sr/geometry_helper.py"
    helper.write_text("DETAIL = 1\n")
    before = S.build_id("only")
    helper.write_text("DETAIL = 2\n")
    assert S.build_id("only") != before


def test_texture_import_invalidates_atlases_without_invalidating_tracks(repo):
    track_before = S.build_id("only")
    textures_before = S.textures_id()
    (repo / "pipeline/sr/mesh.py").write_text("# changed UV constants\n")
    assert S.textures_id() != textures_before
    assert S.build_id("only") == track_before


def test_the_dem_cache_counts_by_size_not_by_bytes(repo):
    # 30 MB of elevation tiles that never change once downloaded: hashing their bytes on every check
    # would cost more than the check saves. Same size, same id -- and that is a deliberate trade.
    before = S.build_id("only")
    (repo / "pipeline/cache/dem/tile.png").write_bytes(b"DEM")
    assert S.build_id("only") == before
    (repo / "pipeline/cache/dem/tile.png").write_bytes(b"longer")
    assert S.build_id("only") != before


def test_ensure_builds_once_and_then_does_nothing(repo, fake_build):
    assert S.ensure_track("only", S.pipeline_id()) == "built"
    assert fake_build == ["only"]
    assert S.ensure_track("only", S.pipeline_id()) == "fresh"
    assert fake_build == ["only"], "a second run must not build anything"


def test_another_tree_restores_instead_of_building(repo, fake_build, tmp_path, monkeypatch):
    S.ensure_track("only", S.pipeline_id())
    other = tmp_path / "other-tree"
    (other / "tracks").mkdir(parents=True)
    monkeypatch.setattr(S, "TRACKS", str(other / "tracks"))
    what = S.ensure_track("only", S.pipeline_id())
    assert what.startswith("restored"), what
    assert fake_build == ["only"], "the second tree must not build what the first one already did"
    assert (other / "tracks/only/track.json").exists()


def test_a_stale_product_is_replaced_not_left_alone(repo, fake_build):
    write_products(repo, body=b"OLD")
    (repo / "game/public/tracks/only/.build-id").write_text("something-else")
    S.ensure_track("only", S.pipeline_id())
    assert fake_build == ["only"]
    assert S.state("only", S.build_id("only")) == "fresh"


def test_the_store_never_publishes_a_half_written_entry(repo, fake_build, monkeypatch):
    # `save` copies to a .partial name and renames: a copy that dies halfway must leave nothing a
    # later restore would treat as whole -- that is the "half built" failure moved into the store.
    #
    # The copy is actually interrupted here. Asserting only on the happy path passes just as loudly
    # with the staging removed, which is what the first version of this test did.
    ident = S.build_id("only")
    entry = os.path.join(S.store_dir(), "tracks/only", ident)
    real = S.clone

    def dies(src, dst):
        real(src, dst)
        raise OSError("disk went away mid-copy")

    monkeypatch.setattr(S, "clone", dies)
    with pytest.raises(OSError):
        S.ensure_track("only", S.pipeline_id())
    assert not os.path.isdir(entry), "a dead copy must not be published under its real name"

    monkeypatch.setattr(S, "clone", real)
    S.ensure_track("only", S.pipeline_id())
    assert os.path.isdir(entry) and os.path.isfile(os.path.join(entry, "track.json"))
    assert not any(name.endswith(".partial") for name in os.listdir(os.path.dirname(entry)))


def test_prune_keeps_the_newest_generations(repo, fake_build):
    for i in range(5):
        (repo / "pipeline/sr/build.py").write_text(f"# generation {i}\n")
        S.ensure_track("only", S.pipeline_id())
    kept = os.listdir(os.path.join(S.store_dir(), "tracks/only"))
    assert len(kept) == 5
    S.prune(keep=2)
    assert len(os.listdir(os.path.join(S.store_dir(), "tracks/only"))) == 2


def test_textures_follow_their_own_source(repo, fake_build):
    assert S.ensure_textures() == "built"
    assert S.ensure_textures() == "fresh"
    (repo / "pipeline/sr/textures.py").write_text("# different\n")
    assert S.ensure_textures() == "built"


def test_menu_map_follows_real_exported_geometry_and_is_not_rewritten_when_fresh(repo, fake_build):
    from argparse import Namespace
    args = Namespace(all=True, tracks="")
    assert S.cmd_ensure(args) == 0
    output, stamp = map(Path, S.menu_map_paths())
    before = json.loads(output.read_text())
    assert before["routes"][0]["km"] == .1
    mtime, stamp_time = output.stat().st_mtime_ns, stamp.stat().st_mtime_ns
    assert S.cmd_ensure(args) == 0
    assert (output.stat().st_mtime_ns, stamp.stat().st_mtime_ns) == (mtime, stamp_time)
    assert fake_build == ["textures", "only"]
    track = repo / "game/public/tracks/only/track.json"
    doc = json.loads(track.read_text())
    doc["spline"] = {"length": 500, "points": [[0, 0, 0], [500, 0, -100]]}
    track.write_text(json.dumps(doc))
    assert S.cmd_check(args) == 1
    assert S.cmd_ensure(args) == 0
    after = json.loads(output.read_text())
    assert after["routes"][0]["km"] == .5
    assert after["routes"][0]["line"][-1] != before["routes"][0]["line"][-1]
    assert fake_build == ["textures", "only"]
    assert S.cmd_check(args) == 0


def test_menu_map_tracks_added_and_removed_roster_entries_even_if_old_exports_remain(repo, monkeypatch):
    write_products(repo)
    assert S.ensure_menu_map() == "built"
    write_products(repo, "second")
    monkeypatch.setattr(S, "track_ids", lambda: ["only", "second", "synth-p2p"])
    assert S.ensure_menu_map() == "built"
    output = Path(S.menu_map_paths()[0])
    assert [r["id"] for r in json.loads(output.read_text())["routes"]] == ["only", "second"]
    monkeypatch.setattr(S, "track_ids", lambda: ["second"])
    assert S.ensure_menu_map() == "built"
    assert [r["id"] for r in json.loads(output.read_text())["routes"]] == ["second"]
    assert (repo / "game/public/tracks/only/track.json").exists()


@pytest.mark.parametrize("relative", ["pipeline/cache/bayarea/coast.json.gz",
    "pipeline/cache/bayarea/roads.json.gz", "pipeline/cache/bayarea/places.json.gz",
    "pipeline/sr/menumap.py", "game/public/tracks/only/map.json"])
def test_each_declared_menu_input_invalidates_freshness(repo, relative):
    write_products(repo)
    S.ensure_menu_map()
    old = S.menu_map_id(S.menu_map_module())
    path = repo / relative
    path.write_bytes(path.read_bytes() + b" " if path.exists() else b"{}")
    assert S.menu_map_id(S.menu_map_module()) != old
    assert S.menu_map_state(S.menu_map_id(S.menu_map_module())) == "stale"


def test_menu_generation_failure_preserves_last_good_output_and_never_marks_it_fresh(repo, monkeypatch):
    write_products(repo)
    S.ensure_menu_map()
    output, stamp = map(Path, S.menu_map_paths())
    before, previous_stamp = output.read_bytes(), stamp.read_bytes()
    track = repo / "game/public/tracks/only/track.json"
    track.write_text("broken")
    with pytest.raises(ValueError):
        S.ensure_menu_map()
    assert output.read_bytes() == before and stamp.read_bytes() == previous_stamp
    assert S.menu_map_state(S.menu_map_id(S.menu_map_module())) == "stale"


def test_modified_menu_output_is_repaired_from_the_generator(repo):
    write_products(repo)
    S.ensure_menu_map()
    output = Path(S.menu_map_paths()[0]); good = output.read_bytes()
    output.write_text("broken")
    assert S.ensure_menu_map() == "built"
    assert output.read_bytes() == good


def test_targeted_ensure_and_check_do_not_require_unselected_exports(repo, fake_build, monkeypatch):
    from argparse import Namespace
    (repo / "pipeline/routes/unbuilt.json").write_text('{"id":"unbuilt"}')
    monkeypatch.setattr(S, "track_ids", lambda: ["only", "unbuilt"])
    targeted = Namespace(all=False, tracks="only")
    assert S.cmd_ensure(targeted) == 0
    assert S.cmd_check(targeted) == 0
    assert fake_build == ["textures", "only"]
    assert not Path(S.menu_map_paths()[0]).exists()
    full = Namespace(all=True, tracks="")
    assert S.cmd_check(full) == 1
    assert S.cmd_ensure(full) == 0
    assert fake_build == ["textures", "only", "unbuilt"]
    assert S.cmd_check(full) == 0
    assert [r["id"] for r in json.loads(Path(S.menu_map_paths()[0]).read_text())["routes"]] == ["only", "unbuilt"]
