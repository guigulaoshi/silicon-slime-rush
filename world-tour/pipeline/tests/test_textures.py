"""What a generated texture has to be true about itself before it goes on a street.

Three things, and each has cost something somewhere before:

- **It tiles.** A texture whose left edge is not its right edge draws a grid over a whole road at
  the repeat distance. That is worse than the flat colour it replaced, and it is invisible in a
  single screenshot of the file.
- **It is the same every time.** These are build output, not committed files, so two trees must
  produce the same bytes or the visual baseline compares one tree's concrete against another's.
- **The manifest's `repeat` really is `uv_metres / metres`.** The runtime acts on `repeat` alone
  and deliberately does not re-derive it (`docs/CONTRACT.md` section 11). That makes the pipeline
  the only author, which is only safe if something checks the arithmetic here.
"""
import inspect
import json
import os

import numpy as np
import pytest

from sr import textures
from sr.export import MATERIALS
from sr.mesh import BUILDING_UV_METRES, RIBBON_UV_METRES, vertical_strip

SPECS = textures.SPECS
# Every image a spec produces, not every spec: a material can have a colour map and a roughness
# map, and the roughness map is the one nobody looks at directly. It has to tile and be
# deterministic for exactly the same reasons -- a roughness map that does not wrap draws a grid of
# gloss down the road, at night, in the headlight beam, which is the most visible place there is.
IMAGES = [(spec, kind) for spec in SPECS
          for kind in ("make",) + (("rough",) if spec.rough is not None else ())]


def rendered(spec, kind="make"):
    """The same two arguments `textures.render` uses, so this cannot drift away from what ships."""
    if kind == "rough":
        return spec.rough(np.random.default_rng(textures.seed_for(spec.material + ":rough")),
                          spec.rough_px)
    return spec.make(np.random.default_rng(textures.seed_for(spec.material)), spec.px)


@pytest.mark.parametrize("spec,kind", IMAGES, ids=lambda a: a if isinstance(a, str) else a.material)
def test_the_image_wraps_at_both_edges(spec, kind):
    """The seam must not be the worst joint in the image.

    Measured against the image's own column-to-column steps rather than an absolute epsilon,
    because "the seam is small" is satisfied by a flat grey and says nothing. The denominator is
    every one of the px-1 interior joints: if the wrap is no bigger a step than the biggest step
    the picture already contains, no eye will find it.
    """
    img = rendered(spec, kind)
    for axis, name in ((1, "x"), (0, "y")):
        rolled = np.roll(img, 1, axis=axis)
        joints = np.abs(np.diff(img, axis=axis)).mean(axis=1 - axis).mean(axis=-1)
        seam = np.abs(img - rolled).take(0, axis=axis).mean()
        assert joints.max() > 0, "a flat image would pass this test vacuously"
        assert seam <= joints.max(), (
            f"{spec.material}/{kind}: the {name} seam steps {seam:.5f}, more than the biggest joint "
            f"inside the image ({joints.max():.5f}) -- it will read as a grid down the street")


@pytest.mark.parametrize("spec,kind", IMAGES, ids=lambda a: a if isinstance(a, str) else a.material)
def test_the_same_spec_renders_the_same_pixels_twice(spec, kind):
    assert np.array_equal(rendered(spec, kind), rendered(spec, kind))


def test_every_image_a_spec_ships_is_covered_by_the_two_tests_above():
    ""
    shipped = sum(1 + (1 if spec.rough is not None else 0) for spec in SPECS)
    assert len(IMAGES) == shipped
    assert any(kind == "rough" for _spec, kind in IMAGES), "no roughness map is being checked"


def test_each_material_draws_its_own_seed():
    """Adding a texture must not change the ones already shipped, so the seed comes from the name
    rather than from a counter or from the order of SPECS."""
    seeds = {s.material: textures.seed_for(s.material) for s in SPECS}
    assert len(set(seeds.values())) == len(seeds)
    assert textures.seed_for("sidewalk") == textures.seed_for("sidewalk")
    assert textures.seed_for("sidewalk") != textures.seed_for("road")


@pytest.mark.parametrize("spec", SPECS, ids=lambda s: s.material)
def test_the_material_is_one_the_contract_knows(spec):
    assert spec.material in MATERIALS


@pytest.mark.parametrize("spec", SPECS, ids=lambda s: s.material)
def test_repeat_is_the_uv_scale_over_what_the_image_depicts(spec):
    u, v = spec.repeat
    assert u == pytest.approx(spec.uv_metres[0] / spec.metres)
    assert v == pytest.approx(spec.uv_metres[1] / spec.metres)


@pytest.mark.parametrize("spec", SPECS, ids=lambda s: s.material)
def test_every_spec_reads_its_uv_scale_off_the_geometry_that_wears_it(spec):
    """Not a restatement of the line above: this one says the number came from `sr.mesh` rather
    than being typed here, and that it is the right one of the two.

    There are two families of textured geometry and they have different uv scales: ribbons (roads,
    bridge decks, walks) and building walls. Picking the wrong constant does not fail anything at
    build time -- it just makes the asphalt or the windows the wrong size on every track."""
    walls = spec.material.startswith("building") or spec.material == "ruin_stone"   # ruins are extruded walls
    family = BUILDING_UV_METRES if walls else RIBBON_UV_METRES
    assert spec.uv_metres == (family, family)


def test_the_contract_states_the_ribbon_uv_scale_this_code_uses():
    """`docs/CONTRACT.md` is where the two sides agree on it, so it has to say the same number.
    Same guard the facade scale already has (`tests/test_buildings.py`)."""
    import re
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    with open(os.path.join(root, "docs", "CONTRACT.md"), encoding="utf-8") as fh:
        doc = fh.read()
    m = re.search(r"ribbon_uv_metres = ([0-9.]+)", doc)
    assert m, "docs/CONTRACT.md no longer states ribbon_uv_metres"
    assert float(m.group(1)) == RIBBON_UV_METRES


def test_a_ribbon_writes_metres_on_both_axes_whatever_its_width():
    """The reason `v` stopped being 0..1. Two ribbons of different widths, same texture: a metre of
    surface has to be a metre of uv on both of them, or the asphalt changes size with the road."""
    from sr.mesh import ribbon
    P = np.stack([np.arange(0, 20, 2.0), np.zeros(10), np.zeros(10)], axis=1)
    R = np.tile(np.array([0.0, 0.0, 1.0]), (10, 1))
    for half in (2.0, 9.0):
        m = ribbon(P, R, np.full(10, half))
        assert m.uvs[:, 1].min() == pytest.approx(-half / RIBBON_UV_METRES)
        assert m.uvs[:, 1].max() == pytest.approx(half / RIBBON_UV_METRES)
        assert m.uvs[:, 0].max() == pytest.approx(18.0 / RIBBON_UV_METRES)


def test_the_kerb_face_under_a_sidewalk_is_on_the_same_uv_scale_as_the_walk():
    """`sidewalk` geometry is two pieces, not one: the ribbon a pedestrian walks on and the
    vertical strip dropping to the road (pipeline/sr/roads.py:sidewalks). One texture covers both.
    While the strip carried its own literal 4.0, moving RIBBON_UV_METRES would have shifted the
    joints on the walk and left the kerb where it was, and the two would visibly stop lining up --
    with the test above still green, because it only looks at the ribbon half."""
    assert inspect.signature(vertical_strip).parameters["uv_scale"].default == RIBBON_UV_METRES


def test_write_puts_the_files_and_the_manifest_where_it_says(tmp_path):
    # the generated set on its own; the photographed CC0 scans that replace some of these are
    # tests/test_photo_textures.py's business
    manifest = textures.write(str(tmp_path), photos=())
    assert manifest["version"] == textures.MANIFEST_VERSION
    assert len(manifest["textures"]) == len(SPECS)
    on_disk = json.loads((tmp_path / textures.MANIFEST).read_text(encoding="utf-8"))
    assert on_disk == manifest
    for entry in manifest["textures"]:
        files = [entry["map"]] + ([entry["roughnessMap"]] if "roughnessMap" in entry else [])
        for name in files:
            assert (tmp_path / name).is_file(), name
        # `bytes` is the material's whole cost, both images, because reports need the whole download
        assert entry["bytes"] == sum(os.path.getsize(tmp_path / n) for n in files) > 0
        assert entry["tier"] in ("core", "later")
        assert entry["px"] & (entry["px"] - 1) == 0, "not a power of two, mips will be wrong"
        assert entry["repeat"][0] > 0 and entry["repeat"][1] > 0


def test_a_spec_pushed_to_a_silly_resolution_fails_here_rather_than_at_the_version_gate(tmp_path):
    """Deliberately not a limit check. `tools/resource_limits.json` is the only owner of
    what "too big" means; repeating its numbers here would mean raising one and watching the other
    disagree for no reason, or lowering one and watching this stay green while the gate fails. What
    this owns is the shape a texture has to have at all: square, a power of two, and something the
    encoder actually wrote."""
    manifest = textures.write(str(tmp_path))
    for entry in manifest["textures"]:
        assert 64 <= entry["px"] <= 2048, entry["material"]
        assert entry["bytes"] > 0
        if "roughnessMap" in entry:
            assert (tmp_path / entry["roughnessMap"]).is_file()
            assert 64 <= entry["roughPx"] <= entry["px"], "roughness bigger than colour"


def test_manifest_window_masks_share_the_painted_pane_parameters(tmp_path):
    specs = tuple(s for s in SPECS if s.material in textures.FACADE_PANES)
    manifest = textures.write(str(tmp_path), specs)
    assert len(manifest["textures"]) == 3
    for entry in manifest["textures"]:
        across, up, mullion = entry["facadePanes"]
        assert (across, up, mullion) == textures.FACADE_PANES[entry["material"]]
        mask = textures.facade_panes(entry["material"], entry["px"])
        assert np.array_equal(mask, textures._panes(entry["px"], across, up, mullion))
        assert mask.min() == 0 and mask.max() == 1
