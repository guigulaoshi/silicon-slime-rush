""
import math
import sys

from sr.fetch_osm import load_layer
from sr.landmark_data import entries, model_anchor

DRIVE = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service",
         "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link", "living_street"}


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    route, lid = argv[0], argv[1]
    maxdeg = float(argv[2]) if len(argv) > 2 else 12.0
    maxdist = float(argv[3]) if len(argv) > 3 else 1500.0
    lat0, lon0 = model_anchor(entries()[lid])
    k = math.cos(math.radians(lat0))
    xy = lambda p: ((p["lon"] - lon0) * 111000 * k, (p["lat"] - lat0) * 111000)
    hits = []
    for el in load_layer(route, "roads")["elements"]:
        tags, geometry = el.get("tags", {}), el.get("geometry") or []
        if tags.get("highway") not in DRIVE or len(geometry) < 2:
            continue
        for direction in (1, -1):
            pts = [xy(p) for p in geometry][::direction]
            run, start = 0.0, None
            for a, b in zip(pts, pts[1:]):
                seg = math.hypot(b[0] - a[0], b[1] - a[1])
                if seg < 1:
                    continue
                heading = math.atan2(b[1] - a[1], b[0] - a[0])
                off = abs((math.degrees(math.atan2(-a[1], -a[0]) - heading) + 180) % 360 - 180)
                dist = math.hypot(*a)
                if off <= maxdeg and dist <= maxdist:
                    start = dist if start is None else start
                    run += seg
                    continue
                if run >= 120:
                    hits.append((run, el["id"], tags.get("highway"), tags.get("name:en") or tags.get("name"), start, dist, direction))
                run, start = 0.0, None
            if run >= 120:
                hits.append((run, el["id"], tags.get("highway"), tags.get("name:en") or tags.get("name"), start, math.hypot(*pts[-1]), direction))
    if not hits:
        print(f"没有一段 120 米以上的路在 {maxdeg:g}° 以内正对 {lid}（{maxdist:g} 米以内）；放宽偏角或距离再试")
    for run, way, highway, name, start, end, direction in sorted(hits, reverse=True)[:15]:
        print(f"{run:6.0f} 米正对  way {way} {highway} {name or ''}  从 {start:.0f} 米开到 {end:.0f} 米  几何方向 {direction:+d}")


if __name__ == "__main__":
    main(sys.argv[1:])
