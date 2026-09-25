"""Synthetic test tracks generated through the real tile/export path.

Three variants on one flat ellipse: a closed loop, an open point-to-point arc, and the same arc with
stop checkpoints for multistop mode. Track ids start with synth- and are hidden from the menu
unless the game runs with ?dev=1."""
import os

import numpy as np

from sr.export import export_track
from sr.geom import cumulative_lengths, curvature, resample, rights, tangents
from sr.mesh import box, quad, ribbon, wall, yaw_for_z_axis
from sr.preview import render_preview
from sr.roads import RAIL_HEIGHT, RAIL_MATERIAL, RAIL_OFFSET
from sr.route import RACE_MIN_HALF
from sr.slimes import add_to_tiles as add_slimes, placements as slime_placements
from sr.tiles import TILE, TileSet, tile_of, tile_rect

ROAD_Y = 0.05
BARRIER_HALF = (1.0, 0.45, 0.25)


def ellipse(a=300.0, b=150.0, n=720):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return np.stack([a * np.cos(t), np.zeros(n), b * np.sin(t)], axis=1)


STOP_APPROACH_CLEAR_M = 60.0
STOP_OVERSHOOT_CLEAR_M = 70.0


def _checkpoint(P, T, S, i, half, stop=False):
    cp = {"s": float(S[i]), "pos": [float(v) for v in P[i]], "dir": [float(v) for v in T[i]], "halfWidth": half}
    if stop:
        cp["stop"] = True
    return cp


def _common(P, S, T, closed, half=RACE_MIN_HALF):
    return {
        "version": 1, "editions": ["full"], "origin": {"lat": 37.8, "lon": -122.45},
        "timeOfDay": "day", "car": "sedan",
        "spline": {"points": P.round(3).tolist(), "halfWidth": [half] * len(P),
                   "s": S.tolist(),
                   "curvature": curvature(P, S, closed).round(5).tolist(), "closed": closed,
                   "length": float(S[-1] + (np.linalg.norm(P[0] - P[-1]) if closed else 0.0))},
        "start": {"pos": [float(P[0][0]), ROAD_Y + 0.5, float(P[0][2])], "yaw": yaw_for_z_axis(-T[0])},
        "attribution": ["synthetic"],
    }


def _build_world(P, S, T, R, closed, half, seed=7, route_id="synthetic", stops=()):
    ts = TileSet()
    # road ribbon
    ts.add_mesh("road", ribbon(P, R, [half] * len(P), y_offset=ROAD_Y, closed=closed, S=S, material="road"))
    # the same continuous rail the real tracks get, so the test tracks exercise its collider too
    for side in (-1.0, 1.0):
        edge = P[::3] + R[::3] * (side * (half + RAIL_OFFSET))
        edge = edge.copy(); edge[:, 1] = ROAD_Y
        ts.add_mesh("guardrail", wall(edge, RAIL_HEIGHT, material=RAIL_MATERIAL, closed=closed))
    # terrain: a flat quad per tile touched by anything, plus one ring of neighbours
    touched = {tile_of(p[0], p[2]) for p in P}
    ring = {(c + dc, r + dr) for c, r in touched for dc in (-1, 0, 1) for dr in (-1, 0, 1)}
    for tile in ring:
        x0, z0, x1, z1 = tile_rect(*tile)
        ts.add_mesh("terrain", quad(x0, z0, x1, z1, y=0.0, material="terrain"), tile=tile)
    # water pond inside the ellipse; drop below killY and you reset
    water = quad(-120, -50, 120, 50, y=-0.3, material="water")
    for tile, part in __import__("sr.mesh", fromlist=["split_by_tile"]).split_by_tile(water, tile_of).items():
        ts.add_mesh("water", part, tile=tile)
        ts.extras[tile]["water"] = {"killY": -0.2}
    # buildings around the outside
    rng = np.random.default_rng(seed)
    for k in range(36):
        th = rng.uniform(0, 2 * np.pi)
        ex, ez = 300 * np.cos(th), 150 * np.sin(th)
        n = np.array([ex / 300**2, ez / 150**2]); n /= np.linalg.norm(n)
        dist = rng.uniform(30, 70)
        cx, cz = ex + n[0] * dist, ez + n[1] * dist
        hx, hz, hy = rng.uniform(4, 10), rng.uniform(4, 10), rng.uniform(3, 8)
        yaw = yaw_for_z_axis(-n)
        from sr.buildings import facade_identity
        ts.add_mesh("buildings", facade_identity(
            box((cx, hy, cz), (hx, hy, hz), yaw, material="building"), f"synth:{seed}:{k}", k % 2 == 0))
        ts.add_box_collider((cx, hy, cz), (hx, hy, hz), yaw)
    # two side-road stubs, each cut 30 m out with three barriers across the end
    n = len(P)
    for frac in (0.4, 0.9):
        i = int(frac * n) % n
        # stubs leave the loop on the outside of the ellipse, away from the pond
        out = np.array([P[i][0], 0.0, P[i][2]]); out /= np.linalg.norm(out)
        stub_pts = np.array([P[i] + out * d for d in np.linspace(half, half + 30, 8)])
        stub_R = np.tile(T[i], (len(stub_pts), 1))
        ts.add_mesh("road", ribbon(stub_pts, stub_R, [3.0] * len(stub_pts), y_offset=ROAD_Y, material="road"))
        end = P[i] + out * (half + 28)
        # The stub follows ``out``, not the loop tangent. On an ellipse the radial ``out`` and the
        # tangent are not perpendicular except at the four cardinal points, so using T made these
        # rows sit diagonally across their own side roads -- the same wrong-axis bug as a bridge
        # portal running along the deck instead of joining its tower legs.
        yaw = yaw_for_z_axis(out)
        across = np.array([out[2], 0.0, -out[0]])
        for off in (-2.0, 0.0, 2.0):
            pos = end + across * off; pos[1] = ROAD_Y + BARRIER_HALF[1]
            ts.add_instance("props_barrier", pos, yaw, box((0, 0, 0), BARRIER_HALF, 0.0, material="barrier"), BARRIER_HALF)
    route = {"id": route_id, "category": "race", "slimeDensity": 1.0}
    shape = type("SlimeRoute", (), {"P": P, "S": S, "T": T, "R": R,
                 "half_width": np.full(len(P), half), "closed": closed,
                 "length": float(S[-1] + (np.linalg.norm(P[0] - P[-1]) if closed else 0.0))})()
    # A delivery must be deliverable. Production routes carry no stop gates (the delivery routes were
    # removed), so only this fixture meets the collision: a boost 20 m before its 543 m gate
    # threw the bot past it at 83 km/h and a giant 37 m after it held the car afloat on the way back,
    # which ended every run in an off-track reset. Keep the approach and the overshoot clear.
    items = [item for item in slime_placements(shape, route)
             if not any(-STOP_APPROACH_CLEAR_M <= item.s - stop <= STOP_OVERSHOOT_CLEAR_M for stop in stops)]
    add_slimes(ts, items)
    return ts


def _write(track, ts, out_root, preview_root):
    out_dir = os.path.join(out_root, track["id"])
    doc = export_track(track, ts, out_dir)
    render_preview(doc, ts, os.path.join(preview_root, track["id"], "preview.png"))
    return doc


def generate(out_root, preview_root):
    docs = []
    # closed loop
    P, S = resample(ellipse(), 2.0, closed=True)
    P = P.round(3)
    S = cumulative_lengths(P, True)[:-1]
    T = tangents(P, True); R = rights(T)
    # Exercise the narrowest road the production pipeline can emit. The original 4 m fixture
    # predates RACE_MIN_HALF and became an impossible road that made the version-gate driver reset.
    half = RACE_MIN_HALF
    n = len(P)
    track = _common(P, S, T, True, half)
    track.update({"id": "synth-loop", "category": "race", "mode": "loop", "laps": 3,
                  "name": {"zh": "合成环线", "en": "Synthetic Loop"},
                  "blurb": {"zh": "平地椭圆，测三圈圈速。", "en": "Flat ellipse, three laps."},
                  "checkpoints": [_checkpoint(P, T, S, 0, half), _checkpoint(P, T, S, n // 3, half), _checkpoint(P, T, S, 2 * n // 3, half)]})
    docs.append(_write(track, _build_world(P, S, T, R, True, half, route_id="synth-loop"), out_root, preview_root))
    # open arc: first 75 percent of the ellipse
    Po = P[: int(0.75 * n)]
    Po, So = resample(Po, 2.0, closed=False)
    Po = Po.round(3)
    So = cumulative_lengths(Po, False)
    To = tangents(Po, False); Ro = rights(To)
    m = len(Po)
    for mode, cid, zh, en, stops in (
        ("p2p", "synth-p2p", "合成点对点", "Synthetic Sprint", False),
        ("multistop", "synth-stops", "合成多站", "Synthetic Stops", True),
    ):
        track = _common(Po, So, To, False, half)
        cps = [_checkpoint(Po, To, So, 0, half)]
        for frac in (0.25, 0.5, 0.75):
            cps.append(_checkpoint(Po, To, So, int(frac * m), half, stop=stops))
        cps.append(_checkpoint(Po, To, So, m - 1, half))
        track.update({"id": cid, "category": "race", "mode": mode, "laps": 1,
                      "name": {"zh": zh, "en": en},
                      "blurb": {"zh": "椭圆四分之三弧。", "en": "Three quarters of the ellipse."}, "checkpoints": cps})
        if stops:
            # Repeated optional landmarks exercise template sharing and transformed mesh collision.
            track["landmarks"] = [{"id": "moffett-fighter", "file": "../../models/landmarks/moffett-fighter.glb",
                                    "pos": [x, 0, 0], "yaw": 0, "loadRadius": 600, "collision": True}
                                   for x in (-40, 40)]
        stop_s = [cp["s"] for cp in cps if cp.get("stop")]
        docs.append(_write(track, _build_world(Po, So, To, Ro, False, half, route_id=cid, stops=stop_s),
                           out_root, preview_root))
    return docs
