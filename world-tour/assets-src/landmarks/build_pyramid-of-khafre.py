"""Pyramid of Khafre (Chephren), Giza, built with the Giza pyramid kit in build_pyramid-of-khufu.py.

Published figures (sources in $SCRATCH/modelling/pyramid-of-khafre/data): base 215.25 m, slope
53 deg 10', height 143.5 m originally and 136.4 m today (pyramidion and part of the apex gone).
Its signature is the cap of original Tura-limestone casing that still covers the top: measured on
the reference photos at about a quarter of the height (down to ~103 m, the lower edge ragged by
several metres); Lehner's "top third" is the looser figure. Below it the stepped core: large rough
blocks in the lower half, a band of more regular courses at mid height, 50 cm courses near the top.
The bottom casing course was pink Aswan granite (a few blocks remain); at the north-west corner the
bedrock itself was cut into the lowest steps, and the pyramid stands on a rock-cut court.
Run: Blender --background --python assets-src/landmarks/build_pyramid-of-khafre.py
"""
import importlib.util
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('giza_kit', HERE / 'build_pyramid-of-khufu.py')
kitmod = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(kitmod)
Cut, Kit, Ground, ORDER, FACES = kitmod.Cut, kitmod.Kit, kitmod.Ground, kitmod.ORDER, kitmod.FACES

KHAFRE = dict(half=215.25 / 2, tan=math.tan(math.radians(53 + 10 / 60)), height=136.4, original=143.5, courses=150)
CAP_BOTTOM = 103.0          # over the base: mean lower edge of the surviving casing cap (photos: ~24% of the height)


def build():
    sys.path.insert(0, str(HERE))
    from build_landmark_tools import Model
    ident = 'pyramid-of-khafre'
    plan = kitmod.run_plan(ident, 165.0, 4.0, [])
    ground = Ground(plan)
    model = Model(ident)
    kit = Kit(model, (0.0, 0.0), seed=4420396)
    rng = kit.rng
    road = plan['road']
    model.material('limestone', (0.53, 0.40, 0.235), 0.0, 0.93, ident + '_limestone')
    model.material('casing', (0.61, 0.505, 0.345), 0.0, 0.7, ident + '_casing')
    model.material('granite', (0.42, 0.23, 0.18), 0.0, 0.7, ident + '_granite')
    model.material('bedrock', (0.50, 0.40, 0.26), 0.0, 0.95, ident + '_bedrock_rock')
    model.material('rubble', (0.45, 0.34, 0.21), 0.0, 0.95, ident + '_rubble_stone')
    b, tan, H = KHAFRE['half'], KHAFRE['tan'], KHAFRE['height']
    B = kitmod.base_level(ground, 0.0, 0.0, b)
    inset = 1.25
    hs = kitmod.course_heights(KHAFRE['courses'], H, 1.7, 0.52, 42.0, [(12, 0.5), (30, 0.4), (52, 0.3)], rng, noise=0.09)
    Y = [0.0]
    for h in hs:
        Y.append(Y[-1] + h)
    print(f'khafre base level {B:.2f} m, {len(hs)} courses, first {hs[0]:.2f}, top {hs[-1]:.2f}', flush=True)
    core_w = lambda y: b - inset - y / tan
    env_w = lambda y: b - y / tan

    # ragged lower edge of the casing cap, per face: runs of a few metres, each its own height
    cap_edge = {}
    for f in ORDER:
        runs = []
        x = -b
        level = CAP_BOTTOM + rng.uniform(-3, 3)
        while x < b:
            L = rng.uniform(2.0, 9.0)
            level = max(CAP_BOTTOM - 6.0, min(CAP_BOTTOM + 7.0, level + rng.gauss(0, 1.6)))
            runs.append((x, x + L, level))
            x += L
        cap_edge[f] = runs
    band_lo = min(r[2] for rr in cap_edge.values() for r in rr)
    band_hi = max(r[2] for rr in cap_edge.values() for r in rr)

    cuts = []
    cuts += kitmod.scars(rng, 12, core_w, band_hi - 5, depth=(0.8, 2.2))
    cuts += kitmod.small_holes(rng, 170, core_w, band_hi)
    cuts += kitmod.small_holes(rng, 90, core_w, 35.0, faces=('W', 'N'))
    # the two entrances in the north face (upper at ~11 m, lower in the pavement, both about 12 m east
    # of the centre line) -- the upper one is a dark slot with a granite-lined mouth
    cuts += [Cut('N', 12.0 - 0.55, 12.0 + 0.55, 11.0, 12.2, 6.0), Cut('N', 9.8, 14.2, 10.2, 14.0, 1.0, jag=0.4)]
    corner = kitmod.corner_erosion(rng, ORDER, hs, Y, lambda y: 0.1 + 1.6 * math.exp(-y / 30.0) if y < band_lo else 0.0,
                                   walk=0.25)

    def seg_of(f, y, w):
        if w < 20:
            return (1.8, 3.4)
        if f in ('W', 'N') and y < 30:
            return (1.8, 3.6)
        return (2.6, 5.2) if y < 30 else (3.4, 6.8)
    # rough, irregular courses in the lower half, a band of regular masonry at mid height
    jitter_of = lambda f, y: 0.42 if y < 55 else (0.28 if y < 84 else 0.1)

    # core courses up to the highest point of the cap edge; above that the casing covers everything
    top_core = max(k for k in range(len(hs)) if Y[k] < band_hi + 0.5)
    kitmod.stepped_core(kit, 'course', B, Y, lambda k: core_w(Y[k + 1]), cuts, corner, seg_of, jitter_of, 'limestone',
                        skip=lambda k: k > top_core)

    # the casing cap: every course above its face's edge is a sloped casing run
    for k in range(len(hs)):
        y0, y1 = Y[k], Y[k + 1]
        if y1 <= band_lo:
            continue
        ym = (y0 + y1) / 2
        we = env_w(y0)
        tweak = rng.uniform(0.0, 0.05)                        # the faint horizontal joints
        for fi, f in enumerate(ORDER):
            spans = []
            for xa, xb, level in cap_edge[f]:
                if y0 >= level:
                    xa2, xb2 = max(xa, -we), min(xb, we)
                    if xb2 - xa2 > 0.2:
                        if spans and abs(spans[-1][1] - xa2) < 1e-6:
                            spans[-1] = (spans[-1][0], xb2)
                        else:
                            spans.append((xa2, xb2))
            for xa, xb in spans:
                if xb >= we - 0.5:
                    xb = we
                if xa <= -we + 0.5:
                    xa = -we
                # weathered casing: blocks a few centimetres proud or sunk, the odd one missing
                blocks = []
                x = xa
                while x < xb:
                    xn = min(xb, x + rng.uniform(2.0, 7.0))
                    blocks.append((x, xn, tweak + (rng.uniform(0.15, 0.4) if rng.random() < 0.05 else rng.uniform(-0.03, 0.04))))
                    x = xn
                kit.casing_run(f'cap {k}', f, B + y0, B + y1, we, tan, xa, xb, 'casing', blocks,
                               full_start=False, full_end=True, back=inset + 0.4)
    # summit: the truncated apex (pyramidion and top courses gone), a few displaced blocks on it
    wt = env_w(H) - 0.6
    kit.prism('summit', [(-wt, -wt), (wt, -wt), (wt, wt), (-wt, wt)], B + H - 2.5, B + H - 0.03, 'casing')
    # the last broken casing courses left on the platform make the tip read pointed from the road
    for i, (hw, hh) in enumerate(((3.4, 0.55), (2.1, 0.5))):
        y = B + H + 0.55 * i
        kit.loft('summit course', [(-hw, y, -hw), (hw, y, -hw), (hw, y, hw), (-hw, y, hw)],
                 [(-hw + hh / tan, y + hh, -hw + hh / tan), (hw - hh / tan, y + hh, -hw + hh / tan),
                  (hw - hh / tan, y + hh, hw - hh / tan), (-hw + hh / tan, y + hh, hw - hh / tan)], 'casing')
    for i in range(4):
        e = rng.uniform(-wt + 1, wt - 1); s = rng.uniform(-wt + 1, wt - 1)
        kit.block('summit block', (e, B + H + 0.3, s), (rng.uniform(0.7, 1.4), 0.6, rng.uniform(0.6, 1.2)), 'limestone',
                  yaw=rng.uniform(0, 0.5), jitter=0.2)

    # the pink granite bottom course of the casing: a few stretches survive at the foot
    for f in ORDER:
        for _ in range(3):
            L = rng.uniform(5, 16); xa = rng.uniform(-b + 12, b - 12 - L)
            blocks = []
            x = xa
            while x < xa + L:
                xn = min(xa + L, x + rng.uniform(1.4, 2.6)); blocks.append((x, xn, rng.uniform(0.0, 0.08))); x = xn
            kit.casing_run('granite casing', f, B + Y[0], B + Y[1], b, tan, xa, xa + L, 'granite', blocks, back=inset + 0.6)

    # north-west corner: the bedrock cut into the lowest steps (an L of stepped rock round the corner)
    for k in range(len(hs)):
        if Y[k + 1] > 7.5:
            break
        W = core_w(Y[k + 1]) + 0.08
        D = 3.0
        Ln = rng.uniform(22, 45) * (1 - Y[k] / 9); Lw = rng.uniform(22, 45) * (1 - Y[k] / 9)
        pts = [(-W, -W), (-W + Ln, -W), (-W + Ln, -W + D), (-W + D, -W + D), (-W + D, -W + Lw), (-W, -W + Lw)]
        kit.prism('bedrock steps', pts, B + Y[k], B + Y[k + 1], 'bedrock')

    # rock-cut court round the foot and the bank down to the plateau where it is lower
    kit.apron('court', ground, b + 0.2, B, 9.0, 'bedrock', inside=9.0)
    kit.rubble('rubble', ground, kitmod.base_points(rng, 0.0, 0.0, b, 110), 'rubble', road, clear=3.0, size=(0.5, 2.2))
    kit.rubble('granite rubble', ground, kitmod.base_points(rng, 0.0, 0.0, b, 12, spread=(0.5, 5.0)), 'granite', road,
               clear=3.0, size=(0.8, 1.8))
    kitmod.datum_marker(kit, plan, 'bedrock')
    print('triangle estimate', kit.tri_estimate, flush=True)
    return model.finish(directory=kitmod.SCRATCH / ident)


if __name__ == '__main__':
    build()
