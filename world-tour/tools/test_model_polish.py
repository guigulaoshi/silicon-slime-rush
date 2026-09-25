"""Check authored model geometry without launching Blender or rebuilding maps."""
import ast
import math
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def geometry_function(file, name):
    calls = []
    def mesh(label, vertices, faces, *args):
        calls.append((vertices, faces))
    source = ROOT / file
    function = next(node for node in ast.parse(source.read_text()).body
                    if isinstance(node, ast.FunctionDef) and node.name == name)
    scope = {'math': math, 'mesh': mesh}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), scope)
    return scope[name], calls


def assert_closed_nonzero(vertices, faces):
    edges = Counter()
    for face in faces:
        assert len(set(face)) == len(face)
        for a, b in zip(face, face[1:] + face[:1]):
            assert math.dist(vertices[a], vertices[b]) > 1e-8
            edges[tuple(sorted((a, b)))] += 1
    assert set(edges.values()) == {2}
    assert all(math.isfinite(value) for point in vertices for value in point)


# DELETED: test_bevelled_wing_is_closed_and_stays_inside_
# authored_planform_bounds and test_wide_aircraft_window_stays_outside_the_faceted_hull_between_its_
# corners, both against assets-src/landmarks/build_moffett_aircraft.py's wing()/glazing() -- the
# Moffett display aircraft are a deleted feature (their source is slated for removal separately).
# wheel_fasteners below is unrelated: it is generic vehicle geometry shared by every car in every city.
@pytest.mark.parametrize('sign', [-1, 1])
@pytest.mark.parametrize('axis', ['x', 'z'])
def test_wheel_fasteners_are_closed_and_recessed_inside_wheel_face(sign, axis):
    build, calls = geometry_function('assets-src/vehicles/common.py', 'wheel_fasteners')
    build(None, .24, sign*.08, sign, None, axis)
    vertices, faces = calls[0]
    assert_closed_nonzero(vertices, faces)
    axial = 0 if axis == 'x' else 2
    for vertex in vertices:
        assert .067 <= sign*vertex[axial] <= .08
        radius = math.hypot(vertex[1], vertex[2 if axis == 'x' else 0])
        assert radius < .24*.35
