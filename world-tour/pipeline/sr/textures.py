""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from typing import Callable

import numpy as np
from PIL import Image

from sr.mesh import BUILDING_UV_METRES, RIBBON_UV_METRES

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, "game", "public", "textures")
MANIFEST = "manifest.json"
MANIFEST_VERSION = 1
# WebP, not KTX2. The trade is measured in docs/CONTRACT.md section 11; the short version is that
# this project's texture set is small enough that GPU-compressed formats buy VRAM we are not short
# of, at the cost of a wasm transcoder in every session and an encoder binary in the pipeline.
QUALITY = 88
SUFFIX = ".webp"


def _lattice(rng: np.random.Generator, px: int, cells: int) -> np.ndarray:
    """One octave of value noise on a torus: a `cells`x`cells` grid, smoothly resampled to `px`.

    The wrap is in the `% cells`, and it is the whole point: the sample at px-1 interpolates back
    towards the sample at 0, so the image is periodic before anything else is done to it.
    """
    grid = rng.random((cells, cells), dtype=np.float64)
    t = np.arange(px, dtype=np.float64) * cells / px
    i0 = np.floor(t).astype(int) % cells
    i1 = (i0 + 1) % cells
    f = t - np.floor(t)
    f = f * f * (3.0 - 2.0 * f)                       # smoothstep, so octaves do not show as facets
    rows = grid[i0] * (1 - f)[:, None] + grid[i1] * f[:, None]
    return rows[:, i0] * (1 - f)[None, :] + rows[:, i1] * f[None, :]


def _fbm(rng: np.random.Generator, px: int, cells: int, octaves: int = 4) -> np.ndarray:
    """Several lattices, each twice as fine and half as strong. Returns roughly 0..1, mean 0.5."""
    total = np.zeros((px, px))
    amplitude, weight = 1.0, 0.0
    for k in range(octaves):
        c = min(cells << k, px)
        total += amplitude * _lattice(rng, px, c)
        weight += amplitude
        amplitude *= 0.5
    return total / weight


def _groove(px: int, position: float, width_uv: float) -> np.ndarray:
    """A soft dark line across the image at `position` (0..1 in uv), wrapping at the edges."""
    u = np.arange(px, dtype=np.float64) / px
    d = np.abs(((u - position + 0.5) % 1.0) - 0.5)     # distance to the line, the short way round
    return np.clip(1.0 - d / max(width_uv, 1e-6), 0.0, 1.0)


def _ridges(rng: np.random.Generator, px: int, cells: int, octaves: int = 3) -> np.ndarray:
    """Thin winding filaments: the ridge of a noise field rather than its value.

    `1 - |2f - 1|` peaks wherever the noise crosses its own midpoint, which is a set of closed
    curves rather than blobs. Thresholded near the top it reads as cracking, which is what tells a
    driver a road is old -- flat noise reads as gravel however dark it is.
    """
    f = _fbm(rng, px, cells, octaves)
    return 1.0 - np.abs(2.0 * f - 1.0)


def _smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _rgb(base: tuple[float, float, float], value: np.ndarray) -> np.ndarray:
    """Tint a single-channel field with a base colour, keeping it in 0..1."""
    return np.clip(value[:, :, None] * np.asarray(base, dtype=np.float64)[None, None, :], 0.0, 1.0)


def _sidewalk(rng: np.random.Generator, px: int) -> np.ndarray:
    """Poured concrete pavement: warm grey, fine aggregate, a joint every slab, a little staining.

    Bay Area sidewalk is not the blue-grey of fresh concrete -- it is sun-bleached and warm, which
    is why the base here is redder in x than in z. The joint is one line rather than a grid because
    this texture is two metres of a walk that is about two metres wide: the transverse joints are
    the ones a driver sees going past, and the longitudinal one sits under the kerb.
    """
    aggregate = _fbm(rng, px, cells=px // 16, octaves=4)
    stain = _fbm(rng, px, cells=4, octaves=3)
    value = 0.88 + 0.17 * (aggregate - 0.5) + 0.09 * (stain - 0.5)
    joint = _groove(px, position=0.0, width_uv=0.012)[None, :]     # constant-u line, full width
    value = value * (1.0 - 0.34 * joint) * np.ones((px, 1))
    return _rgb((0.735, 0.720, 0.688), value)


def asphalt(base: tuple[float, float, float]) -> Callable[[np.random.Generator, int], np.ndarray]:
    ""
    def make(rng: np.random.Generator, px: int) -> np.ndarray:
        aggregate = _fbm(rng, px, cells=px // 3, octaves=3)
        chips = _fbm(rng, px, cells=px // 5, octaves=2)
        patches = _fbm(rng, px, cells=3, octaves=3)
        # High frequency and a narrow threshold: the crack has to be a hairline. A broad one at low
        # frequency does not read as a crack at all, it reads as camouflage, and at four metres per
        # tile the same blotch appears every four metres down the road.
        cracks = _ridges(rng, px, cells=22, octaves=3)
        value = 1.0 + 0.40 * (aggregate - 0.5) + 0.08 * (patches - 0.5)
        value = value + 0.50 * _smoothstep(0.86, 0.98, chips)  # exposed stone, bright and sparse
        value = value * (1.0 - 0.30 * _smoothstep(0.980, 1.0, cracks))
        return _rgb(base, value)
    return make


def _asphalt_roughness(rng: np.random.Generator, px: int) -> np.ndarray:
    """How polished the surface is, at a much coarser scale than its colour.

    Asphalt is almost entirely diffuse -- 0.98 -- except where traffic and oil have polished it, and
    those areas are metres across, not centimetres. So this is one low-frequency field and a small
    image: the entry that asked for it said.
    """
    wear = _fbm(rng, px, cells=3, octaves=3)
    return _rgb((1.0, 1.0, 1.0), 0.80 + 0.18 * wear)


def _panes(px: int, across: float, up: float, mullion: float) -> np.ndarray:
    """A grid of window panes: 1 inside a pane, 0 on the frame between them.

    `across` and `up` are how many panes fit in one repeat of the image; `mullion` is the frame
    width as a fraction of a pane. Built from wrapped distances so the frame at the seam is one
    frame, not two half ones.
    """
    u = (np.arange(px) + 0.5) / px
    fu = np.abs(((u * across) % 1.0) - 0.5) * 2.0        # 0 at the centre of a pane, 1 at its edge
    fv = np.abs(((u * up) % 1.0) - 0.5) * 2.0
    edge = 1.0 - mullion
    return (_smoothstep(edge, edge - 0.06, fv)[:, None] * _smoothstep(edge, edge - 0.06, fu)[None, :])


# Shared by the painted panes and the runtime reflection/night mask.
FACADE_PANES = {
    "building_glass": (2.0, 1.0, 0.10),
    "building_stucco": (1.0, 1.0, 0.34),
    "building_landmark_glass": (3.0, 1.0, 0.08),
}


def facade_panes(material, px):
    across, up, mullion = FACADE_PANES[material]
    return _panes(px, across=across, up=up, mullion=mullion)


def _curtain_wall(rng: np.random.Generator, px: int) -> np.ndarray:
    """Blue-green glass and dark mullions: the Valley office park in one image.

    Two panes wide and one floor tall per three metres, which is what `facade_uv_metres` says one
    repeat covers. The glass is not one colour: real curtain wall shows a different slice of sky in
    every pane, and a facade where every pane matches reads as printed paper.
    """
    pane = facade_panes("building_glass", px)
    sky = _fbm(rng, px, cells=8, octaves=2)             # what each pane happens to be reflecting
    grime = _fbm(rng, px, cells=px // 8, octaves=3)
    glass = np.stack([0.10 + 0.10 * sky, 0.22 + 0.14 * sky, 0.26 + 0.16 * sky], axis=-1)
    glass *= (0.94 + 0.12 * grime)[:, :, None]
    frame = np.full((px, px, 3), 0.20)
    return np.clip(glass * pane[:, :, None] + frame * (1.0 - pane[:, :, None]), 0.0, 1.0)


def _stucco(rng: np.random.Generator, px: int) -> np.ndarray:
    """Warm painted render with a punched window: Bay Area houses and low apartment blocks."""
    wall = _fbm(rng, px, cells=px // 6, octaves=4)
    blotch = _fbm(rng, px, cells=5, octaves=3)
    base = np.stack([0.72 + 0.10 * blotch, 0.66 + 0.09 * blotch, 0.56 + 0.08 * blotch], axis=-1)
    base *= (0.93 + 0.14 * wall)[:, :, None]
    hole = facade_panes("building_stucco", px)  # one window per three metres, deep reveal
    dark = np.stack([0.14 + 0.10 * _fbm(rng, px, cells=6, octaves=2)] * 3, axis=-1)
    return np.clip(base * (1.0 - hole[:, :, None]) + dark * hole[:, :, None], 0.0, 1.0)


def _concrete(rng: np.random.Generator, px: int) -> np.ndarray:
    """Board-formed concrete with panel joints: schools, hospitals, civic blocks."""
    grain = _fbm(rng, px, cells=px // 4, octaves=3)
    stain = _fbm(rng, px, cells=4, octaves=3)
    value = 0.90 + 0.13 * (grain - 0.5) + 0.10 * (stain - 0.5)
    # The joints sit at the middle of the image, not at its edge: a hard line exactly on the wrap
    # makes the seam the sharpest step in the picture, which is the one thing the tiling test is
    # there to catch, and the panel grid comes out the same either way.
    joint = np.maximum(_groove(px, 0.5, 0.006)[None, :], _groove(px, 0.5, 0.006)[:, None])
    value = value * (1.0 - 0.40 * joint)
    return _rgb((0.62, 0.61, 0.59), value)


def _corrugated(rng: np.random.Generator, px: int) -> np.ndarray:
    """Vertical ribbed metal: warehouses and the sheds behind every campus."""
    u = (np.arange(px) + 0.5) / px
    rib = 0.5 + 0.5 * np.cos(2 * np.pi * u * 12.0)      # twelve ribs across three metres
    dirt = _fbm(rng, px, cells=px // 10, octaves=3)
    value = (0.80 + 0.30 * rib)[None, :] * (0.95 + 0.10 * dirt)
    return _rgb((0.60, 0.62, 0.63), value)


def _parking_deck(rng: np.random.Generator, px: int) -> np.ndarray:
    """A parking structure: a wide dark opening under every floor's spandrel beam.

    The one facade a driver names without being told -- horizontal slots, no glass, concrete.
    """
    v = (np.arange(px) + 0.5) / px
    opening = _smoothstep(0.30, 0.36, v) * (1.0 - _smoothstep(0.80, 0.86, v))
    grain = _fbm(rng, px, cells=px // 5, octaves=3)
    beam = _rgb((0.60, 0.59, 0.57), 0.92 + 0.12 * (grain - 0.5))
    dark = _rgb((0.10, 0.10, 0.11), 0.9 + 0.4 * _fbm(rng, px, cells=8, octaves=2))
    m = opening[:, None, None]
    return np.clip(beam * (1.0 - m) + dark * m, 0.0, 1.0)


def _landmark_glass(rng: np.random.Generator, px: int) -> np.ndarray:
    """Dark blue-green curtain wall with broad pale floor bands and narrow mullions."""
    pane = facade_panes("building_landmark_glass", px)
    reflected = _fbm(rng, px, cells=9, octaves=3)
    glass = np.stack([0.08 + 0.09 * reflected,
                      0.19 + 0.14 * reflected,
                      0.22 + 0.17 * reflected], axis=-1)
    frame = np.full((px, px, 3), (0.68, 0.69, 0.67))
    return np.clip(glass * pane[:, :, None] + frame * (1.0 - pane[:, :, None]), 0.0, 1.0)


def _landmark_pale(rng: np.random.Generator, px: int) -> np.ndarray:
    """Weathered warm concrete used by the Alcatraz cellhouse and overlook structures."""
    grain = _fbm(rng, px, cells=px // 5, octaves=3)
    streak = _fbm(rng, px, cells=5, octaves=3)
    value = 0.90 + 0.12 * (grain - 0.5) - 0.10 * np.maximum(0.0, streak - 0.58)
    joint = _groove(px, 0.5, 0.005)[None, :]
    return _rgb((0.79, 0.76, 0.68), value * (1.0 - 0.18 * joint))


def _ruin_stone(rng: np.random.Generator, px: int) -> np.ndarray:
    """Weathered ashlar with lost blocks and dark joints: excavated tombs and ruined walls. No windows.

    Three metres per image, courses of 0.5 m and blocks of about a metre, a few of them eroded back."""
    u = (np.arange(px) + 0.5) / px
    row = np.floor(u * 6.0)[:, None] * np.ones((1, px))
    shift = (row % 2) * 0.5
    col = np.floor(u[None, :] * 3.0 + shift)
    fv = (u * 6.0)[:, None] % 1.0
    fu = (u[None, :] * 3.0 + shift) % 1.0
    joint = np.maximum(_smoothstep(0.06, 0.0, np.minimum(fv, 1 - fv)), _smoothstep(0.03, 0.0, np.minimum(fu, 1 - fu)))
    pick = ((row * 7919 + col * 104729) % 97) / 97.0
    grain = _fbm(rng, px, cells=px // 6, octaves=4)
    wear = _fbm(rng, px, cells=6, octaves=3)
    value = (0.84 + 0.2 * pick) * (0.86 + 0.24 * grain) * (1.0 - 0.18 * np.maximum(0.0, wear - 0.6) * 3)
    value = value * (1.0 - 0.45 * joint)
    return _rgb((0.78, 0.71, 0.58), value)


def _landmark_solar(rng: np.random.Generator, px: int) -> np.ndarray:
    ""
    u = (np.arange(px) + 0.5) / px
    x, y = np.meshgrid(u, u)
    cols, rows = 2.0, 3.0
    fx, fy = (x * cols) % 1.0, (y * rows) % 1.0
    frame_w = 0.035 / 1.5, 0.035 / 1.0            # 3.5 cm aluminium frame in each module's own units
    frame = np.maximum(_smoothstep(frame_w[0] * 1.4, frame_w[0], np.minimum(fx, 1.0 - fx)),
                       _smoothstep(frame_w[1] * 1.4, frame_w[1], np.minimum(fy, 1.0 - fy)))
    cx, cy = (fx * 6.0) % 1.0, (fy * 4.0) % 1.0
    cells = np.maximum(_smoothstep(0.035, 0.0, np.minimum(cx, 1.0 - cx)),
                       _smoothstep(0.05, 0.0, np.minimum(cy, 1.0 - cy)))
    module = (np.floor(x * cols) + 7 * np.floor(y * rows)).astype(int)
    tint = rng.uniform(-0.025, 0.025, size=int(cols * rows) * 8)[module]
    shimmer = _fbm(rng, px, cells=6, octaves=2)
    glass = np.stack([0.075 + 0.05 * shimmer + tint,
                      0.105 + 0.06 * shimmer + tint,
                      0.175 + 0.08 * shimmer + tint], axis=-1)
    glass = glass * (1.0 - 0.35 * cells[:, :, None])
    silver = np.array((0.60, 0.62, 0.63))
    return np.clip(glass * (1.0 - frame[:, :, None]) + silver * frame[:, :, None], 0.0, 1.0)


def _landmark_roof(rng: np.random.Generator, px: int) -> np.ndarray:
    """Off-white standing-seam roof panels; visible mass instead of an unlit paper plane."""
    grain = _fbm(rng, px, cells=px // 6, octaves=3)
    value = 0.93 + 0.08 * (grain - 0.5)
    # Centre the standing seam in the tile. Putting it on the wrap boundary made the two edge
    # samples differ by one anti-aliased pixel, which showed up as a dark line on a broad roof.
    seams = _groove(px, 0.5, 0.010)[None, :]
    return _rgb((0.83, 0.83, 0.79), value * (1.0 - 0.25 * seams))


@dataclass(frozen=True)
class TextureSpec:
    """One material's texture, and everything the manifest has to say about it.

    `metres` is what the image depicts -- the world distance one repeat of it covers. `uv_metres`
    is the metres-per-uv-unit the pipeline already wrote into that material's geometry. The runtime
    needs neither: it needs `repeat`, and `repeat` is the one divided by the other. Keeping all
    three in the manifest is not three owners of one fact, it is a derivation a person can check by
    eye and `tests/test_textures.py` checks by arithmetic.
    """
    material: str
    metres: float
    uv_metres: tuple[float, float]
    px: int
    tier: str                                          # "core" before the car moves, else "later"
    make: Callable[[np.random.Generator, int], np.ndarray]
    # Optional roughness, and deliberately its own resolution: how polished a surface is varies
    # over metres while its colour varies over centimetres, so this is normally much the smaller
    # image. three.js reads the green channel of it (`MeshStandardMaterial.roughnessMap`).
    rough: Callable[[np.random.Generator, int], np.ndarray] | None = None
    rough_px: int = 0

    @property
    def repeat(self) -> tuple[float, float]:
        return (self.uv_metres[0] / self.metres, self.uv_metres[1] / self.metres)

    @property
    def filename(self) -> str:
        return self.material + SUFFIX

    @property
    def rough_filename(self) -> str:
        return self.material + "_rough" + SUFFIX


# Everything here is ribbon geometry -- the race surface, the bridge deck, the walks beside them --
# and a ribbon's uv is metres over RIBBON_UV_METRES on both axes (sr/mesh.py). So the repeat is that
# number over what the image depicts, on both axes, and it is imported rather than written down
# again: change the ribbon scale and these follow, instead of claiming a repeat nobody recomputed.
RIBBON_UV = (RIBBON_UV_METRES, RIBBON_UV_METRES)
BUILDING_UV = (BUILDING_UV_METRES, BUILDING_UV_METRES)

SPECS: tuple[TextureSpec, ...] = (
    # The road is core and the largest image in the set, because it is what the player is looking
    # at: four metres of it at 1024 is 3.9 mm per pixel, about the size of one stone in the mix,
    # and one image serves every tile on every track.
    TextureSpec(material="road", metres=4.0, uv_metres=RIBBON_UV, px=1024, tier="core",
                make=asphalt((0.225, 0.224, 0.238)), rough=_asphalt_roughness, rough_px=512),
    # The bridge deck: the same asphalt a shade lighter. It gets its own image rather than sharing
    # the road's, so the grain does not repeat identically where a bridge meets its approach.
    TextureSpec(material="bridge", metres=4.0, uv_metres=RIBBON_UV, px=1024, tier="core",
                make=asphalt((0.247, 0.246, 0.259)), rough=_asphalt_roughness, rough_px=512),
    TextureSpec(material="sidewalk", metres=2.0, uv_metres=RIBBON_UV, px=512, tier="core",
                make=_sidewalk),
    # Facades. A building's uv is metres over BUILDING_UV_METRES on both axes -- arc length along
    # the wall, height above that building's own base (docs/CONTRACT.md section 4) -- so a texture
    # that depicts exactly that many metres repeats once per unit and needs no scaling at all.
    # 512 rather than 1024: three metres of wall at 512 is 5.9 mm per pixel, and a facade is never
    # as close to the camera as the road under the car.
    TextureSpec(material="building_glass", metres=BUILDING_UV_METRES, uv_metres=BUILDING_UV,
                px=512, tier="core", make=_curtain_wall),
    TextureSpec(material="building_stucco", metres=BUILDING_UV_METRES, uv_metres=BUILDING_UV,
                px=512, tier="core", make=_stucco),
    TextureSpec(material="building_concrete", metres=BUILDING_UV_METRES, uv_metres=BUILDING_UV,
                px=512, tier="core", make=_concrete),
    TextureSpec(material="building_metal", metres=BUILDING_UV_METRES, uv_metres=BUILDING_UV,
                px=512, tier="core", make=_corrugated),
    TextureSpec(material="building_parking", metres=BUILDING_UV_METRES, uv_metres=BUILDING_UV,
                px=512, tier="core", make=_parking_deck),
    # Distinctive buildings. These are reference-driven rather than assigned by footprint type;
    # 1024 leaves roof shingles and broad facade bands readable from the racing line. The player
    # can start without them, so they are marked later even though the current loader fetches the
    # compact manifest together.
    TextureSpec(material="building_landmark_glass", metres=BUILDING_UV_METRES,
                uv_metres=BUILDING_UV, px=1024, tier="later", make=_landmark_glass),
    TextureSpec(material="building_landmark_pale", metres=BUILDING_UV_METRES,
                uv_metres=BUILDING_UV, px=512, tier="later", make=_landmark_pale),
    TextureSpec(material="building_landmark_solar", metres=BUILDING_UV_METRES,
                uv_metres=BUILDING_UV, px=1024, tier="later", make=_landmark_solar),
    TextureSpec(material="building_landmark_metal", metres=BUILDING_UV_METRES,
                uv_metres=BUILDING_UV, px=1024, tier="later", make=_corrugated),
    TextureSpec(material="building_landmark_roof", metres=BUILDING_UV_METRES,
                uv_metres=BUILDING_UV, px=512, tier="later", make=_landmark_roof),
    TextureSpec(material="ruin_stone", metres=BUILDING_UV_METRES, uv_metres=BUILDING_UV,
                px=512, tier="later", make=_ruin_stone),
)


def seed_for(material: str) -> int:
    """A material's own seed, so adding a texture never changes the ones already shipped."""
    return int.from_bytes(hashlib.sha256(material.encode("utf-8")).digest()[:8], "big")


def render(spec: TextureSpec, rough: bool = False) -> Image.Image:
    """One image. The roughness map draws its own seed so it is not the colour map in grey."""
    if rough:
        assert spec.rough is not None
        rgb = spec.rough(np.random.default_rng(seed_for(spec.material + ":rough")), spec.rough_px)
    else:
        rgb = spec.make(np.random.default_rng(seed_for(spec.material)), spec.px)
    return Image.fromarray(np.rint(rgb * 255.0).astype(np.uint8), mode="RGB")


def write(out_dir: str = OUT_DIR, specs: tuple[TextureSpec, ...] = SPECS, photos=None) -> dict:
    """Render every spec, write the images and the manifest, and return the manifest."""
    os.makedirs(out_dir, exist_ok=True)
    entries = []
    for spec in specs:
        path = os.path.join(out_dir, spec.filename)
        render(spec).save(path, format="WEBP", quality=QUALITY, method=6)
        entry = {
            "material": spec.material,
            "map": spec.filename,
            "px": spec.px,
            "metres": spec.metres,
            "repeat": [round(spec.repeat[0], 4), round(spec.repeat[1], 4)],
            "tier": spec.tier,
            "bytes": os.path.getsize(path),
        }
        if spec.material in FACADE_PANES:
            entry["facadePanes"] = list(FACADE_PANES[spec.material])
        if spec.rough is not None:
            rough_path = os.path.join(out_dir, spec.rough_filename)
            render(spec, rough=True).save(rough_path, format="WEBP", quality=QUALITY, method=6)
            entry["roughnessMap"] = spec.rough_filename
            entry["roughPx"] = spec.rough_px
            entry["bytes"] += os.path.getsize(rough_path)
        entries.append(entry)
    # Photographed CC0 scans (sr/photo_textures.py) replace a generated texture where one is picked,
    # and add the ground and rock materials that had none. Offline, the generated ones stand.
    from sr import photo_textures
    picks = photo_textures.PICKS if photos is None and specs is SPECS else (photos or ())
    for material in picks:
        photo = photo_textures.write(material, out_dir, RIBBON_UV_METRES, QUALITY)
        if photo is None:
            continue
        entries = [e for e in entries if e["material"] != material] + [photo]
    for material in (photo_textures.FOLIAGE if photos is None and specs is SPECS else ()):
        leaves = photo_textures.write_foliage(material, out_dir, QUALITY)
        if leaves is not None:
            entries = [e for e in entries if e["material"] != material] + [leaves]
    manifest = {"version": MANIFEST_VERSION, "textures": entries}
    with open(os.path.join(out_dir, MANIFEST), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return manifest
