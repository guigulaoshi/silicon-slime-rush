import numpy as np
from shapely.geometry import Point

from sr.bare_earth import CELL, _level_pad


def _slope():
    gx = np.arange(-100, 100 + CELL, CELL)
    X, Z = np.meshgrid(gx, gx, indexing="ij")
    return X, Z, 30.0 + X * 0.05          # a gentle slope, 30 m at the centre


def test_a_pad_levels_to_the_ground_round_it():
    X, Z, grid = _slope()
    out = _level_pad(grid, Point(0, 0).buffer(30), X, Z, water_level=0.0)
    centre = out[np.hypot(X, Z) < 20]
    assert np.ptp(centre) < 1e-6 and abs(centre.mean() - 30.0) < 0.5


def test_a_declared_height_sinks_a_pit_the_data_cannot_see():
    X, Z, grid = _slope()
    out = _level_pad(grid, Point(0, 0).buffer(30), X, Z, 0.0, level=20.0, ramp=10.0)
    r = np.hypot(X, Z)
    assert np.allclose(out[r < 25], 20.0)                  # the pit floor is at the declared height
    assert np.allclose(out[r > 45], grid[r > 45])          # the ground past the short ramp is untouched


def test_towers_smeared_roofs_come_down_but_a_real_hill_stays():
    from sr.bare_earth import bare
    gx = np.arange(-300, 300 + CELL, CELL)
    X, Z = np.meshgrid(gx, gx, indexing="ij")
    hill = 40.0 * np.exp(-((X + 150) ** 2 + Z ** 2) / (2 * 90.0 ** 2))       # a broad real hill, west
    tower = 70.0 * np.exp(-((X - 150) ** 2 + Z ** 2) / (2 * 18.0 ** 2))      # a smeared 70 m roof, east
    h = 10.0 + hill + tower
    towers = np.hypot(X - 150, Z) < 12
    out = bare(h, towers.copy(), towers=towers)
    assert out[np.hypot(X - 150, Z) < 30].max() < 10.0 + 6.0                 # the mound is gone
    west = np.hypot(X + 150, Z) < 60
    assert np.allclose(out[west], h[west])                                   # the hill is untouched
    assert (out <= h + 1e-9).all()                                           # nothing is raised


def test_a_long_viaduct_away_from_the_race_is_floating_but_a_short_bridge_or_the_race_deck_is_not():
    from types import SimpleNamespace
    from scipy.spatial import cKDTree
    from sr.roads import floating_bridge
    race = cKDTree(np.c_[np.arange(0, 500, 5.0), np.zeros(100)])
    way = lambda xy, bridge=True: SimpleNamespace(bridge=bridge, xy=np.asarray(xy, dtype=float))
    assert floating_bridge(way([[0, 80], [200, 80]]), race)                  # 200 m, 80 m off the race
    assert not floating_bridge(way([[0, 80], [40, 80]]), race)               # a short bridge still draws
    assert not floating_bridge(way([[0, 5], [200, 5]]), race)                # the race's own deck
    assert not floating_bridge(way([[0, 80], [200, 80]], bridge=False), race)
