import numpy as np
import pytest

from sr.bridge import (BRACE_HALF_Y, CLEAR, MATERIAL, PORTAL_CLEAR, TRUSS_HALF, TRUSS_TOP_CLEAR,
                       cable_height, stiffening_truss, suspension, tube, yaw_across)
from sr.roads import ROAD_LIFT

HEADROOM = 5.0    # the height a road has to be clear to, well over any car in the garage
from tests.test_terrain import straight_route


def test_portal_yaw_puts_its_long_axis_across_the_road():
    """Golden Gate's portal joins its two legs; it never projects forward over the traffic."""
    for right in (np.array([1.0, 0.0, 0.0]), np.array([0.6, 0.0, -0.8])):
        yaw = yaw_across(right)
        local_x_in_world = np.array([np.cos(yaw), 0.0, -np.sin(yaw)])
        assert np.allclose(local_x_in_world, right)


def bridged(length=2400.0, half_width=13.0, span=(200.0, 2200.0)):
    res = straight_route(length=length, half_width=half_width, bridge_span=span)
    return res


SPEC = {"towers": None, "towerAboveDeckM": 160.0, "midCableAboveDeckM": 3.0,
        "anchorAboveDeckM": 0.8, "suspenderStepM": 15.0, "trussDepthM": 7.6,
        "sideSpanM": 343.0, "pierStepM": 60.0}


def spec_for(res, s_a, s_b):
    """Tower positions are given as lat/lon, so convert two arc lengths back into coordinates."""
    out = dict(SPEC)
    towers = []
    for s in (s_a, s_b):
        i = int(np.argmin(np.abs(res.S - s)))
        lat, lon = res.frame.to_latlon(np.array([res.P[i, 0]]), np.array([res.P[i, 2]]))
        towers.append([float(lat[0]), float(lon[0])])
    out["towers"] = towers
    return out


def test_the_cable_touches_the_deck_at_mid_span_and_peaks_at_the_towers():
    S = np.linspace(0, 2000, 401)
    h = cable_height(S, (300.0, 1700.0), (0.0, 2000.0), 160.0, 3.0, 0.5)
    assert h[np.argmin(np.abs(S - 1000))] == pytest.approx(3.0, abs=0.1)
    assert h[np.argmin(np.abs(S - 300))] == pytest.approx(160.0, abs=0.5)
    assert h[np.argmin(np.abs(S - 1700))] == pytest.approx(160.0, abs=0.5)
    assert h[0] == pytest.approx(0.5) and h[-1] == pytest.approx(0.5)


def test_the_cable_falls_away_from_each_tower_in_both_directions():
    S = np.linspace(0, 2000, 401)
    h = cable_height(S, (300.0, 1700.0), (0.0, 2000.0), 160.0, 3.0, 0.5)
    main = (S > 300) & (S < 1000)
    assert np.all(np.diff(h[main]) < 0), "downhill from the south tower to mid-span"
    side = (S > 0) & (S < 300)
    assert np.all(np.diff(h[side]) > 0), "uphill from the anchorage to the tower"


def test_a_tube_follows_a_slope_instead_of_stepping_down_it():
    """Yawed boxes cannot pitch, and near the towers the cable climbs about as fast as it runs: the
    first version came out as a visible staircase."""
    pts = np.stack([np.linspace(0, 100, 11), np.linspace(0, 100, 11), np.zeros(11)], axis=1)
    m = tube(pts, 0.5)
    assert m is not None and m.triangle_count == 8 * 10
    # every vertex sits within half a metre of the line it was swept along
    d = np.abs(m.positions[:, 0] - m.positions[:, 1])
    assert d.max() < 1.5, d.max()
    assert np.allclose(np.linalg.norm(m.normals, axis=1), 1.0)


def test_suspension_uses_round_main_cables_and_suspender_rods(monkeypatch):
    from sr import bridge

    res = bridged()
    original = bridge.tube
    seen = []

    def record(points, half, material=MATERIAL, sides=4):
        seen.append(sides)
        return original(points, half, material, sides)

    monkeypatch.setattr(bridge, "tube", record)
    spec = spec_for(res, 700.0, 1700.0)
    bridge.suspension(res, np.full(len(res.P), 60.0), spec)
    assert seen.count(8) == 2, "one octagonal main cable on each side of the deck"
    assert seen.count(4) == 4, "two square truss chords on each side"

    bridge_s = res.S[res.bridge]
    hung = (max(float(bridge_s[0]), 700.0 - spec["sideSpanM"]),
            min(float(bridge_s[-1]), 1700.0 + spec["sideSpanM"]))
    cable = cable_height(res.S, (700.0, 1700.0), hung, spec["towerAboveDeckM"],
                         spec["midCableAboveDeckM"], spec["anchorAboveDeckM"])
    per_side = sum(
        cable[min(np.searchsorted(res.S, s), len(res.S) - 1)] >= 2.5
        for s in np.arange(hung[0] + spec["suspenderStepM"], hung[1],
                           spec["suspenderStepM"])
    )
    assert seen.count(6) == 2 * per_side, (
        "every eligible suspender position must have one round rod on each side")


def test_a_tube_of_one_point_is_nothing_rather_than_a_crash():
    assert tube(np.zeros((1, 3)), 0.5) is None


def test_no_ironwork_without_a_spec_or_without_a_bridge():
    res = bridged()
    assert suspension(res, np.full(len(res.P), 60.0), None) is None
    plain = straight_route(length=600.0)
    assert suspension(plain, np.full(len(plain.P), 60.0), spec_for(plain, 100.0, 400.0)) is None


def test_the_ironwork_stands_clear_of_the_roadway():
    """Nothing may sit in the space a car drives through: cables and towers stand outside the
    painted edge, the portal brace is high enough to drive under, the truss hangs below."""
    res = bridged()
    road_y = np.full(len(res.P), 60.0)
    mesh = suspension(res, road_y, spec_for(res, 700.0, 1700.0))
    assert mesh is not None and mesh.material == MATERIAL
    P = mesh.positions
    lateral = np.abs(P[:, 2])                      # the route runs along +x, so z is lateral
    edge = float(res.half_width[0]) + CLEAR
    assert PORTAL_CLEAR - BRACE_HALF_Y >= HEADROOM, "the portal brace hangs too low"
    in_envelope = (P[:, 1] > 59.8) & (P[:, 1] < 60.0 + HEADROOM)
    assert not np.any(in_envelope & (lateral < edge - 0.5)), "something is standing in the road"


def test_the_stiffening_truss_hangs_below_the_driving_surface():
    ""
    n = 40
    line = np.stack([np.arange(n, dtype=float) * 10.0, np.zeros(n), np.full(n, 15.0)], axis=1)
    deck = np.full(n, 60.0)
    tubes = [t for t in stiffening_truss(line, deck, 7.6) if t is not None]
    assert len(tubes) == 2, "the truss is an upper and a lower chord"
    top = max(float(t.positions[:, 1].max()) for t in tubes)
    surface = 60.0 + ROAD_LIFT
    assert top <= surface - TRUSS_TOP_CLEAR, (
        "the truss reaches %.3f m, the road surface is at %.3f m" % (top, surface))
    assert top >= surface - TRUSS_TOP_CLEAR - 2 * TRUSS_HALF, "hung so low it is not a truss any more"


def test_no_ironwork_skims_the_road_surface():
    ""
    res = bridged()
    road_y = np.full(len(res.P), 60.0)
    mesh = suspension(res, road_y, spec_for(res, 700.0, 1700.0))
    y = mesh.positions[:, 1]
    surface = 60.0 + ROAD_LIFT
    assert np.any(np.abs(y - surface) < 2.0), "no ironwork near deck level: this checked nothing"
    skimming = (y > surface) & (y <= surface + 0.20)
    assert not np.any(skimming), (
        "%d vertices sit just above the road surface, at %.3f..%.3f m"
        % (skimming.sum(), y[skimming].min(initial=0), y[skimming].max(initial=0)))


def test_the_ironwork_does_not_quietly_multiply():
    """An upper bound, which this repository had none of anywhere.

    Every triangle-count assertion in `pipeline/tests` is a floor -- `> 2000`, `> 5000` -- so a mesh
    that grows forty times over passes all of them. That is not hypothetical: extracting
    `stiffening_truss` put its call one indent too deep, inside the loop that places suspender
    rods, and the whole truss was rebuilt once per rod. 10,540 triangles became 434,540 and
    goldengate's tile pack went from 3.29 MB to 5.58 MB of perfectly coincident steel, drawn on
    every frame of the bridge. Per-track size is measured but has no cap; the tile
    pack is gitignored, and the only visible trace was a changed set of byte offsets in track.json.
    """
    res = bridged()
    mesh = suspension(res, np.full(len(res.P), 60.0), spec_for(res, 700.0, 1700.0))
    assert 5_000 < mesh.triangle_count < 50_000, (
        "%d triangles for one bridge" % mesh.triangle_count)


def test_the_towers_reach_the_water_and_rise_above_the_deck():
    res = bridged()
    road_y = np.full(len(res.P), 60.0)
    mesh = suspension(res, road_y, spec_for(res, 700.0, 1700.0))
    lo, hi = mesh.bounds()
    assert lo[1] < 1.0, "the towers stand in the water, not on the deck"
    assert hi[1] == pytest.approx(60.0 + 160.0, abs=2.0)


def test_the_cable_is_only_hung_over_the_suspended_part():
    """Beyond one side span the deck is on an approach viaduct. Running the cable to the last
    bridge sample would hang rope over a road that is really sitting on columns."""
    res = bridged(length=3600.0, span=(200.0, 3400.0))
    road_y = np.full(len(res.P), 60.0)
    mesh = suspension(res, road_y, spec_for(res, 900.0, 2200.0))
    high = mesh.positions[mesh.positions[:, 1] > 90.0]
    assert len(high), "there should be cable up near the towers"
    assert high[:, 0].min() > 900.0 - 343.0 - 30.0
    assert high[:, 0].max() < 2200.0 + 343.0 + 30.0
