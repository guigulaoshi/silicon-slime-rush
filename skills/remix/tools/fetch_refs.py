"""下参考照片：从 Wikimedia Commons 搜图，缩略图（1280 px 宽，维基的标准档：非标准宽度要现场生成，会被狠狠限流）存进一个目录，出处和许可证逐张记下。

    python3 tools/fetch_refs.py <目录> "<搜索词>" ["<搜索词>" ...] [--n 14]

每个搜索词取前十几张 JPEG（宽 800 px 以上），合计最多 --n 张，存成 ref00.jpg、ref01.jpg……，
每张的 Commons 页面、标题、许可证、搜索词追加进同目录的 sources.json（一行一条）。

**这个脚本由主 Agent 跑，不交给子 Agent 跑。** 子 Agent 只认使用者在对话里亲口给的授权，
主 Agent 转述的「使用者同意下载了」它不认（这是模型的安全设计：它分不清转述和冒充，改不了也不该绕）。
所以照片和公开资料由主 Agent 下好放进每个地标自己的目录，子 Agent 只打开来看、拿来比对。
下载授权在盘问第 19b 问拿。照片只拿来比对，不进仓库、不进游戏。
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "RemixReferencePhotos/1.0 (reference photos for 3D modelling)"}


def get(url, tries=6):
    """GET with back-off: Commons answers 429 when asked too fast, with a Retry-After to honour."""
    import urllib.error
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as err:
            if err.code not in (429, 503) or attempt == tries - 1:
                raise
            wait = float(err.headers.get("Retry-After") or 0) or 5 * 2 ** attempt
            time.sleep(min(wait, 120))


def search(query, limit=12):
    params = {"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6,
              "gsrsearch": query + " filetype:bitmap", "gsrlimit": limit, "prop": "imageinfo",
              "iiprop": "url|mime|size|extmetadata", "iiurlwidth": 1280}
    data = json.loads(get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)))
    pages = sorted(data.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
    for page in pages:
        info = (page.get("imageinfo") or [{}])[0]
        if info.get("mime") != "image/jpeg" or info.get("width", 0) < 800:
            continue
        licence = info.get("extmetadata", {}).get("LicenseShortName", {}).get("value", "")
        yield page["title"], info.get("thumburl") or info["url"], info.get("descriptionurl"), licence


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    most = 14
    if "--n" in argv:
        i = argv.index("--n"); most = int(argv[i + 1]); argv = argv[:i] + argv[i + 2:]
    out, queries = argv[0], argv[1:]
    os.makedirs(out, exist_ok=True)
    have = len([f for f in os.listdir(out) if f.startswith("ref") and f.endswith(".jpg")])
    rows = []
    for query in queries:
        for title, url, page, licence in search(query):
            if have >= most:
                break
            name = f"ref{have:02d}.jpg"
            try:
                blob = get(url)
            except Exception as err:
                print("跳过", title, err)
                continue
            with open(os.path.join(out, name), "wb") as f:
                f.write(blob)
            rows.append({"file": name, "title": title, "page": page, "license": licence, "query": query})
            have += 1
            time.sleep(1.5)
    with open(os.path.join(out, "sources.json"), "a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"{out}: {have} 张")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
