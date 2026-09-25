import numpy as np
import pytest

from sr.mesh import yaw_for_x_axis, yaw_for_z_axis


def test_axis_yaws_follow_the_same_convention_as_boxes_gltf_and_threejs():
    directions = ([1.0, 0.0], [0.0, 1.0], [0.6, -0.8], [-0.3, 0.0, 0.4])
    for direction in directions:
        d = np.asarray(direction, dtype=float)
        xz = d if len(d) == 2 else d[[0, 2]]
        xz /= np.linalg.norm(xz)

        yaw_x = yaw_for_x_axis(direction)
        assert np.allclose([np.cos(yaw_x), -np.sin(yaw_x)], xz)

        yaw_z = yaw_for_z_axis(direction)
        assert np.allclose([np.sin(yaw_z), np.cos(yaw_z)], xz)


def test_axis_yaws_reject_a_direction_that_cannot_define_an_orientation():
    with pytest.raises(ValueError, match="zero direction"):
        yaw_for_x_axis([0.0, 0.0])
    with pytest.raises(ValueError, match="zero direction"):
        yaw_for_z_axis([0.0, 0.0, 0.0])
