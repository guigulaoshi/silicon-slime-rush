"""Numbers the pipeline builds the world from and the runtime judges the world by.

Each of these lives in two files because the two sides do not import each other: one is Python that
lays the geometry down, the other TypeScript that reads the player's position against it. Until now
the only thing holding them together was a comment on each side promising it matched the other, and
a promise is not a check -- drift here is not cosmetic. `RAIL_OFFSET` is where `Race.ts` decides a
car has left the road; move the pipeline's copy and cars are called off-track while still on the
tarmac, or driven through a rail that is no longer where the judge thinks it is.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
# name -> (python file, typescript file). Both sides name each other in a comment; this makes that
# comment executable. A new pair belongs here the moment a constant is copied across the boundary.
SHARED = {
    "RAIL_OFFSET": ("pipeline/sr/roads.py", "game/src/track/Race.ts"),
    "ROAD_LIFT": ("pipeline/sr/roads.py", "game/src/world/Gates.ts"),
}


def number(path, name, pattern):
    text = (ROOT / path).read_text(encoding="utf-8")
    found = re.search(pattern % re.escape(name), text, re.MULTILINE)
    assert found, f"{path} no longer defines {name}"
    return float(found.group(1))


@pytest.mark.parametrize("name", sorted(SHARED))
def test_the_pipeline_and_the_runtime_agree_on_a_shared_number(name):
    python_file, typescript_file = SHARED[name]
    built = number(python_file, name, r"^%s\s*=\s*([0-9.]+)")
    judged = number(typescript_file, name, r"^export const %s\s*=\s*([0-9.]+)")
    assert built == judged, (f"{name}: {python_file} builds with {built}, "
                             f"{typescript_file} judges with {judged}")
