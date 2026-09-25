# 赛道远景依据

远景的山体和水面仍由公开高程数据决定，高楼、主干道和海岸线仍来自 OpenStreetMap；程序只补
OSM 远景查询故意省掉的八层以下城区。下面的来源用来决定哪里应当保持开阔、哪里应当连续建成，
以及两处重点住宅的屋顶组合。它们不替代地图坐标，也不把照片逐栋抄进游戏。

| 赛道 | 现实依据 | 落进画面的约束 |
|---|---|---|
| Hangar to Bayfront / Bayshore 101 | [Palo Alto Baylands Nature Preserve](https://www.cityofpaloalto.org/Departments/Community-Services/Open-Space-Parks-Golf/Palo-Alto-Baylands-Nature-Preserve)：101 北向经过 Moffett Field、山景城和门洛帕克园区一带，湾侧是湿地和盐池 | 高速两侧保持低层园区与湿地；Moffett 机库作为共享地标可见（322 改线）。 |
| Fisherman's Wharf | [NPS 的旧金山天际线说明：从湾面能辨认 Coit Tower、Palace of Fine Arts 与 Golden Gate Bridge](https://www.nps.gov/places/22-city-skyline.htm) | 城市侧保持高密低中层轮廓，水侧留给真实海湾、Alcatraz 和两座桥。 |
| Golden Gate | [NPS Golden Gate National Recreation Area 官方景观图集](https://www.nps.gov/media/photo/gallery.htm?id=889F2A02-EA28-088B-43D220903845B8EE) | 南端接旧金山城区；Marin Headlands 保持开阔，只在 Sausalito 方向补低层建成区。 |
| Lombard Street | [NPS 的湾岸天际线地标说明](https://www.nps.gov/places/22-city-skyline.htm) | Russian Hill 与 North Beach 是连续密集街区，平顶为主但保留少量坡顶；湾面不铺房屋。 |
| Moffett Field | [NASA：机场在旧金山湾南岸，北为盐田、南为 101，场地近乎平坦且人工设施最显眼](https://historicproperties.arc.nasa.gov/hangar1/overview.html) | 跑道和北侧盐田不生成住宅；城市与研发建筑只出现在机场南、东、西外围，Hangar One 仍是主轮廓。 |
| Shoreline | [Mountain View：Shoreline 是旧金山湾边 750 英亩保护地](https://www.mountainview.gov/our-city/departments/community-services/shoreline-at-mountain-view?locale=en)、[North Bayshore 含湿地、潮沼、溪流和蓄水池](https://www.mountainview.gov/our-city/departments/city-manager-s-office/shoreline-park-district/community-special-park-district) | 园区和 101 一侧补低中层建筑，北侧湿地、盐田与海湾保持开阔。 |
| Twin Peaks | [SF Recreation and Parks：海拔 922 英尺、北侧观景区有 180 度湾区视野](https://www.sfrecpark.org/Facilities/Facility/Details/Twin-Peaks-384)、[官方报告：可见城市及周围湾区的 360 度景观](https://www.sfrecpark.org/DocumentCenter/View/19737/Twin-Peaks-Promenade-Commission-Staff-Report-2022_06_01) | 山腰住宅连续但不遮死城市视线；近景约一半平顶，其余混合人字和四坡顶，明显区别于 Cupertino。 |
| Wolfe–Pruneridge | [Cupertino：玻璃与钢的总部建筑和爬向 Santa Cruz Mountain 山脚、树木遮蔽的住宅街区相邻](https://www.cupertino.gov/Your-City/About-Cupertino)、[Apple Park 位于 I、Wolfe、Homestead、Tantau 之间](https://www.cupertino.gov/Your-City/Departments/Community-Development/Planning/Major-Projects/Apple-Park) | 园区外以一至两层坡顶住宅为主，14% 平顶、58% 人字顶、28% 四坡顶；中景从现有 800 米 OSM 街区接到低模远景。 |

Apple 周边与 Twin Peaks 的屋顶百分比是对上述公开照片、规划页面所示街区形态做的游戏化抽样，
不是逐栋建筑调查。选择器使用固定位置哈希，同一栋房每次构建保持同一屋顶；比例只约束整个街区，
不声称某个 OSM footprint 的真实屋顶一定是哪一种。

312 的住宅细节沿用上述区域与屋顶选择：南湾坡顶房增加低门廊和真实尺度入口，Cupertino 中景体块
降到一至两层并收窄；旧金山较高住宅增加凸窗、窗框和入口台阶。依据为
[SF 地面层住宅设计指南](https://default.sfplanning.org/publications_reports/Guidelines_for_Groundfloor_Residential_Design.pdf)
展示的凸窗、入口与台阶，以及 [Cupertino 独栋住宅资料](https://www.cupertino.gov/Your-City/Departments/Community-Development/Planning/Residential-Planning/Single-Family-Residential-Developments)
记录的独栋和 Eichler 街区。具体每栋样式仍为游戏化选择，不声称是逐户复原；近景和中景共用
`sr.architecture.house_style`，屋顶比例仍由 `sr.vistas.PROFILES` 决定。
