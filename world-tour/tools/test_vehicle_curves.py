"""Exercise the builders' pure profile math without requiring Blender in the gate."""
import ast
from pathlib import Path

import pytest

SOURCE = Path(__file__).resolve().parents[1] / 'assets-src/vehicles/common.py'


def functions():
    tree = ast.parse(SOURCE.read_text())
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                and node.name in {'curve_stations', 'round_section'}]
    assert len(selected) == 2
    scope = {}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), 'exec'), scope)
    return scope


def test_stations_keep_knots_and_stay_within_each_authored_envelope():
    stations = [(-2, .4, .5, .6), (-1.7, .9, .8, .9), (0, 1, .8, 1),
                (.8, .8, .6, 1), (2, .4, .5, .6)]
    result = functions()['curve_stations'](stations)
    assert len(result) == 17
    assert result[::4] == [list(row) for row in stations[:-1]] + [stations[-1]]
    for i, (left, right) in enumerate(zip(stations, stations[1:])):
        for row in result[i * 4:(i + 1) * 4]:
            for axis in range(4):
                assert min(left[axis], right[axis]) - 1e-9 <= row[axis] <= max(left[axis], right[axis]) + 1e-9
    assert all(a[0] < b[0] for a, b in zip(result, result[1:]))


@pytest.mark.parametrize('fraction', [.04, .07, .18])
def test_local_rounding_keeps_profile_plane_and_does_not_expand_shell(fraction):
    points = [(-1, 0, 3), (1, 0, 3), (1, 1, 3), (-1, 1, 3)]
    result = functions()['round_section'](points, fraction)
    assert len(result) == 16
    for x, y, z in result:
        assert -1 <= x <= 1
        assert 0 <= y <= 1
        assert z == pytest.approx(3)
    # Flat panel lengths survive between the rounded corner arcs.
    assert result[3] == pytest.approx((-1 + 2 * fraction, 0, 3))
    assert result[4] == pytest.approx((1 - 2 * fraction, 0, 3))
