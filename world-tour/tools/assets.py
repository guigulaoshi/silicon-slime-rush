#!/usr/bin/env python3
"""Make sure the map data in this tree matches the code in this tree, before anything runs it.

That is the whole specification, and it names the two failures this
replaces: a check that only *reports* a problem, and a rebuild that repeats work already done.

**Reliable means the question is "does this match", not "is this here".** A track's products depend
on its route definition, its cached OSM and elevation data, and the pipeline source that turns those
into geometry. All of that is hashed into one build id, written beside the products as `.build-id`.
Fresh means the products are complete *and* the id matches. The failure that started this -- a car
flying through an empty sky -- was products that existed and did not match; every
"is the file there" check in the world passes that.

**Efficient means two different things, and both are needed.** Building one track costs 27.5 s and
building all of them costs twelve minutes, so the first rule is *build only what is about to run*
The second is
that no machine builds the same thing twice: products go into a store under `<repo>/.git/sr-assets/`
keyed by build id, shared by every worktree, restored with `cp -c` (APFS clonefile -- copy on write,
so restoring a 5 MB track costs milliseconds and almost no disk). `.git` is the right home for the
same reasons the id counter lives there: several trees share it, it is nobody's working tree, it
never enters version control, and `git worktree remove` cannot take it away.

The order is fixed: **check, restore, build.** Matching id, nothing happens. Store has that id, it
is cloned in. Neither, and only then is one track built -- and stored, so nobody builds it again.

    python3 tools/assets.py check                 what is fresh, stale or missing (exit 1 if not all)
    python3 tools/assets.py ensure --all          make every built track and the textures fresh
    python3 tools/assets.py ensure --tracks a,b   just those, plus the textures they need
    python3 tools/assets.py prune                 keep the newest few ids per track in the store
"""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIPELINE = os.path.join(ROOT, "pipeline")
TRACKS = os.path.join(ROOT, "game", "public", "tracks")
TEXTURES = os.path.join(ROOT, "game", "public", "textures")
STAMP = ".build-id"
KEEP_PER_TRACK = 3        # how many generations of one track the store keeps


def say(msg):
    print(msg, flush=True)


def git_dir():
    """The shared .git, not a worktree's private one: the store is shared by every tree."""
    p = subprocess.run(["git", "-C", ROOT, "rev-parse", "--git-common-dir"],
                       capture_output=True, text=True)
    if p.returncode:
        return os.path.join(ROOT, ".git")
    out = p.stdout.strip()
    return out if os.path.isabs(out) else os.path.join(ROOT, out)


def store_dir():
    return os.path.join(git_dir(), "sr-assets")


def _hash_file(h, path):
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)


def _hash_tree(h, path, contents=True):
    """Hash a directory: names always, bytes when asked.

    The DEM cache is 30 MB of tiles that never change once downloaded, so it is hashed by name and
    size -- reading it on every check would cost more than the check saves. Everything else is
    hashed by content, because "the file is the same size" is exactly the kind of near-miss that
    produced the bug this module exists for.
    """
    if not os.path.isdir(path):
        h.update(b"\x00missing")
        return
    for base, dirs, files in os.walk(path):
        dirs.sort()
        for name in sorted(files):
            at = os.path.join(base, name)
            h.update(os.path.relpath(at, path).encode())
            if contents:
                _hash_file(h, at)
            else:
                h.update(str(os.path.getsize(at)).encode())


def _module_path(module):
    """Return the source file for one local ``sr`` module, including packages."""
    base = os.path.join(PIPELINE, "sr", *module.split("."))
    source = base + ".py"
    package = os.path.join(base, "__init__.py")
    if os.path.isfile(source):
        return source
    if os.path.isfile(package):
        return package
    return None


def _load_pipeline_module(module):
    """Load one pipeline reader without inventing a second interpretation of its data."""
    path = _module_path(module)
    if not path:
        raise FileNotFoundError(f"pipeline module not found: sr.{module}")
    spec = importlib.util.spec_from_file_location(f"sr_assets_{module}", path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def _local_source_closure(entries):
    """Follow local ``sr`` imports from product entry modules, including lazy imports."""
    pending = list(entries)
    found = {}
    while pending:
        module = pending.pop()
        if module in found:
            continue
        path = _module_path(module)
        if not path:
            continue
        found[module] = path
        with open(path, encoding="utf-8") as fh:
            tree = ast.parse(fh.read(), filename=path)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith("sr."):
                        pending.append(alias.name[3:])
            elif isinstance(node, ast.ImportFrom) and node.module:
                if node.module == "sr":
                    pending.extend(alias.name for alias in node.names)
                elif node.module.startswith("sr."):
                    local = node.module[3:]
                    pending.append(local)
                    pending.extend(local + "." + alias.name for alias in node.names)
    return sorted(found.values(), key=lambda path: os.path.relpath(path, PIPELINE))


def pipeline_id(product="build"):
    """Hash only the source graph that can produce one kind of generated asset.

    Map builds, synthetic fixtures and texture atlases have separate entry points. A standalone
    generator such as ``social_billboards.py`` cannot change any of them, so including it made a
    two-second sign edit rebuild fourteen minutes of maps before the browser could start.
    """
    entries = {"build": ("build",), "synth": ("synth",), "textures": ("textures",)}
    if product not in entries:
        raise ValueError("unknown pipeline product: %s" % product)
    h = hashlib.sha256()
    h.update(("source-graph-v1:" + product).encode())
    paths = _local_source_closure(entries[product])
    cli = os.path.join(PIPELINE, "sr", "cli.py")
    if os.path.isfile(cli):
        paths.append(cli)
    if product in ("build", "synth"):
        schema = os.path.join(PIPELINE, "sr", "schema")
        if os.path.isdir(schema):
            paths.extend(os.path.join(schema, name) for name in sorted(os.listdir(schema))
                         if name.endswith(".json"))
    for path in sorted(set(paths), key=lambda at: os.path.relpath(at, PIPELINE)):
        h.update(os.path.relpath(path, PIPELINE).encode())
        _hash_file(h, path)
    return h.hexdigest()


def track_ids():
    """Every track with a route definition, plus the synthetic ones the code generates."""
    routes = os.path.join(PIPELINE, "routes")
    real = sorted(f[:-5] for f in os.listdir(routes) if f.endswith(".json"))
    return real + ["synth-loop", "synth-p2p", "synth-stops"]


def is_synth(track):
    return track.startswith("synth")


def build_id(track, pipeline=None):
    """What this track's products depend on, as one hex string."""
    h = hashlib.sha256()
    product = "synth" if is_synth(track) else "build"
    h.update((pipeline or pipeline_id(product)).encode())
    h.update(track.encode())
    if is_synth(track):
        return h.hexdigest()[:16]     # generated from code alone; the pipeline hash covers it
    for rel in (os.path.join("routes", track + ".json"),
                os.path.join("items", track + ".json")):
        at = os.path.join(PIPELINE, rel)
        if os.path.exists(at):
            h.update(rel.encode())
            _hash_file(h, at)
    route = _load_pipeline_module("routes").load_route(track)
    landmark_entries = _load_pipeline_module("landmark_data").entries()
    for name in route.get("landmarks", []):
        h.update(b"landmark\x00")
        h.update(name.encode())
        entry = landmark_entries.get(name)
        h.update(json.dumps(entry, sort_keys=True, separators=(",", ":")).encode())
        # The model itself, not only its registration: the build slices each model at car height
        # against the road, and a swapped model with an unchanged entry must rebuild to be checked.
        if entry and entry.get("file"):
            model = os.path.normpath(os.path.join(ROOT, "game", "public", "tracks", track, entry["file"]))
            if os.path.exists(model):
                _hash_file(h, model)
    _hash_tree(h, os.path.join(PIPELINE, "cache", track))
    _hash_tree(h, os.path.join(PIPELINE, "cache", "dem"), contents=False)
    return h.hexdigest()[:16]


def textures_id():
    """Hash the texture generator and its imports, including UV constants from ``mesh.py``."""
    return pipeline_id("textures")[:16]


def complete(track):
    """Are the products all there? The index and one file per tile it names."""
    d = os.path.join(TRACKS, track)
    doc_at = os.path.join(d, "track.json")
    if not os.path.isfile(doc_at):
        return False
    try:
        with open(doc_at, encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return False
    if doc.get("tilePack"):
        return os.path.isfile(os.path.join(d, doc["tilePack"]["file"]))
    tiles = os.path.join(d, "tiles")
    return all(os.path.isfile(os.path.join(tiles, t["name"] + ".glb")) for t in doc.get("tiles", []))


def stamp_of(path):
    at = os.path.join(path, STAMP)
    try:
        with open(at, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return None


def state(track, want):
    """`fresh`, `stale` (built from something else) or `missing` (absent or half written)."""
    if not complete(track):
        return "missing"
    got = stamp_of(os.path.join(TRACKS, track))
    return "fresh" if got == want else "stale"


def clone(src, dst):
    """Copy a directory, cheaply where the filesystem allows it.

    `cp -c` asks APFS for a clonefile: the copy shares the original's blocks until one of them is
    written, so restoring a track is milliseconds and costs almost no disk. Other filesystems fall
    back to a real copy, which is slower but correct -- the same trade `worktree_new.py` makes.
    """
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(dst):
        shutil.rmtree(dst)
    if subprocess.run(["cp", "-Rc", src, dst], capture_output=True).returncode == 0:
        return "clonefile"
    shutil.copytree(src, dst)
    return "copy"


def store_path(kind, ident):
    return os.path.join(store_dir(), kind, ident)


def save(kind, ident, src):
    """Put a freshly built product into the store, so no tree ever builds it again."""
    dst = store_path(kind, ident)
    if os.path.exists(dst):
        return "already stored"
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + ".partial"
    if os.path.exists(tmp):
        shutil.rmtree(tmp)
    clone(src, tmp)
    # Rename last: a half-written entry under its real name would be restored as if it were whole,
    # which is the "half built" failure this module is supposed to catch, moved into the store.
    os.replace(tmp, dst)
    return "stored"


def restore(kind, ident, dst):
    src = store_path(kind, ident)
    if not os.path.isdir(src):
        return None
    return clone(src, dst)


def build_track(track, log=say, quiet=False):
    """Build one track. `quiet` (parallel builds) sends its output to pipeline/out/logs/<track>.log."""
    cmd = ([".venv/bin/python", "-m", "sr.cli", "synth"] if is_synth(track)
           else [".venv/bin/python", "-m", "sr.cli", "build", track, "--stage", "full"])
    log("  building %s: %s" % (track, " ".join(cmd)))
    started = time.time()
    if quiet:
        logs = os.path.join(PIPELINE, "out", "logs")
        os.makedirs(logs, exist_ok=True)
        path = os.path.join(logs, track + ".log")
        with open(path, "w") as out:
            p = subprocess.run(cmd, cwd=PIPELINE, stdout=out, stderr=subprocess.STDOUT)
        if p.returncode:
            with open(path, errors="replace") as fh:
                tail = fh.read().splitlines()[-12:]
            raise SystemExit("%s: build failed (exit %d), log %s:\n%s" % (track, p.returncode, path, "\n".join(tail)))
    else:
        p = subprocess.run(cmd, cwd=PIPELINE)
        if p.returncode:
            raise SystemExit("%s: build failed (exit %d)" % (track, p.returncode))
    log("  built %s in %.1fs" % (track, time.time() - started))


def build_textures(log=say):
    log("  building textures")
    p = subprocess.run([".venv/bin/python", "-m", "sr.cli", "textures"], cwd=PIPELINE)
    if p.returncode:
        raise SystemExit("textures: build failed (exit %d)" % p.returncode)


def ensure_track(track, pipeline=None, log=say, quiet=False):
    """check -> restore -> build, in that order. Returns what actually happened."""
    want = build_id(track, pipeline)
    if state(track, want) == "fresh":
        # Fresh here, but the store may still not have it: this tree may have built it before the
        # store existed, or a copy into the store may have failed once. Putting it in now is what
        # keeps "nobody builds this twice" true for the next tree.
        save("tracks/" + track, want, os.path.join(TRACKS, track))
        return "fresh"
    how = restore("tracks/" + track, want, os.path.join(TRACKS, track))
    if how:
        with open(os.path.join(TRACKS, track, STAMP), "w") as fh:
            fh.write(want)
        if state(track, want) == "fresh":
            return "restored (%s)" % how
    if quiet:
        build_track(track, log, quiet=True)
    else:
        build_track(track, log)
    with open(os.path.join(TRACKS, track, STAMP), "w") as fh:
        fh.write(want)
    if state(track, want) != "fresh":
        raise SystemExit("%s: built but still not complete" % track)
    save("tracks/" + track, want, os.path.join(TRACKS, track))
    return "built"


def ensure_textures(log=say):
    want = textures_id()
    have = stamp_of(TEXTURES)
    manifest = os.path.join(TEXTURES, "manifest.json")
    if have == want and os.path.isfile(manifest):
        return "fresh"
    how = restore("textures", want, TEXTURES)
    if how and os.path.isfile(manifest):
        with open(os.path.join(TEXTURES, STAMP), "w") as fh:
            fh.write(want)
        return "restored (%s)" % how
    build_textures(log)
    with open(os.path.join(TEXTURES, STAMP), "w") as fh:
        fh.write(want)
    save("textures", want, TEXTURES)
    return "built"


def menu_map_module():
    """The existing, standard-library-only generator owns projection and its regional inputs."""
    path = os.path.join(PIPELINE, "sr", "menumap.py")
    spec = importlib.util.spec_from_file_location("sr_menu_map", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def menu_map_paths():
    public = os.path.join(ROOT, "game", "public")
    return os.path.join(public, "menu-map.json"), os.path.join(public, ".menu-map.build-id")


def menu_map_id(module):
    h = hashlib.sha256()
    paths = [module.__file__, module.LAND_CACHE]
    for track in sorted(t for t in track_ids() if not is_synth(t)):
        h.update(track.encode())
        paths.extend(os.path.join(TRACKS, track, name) for name in ("track.json", "map.json"))
    for path in paths:
        h.update(os.path.relpath(path, ROOT).encode())
        if os.path.isfile(path):
            _hash_file(h, path)
        else:
            h.update(b"\x00missing")
    return h.hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    _hash_file(h, path)
    return h.hexdigest()


def menu_map_state(want):
    output, stamp = menu_map_paths()
    if not os.path.isfile(output):
        return "missing"
    try:
        with open(stamp, encoding="utf-8") as fh:
            recorded = json.load(fh)
        if recorded.get("inputs") == want and recorded.get("output") == file_hash(output):
            return "fresh"
    except (OSError, ValueError, AttributeError):
        pass
    return "stale"


def missing_menu_exports():
    return [track for track in track_ids() if not is_synth(track)
            and not os.path.isfile(os.path.join(TRACKS, track, "track.json"))]


def deferred_menu_map(args):
    # A targeted build promises only the requested track. Normal dev/build/preview use --all,
    # which must finish the whole roster before publishing the menu.
    missing = missing_menu_exports() if args.tracks and not args.all else []
    return "deferred (unexported: %s)" % ", ".join(missing) if missing else None


def ensure_menu_map(log=say):
    missing = missing_menu_exports()
    if missing:
        raise SystemExit("menu-map: no exported track.json for %s; run ensure --all" % ", ".join(missing))
    module = menu_map_module()
    want = menu_map_id(module)
    if menu_map_state(want) == "fresh":
        return "fresh"
    output, stamp = menu_map_paths()
    # Give the generator only the current roster. Old exported directories may survive a route's
    # removal, and must not put it back on the menu. Links avoid copying multi-megabyte splines.
    with tempfile.TemporaryDirectory(prefix="sr-menu-map-") as temporary:
        tracks = os.path.join(temporary, "tracks")
        os.mkdir(tracks)
        for track in sorted(t for t in track_ids() if not is_synth(t)):
            source = os.path.join(TRACKS, track)
            os.symlink(source, os.path.join(tracks, track), target_is_directory=True)
        generated = os.path.join(temporary, "menu-map.json")
        module.write(generated, tracks_root=tracks)
        # The exported file is tracked; identical output must not rewrite it just to refresh the
        # input stamp. Stage beside the destination so replacing it is atomic on every filesystem.
        digest = file_hash(generated)
        if not os.path.isfile(output) or file_hash(output) != digest:
            os.makedirs(os.path.dirname(output), exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=os.path.dirname(output), delete=False) as staged:
                staged_path = staged.name
                with open(generated, "rb") as src:
                    shutil.copyfileobj(src, staged)
            try:
                os.replace(staged_path, output)
            finally:
                if os.path.exists(staged_path):
                    os.remove(staged_path)
        with open(stamp, "w", encoding="utf-8") as fh:
            json.dump({"inputs": want, "output": digest}, fh)
    return "built"


def prune(keep=KEEP_PER_TRACK):
    """Keep the newest few generations of each product. One track is about 5 MB a generation."""
    root = store_dir()
    dropped = 0
    for kind_root, _dirs, _files in os.walk(root):
        entries = [e for e in os.listdir(kind_root)
                   if os.path.isdir(os.path.join(kind_root, e))]
        # A directory of build ids is one whose children are leaves of the store, not more kinds.
        ids = [e for e in entries if os.path.isfile(os.path.join(kind_root, e, STAMP))
               or os.path.isfile(os.path.join(kind_root, e, "track.json"))
               or os.path.isfile(os.path.join(kind_root, e, "manifest.json"))]
        if len(ids) <= keep:
            continue
        ids.sort(key=lambda e: os.path.getmtime(os.path.join(kind_root, e)), reverse=True)
        for old in ids[keep:]:
            shutil.rmtree(os.path.join(kind_root, old))
            dropped += 1
    return dropped


def selected(args):
    if args.all or not args.tracks:
        return track_ids()
    return [t.strip() for t in args.tracks.split(",") if t.strip()]


def cmd_check(args):
    bad = 0
    for track in selected(args):
        st = state(track, build_id(track))
        if st != "fresh":
            bad += 1
        say("%-18s %s" % (track, st))
    tex = "fresh" if stamp_of(TEXTURES) == textures_id() else "stale or missing"
    say("%-18s %s" % ("textures", tex))
    if tex != "fresh":
        bad += 1
    deferred = deferred_menu_map(args)
    menu = deferred or menu_map_state(menu_map_id(menu_map_module()))
    say("%-18s %s" % ("menu-map", menu))
    if not deferred and menu != "fresh":
        bad += 1
    say("OK" if not bad else "%d not fresh (run: python3 tools/assets.py ensure --all)" % bad)
    return 0 if not bad else 1


def cmd_ensure(args):
    started = time.time()
    did = {}
    did["textures"] = ensure_textures()
    want = selected(args)
    # `sr.cli synth` writes all three fixtures in one pass, so building them one at a time would run
    # it three times for the same work. Restoring from the store is still per track.
    synth = [t for t in want if is_synth(t)]
    if synth and any(state(t, build_id(t)) != "fresh" for t in synth):
        if all(restore("tracks/" + t, build_id(t), os.path.join(TRACKS, t)) for t in synth):
            for t in synth:
                with open(os.path.join(TRACKS, t, STAMP), "w") as fh:
                    fh.write(build_id(t))
        else:
            build_track(synth[0])
            for t in synth:
                ident = build_id(t)
                with open(os.path.join(TRACKS, t, STAMP), "w") as fh:
                    fh.write(ident)
                save("tracks/" + t, ident, os.path.join(TRACKS, t))
        for t in synth:
            did[t] = "fresh" if state(t, build_id(t)) == "fresh" else "FAILED"
    # Tracks are independent -- each reads its own caches and writes its own folder -- so they build
    # side by side. One after another, a change to the generator cost about eleven minutes for fifteen
    # cities on a ten-core machine using one core. `--jobs 1` restores the old order and live output.
    rest = [t for t in want if t not in did]
    jobs = max(1, min(getattr(args, 'jobs', 1), len(rest) or 1))
    if jobs == 1:
        for track in rest:
            did[track] = ensure_track(track)
    else:
        from concurrent.futures import ThreadPoolExecutor
        say("building up to %d tracks at a time (logs in pipeline/out/logs/)" % jobs)
        def one(track):
            try:
                return ensure_track(track, quiet=True)
            except SystemExit as failure:
                say(str(failure))
                return "FAILED"
        with ThreadPoolExecutor(jobs) as pool:
            for track, what in zip(rest, pool.map(one, rest)):
                did[track] = what
    for name, what in did.items():
        say("%-18s %s" % (name, what))
    prune()
    broken = [name for name, what in did.items() if what == "FAILED"]
    if broken:
        
        say("没建成：%s" % ", ".join(broken))
        return 1
    say("%-18s %s" % ("menu-map", deferred_menu_map(args) or ensure_menu_map()))
    say("assets ready in %.1fs" % (time.time() - started))
    return 0


def cmd_prune(args):
    say("dropped %d old entries from %s" % (prune(args.keep), store_dir()))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="保证这棵树里的地图数据跟代码对得上")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "ensure"):
        p = sub.add_parser(name)
        p.add_argument("--tracks", default="", help="逗号分隔；不给就是全部")
        p.add_argument("--all", action="store_true")
        p.add_argument("--jobs", type=int, default=max(1, min(4, (os.cpu_count() or 2) // 2)),
                       help="how many tracks to build at once (default: half the cores, at most 4)")
    p = sub.add_parser("prune")
    p.add_argument("--keep", type=int, default=KEEP_PER_TRACK)
    a = ap.parse_args(argv)
    return {"check": cmd_check, "ensure": cmd_ensure, "prune": cmd_prune}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
