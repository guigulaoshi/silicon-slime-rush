"""The audit's own net: each check has to fail on the thing it exists to catch."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import release_audit                                              # noqa: E402


def build(tmp_path, index="<!doctype html><title>game</title>", **files):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text(index, encoding="utf-8")
    for name, body in files.items():
        path = dist / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
    return str(dist)


def test_a_clean_build_has_nothing_to_report(tmp_path):
    findings, checked = release_audit.scan(build(tmp_path, **{"assets/main.js": "const a=1;"}))
    assert findings == []
    assert checked == 2


def test_development_details_and_private_paths_are_found(tmp_path):
    dist = build(tmp_path, **{
        "assets/main.js": "// task 101 (用户 2020-01-01：「示例」)\nconst home='/Users/somebody/game';",
        "billboards/manifest.json": '{"_note": "任务101 的说明"}',
        "assets/dev.js": "//# sourceMappingURL=main.js.map\nrun python3 tools/assets.py ensure --all",
    })
    kinds = {f["kind"] for f in release_audit.scan(dist)[0]}
    assert {"task number", "task number (zh)", "quoted conversation", "home directory",
            "source map", "developer command"} <= kinds


def test_escaped_strings_in_an_obfuscated_bundle_are_read_as_text(tmp_path):
    # The obfuscator's string table writes spaces as \x20, which hid every marker with a space.
    dist = build(tmp_path, **{"assets/main.js": "var _0x1=['task\\x20123\\x20left\\x20a\\x20note','\\u7528\\u6237\\x202026-09-18'];"})
    kinds = {f["kind"] for f in release_audit.scan(dist)[0]}
    assert "task number" in kinds
    assert "quoted conversation" in kinds


def test_a_chunk_name_the_bundler_never_filled_in_is_found(tmp_path):
    # What an obfuscation pass run too early left in the release: the game asked the server
    # for this file, got a 404, and never started.
    dist = build(tmp_path, **{"assets/index.js": 'import("./main-!~{003}~.js")'})
    assert "unresolved chunk placeholder" in {f["kind"] for f in release_audit.scan(dist)[0]}


def test_a_stylesheet_nothing_loads_is_found(tmp_path):
    dist = build(tmp_path, **{"assets/main-abc.css": "body{background:#000}",
                              "assets/index.js": "import('./main-abc.js')"})
    assert "stylesheet nothing loads" in {f["kind"] for f in release_audit.scan(dist)[0]}
    (tmp_path / "linked").mkdir()
    linked = build(tmp_path / "linked", **{"assets/main-abc.css": "body{}",
                                           "assets/index.js": "preload(['assets/main-abc.css'])"})
    assert "stylesheet nothing loads" not in {f["kind"] for f in release_audit.scan(linked)[0]}


def test_the_integrity_question_ignores_wording_and_sees_only_breakage(tmp_path):
    dist = build(tmp_path, **{"assets/main-abc.css": "body{}",
                              "assets/index.js": "// task 448\nimport('./main-!~{003}~.js')"})
    assert {f["kind"] for f in release_audit.integrity(dist)} == release_audit.INTEGRITY_KINDS


def test_third_party_licence_prose_keeps_its_authors(tmp_path):
    dist = build(tmp_path, **{"credits.txt": "MIT, by somebody <someone@example.com>「引文」"})
    assert release_audit.scan(dist)[0] == []


def test_the_store_copy_is_scanned_too(tmp_path):
    dist = build(tmp_path)
    store = tmp_path / "page.json"
    store.write_text('{"cover": "/Users/somebody/cover.png"}', encoding="utf-8")
    findings, checked = release_audit.scan(dist, [str(store)])
    assert [f["kind"] for f in findings] == ["home directory"]
    assert checked == 2


def test_a_build_older_than_its_sources_is_refused(tmp_path, monkeypatch):
    dist = build(tmp_path)
    source = tmp_path / "src"
    source.mkdir()
    (source / "main.ts").write_text("export const a = 1;", encoding="utf-8")
    os.utime(os.path.join(dist, "index.html"), (time.time() - 60, time.time() - 60))
    monkeypatch.setattr(release_audit, "ROOT", str(tmp_path))
    monkeypatch.setattr(release_audit, "SOURCES", ("src",))
    stale = release_audit.freshness(dist)
    assert stale and "npm run build" in stale["detail"]
    os.utime(os.path.join(dist, "index.html"), None)
    assert release_audit.freshness(dist) is None


def test_identifiers_are_not_addresses_and_only_listed_hosts_may_stall():
    assert release_audit._identifier("https://silicon-rush.local/track.schema.json")
    assert release_audit._identifier("https://json-schema.org/draft/2020-12/schema")
    assert not release_audit._identifier("https://guigulaoshi.itch.io/")
    assert release_audit._browser_only("https://www.af.mil/About-Us/Fact-Sheets/")
    assert not release_audit._browser_only("https://example.com/")


def test_a_build_from_uncommitted_changes_is_found(tmp_path):
    # The upload was built from a dirty tree and its About page said so to players.
    # credits.txt is where the build states it (game/build/credits.ts writes the words this reads).
    marker = release_audit._uncommitted()
    dirty = build(tmp_path, **{"credits.txt": "Silicon Slime Rush\nVersion 1.0 %s\n" % marker})
    assert "built from uncommitted changes" in {f["kind"] for f in release_audit.scan(dirty)[0]}
    (tmp_path / "clean").mkdir()
    clean = build(tmp_path / "clean", **{"credits.txt": "Silicon Slime Rush\nVersion 1.0\n"})
    assert release_audit.scan(clean)[0] == []


def test_the_upload_build_is_the_one_that_refuses_uncommitted_changes(monkeypatch):
    # Game/build/credits.ts refuses a dirty tree only when SR_RELEASE is set, and
    # release_package.py is the one command that makes an upload, so it has to set it.
    import release_package
    seen = {}

    class Stop(Exception):
        pass

    def run(command, cwd, env=None):
        seen.update(env or {})
        raise Stop

    monkeypatch.setattr(release_package, "run", run)
    monkeypatch.setattr(sys, "argv", ["release_package.py"])
    try:
        release_package.main()
    except Stop:
        pass
    assert seen.get("SR_RELEASE") == "1"


def test_an_address_in_obfuscated_code_stops_at_its_own_quote():
    # On the obfuscated package the address ran on into the code after it and
    # four real links were reported as 404s.
    # sfrecpark/Twin-Peaks and sftravel/lombard, moffett-field's old place-flavoured example URLs,
    # retargeted to zhangjiajie and rio -- same shapes tested:
    # a hyphenated facility path, and an object literal keyed by a route id with a themed URL value.
    body = ("var a='https://guigulaoshi.itch.io/silicon-slime-rush-world-tour';function f(){}"
            "x={'url':'https://www.tiktok.com/@guigulaoshi','color':S5(0x8f0)};"
            'y="https://www.douyin.com/video/7523429959499664678",z=`https://example.org/a`;'
            '<a href="https://www.zhangjiajie-park.example/Facilities/Facility/Details/Tianzi-338">x</a>'
            "See [the map](https://www.openstreetmap.org/copyright). Plain https://example.com/path, then more."
            "list.filter(u=>u.startsWith('https://'));"
            "m={'rio':'https://www.riotur.example/corcovado-climb','dubai':'https://www.dubai.example/marina-drive'};")
    assert release_audit.addresses(body) == {
        "https://guigulaoshi.itch.io/silicon-slime-rush-world-tour",
        "https://www.tiktok.com/@guigulaoshi",
        "https://www.douyin.com/video/7523429959499664678",
        "https://example.org/a",
        "https://www.zhangjiajie-park.example/Facilities/Facility/Details/Tianzi-338",
        "https://www.openstreetmap.org/copyright",
        "https://example.com/path",
        "https://www.riotur.example/corcovado-climb",
        "https://www.dubai.example/marina-drive",
    }
    assert release_audit.addresses("https://example.com/at-the-start") == {"https://example.com/at-the-start"}


def test_an_address_keeps_a_bracket_it_opened_and_drops_one_from_the_prose():
    # A route's source link to a Wikipedia page named with brackets was cut at ")" and reported as a 404.
    body = "see (https://en.wikipedia.org/wiki/Christ_the_Redeemer_(statue)). or https://example.com/a)."
    assert release_audit.addresses(body) == {
        "https://en.wikipedia.org/wiki/Christ_the_Redeemer_(statue)", "https://example.com/a"}


def test_a_really_broken_address_is_still_reported(tmp_path, monkeypatch):
    dist = build(tmp_path, **{"assets/main.js": "const a='https://dead.example/gone';function f(){}"})
    opened = []

    def urlopen(request, timeout):
        opened.append(request.full_url)
        raise release_audit.urllib.error.HTTPError(request.full_url, 404, "Not Found", {}, None)

    monkeypatch.setattr(release_audit.urllib.request, "urlopen", urlopen)
    found, bad, skipped = release_audit.links(dist, [])
    assert opened == ["https://dead.example/gone"]
    assert bad == [{"url": "https://dead.example/gone", "status": 404}]
