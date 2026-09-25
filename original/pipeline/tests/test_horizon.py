import os
import numpy as np
import pytest
from shapely.geometry import Point, Polygon, box
from sr import horizon
from sr.dem import DemSampler
from sr.geo import LocalFrame
from sr.menumap import REGION_CACHE
from tests.test_terrain import FakeDem, straight_route


def test_distant_meshes_cover_real_relief_and_cut_water_by_shape_not_zero_height(monkeypatch):
    res = straight_route(1000)
    sea = box(-40000, 4000, 40000, 40000).difference(box(-200, 6000, 200, 6400))
    monkeypatch.setattr(horizon, 'coastal_water', lambda *_: sea)
    dem = FakeDem(res.frame, lambda x, z: np.where(z < -5000, 600 + x * .01, 0))
    meshes = horizon.build(res, dem, 3000)
    land = meshes['backdrop_horizon_land']; water = meshes['backdrop_horizon_water']
    assert land.positions[:, 1].max() > 800
    assert np.abs(land.positions[:, 2]).max() >= horizon.RADIUS * .98
    assert len(land.indices) > 0 and len(water.indices) > 0
    assert np.allclose(water.positions[:, 1], 0)
    for mesh, shape in [(water, sea)]:
        for tri in mesh.indices.reshape(-1, 3):
            footprint = Polygon(mesh.positions[tri][:, [0, 2]])
            assert footprint.difference(shape.buffer(.02)).area < .05
    # Zero-elevation ground outside the shoreline stays land, and the island is not flooded.
    footprints = [Polygon(land.positions[t][:, [0, 2]]) for t in land.indices.reshape(-1, 3)]
    assert any(p.buffer(.02).covers(Point(0, -4000)) for p in footprints)
    assert any(p.buffer(.02).covers(Point(0, 6200)) for p in footprints)
    assert not any(p.contains(Point(500, 0)) for p in footprints)


def test_required_dem_rejects_missing_tile_while_legacy_sampling_keeps_its_fallback(monkeypatch, tmp_path):
    import sr.dem as dem
    monkeypatch.setattr(dem, 'tile_path', lambda *args: str(tmp_path / 'missing.png'))
    with pytest.raises(FileNotFoundError, match='missing required elevation tile'):
        DemSampler(12, require_complete=True).height(37.33, -122.01)
    assert DemSampler(12).height(37.33, -122.01) == 0


@pytest.mark.skipif(not os.path.exists(REGION_CACHE), reason='requires regional coastline cache')
def test_real_bay_shoreline_keeps_cupertino_dry_and_alcatraz_an_island():
    frame = LocalFrame(37.75, -122.25)
    sea = horizon.coastal_water(frame, (-45000, -45000, 45000, 85000))
    def wet(lat, lon):
        x, z = frame.to_local(lat, lon)
        return sea.covers(Point(float(x), float(z)))
    assert wet(37.72, -122.30)  # existing menu-map Bay centre control
    assert wet(37.815, -122.42)
    assert not wet(37.3349, -122.009)
    assert not wet(37.8266, -122.423)
