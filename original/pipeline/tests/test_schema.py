import copy, json, os

import pytest

from sr.schema import SCHEMA_PATH, track_errors, validate_track

EXAMPLE = os.path.join(os.path.dirname(SCHEMA_PATH), "examples", "minimal.track.json")


def load():
    with open(EXAMPLE, encoding="utf-8") as f:
        return json.load(f)


def test_example_is_valid():
    assert track_errors(load()) == []


def test_missing_required_field_fails():
    t = load(); del t["spline"]
    assert any("spline" in e for e in track_errors(t))


def test_race_must_not_have_countdown():
    t = load(); t["countdown"] = {"seconds": 120}
    assert track_errors(t)


def test_mission_needs_countdown_and_story():
    t = load(); t["category"] = "mission"
    assert track_errors(t)
    t["countdown"] = {"seconds": 240}; t["story"] = {"zh": "跑", "en": "run"}
    assert track_errors(t) == []


def test_loop_must_be_closed():
    t = load(); t["spline"]["closed"] = False
    assert track_errors(t)


def test_halfwidth_length_must_match_points():
    t = load(); t["spline"]["halfWidth"].append(4)
    assert any("halfWidth" in e for e in track_errors(t))


def test_optional_sample_arc_must_match_the_exported_three_dimensional_points():
    t = load()
    t["mode"] = "p2p"; t["laps"] = 1
    t["spline"].update({"points": [[0, 0, 0], [3, 4, 0], [6, 4, 0]],
                         "halfWidth": [4, 4, 4], "closed": False,
                         "s": [0, 5, 8], "length": 8})
    t["checkpoints"] = [
        {"s": 0, "pos": [0, 0, 0], "dir": [1, 0, 0], "halfWidth": 4},
        {"s": 8, "pos": [6, 4, 0], "dir": [1, 0, 0], "halfWidth": 4},
    ]
    assert track_errors(t) == []
    t["spline"]["s"] = [0, 3, 6]
    assert any("three-dimensional arc" in e for e in track_errors(t))


def test_checkpoints_sorted():
    t = load(); t["checkpoints"][0]["s"] = 900
    assert any("non-decreasing" in e for e in track_errors(t))


def test_stop_only_in_multistop():
    t = load(); t["checkpoints"][1]["stop"] = True
    assert any("stop" in e for e in track_errors(t))


def test_validate_raises():
    t = load(); t["id"] = "Bad ID"
    with pytest.raises(ValueError):
        validate_track(t)
