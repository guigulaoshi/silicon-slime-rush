"""Photographed CC0 materials (sr/photo_textures.py): pinned, verified, and optional offline."""
import hashlib
import json
import os

import pytest
from PIL import Image

from sr import photo_textures as pt


def _fake_pins(tmp_path, asset, blob):
    lock = tmp_path / "polyhaven.json"
    files = {k: {"url": f"https://example.invalid/{asset}_{k}.jpg", "md5": hashlib.md5(blob).hexdigest()}
             for k in pt.MAPS}
    lock.write_text(json.dumps({asset: {"metres": 2.0, "license": "CC0", "files": files}}))
    return lock


def _jpeg(size=64):
    import io
    out = io.BytesIO()
    Image.new("RGB", (size, size), (120, 110, 90)).save(out, format="JPEG")
    return out.getvalue()


def test_every_pick_is_pinned_with_a_checksum():
    pins = pt.pinned()
    for material, (asset, *_rest) in pt.PICKS.items():
        pin = pins[asset]
        assert pin["license"] == "CC0" and pin["metres"] > 0, material
        if asset.startswith("acg:"):
            assert len(pin["zip"]["sha256"]) == 64
        else:
            assert set(pin["files"]) == set(pt.MAPS) and all(len(f["md5"]) == 32 for f in pin["files"].values())


def test_offline_keeps_the_generated_texture(tmp_path, monkeypatch):
    blob = _jpeg()
    monkeypatch.setattr(pt, "LOCK", str(_fake_pins(tmp_path, "asphalt_04", blob)))
    monkeypatch.setattr(pt, "CACHE", str(tmp_path / "cache"))
    def offline(url):
        raise OSError("no network")
    monkeypatch.setattr(pt, "_get", offline)
    assert pt.write("road", str(tmp_path / "out"), 4.0, 88, log=lambda *_: None) is None


def test_a_file_that_does_not_match_its_pin_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(pt, "LOCK", str(_fake_pins(tmp_path, "asphalt_04", _jpeg())))
    monkeypatch.setattr(pt, "CACHE", str(tmp_path / "cache"))
    monkeypatch.setattr(pt, "_get", lambda url: _jpeg(32))          # upstream changed the file
    with pytest.raises(ValueError, match="md5"):
        pt.write("road", str(tmp_path / "out"), 4.0, 88)


def test_a_pinned_download_writes_colour_normal_roughness_and_its_entry(tmp_path, monkeypatch):
    blob = _jpeg(128)
    monkeypatch.setattr(pt, "LOCK", str(_fake_pins(tmp_path, "asphalt_04", blob)))
    monkeypatch.setattr(pt, "CACHE", str(tmp_path / "cache"))
    monkeypatch.setattr(pt, "_get", lambda url: blob)
    out = tmp_path / "out"; out.mkdir()
    entry = pt.write("road", str(out), 4.0, 88)
    assert entry["mapping"] == "uv" and entry["repeat"] == [2.0, 2.0]       # 4 m of ribbon uv / 2 m image
    for key in ("map", "normalMap", "roughnessMap"):
        assert os.path.exists(out / entry[key])
    assert Image.open(out / entry["roughnessMap"]).size == (512, 512)
    assert "CC0" in entry["source"]
