import numpy as np

from sr import register_landmark
from sr.geo import LocalFrame


def test_a_point_landmark_gets_its_measured_base_turned_by_its_yaw(monkeypatch):
    monkeypatch.setattr(register_landmark, "load_route", lambda _id: {"origin": {"lat": 30.0, "lon": 90.0}})
    frame = LocalFrame(30.0, 90.0)
    for yaw, (east, south) in ((0.0, (20.0, 10.0)), (90.0, (10.0, 20.0))):
        ring, _ = register_landmark.point_outline("any", 30.0, 90.0, 20.0, 10.0, yaw)
        x, z = frame.to_local(*np.asarray(ring).T)
        assert np.allclose([np.ptp(x), np.ptp(z)], [east, south], atol=0.05)
        assert np.allclose([x.mean(), z.mean()], 0.0, atol=3.0)    # centred on the point (closed ring repeats a corner)
