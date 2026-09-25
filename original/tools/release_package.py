#!/usr/bin/env python3
"""Build the zip that goes to itch.io, and refuse to hand over one that would be rejected.


One command, so that "what we tested" and "what we upload" cannot drift:

1. Builds with the public address baked in. The address has one owner, `PLANNED_GAME_URL` in
   `game/src/app/Publication.ts`; this reads it rather than keeping a second copy. Without it the
   build hides the creator and support links, and the share pictures fall back to the planned address.
2. Stages `game/dist` minus the development-only content (the three synthetic test routes, which no
   menu offers and `--keep-synth` keeps).
3. Runs three checks on the staged copy: `size_report.py --dist` (it owns the limits in
   `tools/resource_limits.json`, every one of them at least as strict as itch.io's own, which are
   recorded there with the date and page they were read from), `release_audit.py --dist` (it owns "no
   development details or author privacy in the upload"), and the two browser passes over the
   package -- it boots and drives, and the whole journey holds up in Chrome, Firefox and
   Safari with nothing in the console -- because a package nobody played is not known to work.
4. Zips it with `index.html` at the root and prints what is left for a person to do -- the upload
   itself, which is the player's to make.

One upload is the whole job. `--asset-origin` stays for a host with a fixed asset origin, but it is
not a second pass for itch.io: every itch.io upload gets a new embed origin
(html.itch.zone/html/<digits>), so a zip built for the previous upload's origin is already stale
when it lands.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import size_report                                                # the owner of the shipping limits

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, "game")


def declared(path: str, pattern: str) -> list[str]:
    """Read a fact out of the module that owns it, rather than keeping a second copy here."""
    source = open(os.path.join(GAME, *path.split("/")), encoding="utf-8").read()
    found = re.search(pattern, source)
    if not found:
        raise SystemExit("%s no longer declares %s" % (path, pattern))
    return [value for value in re.findall(r"'([^']+)'", found.group(1))] or [found.group(1)]


def public_game_url() -> str:
    """The address the release prints, from the module that owns it."""
    return declared("src/app/Publication.ts", r"PLANNED_GAME_URL = ('[^']+')")[0]


def dev_only_tracks() -> list[str]:
    """Which routes are development-only is `SYNTHETIC` in game/src/app/tracks.ts, and only there."""
    return declared("src/app/tracks.ts", r"SYNTHETIC = \[([^\]]+)\]")


def run(command: list[str], cwd: str, env: dict | None = None) -> None:
    result = subprocess.run(command, cwd=cwd, env={**os.environ, **(env or {})})
    if result.returncode:
        raise SystemExit("failed: %s" % " ".join(command))


def stage(dist: str, out: str) -> list[str]:
    if os.path.isdir(out):
        shutil.rmtree(out)
    shutil.copytree(dist, out)
    dropped = []
    for track in dev_only_tracks():
        path = os.path.join(out, "tracks", track)
        if os.path.isdir(path):
            shutil.rmtree(path)
            dropped.append(track)
    return dropped


def measure(folder: str) -> dict:
    """The same four numbers the shipping checks are made of, from the code that owns them."""
    total, files = size_report.du(folder)
    largest_mb, longest = size_report.shipping_extremes(folder)
    return {"extracted_mb": round(total / 1e6, 1), "files": files,
            "largest_file_mb": round(largest_mb, 1), "longest_path_chars": longest}


def zip_up(folder: str, target: str) -> int:
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for where, _, names in os.walk(folder):
            for name in sorted(names):
                full = os.path.join(where, name)
                archive.write(full, os.path.relpath(full, folder).replace(os.sep, "/"))
    return os.path.getsize(target)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--asset-origin", help="the embed's hosting origin, for the second upload")
    ap.add_argument("--links", action="store_true", help="also open every address in the audit (needs the network)")
    args = ap.parse_args()

    with open(os.path.join(GAME, "package.json"), encoding="utf-8") as fh:
        version = ".".join(json.load(fh)["version"].split(".")[:2])
    home = public_game_url()
    #"minify obfuscate". Minifying is Vite's own production default; obfuscation is
    # the plugin in vite.config.ts, and it is switched on here rather than in the config so that
    # every build that becomes an upload is obfuscated and no development build pays for it.
    # SR_RELEASE makes the build refuse a tree with uncommitted changes (game/build/credits.ts owns that
    # judgement): an upload has to match a commit, or its About page tells players it does not.
    env = {"VITE_PUBLIC_GAME_URL": home, "SR_OBFUSCATE": "1", "SR_RELEASE": "1"}
    if args.asset_origin:
        env["VITE_PUBLIC_ASSET_ORIGIN"] = args.asset_origin
    run(["npm", "run", "build"], GAME, env)

    out_dir = os.path.join(GAME, "release")
    staged = os.path.join(out_dir, "package")
    dropped = stage(os.path.join(GAME, "dist"), staged)

    checks: dict[str, int] = {}
    checks["size_report"] = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "size_report.py"),
                                            "--dist", staged], cwd=ROOT).returncode
    audit = [sys.executable, os.path.join(ROOT, "tools", "release_audit.py"), "--dist", staged, "--qr"]
    if args.links:
        audit.append("--links")
    checks["release_audit"] = subprocess.run(audit, cwd=ROOT).returncode

    # The package has to be played, not just measured: this is the only run of that test that has a
    # package in front of it, so the one command owns it too.
    # SR_PACKAGE is how those two specs know a package staged seconds ago is in front of them; without it
    # they skip, so an ordinary suite never judges a stale package or launches six more browsers.
    checks["plays"] = subprocess.run(["npx", "playwright", "test", "e2e/release-package.spec.ts",
                                      "e2e/release-qa.spec.ts", "--workers=1", "--reporter=line"],
                                     cwd=GAME, env={**os.environ, "SR_PACKAGE": "1"}).returncode

    facts = measure(staged)
    refused = []
    name = "silicon-slime-rush-%s%s.zip" % (version, "-embed" if args.asset_origin else "")
    target = os.path.join(out_dir, name)
    zipped = zip_up(staged, target)
    if not os.path.exists(os.path.join(staged, "index.html")):
        refused.append("no index.html at the root of the package")

    ok = not refused and not any(checks.values())
    if not ok:
        # A blocked zip at the upload path looks exactly like a good one. Twice the file
        # sitting there was a build that did not work; the next person to follow "upload the zip"
        # would have shipped it. The staged folder stays for whoever debugs it.
        os.remove(target)
    print(json.dumps({
        "status": "ready" if ok else "blocked",
        "version": version, "home": home, "asset_origin": args.asset_origin,
        "zip": os.path.relpath(target, ROOT) if ok else None, "zip_mb": round(zipped / 1e6, 1),
        "package": facts, "itch_limits": size_report.LIMITS["itch_html_limits"], "refused": refused,
        "checks": checks, "dev_tracks_dropped": dropped,
        "then": [
            "upload %s to itch.io as the HTML build of your project (your account, your click)" % name,
            "embed: 960x540, Fullscreen button on, Mobile friendly on with Landscape, scrollbars off",
            "leave the project on Draft; publishing is your own step",
        ],
    }, ensure_ascii=False, indent=1))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
