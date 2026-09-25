"""Pyramid of Menkaure (Mycerinus) and its three Queens' pyramids (G3-a, G3-b, G3-c), Giza, built with
the Giza pyramid kit in build_pyramid-of-khufu.py.

Published figures (sources in $SCRATCH/modelling/pyramid-of-menkaure/data): base 102.2 x 104.6 m
(built square at 103.4 m, the figure in between), slope 51 deg 20' 25", 65.5 m originally, 61 m today.
Casing: the lowest sixteen courses were red Aswan granite, partly left in the rough; about seven
courses of it survive, dressed smooth only round the entrance, which sits in the fifth casing course
4.2 m up in the middle of the north face. Straight above it the great breach of AD 1196 (Sultan
al-Aziz Uthman's attempt to demolish the pyramid) scars the north face from about 20 m up.
Queens: G3-a, the easternmost, a true pyramid, base 44 m, slope 52 deg 15', 28.4 m originally and
25.4 m today, first course of granite casing (left rough on the east); G3-b and G3-c, bases 31.24 m,
are unfinished step pyramids of four stages (G3-c 21.2 m high). Positions are the OSM ways.

The registered footprint is a rectangle round the pyramid AND the queens (OSM ways 4420398,
25416060/67/93 all inside it): the game stands a model on the lowest ground of its footprint outline,
and the queens stand 5-7 m lower than Menkaure's own outline, so a footprint of Menkaure alone would
have hung them in the air (and left the pipeline to draw them a second time as ordinary buildings).
Run: Blender --background --python assets-src/landmarks/build_pyramid-of-menkaure.py
"""
import importlib.util
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('giza_kit', HERE / 'build_pyramid-of-khufu.py')
kitmod = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(kitmod)
Cut, Kit, Ground, ORDER, FACES = kitmod.Cut, kitmod.Kit, kitmod.Ground, kitmod.ORDER, kitmod.FACES

MENKAURE = dict(way=4420398, half=103.4 / 2, tan=math.tan(math.radians(51 + 20 / 60 + 25 / 3600)), height=61.0, courses=66)
QUEENS = {'G3-a': 25416060, 'G3-b': 25416067, 'G3-c': 25416093}


def centre_of(ring):
    es = [p[0] for p in ring]; ss = [p[1] for p in ring]
    return (min(es) + max(es)) / 2, (min(ss) + max(ss)) / 2


def build():
    sys.path.insert(0, str(HERE))
    from build_landmark_tools import Model
    ident = 'pyramid-of-menkaure'
    plan = kitmod.run_plan(ident, 150.0, 3.0, [MENKAURE['way'], *QUEENS.values()])
    ground = Ground(plan)
    model = Model(ident)
    rings = plan['rings']
    mc = centre_of(rings[str(MENKAURE['way'])])
    print('menkaure centre in model frame', mc, flush=True)
    kit = Kit(model, mc, seed=4420398)
    rng = kit.rng
    road = plan['road']
    model.material('limestone', (0.52, 0.38, 0.215), 0.0, 0.93, ident + '_limestone')
    model.material('granite', (0.35, 0.235, 0.16), 0.0, 0.75, ident + '_granite')
    model.material('rubble', (0.45, 0.335, 0.20), 0.0, 0.95, ident + '_rubble_stone')
    model.material('bedrock', (0.52, 0.42, 0.28), 0.0, 0.95, ident + '_bedrock_rock')

    # ------------------------------------------------------------------ Menkaure
    b, tan, H = MENKAURE['half'], MENKAURE['tan'], MENKAURE['height']
    B = kitmod.base_level(ground, *mc, b)
    inset = 1.0
    hs = kitmod.course_heights(MENKAURE['courses'], H, 1.45, 0.72, 26.0, [(9, 0.3), (24, 0.3)], rng, noise=0.08)
    Y = [0.0]
    for h in hs:
        Y.append(Y[-1] + h)
    print(f'menkaure base level {B:.2f} m, {len(hs)} courses, first {hs[0]:.2f}, top {hs[-1]:.2f}', flush=True)
    core_w = lambda y: b - inset - y / tan
    cuts = []
    # the entrance: a 1.05 x 1.2 m mouth in the 5th granite course, 4.2 m up, centre of the north face
    cuts += [Cut('N', -0.53, 0.53, 4.2, 5.4, 8.0)]
    # the breach of 1196: a narrow deep groove in the middle of the north face, from about 13 m to 42 m up
    # (measured on the reference photo from the north-east), with a lighter robbed patch above it
    cuts += [Cut('N', -4.0, 5.0, 11.0, 45.0, 2.2, jag=0.7, blob=True), Cut('N', -1.8, 2.8, 13.0, 43.0, 6.0, jag=0.4, blob=True),
             Cut('N', -0.4, 1.4, 15.0, 39.0, 9.5, jag=0.2, blob=True)]
    cuts += kitmod.scars(rng, 7, core_w, 50.0, depth=(0.7, 1.8), size=(2.5, 9.0), tall=(2.0, 7.0))
    cuts += kitmod.small_holes(rng, 70, core_w, 56.0)
    corner = kitmod.corner_erosion(rng, ORDER, hs, Y, lambda y: 0.2 + 1.8 * math.exp(-y / 20.0), walk=0.3)
    seg_of = lambda f, y, w: (1.6, 3.2) if w > 12 else (1.4, 2.6)
    jitter_of = lambda f, y: 0.24
    kitmod.stepped_core(kit, 'course', B, Y, lambda k: core_w(Y[k + 1]), cuts, corner, seg_of, jitter_of, 'limestone')
    # top: a few blocks left on the small summit platform
    wt = core_w(H)
    for i in range(3):
        kit.block('summit block', (mc[0] + rng.uniform(-wt + .6, wt - .6), B + H + 0.3, mc[1] + rng.uniform(-wt + .6, wt - .6)),
                  (rng.uniform(0.7, 1.2), 0.6, rng.uniform(0.6, 1.0)), 'limestone', yaw=rng.uniform(0, 0.5), jitter=0.2)

    # granite casing on the lowest courses: patchy, rough-bossed, dressed round the entrance
    casing_courses = [k for k in range(len(hs)) if Y[k + 1] <= 9.5]
    for k in casing_courses:
        y0, y1 = Y[k], Y[k + 1]
        we = b - y0 / tan
        for f in ORDER:
            # most survives on the north (round the entrance) and east; little on the south and west
            keep = {'N': 0.35, 'E': 0.3, 'S': 0.15, 'W': 0.15}[f] - 0.04 * k
            if (f in ('S', 'W') and k > 2) or Y[k + 1] > 7.0:
                continue
            x = -we
            while x < we - 0.5:
                L = rng.uniform(3.0, 13.0)
                xa, xb = x, min(we, x + L)
                x = xb + rng.uniform(0.0, 7.0) * (1.4 - keep)
                if f == 'N' and abs((xa + xb) / 2) < 22:
                    pass                                    # the dressed stretch round the entrance survives
                elif rng.random() > keep:
                    continue
                if xb >= we - 1.0:
                    xb = we
                pieces = [(xa, xb)]
                if f == 'N' and y0 < 5.4 and y1 > 4.2:          # leave the entrance open
                    pieces = [(xa, min(xb, -0.53)), (max(xa, 0.53), xb)]
                for pa, pb in pieces:
                    if pb - pa < 0.4:
                        continue
                    blocks = []
                    xx = pa
                    while xx < pb:
                        xn = min(pb, xx + rng.uniform(1.3, 2.5))
                        dressed = (f == 'N' and abs(xx) < 6.5) or (f == 'E' and abs(xx) < 5.0)
                        blocks.append((xx, xn, 0.0 if dressed else -rng.uniform(0.02, 0.32)))
                        xx = xn
                    kit.casing_run('granite casing', f, B + y0, B + y1, we, tan, pa, pb, 'granite', blocks,
                                   full_start=False, full_end=True, back=inset + 0.5)

    kit.apron('court', ground, b + 0.2, B, 5.0, 'bedrock', inside=7.0)
    pts = kitmod.base_points(rng, mc[0], mc[1], b, 110)
    kit.rubble('rubble', ground, pts, 'rubble', road, clear=3.0, size=(0.5, 2.0))
    # fallen granite casing blocks heaped along the north and east feet
    heaps = []
    for f, n in (('N', 70), ('E', 90), ('S', 25), ('W', 25)):
        (ne, ns), (te, ts) = FACES[f]
        for _ in range(n):
            x = rng.uniform(-b + 4, b - 4); o = abs(rng.gauss(2.0, 2.2))
            heaps.append((mc[0] + ne * (b + o) + te * x, mc[1] + ns * (b + o) + ts * x))
    kit.rubble('granite blocks', ground, heaps, 'granite', road, clear=3.0, size=(0.9, 2.3), flat=0.8)

    # ------------------------------------------------------------------ the Queens' pyramids
    def queen(name, half, H, profile, seed):
        qc = centre_of(rings[str(QUEENS[name])])
        qk = Kit(model, qc, seed=seed); qk.tri_estimate = 0
        r = qk.rng
        QB = kitmod.base_level(ground, *qc, half)
        if profile == 'true':
            qtan = math.tan(math.radians(52.25)); qin = 0.6
            n = 26
            qh = kitmod.course_heights(n, H, 1.2, 0.85, 12.0, [], r, noise=0.12)
            QY = [0.0]
            for h in qh:
                QY.append(QY[-1] + h)
            width_of = lambda k: half - qin - QY[k + 1] / qtan
            wy = lambda y: half - qin - y / qtan
        else:
            per = 6; steps = 4
            n = per * steps
            qh = [H / n * (1 + r.uniform(-0.12, 0.12)) for _ in range(n)]
            sc = H / sum(qh); qh = [h * sc for h in qh]
            QY = [0.0]
            for h in qh:
                QY.append(QY[-1] + h)
            width_of = lambda k: half - 0.25 - (k // per) * 3.0 - (k % per) * 0.2
            wy = lambda y: half - 0.25 - min(3, int(y / (H / steps))) * 3.0
        # ruined: broken corners, robbed patches, many missing blocks
        qc_cuts = kitmod.scars(r, 5, wy, H * 0.85, depth=(0.6, 1.8), size=(2.0, 7.0), tall=(1.5, 5.0))
        qc_cuts += kitmod.small_holes(r, 45, wy, H - 1.0, depth=(0.4, 1.1), size=(1.0, 2.4), tall=(0.6, 1.8))
        qcorner = kitmod.corner_erosion(r, ORDER, qh, QY, lambda y: 0.5 + 1.8 * math.exp(-y / 8.0), walk=0.4)
        if profile == 'step' and name == 'G3-b':
            # its top stage is half gone
            qc_cuts += [Cut(f, -9, 9, H * 0.8, H + 1, 1.6, jag=1.0, blob=True) for f in ORDER]
        kitmod.stepped_core(qk, name, QB, QY, width_of, qc_cuts, qcorner, lambda f, y, w: (1.2, 2.4),
                            lambda f, y: 0.35, 'limestone')
        if profile == 'true':
            # the first course of granite casing, rough on the east where the temple wall covered it
            for f in ORDER:
                for _ in range(2):
                    L = r.uniform(4, 10); xa = r.uniform(-half + 3, half - 3 - L)
                    blocks = []
                    xx = xa
                    while xx < xa + L:
                        xn = min(xa + L, xx + r.uniform(1.2, 2.2)); blocks.append((xx, xn, -r.uniform(0, 0.25))); xx = xn
                    qk.casing_run('queen granite', f, QB + QY[0], QB + QY[1], half, qtan, xa, xa + L, 'granite', blocks,
                                  back=qin + 0.4)
        qk.apron(name + ' footing', ground, half - 0.1, QB, 2.5, 'rubble', inside=5.0, step=4.0)
        qk.rubble(name + ' rubble', ground, kitmod.base_points(r, qc[0], qc[1], half, 40, spread=(-0.5, 6.0)), 'rubble',
                  road, clear=3.0, size=(0.5, 1.8))
        print(f'{name}: centre {qc}, base level {QB:.2f}, {len(qh)} courses, estimate {qk.tri_estimate}', flush=True)

    queen('G3-a', 22.0, 25.4, 'true', 25416060)
    queen('G3-b', 15.62, 18.5, 'step', 25416067)
    queen('G3-c', 15.62, 21.2, 'step', 25416093)

    kitmod.datum_marker(kit, plan, 'rubble')
    print('triangle estimate (menkaure)', kit.tri_estimate, flush=True)
    return model.finish(directory=kitmod.SCRATCH / ident)


if __name__ == '__main__':
    build()
