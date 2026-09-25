"""Bare-earth elevation for a route's corridor: the ground, not the roofs and tree tops over it.

Elevation tiles are a surface model in cities. Downtown, the "ground" a route reads is the top of
the buildings: one flat plaza rose 27 m over 500 m, one city centre came out a 55 m hill with the
waterfront hanging 40 m above the harbour, and the streets looked like they ran between earth banks.
Every reader in a build goes through this one sampler, so the road, the terrain, the buildings and
the backdrop all agree on where the ground is.

Four passes on a raster over the corridor, each capped so real hills survive:
1. single-cell spikes (30 m off the 50 m median) become the median;
2. building footprints are masked out and filled from the ground around them;
3. a 160 m window pulls clustered roofs down by at most 20 m, only where buildings are;
4. dense downtown -- buildings over 30 % of a 300 m window -- is pressed towards the 20th percentile
   of the open (unbuilt, unbuffered) cells in that window, weighted by the cover, at most 50 m;
5. round towers (25 m and up), with no cap: the ground is the morphological opening of the raster
   over a 300 m window, plus 2 m, within 90 m of a tower. The data smears a tower's roof well past its outline, so passes 2-4
   leave a 30-100 m mound between towers that the streets are then draped over -- Sydney's CBD edge
   came out as green hills with broken motorway ramps on them. An opening keeps anything broader
   than the window (a real hill) and removes what is narrower (a smeared tower).
Land never goes below the water; outside the raster, and faded over its edge, the raw data is used."""
import numpy as np
from scipy import ndimage
from shapely import contains_xy
from shapely.ops import unary_union

CELL = 5.0
EDGE_FADE = 200.0
SPIKE_WINDOW = 50.0
SPIKE_LIMIT = 30.0
CLUSTER_WINDOW = 160.0
CLUSTER_CAP = 20.0
DENSE_WINDOW = 300.0
DENSE_COVER = 0.30
DENSE_PERCENTILE = 20
DENSE_CAP = 50.0
TALL_M = 25.0          # a building at least this tall gets pass 5
TOWER_SMEAR = 90.0     # how far past a tower's outline its roof still shows in the data (a 36-storey block: 70-80 m)
TOWER_WINDOW = 300.0   # wider than a block of towers, narrower than a real hill
TOWER_SLACK = 2.0
COARSE = 20.0          # the dense-downtown percentile is computed on this grid, then interpolated
PAD_RAMP = 25.0        # metres over which a landmark's level pad blends back into the ground round it


class BareEarthDem:
    """A DemSampler with the buildings taken out of it inside `bounds` (local x0, z0, x1, z1)."""

    def __init__(self, raw, frame, bounds, buildings, water_level=0.0, flat_window=None, pads=(), towers=()):
        self.raw, self.frame = raw, frame
        self.water_level = water_level
        x0, z0, x1, z1 = bounds
        self.gx = np.arange(x0, x1 + CELL, CELL)
        self.gz = np.arange(z0, z1 + CELL, CELL)
        X, Z = np.meshgrid(self.gx, self.gz, indexing="ij")
        lat, lon = frame.to_latlon(X.ravel(), Z.ravel())
        h = raw.heights(lat, lon).reshape(X.shape)
        mask = _mask(buildings, X, Z)
        self.grid = bare(h, mask, water_level, _mask(towers, X, Z) if towers else None)
        if flat_window:
            # A route that declares its city flat (`flatCity`) has its ground averaged over the window:
            # the data under a flat square carries metres of noise, tree tops and roofs, and a road on it
            # rose and fell 12 m round Tiananmen Square. Water keeps its level; hills are not declared flat.
            wet = self.grid < water_level
            smooth = ndimage.uniform_filter(self.grid, size=_cells(float(flat_window)), mode="nearest")
            self.grid = np.where(wet, self.grid, np.maximum(smooth, water_level + 0.5))
        for pad in pads:
            poly, level, ramp = pad if isinstance(pad, tuple) else (pad, None, PAD_RAMP)
            self.grid = _level_pad(self.grid, poly, X, Z, water_level, level, ramp)
        self.delta = self.grid - h                       # lowers roofs; a declared flat city may also fill
        self.bounds = (float(self.gx[0]), float(self.gz[0]), float(self.gx[-1]), float(self.gz[-1]))

    def over(self, raw):
        """The same correction applied on top of another sampler (the coarse backdrop tiles)."""
        other = object.__new__(BareEarthDem)
        other.__dict__.update(self.__dict__)
        other.raw = raw
        return other

    def known(self, lat, lon):
        return self.raw.known(lat, lon) if hasattr(self.raw, "known") else np.ones(np.shape(lat), bool)

    def heights(self, lat, lon):
        base = self.raw.heights(lat, lon)
        x, z = self.frame.to_local(np.asarray(lat, dtype=np.float64), np.asarray(lon, dtype=np.float64))
        x = np.asarray(x, dtype=np.float64); z = np.asarray(z, dtype=np.float64)
        x0, z0, x1, z1 = self.bounds
        fi = (x - x0) / CELL; fj = (z - z0) / CELL
        inside = (fi >= 0) & (fj >= 0) & (fi <= len(self.gx) - 1) & (fj <= len(self.gz) - 1)
        corr = ndimage.map_coordinates(self.delta, [np.clip(fi, 0, len(self.gx) - 1).ravel(),
                                                    np.clip(fj, 0, len(self.gz) - 1).ravel()],
                                       order=1, mode="nearest").reshape(np.shape(x))
        edge = np.minimum.reduce([x - x0, x1 - x, z - z0, z1 - z])
        fade = np.clip(edge / EDGE_FADE, 0, 1)
        fade = fade * fade * (3 - 2 * fade)
        return base + np.where(inside, corr * fade, 0.0)

    def height(self, lat, lon):
        return float(self.heights(np.array([lat]), np.array([lon]))[0])


def _level_pad(grid, poly, X, Z, water_level, level=None, ramp=None):
    """Level the ground under a landmark to the median of the ground round its outline, blending back
    over PAD_RAMP. A landmark model is authored on flat ground at y = 0 and stood on the lowest ground
    under it; on a slope the data leaves (a hill the building itself put there), the uphill side
    buried its ground storey 15 m deep. Real monuments stand on a level plaza, so the ground is made one.

    `level` given: the ground goes to that height instead -- a quarried pit the data is too coarse to
    see (a statue cut down into the bedrock stood under an unbroken slope that hid it from the road).
    `ramp` is how far the blend reaches outside the outline; a pit wall is steep, so short."""
    inside = contains_xy(poly, X.ravel(), Z.ravel()).reshape(X.shape)
    if not inside.any():
        return grid
    outside_cells = ndimage.distance_transform_edt(~inside) * CELL
    ring = (outside_cells > 0) & (outside_cells <= 2 * CELL)
    if level is None:
        level = float(np.median(grid[ring])) if ring.any() else float(np.median(grid[inside]))
    w = np.clip(1.0 - outside_cells / (ramp or PAD_RAMP), 0.0, 1.0)
    w = w * w * (3 - 2 * w)
    out = grid * (1 - w) + level * w
    return np.where(grid < water_level, grid, np.maximum(out, water_level + 0.5))


def _mask(buildings, X, Z):
    polys = [p for p in buildings if not p.is_empty]
    if not polys:
        return np.zeros(X.shape, dtype=bool)
    shape = unary_union(polys)
    return contains_xy(shape, X.ravel(), Z.ravel()).reshape(X.shape)


def _cells(metres):
    return max(3, int(round(metres / CELL)) | 1)


def bare(h, mask, water_level=0.0, towers=None):
    """The passes on a height raster `h` with building cells `mask` and tower cells `towers` (all on
    the CELL grid)."""
    h = np.asarray(h, dtype=np.float64)
    land = h >= water_level
    # Every pass works only where buildings are. Cliffs, pinnacles and summits are real ground,
    # and away from buildings nothing here can tell them from a roof.
    near = ndimage.binary_dilation(mask, iterations=_cells(50.0) // 2) if mask.any() else mask
    # 1. spikes
    med = ndimage.median_filter(h, size=_cells(SPIKE_WINDOW), mode="nearest")
    out = np.where(near & (np.abs(h - med) > SPIKE_LIMIT), med, h)
    # 2. fill building footprints from the nearest open ground, then blend the seam
    if mask.any() and (~mask).any():
        idx = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
        filled = out[tuple(idx)]
        soft = ndimage.gaussian_filter(filled, sigma=2.0)
        out = np.where(mask, np.minimum(out, soft), out)
    # 3. clustered roofs: pull down towards a wide low-pass, only near buildings, capped
    low = ndimage.uniform_filter(out, size=_cells(CLUSTER_WINDOW), mode="nearest")
    cut = np.clip(out - low, 0, CLUSTER_CAP)
    out = np.where(near, out - cut, out)
    # 4. dense downtown: press towards the 20th percentile of the open cells in a 300 m window
    step = max(1, int(round(COARSE / CELL)))
    cover = ndimage.uniform_filter(mask.astype(float), size=_cells(DENSE_WINDOW), mode="nearest")
    if cover.max() >= DENSE_COVER:
        coarse = out[::step, ::step]
        open_coarse = ~mask[::step, ::step]
        size = max(3, int(round(DENSE_WINDOW / COARSE)) | 1)
        masked = np.where(open_coarse, coarse, np.nan)
        target_c = ndimage.generic_filter(masked, lambda v: np.nanpercentile(v, DENSE_PERCENTILE)
                                          if np.isfinite(v).any() else np.nan, size=size, mode="nearest")
        target_c = np.where(np.isfinite(target_c), target_c, coarse)
        zoom = (out.shape[0] / target_c.shape[0], out.shape[1] / target_c.shape[1])
        target = ndimage.zoom(target_c, zoom, order=1)[:out.shape[0], :out.shape[1]]
        if target.shape != out.shape:
            target = np.pad(target, [(0, out.shape[0] - target.shape[0]), (0, out.shape[1] - target.shape[1])],
                            mode="edge")
        weight = np.clip((cover - DENSE_COVER) / (1 - DENSE_COVER) * 3, 0, 1)
        out = out - weight * np.clip(out - target, 0, DENSE_CAP)
    # 5. towers: the opening, near them only, faded in over their smear
    if towers is not None and towers.any():
        near_tower = ndimage.binary_dilation(towers, iterations=int(round(TOWER_SMEAR / CELL)))
        weight = np.clip(ndimage.gaussian_filter(near_tower.astype(float), sigma=3.0) * 1.5, 0, 1)
        opened = ndimage.grey_opening(out, size=(_cells(TOWER_WINDOW),) * 2, mode="nearest")
        out = out - weight * np.clip(out - (opened + TOWER_SLACK), 0, None)
    # never lower anything that was land into the water, never raise anything
    out = np.minimum(out, h)
    out = np.where(land, np.maximum(out, water_level + 0.5), out)
    return out


def load_route_landmarks(route_id):
    from sr.routes import load_route
    return load_route(route_id).get("landmarks", [])


def for_route(raw, res, route_id, pad, water_level=0.0):
    """The bare-earth sampler for a route: the raster covers the corridor plus the fade band."""
    from sr.buildings import footprints
    xz = res.P[:, [0, 2]]
    lo = xz.min(axis=0) - pad - EDGE_FADE
    hi = xz.max(axis=0) + pad + EDGE_FADE
    # Ruins are walls a few metres high with no roof: the elevation data never saw them as a roof to
    # take out, and masking 93 of them pressed Machu Picchu's ridge 17 m down.
    from sr.buildings import parse_height
    polys, towers = [], []
    for poly, tags in footprints(route_id, res.frame):
        if tags.get("building") == "ruins" or tags.get("ruins") not in (None, "no") or tags.get("historic") == "ruins":
            continue
        polys.append(poly)
        # A pyramid is tagged as a 139 m building; it is also real ground the data has right.
        if (parse_height(tags) or 0.0) >= TALL_M and not tags.get("historic"):
            towers.append(poly)
    pads = []
    # A landmark that declares `levelGround` stands on a level plaza the elevation data does not show:
    # the Colosseum reads 20 m of travertine as hill, and its OSM object is an amphitheatre relation, not
    # a `building`, so nothing else takes it out. Its outline joins the building mask and gets a level
    # pad. Opt-in, because most landmarks were modelled onto the data's ground on purpose: a palace on
    # its real hill, a bridge whose footprint is a strip across a river.
    from shapely.geometry import Polygon
    from sr.landmark_data import entries
    registry = entries()
    for ident in load_route_landmarks(route_id):
        entry = registry.get(ident) or {}
        ring = entry.get("footprint")
        if ring and entry.get("levelGround"):
            x, z = res.frame.to_local(*np.asarray(ring, dtype=float).T)
            poly = Polygon(np.c_[x, z]).buffer(0)
            if not poly.is_empty:
                polys.append(poly)
                pads.append(poly)
    # A route's `levelAreas`: places the elevation data tilts that are level in reality (a big
    # roundabout on a hilltop read as a 6 m slope across its island, so its monument could only
    # stand on the low side). Each is a circle levelled like a landmark pad; one with `heightM` is sunk
    # (or raised) to that ground height, blending back over `rampM`.
    from shapely.geometry import Point
    from sr.routes import load_route
    for area in load_route(route_id).get("levelAreas", ()):
        x, z = res.frame.to_local(np.array([area["lat"]]), np.array([area["lon"]]))
        circle = Point(float(x[0]), float(z[0])).buffer(float(area["radiusM"]), quad_segs=16)
        pads.append((circle, area.get("heightM"), float(area.get("rampM", PAD_RAMP))))
    flat = (load_route(route_id).get("flatCity") or {}).get("windowM")
    # A long viaduct the race does not use is a roof too: the data reads its deck as ground.
    from shapely.geometry import LineString
    from scipy.spatial import cKDTree
    from sr.roads import floating_bridge, side_half_width
    from sr.route import load_ways
    tree = cKDTree(xz)
    polys.extend(LineString(w.xy).buffer(side_half_width(w) + 3.0) for w in load_ways(route_id, res.frame)
                 if floating_bridge(w, tree))
    # A landmark stands on the ground under its own outline (sr/build.py landmark_base); pass 5 must not
    # move that ground, so a tagged building overlapping any landmark of the route is not a tower here.
    landmarks = []
    for ident in load_route_landmarks(route_id):
        ring = (registry.get(ident) or {}).get("footprint")
        if ring:
            x, z = res.frame.to_local(*np.asarray(ring, dtype=float).T)
            landmarks.append(Polygon(np.c_[x, z]).buffer(0))
    towers = [t for t in towers if not any(t.intersects(p) for p in landmarks)]
    return BareEarthDem(raw, res.frame, (lo[0], lo[1], hi[0], hi[1]), polys, water_level, flat, pads, towers)
