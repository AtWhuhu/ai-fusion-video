# 进度跟踪

## 2026-10-13

- [x] 现象诊断（`outputs/诊断/2026-10-13-孤儿分析/`）：定位扫描器口径缺陷，实测 148 个僵尸文件 / 119.85 MB
- [x] 一次性清理：删 148 个对象 + 本地/远程各 148 条悬空记录（桶 250→102）
- [x] 需求文档建立
- [x] 后端 `MediaAssetService` / `MediaAssetController`（overview / page / delete）+ 请求 VO；`StorageObject` 补 `lastModified`
- [x] 前端 API 层 `lib/api/media-assets.ts`
- [x] 前端页面 `settings/media`（page + 概览 / 工具栏 / 网格 / 详情 4 个组件 + support 工具）
- [x] 侧边栏导航入口（管理员「媒体资产」）
- [x] 后端 `mvn compile` 通过；前端 `tsc --noEmit` 通过
- [x] 本地构建镜像（`ai-fusion-video:local` / `ai-fusion-video-web:local`）并部署到本地环境
- [x] 接口实测通过

## 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/system/media-assets/query` | 概览 + 分页列表，一次存储列举（避免并发 ListObjects） |
| POST | `/api/system/media-assets/delete` | 按 keys 删除，或按 scope 清空某状态全部 |

## 实测记录（2026-10-13 21:55）

本地环境（`ai-fusion-video:local`，容器 fusion-backend/frontend）：

- `query` → 112 个对象 / 202.8 MB；使用中 53、历史产出 55、无引用 4
- 引用标签正确，例如：
  - `videos/composed/….mp4` → `active`，`剑骨 / 第1集 · 成片`
  - `videos/….mp4` → `history`，`视频生成 #5 · 产出视频`
- 删除防护：对 `active` 对象调 delete → `deletedCount=0`、进入 `blockedKeys`（符合预期）
- 删除链路：删一个 `orphan` 图片 → `deletedCount=1 / 701183 B`，复验 112 → 111 个、无引用 4 → 3

### 过程中发现并修掉的问题

1. **并发 ListObjects 触发 R2 响应截断**：最初前端 `Promise.all` 并行调用 overview 与 page，两个请求各自全量列举，偶发 `XMLStreamException: Premature end of Content-Length delimited message body` → 500。改为服务端 `/query` 一次列举同时返回概览与列表，前端单次请求。顺带省掉一次全量列举。
2. `StorageObject` 增加 `lastModified`，需要在 `S3StorageStrategy` / `LocalStorageStrategy` 同步实现。
3. 前端 `Button` 不支持 `asChild`，改用 `onClick + window.open`。

## 待确认

- `afv_video_item` 是否应计入「当前有效引用」——当前归入历史流水（见 technical-debt.md TD-1）。
- 页面是否需要展示非媒体对象（如 agent 上传的 txt/json）——当前仅覆盖白名单媒体扩展名。
