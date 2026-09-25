"""The 「赛道要够玩」 direction, as a test rather than a sentence.


that was a Bay Area campus tour with one deliberate exception (bayshore-101, a 16 km highway run). World
Tour deleted that route along with the rest of the Bay Area set
and replaced it with fifteen real-place point-to-point/loop tracks, none anywhere near 6 km -- the ceiling
and its exception list have no track left to apply to.

What World Tour needs enforced is the opposite end: each track is meant to be worth about two minutes of
driving, roughly 2 km, not a token sliver of road. Measured directly off the fifteen built tracks
(`game/public/tracks/*/track.json`), the shortest is rio at 1752 m -- a real mountain switchback climb up
Corcovado, and still the longest race of the fifteen (about 150 s for the middle car), because its hairpins
are slow; it was trimmed by 110 m to bring that time down (see `pipeline/routes/rio.json`).
"Worth two minutes" is guarded where it is measured, in seconds (`RACE_SECONDS` in
`game/src/track/routeFacts.ts`, checked against the AI pace table); this floor only catches a route that
collapsed to a token stub, so it sits at 1700 m, under every real track. This checks the built track.json (what ships), the same file the original
ceiling test checked; the route-generation side has its own length checks in
`pipeline/tests/test_streetmap.py` (MIN_LENGTH, a per-way filter, not a whole-route floor).
"""
import glob
import json
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROUTES = os.path.join(ROOT, "pipeline", "routes")
TRACKS = os.path.join(ROOT, "game", "public", "tracks")
FLOOR_M = 1700.0


def _route_ids():
    # pipeline/routes has one <id>.json per real-place track, plus a README.md the glob skips.
    # The synthetic fixtures (synth-loop/-p2p/-stops) have no route file and are exempt on purpose:
    # they exist to be small and predictable, not to be worth two minutes of driving.
    return sorted(
        os.path.splitext(os.path.basename(p))[0]
        for p in glob.glob(os.path.join(ROUTES, "*.json"))
    )


class TrackLength(unittest.TestCase):
    def test_every_route_builds_a_track_worth_driving(self):
        route_ids = _route_ids()
        self.assertTrue(route_ids, f"no route *.json under {ROUTES}")
        for route_id in route_ids:
            track_path = os.path.join(TRACKS, route_id, "track.json")
            self.assertTrue(os.path.isfile(track_path),
                             f"{route_id} has a route file but no built track.json at {track_path}")
            with open(track_path, encoding="utf-8") as fh:
                length = float(json.load(fh)["spline"]["length"])
            self.assertGreaterEqual(length, FLOOR_M,
                                    f"{route_id} is {length/1000:.3f} km, under the {FLOOR_M/1000:.1f} km floor")


if __name__ == "__main__":
    unittest.main()
