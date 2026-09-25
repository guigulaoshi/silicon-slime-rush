# original 的结构，和换皮要改的地方

这份是 `original/` 的地图：管线怎么把真实地图变成赛道、游戏怎么加载、换一座城市要碰哪些文件、哪些地方写死了湾区。
**所有路径都相对于 `original/`。**

刚 clone 下来的树里没有下面这些，它们是构建产物或本机环境，要跑命令才出现：
`game/node_modules/`、`pipeline/.venv/`、`game/dist/`、`game/release/`、`game/public/textures/`、
`game/public/tracks/*/tiles/`（及 `tiles.bin`、`backdrop.glb`）、`pipeline/out/`、`tools/baselines/`。

先说结论：**地图管线本身是通用的**（给经纬度航点就能从 OpenStreetMap 和公开高程拉数据、切成赛道），
真正会让人卡住的是散落在十几处的“按赛道 id 写死的表”、湾区专属的手写地标和配色、原作者本人的外链。
第 5 节是绊脚石清单，第 2.3 节是“加一条新赛道要碰的所有地方”。

---

## 1. 架构一屏

### 1.1 管线：输入 → 输出

入口是 `pipeline/sr/cli.py`（`python -m sr.cli <命令>`，在 `pipeline/` 下用 `.venv/bin/python` 跑）。

| 阶段 | 代码 | 输入 | 输出 |
|---|---|---|---|
| 拉 OSM | `pipeline/sr/fetch_osm.py` | `pipeline/routes/<id>.json` 的航点/`bboxPoints`，外扩 `padM`（默认 300 m）；背景层外扩 `backdropM` | `pipeline/cache/<id>/{roads,buildings,landuse,trees,backdrop}.json.gz`（原始 Overpass JSON，gzip，**进版本库**） |
| 拉高程 | `pipeline/sr/fetch_dem.py` | 同一包围盒；走廊用 z15（约 5 m/像素），远景用 z12，半径取 `max(backdropM, 35 km + 2 km)`（`pipeline/sr/horizon.py` 的 `RADIUS`/`FETCH_MARGIN`） | `pipeline/cache/dem/15/x/y.png`、`pipeline/cache/dem/12/x/y.png`（Terrarium PNG，进版本库） |
| 路线 | `pipeline/sr/route.py` | 航点吸附到 OSM 路网，最短路串成中心线，两米一点样条；宽度夹在 `RACE_MIN_HALF=6`、`RACE_MAX_HALF=14` 之间 | 内存里的 `res`（样条、宽度、桥段） |
| 地形/水 | `pipeline/sr/terrain.py`、`pipeline/sr/horizon.py`、`pipeline/sr/landcover.py` | DEM + OSM 用地；水面按高程判（0 m 即海岸线，缺水深的海域用路线的 `waterLevelM`） | 路外地形、水面、远山 |
| 路面、标线、护栏 | `pipeline/sr/roads.py`、`pipeline/sr/markings.py`、`pipeline/sr/bridge.py` | 路网 + 路线参数 | 带状网格 |
| 建筑、植被、广告牌、史莱姆 | `pipeline/sr/buildings.py`、`pipeline/sr/vistas.py`、`pipeline/sr/architecture.py`、`pipeline/sr/vegetation.py`、`pipeline/sr/billboards.py`、`pipeline/sr/slimes.py` | OSM 建筑轮廓、树、路线 | 合并网格与实例 |
| 地标 | `pipeline/sr/landmarks.py`（程序化，进 backdrop）、`pipeline/sr/landmark_data.py`（读 `pipeline/landmarks.json`） | 路线 JSON 的 `landmarks` 列表 | backdrop 里的地标网格；`track.json` 的 `landmarks[]`（GLB 摆放） |
| 切片与导出 | `pipeline/sr/tiles.py`、`pipeline/sr/export.py`、`pipeline/sr/backdrop.py`、`pipeline/sr/streetmap.py` | 以上全部 | `game/public/tracks/<id>/track.json`、`map.json`、`tiles/t_<col>_<row>.glb`、`backdrop.glb`；预览图 `pipeline/out/<id>/preview.png` |
| 贴图 | `pipeline/sr/textures.py`（`sr.cli textures`） | 纯代码程序生成 | `game/public/textures/*.webp` + `manifest.json` |
| 开场地图 | `pipeline/sr/menumap.py`（`sr.cli menu-map`） | `pipeline/cache/bayarea/{coast,roads,places}.json.gz` + 已导出的各赛道 | `game/public/menu-map.json`（进版本库） |
| 合成测试赛道 | `pipeline/sr/synth.py`（`sr.cli synth`） | 无网络 | `game/public/tracks/synth-{loop,p2p,stops}/` |
| 社交广告牌图 | `pipeline/sr/social_billboards.py`（直接 `python -m sr.social_billboards`） | 原作者自己的社媒素材（不随公开版分发）+ `game/public/billboards/manifest.json` | `game/public/billboards/social-*.png` |

`build <id> --stage greybox|full`：`tools/assets.py` 调的是 `--stage full`。耗时取决于地图规模和运行环境。

### 1.2 游戏怎么加载地图

- 游戏是 Three.js + Rapier + TypeScript + Vite，在 `game/`。
- 每条赛道一个 `game/public/tracks/<id>/track.json`，里面有样条、检查点、切片索引、backdrop、地标摆放。
- 切片是**轴对齐 256 米方格**的 GLB（meshopt 压缩，实例用 `EXT_mesh_gpu_instancing`，**不内嵌贴图**，材质只带名字）。
  - 开发时（`npm run dev`）读散文件 `tiles/<name>.glb`；
  - `npm run build` 由 `game/vite.config.ts` 的 `packTiles()` 把一条赛道的切片首尾相接打成 `tiles.bin`，在 `track.json` 里补 `tilePack` 和每片 `offset/length`。运行时整包下载一次、在内存里切。
- 流式加载：`game/src/world/TileStreamer.ts` + `game/src/world/streaming.ts`，默认窗口沿路身后 300 m、前方 1500 m、欧氏半径 1000 m、滞回 300 m，最多 4 个并发请求。
- 远景 `backdrop.glb` 常驻；地标 GLB 由 `game/src/world/Landmarks.ts` 按每个实例的 `loadRadius` 进出（超过 1.25 倍卸载），同一文件共用一份模板。
- 材质按名字挂共享材质库 `game/src/world/materials.ts`，贴图清单读 `game/public/textures/manifest.json`。
- 赛道 JSON 的 TS 类型在 `game/src/track/types.ts`，校验在 `game/src/track/schema.ts`。

### 1.3 管线↔游戏契约（`docs/CONTRACT.md` 要点）

机器可查部分是 `pipeline/sr/schema/track.schema.json`，两边各有测试拿它校验。**只加不改**：改字段含义要管线、运行时、合成赛道同一个 commit 改。

1. **坐标**：每条赛道一个固定本地原点 `origin{lat,lon}`（等距方位投影 aeqd，`pipeline/sr/geo.py` 的 `LocalFrame`）；x 向东、y 向上（海拔米）、z 向南；单位米；`yaw` 绕 y，0 朝北（−z），俯视逆时针为正。样条参数 `s` 是三维累计弧长。
2. **track.json 字段**：`id`（小写字母数字连字符，也是目录名和 i18n 键的一部分）、`mode`（loop/p2p/multistop）、`laps`、`name`/`blurb`（中英）、`origin`、`timeOfDay`（`day`/`night`）、`car`（旧车型名 sedan/super/convertible/hatch，经 `catalogue.json` 的 `legacyDefaults` 映射到真车）、`spline`、`start`、`checkpoints`、`tiles`、`backdrop`、`landmarks`、`attribution`、可选 `camera.heightM`、`endRoads`。`category` 是历史字段，照写但运行时不再用。`items`/`traffic` 是保留字段，没有实现。
3. **切片节点名前缀**决定渲染层和碰撞：`road`/`terrain`/`bridge`/`guardrail`/`deck` 用三角网碰撞；`buildings*` 用盒子（`extras.boxes`，只含离赛道 60 m 内的）；`water` 带 `killY`；`props_slime_*` 是五种史莱姆的摆放；`props_billboard_face_a..n` 是十四个牌面槽位；`trees_*`、`flowers`、`markings_white/yellow` 等无碰撞。
4. **材质名字表是接口**：管线 `pipeline/sr/export.py` 的 `MATERIALS` 与运行时 `MATERIAL_NAMES` 必须一致，有测试。缺名字运行时显示洋红色。
5. **三个跨两边的数**：`road_lift_m = 0.06`、`facade_uv_metres = 3.0`、`ribbon_uv_metres = 4.0`，两边各有测试对。
6. **i18n 键**：`game/src/ui/locales/zh.json` 与 `en.json` 键集合必须完全相同；赛道键 `track.<id>.name/.blurb`，运行时以 i18n 为准，`track.json` 里的文案只是预览副本。
7. **menu-map.json** 全是 `[经度, 纬度]`，`region` 是 `[南, 西, 北, 东]`，水面按 even-odd 填充。
8. **广告牌内容**由 `game/public/billboards/manifest.json` 决定，不用重跑管线（**菜单出图要从材质库按名字关掉全部广告牌**：原作 `game/e2e/menu-shots.spec.ts` 靠遍历场景来关，还没流进来的切片遍历不到，一进来就亮，原作者的社媒牌子会出现在你的菜单图里；截图前断言可画的广告牌材质为 0）；十四槽位按“作者社媒 / 招商位”交替，七个社媒槽固定对应七个平台。
9. **贴图**：WebP，清单里只有 `repeat` 是运行时认的字段；显存按 `px²×4×4/3` 算。

---

## 2. 换皮者要改的东西，逐项到文件

### 2.1 地区范围与投影原点

- **每条赛道自己的原点**：`pipeline/routes/<id>.json` 的 `origin`。没有全局原点，也没有全局包围盒。
- **抓数据的范围**：同一文件的航点 + `bboxPoints` + `padM`（走廊）/`backdropM`（远景）；长路线用 `corridorFetch: true` 沿线分段抓（`pipeline/sr/routes.py` 的 `fetch_boxes`）。
- **唯一的“全局地区”是开场地图**：`pipeline/sr/menumap.py` 顶部常量
  - `REGION = (37.15, -122.85, 38.25, -121.55)`（取景框，南西北东）
  - `PLACE_NAMES`（八个湾区城市名，按 OSM `name` 取）
  - `REGION_CACHE`/`ROADS_CACHE`/`PLACES_CACHE` 指向 `pipeline/cache/bayarea/`
  - 换地区要改这些常量，删掉 `pipeline/cache/bayarea/*.json.gz` 后重拉：`fetch_region()`、`fetch_region_roads()`、`fetch_region_places()`（`docs/CONTRACT.md` 第 7 节给的是 `.venv/bin/python -c 'from sr import menumap; menumap.fetch_region()'`，另外两个同理）。
  - 地名的中英显示在 i18n 的 `place.<slug>` 键（`slug` 由 `menumap.slug()` 从 OSM 名生成，只是转小写、空格换连字符）。
    地名只抓 `place=city|town` 的节点、按 OSM `name` 匹配：非拉丁文字地区的 `name` 是当地文字，slug 会变成非 ASCII 键，
    改用 `name:en` 生成更稳；有的城市的区标的是 `suburb`/`quarter`，一个都抓不到——先查清目标城市的 place 标签。
    `game/test/ui.test.ts` 要求开场地图上多于 4 个地名。
  - 开场地图上路线跑出 `REGION` 的会画成边缘标记（`game/src/ui/menuMap.ts`）。
- **赛道长度**：原作按公里管（目标 3–5 km、上限 6 km，`tools/test_track_length.py`）；换皮按秒数管，见 places-to-track.md 第 2 步。
- **开场地图换成全世界（或跨很远的几座城）时**：陆地用粗高程里高于海平面的格子拼，黑海、里海这种内海单独留成水；地名避让把所有城市的点都当障碍，汉字按两倍宽估；放大圈按“盖住的城市最少”选位置；地图的切口放在太平洋上。

### 2.2 OSM / 高程数据源、下载和缓存

| 数据 | 从哪来 | 代码 | 缓存 |
|---|---|---|---|
| OSM | Overpass，四个镜像轮换 + 指数退避（`MIRRORS`，User-Agent 写着 `silicon-rush-pipeline/0.1`） | `pipeline/sr/fetch_osm.py` | `pipeline/cache/<id>/*.json.gz`，每个文件带 `_meta`（路线、层、包围盒、日期） |
| 高程 | Mapzen Terrarium，AWS S3 `elevation-tiles-prod`，免钥匙；解码 `R*256+G+B/256-32768` | `pipeline/sr/fetch_dem.py`、`pipeline/sr/dem.py` | `pipeline/cache/dem/{15,12}/x/y.png` |

- 命令：`python -m sr.cli fetch <id|all>`，已有文件跳过，`--force` 重拉。说明在 `pipeline/cache/README.md`。
- **缓存进版本库**（现在约 77 MB，其中 DEM 64 MB），所以别人 clone 下来可以离线重建原来那八条。换皮者的新地区**必须联网拉一次**，然后同样可以提交。
- Overpass 全挂时的退路（Geofabrik 本地切）**没有实现**。
- `bboxPoints` 一改，缓存就对不上，要重拉；路线 notes 里专门提醒过这一点。
- 缺 DEM 瓦片时走廊采样读 0 m（当海面），远景用 `require_complete=True` 会直接报错。

### 2.3 路线 / 赛道定义

**路线文件**：`pipeline/routes/<id>.json`，字段说明在 `pipeline/routes/README.md`。必填：`id`、`name{zh,en}`、`blurb{zh,en}`、`category`（历史字段，照填）、`mode`、`laps`、`car`、`timeOfDay`、`origin`、`waypoints`（`[lat,lon]` 或 `{"road":..., "pick":...}`、`{"junction":[...]}`、`{"ref":..., "pick":"nearest:lat,lon"}`）；用路名选择器时必须给 `bboxPoints`。
常用可选：`padM`、`backdropM`、`terrainPadM`、`halfWidthDefault`、`landmarks`、`groundCover`、`waterLevelM`、`bridgeDeckM`/`bridgeMinLengthM`、`suspension`（悬索桥钢结构参数）、`sharedDeckOnBridges`、`slimeCount`/`slimeDensity`、`camera`、`respectOneway`、`maxSnapM`、`mustPass`、`snapExclude`、`guardrails`、`editions`。
专用结构：`roofLoop`（楼顶环线，`wolfe-pruneridge` 用）、`airfieldCircuit`/`aircraftDisplays`/`airportVehicles`（机场，`moffett-field` 用）。

**加（或换掉）一条赛道要碰的全部地方**——少一处就会红或者出错：

| # | 文件 | 要做什么 | 不做的后果 |
|---|---|---|---|
| 1 | `pipeline/routes/<id>.json` | 新建 | — |
| 2 | `pipeline/sr/vistas.py` 的 `PROFILES` | 给新 id 加一个 `VistaProfile`（远景低层城区的间距、密度、层高、屋顶比例、兜底地面、`source_key`） | `profile(route_id)` 直接 `KeyError`，`build` 失败（backdrop 和 architecture 都调它） |
| 3 | `pipeline/sr/vistas.py` 的 `settlement_mask` | 可选：大片空地（湿地、机场）用经纬度半平面挖掉 | 远景楼可能长在湿地上 |
| 4 | `game/src/app/tracks.ts` | `CATALOGUE` 加一行（顺序即菜单顺序），`BUILT` 加 id；`hiddenStreetNames` 可隐藏商标路名 | 菜单里没有或不能玩 |
| 5 | `game/src/ui/locales/zh.json`、`en.json` | `track.<id>.name`、`.blurb`、`.fact` 三个键，两边都加 | 键集合不一致测试红；`game/test/routeFacts.test.ts` 查 `.fact` |
| 6 | `game/src/ui/RouteDetails.ts` 的 `ROUTE_SOURCES` | 每条赛道一个 https 出处链接（给 `.fact` 做出处） | `game/test/routeFacts.test.ts` 红 |
| 7 | `game/src/track/aiPace.json` | 每条赛道 × 方向 × 每辆车的 AI 完赛秒数，量出来的：`cd game && SR_UPDATE_AI_PACE=1 npx vitest run test/autopilot.test.ts -t "AI pace"` | 星级评分退回估算；那条测试在表过期时红 |
| 8 | `game/public/menu/tracks/<id>.webp` 和 `game/public/menu/world/<id>/`（15 张：昼夜 × 天气 + AI 档） | 用 `game/e2e/menu-shots.spec.ts`（`MENU_SHOTS=survey|preview|render`）按 `game/e2e/menu-shots.json` 里的机位截 | 菜单卡片图缺失时回退到金门那张 |
| 9 | `game/public/menu-map.json` | `python3 tools/assets.py ensure --all` 会在全部赛道导出后重生成 | 开场地图没有这条线 |
| 10 | `game/src/track/Direction.ts` 的 `SWAPPED_ROUTES` | 只有想让“正向”从作者定的终点出发时才加 | — |
| 11 | `tools/test_track_length.py` | 换皮时换成按秒数的检查后删掉（见 places-to-track.md 第 2 步） | 测试红 |

注意：`tools/assets.py` 的 `track_ids()` 是**扫 `pipeline/routes/*.json`** 决定要建哪些赛道的，所以删掉的旧路线文件必须真删，不然还会被建。

验证一条路线：`cd pipeline && .venv/bin/python -m sr.cli preview <id>`（只画俯视图到 `pipeline/out/<id>/route-preview.png`），然后 `build`，再跑机器人：`cd game && npx playwright test e2e/drive.spec.ts -g "<id>"`。

### 2.4 地标

地标有**三种**，换皮者要分清：

**(a) 手写程序化地标**（写死在 Python 里，湾区专属）：`pipeline/sr/landmarks.py` 的 `REGISTRY`——`golden-gate-bridge`、`bay-bridge-west`、`alcatraz`、`sutro-tower`，坐标和尺寸直接写在代码常量里（`GOLDEN_GATE`、`BAY_BRIDGE_WEST`…），生成进 `backdrop.glb`。换皮者要么删掉、要么照这个模式给自己城市写新函数并注册。`KINDS` 里还有一个通用类型 `overlook`（观景平台，只要 `pipeline/landmarks.json` 里的轮廓）。

**(b) Blender 做的 GLB 地标**（通用机制，最值得换皮者用）：

1. 在 `pipeline/landmarks.json` 加一条：`id`、`kind: "glb"`、`file: "../../models/landmarks/<id>.glb"`（相对于 `tracks/<赛道>/`）、`loadRadius`（米）、`heightM`，以及**二选一**：
   - `footprint`：从 OSM 抄来的经纬度环（`source` 写 OSM way 号）——锚点是轮廓质心，这个轮廓同时会把普通 OSM 建筑从这里剔掉，并挡住广告牌和树；
   - 或 `lat`/`lon` + `yaw`（弧度）——给不在 OSM 里的东西（比如停着的飞机）。
2. 路线 JSON 的 `landmarks` 数组写上这个 id。
3. 写 bpy 脚本放 `assets-src/landmarks/`，用 `assets-src/landmarks/build_landmark_tools.py` 的 `Model(id)`：它调 `survey()` 用管线自己的投影算出锚点、轮廓主轴和局部轮廓，所以脚本里按“横向 u / 高 y / 沿主轴 v”建模，导出时已经转到正确朝向（东 +X、上 +Y、南 +Z），**单位米、恒等缩放、地面 y=0 在锚点处**。跑法：`Blender --background --python assets-src/landmarks/build_<名字>.py`。
4. `Model` 导出时直接把成品写到 `game/public/models/landmarks/<id>.glb`（这些成品**进版本库**），是没压缩的 float32。
   **别在原地压**：管线用 trimesh 读这些文件做车高切面检查（它解不了 meshopt），还把字节哈希进每条赛道的构建号，原地压会让全部赛道重建、检查读不了。
   **在出包时压**：`vite build` 里加一个插件，把 `dist/models/landmarks/*.glb` 逐个交给 `assets-src/compress_models.mjs`（无损 meshopt，
   三角形、节点、材质变了就拒绝写），按原文件哈希缓存。压缩作为构建的一步执行，并检查模型内容保持一致。
5. 管线 `build` 时（`pipeline/sr/build.py` 末尾）按 `model_anchor()` 算位置，y 取锚点处 DEM 高程——**换皮时改成占地一圈最低的成品地面**（复用 `pipeline/sr/buildings.py` 的楼房地基算法），加一条撤掉修复就红的测试：在城里锚点那一点量到的常常是楼顶；`yaw` 取条目的 `yaw`（缺省 0），写进 `track.json` 的 `landmarks[]`。
   **原作的地标默认没有碰撞，换皮时第一件事就是把默认改成“有”**：`pipeline/sr/build.py` 里 `models.append(...)` 那一行把
   `entry.get("collision")` 改成 `entry.get("collision", True)`，运行时认 `collision: true`（`game/src/world/Landmarks.ts`）会拿模型本身的
   三角网当碰撞。确实要让车穿过的东西（桥面、地上的装饰）在 `pipeline/landmarks.json` 的条目里写 `"collision": false` 并写明原因。
   **要从门洞里穿过去的地标，按模型本身在车高处量，不按轮廓量**：路线里写 `driveThrough` 会让它整个免掉“赛道压地标轮廓”的检查
   ——门洞是路，可门柱不是。做法：把放好位置的模型，在**路面经过它的那个高度**往上 0.3、1.0、1.8 米处横切（路面比模型底面高几十米的
   多得是，桥面上的路也是路，一起比），切出来的截面拼成实心区域（切线端点先取到毫米再拼，不然环合不上、面积是零），
   跟路面一比，压上了就让构建失败。这条对每个地标都跑，不只是 `driveThrough` 的。
   **车要开上去的地标（桥），模型的桥面和游戏的路面得是同一个高度**：路线文件写 `bridgeDeckM` 等于模型桥面顶再高 5 厘米
   （同高会闪），模型的桥面做成水平的；桥塔、桁架、吊杆这些要站在车道外面。
   **模型底下的台基也算在车高里**：建模时顺手铺的一层 35 厘米铺地连门洞下面也铺上了，对半比例的车就是一道爬不上去的坎——
   门洞下面不铺台基。门洞比路窄时，那一段的路宽跟着收窄（门洞 14.6 米，路面 12 米）。
6. 地标用到的专用材质名：`building_landmark_glass/pale/solar/metal/roof`、`bridge_steel`、`bridge_metal`（契约第 4 节材质表）。
7. 参考照片只能看不能进游戏，出处记 `docs/landmark-reference.md` 和 `ASSETS.md`。

**(c) 走在赛道上的桥**：路线 JSON 的 `suspension`（塔的经纬度、塔高、主缆垂度、吊索间距等），由 `pipeline/sr/bridge.py` 生成 `bridgeworks` 节点；桥面高度用 `bridgeDeckM`。

另外：Moffett 机场那组飞机不能随手整组删。`assets-src/landmarks/build_landmark_tools.py` 开头就
`from build_moffett_aircraft import audit_closed_primitives, xyz`（建新地标要用的工具本身依赖它）；
`pipeline/sr/synth.py` 的合成赛道硬引用 `moffett-fighter.glb`；`assets-src/render_model_audit.py`、
`assets-src/landmarks/build_moffett_expansion.py`、`tools/test_model_polish.py` 也读它。不想要它们出现在你的赛道上，
只要路线 JSON 的 `landmarks` 里不写就行；真要删，先把这几处引用挪走。

**地标模型的锚点会过期**：GLB 的顶点是相对建模那一刻的轮廓质心算的，改了 `landmarks.json` 的轮廓却不重建 GLB，模型整体偏出去（一次偏了 21.6 米、正好压在行车线上），测试全绿。把锚点写进模型，测试拿它跟当前轮廓对。

### 2.5 车辆

| 要改的 | 文件 |
|---|---|
| 车的全部数据（尺寸、轴距、轮距、悬挂、灯位、操控参数、功率、最高速、质量、`detailScale`、拖车） | `game/src/vehicles/catalogue.json`（唯一的主；Blender 脚本也读它） |
| 旧 `track.car` 名 → 真车映射、兜底车 | 同文件的 `legacyDefaults`（sedan/hatch→micro-hatch，super→sports-car，convertible→retro-van）和 `fallback` |
| 显示名、简介、操控一句话 | i18n 的 `car.<id>.name`、`car.<id>.desc`、`car.<id>.drive`（两份 locale 都要） |
| 发动机声音（合成，不是录音） | `game/src/audio/voices.ts` 的 `ENGINE_VOICES`，按车 id |
| AI 完赛时间表 | `game/src/track/aiPace.json`（见 2.3 第 7 条） |
| 模型源码 | `assets-src/vehicles/*.py`（Blender 5.x，`common.py` 读 catalogue），输出 `game/public/models/cars/<id>.glb`（进版本库） |
| 车库菜单图 | `blender --background --python assets-src/vehicles/render_garage_references.py` 渲 `docs/car-reference/<id>.png` 并记哈希到 `docs/car-reference/rendered-models.json`，再 `python3 tools/garage_images.py` 缩成 `game/public/garage/<id>.webp` |
| 模型契约 | `docs/vehicle-models.md`：glTF X 右 Y 上 −Z 向前；原点在底盘碰撞体中心；节点 `vehicle-root` 下 `body`、`wheel-0..3`（左前、右前、左后、右后）、可选 `hitch`；恒等缩放导出，加载时不再缩放；无相机灯光动画 |
| 性能标定依据 | `docs/vehicle-performance.md`；车身约为真车 0.7 倍 |
| 校验 | `cd game && npm test -- test/vehicle-assets.test.ts` |

手机上 AI 对手只上两辆（`game/src/app/roster.ts` 的 `MOBILE_AI_RIVALS = 2`），桌面全上。
- 座椅布局、轮拱例外、发动机声都按车 id 写死，加新车型之前先把这几处改成能传参或打标志，再把建车的活派出去。
- 车库按赛道换车时，换赛道要重建车卡。
- 双色涂装在着色器里按高度直接选颜色，不要用“下色除以上色”再乘回去：通道为 0 时乘不回来。

### 2.6 游戏名、品牌、文案、i18n

**i18n 只有中英两份**：`game/src/ui/locales/zh.json`、`game/src/ui/locales/en.json`（470 个键，键集合必须一致）。语言按浏览器 `zh*` 判中文，其余英文（`game/src/ui/i18n.ts` 的 `detectLanguage`）。
品牌相关的键：`app.title`、`app.tagline`、`home.place`（“硅谷 · 末日第一天”）、`home.slogan.*`、`home.story`、`about.*`、`support.*`、`track.*`、`place.*`、`car.*`。

**不在 i18n 里、写死在代码里的品牌字样**（换名必须一个个改）：

| 位置 | 写死了什么 |
|---|---|
| `game/src/ui/Replica.ts` 的 `renderBrandSignature` | 三色英文字标 `Silicon`/`Slime`/`Rush`（CSS 类 `brand-word-*`） |
| `game/src/ui/Home.ts`（`render()` 里） | 首页标题：中文拆成“史莱姆赛车”+“硅谷”两行，英文拆成 SILICON / SLIME RUSH |
| `game/vite.config.ts` 的 `startupShell()` | 启动壳 `<h1>` 里的 `Silicon Slime Rush` |
| `game/index.html` | `<title>Silicon Slime Rush</title>` |
| `game/public/manifest.webmanifest` | `name`、`short_name` |
| `game/build/socialMeta.ts` | `SOCIAL_TITLE`、`SOCIAL_DESCRIPTION`（中英，提到湾区）、`og:site_name` |
| `game/build/og-image.mjs` | 链接预览图上的全部文字（含“BAY AREA · DAY ONE”“REAL BAY AREA ROADS”）和底图 `public/home/goldengate.webp`。游戏名改成读两份语言文件的 `app.title` |
| `game/public/brand/slime-race-mark-{64,180,512}.png` | 游戏图标：浏览器标签（64）、手机桌面和菜单、启动壳、结算页（180）、应用清单和链接预览图（512）全读这三张，换掉这三张就处处换了 |
| `game/src/ui/ShareDialog.ts` | 分享图文件名前缀 `silicon-slime-rush-`。抽成常量时放进不引 CSS 的模块（如 `app/Publication.ts`）：浏览器测试要 import 它，而 Playwright 加载 spec 时读不了 `ShareDialog` 牵进来的 CSS，整个文件连一条测试都不跑就报 SyntaxError |
| `game/src/app/Save.ts` 的 `SAVE_KEY`、`game/src/app/GhostStore.ts` 的 `DATABASE` | 本地存档键 `silicon-rush.*`（itch 每个游戏独立域名，不改也不冲突；改了旧存档会丢） |
| `game/package.json` 的 `name` | `silicon-rush` |
| `game/public/brand/` | 图标（64/180/512）和 `og-1200x630.jpg` |
| `game/public/home/goldengate.webp` | 首页背景图；`game/src/ui/Home.ts`、`game/src/ui/StartScreen.ts`（`PREVIEW_FALLBACK`）、`game/src/app/Game.ts`（`SHOWCASE_TRACK` 和首页图）都点名 `goldengate` |
| `pipeline/sr/schema/track.schema.json` 的 `title`/`$id` | 只是标识，不给玩家看 |

还有两条会咬人的**文案测试**：`game/test/zh-place-name-silicon-valley.test.ts`（中文文案里不许出现“湾区”），`game/test/venue-names.test.ts`（钉死三条赛道的名字）。

### 2.8 作者外链和社交账号（换皮者必须换成自己的）

作者的外链/社交账号在下面这些地方，换皮者要全部换成自己的，或者删掉：

| 位置 | 是什么 |
|---|---|
| `game/src/app/Publication.ts` 的 `PLANNED_GAME_URL` | 正式游戏页地址（唯一的主）；由它派生出作者主页（`creatorProfileUrl`，取网站根目录）、打赏页（`supportUrl`，页面地址后加 `purchase`）、分享图水印地址、链接预览地址、`release_package.py` 的构建地址。**只认 itch.io**：`publicGameUrl()` 只放行 `https://<名字>.itch.io/<一段路径>`，别的地址一律变成 `null`，结算页的“更多游戏 / 请作者喝咖啡”和作者主页链接会整个消失，也不报错。上别的平台要一起改 `publicGameUrl`、`creatorProfileUrl`、`supportUrl` 这三个推导 |
| `game/src/ui/CreatorSocials.ts` | “关于”页的“关注作者”列表；一部分地址从广告牌清单读，另外几个平台（GitHub、抖音主页、小红书主页）直接写在这里 |
| `game/public/billboards/manifest.json` | 七块路边社媒广告牌的平台、二维码目的地、标题；清单里还有七块招商位。**正好七个社媒槽**是被 `game/test/billboards.test.ts` 和 `pipeline/tests/test_billboards.py` 钉死的，账号不满七个要么重复填、要么改测试；`social_billboards.py` 的 `_draw_logo` 只会画 x、youtube、tiktok/douyin、bilibili 几家的标志，别的平台要自己加；招商位那句“广告位招商”不管界面语言都画中文加英文（`game/src/world/Billboards.ts` 的 `drawFace` 固定取 `zh` 和 `en`），换语言要一起改 |
| `game/public/billboards/social-*.png` | 七张带二维码的成品牌面（作者自有素材，ASSETS.md 写明“只用于这个游戏”） |
| `pipeline/sr/social_billboards.py` | 重新生成上面那七张图的脚本；它读的原作者素材目录不随公开版分发，换皮者要准备自己的素材、改脚本里的来源 |
| `pipeline/assets/logos/` | 小红书、哔哩哔哩的平台标志（商标归平台） |
| i18n `about.made`、`about.follow`、`about.social.*`、`support.*` | “XX 制作”署名、关注作者、打赏卡文字 |
| `game/src/app/Game.ts`（`creatorLinkUrl` 调用处）、`game/src/ui/ResultsScreen.ts` | 结算页“更多游戏 / 请作者喝咖啡”卡片 |
| `game/build/socialMeta.ts` + `game/vite.config.ts` | 链接预览里的游戏地址 |
| `tools/release_audit.py` | `_expected_404` 写死作者游戏页地址；`PRIVACY_MARKERS` 写死原作者的隐私标记；`BROWSER_ONLY` 列了几家湾区机构域名 |
| `LICENSE` | MIT，版权人是作者——换皮者保留原版权行，再加自己的 |
| `ASSETS.md` | “Social media billboards”那一行和作者署名；它会被原样编进玩家能打开的 `credits.txt` |
| `docs/itch/*` | 见 2.7 |
| 测试 | `game/test/about-socials.test.ts`、`game/test/credits.test.ts`、`game/test/share.test.ts`、`game/test/social-meta.test.ts`、`game/test/challenge.test.ts`、`game/e2e/about.spec.ts`、`game/e2e/release-package.spec.ts`、`tools/test_release_audit.py` 都断言了作者的地址 |

### 2.9 音频

**全部在浏览器里合成，没有音频文件**：`game/src/audio/music.ts`（菜单曲和三首赛车曲，`RACE_PIECES`）、`game/src/audio/voices.ts`（每辆车的发动机音色）、`game/src/audio/Audio.ts`（轮胎、撞击、史莱姆、界面音效）、`game/src/audio/curves.ts`。换音乐就是改这几个 TS 文件里的音符和参数；想用录音得自己加加载逻辑，并在 `ASSETS.md` 记来源（只许 CC0 或自制）。

### 2.10 天空、光照、天气、时段

- 时段只有两个：`day`、`night`（`game/src/track/types.ts` 的 `TimeOfDay`）。路线 JSON 的 `timeOfDay` 只是默认值，玩家在出发界面自己选（`game/src/ui/StartScreen.ts`）。
- 太阳高度、方位、颜色、雾距：`game/src/world/Sky.ts` 的 `SKY_PRESETS`（白天高度 46°、方位 218°；夜晚是月光 52°/305°）。**这是全局的，不按地区或纬度算**——换到高纬度城市想要低太阳就改这里。
- 天气四种：`clear`、`fog`、`rain`、`snow`（`game/src/world/Sky.ts` 的 `WEATHERS`，抓地系数 `WEATHER_GRIP`）；效果在 `game/src/world/WeatherEffects.ts`、`game/src/world/WeatherSurface.ts`、`game/src/world/LayeredFog.ts`、`game/src/world/FarAtmosphere.ts`。
- 夜景：`game/src/world/NightScenery.ts`、`game/src/world/Headlights.ts`（车灯参数在 catalogue 的 `headlightProfile`）。
- **地面配色是地区性的**：没标注的山坡默认“加州旱季干草色”（`pipeline/sr/landcover.py`）；绿色地区在路线里写 `"groundCover": "terrain_grass"`。沥青、人行道、住宅墙面的颜色按湾区观察写在 `pipeline/sr/textures.py`；远景低层城区的屋顶比例在 `pipeline/sr/vistas.py`，房子式样（旧金山凸窗 vs 谷地平房）在 `pipeline/sr/architecture.py` 的 `house_style`，按 `source_key` 字符串分支。
- 路面中线：`pipeline/sr/markings.py` 写死了北美的双黄中线，做成每条赛道一个字段（很多地方是白线）。
- 远处的散射：`game/src/world/FarAtmosphere.ts` 晴天 26 km 的散射是湾区的海雾，会把远处的雪山洗掉，按远景的真实距离放宽。
- 太阳按纬度放，南半球方位反过来。
- 凡是颜色、光、能见度的常数，先问一句：这是哪儿的常识？

### 2.11 换界面语言

原作只有中文和英文，而且“只有这两种”写死在很多地方。换成别的语言（比如日文加英文），推荐**把 `zh` 整体改名成目标语言**，
不要往 `zh.json` 里填别的语言——很多地方按 `zh` 做了中文专属的处理。要改的地方：

| 位置 | 写死了什么 |
|---|---|
| `game/src/ui/i18n.ts` | `Language = 'zh' \| 'en'`、`LANGUAGES`、`languagePreference`、`TABLES`；`detectLanguage` 只认 `zh*`，别的浏览器语言一律进英文；`speed()`、`mass()` 只给中文用 km/h 和 kg，其余显示 mph 和 lbs |
| `game/vite.config.ts` 启动壳 | 只打进 `{ en, zh }` 两份启动文案；`detectLanguage` 和 `languagePreference` 被 `.toString()` **原样塞进 HTML**，所以这两个函数不能引用任何外部变量（比如 `LANGUAGES`），否则启动壳报 ReferenceError、黑屏 |
| `game/src/ui/Startup.ts`、`Replica.ts`、`LandscapeGuard.ts`、`HomeShortcut.ts`、`PlayerHelp.ts`、`ShareDialog.ts`、`SettingsScreen.ts` | “中文 / English”二选一的切换 |
| `game/src/ui/Home.ts` | 首页标题只有中文分支；标语按“中文用 `，`、其他用 `. `”断行，别的语言找不到分隔符会在第一个字后面断 |
| `game/src/ui/StartScreen.ts`、`game/src/app/Game.ts` | 数字和日期格式写死 `zh-CN` / `en-US`；中文界面专门拼中文路线名 |
| `game/index.html`、`game/build/socialMeta.ts` | `lang="zh"`、`og:locale` |
| 字体栈：`game/src/game.css`、`replica.css`、`ResultImage.ts`、`TextCardImage.ts`、`ShareWatermark.ts`、`Billboards.ts`、`Gates.ts` | 简体中文字体排在最前，日文汉字会显示成简体字形；广告牌用的 `pipeline/assets/fonts/NotoSansSC-Billboards.ttf` 是只含所需汉字的子集，没有假名。换语言时换字体栈（日文如 Hiragino Sans、Yu Gothic、Noto Sans JP），并设好 `html[lang]` |
| 赛道数据格式 | `pipeline/sr/schema/track.schema.json` 的 `text` 类型要求**正好** `zh` 和 `en` 两个字段；路线 JSON 的 `name`/`blurb` 原样抄进 `track.json`。运行时文案以 i18n 为准，`track.json` 里只是预览副本：保留 `zh` 这个字段名、填目标语言即可；真要改字段名，按契约让管线、运行时、合成赛道同一次改 |
| 广告牌 | `game/public/billboards/manifest.json` 每一面也是 `zh`/`en` 两份；招商位固定画 `zh` 加 `en`（见 2.8） |
| 测试 | 键集合一致的测试按 `LANGUAGES` 循环，换语言照样能用；但不少测试直接写 `I18n.keys('zh')`、`'zh'`、`locales/zh`，用 `grep -rlE "'zh'\|locales/zh" game/test game/e2e` 找出来一起改 |

---


## 构建与测试

安装和启动命令见游戏 README。类型检查、单测、管线测试、浏览器测试和发布构建都应通过；测试参数需与新路线和车辆一致。

## 地区替换核对

检查地区原点、海岸缓存、道路和高程、路线 ID、地标注册表、默认赛道、首页背景、菜单卡片、分享卡、社交链接和双语文案。建筑和桥梁高度应按路线数据验证，不能沿用湾区的假设。
