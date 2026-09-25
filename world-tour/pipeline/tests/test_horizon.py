import math
import os
import numpy as np
import pytest
from shapely.geometry import Point, Polygon
from sr import horizon
from sr.dem import DemSampler
from sr.geo import LocalFrame
from tests.test_terrain import FakeDem, straight_route


def test_distant_sea_is_read_from_the_elevation_not_a_bay_area_coastline():
    """The sea is where the bathymetry reads below zero; land at 0 m stays land when it is ground."""
    res = straight_route(1000)
    # North of z = 4000 is sea (-30 m), with a 3 km island (+20 m) in it; south of -5000 is hills.
    def height(x, z):
        island = (np.abs(x) < 1500) & (np.abs(z - 12000) < 1500)
        return np.where(z > 4000, np.where(island, 20.0, -30.0), np.where(z < -5000, 600 + x * .01, 5.0))
    dem = FakeDem(res.frame, height)
    meshes = horizon.build(res, dem, 3000)
    land = meshes['backdrop_horizon_land']; water = meshes['backdrop_horizon_water']
    assert land.positions[:, 1].max() > 800
    assert np.abs(land.positions[:, 2]).max() >= horizon.RADIUS * .98
    assert np.allclose(water.positions[:, 1], 0)
    wet = [Polygon(water.positions[t][:, [0, 2]]) for t in water.indices.reshape(-1, 3)]
    dry = [Polygon(land.positions[t][:, [0, 2]]) for t in land.indices.reshape(-1, 3)]
    assert any(p.buffer(.02).covers(Point(0, 20000)) for p in wet)
    assert any(p.buffer(.02).covers(Point(0, 12000)) for p in dry), "the island must stay land"
    assert any(p.buffer(.02).covers(Point(0, -4000)) for p in dry)


def test_tiles_that_were_never_downloaded_are_not_sea():
    res = straight_route(1000)
    dem = FakeDem(res.frame, lambda x, z: np.where(z > 4000, 0.0, 50.0))
    dem.known = lambda lat, lon: np.zeros(np.shape(lat), dtype=bool) | (np.asarray(lat) < -999)
    meshes = horizon.build(res, dem, 3000)
    assert 'backdrop_horizon_water' not in meshes


def test_a_declared_peak_widens_the_horizon_and_gets_its_summit_back():
    res = straight_route(1000)
    frame = res.frame
    lat, lon = frame.to_latlon(np.array([0.0]), np.array([-45000.0]))
    res.route = {"origin": {"lat": frame.lat, "lon": frame.lon}, "waypoints": [],
                 "distantPeaks": [{"name": "volcano", "lat": float(lat[0]), "lon": float(lon[0]),
                                   "heightM": 5800.0, "snowlineM": 5000.0}]}
    assert horizon.radius_for(res.route, frame) >= 45000 + horizon.PEAK_MARGIN - 1
    # A cone that the data flattens: it reads 5500 m at the top instead of 5800.
    dem = FakeDem(frame, lambda x, z: np.maximum(0, 5500 - 0.25 * np.hypot(x, z + 45000)))
    meshes = horizon.build(res, dem, 3000)
    snow = meshes['backdrop_horizon_snow']
    assert snow.positions[:, 1].max() >= 5800 - 1
    assert snow.positions[:, 1].min() >= 5000 - 400


def test_required_dem_rejects_missing_tile_while_legacy_sampling_keeps_its_fallback(monkeypatch, tmp_path):
    import sr.dem as dem
    monkeypatch.setattr(dem, 'tile_path', lambda *args: str(tmp_path / 'missing.png'))
    with pytest.raises(FileNotFoundError, match='missing required elevation tile'):
        DemSampler(12, require_complete=True).height(37.33, -122.01)
    assert DemSampler(12).height(37.33, -122.01) == 0
    assert not DemSampler(12).known(np.array([37.33]), np.array([-122.01]))[0]
