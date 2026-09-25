"""The World Tour icon: the slime is a globe.

Hand-drawn vector, generated so the continents are the real ones: the land rings the opening map
uses (pipeline/cache/world/land.json.gz) projected orthographically onto the slime's body, facing
Europe, Africa and Asia. The jelly dome, eyes and gloss keep the original mark's shape; a checkered
road runs round the equator so it still reads as a racing game.

  python3 assets-src/brand/build_icon.py            # writes assets-src/brand/slime-globe.svg
  node assets-src/brand/rasterize.mjs               # 64 / 180 / 512 px PNGs into game/public/brand/
"""
import gzip
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LAND = os.path.join(ROOT, "pipeline", "cache", "world", "land.json.gz")
OUT = os.path.join(ROOT, "assets-src", "brand", "slime-globe.svg")

CX, CY, R = 256.0, 292.0, 158.0          # the globe inside the dome
LON0, LAT0 = 45.0, 18.0                  # facing Africa, Europe and Asia
TILT = math.radians(-9)                  # the equator road leans a little, like a planet


def project(lon, lat):
    """Orthographic projection; None on the far side."""
    l, p = math.radians(lon - LON0), math.radians(lat)
    p0 = math.radians(LAT0)
    cosc = math.sin(p0) * math.sin(p) + math.cos(p0) * math.cos(p) * math.cos(l)
    if cosc < 0:
        return None
    x = math.cos(p) * math.sin(l)
    y = math.cos(p0) * math.sin(p) - math.sin(p0) * math.cos(p) * math.cos(l)
    return CX + R * x, CY - R * y


def path(points):
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in points) + " Z"


def load_rings():
    """The opening map's land rings and the seas they enclose, each as [[lon, lat], ...].

    The map data has changed shape since this script was written: it now keeps the land as `rings`
    and the enclosed seas (Mediterranean, Black Sea, Caspian, Red Sea) as `seas`, painted back."""
    with gzip.open(LAND, "rt", encoding="utf-8") as fh:
        data = json.load(fh)
    return data.get("rings") or data.get("land") or [], data.get("seas") or []


def land_paths(rings):
    out = []
    for ring in rings:
        pts, run = [], []
        for lon, lat in ring:
            p = project(lon, lat)
            if p is None:
                if len(run) > 2:
                    pts.append(run)
                run = []
            else:
                run.append(p)
        if len(run) > 2:
            pts.append(run)
        out += [path(r) for r in pts]
    return out


def graticule():
    lines = []
    for lat in range(-60, 90, 30):
        run = [project(lon, lat) for lon in range(-180, 181, 5)]
        seg = [p for p in run if p]
        if len(seg) > 2:
            lines.append("M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in seg))
    for lon in range(-180, 180, 30):
        seg = [p for p in (project(lon, lat) for lat in range(-88, 89, 4)) if p]
        if len(seg) > 2:
            lines.append("M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in seg))
    return lines


def equator_road():
    """The near half of a tilted ellipse round the globe, as a thick band."""
    rx, ry = R * 1.02, R * 0.26
    pts = []
    for i in range(0, 181, 3):
        a = math.radians(i)
        x, y = -rx * math.cos(a), ry * math.sin(a)
        pts.append((CX + x * math.cos(TILT) - y * math.sin(TILT), CY + 18 + x * math.sin(TILT) + y * math.cos(TILT)))
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts)


def main():
    dome = ("M62 404 C40 250 122 88 256 88 C390 88 472 250 450 404 "
            "C438 446 378 458 256 458 C134 458 74 446 62 404 Z")
    rings, seas = load_rings()
    land = "".join(f'<path d="{d}"/>' for d in land_paths(rings))
    water = "".join(f'<path d="{d}"/>' for d in land_paths(seas))
    grid = "".join(f'<path d="{d}"/>' for d in graticule())
    road = equator_road()
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="jelly" cx="42%" cy="30%" r="75%">
      <stop offset="0" stop-color="#c9f4ff"/><stop offset=".45" stop-color="#6fd0f6"/><stop offset="1" stop-color="#2a8fd6"/>
    </radialGradient>
    <radialGradient id="ocean" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#3db3e8"/><stop offset="1" stop-color="#15609e"/>
    </radialGradient>
    <radialGradient id="shade" cx="38%" cy="32%" r="72%">
      <stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#021a33" stop-opacity=".45"/>
    </radialGradient>
    <clipPath id="globe"><circle cx="{CX}" cy="{CY}" r="{R}"/></clipPath>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <path d="{dome}" fill="#7fe0ff" opacity=".55" filter="url(#glow)"/>
  <path d="{dome}" fill="url(#jelly)" opacity=".92"/>
  <g clip-path="url(#globe)">
    <circle cx="{CX}" cy="{CY}" r="{R}" fill="url(#ocean)"/>
    <g fill="#6cc24a" stroke="#2f7d2c" stroke-width="1.6" stroke-linejoin="round">{land}</g>
    <g fill="#2c93cf" stroke="#2f7d2c" stroke-width="1.2" stroke-linejoin="round">{water}</g>
    <g fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="1.4">{grid}</g>
    <circle cx="{CX}" cy="{CY}" r="{R}" fill="url(#shade)"/>
  </g>
  <path d="{road}" fill="none" stroke="#1b1b1b" stroke-width="22" stroke-linecap="round"/>
  <path d="{road}" fill="none" stroke="#ffd23a" stroke-width="22" stroke-dasharray="16 16" stroke-linecap="butt"/>
  <path d="{road}" fill="none" stroke="#1b1b1b" stroke-width="3" stroke-opacity=".6"/>
  <g>
    <ellipse cx="206" cy="206" rx="25" ry="32" fill="#ffffff"/><ellipse cx="306" cy="206" rx="25" ry="32" fill="#ffffff"/>
    <ellipse cx="209" cy="212" rx="14" ry="19" fill="#0e1d2e"/><ellipse cx="303" cy="212" rx="14" ry="19" fill="#0e1d2e"/>
    <circle cx="214" cy="203" r="5" fill="#ffffff"/><circle cx="308" cy="203" r="5" fill="#ffffff"/>
  </g>
  <path d="M132 176 C150 132 190 110 228 104" fill="none" stroke="#ffffff" stroke-opacity=".8" stroke-width="13" stroke-linecap="round"/>
  <path d="M100 250 C98 232 102 214 110 198" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="9" stroke-linecap="round"/>
  <path d="{dome}" fill="none" stroke="#e8fbff" stroke-opacity=".7" stroke-width="3"/>
</svg>
'''
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(svg)
    print(f"wrote {OUT} ({len(svg) // 1024} kB)")


if __name__ == "__main__":
    main()
