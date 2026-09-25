import numpy as np

from sr.geom import curvature, polyline_length, project, resample, rights, tangents


def square(side=100.0):
    return np.array([[0, 0, 0], [side, 0, 0], [side, 0, side], [0, 0, side]], dtype=float)


def test_resample_open_keeps_endpoints_and_step():
    P, S = resample([[0, 0, 0], [10, 0, 0]], step=2.0)
    assert np.allclose(P[0], [0, 0, 0]) and np.allclose(P[-1], [10, 0, 0])
    assert np.allclose(np.diff(S), 2.0)


def test_resample_closed_has_no_duplicate_end():
    P, S = resample(square(), step=2.0, closed=True)
    assert len(P) == 200 and not np.allclose(P[0], P[-1])
    assert abs(polyline_length(square(), closed=True) - 400) < 1e-9


def test_tangents_and_rights_right_handed():
    P, S = resample([[0, 0, 0], [10, 0, 0]], step=1.0)
    T = tangents(P); R = rights(T)
    assert np.allclose(T[3], [1, 0, 0])
    assert np.allclose(R[3], [0, 0, 1])  # facing east, right is south (+z)


def test_curvature_of_circle():
    t = np.linspace(0, 2 * np.pi, 400, endpoint=False)
    circ = np.stack([50 * np.cos(t), np.zeros_like(t), 50 * np.sin(t)], axis=1)
    P, S = resample(circ, 1.0, closed=True)
    k = curvature(P, S, closed=True)
    assert np.allclose(k[10:-10], 1 / 50, atol=2e-3)


def test_project_returns_s_and_signed_lateral():
    P, S = resample([[0, 0, 0], [100, 0, 0]], step=2.0)
    s, lat, i = project(P, S, 40.0, 3.0)
    assert abs(s - 40) < 1e-6 and abs(lat - 3.0) < 1e-6  # +z is the right-hand side when heading east
    s, lat, i = project(P, S, 40.0, -3.0)
    assert abs(lat + 3.0) < 1e-6


def test_project_with_hint_ignores_far_segments():
    # two parallel legs 10 m apart, like a hairpin: with a hint on leg one a point nearer leg two still snaps to leg one
    leg1 = np.stack([np.arange(0, 200, 2.0), np.zeros(100), np.zeros(100)], axis=1)
    leg2 = np.stack([np.arange(200, 0, -2.0), np.zeros(100), np.full(100, 10.0)], axis=1)
    P = np.vstack([leg1, leg2]); S = np.arange(len(P)) * 2.0
    s_far, _, _ = project(P, S, 100.0, 7.0)
    s_hint, _, _ = project(P, S, 100.0, 7.0, hint=50, window=20)
    assert s_far > 200 and s_hint < 200


def test_grid_chunks_keep_the_exact_lattice_without_the_whole_bounding_rectangle():
    from sr.geom import grid_chunks
    lo, hi, step = [-41, -65], [202, 188], 7
    chunks = list(grid_chunks(lo, hi, step, max_points=200))
    expected = np.stack(np.meshgrid(np.arange(lo[0], hi[0] + step, step),
                       np.arange(lo[1], hi[1] + step, step), indexing="ij"), axis=-1).reshape(-1, 2)
    assert len(chunks) > 1 and max(map(len, chunks)) <= 200
    np.testing.assert_array_equal(np.vstack(chunks), expected)
