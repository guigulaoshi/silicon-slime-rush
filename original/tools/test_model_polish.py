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


@pytest.mark.parametrize('sign', [-1, 1])
def test_bevelled_wing_is_closed_and_stays_inside_authored_planform_bounds(sign):
    wing, calls = geometry_function('assets-src/landmarks/build_moffett_aircraft.py', 'wing')
    outline = [(sign*.72, -.8), (sign*2, -.35), (sign*5.95, 2.55),
               (sign*5.95, 4.38), (sign*1, 3.85)]
    wing('Wing', outline, 1.97, .18)
    vertices, faces = calls[0]
    assert_closed_nonzero(vertices, faces)
    assert min(v[1] for v in vertices) == pytest.approx(1.97)
    assert max(v[1] for v in vertices) == pytest.approx(2.15)
    for x, _, z in vertices:
        assert min(p[0] for p in outline)-1e-9 <= x <= max(p[0] for p in outline)+1e-9
        assert min(p[1] for p in outline)-1e-9 <= z <= max(p[1] for p in outline)+1e-9


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


def test_wide_aircraft_window_stays_outside_the_faceted_hull_between_its_corners():
    build, calls = geometry_function('assets-src/landmarks/build_moffett_aircraft.py', 'glazing')
    build('Cockpit', [(0,0,1,1,0),(2,0,1,1,0)], [.1,1.9], [20,78], sides=16)
    for vertices, faces in calls:
        assert_closed_nonzero(vertices, faces)
        # The first four vertices bound the visible outer pane. Its centre must
        # clear the hull too; checking only lifted corners misses buried glass.
        x = sum(p[0] for p in vertices[:4])/4
        y = sum(p[1] for p in vertices[:4])/4
        angle = math.atan2(y,x)
        step = math.tau/16
        relative = angle % step-step/2
        hull_radius = math.cos(step/2)/math.cos(relative)
        assert math.hypot(x,y) > hull_radius+.005
