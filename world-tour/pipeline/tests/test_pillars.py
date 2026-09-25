"""Sandstone pillar fields (sr/pillars.py): where they stand and that they are solid from outside."""
import numpy as np
from types import SimpleNamespace

from sr import pillars
from sr.mesh import geometric_normals


class Frame:
    """Local metres are 'latitude/longitude' here: the sampler below reads them straight back."""
    def to_latlon(self, x, z):
        return np.asarray(x, dtype=float), np.asarray(z, dtype=float)

    def to_local(self, lat, lon):
        return np.asarray(lat, dtype=float), np.asarray(lon, dtype=float)


class Gorge:
    """A plateau at 1000 m with a 300 m deep gorge where x > 400."""
    def heights(self, lat, lon):
        x = np.asarray(lat, dtype=float)
        return np.where(x > 400, 700.0, 1000.0)


def _res():
    z = np.linspace(-1000, 1000, 400)
    return SimpleNamespace(P=np.c_[np.zeros_like(z), np.zeros_like(z), z], frame=Frame())


def _spec(**extra):
    return {"pillarField": {"seed": 3, "radiusM": 1500, "clearM": 90, "spacingM": 60, "dropM": 70, "max": 80,
                            **extra}}


def test_pillars_stand_only_in_the_gorge_and_off_the_road():
    out = pillars.build(_res(), _spec(), Gorge())
    rock = out["backdrop_pillars_rock"]
    assert rock.material == "rock_sandstone" and out["backdrop_pillars_crown"].material == "foliage_dark"
    P = rock.positions
    above = P[P[:, 1] > 900]
    # every shaft that rises above the plateau stands in the gorge, well clear of the road at x = 0
    assert len(above) and above[:, 0].min() > 400 - 40
    # tops reach back up to about the plateau they were cut from
    assert 1000 - 60 < P[:, 1].max() < 1000 + 80


def test_no_gorge_no_pillars_and_no_field_no_pillars():
    class Flat:
        def heights(self, lat, lon):
            return np.full(np.shape(lat), 1000.0)
    assert pillars.build(_res(), _spec(), Flat()) == {}
    assert pillars.build(_res(), {}, Gorge()) == {}


def test_named_pillar_stands_where_it_is_named_at_its_height():
    spec = _spec(max=1, named=[{"lat": 900.0, "lon": 300.0, "heightM": 150, "radiusM": 16}])
    rock = pillars.build(_res(), spec, Gorge())["backdrop_pillars_rock"]
    P = rock.positions
    near = P[np.hypot(P[:, 0] - 900, P[:, 2] - 300) < 60]
    assert len(near)
    assert 700 + 150 - 12 < near[:, 1].max() <= 700 + 150


def test_the_near_stand_rises_clear_of_the_road():
    spec = _spec(max=30, nearMax=10, nearM=600)
    P = pillars.build(_res(), spec, Gorge())["backdrop_pillars_rock"].positions
    close = P[(np.abs(P[:, 0]) < 600) & (np.abs(P[:, 0]) > 90)]
    assert len(close) and close[:, 1].max() > 1000 + 60


def _faces_out(mesh):
    tris = mesh.indices.reshape(-1, 3)
    n = geometric_normals(mesh.positions, tris)
    mid = mesh.positions[tris].mean(axis=1)
    side = np.abs(n[:, 1]) < .5 * np.linalg.norm(n, axis=1)
    out = np.einsum("ij,ij->i", n[side][:, [0, 2]], mid[side][:, [0, 2]])
    assert (out > 0).mean() > .97


def test_walls_face_out():
    """Backface culling draws a triangle only from the side its winding faces: a wall wound inward
    is not dark, it is missing, and the sky shows through the pillar."""
    for near in (True, False):
        # one shaft, measured from its own axis (a clump's other shafts and the pines have theirs)
        rock, crown = pillars._shaft(np.random.default_rng(0), 0.0, 0.0, 100.0, 120.0, 15.0, near)
        _faces_out(rock)
        if not near:
            _faces_out(crown)


def test_no_pillar_stands_on_a_drawn_side_road():
    """Review of a46dc693: a 200 m pillar stood across a side street 160 m off the race road, which
    only the race road's distance kept clear of. `keep_clear` is every drawn road's footprint."""
    from shapely.geometry import LineString
    street = LineString([(420, -4000), (420, 4000)]).buffer(6.0)     # runs down the gorge floor
    plain = pillars.build(_res(), _spec(max=200), Gorge())["backdrop_pillars_rock"].positions
    assert (np.abs(plain[:, 0] - 420) < 6).any()                     # without it, the street is built on
    kept = pillars.build(_res(), _spec(max=200), Gorge(), keep_clear=street)["backdrop_pillars_rock"].positions
    assert not (np.abs(kept[:, 0] - 420) < 6).any()



def test_the_green_on_top_stays_over_the_rock():
    # A player: -- pines were placed by the shaft's nominal
    # radius and stood in thin air past the narrow side of the top; the crown overhung the rim.
    import numpy as np
    from shapely.geometry import MultiPoint, Point
    from sr.pillars import _shaft
    for seed in range(60):
        rng = np.random.default_rng(seed)
        rock, crown = _shaft(rng, 0.0, 0.0, 100.0, float(rng.uniform(120, 260)), float(rng.uniform(9, 28)), True)
        top = rock.positions[:, 1].max()
        rim = MultiPoint([tuple(p) for p in rock.positions[rock.positions[:, 1] >= top - .01][:, [0, 2]]]).convex_hull
        high = crown.positions[crown.positions[:, 1] > top - .01]
        outside = [p for p in high[:, [0, 2]] if not rim.buffer(.3).contains(Point(p))]
        assert not outside, f"seed {seed}: {len(outside)} crown points past the rim"
