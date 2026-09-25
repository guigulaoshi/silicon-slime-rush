#!/usr/bin/env python3
"""Report build, texture, and per-track size against raised hard limits.

The limits live in ``tools/resource_limits.json``. They are deliberately high so art quality can
grow freely; crossing one means itch.io would reject the build or a browser is at real risk. The
runner files one deduplicated discussion rather than silently cutting visible detail.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "tools", "resource_limits.json"), encoding="utf-8") as fh:
    LIMITS = json.load(fh)


def hard_max(key, actual, label):
    limit = LIMITS[key]
    if actual > limit:
        print(f"HARD LIMIT: {key} {actual:g} > {limit:g} ({label}); "
              "raise the limit only if the platform allows it")
        return False
    return True


def du(path):
    total, count = 0, 0
    for dp, _, fs in os.walk(path):
        for f in fs:
            total += os.path.getsize(os.path.join(dp, f)); count += 1
    return total, count


def shipping_extremes(path):
    largest_mb, longest = 0.0, 0
    for dp, _, fs in os.walk(path):
        for name in fs:
            full = os.path.join(dp, name)
            largest_mb = max(largest_mb, os.path.getsize(full) / 1e6)
            longest = max(longest, len(os.path.relpath(full, path).replace(os.sep, "/")))
    return largest_mb, longest


def main(argv=None):
    """`--dist <dir>` points the shipping checks at a package staged elsewhere."""
    argv = sys.argv[1:] if argv is None else argv
    ok = True
    dist = os.path.join(ROOT, "game", "dist")
    if "--dist" in argv:
        at = argv.index("--dist") + 1
        if at >= len(argv):
            print("--dist needs a directory")
            return 78
        dist = os.path.abspath(argv[at])
        if not os.path.isdir(dist):
            
            print("no build to measure at %s" % dist)
            return 78
    files = 0
    if os.path.isdir(dist):
        b, n = du(dist)
        files = n            # what ships, and the only thing the file budget is about
        print(f"dist: {b/1e6:.1f} MB, {n} files (hard lines {LIMITS['web_total_mb']} MB,"
              f" {LIMITS['shipping_files']} files)")
        largest_mb, longest = shipping_extremes(dist)
        ok &= hard_max("web_total_mb", b / 1e6, "built Web game")
        ok &= hard_max("single_file_mb", largest_mb, "largest extracted file")
        ok &= hard_max("path_length_chars", longest, "longest extracted path")
    textures = os.path.join(ROOT, "game", "public", "textures")
    manifest = os.path.join(textures, "manifest.json")
    if os.path.isfile(manifest):
        with open(manifest, encoding="utf-8") as fh:
            entries = json.load(fh).get("textures", [])
        # A material can be two files -- colour and roughness -- and `bytes` is already both of
        # them added up, so the file count has to be counted rather than taken as len(entries).
        files_here = sum(1 + (1 if e.get("roughnessMap") else 0) for e in entries)
        core = sum(e.get("bytes", 0) for e in entries if e.get("tier") == "core")
        total = sum(e.get("bytes", 0) for e in entries)
        # RGBA8 plus a full mip chain: px*px*4 bytes, times 4/3 for the mips. Uncompressed, because
        # these ship as WebP and WebP is decoded to RGBA before it reaches the GPU.
        vram = sum((e.get("px", 0) ** 2 + e.get("roughPx", 0) ** 2) * 4 * 4 / 3 for e in entries)
        print(f"textures: {total/1e6:.2f} MB in {files_here} files, {core/1e6:.2f} MB of it core,"
              f" {vram/1e6:.1f} MB of video memory"
              f" (hard VRAM line {LIMITS['textures_vram_mb']} MB)")
        ok &= hard_max("textures_vram_mb", vram / 1e6, "decoded texture video memory")
    else:
        # Not a failure: they are build output like the tiles, and a tree that has not generated
        # them reports nothing rather than a zero that looks like a measurement.
        print("textures: none generated (python -m sr.cli textures)")
    tracks = os.path.join(ROOT, "game", "public", "tracks")
    if os.path.isdir(tracks):
        for t in sorted(os.listdir(tracks)):
            track_dir = os.path.join(tracks, t)
            if not os.path.isdir(track_dir):
                continue
            tb, tn = du(track_dir)
            # Two shapes, and both are normal: the pipeline writes loose `tiles/*.glb`,
            # and `npm run build` packs them into one `tiles.bin` on the way into dist/ because
            # itch.io counts files. What ships is counted from dist/ above; this is the source tree,
            # so it reads whichever shape is here rather than treating either as stale.
            pack = os.path.join(track_dir, "tiles.bin")
            tiles = os.path.join(track_dir, "tiles")
            if os.path.isfile(pack):
                ib = os.path.getsize(pack)
            else:
                ib, _ = du(tiles) if os.path.isdir(tiles) else (0, 0)
            print(f"{t}: {tb/1e6:5.1f} MB total, {ib/1e6:5.1f} MB tiles, {tn:4d} files"
                  " (measured, no per-track cap)")
    itch = LIMITS.get("itch_html_limits", {})
    if itch:
        print("itch.io's own HTML limits, rechecked %s (%s): %g MB extracted, %g files,"
              " %g MB per file, %g-character paths -- every one of ours above is at least as strict"
              % (itch["_checked"], itch["_source"], itch["extracted_mb"], itch["files"],
                 itch["single_file_mb"], itch["path_chars"]))
    print(f"files that ship: {files} (hard line {LIMITS['shipping_files']})")
    ok &= hard_max("shipping_files", files, "files in the built Web game")
    print("OK" if ok else "HARD LIMIT EXCEEDED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
