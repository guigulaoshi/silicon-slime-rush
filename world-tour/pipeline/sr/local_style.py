"""A city's own ordinary buildings: route `architecture.local` (routes/README.md, docs/CONTRACT.md 4).

The five shared facades (sr/textures.py) are one Bay Area street re-tinted: the same square window
every three metres made one city's flats look like another's on the far side of the world. A route
that describes its ordinary buildings -- up to three types, each with its wall, windows, ground floor,
roof and the few parts a local would name -- gets them drawn from that description:

- three texture slots per type, written beside the track (`tracks/<id>/textures/`, loaded with it):
  `building_local_wall_<slot>` one row of bays of the upper floors, `building_local_ground_<slot>` the
  ground floor, `local_roof_<slot>` the roofing;
- the roof shape (flat with parapet, hip, gable, mansard, curved) with its pitch and eaves;
- small geometry that changes the silhouette: rooftop water towers and tanks, prayer-flag lines,
  chimneys, projecting bay windows, verandas, unfinished column stubs.

Everything here is parametric: the numbers come from the route file, which a person fills from
street photographs of that city; nothing here names a city.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import zlib

import numpy as np
from PIL import Image
from shapely.geometry import Point, Polygon
from shapely.geometry.polygon import orient

from sr.mesh import Mesh, box, orient_by_shading, pitched_roof_parts

SLOTS = "abc"
WALL, GROUND, ROOF = "building_local_wall_{}", "building_local_ground_{}", "local_roof_{}"
DETAIL_DARK, DETAIL_LIGHT, FLAGS = "local_detail_dark", "local_detail_light", "local_flags"
ACCENT, RAIL = "local_detail_accent", "local_rail"   # awnings, chimney pots; balcony and veranda ironwork
UV_METRES = 3.0                 # sr/mesh.py BUILDING_UV_METRES: uv is metres over this on every wall
DETAIL_RADIUS = 220.0           # rooftop and facade parts only this close to the race line
FLAG_COLOURS = ("#2f9ec7", "#e4e8e7", "#b61019", "#43964d", "#d4ab2a")   # blue white red green yellow, measured on new flags
QUALITY = 86


def hex_rgb(value):
    value = value.lstrip("#")
    return np.array([int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


# ---------------------------------------------------------------------------------------------------
# the route's description

def types(route):
    """The route's local building types, each with its slot letter, or [] when it has none."""
    spec = ((route.get("architecture") or {}).get("local") or {})
    listed = list(spec.get("types", ()))
    if len(listed) > len(SLOTS):
        raise ValueError(f"{route.get('id')}: architecture.local has more than {len(SLOTS)} types")
    return [{**t, "slot": slot} for slot, t in zip(SLOTS, listed)]


def _matches(t, tags, storeys, area, at=None):
    when = t.get("when") or {}
    # `within` / `outside`: circles in local metres ({x, z, r}, set by `localise`), so one city can have
    # its slab estate here and its towers there although their footprints are the same size
    if at is not None and when.get("_within") and not any(math.hypot(at[0] - x, at[1] - z) <= r for x, z, r in when["_within"]):
        return False
    if at is not None and any(math.hypot(at[0] - x, at[1] - z) <= r for x, z, r in when.get("_outside", ())):
        return False
    if "tags" in when and str(tags.get("building", "")).lower() not in when["tags"]:
        return False
    if storeys is not None and not (when.get("minStoreys", 0) <= storeys <= when.get("maxStoreys", 1e9)):
        return False
    return when.get("minArea", 0) <= area <= when.get("maxArea", 1e12)


def choose(all_types, tags, storeys, area, at):
    """The type a footprint wears: among the types whose `when` it meets, drawn by `share`, stable per
    footprint. None when no type matches (the footprint keeps the shared facades)."""
    fits = [t for t in all_types if _matches(t, tags, storeys, area, at)]
    if not fits:
        return None
    total = sum(float(t.get("share", 1.0)) for t in fits)
    value = (zlib.crc32(b"%.1f,%.1f:local" % (at[0], at[1])) % 10000) / 10000.0 * total
    for t in fits:
        value -= float(t.get("share", 1.0))
        if value < 0:
            return t
    return fits[-1]


def localise(all_types, frame):
    """Turn each type's `when.within` / `when.outside` ({lat, lon, radiusM} circles) into local metres."""
    for t in all_types:
        when = t.get("when") or {}
        for key in ("within", "outside"):
            circles = []
            for c in when.get(key, ()):
                x, z = frame.to_local(np.array([c["lat"]]), np.array([c["lon"]]))
                circles.append((float(x[0]), float(z[0]), float(c["radiusM"])))
            if circles:
                when["_" + key] = circles
        t["when"] = when
    return all_types


def far_style(all_types, storeys, area, at):
    """(wall material, roof material, roof kind) for a building far off the road -- the district
    filler and the skyline -- in the same city style as the near streets; None without one."""
    t = choose(all_types, {"building": "yes"}, storeys, area, at)
    if t is None:
        return None
    kind = (t.get("roof") or {}).get("kind", "flat")
    kind = {"mansard": "hip", "curved": "gable", "dome": "flat"}.get(kind, kind)
    return WALL.format(t["slot"]), ROOF.format(t["slot"]), kind


def _levels(tags):
    try:
        return float(str((tags or {}).get("building:levels", "")).split(";")[0])
    except ValueError:
        return None


def storeys_for(t, tagged_height, guess, at, tags=None):
    """(ground floor height, upper floors, total height). A tagged height is kept; an untagged footprint
    takes the type's own `storeys` range, because the shared area table was written for low suburban
    houses and made a street of six-storey stone blocks two storeys tall."""
    ground = float(t.get("groundM", t.get("storeyM", 3.2)))
    storey = float(t.get("storeyM", 3.2))
    levels = _levels(tags)
    in_roof = [k for low, k in ((t.get("roof") or {}).get("levelsInRoof") or ()) if levels and levels >= low]
    if levels and not (tags or {}).get("height"):
        # `building:levels` counts the storeys in a mansard too: a 7-level Paris block is a 5-storey
        # wall under a 2-level roof, not a 24 m wall with a roof on top of it
        n = int(levels) - 1 - (max(in_roof) if in_roof else 0)
    elif tagged_height:
        n = int(round((tagged_height - ground) / storey))
    elif t.get("storeys"):
        lo, hi = (int(v) for v in t["storeys"])
        n = lo + (zlib.crc32(b"%.1f,%.1f:storeys" % (at[0], at[1])) % (hi - lo + 1)) - 1
    else:
        n = int(round((guess - ground) / storey))
    n = max(0, n)
    return ground, n, ground + n * storey


# ---------------------------------------------------------------------------------------------------
# textures

def _rng(key):
    return np.random.default_rng(int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big"))


def _noise(rng, h, w, cells):
    """Smooth value noise in [0, 1] that wraps at the image edges (the tiles repeat)."""
    g = rng.random((cells, cells))
    ys = np.linspace(0, cells, h, endpoint=False)
    xs = np.linspace(0, cells, w, endpoint=False)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    y1, x1 = (y0 + 1) % cells, (x0 + 1) % cells
    top = g[y0][:, x0] + (g[y0][:, x1] - g[y0][:, x0]) * fx[None, :]
    bot = g[y1][:, x0] + (g[y1][:, x1] - g[y1][:, x0]) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def _fbm(rng, h, w, cells=8, octaves=4):
    out, amp, total = np.zeros((h, w)), 1.0, 0.0
    for _ in range(octaves):
        out += amp * _noise(rng, h, w, cells)
        total += amp
        amp *= .5
        cells *= 2
    return out / total


class Canvas:
    """An image in metres: x across (0..W), y up (0..H), y = 0 the bottom row."""

    def __init__(self, width_m, height_m, px_w, px_h):
        self.W, self.H, self.w, self.h = width_m, height_m, px_w, px_h
        x = (np.arange(px_w) + .5) / px_w * width_m
        y = ((px_h - 1 - np.arange(px_h)) + .5) / px_h * height_m
        self.X, self.Y = np.meshgrid(x, y)
        self.rgb = np.zeros((px_h, px_w, 3))

    def rect(self, x0, y0, x1, y1, soft=0.012):
        """Coverage of an axis-aligned rectangle, antialiased over `soft` metres."""
        def band(v, a, b):
            return np.clip((v - a) / soft + .5, 0, 1) * np.clip((b - v) / soft + .5, 0, 1)
        return band(self.X, x0, x1) * band(self.Y, y0, y1)

    def arch(self, cx, y0, w, h):
        """A round-headed opening: rectangle to the springing line, half circle above."""
        r = w / 2
        spring = y0 + max(h - r, 0)
        body = self.rect(cx - r, y0, cx + r, spring + .01)
        head = np.clip((r - np.hypot(self.X - cx, self.Y - spring)) / .012 + .5, 0, 1) * (self.Y >= spring)
        return np.maximum(body, head)

    def pointed(self, cx, y0, w, h):
        """A pointed (two-centred) arch: rectangle to the springing line, then two arcs of radius w."""
        spring = y0 + max(h - w * .87, 0)
        body = self.rect(cx - w / 2, y0, cx + w / 2, spring + .01)
        left = np.hypot(self.X - (cx + w / 2), self.Y - spring) <= w
        right = np.hypot(self.X - (cx - w / 2), self.Y - spring) <= w
        head = (left & right & (self.Y >= spring) & (np.abs(self.X - cx) <= w / 2)).astype(float)
        return np.maximum(body, head)

    def trapezoid(self, cx, y0, y1, half_bottom, half_top):
        t = np.clip((self.Y - y0) / max(y1 - y0, 1e-6), 0, 1)
        half = half_bottom + (half_top - half_bottom) * t
        return ((np.abs(self.X - cx) <= half) & (self.Y >= y0) & (self.Y <= y1)).astype(float)

    def paint(self, mask, colour):
        c = hex_rgb(colour) if isinstance(colour, str) else np.asarray(colour)
        self.rgb = self.rgb * (1 - mask[:, :, None]) + c * mask[:, :, None]

    def image(self):
        return Image.fromarray(np.rint(np.clip(self.rgb, 0, 1) * 255).astype(np.uint8), mode="RGB")


def _px(width_m, height_m):
    """Image size for a tile: 512 across, 512 or 256 down by the tile's aspect."""
    return 512, (512 if height_m / width_m > .75 else 256)


def _wall_surface(c, wall, rng):
    """The bare wall: render, brick, stone, tile cladding, timber, mud or concrete."""
    kind = wall.get("kind", "render")
    base = hex_rgb(wall.get("colour", "#d8cfbf"))
    alts = [hex_rgb(v) for v in wall.get("colours", ())]
    grain = _fbm(rng, c.h, c.w, cells=max(4, int(c.W * 2)), octaves=4)
    blotch = _fbm(rng, c.h, c.w, cells=3, octaves=3)
    rgb = base * (0.9 + 0.16 * grain[:, :, None]) * (0.95 + 0.1 * blotch[:, :, None])
    if kind in ("brick", "stone", "tile"):
        unit, course = wall.get("unit", {"brick": [.25, .075], "stone": [.8, .42], "tile": [.2, .2]}[kind])
        row = np.floor(c.Y / course)
        offset = (row % 2) * .5 * unit if kind != "tile" else 0 * row
        col = np.floor((c.X + offset) / unit)
        joint = np.minimum(np.minimum(c.Y % course, course - c.Y % course),
                           np.minimum((c.X + offset) % unit, unit - (c.X + offset) % unit))
        mortar = np.clip(1 - joint / (.012 if kind == "brick" else .01), 0, 1)
        pick = ((row * 7919 + col * 104729) % 97) / 97.0
        if alts:
            choice = (pick * (len(alts) + 1)).astype(int)
            for k, alt in enumerate(alts, start=1):
                rgb = np.where((choice == k)[:, :, None], alt * (0.9 + 0.16 * grain[:, :, None]), rgb)
        # cut stone varies a little block to block; more than this read as a chequerboard from the road
        spread = .06 if kind == "stone" else .16
        rgb = rgb * (1.0 - spread * .6 + spread * pick)[:, :, None]
        joint_rgb = hex_rgb(wall.get("joint", "#b9b2a6"))
        rgb = rgb * (1 - mortar[:, :, None]) + joint_rgb * mortar[:, :, None]
    elif kind == "timber":
        board = float(wall.get("board", .2))
        along = c.X if wall.get("vertical") else c.Y      # vertical boarding (`vertical: true`) or lap siding
        edge = np.minimum(along % board, board - along % board)
        rgb = rgb * (0.78 + 0.22 * np.clip(edge / .02, 0, 1))[:, :, None]
    elif kind == "concrete":
        rgb = rgb * (1 - 0.25 * c.rect(c.W / 2 - .01, 0, c.W / 2 + .01, c.H))[:, :, None]
    elif kind == "mud":
        rgb = base * (0.82 + 0.3 * _fbm(rng, c.h, c.w, cells=int(c.W * 3), octaves=5))[:, :, None]
    if wall.get("stain", 0):
        streak = _fbm(rng, c.h, c.w, cells=max(3, int(c.W)), octaves=2)
        streak = np.clip((streak - .55) * 3, 0, 1) * (1 - c.Y / c.H) * float(wall["stain"])
        rgb = rgb * (1 - .25 * streak[:, :, None])
    c.rgb = rgb


def _glass(c, mask, win, rng):
    glass = hex_rgb(win.get("glass", "#2b3238"))
    sky = _noise(rng, c.h, c.w, 3)
    tone = glass * (0.8 + 0.5 * sky[:, :, None]) * (0.75 + 0.35 * np.clip(c.Y / c.H, 0, 1))[:, :, None]
    c.rgb = c.rgb * (1 - mask[:, :, None]) + tone * mask[:, :, None]


def _window(c, cx, y0, win, rng, bay_index):
    """One window at centre x `cx`, sill `y0`, with its surround, frame, shutters and balcony."""
    shape = win.get("shape", "rect")
    w, h = float(win.get("w", 1.1)), float(win.get("h", 1.4))
    sur = win.get("surround") or {}
    if sur.get("kind") == "trapezoid":
        # the black band round a Tibetan window: wider at the foot, running on below the sill
        sw = float(sur.get("w", .22))
        c.paint(c.trapezoid(cx, y0 - float(sur.get("below", .35)), y0 + h + sw * .6,
                            w / 2 + sw * 1.6, w / 2 + sw * .7), sur.get("colour", "#1b1a19"))
    elif sur.get("kind") in ("architrave", "frame"):
        sw = float(sur.get("w", .14))
        mask = (c.arch(cx, y0 - sw, w + 2 * sw, h + 2 * sw) if shape == "arched"
                else c.rect(cx - w / 2 - sw, y0 - sw, cx + w / 2 + sw, y0 + h + sw))
        c.paint(mask, sur.get("colour", "#e9e3d6"))
    if sur.get("lintel"):
        c.paint(c.rect(cx - w / 2 - .12, y0 + h + .02, cx + w / 2 + .12, y0 + h + .02 + float(sur.get("lintelH", .2))),
                sur["lintel"])
    hole = c.arch(cx, y0, w, h) if shape == "arched" else c.rect(cx - w / 2, y0, cx + w / 2, y0 + h)
    _glass(c, hole, win, rng)
    fw = float(win.get("frameW", .06))
    if fw > 0:
        inner = (c.arch(cx, y0 + fw, w - 2 * fw, h - 2 * fw) if shape == "arched"
                 else c.rect(cx - w / 2 + fw, y0 + fw, cx + w / 2 - fw, y0 + h - fw))
        frame = np.clip(hole - inner, 0, 1)
        mull = c.rect(cx - fw / 2, y0, cx + fw / 2, y0 + h) * hole
        if h > 1.2:
            mull = np.maximum(mull, c.rect(cx - w / 2, y0 + h * .62, cx + w / 2, y0 + h * .62 + fw) * hole)
        c.paint(np.maximum(frame, mull), win.get("frame", "#f1eee8"))
    share = float(win.get("curtainShare", 1.0))
    if win.get("curtain") and (share >= .75 or (share >= .25 and bay_index % 2 == 0)):
        # a short valance over the window (drawn over the glass): pleated or striped cloth under the lintel
        cols = [hex_rgb(v) for v in (win["curtain"] if isinstance(win["curtain"], list) else [win["curtain"]])]
        stripe = (np.floor((c.X - cx) / .12).astype(int)) % len(cols)
        m = c.rect(cx - w / 2 - .05, y0 + h - .3, cx + w / 2 + .05, y0 + h + .02)
        pleat = (0.88 + 0.12 * np.cos((c.X - cx) * 2 * math.pi / .08))[:, :, None]
        cloth = np.stack(cols)[stripe] * pleat
        c.rgb = c.rgb * (1 - m[:, :, None]) + cloth * m[:, :, None]
    sh = win.get("shutters")
    if sh:
        closed = sh.get("someClosed", True) and bay_index % 3 == 2
        slat = (np.sin(c.Y * 2 * math.pi / .06) > .6) * .18
        colour = hex_rgb(sh.get("colour", "#3e6b4a"))
        m = (c.rect(cx - w / 2, y0, cx + w / 2, y0 + h) if closed else
             np.maximum(c.rect(cx - w - .04, y0, cx - w / 2 - .04, y0 + h), c.rect(cx + w / 2 + .04, y0, cx + w + .04, y0 + h)))
        c.rgb = c.rgb * (1 - m[:, :, None]) + (colour * (1 - slat[:, :, None])) * m[:, :, None]
    bal = win.get("balcony") or {}
    if bal.get("kind") in ("iron", "rail"):
        top = y0 + min(float(bal.get("h", .95)), h * .5)
        bars = ((np.abs(((c.X - cx) % .11) - .055) < .012) | (np.abs(c.Y - top) < .03) | (np.abs(c.Y - y0 - .08) < .02))
        c.paint(c.rect(cx - w / 2 - .15, y0, cx + w / 2 + .15, top) * bars, bal.get("colour", "#1d1f22"))
    elif bal.get("kind") == "slab":
        c.paint(c.rect(cx - w / 2 - .3, y0 - .18, cx + w / 2 + .3, y0 - .02), bal.get("slab", "#c9c6bf"))
        c.paint(c.rect(cx - w / 2 - .3, y0 - .02, cx + w / 2 + .3, y0 + .95) * .85, bal.get("colour", "#dcd8cf"))
    if win.get("grille"):
        bars = c.rect(cx - w / 2, y0, cx + w / 2, y0 + h) * (np.abs(((c.X - cx) % .12) - .06) < .01)
        c.paint(bars, win.get("grilleColour", "#2a2a2a"))
    if win.get("ac") and bay_index % 2 == 1:
        ax = cx + w / 2 + .15
        c.paint(c.rect(ax, y0 + .1, ax + .8, y0 + .6), "#d9dbd8")
        c.paint(c.rect(ax + .05, y0 + .15, ax + .75, y0 + .55) * (np.abs(((c.X - ax) % .06) - .03) < .008), "#9a9d9b")


def _tile_size(t):
    win = t.get("window") or {}
    bay = float(win.get("bay", 3.0))
    bays = int(t.get("tileBays", 2))
    return win, bay, bays


def wall_tile(t):
    """The upper-floor tile, `tileBays` bays of one storey: (Canvas, width m, height m, facadePanes)."""
    win, bay, bays = _tile_size(t)
    storey = float(t.get("storeyM", 3.2))
    W, H = bay * bays, storey
    c = Canvas(W, H, *_px(W, H))
    rng = _rng(f"local-wall:{json.dumps(t, sort_keys=True)}")
    _wall_surface(c, t.get("wall") or {}, rng)
    band = t.get("band")
    if band and band.get("where", "floors") == "floors":
        c.paint(c.rect(-1, H - float(band.get("h", .22)), W + 1, H + 1), band.get("colour", "#e6e0d4"))
    shape = win.get("shape", "rect")
    if shape == "ribbon":
        y0, h = float(win.get("sill", .9)), float(win.get("h", 1.3))
        _glass(c, c.rect(-1, y0, W + 1, y0 + h), win, rng)
        for k in range(int(W / .9) + 1):
            c.paint(c.rect(k * .9 - .03, y0, k * .9 + .03, y0 + h), win.get("frame", "#9aa0a3"))
        return c, W, H, [bays, 1, round(max(.05, 1 - h / H), 3)]
    if shape != "none":
        for k in range(bays):
            _window(c, bay * (k + .5), float(win.get("sill", .85)), win, rng, k)
    w, h = float(win.get("w", 1.1)), float(win.get("h", 1.4))
    return c, W, H, [bays, 1, round(max(.05, 1 - min(w / bay, h / H)), 3)]


def ground_tile(t):
    """The ground-floor tile, same bays. `ground.kind`: shops, door, arcade, plinth or same."""
    g = t.get("ground") or {}
    win, bay, bays = _tile_size(t)
    H = float(t.get("groundM", t.get("storeyM", 3.2)))
    W = bay * bays
    c = Canvas(W, H, *_px(W, H))
    rng = _rng(f"local-ground:{json.dumps(t, sort_keys=True)}")
    _wall_surface(c, {**(t.get("wall") or {}), **(g.get("wall") or {})}, rng)
    kind = g.get("kind", "same")
    signs = g.get("signs", ["#8c2f27", "#2d4f6c", "#6b5a2a"])
    if kind == "shops":
        for k in range(bays):
            x0, x1, top = bay * k + .25, bay * (k + 1) - .25, H - .75
            _glass(c, c.rect(x0, .15, x1, top), {"glass": g.get("glass", "#3a4246")}, rng)
            if k % 2 == 1 and g.get("shutter", True):
                ribs = c.rect(x0, top - 1.1, x1, top) * (0.85 + .15 * (np.sin(c.Y * 2 * math.pi / .08) > 0))
                c.paint(ribs, g.get("shutterColour", "#8d9194"))
            c.paint(c.rect(x0 - .1, top + .05, x1 + .1, H - .12), signs[k % len(signs)])
            c.paint(np.maximum(c.rect(x0, .15, x0 + .06, top), c.rect(x1 - .06, .15, x1, top)), "#2c2d2e")
    elif kind == "arcade":
        shape = c.pointed if g.get("pointed") else c.arch
        for k in range(bays):
            c.paint(shape(bay * (k + .5), 0, bay - .6, H - .4), g.get("shadow", "#2a2622"))
            if g.get("glassBehind", True):
                _glass(c, shape(bay * (k + .5), .15, bay - 1.3, H - 1.2) * .7, {"glass": g.get("glass", "#3a4246")}, rng)
    elif kind in ("door", "plinth"):
        if kind == "plinth":
            c.paint(c.rect(-1, -1, W + 1, float(g.get("plinthH", .9))), g.get("plinth", "#b7ada0"))
        for k in range(bays):
            cx = bay * (k + .5)
            if k == 0:
                dw, dh = float(g.get("doorW", 1.1)), min(float(g.get("doorH", 2.4)), H - .25)
                if g.get("doorFrame"):
                    c.paint(c.rect(cx - dw / 2 - .2, 0, cx + dw / 2 + .2, dh + .3), g["doorFrame"])
                mask = c.arch(cx, 0, dw, dh) if g.get("doorArched") else c.rect(cx - dw / 2, 0, cx + dw / 2, dh)
                c.paint(mask, g.get("door", "#4a3526"))
            else:
                y0 = max(.9, H - 2.4)
                _window(c, cx, y0, {**win, "balcony": None, "ac": False, "h": min(float(win.get("h", 1.4)), H - y0 - .3)}, rng, k)
    elif win.get("shape", "rect") not in ("none", "ribbon"):
        for k in range(bays):
            _window(c, bay * (k + .5), float(win.get("sill", .85)), {**win, "balcony": None}, rng, k)
    c.paint(c.rect(-1, -1, W + 1, .12), g.get("base", "#6f6a63"))
    return c, W, H, [bays, 1, .15]


def roof_tile(t):
    """The roofing: `roof.material` tile, grey_tile, slate, zinc, metal, thatch or concrete."""
    r = t.get("roof") or {}
    kind = r.get("material", "tile")
    W = H = 3.0
    c = Canvas(W, H, 256, 256)
    rng = _rng(f"local-roof:{json.dumps(r, sort_keys=True)}")
    base = hex_rgb(r.get("colour", "#9c5a3c"))
    rgb = base * (0.86 + 0.26 * _fbm(rng, c.h, c.w, cells=6, octaves=4)[:, :, None])
    if kind in ("tile", "grey_tile"):
        # barrel tiles: channels down the slope (y), courses across it
        pitch = .18 if kind == "grey_tile" else .25
        ridge = .5 + .5 * np.cos(2 * math.pi * c.X / pitch)
        course = (c.Y % .33) / .33
        rgb = rgb * (0.7 + 0.38 * ridge[:, :, None]) * (0.86 + 0.14 * course[:, :, None])
    elif kind == "slate":
        row = np.floor(c.Y / .2)
        col = np.floor((c.X + (row % 2) * .15) / .3)
        tone = 0.85 + 0.2 * (((row * 31 + col * 17) % 11) / 11.0)
        rgb = rgb * (tone * (0.7 + 0.3 * np.clip((c.Y % .2) / .025, 0, 1)))[:, :, None]
    elif kind in ("zinc", "metal"):
        spacing = .5 if kind == "zinc" else .2
        seam = np.abs((c.X % spacing) - spacing / 2)
        rgb = rgb * (0.82 + 0.18 * np.clip(seam / .05, 0, 1))[:, :, None]
    elif kind == "thatch":
        rgb = base * (0.7 + 0.5 * _fbm(rng, c.h, c.w, cells=40, octaves=3))[:, :, None]
    c.rgb = rgb
    return c, W, H


def flags_tile():
    """Prayer flags on a line: the five colours, 0.28 m flags with a gap between, alpha cut out."""
    W, H = 5 * .34, .40
    c = Canvas(W, H, 512, 128)
    alpha = np.zeros((c.h, c.w))
    for k, colour in enumerate(FLAG_COLOURS):
        m = c.rect(k * .34 + .02, 0, k * .34 + .32, H - .025)
        c.paint(m, colour)
        marks = m * (np.abs(np.sin(c.X * 60) * np.sin(c.Y * 45)) > .75) * .25   # the printed prayer
        c.rgb = c.rgb * (1 - marks[:, :, None])
        alpha = np.maximum(alpha, m)
    line = c.rect(-1, H - .03, W + 1, H + 1)
    c.paint(line, "#dcd6c8")
    alpha = np.maximum(alpha, line)
    rgba = np.dstack([np.clip(c.rgb, 0, 1), alpha])
    return Image.fromarray(np.rint(rgba * 255).astype(np.uint8), mode="RGBA"), W, H


def rail_tile(style="iron", colour="#1c1c1e"):
    """Balcony and veranda ironwork, alpha cut out: `iron` (bars and scrolls), `lace` (a cast-iron
    frieze) or `glass` (a pale panel with a handrail). 1.2 m by 1.0 m."""
    W, H = 1.2, 1.0
    c = Canvas(W, H, 256, 256)
    rgb = hex_rgb(colour)
    X, Y = c.X, c.Y
    if style == "glass":
        alpha = c.rect(-1, .05, W + 1, .95)
        c.paint(alpha, colour if colour != "#1c1c1e" else "#9db3ba")
        top = c.rect(-1, .92, W + 1, 1.0)
        c.paint(top, "#c9ced0")
        alpha = np.maximum(alpha, top)
    else:
        bars = np.abs(((X % .12) - .06)) < .011
        rails = (np.abs(Y - .96) < .03) | (np.abs(Y - .08) < .025) | (np.abs(Y - .5) < .012)
        if style == "lace":
            ring = np.abs(np.hypot((X % .2) - .1, (Y % .2) - .1) - .07) < .012
            diamond = np.abs(np.abs((X % .2) - .1) + np.abs((Y % .2) - .1) - .09) < .01
            alpha = (bars & (Y < .5)) | rails | ((ring | diamond) & (Y > .5))
        else:
            scroll = np.abs(np.hypot((X % .24) - .12, (Y % .45) - .28) - .07) < .011
            alpha = bars | rails | (scroll & (Y > .15) & (Y < .9))
        alpha = alpha.astype(float)
        c.paint(alpha, rgb)
    rgba = np.dstack([np.clip(c.rgb, 0, 1), alpha])
    return Image.fromarray(np.rint(rgba * 255).astype(np.uint8), mode="RGBA"), W, H


def _entry(material, filename, W, H, path, panes=None, cutout=None):
    e = {"material": material, "map": filename, "px": Image.open(path).size[0], "metres": round(W, 3),
         "repeat": [round(UV_METRES / W, 4), round(UV_METRES / H, 4)], "tier": "core",
         "bytes": os.path.getsize(path)}
    if panes:
        e["facadePanes"] = panes
    if cutout:
        e["cutout"] = cutout
    return e


def write_textures(route, out_dir):
    """Write the route's local textures and their manifest into `out_dir`; None when it has none."""
    all_types = types(route)
    if not all_types:
        return None
    os.makedirs(out_dir, exist_ok=True)
    entries = []

    def save(img, material):
        name = material + ".webp"
        img.save(os.path.join(out_dir, name), format="WEBP", quality=QUALITY, method=6)
        return name

    for t in all_types:
        s = t["slot"]
        wall = t.get("wall") or {}
        # several wall colours for one type: the tile is painted in `colour`, the runtime multiplies one
        # of these factors per building (`wall.palette`, up to four sunlit colours)
        palette = None
        if wall.get("palette"):
            base = np.maximum(hex_rgb(wall.get("colour", "#d8cfbf")), 1e-3)
            palette = [[round(float(v), 4) for v in hex_rgb(h) / base] for h in wall["palette"][:4]]
        for material, (c, W, H, panes) in ((WALL.format(s), wall_tile(t)), (GROUND.format(s), ground_tile(t))):
            name = save(c.image(), material)
            e = _entry(material, name, W, H, os.path.join(out_dir, name), panes)
            if palette and (material.startswith("building_local_wall") or (t.get("ground") or {}).get("palette", True)):
                e["palette"] = palette
            entries.append(e)
        c, W, H = roof_tile(t)
        name = save(c.image(), ROOF.format(s))
        entries.append(_entry(ROOF.format(s), name, W, H, os.path.join(out_dir, name)))
    if any((t.get("details") or {}).get("prayerFlags") for t in all_types) or route.get("prayerFlagFields"):
        img, W, H = flags_tile()
        name = save(img, FLAGS)
        e = _entry(FLAGS, name, W, H, os.path.join(out_dir, name), cutout=.5)
        e["repeat"] = [round(1 / W, 4), 1.0]       # flag strips carry u in metres along, v 0..1 down
        entries.append(e)
    spec = (route.get("architecture") or {}).get("local") or {}
    rail = spec.get("rail") or {}
    img, W, H = rail_tile(rail.get("style", "iron"), rail.get("colour", "#1c1c1e"))
    name = save(img, RAIL)
    entries.append(_entry(RAIL, name, W, H, os.path.join(out_dir, name), cutout=.5))
    manifest = {"version": 1, "textures": entries}
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return manifest


def tints(route):
    """Colours for the untextured detail materials, merged into the track's `tint`."""
    spec = ((route.get("architecture") or {}).get("local") or {})
    return {k: v for k, v in (spec.get("detailColours") or {}).items() if k in (DETAIL_DARK, DETAIL_LIGHT, ACCENT)}


# ---------------------------------------------------------------------------------------------------
# geometry

def planar_uv(mesh, scale=UV_METRES):
    """uv in metres on each flat face: u level across the face, v up its slope (roofs)."""
    P = mesh.positions.astype(np.float64)
    N = mesh.normals.astype(np.float64)
    u_axis = np.cross(np.array([0.0, 1.0, 0.0]), N)
    flat = np.linalg.norm(u_axis, axis=1) < 1e-3
    u_axis[flat] = (1.0, 0.0, 0.0)
    u_axis /= np.linalg.norm(u_axis, axis=1, keepdims=True)
    v_axis = np.cross(N, u_axis)
    mesh.uvs = (np.stack([np.sum(P * u_axis, axis=1), np.sum(P * v_axis, axis=1)], axis=1) / scale).astype(np.float32)
    return mesh


def cylinder(cx, y0, cz, r, h, material, sides=10, cap=True):
    pos, nor, uv, idx = [], [], [], []
    for k in range(sides):
        a0, a1 = 2 * math.pi * k / sides, 2 * math.pi * (k + 1) / sides
        n = (math.cos((a0 + a1) / 2), 0.0, math.sin((a0 + a1) / 2))
        b = len(pos)
        for a, y in ((a0, y0), (a1, y0), (a1, y0 + h), (a0, y0 + h)):
            pos.append((cx + r * math.cos(a), y, cz + r * math.sin(a)))
            nor.append(n)
            uv.append((a * r / UV_METRES, (y - y0) / UV_METRES))
        idx += [b, b + 2, b + 1, b, b + 3, b + 2]
        if cap:
            b = len(pos)
            pos += [(cx, y0 + h, cz), (cx + r * math.cos(a1), y0 + h, cz + r * math.sin(a1)),
                    (cx + r * math.cos(a0), y0 + h, cz + r * math.sin(a0))]
            nor += [(0, 1, 0)] * 3
            uv += [(0.02, 0.02)] * 3
            idx += [b, b + 1, b + 2]
    return orient_by_shading(Mesh(np.array(pos), np.array(nor), np.array(uv), np.array(idx), material))


def cone(cx, y0, cz, r, h, material, sides=10):
    pos, nor, uv, idx = [], [], [], []
    for k in range(sides):
        a0, a1 = 2 * math.pi * k / sides, 2 * math.pi * (k + 1) / sides
        n = np.array([math.cos((a0 + a1) / 2), r / max(h, 1e-6), math.sin((a0 + a1) / 2)])
        n /= np.linalg.norm(n)
        b = len(pos)
        pos += [(cx + r * math.cos(a0), y0, cz + r * math.sin(a0)), (cx, y0 + h, cz),
                (cx + r * math.cos(a1), y0, cz + r * math.sin(a1))]
        nor += [tuple(n)] * 3
        uv += [(0.02, 0.02)] * 3
        idx += [b, b + 1, b + 2]
    return orient_by_shading(Mesh(np.array(pos), np.array(nor), np.array(uv), np.array(idx), material))


def _faces(faces, world, material, inside):
    pos, nor, uv, idx = [], [], [], []
    for face in faces:
        pts = [world(p) for p in face]
        n = sum(np.cross(a, b) for a, b in zip(pts, pts[1:] + pts[:1]))
        if np.dot(n, np.mean(pts, axis=0) - inside) < 0:
            pts.reverse()
            n = -n
        n = n / max(np.linalg.norm(n), 1e-9)
        b = len(pos)
        pos += pts
        nor += [n] * len(pts)
        uv += [(0.02, 0.02)] * len(pts)
        idx += [b, b + 1, b + 2] + ([b, b + 2, b + 3] if len(pts) == 4 else [])
    return orient_by_shading(Mesh(np.array(pos), np.array(nor), np.array(uv), np.array(idx), material))


def mansard_parts(center, half, yaw, lower_rise, inset, top_rise, material):
    """A mansard: steep lower slopes `lower_rise` high stepping in by `inset`, then a low hip on top."""
    cx, cy, cz = center
    hx, hz = half
    c, s = math.cos(yaw), math.sin(yaw)

    def world(p):
        x, y, z = p
        return np.array((cx + c * x + s * z, cy + y, cz - s * x + c * z))

    lo = [(-hx, 0, -hz), (hx, 0, -hz), (hx, 0, hz), (-hx, 0, hz)]
    ix, iz = max(hx - inset, .3), max(hz - inset, .3)
    hi = [(-ix, lower_rise, -iz), (ix, lower_rise, -iz), (ix, lower_rise, iz), (-ix, lower_rise, iz)]
    faces = [[lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]] for i in range(4)]
    parts = [_faces(faces, world, material, inside=world((0, lower_rise / 2, 0)))]
    parts.extend(pitched_roof_parts(tuple(world((0, lower_rise, 0))), (ix, iz), yaw, max(top_rise, .2), "hip", material))
    return parts


def sag_strip(a, b, sag, material, height=.4, step=.5):
    """A line of flags from `a` to `b` (3-vectors) hanging `sag` metres in the middle, the cloth `height`
    below the line. uv: metres along (u), 1 at the line to 0 at the hem (v)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    n = max(2, int(float(np.linalg.norm(b - a)) / step) + 1)
    t = np.linspace(0, 1, n)
    line = a[None, :] + (b - a)[None, :] * t[:, None]
    line[:, 1] -= sag * 4 * t * (1 - t)
    along = np.r_[0, np.cumsum(np.linalg.norm(np.diff(line, axis=0), axis=1))]
    d = b - a
    d[1] = 0
    d /= max(np.linalg.norm(d), 1e-9)
    normal = (-d[2], 0.0, d[0])
    pos, nor, uv, idx = [], [], [], []
    for k in range(n):
        pos += [tuple(line[k]), tuple(line[k] - (0, height, 0))]
        nor += [normal] * 2
        uv += [(along[k], 1.0), (along[k], 0.0)]
    for k in range(n - 1):
        i = 2 * k
        idx += [i, i + 1, i + 3, i, i + 3, i + 2]
    return Mesh(np.array(pos), np.array(nor), np.array(uv), np.array(idx), material)


def _hash01(at, key):
    return (zlib.crc32(b"%.1f,%.1f:" % (at[0], at[1]) + key.encode()) % 10000) / 10000.0


def rooftop(poly, roof_y, t, at, flat, storeys, roof_top=None, keep_clear=None):
    """Rooftop parts for one building: water towers and tanks, solar heaters, column stubs, prayer
    flags, chimneys. `roof_y` is the roof surface."""
    d = t.get("details") or {}
    parts = []
    inner = poly.buffer(-1.2)
    if inner.is_empty or inner.area < 6:
        return parts
    ring = np.asarray(orient(poly.minimum_rotated_rectangle, sign=1).exterior.coords[:-1])
    c = poly.representative_point()
    if flat and _hash01(at, "tower") < float(d.get("waterTower", 0)) and 4 <= storeys <= 20 and inner.area > 40:
        p = inner.representative_point()
        for dx, dz in ((-1.2, -1.2), (1.2, -1.2), (1.2, 1.2), (-1.2, 1.2)):
            parts.append(box((p.x + dx, roof_y + 1.3, p.y + dz), (.12, 1.3, .12), material=DETAIL_DARK))
        parts.append(box((p.x, roof_y + 2.65, p.y), (1.9, .08, 1.9), material=DETAIL_DARK))
        parts.append(cylinder(p.x, roof_y + 2.7, p.y, 1.75, 3.4, DETAIL_DARK, sides=12))
        parts.append(cone(p.x, roof_y + 6.1, p.y, 1.95, 1.1, DETAIL_DARK, sides=12))
    if flat and _hash01(at, "tanks") < float(d.get("waterTanks", 0)):
        q = inner.centroid
        count = 1 + int(_hash01(at, "tankn") * 3)
        for k in range(count):
            ox, oz = (k - count / 2) * 1.6, (_hash01(at, f"t{k}") - .5) * 2
            if inner.buffer(-.8).contains(Point(q.x + ox, q.y + oz)):
                parts.append(cylinder(q.x + ox, roof_y, q.y + oz, .6, 1.3, DETAIL_LIGHT, sides=8))
    if flat and _hash01(at, "solar") < float(d.get("solarHeater", 0)):
        q = inner.representative_point()
        for k in range(2 + int(_hash01(at, "solarn") * 3)):
            x = q.x + (k - 1) * 1.1
            if not inner.contains(Point(x, q.y)):
                continue
            parts.append(box((x, roof_y + .55, q.y), (.5, .05, .8), material=DETAIL_DARK))
            parts.append(box((x, roof_y + 1.1, q.y - .75), (.5, .12, .12), material=DETAIL_LIGHT))
    if flat and _hash01(at, "rebar") < float(d.get("columnStubs", 0)):
        for x, z in ring:
            k = np.array([c.x - x, c.y - z])
            k = k / max(np.linalg.norm(k), 1e-6) * .35
            parts.append(box((x + k[0], roof_y + .7, z + k[1]), (.17, .7, .17), material=DETAIL_LIGHT))
    if _hash01(at, "flags") < float(d.get("prayerFlags", 0)):
        # Tibetan roofs: two to four corner poles, each with a bundle of flags, and strings along the
        # parapet from pole to pole (routes/README.md `prayerFlags`)
        count = 2 + int(_hash01(at, "flagn") * 3)
        start = int(_hash01(at, "flag0") * 4)
        poles = []
        for k in range(min(count, len(ring))):
            x, z = ring[(start + k) % len(ring)]
            inward = np.array([c.x - x, c.y - z])
            inward = inward / max(np.linalg.norm(inward), 1e-6) * .35
            px, pz = x + inward[0], z + inward[1]
            parts.append(box((px, roof_y + 1.2, pz), (.04, 1.2, .04), material=DETAIL_DARK))
            poles.append(np.array([px, roof_y + 2.4, pz]))
            towards = math.atan2(inward[1], inward[0])       # the bundle hangs over the roof, not the street
            for j in range(3):
                a = towards + (j - 1) * .55 + .2 * (_hash01(at, f"b{k}{j}") - .5)
                end = (px + 1.3 * math.cos(a), roof_y + .5, pz + 1.3 * math.sin(a))
                parts.append(sag_strip(poles[-1], end, .1, FLAGS))
        for a, b in zip(poles, poles[1:]):
            parts.append(sag_strip(a - (0, .3, 0), b - (0, .3, 0), .06 * float(np.linalg.norm(b - a)), FLAGS))
    if _hash01(at, "chimney") < float(d.get("chimneys", 0)):
        if d.get("chimneyPots"):
            parts.extend(chimney_stacks(poly, roof_y, roof_top if roof_top is not None else roof_y + .5,
                                        d["chimneyPots"], at, keep_clear))
        elif not flat:
            q = inner.representative_point()
            parts.append(box((q.x, roof_y + 1.2, q.y), (.35, 1.4, .35), material=DETAIL_LIGHT))
    if flat and _hash01(at, "windtower") < float(d.get("windTower", 0)) and inner.area > 30:
        parts.extend(wind_tower(poly, roof_y, WALL.format(t["slot"])))
    if flat and _hash01(at, "dishes") < float(d.get("dishes", 0)):
        parts.extend(dishes(poly, roof_y, int(d.get("dishCount", 4)), at))
    return parts


def street_front(poly, towards):
    """(middle, tangent, outward normal, length) of the longest wall facing `towards`, or None."""
    ring = np.asarray(orient(poly, sign=1).exterior.coords[:-1])
    best = None
    for a, b in zip(ring, np.roll(ring, -1, axis=0)):
        length = float(np.linalg.norm(b - a))
        if length < 4:
            continue
        tangent = (b - a) / length
        normal = np.array([tangent[1], -tangent[0]])
        middle = (a + b) / 2
        facing = float(np.dot(np.asarray(towards) - middle, normal))
        if facing > 0 and (best is None or facing * length > best[0]):
            best = (facing * length, middle, tangent, normal, length)
    return None if best is None else best[1:]


def facade_parts(poly, base, ground_m, storey_m, storeys, t, at, towards, keep_clear=None):
    """Street-front parts: a projecting bay window over the upper floors (`bayWindow`), a veranda with
    posts at the first floor (`veranda`)."""
    d = t.get("details") or {}
    front = street_front(poly, towards)
    if front is None or storeys < 1:
        return []
    middle, tangent, normal, length = front
    from sr.mesh import yaw_for_x_axis
    yaw = yaw_for_x_axis(tangent)
    parts = []

    def clear(centre, half_along, half_out):
        corners = [centre + tangent * sx * half_along + normal * sz * half_out
                   for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        return keep_clear is None or not Polygon(corners).intersects(keep_clear)

    if _hash01(at, "bay") < float(d.get("bayWindow", 0)) and length >= 5:
        depth, width = .75, min(3.6, length * .5)
        y0, y1 = base + ground_m + .2, base + ground_m + storeys * storey_m - .3
        centre = middle + normal * (depth / 2)
        if y1 - y0 > 2 and clear(centre, width / 2, depth / 2):
            parts.append(box((centre[0], (y0 + y1) / 2, centre[1]), (width / 2, (y1 - y0) / 2, depth / 2),
                             yaw=yaw, material=WALL.format(t["slot"])))
            parts.append(box((centre[0], y1 + .12, centre[1]), (width / 2 + .15, .12, depth / 2 + .15),
                             yaw=yaw, material=DETAIL_DARK))
    if _hash01(at, "veranda") < float(d.get("veranda", 0)) and length >= 4:
        depth, y = 1.6, base + ground_m
        centre = middle + normal * (depth / 2)
        half = length / 2 - .2
        if clear(centre, half, depth / 2 + .1):
            parts.append(box((centre[0], y + .08, centre[1]), (half, .08, depth / 2), yaw=yaw, material=DETAIL_LIGHT))
            parts.append(box((centre[0], y + 3.0, centre[1]), (half, .06, depth / 2 + .1), yaw=yaw, material=DETAIL_DARK))
            n = max(2, int(length / 2.4))
            for k in range(n):
                p = middle + tangent * (-half + .2 + k * (2 * half - .4) / (n - 1)) + normal * (depth - .1)
                parts.append(box((p[0], y + 1.5, p[1]), (.06, 1.5, .06), material=DETAIL_DARK))
            rail = middle + normal * (depth - .1)
            parts.append(box((rail[0], y + 1.0, rail[1]), (half, .04, .04), yaw=yaw, material=DETAIL_DARK))
    return parts


# ---------------------------------------------------------------------------------------------------
# more parts: domes, balconies, fire escapes, dormers, chimney pots, awnings, battlements, wind towers

def dome(cx, y0, cz, r, material, rings=6, sides=16):
    """A hemisphere on (cx, y0, cz): the lead dome of a tomb or a bath-house."""
    pos, nor, uv, idx = [], [], [], []
    for i in range(rings):
        p0, p1 = (math.pi / 2) * i / rings, (math.pi / 2) * (i + 1) / rings
        for k in range(sides):
            a0, a1 = 2 * math.pi * k / sides, 2 * math.pi * (k + 1) / sides
            quad = [(p0, a0), (p0, a1), (p1, a1), (p1, a0)]
            b = len(pos)
            for p, a in quad:
                n = (math.cos(p) * math.cos(a), math.sin(p), math.cos(p) * math.sin(a))
                pos.append((cx + r * n[0], y0 + r * n[1], cz + r * n[2]))
                nor.append(n)
                uv.append((a * r / UV_METRES, p * r / UV_METRES))
            idx += [b, b + 2, b + 1, b, b + 3, b + 2]
    return orient_by_shading(Mesh(np.array(pos), np.array(nor), np.array(uv), np.array(idx), material))


def rail_panel(a, b, y0, h=1.0, material=RAIL):
    """A vertical railing from ground point `a` to `b` (x, z), `h` tall from `y0`; uv in metres."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    length = float(np.linalg.norm(d))
    if length < .2:
        return None
    n = (d[1] / length, 0.0, -d[0] / length)
    pos = [(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y0 + h, b[1]), (a[0], y0 + h, a[1])]
    uv = [(0, 0), (length / UV_METRES, 0), (length / UV_METRES, h / UV_METRES), (0, h / UV_METRES)]
    return Mesh(np.array(pos), np.array([n] * 4), np.array(uv), np.array([0, 1, 2, 0, 2, 3]), material)


def _fronts(poly, towards, min_length=3.0):
    """Every wall facing the race side: (a, b, tangent, outward normal, length)."""
    ring = np.asarray(orient(poly, sign=1).exterior.coords[:-1])
    out = []
    for a, b in zip(ring, np.roll(ring, -1, axis=0)):
        length = float(np.linalg.norm(b - a))
        if length < min_length:
            continue
        tangent = (b - a) / length
        normal = np.array([tangent[1], -tangent[0]])
        if float(np.dot(np.asarray(towards) - (a + b) / 2, normal)) > 0:
            out.append((a, b, tangent, normal, length))
    return out


def _clear(corners, keep_clear):
    return keep_clear is None or not Polygon(corners).intersects(keep_clear)


def balconies(poly, floor_ys, depth, towards, keep_clear, slab=DETAIL_LIGHT):
    """Continuous balconies along the race-facing walls at each height in `floor_ys`: a slab on the wall
    and ironwork along its edge."""
    from sr.mesh import yaw_for_x_axis
    parts = []
    for a, b, tangent, normal, length in _fronts(poly, towards):
        a2, b2 = a + tangent * .15, b - tangent * .15
        outer_a, outer_b = a2 + normal * depth, b2 + normal * depth
        if not _clear([a2, b2, outer_b, outer_a], keep_clear):
            continue
        centre = (a2 + b2) / 2 + normal * depth / 2
        yaw = yaw_for_x_axis(tangent)
        for y in floor_ys:
            parts.append(box((centre[0], y - .08, centre[1]), ((length - .3) / 2, .08, depth / 2), yaw=yaw, material=slab))
            for panel in (rail_panel(outer_a, outer_b, y), rail_panel(a2, outer_a, y), rail_panel(outer_b, b2, y)):
                if panel is not None:
                    parts.append(panel)
    return parts


def fire_escape(poly, base, ground_m, storey_m, storeys, towards, keep_clear):
    """A black fire escape on the street wall: a platform and a railing at each upper floor."""
    front = street_front(poly, towards)
    if front is None or storeys < 2:
        return []
    from sr.mesh import yaw_for_x_axis
    middle, tangent, normal, length = front
    width, depth = min(4.5, length * .45), 1.1
    centre = middle + normal * depth / 2
    corners = [centre + tangent * sx * width / 2 + normal * sz * depth / 2 for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    if not _clear(corners, keep_clear):
        return []
    yaw = yaw_for_x_axis(tangent)
    parts = []
    for k in range(storeys):
        y = base + ground_m + k * storey_m + .05
        parts.append(box((centre[0], y, centre[1]), (width / 2, .04, depth / 2), yaw=yaw, material=DETAIL_DARK))
        oa, ob = middle - tangent * width / 2 + normal * depth, middle + tangent * width / 2 + normal * depth
        panel = rail_panel(oa, ob, y, .95)
        if panel is not None:
            parts.append(panel)
        # the stair to the next platform, as a slanted bar
        s = box((centre[0], y + storey_m / 2, centre[1]), (width * .32, .03, .25), yaw=yaw, material=DETAIL_DARK)
        tilt = math.atan2(storey_m, width * .64)
        P = s.positions - np.array([centre[0], y + storey_m / 2, centre[1]], dtype=np.float32)
        along = P[:, 0] * tangent[0] + P[:, 2] * tangent[1]
        P[:, 1] += along * math.tan(tilt)
        s.positions = P + np.array([centre[0], y + storey_m / 2, centre[1]], dtype=np.float32)
        if k < storeys - 1:
            parts.append(s)
    return parts


def dormers(center, half, yaw, roof_base, lower_rise, inset, bay, wall_mat, roof_mat):
    """One dormer per bay along both long faces of a mansard's steep lower slope."""
    cx, cy, cz = center
    hx, hz = half
    if hz > hx:
        hx, hz = hz, hx
        yaw += math.pi / 2
    c, s = math.cos(yaw), math.sin(yaw)
    parts = []
    count = max(1, int((2 * hx - 1.0) / bay))
    for side in (-1, 1):
        for k in range(count):
            x = -hx + (2 * hx) * (k + .5) / count
            z = side * (hz - inset * .55)
            px, pz = cx + c * x + s * z, cz - s * x + c * z
            y = roof_base + lower_rise * .45
            parts.append(box((px, y, pz), (.55, .75, .55), yaw=yaw, material=wall_mat))
            fx, fz = cx + c * x + s * (z + side * .56), cz - s * x + c * (z + side * .56)
            parts.append(box((fx, y - .05, fz), (.33, .5, .02), yaw=yaw, material=DETAIL_DARK))
            parts.extend(pitched_roof_parts((px, y + .75, pz), (.35, .62), yaw + math.pi / 2, .45, "gable", roof_mat))
    return parts


def chimney_stacks(poly, roof_y, roof_top, pots, at, keep_clear=None):
    """Stacks along the building's short ends, each crowned with a row of terracotta pots. A stack
    whose outline is not wholly on the building (an irregular footprint's bounding rectangle reaches
    past it) moves inward, and is dropped if it still is not."""
    rect = orient(poly.minimum_rotated_rectangle, sign=1)
    ring = np.asarray(rect.exterior.coords[:-1])
    edges = sorted(((float(np.linalg.norm(ring[(i + 1) % 4] - ring[i])), i) for i in range(4)))
    parts = []
    for _, i in edges[:2]:
        a, b = ring[i], ring[(i + 1) % 4]
        middle = (a + b) / 2
        inward = np.array(poly.centroid.coords[0]) - middle
        inward = inward / max(np.linalg.norm(inward), 1e-6)
        p = middle + inward * .6
        tangent = (b - a) / max(np.linalg.norm(b - a), 1e-6)
        from sr.mesh import yaw_for_x_axis
        long_half = min(2.2, float(np.linalg.norm(b - a)) * .3)
        normal = np.array([tangent[1], -tangent[0]])
        for step in (.6, 1.6, 3.0):
            p = middle + inward * step
            corners = [p + tangent * sx * long_half + normal * sz * .35 for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            outline = Polygon(corners)
            if poly.buffer(-.1).contains(outline) and _clear(corners, keep_clear):
                break
        else:
            continue
        top = roof_top + 1.0
        parts.append(box((p[0], (roof_y + top) / 2, p[1]), (long_half, (top - roof_y) / 2, .35),
                         yaw=yaw_for_x_axis(tangent), material=DETAIL_LIGHT))
        for k in range(int(pots)):
            q = p + tangent * (-long_half + .3 + k * (2 * long_half - .6) / max(int(pots) - 1, 1))
            parts.append(cylinder(q[0], top, q[1], .13, .5, ACCENT, sides=6))
    return parts


def awnings(poly, base, ground_m, bay, towards, keep_clear, share, at, depth=1.3):
    """Canvas awnings over the ground-floor bays of the street wall."""
    front = street_front(poly, towards)
    if front is None:
        return []
    from sr.mesh import yaw_for_x_axis
    middle, tangent, normal, length = front
    parts = []
    count = max(1, int(length / bay))
    yaw = yaw_for_x_axis(tangent)
    for k in range(count):
        if _hash01(at, f"awning{k}") >= share:
            continue
        s = -length / 2 + bay * (k + .5) * length / (count * bay)
        centre = middle + tangent * s + normal * depth / 2
        half = (bay / 2 - .3, depth / 2)
        corners = [centre + tangent * sx * half[0] + normal * sz * half[1] for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        if not _clear(corners, keep_clear):
            continue
        y = base + ground_m - .45
        parts.append(box((centre[0], y, centre[1]), (half[0], .05, depth / 2), yaw=yaw, material=ACCENT))
        if depth > 2.0:
            # a deep shed roof stands on thin posts at its outer edge
            for sx in (-1, 1):
                post = centre + tangent * sx * (half[0] - .1) + normal * (depth / 2 - .1)
                parts.append(box((post[0], (base + y) / 2, post[1]), (.04, (y - base) / 2, .04), material=DETAIL_DARK))
        lip = centre + normal * (depth / 2 - .03)
        parts.append(box((lip[0], y - .18, lip[1]), (half[0], .15, .02), yaw=yaw, material=ACCENT))
    return parts


def battlements(poly, top_y, material):
    """Merlons along the parapet: 0.5 m wide, 0.6 m tall, one every metre."""
    ring = np.asarray(orient(poly, sign=1).exterior.coords[:-1])
    parts = []
    from sr.mesh import yaw_for_x_axis
    for a, b in zip(ring, np.roll(ring, -1, axis=0)):
        length = float(np.linalg.norm(b - a))
        if length < 1.2:
            continue
        tangent = (b - a) / length
        normal = np.array([tangent[1], -tangent[0]])
        for k in range(int(length)):
            p = a + tangent * (k + .5) - normal * .17
            parts.append(box((p[0], top_y + .3, p[1]), (.25, .3, .15), yaw=yaw_for_x_axis(tangent), material=material))
    return parts


def wind_tower(poly, roof_y, material):
    """A square wind tower (barjeel) on the roof, with dark vents near its top."""
    q = poly.buffer(-2.0).representative_point() if not poly.buffer(-2.0).is_empty else poly.representative_point()
    parts = [box((q.x, roof_y + 2.4, q.y), (1.1, 2.4, 1.1), material=material)]
    for dx, dz, yaw in ((1.12, 0, math.pi / 2), (-1.12, 0, math.pi / 2), (0, 1.12, 0), (0, -1.12, 0)):
        parts.append(box((q.x + dx, roof_y + 3.6, q.y + dz), (.55, .9, .03), yaw=yaw, material=DETAIL_DARK))
    return parts


def dishes(poly, roof_y, count, at):
    inner = poly.buffer(-1.0)
    if inner.is_empty:
        return []
    minx, minz, maxx, maxz = inner.bounds
    parts = []
    for k in range(int(count)):
        x = minx + (maxx - minx) * _hash01(at, f"dx{k}")
        z = minz + (maxz - minz) * _hash01(at, f"dz{k}")
        if not inner.contains(Point(x, z)):
            continue
        parts.append(box((x, roof_y + .45, z), (.03, .45, .03), material=DETAIL_DARK))
        parts.append(cylinder(x, roof_y + .85, z, .42, .06, DETAIL_LIGHT, sides=8))
    return parts


def flag_fields(route, frame, ground):
    """The route's `prayerFlagFields`: strings of prayer flags fanning from a pole down a slope, as on
    the hills and at the shrines of a Tibetan city. `ground(points (n, 2))` gives the ground height.
    Each field is {lat, lon, radiusM, lines, poleM}."""
    parts = []
    for f in route.get("prayerFlagFields", ()):
        x, z = frame.to_local(np.array([f["lat"]]), np.array([f["lon"]]))
        cx, cz = float(x[0]), float(z[0])
        pole_m, radius, lines = float(f.get("poleM", 6.0)), float(f["radiusM"]), int(f.get("lines", 16))
        base = float(ground(np.array([[cx, cz]]))[0])
        top = base + pole_m
        parts.append(box((cx, base + pole_m / 2, cz), (.08, pole_m / 2, .08), material=DETAIL_DARK))
        at = (cx, cz)
        for k in range(lines):
            a = 2 * math.pi * (k + .37 * _hash01(at, f"a{k}")) / lines
            r = radius * (.55 + .45 * _hash01(at, f"r{k}"))
            ex, ez = cx + r * math.cos(a), cz + r * math.sin(a)
            ey = float(ground(np.array([[ex, ez]]))[0]) + 1.2
            span = math.hypot(r, top - ey)
            parts.append(sag_strip((cx, top, cz), (ex, ey, ez), span * .1, FLAGS))
    return parts
