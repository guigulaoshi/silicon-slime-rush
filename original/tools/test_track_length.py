"""The 「赛道要短」 direction, as a test rather than a sentence.

Tracks aim at three to five kilometres, six at most: players do not have the patience for longer.
The numbers and the one exception live here because this is the thing that enforces them.
"""
import json
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(ROOT, "game", "public", "tracks")
CEILING_M = 6000.0

# id -> (its own ceiling in metres, who allowed it and why)
EXCEPTIONS = {
    "bayshore-101": (20000.0,
                     "六公里上限的唯一例外：起点能看见 Moffett 的机库、沿 101 北上经过园区、"
                     "过了门洛帕克下高速，全程不超过二十公里。这是全部赛道里唯一一条开高速的体验。"
                     "实测 16.0 km。"
                     "改这个数的时候还有一处要一起改：pipeline/tests/test_route.py 里那条 "
                     "`14_000 < res.length < 20_000`，它查的是管线算出来的路线，这里查的是发出去的 track.json。"),
}


def _tracks():
    out = {}
    for name in sorted(os.listdir(TRACKS)):
        path = os.path.join(TRACKS, name, "track.json")
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as fh:
                out[name] = float(json.load(fh)["spline"]["length"])
    return out


class TrackLength(unittest.TestCase):
    def test_no_track_is_longer_than_its_ceiling(self):
        tracks = _tracks()
        # `track.json` is committed -- only the tiles beside it are build products -- so an empty
        # listing means the tracks moved, not that this tree has not been built.
        self.assertTrue(tracks, f"no track.json under {TRACKS}")
        for name, length in tracks.items():
            ceiling, why = EXCEPTIONS.get(name, (CEILING_M, ""))
            self.assertLessEqual(length, ceiling,
                                 f"{name} is {length/1000:.2f} km, over its {ceiling/1000:.0f} km ceiling"
                                 + (f" ({why})" if why else ""))

    def test_every_exception_is_still_a_track_that_needs_one(self):
        """An exception nobody needs any more is a licence left lying around."""
        tracks = _tracks()
        self.assertTrue(tracks, f"no track.json under {TRACKS}")
        for name in EXCEPTIONS:
            self.assertIn(name, tracks, f"{name} has a length exception but is not a track any more")
            self.assertGreater(tracks[name], CEILING_M,
                               f"{name} is now within the {CEILING_M/1000:.0f} km ceiling; drop its exception")


if __name__ == "__main__":
    unittest.main()
