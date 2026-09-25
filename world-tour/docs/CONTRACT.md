# 管线与运行时契约

管线（`pipeline/`，Python）生成的东西和运行时（`game/`，TypeScript）读的东西之间的接口。**只加不改**：要改字段含义，管线、运行时、合成赛道三处一起改，同一个 commit。机器可查的部分在 [`../pipeline/sr/schema/track.schema.json`](../pipeline/sr/schema/track.schema.json)，两边各有一个测试拿它校验；本文写机器查不了的含义。

## 1. 坐标系和单位

- 每条赛道一个本地原点 `origin{lat,lon}`，固定不变，和起点无关。起点挪了地标不用重摆。
- 本地坐标是 Three.js 坐标：**x 向东，y 向上，z 向南**（z = 负北）。单位米。管线里转一次，运行时不再转。
- 高度 y 是海拔米，海平面 0。
- 地图、画面、游戏逻辑和遥测始终使用上述固定坐标。`PhysicsWorld` 单独维护 Rapier 的水平浮动原点，
  在物理步开始前整体平移刚体和独立碰撞体，避免长路线低速位移被单精度舍掉；刚体位置、射线和作用点
  通过它的转换方法进出物理世界，导出的坐标字段和玩家看到的位置不变。
- 样条参数 `s` 是沿赛道中心线的三维弧长，米，从起点 0 到 `spline.length`。`spline.s` 与 `points` 等长，保存每个采样点的累计弧长；检查点、流式切片、风区间、小地图里程和运行时投影都用它。环线 `closed` 为真时 s 取模。旧数据没有 `spline.s` 时运行时只为兼容而从点列重算，新管线一律写出。
- 航向 `yaw` 是绕 y 轴的弧度，0 朝 −z（北），正方向逆时针俯视。

## 2. track.json

一条赛道一个文件，`game/public/tracks/<id>/track.json`。字段：

| 字段 | 含义 |
|---|---|
| `id` | 赛道 ID，小写字母、数字、连字符。也是目录名和 i18n 键的一部分 |
| `version` | 该赛道数据格式的版本，整数，从 1 起 |
| `editions` | 出现在哪些版本：`web`、`full` |
| `category` | 历史字段，只加不改所以仍然写出：`race`、`scenic`、`campus`、`mission`，只约束 story/countdown（`race` 不带，`mission` 两者必有，另外两类可选）。赛道不分类，运行时不再用它决定计时、打星、名次或任何显示 |
| `mode` | `loop` 环线圈数；`p2p` 点对点；`multistop` 多站停稳 |
| `laps` | 圈数，非环线为 1 |
| `name`、`blurb`、`story` | 中英文文案。name、blurb 必有；story 在 mission 必有，在 race 禁止，在 scenic、campus 可选 |
| `origin` | 本地原点经纬度 |
| `timeOfDay` | 光照预设名：`day` 或 `night`。夜晚由月光加车前灯照明 |
| `sky` | 可选。这个地方白天的天空颜色 `{zenithColor, skyColor, fogColor}`（#rrggbb），盖在通用白天预设上；夜晚不用 |
| `mist` | 可选。山谷里的云层 `{layersM, radiusM?, colour?, opacity?}`：`layersM` 是每一层的海拔（米，跟赛道的 y 同一套数），画质越低用得越少，从第一个起取 |
| `tint` | 可选。按材质名给这座城的墙面和屋顶上色 `{材质名: #rrggbb}`：有贴图时乘在贴图上，没贴图时就是底色 |
| `car` | 玩家车型：`sedan`、`super`、`convertible`、`hatch` |
| `lampStyle` | 可选的路灯样式：`cobra`（原作的弯臂路灯，缺省）、`huabiao`（长安街华灯）、`lantern`（欧洲老城的铸铁灯柱加灯笼）。路灯白天也立着，夜里才点亮 |
| `camera` | 可选的赛道镜头覆盖。目前只有 `heightM`：追车镜头高于车体的米数；只用于高差本身是赛道内容、默认角度会把它藏住的路线 |
| `spline` | 中心线。`points` 约两米一点；`s` 是这些点的三维累计弧长；`halfWidth` 和 `points` 等长，每点半宽米；`curvature` 可选，每点曲率 1/米；`closed`；`length` |
| `start` | 出生点和航向 |
| `checkpoints` | 按 s 递增。`pos`、`dir`（单位向量，赛道前进方向）、`halfWidth` 定义一道门；`stop` 为真要求停稳一秒；第一条是起点门，`p2p` 的最后一条是终点门，`loop` 的第一条同时是起终点线 |
| `tiles` | 每格一个 GLB。每条给 `name`（格子名，也是散文件的文件名）、`sRanges`（它覆盖的 s 区间列表，用于沿路预取）、`bounds`（本地坐标包围盒，用于欧氏半径加载）。`offset` / `length` **只在打包过的那份里有** |
| `tilePack` | **只在 `dist/` 里出现**：`npm run build` 把散切片打成一个文件之后加上的，`file` 文件名，`bytes` 总字节数。没有这一项就表示切片是散的，在 `tiles/<name>.glb`（见第 3 节） |
| `backdrop` | 常驻的低模远景：`file` 是 GLB 路径，`radiusM` 是它覆盖到多远。`radiusM` 保留详细远景和近处雾的范围；可选 `horizonRadiusM` 是真实低面数山体与海湾的更远覆盖半径，供相机和天空取景使用。远处地形、水面使用独立空气透视，晴天不被近雾完全遮掉。旧数据未提供时仍按原 `radiusM`。可选 |
| `landmarks` | 地标实例：`id` 对应 `game/public/models/landmarks/<id>.glb`，`pos`、`yaw`、`loadRadius` 米；同型可以有多个实例，按 `file` 共用模型。可选 `collision: true` 以实例变换后的真实三角面碰撞，缺省不碰撞 |
| `traffic` | 车流：`density` 0 到 1，`lanes` 每条车道相对中心线的横向偏移（右正）和方向（1 同向，−1 对向），`speedKmh` 区间，`oncoming` |
| `items` | 道具和危险物布置文件，见第 5 节，可选 |
| `rival` | 对手车配速，可选 |
| `wind` | 侧风：作用的 s 区间、阵风牛顿数、周期秒，可选 |
| `countdown` | 倒计时秒数，mission 必填 |
| `attribution` | 数据来源署名字符串列表 |

## 3. 切片 GLB 约定

- 切片是**轴对齐 256 米方格**，格子名 `t_<col>_<row>`，col 沿 x，row 沿 z，从原点起算，可以为负。
- **切片有两种形态，运行时两种都认**，看 `track.json` 里有没有 `tilePack`：
  - **散的**（管线写的、`npm run dev` 服务的）：`game/public/tracks/<id>/tiles/<name>.glb`，一格一个文件。
    重建一格只重写一个文件，别的字节不动。
  - **打包的**（`npm run build` 打进 `dist/` 的、itch.io 上线的）：全部切片首尾相接写进 `tiles.bin`，
    中间没有任何头部或填充，每片的字节区间记在 `tiles[].offset` / `.length` 上。
    运行时整包下载一次（不带 `Range`），在内存里按这两个数切；下回来的长度必须等于 `tilePack.bytes`，否则重下。
    不用 `Range` 是 在 itch.io 线上量出来的：它对带 `Range` 的请求回 200 加不压缩的整包，
    浏览器缓存又会自己回 206，按段取在那里既省不下流量也判断不准。
  打包的理由是发行侧的：平台会数**文件数**，一格一个文件在十四条赛道时就到了 795；
  具体拒收线到 1.0 上传前重新核对，开发期按共享的高硬线检查。
  **那是上线的约束，不是管线的约束**——把它放进管线的代价是每改一行都要整条赛道重打一次包。
- 切片**不内嵌贴图**。材质只带名字，运行时按名字挂共享材质库。见第 4 节。
- 几何用 meshopt 压缩（`EXT_meshopt_compression`），实例用 `EXT_mesh_gpu_instancing`。
- 节点按名字前缀分类，碰撞信息放节点 `extras`：

| 节点名前缀 | 内容 | `extras.collider` | 其他 extras |
|---|---|---|---|
| `road` | 可驾驶面，两米一段的带状网格 | `trimesh` | |
| `terrain` | 路外地形 | `trimesh` | |
| `water` | 水面 | `none` | `killY`：低于此高度重置 |
| `buildings` | 该格所有建筑合并 | `boxes` | `boxes`：`[cx,cy,cz,hx,hy,hz,yaw]` 列表，只含离赛道 60 米内的 |
| `bridge` | 桥面和桥体 | `trimesh` | |
| `guardrail` | 赛道两侧的连续护栏，竖直带状网格 | `trimesh` | |
| `props_barrier` | 路障实例 | `instances-box` | `halfExtents`：单个实例的半尺寸 |
| `props_slime` | 五种史莱姆的摆放数据，普通数量节点在这个前缀后接 `_popper`、`_slick`、`_burst`、`_boost` 或 `_colossus`；`props_slime_many_` 后接同样五种类型，是只在“很多”档加入的第二组确定性摆放 | `none` | 每个实例的 `TRANSLATION`、`ROTATION`、`SCALE` 给出位置、朝向和半尺寸；“普通”只读基础节点，“很多”读两组完整配比，“无”两组都丢弃；运行时用同一个程序化网格绘制并自行建立交互 |
| `bridgeworks` | 桥的钢结构：塔、主缆、吊索、加劲桁架、引桥墩。全在护栏外面 | `none` | |
| `sidewalk` | 路缘和人行道，在护栏外面 | `none` | |
| `backdrop` | 远景：切片之外的地形、水面和天际线上的高楼。只在 `backdrop.glb` 里，不在切片里 | `none` | |
| `markings` | 路面标线。`markings_white` 和 `markings_yellow` 两个节点，浮在路面上方两厘米 | `none` | |
| `props_billboard` | 广告牌。`props_billboard_pole` 和 `_ground` 是支架，`props_billboard_face_a` 到 `_n` 是十四个内容槽位的牌面，`props_billboard_lamps_pole` 和 `_ground` 是牌框及牌面下方的射灯钢架（灯面使用 `props_billboard_lamplens_*`） | `none` | `halfExtents` |
| `props_*` | 其他道具实例 | `none` 或 `instances-box` | |
| `trees` | 树实例。`trees_<种类>_trunk` 和 `_foliage*` 两个节点；种类是 `broadleaf`、`conifer`、`palm`、`orchard`、`scrub` 或 `acacia`（平顶金合欢，路线 `treeFill` 里声明） | `none` | `halfExtents` |
| `flowers` | 花丛实例；`flowers_foliage` 是叶团，`flowers_flower_*` 是四种共享花色 | `none` | `halfExtents` |
| `scenery` | 远景与楼顶的静态低精度史莱姆；只表达世界状态，不进入玩法 | `none` | `halfExtents`；固定数量、无碰撞、无弹性模拟 |
| `deck` | 护栏外可以站住的平台面，例如楼顶环线路外的太阳能楼板；比路面略低，车开出护栏落在上面不穿模 | `trimesh` | |

运行时对每个节点：按前缀决定渲染层和碰撞体；没有前缀的节点当普通静态网格，无碰撞。

`props_` 开头的节点先按全名查表，查不到再按**最长的已注册前缀**查。一个道具可能需要好几个节点——十四个广告牌牌面之所以是十四个节点，只因为实例化的节点只能带一个材质，它们对物理是同一件事。

实例节点用 `EXT_mesh_gpu_instancing` 的 `TRANSLATION` 和 `ROTATION`；尺寸不一样的实例再加 `SCALE`（全是 1 就不写）。`halfExtents` 描述的是**未缩放**的网格，运行时用每个实例的缩放去乘。

## 4. 材质名字表

切片里的材质只带名字，运行时按名字挂共享材质库。**这个列表是接口**，管线的 `sr/export.py:MATERIALS`
和运行时的 `MATERIAL_NAMES` 两边各有一个测试拿它对：

```text
road
terrain
terrain_grass
terrain_scrub
terrain_wood
terrain_sand
terrain_rock
terrain_saltpond
terrain_paved
terrain_snow
water
building
barrier
bridge
billboard_frame
billboard_lamp
billboard_face_a
billboard_face_b
billboard_face_c
billboard_face_d
billboard_face_e
billboard_face_f
billboard_face_g
billboard_face_h
billboard_face_i
billboard_face_j
billboard_face_k
billboard_face_l
billboard_face_m
billboard_face_n
line_white
line_yellow
bridge_steel
bridge_metal
foliage
foliage_dark
foliage_palm
foliage_orchard
foliage_scrub
foliage_acacia
trunk
guardrail
sidewalk
flower_pink
flower_white
flower_blue
flower_purple
slime_scenery
building_glass
building_stucco
building_concrete
building_metal
building_parking
building_landmark_glass
building_landmark_pale
building_landmark_solar
building_landmark_metal
house_roof_slate
house_roof_tile
house_trim
house_wall_red
building_landmark_roof
rock_sandstone
building_local_wall_a
building_local_wall_b
building_local_wall_c
building_local_ground_a
building_local_ground_b
building_local_ground_c
local_roof_a
local_roof_b
local_roof_c
local_detail_dark
local_detail_light
local_flags
local_detail_accent
local_rail
ruin_stone
```

`building_local_*`、`local_roof_*`：一座城自己的普通楼（管线 `sr/local_style.py`，路线文件 `architecture.local`）。
最多三类，每类一面上层墙、一段底层、一片屋顶，贴图跟着赛道走：`tracks/<id>/textures/manifest.json`，
格式和全局贴图清单一样；赛道文档里 `localTextures: true` 才去读。`local_detail_*` 是屋顶和立面上的小件
（水塔、水箱、廊柱），颜色走赛道的 `tint`；`local_detail_accent` 是遮阳篷、烟囱陶罐这类带颜色的小件；`local_flags` 是经幡、`local_rail` 是阳台和廊子的铁栏杆，两者贴图带透明，双面画。`ruin_stone` 是遗迹：
没窗、没屋顶的矮墙。

运行时材质库找不到名字时用洋红色报错材质，让问题看得见。加名字要管线和运行时同一个 commit。

广告牌实例节点可携带 `billboardViews`：每项含世界坐标 `face`、实际道路验收视点 `eye`（均为三元素数组）及道路侧别 `side`（-1 或 1）。压缩可重排实例，验证按 `face` 坐标匹配，不猜测相邻弯道。

`billboard_face_a` 到 `_n` 是十四个**内容槽位**，几何上完全一样，区别只在运行时给它们挂什么贴图。正常槽位按“广告、招商位”严格交替；每条正式赛道先尝试至少完整出现一轮，因此两类内容恰好各占一半。七个广告槽固定对应七个平台（X、YouTube、TikTok、哔哩哔哩、小红书、抖音、微信视频号），不随界面语言变：中英文界面看到的是同一组牌，每个平台每轮恰好一块，长赛道整轮重复。只有建筑、地形和牌面互相遮挡使十四块确实摆不下时，才允许十块兜底：仍保留七个广告槽和三个招商位；两类穿插且都分布在道路两侧。
牌面内容见第 10 节。

**赛车面比 `checkpoints[].pos` 的 y 高出下面这个数**。`pos.y` 是路线样条的高程，
路面是在它之上铺的一层（管线 `sr/roads.py:ROAD_LIFT`），标线又在路面之上两厘米。
运行时凡是要往路面上放东西的——起终点线、将来的路口标线——都得加上它，
不加就是把东西埋进沥青里，画面上一点痕迹都没有。两边各有一个测试拿它对：

```text
road_lift_m = 0.06
```

`line_white` 和 `line_yellow` 是路面标线。标线是自己的薄条几何、浮在路面上方两厘米，
不是画在路面贴图上：贴图要第二套 UV、要 alpha、还要处理路面变宽的情况，
而薄条严格贴着中心线走，每个弯都跟得上。

`building_*` 那五个是**外立面**：管线按 OSM 的 `building` 标签给每栋楼挑一个
（`pipeline/sr/buildings.py:FACADE`），一个材质一个节点，节点名照旧带 `buildings` 前缀
（`buildings_glass` 等），所以第 3 节那张表判出来的碰撞类型不变。
标签不认识的楼保留 `building` 这个**兜底**材质，运行时在它上面画程序化窗格。
挂了贴图的楼不画那层窗格——窗户在图里，再画一遍就是两套窗叠在一起。

挂 `building` **或 `building_*`** 材质的几何，墙面 UV 的单位是**米除以下面这个数**：`u` 是沿着轮廓从这一圈的第一个角
走过的米数，`v` 是离这栋楼**自己底面**的高度。运行时的窗户图案直接画在这套 UV 上
（`game/src/world/materials.ts` 的 `windowedBuilding`），一楼临街带还拿它跟一个绝对米数比，
所以凡是挂 `building` 的几何——切片里的楼、远景天际线上的高楼、地标外壳——**必须是同一个数**。
一处用了别的数，那里的窗户就是另一个尺度，而临街带会按比例放大到吃掉整栋楼。两边各有一个测试拿它对：

```text
facade_uv_metres = 3.0
```

建筑可附带 `TEXCOORD_1`（运行时 `uv1`）：两个分量为 `seed / 1024` 和住宅标记（0 办公、1 住宅）。
`seed` 为 1–1023 的整数，按原始 OSM 元素身份或程序楼栋位置键稳定生成；在裁道路之前定下，
合并、切片、顶点重排均保持同栋一致。着色器用 `round(uv1.x * 1024)` 还原，允许 meshopt 的 UV 量化误差。
旧几何和未提供身份的地标缺省为 `(0, 0)`，沿用稳定的默认办公灯色，不因重新加载随机变化。
该属性只控制灯色与分组，不改变 UV、几何或碰撞。


挂 `road`、`bridge`、`sidewalk` 这类**带状几何**（管线 `sr/mesh.py:ribbon`）的 UV，
**两个轴都是米除以下面这个数**：`u` 是沿带子走过的米数，`v` 是**从中心线横过去的米数**（左负右正）。
`v` 以前是 0 到 1 铺满整个宽度，那对纯色没问题、对平铺贴图是错的：赛车面宽十二到二十八米
（半宽夹在 `sr/route.py` 的 `RACE_MIN_HALF = 6.0` 和 `RACE_MAX_HALF = 14.0` 之间，
那两个常量是这件事唯一的主），同一张图横着拉过去，最宽的路上沥青颗粒比最窄的大两倍多，
而且路一变宽颗粒就跟着变大。

```text
ribbon_uv_metres = 4.0
```

## 5. items.json（保留字段，**没有实现，也不打算实现**）

**。这一节留着是因为 `track.json` 的 schema 里 `items` 和 `traffic`
两个可选字段还在，删一个契约字段是管线、运行时、合成赛道一起改的三方动作，而这两个字段
**没有任何生产者、没有任何消费者、没有任何赛道用它们**——也就是没有第三方可改。留着比动它便宜。

底下这段格式**从来没有产生过一个字节**。原文写的是「0.3 起有内容」，而 0.3 就是正在做的这一版，
`game/public/tracks/` 下面一个 `items.json` 都没有；照这句话去实现道具，等于照着一个被删掉的
方向干活。

道具和危险物布置，`game/public/tracks/<id>/items.json`：

```json
{ "items": [ { "type": "coffee", "s": 412.0, "offset": -2.5 } ] }
```

`type` 枚举：`coffee`、`charge`、`options`、`pothole`、`stalled_robotaxi`、`cones`。`s` 沿赛道，`offset` 横向米右正。位置由运行时从样条算，不存世界坐标。

## 5b. menu-map.json

开场界面那张湾区地图，`game/public/menu-map.json`，**进版本库**（它不随赛道重建，
一次 Overpass 区域拉取就够，见下面的命令）。

```json
{ "version": 5,
  "region": [37.15, -122.85, 38.25, -121.55],
  "water":  [ [[-122.85, 38.0], [-122.5, 37.9], "…闭环，首尾同点"] ],
  "land":   [ ["…水里的岛，同样是闭环"] ],
  "routes": [ { "id": "goldengate", "category": "scenic", "km": 5.3, "checkpoints": 10,
                "line": [[-122.48, 37.81], "…经纬度折线"],
                "streets": [{ "class": "b", "line": [[-122.49, 37.80], "…同坐标周边街道"] }] } ] }
```

- 全部是 `[经度, 纬度]`，**不是**第 1 节那套本地米——这份文件是给一张地图用的，不是给世界用的。
- `region` 是 `[南, 西, 北, 东]`，取景框就是它；`water`/`land` 已经切到这个框里。
- `routes[].line` 和 `routes[].streets[].line` 共用同一个经纬度坐标系，运行时必须用同一投影、同一比例画；
  `streets[].class` 的 `a`/`b`/`c` 从主干路到支路，只控制浅色底图线宽。
- **填充规则是 even-odd**：管线判「哪里是湿的」用的是射线法，那就是 even-odd；
  而简化（Douglas-Peucker）不保证多边形还是简单多边形——湾那个环简化完自交 44 处，
  自交处正是两种填充规则会给出不同答案的地方。所以运行时的 CSS 必须写 `fill-rule: evenodd`，
  两边不同规则就是两张不同的图。
- 名字和介绍不在这里，在 i18n（见第 6 节）。

## 6. i18n 键

`game/src/ui/locales/zh.json` 和 `en.json` 键集合必须完全一致，有测试。键命名：

- 界面：`<屏幕>.<元素>`，如 `menu.play`、`settings.language`。
- 赛道：`track.<id>.name`、`track.<id>.blurb`、`track.<id>.story`。管线把 track.json 里的文案也写进去，运行时以 i18n 文件为准，track.json 里的是给管线预览用的副本。
- 检查点：`checkpoint.<id>.<序号>`。
- 道具：`item.<type>.name`。

## 7. 管线命令行

```
python -m sr.cli fetch <route>                          拉数据进 cache/
python -m sr.cli build <route> --stage greybox|full     生成 game/public/tracks/<id>/
python -m sr.cli synth                                  生成三条合成赛道
python -m sr.cli validate <track.json>                  校验
python -m sr.cli preview <route>                        只画预览图
python -m sr.cli textures                               生成 game/public/textures/ 和它的清单
python -m sr.cli menu-map                               生成 game/public/menu-map.json
```

`menu-map` 读的是 `pipeline/cache/bayarea/coast.json.gz`（整个湾区的 OSM 海岸线，
和别的 OSM 缓存一样进版本库）。那份缓存缺了才需要重拉，一条命令：
`.venv/bin/python -c 'from sr import menumap; menumap.fetch_region()'`。

路线定义在 `pipeline/routes/<id>.json`，地标在 `pipeline/landmarks.json`，道具在 `pipeline/items/<id>.json`。

## 8. 输出目录

```
game/public/tracks/<id>/track.json
game/public/tracks/<id>/items.json
game/public/tracks/<id>/tiles/<name>.glb   # 一块切片一个文件，管线写的就是这个形状
game/public/tracks/<id>/tiles.bin          # 只在 dist/ 里：npm run build 打出来的
game/public/tracks/<id>/backdrop.glb
game/public/tracks/<id>/thumb.webp
game/public/models/landmarks/<id>.glb
game/public/models/cars/<car>.glb
game/public/models/props/<name>.glb
game/public/textures/<material>.webp
game/public/textures/manifest.json
game/public/menu-map.json                  # 开场地图，进版本库
```

`tracks/` 和 `textures/` 都是**构建产物，不进版本库**（`.gitignore`）。切片由
`python -m sr.cli build`／`synth` 生成，贴图由 `python -m sr.cli textures` 生成。

## 9. 测试命令

```
cd game && npm test && npm run typecheck && npm run build
cd pipeline && .venv/bin/python -m pytest -q
python3 tools/size_report.py
```

浏览器那一档分三级，**按你要问的问题选，别按习惯选**：

```
cd game && npm run look                   看一眼开场屏，约 2 秒
cd game && npm run look -- goldengate     看一眼那条赛道（机器人开起来之后截）
cd game && npm run e2e:quick               不怎么开车的那几个，约 30 秒
cd game && npm run e2e                     全套，十几分钟——它真的在开十几条路线
```

超时的默认档是 **90 秒**（`playwright.config.ts`），那是「问浏览器一个问题」的价钱；
真要开车的文件在自己顶上写 `test.describe.configure({ timeout })` 并说明买的是什么。
菜单交互使用短超时，长驾驶测试单独设置时限。

## 10. 广告牌内容清单

`game/public/billboards/manifest.json`。管线只决定广告牌立在哪、多大、属于哪个槽位；
**牌面上写什么完全由这个文件决定，加一条广告不用重跑管线，也不用改代码**。

```json
{
  "version": 1,
  "faces": [
    {
      "id": "space-01",
      "kind": "space",
      "zh": { "headline": "广告位招商", "sub": "本路段全线可投放", "bg": "#123", "fg": "#fff" },
      "en": { "headline": "Space available", "sub": "This whole stretch", "bg": "#123", "fg": "#fff" }
    }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `version` | 清单格式版本，整数 |
| `faces` | 牌面列表。运行时按顺序把它们分配给 `billboard_face_a` 到 `_n` 十四个槽位，多了循环，少了重复 |
| `faces[].id` | 唯一标识，只用来查问题 |
| `faces[].kind` | `space` 招商位同牌显示两种语言；`social` 自媒体位使用真实成品图片 |
| `faces[].platform` / `.target` | 平台标识和二维码目的地；没有公开网页的原生码用稳定的平台内账号标识 |
| `faces[].render` | 静态成品牌面的标题、账号、颜色等可复现输入；生成脚本只渲染这里的内容，不另存一份文案 |
| `faces[].zh` / `.en` | 自媒体两种语言各一套牌面；招商位的两种标题始终一起显示 |
| `…​.image` | 社交牌面整图的 URL，相对 `public/`。社交牌给了就直接贴；招商牌始终绘制两种标题 |
| `…​.headline` | 大字 |
| `…​.sub` | 小字 |
| `…​.qr` / `…​.handle` | 保留旧数据字段，但不用于临时拼装社交广告或假二维码 |
| `…​.bg` / `.fg` | 背景色和字色，CSS 颜色 |

招商位用 canvas 同时绘制两种标题。社交成品图未到位或加载失败时，以清单第一块招商位替代，
不显示虚构账号或假二维码。加载清单绕过 HTTP 缓存；旧版本、无效或缺失清单回退到同一源文件
随构建生成的快照。修改图片内容时递增清单版本，图片 URL 带版本参数以刷新缓存。



## 11. 贴图

贴图**不进切片**，跟材质名一样按名字挂在共享材质库上（第 3、4 节）。一张沥青图上传一次，
全场所有画路面的切片共用；加一张贴图是管线的事，运行时一行代码都不用改。

清单在 `game/public/textures/manifest.json`，跟图片放在一起，由 `pipeline/sr/textures.py` 一起写出来：

```json
{
  "version": 1,
  "textures": [
    { "material": "sidewalk", "map": "sidewalk.webp", "px": 512,
      "metres": 2.0, "repeat": [2.0, 1.075], "tier": "core", "bytes": 7886 }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `material` | 第 4 节那张表里的名字。表里没有的名字运行时报错并跳过，不会静默 |
| `map` | 颜色图文件名，跟清单同目录 |
| `facadePanes` | 可选 `[横向窗数, 纵向窗数, 窗框比例]`，由生成窗户贴图的同一参数输出。窗数为正，窗框比例在 0 和 1 之间；运行时按贴图 UV 对齐反光和亮灯。没有此字段的贴图不凭空叠窗；无贴图仍用原程序窗格 |
| `roughnessMap` | 可选。粗糙度图，通常比颜色图小得多——粗糙度按米变，颜色按厘米变。three.js 读它的绿通道 |
| `px` / `roughPx` | 两张图各自的边长像素。显存按 `(px² + roughPx²)×4×4/3` 算（RGBA 加整条 mip 链） |
| `metres` | 这张图画的是**几米**的世界。给人看的，运行时不读 |
| `repeat` | `[u, v]`，UV 单位。**运行时只认这一个**。管线拿 `metres` 和它写进几何的 uv 尺度相除得出 |
| `tier` | `core` 车动之前必须到，`later` 可以后到 |
| `bytes` | 这个材质的全部文件字节数（颜色图加粗糙度图），`tools/size_report.py` 拿它做报告和硬线检查 |

`repeat` 是唯一有效字段，`metres` 和 `px` 是给人核对用的：同一个事实只有管线一个主，
`pipeline/tests/test_textures.py` 用除法把这个推导钉住。运行时再除一遍就是第二个作者，
两边说反话的那天没人看得见。

挂上贴图的材质，`color` 会被设成白、`roughness` 被设成 1：three 里 `map` 和 `color`、
`roughnessMap` 和 `roughness` 都是**相乘**的，灰模那套数留着就等于把每张图按占位颜色再压暗一遍。
所以**颜色由图片本身带**——桥面比路面浅一号，是两张图不一样，不是材质上的一个色号。

**清单读不到或者形状不对，整份都不要，灰模颜色原样留着**——半套贴图的街道比一套灰模难看得多。

### 格式：WebP，不是 KTX2/Basis

实测（`sidewalk` 这张图，`pipeline/sr/textures.py` 跑出来的数）：

| 边长 | WebP q88 | PNG | 显存 RGBA+mips | 显存 ETC1S | 显存 UASTC |
|---|---|---|---|---|---|
| 512 | 7.7 kB | 154 kB | 1.4 MB | 0.17 MB | 0.35 MB |
| 1024 | 27.8 kB | 607 kB | 5.6 MB | 0.70 MB | 1.40 MB |
| 2048 | 114.7 kB | 2431 kB | 22.4 MB | 2.80 MB | 5.59 MB |

下载这一头 WebP 已经便宜到不值得再优化：一张 1024 是 28 kB，二十张也才 0.6 MB，
而首次可驾驶前的下载量也会单独实测。**贵的是显存**，一张 1024 上了 GPU 是 5.6 MB，
两百倍于它的文件大小——就是这个数。

KTX2/Basis 能把显存砍掉四到八倍，代价是每次会话多一个 wasm 转码器，管线多一个
`basisu`／`toktx` 二进制依赖（这台机器上两个都没有），而且 UASTC 的**下载**通常比 WebP 还大。
以这个项目的贴图规模——十几二十张平铺图，不是照片扫描——那个代价换不回来。

**所以现在是 WebP，什么时候翻案有明确条件**：显存碰到高硬线、决定要换的那天。

### 提高后的硬线

贴图单独检查 `textures_vram_mb`（上了 GPU 的显存，按 `px²×4×4/3` 算）。
核心和全部贴图的下载量只作报告，不另设硬线；它们仍计入整包的 `web_total_mb`。**提高后的硬线只有一份，在
`tools/resource_limits.json` 里**。它只防平台拒收、浏览器崩溃和已经不可玩的帧率；碰线输出
`HARD LIMIT:`，不另外设置会催着美术削细节的软线。Web 整包以 450 MB
判红，给 itch.io 当前 500 MB 的解压后上限留 50 MB 发版余量。

### 版权

贴图**全部自制**，是 `pipeline/sr/textures.py` 里的程序生成的，源头是那份代码而不是图片文件。
街景照片和 Google／Apple／Bing 的卫星底图都不是 CC0，不能切下来当贴图；
能免费用的是**观察**——湾区人行道是暖灰骨料、一米半一道缝——那是数字，数字可以生成。
将来要是真引进外部素材，只用 CC0 或自由授权的，逐条记进 ASSETS.md。

### Unified off-road slime carriers (181)

`scenery_slime` instances carry the same centre, yaw and ellipsoid scale as `props_slime_*`.
The runtime hides their carrier mesh and renders them as living poppers with the shared jelly and eyes.
They are omitted in `none` density and yield capacity to authored road encounters.
`scenery_slime_many` uses the same transforms and renderer, and appears only in `many` density;
`scenery_slime` is the shared normal population.
`pipeline/sr/schema/slime-shapes.json` owns radius intervals and visible height ratios for pipeline and runtime.
The 202 shape revision replaces the old flattening profile: giants embed their lower 30% radius
in the ground, and both producers use `colossusGroundFraction` when positioning their centres.
The existing exported centre/yaw/ellipsoid-scale fields remain unchanged.

### Non-racing endpoint roads

Optional `endRoads: { start, finish }` uses the existing `spline` shape for each path. Both begin at the corresponding open-course endpoint and point outward along actual cached OSM roads; they do not add checkpoints or race distance. The pipeline renders and collides these roads as scenery. Reverse travel exchanges start and finish without reversing their points. Circuits omit the field. Finishers may use the finish path to park; a racing player who leaves an open course longitudinally is rescued. Older and synthetic tracks may omit the field and retain their existing parking fallback.
