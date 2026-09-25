"""The ground comes back split by what it is made of, not as one flat green.

`sr.landcover` has answered "what is this patch" since it was written, and nothing asked:
the classifier existed, was tested, and no caller ever imported it, so every square metre outside
the road still wore one colour. These tests are about the wiring -- that `build_terrain` takes land
use, that each kind becomes its own mesh under its own material name, and that a route with no land
use at all still gets exactly one mesh called `terrain`.
"""
import numpy as np
from shapely.geometry import Polygon

from sr.terrain import build_terrain, corridor_polygon, road_profile
from tests.test_terrain import FakeDem, straight_route


def _built(cover=None):
    res = straight_route(length=400.0)
    dem = FakeDem(res.frame, lambda x, z: np.full_like(x, 5.0))
    road_y = road_profile(res, dem)
    return build_terrain(res, dem, road_y, corridor_polygon(res, 150.0), pad=150.0, cover=cover)


def test_without_land_use_the_ground_is_one_mesh_called_terrain():
    tr = _built()
    assert list(tr.covers) == ["terrain"]
    assert tr.covers["terrain"].material == "terrain"
    assert tr.terrain.triangle_count == tr.covers["terrain"].triangle_count


def test_each_kind_of_ground_becomes_its_own_mesh_under_its_own_material():
    # A wood on one side of the road and a car park on the other, both well clear of the tarmac.
    wood = Polygon([(-140, -140), (-40, -140), (-40, 140), (-140, 140)])
    paved = Polygon([(40, -140), (140, -140), (140, 140), (40, 140)])
    tr = _built([("terrain_wood", wood), ("terrain_paved", paved)])
    assert set(tr.covers) >= {"terrain_wood", "terrain_paved"}
    for name, mesh in tr.covers.items():
        assert mesh.material == name
    # Every triangle still there, and none of them in two meshes at once: the ground is split, not
    # duplicated -- a duplicate would z-fight with itself and double the collider.
    assert sum(m.triangle_count for m in tr.covers.values()) == tr.terrain.triangle_count


def test_the_split_follows_the_polygons_rather_than_the_road():
    wood = Polygon([(-140, -140), (-40, -140), (-40, 140), (-140, 140)])
    tr = _built([("terrain_wood", wood)])
    xs = tr.covers["terrain_wood"].positions[:, 0]
    assert xs.max() <= -30.0, "the woodland mesh must stay inside the woodland"
    plain = tr.covers["terrain"].positions[:, 0]
    assert plain.max() > 0.0, "and the unclassified ground must be the rest of it"


def test_the_backdrop_wears_the_same_cover_as_the_ground_it_continues():
    """From a high corner most of the picture is backdrop, not streamed tiles.

    Splitting only the near ground left the far hills one flat colour -- which is the half of
    「从空中或高处看一条赛道」 that matters most, and the half the first version of this missed.
    """
    from sr.backdrop import terrain as backdrop_terrain
    res = straight_route(length=1000.0)
    dem = FakeDem(res.frame, lambda x, z: np.full(np.shape(x), 25.0))
    wood = Polygon([(-3000, 400), (3000, 400), (3000, 3000), (-3000, 3000)])
    land, _ = backdrop_terrain(res, dem, 3000.0, 340.0, 0.0, [("terrain_wood", wood)])
    kinds = {m.material for m in land}
    assert "terrain_wood" in kinds, kinds
    assert "terrain" in kinds, "and ground the data says nothing about keeps the fallback"


def test_the_pipeline_actually_asks_for_the_cover():
    ""
    import glob
    import os
    import subprocess
    import sys

    import pygltflib
    import pytest as _pytest

    from sr.export import ROOT

    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import assets

    fresh = [t for t in assets.track_ids()
             if not t.startswith("synth") and assets.state(t, assets.build_id(t)) == "fresh"]
    if not fresh:
        _pytest.skip("no track in this tree was built by the current pipeline")
    kinds = {}
    for track in fresh:
        kinds[track] = set()
        for path in glob.glob(os.path.join(ROOT, "game", "public", "tracks", track, "tiles", "*.glb")):
            for node in pygltflib.GLTF2().load(path).nodes:
                if node.name.startswith("terrain"):
                    kinds[track].add(node.name)
    # A route can honestly be one cover: Paris runs through gardens and grass verges and its route declares
    # grass for the unmapped ground, and nothing paved or wooded is mapped along it. What must never happen
    # is the pipeline not asking at all -- then every route comes out in its default alone.
    mixed = [track for track, found in kinds.items() if len(found) > 1]
    assert len(mixed) * 2 >= len(kinds), f"the ground is one flat colour on most routes: {kinds}"


def test_a_bridge_support_the_elevation_reads_as_ground_is_sea():
    """A tower pier's concrete came out of the tiles a metre above the sea, and the
    terrain drew a strip of grass under the harbour bridge that the pier's own outline did not match."""
    from sr import landcover
    res = straight_route(length=400.0, bridge_span=(0.0, 400.0))
    hump = lambda x, z: np.where(np.hypot(x - 200.0, z - 10.0) < 15.0, 1.0, -20.0)
    dem = FakeDem(res.frame, hump)
    road_y = np.full(len(res.P), 60.0)

    def ground_near_pier(sea):
        tr = build_terrain(res, dem, road_y, corridor_polygon(res, 150.0), pad=150.0, sea=sea)
        centres = tr.terrain.positions[np.asarray(tr.terrain.indices).reshape(-1, 3)].mean(axis=1)
        return int((np.hypot(centres[:, 0] - 200.0, centres[:, 2] - 10.0) < 20.0).sum())

    assert ground_near_pier(None) > 0
    pier = Polygon([(190, 0), (210, 0), (210, 20), (190, 20)]).buffer(landcover.SUPPORT_MARGIN)
    assert ground_near_pier([pier]) == 0


def test_only_mapped_bridge_supports_become_sea(monkeypatch):
    ""
    from shapely.geometry import Polygon
    from sr import landcover
    from sr.geo import LocalFrame
    from sr.routes import load_route

    route = load_route("sydney")
    frame = LocalFrame(route["origin"]["lat"], route["origin"]["lon"])
    lat0, lon0 = route["origin"]["lat"] + 0.0015, route["origin"]["lon"] + 0.0004
    ring = [(lat0, lon0), (lat0 + 0.0001, lon0), (lat0 + 0.0001, lon0 + 0.0001),
            (lat0, lon0 + 0.0001), (lat0, lon0)]
    element = {"type": "way", "tags": {"bridge:support": "pier"},
               "geometry": [{"lat": la, "lon": lo} for la, lo in ring]}
    monkeypatch.setattr(landcover, "load_layer",
                        lambda route_id, layer: {"elements": [element]} if (route_id, layer) == ("sydney", "landuse")
                        else (_ for _ in ()).throw(AssertionError((route_id, layer))))

    supports = landcover.bridge_supports("sydney", frame)
    x, z = frame.to_local([p[0] for p in ring], [p[1] for p in ring])
    expected = Polygon(zip(x, z)).buffer(landcover.SUPPORT_MARGIN)
    assert len(supports) == 1
    assert supports[0].equals(expected)
