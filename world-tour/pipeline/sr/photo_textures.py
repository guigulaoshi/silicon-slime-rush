"""Photographed PBR materials from Poly Haven and ambientCG (both CC0), in place of the generated ones.

A generated asphalt is a guess at asphalt; a scanned one is asphalt. the player asked for the best look
that open resources allow (, and
Poly Haven's textures are CC0: no attribution required, credited in ASSETS.md anyway.

- `PICKS` says which scan each material wears and how it is laid: `uv` for ribbons (their uv is
  metres over RIBBON_UV_METRES), `world` for ground (the tile terrain and the backdrop write uv at
  different scales, so the runtime lays these by world position), `triplanar` for rock faces.
- `polyhaven.json` next to the routes pins every file by URL and md5, so a build is reproducible and a
  changed upstream file is refused rather than silently shipped. `python -m sr.cli textures --lock`
  rewrites it from the Poly Haven API.
- The downloads live in `pipeline/cache/polyhaven/` (gitignored: 1K colour, normal and roughness maps
  are 1-2 MB each, and the pin makes them re-fetchable). Without network or cache the generated
  texture stays, so a fresh offline clone still builds.
"""
import hashlib
import json
import os
import urllib.request

from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCK = os.path.join(HERE, "assets", "polyhaven.json")
CACHE = os.path.join(HERE, "cache", "polyhaven")
UA = {"User-Agent": "SiliconSlimeRushWorldTour/1.0 (texture pipeline)"}
RES = "1k"
MAPS = {"map": "Diffuse", "normal": "nor_gl", "rough": "Rough"}

# material -> (Poly Haven asset, output px, tier, mapping[, metres per image if not the scan's own])
PICKS = {
    # asphalt_02 has transverse cracks: repeated every 3 m down a straight they read as a pattern.
    "road": ("asphalt_04", 1024, "core", "uv"),
    "bridge": ("asphalt_02", 1024, "core", "uv"),
    "sidewalk": ("concrete_pavers_02", 1024, "core", "uv"),
    "terrain": ("sparse_grass", 1024, "core", "world"),
    # Poly Haven's grasses are dry or sparse (leafy_grass read golden-yellow in the sun on a
    # subtropical hillside); ambientCG's Grass001 is a lush green lawn.
    "terrain_grass": ("acg:Grass001", 1024, "core", "world"),
    "terrain_scrub": ("aerial_ground_rock", 1024, "core", "world"),
    # forest_leaves_02 read golden in the sun between the trees; a mossy green floor reads as forest
    "terrain_wood": ("forrest_ground_01", 1024, "core", "world"),
    "terrain_sand": ("aerial_sand", 1024, "core", "world"),
    "terrain_rock": ("aerial_rocks_02", 1024, "core", "world"),
    "terrain_paved": ("concrete_floor_01", 1024, "core", "world"),
    # Wulingyuan's quartz sandstone is grey-buff, bedded and jointed (research card); this scan has
    # both. Its beds are ~0.3 m in a 2 m image; the real ones are 1-3 m, so it is laid at 10 m.
    "rock_sandstone": ("marble_cliff_03", 1024, "later", "triplanar", 10.0),
    "trunk": ("bark_brown_02", 512, "core", "triplanar", 1.2),
}


def _get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


ACG_MAPS = {"map": "_Color.jpg", "normal": "_NormalGL.jpg", "rough": "_Roughness.jpg", "opacity": "_Opacity.jpg"}

# Tree crowns: a tileable "leaf mass" composed from a CC0 atlas of single scanned leaves, laid on the
# crown in world space and cut out by its alpha. The crowns keep their few triangles; what changes is
# that light comes through the gaps and the silhouette is ragged leaves instead of a smooth blob.
# material -> (atlas, tint rgb, metres per image, leaves per image)
FOLIAGE = {
    "foliage": ("acg:LeafSet024", (0.66, 0.8, 0.56), 1.6, 420),
    "foliage_dark": ("acg:LeafSet024", (0.55, 0.78, 0.62), 1.2, 520),
    "foliage_orchard": ("acg:LeafSet024", (0.82, 0.9, 0.5), 1.6, 380),
    "foliage_scrub": ("acg:LeafSet024", (0.95, 0.9, 0.62), 1.2, 460),
    "foliage_acacia": ("acg:LeafSet024", (0.84, 0.86, 0.6), 1.0, 560),   # small grey-green leaflets
}
CUTOUT = 0.5


def _lock_acg(asset):
    """ambientCG ships a zip per resolution; pin the zip by sha256 (its API gives no checksum)."""
    ident = asset.split(":", 1)[1]
    api = json.loads(_get(f"https://ambientcg.com/api/v2/full_json?id={ident}&include=downloadData,dimensionsData"))
    found = api["foundAssets"][0]
    zips = found["downloadFolders"]["default"]["downloadFiletypeCategories"]["zip"]["downloads"]
    url = next(z["downloadLink"] for z in zips if z["attribute"] == "1K-JPG")
    blob = _get(url)
    metres = float(found.get("dimensionX") or 200) / 100.0
    return {"metres": round(metres, 3), "license": "CC0", "page": f"https://ambientcg.com/view?id={ident}",
            "zip": {"url": url, "sha256": hashlib.sha256(blob).hexdigest()}}


def lock():
    """Pin every picked asset's files (URL and checksum) and real-world size from the sources' APIs."""
    out = {}
    for asset in sorted({a for a, *_ in PICKS.values()} | {a for a, *_ in FOLIAGE.values()}):
        if asset.startswith("acg:"):
            out[asset] = _lock_acg(asset)
            continue
        info = json.loads(_get(f"https://api.polyhaven.com/info/{asset}"))
        files = json.loads(_get(f"https://api.polyhaven.com/files/{asset}"))
        out[asset] = {
            "metres": round(float(info["dimensions"][0]) / 1000.0, 3),
            "license": "CC0", "page": f"https://polyhaven.com/a/{asset}",
            "files": {key: {"url": files[kind][RES]["jpg"]["url"], "md5": files[kind][RES]["jpg"]["md5"]}
                      for key, kind in MAPS.items()},
        }
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    with open(LOCK, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    return out


def pinned():
    with open(LOCK, encoding="utf-8") as f:
        return json.load(f)


def _source_acg(asset, key, pins, log):
    import io
    import zipfile
    ident = asset.split(":", 1)[1]
    folder = os.path.join(CACHE, ident)
    path = os.path.join(folder, ident + "_1K-JPG" + ACG_MAPS[key])
    if os.path.exists(path):
        return path
    pin = pins[asset]["zip"]
    try:
        blob = _get(pin["url"])
    except Exception as err:
        log(f"  ambientcg {ident}: not downloaded ({err})")
        return None
    if hashlib.sha256(blob).hexdigest() != pin["sha256"]:
        raise ValueError(f"ambientcg {ident}: sha256 does not match the pin in {LOCK}")
    os.makedirs(folder, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for name in z.namelist():
            if any(name.endswith(suffix) for suffix in ACG_MAPS.values()):
                with open(os.path.join(folder, os.path.basename(name)), "wb") as f:
                    f.write(z.read(name))
    return path if os.path.exists(path) else None


def source(asset, key, pins, log=print):
    """Local path of one pinned file, downloading it if missing. None when it cannot be had."""
    if asset.startswith("acg:"):
        return _source_acg(asset, key, pins, log)
    pin = pins[asset]["files"][key]
    path = os.path.join(CACHE, asset, os.path.basename(pin["url"]))
    if os.path.exists(path) and hashlib.md5(open(path, "rb").read()).hexdigest() == pin["md5"]:
        return path
    try:
        blob = _get(pin["url"])
    except Exception as err:          # offline: the generated texture stands
        log(f"  polyhaven {asset} {key}: not downloaded ({err})")
        return None
    if hashlib.md5(blob).hexdigest() != pin["md5"]:
        raise ValueError(f"polyhaven {asset} {key}: md5 does not match the pin in {LOCK}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(blob)
    return path


def write(material, out_dir, uv_metres, quality, log=print):
    """Write one material's photographed maps; the manifest entry, or None to keep the generated one."""
    asset, px, tier, mapping, *scale = PICKS[material]
    pins = pinned()
    paths = {key: source(asset, key, pins, log) for key in MAPS}
    if not all(paths.values()):
        return None
    metres = scale[0] if scale else pins[asset]["metres"]
    names = {"map": f"{material}.webp", "normal": f"{material}_normal.webp", "rough": f"{material}_rough.webp"}
    sizes = {"map": px, "normal": px, "rough": px // 2}
    total = 0
    for key, name in names.items():
        image = Image.open(paths[key]).convert("RGB" if key != "rough" else "L")
        if image.size[0] != sizes[key]:
            image = image.resize((sizes[key], sizes[key]), Image.LANCZOS)
        if key == "rough":
            image = image.convert("RGB")          # three reads roughness from the green channel
        path = os.path.join(out_dir, name)
        image.save(path, format="WEBP", quality=quality if key == "map" else 92, method=6)
        total += os.path.getsize(path)
    repeat = [round(uv_metres / metres, 4)] * 2 if mapping == "uv" else [1.0, 1.0]
    return {"material": material, "map": names["map"], "px": px, "metres": metres, "repeat": repeat,
            "tier": tier, "bytes": total, "roughnessMap": names["rough"], "roughPx": sizes["rough"],
            "normalMap": names["normal"], "mapping": mapping,
            "source": (f"ambientCG {asset[4:]}" if asset.startswith("acg:") else f"Poly Haven {asset}") + " (CC0)"}


def _leaves(color, opacity, normal):
    """The single leaves of an atlas as (rgba, normal) crops, found as connected opaque regions."""
    import numpy as np
    from scipy import ndimage
    a = np.asarray(opacity.convert("L"), dtype=np.float32) / 255.0
    labels, count = ndimage.label(a > 0.5)
    rgb = np.asarray(color.convert("RGB"))
    nor = np.asarray(normal.convert("RGB"))
    out = []
    for sl in ndimage.find_objects(labels):
        if sl is None or (sl[0].stop - sl[0].start) < 20:
            continue
        rgba = np.dstack([rgb[sl], (a[sl] * 255).astype(np.uint8)])
        out.append((Image.fromarray(rgba, "RGBA"), Image.fromarray(nor[sl], "RGB")))
    return out


def _rotate_normal(img, angle):
    """Rotate a tangent-space normal crop: the picture turns, and so do the x/y of every normal."""
    import numpy as np
    turned = np.asarray(img.rotate(angle, resample=Image.BILINEAR, expand=True, fillcolor=(128, 128, 255)),
                        dtype=np.float32) / 127.5 - 1.0
    t = np.radians(angle)
    x, y = turned[..., 0], turned[..., 1]
    # PIL rotates counter-clockwise in image space (y down); OpenGL normals have y up
    xr, yr = x * np.cos(t) + y * np.sin(t), -x * np.sin(t) + y * np.cos(t)
    turned[..., 0], turned[..., 1] = xr, yr
    return Image.fromarray(np.clip((turned + 1.0) * 127.5, 0, 255).astype(np.uint8), "RGB")


def compose_foliage(leaves, px, count, tint, seed):
    """A tileable leaf mass: `count` leaves, randomly turned, sized and shaded, wrapped at the edges."""
    import numpy as np
    rng = np.random.default_rng(seed)
    colour = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    normal = Image.new("RGB", (px, px), (128, 128, 255))
    for _ in range(count):
        rgba, nor = leaves[int(rng.integers(len(leaves)))]
        size = px * rng.uniform(0.07, 0.12) / max(rgba.size)
        w, h = max(4, int(rgba.size[0] * size)), max(4, int(rgba.size[1] * size))
        angle = float(rng.uniform(0, 360))
        leaf = rgba.resize((w, h), Image.LANCZOS).rotate(angle, resample=Image.BILINEAR, expand=True)
        leaf_n = _rotate_normal(nor.resize((w, h), Image.LANCZOS), angle)
        # inner leaves are older and lie in each other's shade: vary brightness and hue a little
        shade = rng.uniform(0.62, 1.08)
        r, g, b, a = leaf.split()
        k = [c * shade for c in tint]
        leaf = Image.merge("RGBA", [ch.point(lambda v, f=f: min(255, int(v * f))) for ch, f in zip((r, g, b), k)] + [a])
        x, y = int(rng.integers(px)), int(rng.integers(px))
        for dx in (-px, 0, px):
            for dy in (-px, 0, px):
                ox, oy = x + dx - leaf.size[0] // 2, y + dy - leaf.size[1] // 2
                if ox > px or oy > px or ox + leaf.size[0] < 0 or oy + leaf.size[1] < 0:
                    continue
                colour.alpha_composite(leaf, (ox, oy)) if 0 <= ox and 0 <= oy else colour.paste(leaf, (ox, oy), leaf)
                normal.paste(leaf_n, (ox, oy), a.resize(leaf_n.size) if a.size == leaf_n.size else leaf.split()[3])
    return colour, normal


def write_foliage(material, out_dir, quality, log=print):
    """One crown material's composed leaf mass; the manifest entry, or None when the atlas is missing."""
    atlas, tint, metres, count = FOLIAGE[material]
    pins = pinned()
    paths = {key: source(atlas, key, pins, log) for key in ("map", "opacity", "normal")}
    if not all(paths.values()):
        return None
    leaves = _leaves(Image.open(paths["map"]), Image.open(paths["opacity"]), Image.open(paths["normal"]))
    seed = int(hashlib.sha256(material.encode()).hexdigest()[:8], 16)
    colour, normal = compose_foliage(leaves, 1024, count, tint, seed)
    names = {"map": f"{material}.webp", "normal": f"{material}_normal.webp"}
    colour.save(os.path.join(out_dir, names["map"]), format="WEBP", quality=quality, method=6)
    normal.save(os.path.join(out_dir, names["normal"]), format="WEBP", quality=92, method=6)
    total = sum(os.path.getsize(os.path.join(out_dir, n)) for n in names.values())
    return {"material": material, "map": names["map"], "px": 1024, "metres": metres, "repeat": [1.0, 1.0],
            "tier": "core", "bytes": total, "normalMap": names["normal"], "mapping": "triplanar",
            "cutout": CUTOUT, "source": f"composed from ambientCG {atlas[4:]} (CC0)"}
