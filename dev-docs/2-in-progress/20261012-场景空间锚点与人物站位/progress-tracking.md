# 进度跟踪 · 场景空间锚点与人物站位

状态图例：`[ ]` 未开始  `[~]` 进行中  `[x]` 完成  `[!]` 阻塞

## 阶段 1 · 后端

| # | 事项 | 状态 | 备注 |
| --- | --- | --- | --- |
| 1.1 | `AssetMetadataRegistry` scene schema 追加 `blocking` 字段定义 | [x] | 供 `query_asset_metadata` 与 REST metadata 暴露 |
| 1.2 | `StoryboardItem` 追加瞬态字段 `spatialBlock` / `sceneCameraOptions` | [x] | `@TableField(exist=false)`，不入库、**零迁移** |
| 1.3 | 新建 `SceneBlockingService`：解析 `properties.blocking` | [x] | 容错解析，结构非法时按「未配置」处理并告警 |
| 1.4 | `SceneBlockingService`：机位选取（覆盖 → 环绕 → 角度 → 平视 → 首项） | [x] | 与 `to-fusion.mjs:pickCamera` 逐条对齐 |
| 1.5 | `SceneBlockingService`：景别门控 + 锚点选取 + 站位拼装 | [x] | 与 `to-fusion.mjs:spatialAnchorText` 对齐 |
| 1.6 | `SceneBlockingService`：批量 enrich 分镜条目 | [x] | 按场景去重加载，避免 N+1 |
| 1.7 | `StoryboardController` 三个读取接口接线 | [x] | listItems / listItemsByScene / getItemById |
| 1.8 | `GetStoryboardSceneItemsToolExecutor` item JSON 追加 `spatialBlock` | [x] | 生图/生视频 agent 主路径 |
| 1.9 | 新增 `StoryboardService.updateItemCameraAnchor` + `PATCH /item/{id}/camera-anchor` | [x] | 合并写 custom_data，避开 JSON 列读写不对称坑 |
| 1.10 | 单元测试：机位选取 / 景别门控 / 锚点选取 | [x] | `SceneBlockingServiceTests` 16 个用例全过（空值容错 4 + 锚点选取 2 + 机位选取 6 + 景别门控 1 + 站位 2 + 单条入口 1） |
| 1.11 | 后端编译通过 | [x] | `sh ./mvnw -DskipTests -o compile` 通过 |

## 阶段 2 · 前端

| # | 事项 | 状态 | 备注 |
| --- | --- | --- | --- |
| 2.1 | `lib/api/storyboard.ts` StoryboardItem 追加 `spatialBlock` / `sceneCameraOptions` | [x] | 另加 `updateItemCameraAnchor` 与 `StoryboardCameraOption` 类型 |
| 2.2 | `buildDefaultFramePrompt` 注入 `spatialBlock` | [x] | 主注入点，拼在提示词末尾 |
| 2.3 | 分镜表格新增「机位锚点」列 | [x] | `storyboard-camera-anchor-cell.tsx` + 列定义；写 `custom_data.cameraAnchorId` |
| 2.4 | `StoryboardItemUpdateReqVO` / `StoryboardItemUpdateReq` 支持 `customData` | [x] | 不需要——改为专用 `PATCH /item/{id}/camera-anchor`，避开 JSON 列整体覆盖风险 |
| 2.5 | 资产页「空间锚点」编辑器组件 | [x] | `scene-blocking-editor.tsx`（锚点表 + 机位表 + 角色站位表），`assets/page.tsx` 接线保存 |
| 2.6 | 前端构建验证 | [!] | `next build` 会清理 `.next/trace`（正好 50 文件）触发沙箱 `safe-delete` 护栏；已改用 `npx tsc --noEmit`（通过），完整构建需主人在外部执行 |

## 阶段 3 · 数据迁移与切换

| # | 事项 | 状态 | 备注 |
| --- | --- | --- | --- |
| 3.1 | `build/anchors.json` → 7 个场景资产 `properties.blocking` | [x] | `to-blocking-sql.mjs` → `剑骨-blocking-update.sql`，`roles` 键由 C01 代号换算为角色资产 id，**已执行本地库**，核验 7 场景带 blocking、图片零丢失 |
| 3.2 | `scene_expectation` 去重（回归纯画面期望） | [ ] | 一次性定向 UPDATE，不得触碰图片列。**建议等系统功能上线跑通后再做**——去重后锚点只由 `spatialBlock` 单一来源提供 |
| 3.3 | 远程 quant-db 同步 | [ ] | 等主人指示 |
| 3.4 | 重建前后端 docker 镜像并重启 | [ ] | 改动要在本地 8080 生效需重新出镜像；远程同理 |

## 决策记录

| 日期 | 决策 | 结论 |
| --- | --- | --- |
| 2026-10-12 | 锚点数据存储形态 | 复用现有 JSON 字段（`asset.properties` + `item.custom_data`），不新增表；按将来可拆表的结构设计 JSON schema |
| 2026-10-12 | 逐镜机位锚点 | 自动匹配 + 可手工覆盖（分镜表下拉） |
| 2026-10-12 | 首期范围 | 含 UI 编辑器（服务端组装器 + 资产页编辑器 + 分镜机位列） |

## 已完成的前置工作（本轮之前）

- `outputs/剑骨/build/anchors.json`：7 个场景的锚点表 / 机位表 / 默认站位（build 侧数据源）。
- `outputs/剑骨/build/to-fusion.mjs`：三处注入（`scene_expectation`、Veo `Space:` 行、`afv_asset.description`），已验证。
- `outputs/剑骨/build/剑骨-anchor-update.sql`：490 条定向 UPDATE，**已执行到本地库**，483/483 条 `scene_expectation` 含锚点，图片零丢失，Redis 缓存已清。
