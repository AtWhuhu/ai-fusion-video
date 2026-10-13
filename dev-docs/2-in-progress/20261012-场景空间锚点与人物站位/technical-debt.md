# 技术债务 · 场景空间锚点与人物站位

| # | 债务 | 产生原因 | 影响 | 偿还条件 |
| --- | --- | --- | --- | --- |
| 1 | 锚点数据存在 `properties` JSON 里，服务端不做结构校验 | 首期选零迁移方案，`AssetService.create/update` 不校验 properties key（现状即如此） | 非法 JSON 结构只能在组装器里容错处理，写错不报错 | 拆成 `afv_asset_anchor` + `afv_asset_blocking` 独立表时，用外键与列约束兜住 |
| 2 | 锚点规则在 `to-fusion.mjs`（JS）与 `SceneBlockingService`（Java）各有一份 | build 侧脚本先于系统功能落地；本次要求两处逐条对齐 | 双份实现，规则改动需同步，容易漂移 | 已给出收敛方案（2026-10-13）：`to-fusion.mjs`（位于本机 `outputs/剑骨/build/`，不在本仓库）删掉本地 `pickCamera` / `spatialAnchorText` 实现，改为调 `GET /api/storyboard/{storyboardId}/items`（需登录态），直接取每条 item 的 `spatialBlock` 字段——该接口已由 `SceneBlockingService.fillSpatialContext` 注入，与前端/AI 工具同一份规则。删 JS 实现后 Java 为唯一规则来源，本条即消。注意：以后改规则只改 Java 一处 |
| 3 | `roles` 键用角色资产 id，未做引用完整性 | 无外键，删角色后站位残留 | 悬空站位被视为「未配置」，不报错 | 独立表时加外键；或在组装器里加悬空检测日志 |
| 4 | 分镜条目的机位锚点存在 `custom_data` 里 | 避免加列 | 无法按机位锚点做索引查询 | 需要「按机位筛镜头」时提升为独立列 |
| 5 | `StoryboardItem.spatialBlock` 是瞬态字段，随每次列表请求实时计算 | 不加缓存，避免资产改动导致脏读 | 483 条一次请求需批量查 2 张表，暂可接受 | 数据量上升后按 `sceneAssetItemId` 做二级缓存，并在资产更新时失效 |
| 6 | 未做逐镜站位覆盖的 UI | 首期范围外 | 单镜头站位与场景默认值冲突时，只能改场景默认值或改 beat 文案 | `custom_data` 已留位，需要时开编辑器 |
| 7 | 未纳入道具锚点 | 首期范围外 | `prop_ids` 的道具位置仍不可锚定 | 复用同一套 `anchors` 结构，扩 `roles` 为 `objects` |
| 8 | ~~`buildDefaultFramePrompt` 仍把整段 `sceneExpectation` 透传~~ → 已解决（2026-10-13） | 历史约定：该字段曾是唯一注入点 | 若库里 `scene_expectation` 已含锚点文本，会与 `spatialBlock` 重复注入 | 代码层去重已落地，无需再做数据层 UPDATE：① 前端 `buildDefaultFramePrompt` 在 `spatialBlock` 非空时，用 `lib/scene-expectation.ts:stripBakedSpatialAnchors` 剥离 `sceneExpectation` 里的 baked 锚点段（全角方括号三标记 + 恒定声明残句 + `Space:` 行）；② 后端 `GetStoryboardSceneItemsToolExecutor` 同理，用 `SceneBlockingService.stripBakedAnchors` 剥离后再塞进 AI 工具 JSON。两处标记定义必须同步修改（见各自文件头注释）。`get_storyboard` 工具不返回 `spatialBlock`，无双注入问题，未动 |
| 9 | 未删除的死代码 `components/dashboard/asset-detail-sheet.tsx`（全仓库 0 处 import） | 历史遗留 | 与新的场景锚点编辑器存在功能重叠，易误用 | 资产页编辑器完成后评估：复用或删除 |

## 遵守事项（非债务，但需持续注意）

- 任何数据操作**不得触碰** `afv_asset_item.image_url` 与 `afv_storyboard_item.*_frame_image_url`；改数据一律走定向 UPDATE，不走全量重建。
- 实体字段**不得加** `@Builder.Default` 初值（历史坑：局部更新被默认值反噬）。
- 实体字段**不得加** `@JsonSerialize` / `@JsonRawValue`（历史坑：污染 Redis 缓存 ObjectMapper 导致接口 500）。
- 所有读方法遵循现有缓存约定；新增写路径需 `@CacheEvict`。
