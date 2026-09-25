---
name: remix
description: Make a real-place driving game from Silicon Slime Rush. Interview the creator about locations, visual style, vehicles, gameplay, music and publishing, then build and verify a complete playable game.
---

# Remix — make your own real-place racing game

[中文](#中文)

Copy `original/` into an independent game and make it your own, with the cities, streets and landmarks you choose. Keep or replace the vehicles, weather, split-screen, sharing, recording and touch controls to suit your idea.

## 1. Define the game

Use [grill.md](references/grill.md) to discuss locations, name, languages, art direction, vehicles, gameplay, music, attribution and delivery in one interview. Ask the creator for decisions only they can make; choose technical details yourself. Write the answers into a brief for the new game and confirm the scope. Spending money, account operations and publishing require explicit authorization.

## 2. Create an independent copy

Copy `original/` into a new directory. Leave out `node_modules`, `.venv`, `dist`, `release`, `pipeline/out`, generated map tiles and local baselines. Keep licenses and asset attribution, and do not overwrite existing files in the destination.

```bash
cd <new-game>/pipeline
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ../game
npm ci
npm run dev
```

The build and release tools need a Git repository. Verify that the copy runs before changing it. Match dependency caches by lockfile content and manage generated map assets with `tools/assets.py`. After making changes, build and verify the release artifact; publish that checked artifact without rebuilding it just to upload it.

## 3. Build the maps and visuals

Read [original-map.md](references/original-map.md) to find the configuration entry points, then use [places-to-track.md](references/places-to-track.md) to turn locations into coordinates and drivable routes.

- Research real roads, terrain and buildings. Base landmarks on references rather than memory, and keep reference photographs separate from redistributable assets.
- Make one route work before adding more. Check start and finish points, bends, bridge decks, driving clearance and recovery positions.
- Model landmarks from reference sheets. Check silhouettes, dimensions, colors, orientation and the player's view. Match buildings, vegetation and streetlights to the setting.
- Give menus, garage, HUD, results and share cards a consistent theme. Complete both English and Chinese text, and update names, creator accounts, promotional images and place descriptions.
- When changing vehicles or gameplay, reuse the physics, save, pause, touch and split-screen interfaces, and update the tests.
- Rebuild affected assets after shared pipeline changes, then update map cards, homepage images and visual baselines.

## 4. Verify and deliver

Follow [launch-checklist.md](references/launch-checklist.md) for type checks, unit tests, pipeline tests, browser tests and builds. Drive every route, and check day and night, weather, vehicles, mobile controls and split-screen. Use actual game screenshots.

Deliver a playable entry point, screenshots, recordings and test results. Clearly identify devices and interactions that have not been verified. Before publishing, check asset licenses, attribution, external links, the embedding environment and package contents. Upload only after receiving publishing authorization.

## Technical references

| Topic | Covers |
|---|---|
| [map-pipeline](references/map-pipeline.md) | Roads, terrain, bridges and caching |
| [buildings-landmarks](references/buildings-landmarks.md) | Buildings, landmarks and models |
| [rendering](references/rendering.md) | Lighting, materials, sky and camera |
| [vehicles-physics](references/vehicles-physics.md) | Vehicles, collisions and AI |
| [gameplay](references/gameplay.md) | Routes, rules and saved games |
| [ui-text](references/ui-text.md) | Bilingual interface and controls |
| [mobile-touch](references/mobile-touch.md) | Touch controls and mobile devices |
| [audio-share](references/audio-share.md) | Sound, recording and sharing |
| [performance](references/performance.md) | Asset budgets and frame rate |
| [testing](references/testing.md) | Automated tests and visual checks |
| [open-assets](references/open-assets.md) | External assets and licenses |
| [release-itch](references/release-itch.md) | Packaging and publishing |
| [working-habits](references/working-habits.md) | Editing and verification practices |

---

# 中文

## Remix — 做一个属于你的真实地点赛车游戏


把 `original/` 复制为独立游戏，换成你熟悉的城市、街道和地标。可以保留现有车辆、天气、分屏、分享、录像和触屏操作，也可以按需要替换。

## 1. 确定内容

按 [grill.md](references/grill.md) 一次问清地点、名称、语言、美术、车辆、玩法、音乐、署名和交付方式。只有创作者能决定的事情由创作者回答；技术实现自行选择。把答案写成新游戏的简报，并确认范围。付费、账号操作和发布需要明确授权。

## 2. 建立独立副本

复制 `original/` 到新目录，不复制 `node_modules`、`.venv`、`dist`、`release`、`pipeline/out`、地图切片和本机基线。保留许可证及资源署名，不覆盖目标已有文件。

```bash
cd <new-game>/pipeline
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ../game
npm ci
npm run dev
```

构建和发布工具需要 Git 仓库。先确认副本能正常运行，再改内容。依赖缓存按锁文件内容匹配，地图产物使用 `tools/assets.py` 管理；修改后构建并验证发布成品；上传时直接使用这份已验证成品，不为上传再次构建。

## 3. 地图与画面

先读 [original-map.md](references/original-map.md) 找到配置入口，再按 [places-to-track.md](references/places-to-track.md) 把地点落成坐标和可驾驶路线。

- 查询真实道路、地形和建筑资料；不凭印象画地标。参考照片和可分发资源分开管理。
- 先跑通一条路线，再扩展其余路线。核对起终点、弯道、桥面、路面净空和恢复点。
- 地标按资料卡建模，核对轮廓、尺寸、颜色、朝向和玩家视角。街区建筑、植被、路灯与当地相符。
- 统一菜单、车库、HUD、结算和分享卡主题。中英文完整，替换名称、作者账号、宣传图和地点介绍。
- 替换车辆或玩法时复用现有物理、存档、暂停、触屏和分屏接口，并同步测试。
- 共用管线修改完成后统一重建，随后更新地图卡片、首页图和视觉基线。

## 4. 验证与交付

按 [launch-checklist.md](references/launch-checklist.md) 完成类型检查、单测、管线测试、浏览器测试及构建。逐条路线真开，检查昼夜、天气、车辆、手机和分屏；截图来自实际游戏。

交付可直接试玩的入口、截图、录像及测试结果。清楚列出尚未验证的设备和操作。发布前核对资源许可、署名、外链、嵌入环境和文件内容；获得发布授权后再上传。

## 技术参考

| 主题 | 说明 |
|---|---|
| [map-pipeline](references/map-pipeline.md) | 道路、地形、桥梁、缓存 |
| [buildings-landmarks](references/buildings-landmarks.md) | 建筑、地标与模型 |
| [rendering](references/rendering.md) | 光照、材质、天空和相机 |
| [vehicles-physics](references/vehicles-physics.md) | 车辆、碰撞与 AI |
| [gameplay](references/gameplay.md) | 路线、玩法与存档 |
| [ui-text](references/ui-text.md) | 双语界面与操作 |
| [mobile-touch](references/mobile-touch.md) | 触屏和移动设备 |
| [audio-share](references/audio-share.md) | 声音、录像与分享 |
| [performance](references/performance.md) | 资源预算与帧率 |
| [testing](references/testing.md) | 自动测试和实际画面验证 |
| [open-assets](references/open-assets.md) | 外部资源与许可证 |
| [release-itch](references/release-itch.md) | 打包与发布 |
| [working-habits](references/working-habits.md) | 修改与验证原则 |
