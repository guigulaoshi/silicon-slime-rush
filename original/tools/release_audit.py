#!/usr/bin/env python3
"""What the upload may not contain, and what it must be able to reach.

(make sure player-visible text reads well, links work, QR codes work, and no
author privacy -- his promoted accounts excepted -- or development details reach the uploaded build).
Three questions, each answered against the built artefact rather than the source, because the build
is what players get:

* **Development details.** Task numbers, the queue's own vocabulary, quoted conversations, work
  markers, source maps. Comments in TypeScript never reach `dist`; comments inside shader strings and
  `description`/`_note` fields inside shipped JSON do, which is exactly how this check earns its keep.
* **Author privacy.** Home directories, machine names, the private repository, the itch.io editor.
  His public accounts are the exception the player named: they are promotion, and they stay.
* **Reachability.** Every external address in the build is opened; every roadside QR code is decoded
  and compared with the address the billboard manifest says that board carries.

`--links` and `--qr` are opt-in because one needs the network and the other needs OpenCV; the scan
for dev details and privacy always runs and is the part that must stay green.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXT_SUFFIXES = (".html", ".js", ".css", ".json", ".txt", ".webmanifest", ".map", ".svg", ".md")
# The licence texts players can open are third-party prose: they carry their own authors' names and
# addresses, and editing them would be the licence violation. They are read for links, not for names.
THIRD_PARTY_TEXT = ("credits.txt",)

DEV_MARKERS = [
    (re.compile(r"\btasks?\s+\d{3}\b", re.I), "task number"),
    (re.compile(r"任务\s*\d{3}"), "task number (zh)"),
    (re.compile(r"\bSR-\d{3}\b"), "old task id"),
    (re.compile(r"用户\s*20\d\d-\d\d-\d\d"), "quoted conversation"),
    (re.compile(r"[「」]"), "quoted conversation"),
    (re.compile(r"\bTODO\b|\bFIXME\b|\bXXX\b"), "work marker"),
    (re.compile(r"AGENTS\.md"), "instruction file"),
    (re.compile(r"\bplaywright\b|\bvitest\b|delivery_gate", re.I), "test tooling"),
    (re.compile(r"sourceMappingURL"), "source map"),
    # Not a detail but a broken build: a bundler placeholder for a hashed chunk name that never got
    # swapped in. An obfuscation pass that ran too early left exactly this 's release,
    # and the game asked for `main-!~{003}~.js` and never started. Cheaper to catch here than in a browser.
    (re.compile(r"!~\{\d+\}~"), "unresolved chunk placeholder"),
    (re.compile(r"sr\.cli|tools/assets\.py|tools/\w+\.py|npm run |pytest"), "developer command"),
]

def _uncommitted() -> str:
    """What credits.txt says of a build from an unclean tree, read from game/build/credits.ts, its owner."""
    source = open(os.path.join(ROOT, "game", "build", "credits.ts"), encoding="utf-8").read()
    found = re.search(r"export const UNCOMMITTED = '([^']+)'", source)
    if not found:
        raise SystemExit("game/build/credits.ts no longer declares UNCOMMITTED")
    return found.group(1)


# The About page of such a build tells every player "includes local changes" (the
# live build). The About string itself ships in every build's locale table, so the flag is read where
# the build states it in its own words: credits.txt.
DEV_MARKERS.append((re.compile(re.escape(_uncommitted())), "built from uncommitted changes"))

PRIVACY_MARKERS = [
    # A trailing slash is what separates a real home directory from the game's own `home/` folder.
    (re.compile(r"/(?:Users|home)/[A-Za-z0-9._-]+/"), "home directory"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "email address"),
    (re.compile(r"itch\.io/(edit|dashboard)"), "itch.io editor"),
    (re.compile(r"secret-url|[?&]secret="), "secret url"),
]

URL = re.compile(r"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+")
QUOTES = "'\"`"


def addresses(body: str) -> set[str]:
    """Every external address in one file, cut where the text around it ends it.

    The address alphabet includes `'`, `(` and `;`, so in minified or obfuscated code a quoted address
    runs straight on into the code after it -- `https://x/y';function` -- and a scripted open of that
    404s. An address that
    opens with a quote ends at the same quote, because a string literal or attribute cannot contain its
    own unescaped delimiter; one that does not keeps the old trimming, for prose and markdown.
    """
    found, at = set(), 0
    while hit := URL.search(body, at):
        text = hit.group(0)
        opener = body[hit.start() - 1] if hit.start() else ""
        if opener and opener in QUOTES:
            text = text.split(opener, 1)[0]
        # Resume where this address ended, not where the raw match did: the code it swallowed can
        # hold the next address (`{a:'https://x/1',b:'https://x/2'}`).
        at = hit.start() + max(len(text), 1)
        text = text.rstrip(").,;'\"`")
        # A bare scheme is code asking "is this an address?" (`url.startsWith('https://')`), not one.
        if urlparse(text).hostname:
            found.add(text)
    return found


def _expected_404(url: str) -> bool:
    """The project page and its tip page answer 404 until the player publishes the project."""
    return url.rstrip("/") in {
        "https://guigulaoshi.itch.io/silicon-slime-rush",
        "https://guigulaoshi.itch.io/silicon-slime-rush/purchase",
    }


# Names, not addresses: a JSON Schema's `$id` and its vocabulary URIs identify the dialect and are not
# meant to resolve. Opening them proves nothing either way.
IDENTIFIERS = (
    "https://silicon-rush.local/",
    "https://json-schema.org/draft/",
)

# Hosts that refuse a scripted request and serve the page to a browser. Each was opened by hand in a
# real browser and showed the expected page; a 403 from them is this script
# being blocked, not a dead link. A different status, or a 403 from anywhere else, is still a finding.
BROWSER_ONLY = (
    "www.af.mil", "www.paloalto.gov", "www.fosterandpartners.com",
    "www.mountainview.gov", "www.sftravel.com", "www.adobe.com",
)


def _identifier(url: str) -> bool:
    return url.startswith(IDENTIFIERS)


def _browser_only(url: str) -> bool:
    return urlparse(url).hostname in BROWSER_ONLY


def text_files(base: str) -> list[str]:
    found = []
    for folder, _, names in os.walk(base):
        for name in names:
            if name.endswith(TEXT_SUFFIXES):
                found.append(os.path.join(folder, name))
    return sorted(found)


JS_ESCAPE = re.compile(r"\\x([0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\u\{([0-9a-fA-F]{1,6})\}")


def unescaped(body: str) -> str:
    """The text a player's browser would see, with JavaScript's `\\xNN` / `\\uNNNN` escapes spelled out.

    The obfuscator moves strings into a table and writes a space as `\\x20` (`" left a
    note"` ships as `'task\\x20123\\x20left\\x20a\\x20note'`), so every marker with a space in it --
    task numbers, quoted conversations, `npm run ` -- was blind on the one build that is uploaded.
    """
    def spell(m: re.Match) -> str:
        code = int(next(g for g in m.groups() if g is not None), 16)
        return chr(code) if code <= 0x10FFFF else m.group(0)
    return JS_ESCAPE.sub(spell, body)


def scan(base: str, extra: list[str] = []) -> tuple[list[dict], int]:
    """Every dev/privacy marker in the build and in the store copy, with the text around it."""
    findings, checked = [], 0
    for path in text_files(base) + extra:
        rel = os.path.relpath(path, base if path.startswith(base) else ROOT)
        try:
            body = open(path, encoding="utf-8", errors="replace").read()
        except OSError as err:
            findings.append({"file": rel, "kind": "unreadable", "detail": str(err)})
            continue
        checked += 1
        if path.endswith((".js", ".mjs", ".json", ".html")):
            body = unescaped(body)
        third_party = rel.endswith(THIRD_PARTY_TEXT)
        for pattern, kind in DEV_MARKERS + PRIVACY_MARKERS:
            if third_party and kind in {"email address", "quoted conversation"}:
                continue
            for hit in pattern.finditer(body):
                start = max(0, hit.start() - 60)
                findings.append({"file": rel, "kind": kind, "match": hit.group(0),
                                 "context": body[start:hit.end() + 60].replace("\n", " ")})
    findings += orphan_stylesheets(base)
    return findings, checked


def orphan_stylesheets(base: str) -> list[dict]:
    """A stylesheet the build emitted but nothing loads: the game runs, with no styling at all.

    What an obfuscation pass run before Vite had written its preload lists left in the
    release -- and a browser check that only asks whether a button is visible passes on it, because an
    unstyled button is still visible. So this asks the static question instead: is every `.css` file
    in the build named by the page or by some script?
    """
    sheets = [os.path.join(d, f) for d, _, fs in os.walk(base) for f in fs if f.endswith(".css")]
    if not sheets:
        return []
    texts = []
    for d, _, fs in os.walk(base):
        for f in fs:
            if f.endswith((".html", ".js")):
                texts.append(open(os.path.join(d, f), encoding="utf-8", errors="replace").read())
    return [{"file": os.path.relpath(sheet, base), "kind": "stylesheet nothing loads",
             "match": os.path.basename(sheet)}
            for sheet in sheets if not any(os.path.basename(sheet) in text for text in texts)]


# The two shapes an obfuscation pass run too early actually produced. They are not
# about what the upload may say but about whether it works at all, so the delivery gate asks just these
# on every build -- the commit that moves the obfuscation hook is the one that turns red, not the next
# upload.
INTEGRITY_KINDS = {"unresolved chunk placeholder", "stylesheet nothing loads"}


def integrity(base: str) -> list[dict]:
    return [f for f in scan(base)[0] if f["kind"] in INTEGRITY_KINDS]


def links(base: str, extra: list[str]) -> tuple[list[str], list[dict], list[dict]]:
    """Every external address the build carries, opened once."""
    seen: set[str] = set()
    for path in text_files(base) + extra:
        try:
            body = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        seen |= addresses(body)
    bad, skipped = [], []
    for url in sorted(seen):
        if _identifier(url):
            skipped.append({"url": url, "why": "an identifier, not an address"})
            continue
        try:
            request = urllib.request.Request(url, method="GET", headers={"User-Agent": "silicon-rush-audit"})
            with urllib.request.urlopen(request, timeout=20) as answer:
                code = answer.status
        except urllib.error.HTTPError as err:
            code = err.code
        except Exception as err:                                  # DNS, TLS, timeouts
            row = {"url": url, "error": type(err).__name__ + ": " + str(err)}
            # A host on the hand-checked list may refuse or stall a script; a name that no longer
            # resolves or a certificate that no longer verifies is how a link really dies, and the
            # list must not hide those -- the one dead link this audit found was a moved domain.
            timed_out = isinstance(err, TimeoutError) or "timed out" in str(err).lower()
            if _browser_only(url) and timed_out:
                skipped.append({**row, "why": "stalls a scripted request; verified in a browser"})
            else:
                bad.append(row)
            continue
        if code < 400:
            continue
        if code == 404 and _expected_404(url):
            skipped.append({"url": url, "status": code, "why": "the project page opens when it is published"})
        elif code == 403 and _browser_only(url):
            skipped.append({"url": url, "status": code, "why": "blocks scripted requests; verified in a browser"})
        else:
            bad.append({"url": url, "status": code})
    return sorted(seen), bad, skipped


# The code box on a board, in the billboard art's own pixels (pipeline/sr/social_billboards.py owns
# the drawing; this is where to look, not how to draw).
QR_BOX = (568, 44, 568 + 424, 44 + 424)


def qr(base: str) -> tuple[list[dict], list[dict]]:
    """Decode the roadside QR codes and compare them with the manifest the boards are drawn from."""
    import cv2                                                    # only needed for --qr
    import numpy

    manifest = json.load(open(os.path.join(base, "billboards", "manifest.json"), encoding="utf-8"))
    boards = {}
    for face in manifest["faces"]:
        for copy in (face.get("zh"), face.get("en")):
            if copy and copy.get("platform") and copy.get("image"):
                boards[copy["image"]] = copy
    detector = cv2.QRCodeDetector()
    read, bad = [], []
    for image, copy in sorted(boards.items()):
        platform, target = copy["platform"], copy.get("target", "")
        path = os.path.join(base, image)
        if not os.path.exists(path):
            bad.append({"image": image, "error": "missing from the build"})
            continue
        picture = cv2.imread(path)
        decoded, _, _ = detector.detectAndDecode(picture)
        row = {"image": image, "platform": platform, "target": target, "decoded": decoded}
        # `sourceCode` is how the renderer decides a board carries the platform's own code picture
        # (WeChat Channels has no profile address and no standard QR); borrowing that field keeps one
        # answer to one question. Such a picture cannot be decoded, so the check is that the code is
        # still drawn: a box that has been blanked or covered fails on ink alone.
        if copy.get("sourceCode"):
            box = cv2.cvtColor(picture[QR_BOX[1]:QR_BOX[3], QR_BOX[0]:QR_BOX[2]], cv2.COLOR_BGR2GRAY)
            ink = float(numpy.mean(box < 128))
            row = {**row, "checked": "ink only -- the platform's own code picture", "ink": round(ink, 3)}
            read.append(row)
            if not 0.05 <= ink <= 0.6:
                bad.append({**row, "error": "the code box is blank or covered"})
            elif decoded:
                bad.append({**row, "error": "a board with no address should not decode to one"})
            continue
        row = {**row, "checked": "decoded"}
        read.append(row)
        if decoded != target:
            bad.append({**row, "error": "does not decode to the address the manifest carries"})
    return read, bad


SOURCES = ("game/src", "game/public", "game/build", "game/index.html", "game/vite.config.ts",
           "pipeline/sr/schema")


def newest(paths: list[str]) -> tuple[float, str]:
    newest_at, newest_path = 0.0, ""
    for path in paths:
        for folder, _, names in os.walk(path) if os.path.isdir(path) else [(os.path.dirname(path), [], [os.path.basename(path)])]:
            for name in names:
                at = os.path.getmtime(os.path.join(folder, name))
                if at > newest_at:
                    newest_at, newest_path = at, os.path.relpath(os.path.join(folder, name), ROOT)
    return newest_at, newest_path


def freshness(dist: str) -> dict | None:
    """A stale build audits clean and uploads something else: the thing checked has to be the thing sent."""
    built_at, _ = newest([os.path.join(dist, "index.html")])
    source_at, source = newest([os.path.join(ROOT, p) for p in SOURCES])
    if built_at and built_at >= source_at:
        return None
    return {"built": built_at, "newest_source": source, "changed": source_at,
            "detail": "the build is older than %s -- run npm run build before auditing" % source}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dist", default=os.path.join(ROOT, "game", "dist"))
    ap.add_argument("--links", action="store_true", help="open every external address (needs the network)")
    ap.add_argument("--qr", action="store_true", help="decode the roadside QR codes (needs OpenCV)")
    ap.add_argument("--extra", action="append", default=[], help="another file to read addresses out of")
    ap.add_argument("--integrity", action="store_true",
                    help="only ask whether the build works: no bundler placeholder left, every stylesheet loaded")
    args = ap.parse_args()

    if not os.path.isdir(args.dist):
        print(json.dumps({"error": "no build to audit", "dist": args.dist}))
        return 78
    if args.integrity:
        broken = integrity(args.dist)
        print(json.dumps({"dist": os.path.relpath(args.dist, ROOT), "findings": broken,
                          "status": "broken" if broken else "intact"}, ensure_ascii=False, indent=1))
        return 1 if broken else 0

    extra = [os.path.join(ROOT, p) for p in args.extra]
    findings, checked = scan(args.dist, extra)
    stale = freshness(args.dist)
    out: dict = {"dist": os.path.relpath(args.dist, ROOT), "files_scanned": checked,
                 "stale_build": stale, "findings": findings, "finding_count": len(findings)}
    failed = bool(findings) or bool(stale)
    if args.links:
        found, bad, skipped = links(args.dist, extra)
        out["links_checked"] = len(found)
        out["links_bad"] = bad
        out["links_not_opened"] = skipped
        failed = failed or bool(bad)
    if args.qr:
        read, bad = qr(args.dist)
        out["qr_read"] = len(read)
        out["qr_bad"] = bad
        failed = failed or bool(bad)
    out["status"] = "dirty" if failed else "clean"
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
