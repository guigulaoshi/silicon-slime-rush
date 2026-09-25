#!/usr/bin/env python3
"""Make lightweight WebP copies of the catalogue's rendered vehicle images."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def build():
    vehicles = json.loads((ROOT / 'game/src/vehicles/catalogue.json').read_text())['vehicles']
    record_path = ROOT / 'docs/car-reference/rendered-models.json'
    records = json.loads(record_path.read_text())
    target = ROOT / 'game/public/garage'
    target.mkdir(parents=True, exist_ok=True)
    for vehicle in vehicles:
        source = ROOT / 'docs/car-reference' / f"{vehicle['id']}.png"
        record = records[vehicle['id']]
        bodies = [vehicle, *([vehicle['trailer']] if vehicle.get('trailer') else [])]
        models = {f"{body['id']}.glb": hashlib.sha256(
            (ROOT / 'game/public/models/cars' / f"{body['id']}.glb").read_bytes()).hexdigest()
            for body in bodies}
        if record['models'] != models or record['imageSha256'] != hashlib.sha256(source.read_bytes()).hexdigest():
            raise ValueError(f"{vehicle['id']}: render the current GLBs with assets-src/vehicles/render_garage_references.py first")
        with Image.open(source) as image:
            image.thumbnail((960, 640))
            output = target / f"{vehicle['id']}.webp"
            image.save(output, 'WEBP', quality=82, method=6)
            record['thumbnailSha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
            print(f'{output.name}: {output.stat().st_size} bytes')
    record_path.write_text(json.dumps(records, indent=2, sort_keys=True) + '\n')


if __name__ == '__main__':
    build()
