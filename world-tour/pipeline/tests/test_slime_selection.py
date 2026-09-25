import numpy as np
import pytest
from sr.slimes import _pick, _distance


def legacy_pick(candidates, count, length, closed, exclude=(), clearance=0.0, min_separation=None,
          strict_separation=False):
    """Pick near-even candidates, preferring separation without inventing off-route positions."""
    candidates = sorted(set(float(s) for s in candidates
                            if 20.0 <= s <= length - (0.0 if closed else 20.0)))
    if not candidates or count <= 0:
        return []
    targets = np.linspace(length * 0.12, length * 0.88, count)
    picked = []
    for target in targets:
        allowed = [s for s in candidates
                   if s not in picked
                   if all(_distance(s, e, length, closed) >= clearance for e in exclude)
                   and all(_distance(s, p, length, closed) >= (
                       min_separation if min_separation is not None
                       else min(55.0, length / max(count, 1) * 0.45))
                           for p in picked)]
        pool = allowed or ([] if strict_separation else [s for s in candidates if s not in picked
                           if all(_distance(s, e, length, closed) >= clearance for e in exclude)])
        if not pool:
            break
        choice = min(pool, key=lambda s: _distance(s, target, length, closed))
        picked.append(choice)
    return picked


@pytest.mark.parametrize("closed", [False, True])
@pytest.mark.parametrize("strict", [False, True])
@pytest.mark.parametrize("count", [0, 8, 35])
def test_incremental_selector_matches_the_original_choices(closed, strict, count):
    rng = np.random.default_rng(196)
    candidates = [20, 40, 40, 300, 600, 980, 1000, *rng.uniform(0, 1000, 90)]
    kwargs = dict(length=1000, closed=closed, exclude=[60, 500, 950], clearance=35,
                  min_separation=80, strict_separation=strict)
    assert _pick(candidates, count, **kwargs) == legacy_pick(candidates, count, **kwargs)


def test_long_route_selector_keeps_every_requested_safe_site():
    # Same candidate/population scale as the 68 km route, without rebuilding its terrain.
    rng = np.random.default_rng(196)
    candidates = rng.uniform(25, 68475, 9000)
    excluded = np.linspace(100, 68300, 750)
    picked = _pick(candidates, 750, 68500, False, excluded, 12, 12, strict_separation=True)
    assert len(picked) == 750
    assert np.diff(sorted(picked)).min() >= 12
    assert np.min(abs(np.asarray(picked)[:, None] - excluded)) >= 12
