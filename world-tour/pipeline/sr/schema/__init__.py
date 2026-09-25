"""track.json validation against the shared JSON Schema."""
import json
import os
import math

from jsonschema import Draft202012Validator

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "track.schema.json")


def load_schema():
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        return json.load(f)


def track_errors(track):
    """Return a list of human-readable schema violations, plus cross-field checks the schema can't express."""
    validator = Draft202012Validator(load_schema())
    errors = [f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}" for e in validator.iter_errors(track)]
    if errors:
        return errors
    spline = track["spline"]
    if len(spline["halfWidth"]) != len(spline["points"]):
        errors.append("spline/halfWidth: must have one entry per point")
    if "s" in spline:
        arc = spline["s"]
        if len(arc) != len(spline["points"]):
            errors.append("spline/s: must have one entry per point")
        elif arc[0] != 0 or arc != sorted(arc):
            errors.append("spline/s: must start at zero and be non-decreasing")
        else:
            points = spline["points"]
            measured = [0.0]
            for a, b in zip(points, points[1:]):
                measured.append(measured[-1] + math.dist(a, b))
            total = measured[-1] + (math.dist(points[-1], points[0]) if spline["closed"] else 0.0)
            if max(abs(a - b) for a, b in zip(arc, measured)) > 1e-5:
                errors.append("spline/s: must be the three-dimensional arc length of points")
            if abs(spline["length"] - total) > 1e-5:
                errors.append("spline/length: must equal the three-dimensional centreline length")
    if "curvature" in spline and len(spline["curvature"]) != len(spline["points"]):
        errors.append("spline/curvature: must have one entry per point")
    ss = [c["s"] for c in track["checkpoints"]]
    if ss != sorted(ss):
        errors.append("checkpoints: s must be non-decreasing")
    if ss and ss[-1] > spline["length"]:
        errors.append("checkpoints: s beyond spline length")
    if track["mode"] != "multistop" and any(c.get("stop") for c in track["checkpoints"]):
        errors.append("checkpoints: stop=true only allowed in multistop mode")
    return errors


def validate_track(track):
    errors = track_errors(track)
    if errors:
        raise ValueError("invalid track.json:\n  " + "\n  ".join(errors))
    return track
