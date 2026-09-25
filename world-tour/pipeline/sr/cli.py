"""Command line entry: python -m sr.cli <command> ...

Commands (filled in by later tasks):
  fetch <route>              pull OSM corridor/backdrop data and DEM tiles into cache/
  build <route> [--stage]    generate tiles, track.json and preview for a route
  synth                      generate the synthetic test tracks through the real export path
  validate <track.json>      check a track.json against sr/schema/track.schema.json
  textures                   generate game/public/textures/ and its manifest
  menu-map                   generate game/public/menu-map.json for the opening screen
"""
import argparse
import os
import sys


def main(argv=None):
    ap = argparse.ArgumentParser(prog="sr")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("fetch", "build"):
        p = sub.add_parser(name)
        p.add_argument("route", help="route id, or 'all' for fetch")
        if name == "build":
            p.add_argument("--stage", choices=["greybox", "full"], default="greybox")
        else:
            p.add_argument("--force", action="store_true")
    p = sub.add_parser("synth")
    p.add_argument("--out", default=None, help="tracks directory, default game/public/tracks")
    p.add_argument("--preview-out", default=None, help="preview directory, default pipeline/out")
    p = sub.add_parser("validate")
    p.add_argument("path")
    p = sub.add_parser("textures")
    p.add_argument("--out", default=None, help="texture directory, default game/public/textures")
    p.add_argument("--lock", action="store_true", help="re-pin the Poly Haven scans (sr/photo_textures.py) first")
    p = sub.add_parser("menu-map")
    p.add_argument("--out", default=None, help="output file, default game/public/menu-map.json")
    p = sub.add_parser("preview")
    p.add_argument("route")
    args = ap.parse_args(argv)
    if args.cmd == "menu-map":
        from sr import menumap
        doc = menumap.write(args.out)
        rings = doc["water"] + doc["land"] + doc["roads"]
        pts = sum(len(r) for r in rings)
        # `os` comes from the module scope. A local `import os` in one branch of this function once
        # made the name local to all of them, and every other branch raised UnboundLocalError.
        size = os.path.getsize(args.out or menumap.OUT) / 1024
        print(f"{len(doc['routes'])} routes, {len(doc['water'])} water rings, "
              f"{len(doc['land'])} islands, {len(doc['roads'])} roads, {pts} points, {size:.0f} kB")
        return 0
    if args.cmd == "textures":
        from sr import textures
        if args.lock:
            from sr import photo_textures
            photo_textures.lock()
        manifest = textures.write(args.out or textures.OUT_DIR)
        total = sum(t["bytes"] for t in manifest["textures"])
        for t in manifest["textures"]:
            print(f"{t['material']:16s} {t['px']}px  {t['metres']}m  x{t['repeat']}  {t['bytes']/1e3:6.1f} kB  {t['tier']}")
        print(f"{len(manifest['textures'])} textures, {total/1e6:.2f} MB")
        return 0
    if args.cmd == "validate":
        import json
        from sr.schema import track_errors
        with open(args.path, encoding="utf-8") as f:
            errors = track_errors(json.load(f))
        for e in errors:
            print(e, file=sys.stderr)
        print("OK" if not errors else f"INVALID ({len(errors)})")
        return 0 if not errors else 1
    if args.cmd == "fetch":
        from sr import fetch_dem, fetch_osm
        from sr.routes import all_route_ids
        ids = all_route_ids() if args.route == "all" else [args.route]
        for rid in ids:
            fetch_osm.fetch_route(rid, force=args.force)
            fetch_dem.fetch_route(rid, force=args.force)
        return 0
    if args.cmd == "build":
        from sr.build import build
        build(args.route, stage=args.stage)
        return 0
    if args.cmd == "preview":
        from sr.export import ROOT
        from sr.preview import render_preview
        from sr.route import build_route, checkpoints_for, overlap_length
        res = build_route(args.route)
        track = {"id": args.route, "spline": {"points": res.P.tolist(), "closed": res.closed, "length": res.length},
                 "checkpoints": checkpoints_for(res, mode=res.route["mode"]),
                 "start": {"pos": res.P[0].tolist(), "yaw": 0.0}}
        out = os.path.join(ROOT, "pipeline", "out", args.route, "route-preview.png")
        render_preview(track, None, out, roads=[(w.highway, w.xy) for w in res.ways], snapped=res.snapped)
        from collections import Counter
        print(f"{args.route}: {res.length:.0f} m, {len(res.P)} points, bridge spans {sum(res.bridge)*2:.0f} m, "
              f"half width {res.half_width.min():.1f}..{res.half_width.max():.1f}, overlap {overlap_length(res):.0f} m")
        print("roads used:", Counter(res.highway).most_common())
        print("preview:", out)
        return 0
    if args.cmd == "synth":
        from sr.export import ROOT
        from sr.synth import generate
        out = args.out or os.path.join(ROOT, "game", "public", "tracks")
        prev = args.preview_out or os.path.join(ROOT, "pipeline", "out")
        for doc in generate(out, prev):
            print(f"{doc['id']}: {len(doc['tiles'])} tiles, {doc['spline']['length']:.0f} m, {len(doc['checkpoints'])} checkpoints")
        return 0
    print(f"sr {args.cmd}: not implemented yet", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
