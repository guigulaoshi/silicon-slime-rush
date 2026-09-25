import hashlib
import json

import pytest
from PIL import Image

import garage_images


@pytest.mark.parametrize('changed', ['pickup.glb', 'trailer.glb', 'reference'])
def test_conversion_refuses_stale_vehicle_or_trailer_render(tmp_path, monkeypatch, changed):
    monkeypatch.setattr(garage_images, 'ROOT', tmp_path)
    catalogue = tmp_path / 'game/src/vehicles/catalogue.json'
    catalogue.parent.mkdir(parents=True)
    catalogue.write_text(json.dumps({'vehicles': [{'id': 'pickup', 'trailer': {'id': 'trailer'}}]}))
    models = tmp_path / 'game/public/models/cars'
    models.mkdir(parents=True)
    paths = {name: models / name for name in ['pickup.glb', 'trailer.glb']}
    for name, path in paths.items():
        path.write_bytes(name.encode())
    reference = tmp_path / 'docs/car-reference/pickup.png'
    reference.parent.mkdir(parents=True)
    Image.new('RGB', (12, 8), '#778899').save(reference)
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    record = reference.parent / 'rendered-models.json'
    record.write_text(json.dumps({'pickup': {'models': {name: sha(path) for name, path in paths.items()},
                                           'imageSha256': sha(reference)}}))
    garage_images.build()
    thumb = tmp_path / 'game/public/garage/pickup.webp'
    assert json.loads(record.read_text())['pickup']['thumbnailSha256'] == sha(thumb)
    old_thumb = thumb.read_bytes()
    (reference if changed == 'reference' else paths[changed]).write_bytes(b'changed')
    with pytest.raises(ValueError, match='render the current GLBs'):
        garage_images.build()
    assert thumb.read_bytes() == old_thumb
