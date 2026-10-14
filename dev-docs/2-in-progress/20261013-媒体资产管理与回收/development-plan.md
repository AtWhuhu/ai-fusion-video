# 媒体资产管理与回收 — 开发计划

需求提出：2026-10-13
背景文档：`outputs/诊断/2026-10-13-孤儿分析/诊断报告.md`

## 一、背景

融光存储层（Cloudflare R2）**只增不减**：

- 重新生成首帧图、删除生图任务都不会回收旧文件；
- 现有「扫描孤儿文件」（`MediaCleanupService`）把**生图流水表**（`afv_image_item`/`afv_image_task`）当作硬引用，导致差集恒为空，界面上永远显示 0 个孤儿。

实测（2026-10-13）：桶内 250 个对象中，**148 个（119.85 MB）已不被任何"当前有效字段"引用**，但扫描器一个都认不出来。

现有「存储配置」页只提供一个粗粒度的"扫描 → 清理"按钮，无法看到具体是哪些文件、谁在引用、能不能删。

## 二、目标

新增一个**媒体资产管理页面**：

1. 列出存储后端中的**全部产出资产**，带缩略图与基本信息；
2. 对每个资产标注**真实引用状态**（三态），并展开显示引用明细；
3. 支持**单个 / 批量删除**"被替换的"与"历史记录产出的"资产；
4. 删除时可选**联动清理**数据库中的生成流水记录，避免留下裂图。

## 三、状态定义（核心口径）

| 状态 | 判定 | 可否删除 |
|---|---|---|
| `active` 使用中 | 被至少一个**当前有效字段**引用 | 拒绝删除（接口二次校验） |
| `history` 历史产出 | 不被任何有效字段引用，但被**生成流水表**引用 | 可删（建议同时清流水记录） |
| `orphan` 无引用 | 不被任何数据库记录引用 | 可删 |

**当前有效字段**（计入 `active`）：

- `afv_storyboard_item`：image_url / reference_image_url / video_url / generated_image_url / first_frame_image_url / last_frame_image_url / generated_video_url
- `afv_storyboard_episode`：composed_video_url / bgm_audio_url / bgm_sfx_audio_url
- `afv_storyboard_scene`：场景图相关字段（如存在）
- `afv_asset_item`：image_url / thumbnail_url / properties
- `afv_asset`：cover_url
- `afv_project`：cover_url / art_style_image_url

**生成流水表**（仅计入 `history`，不使资产转为 active）：

- `afv_image_item`（image_url / thumbnail_url）
- `afv_image_task`（ref_image_urls）
- `afv_video_item`（video_url / cover_url / first_frame_url / last_frame_url）
- `afv_video_task`（first_frame_image_url / last_frame_image_url / reference_*_urls）

> `video_item` 若用于成片展示则需重新评估归属，见 `technical-debt.md`。

## 四、接口契约

统一前缀 `/api/system/media-assets`，管理员权限。

### 4.1 `GET /overview`

```json
{
  "totalObjects": 102, "totalBytes": 193899150,
  "activeCount": 102, "activeBytes": 193899150,
  "historyCount": 0,   "historyBytes": 0,
  "orphanCount": 0,    "orphanBytes": 0,
  "byType": [
    { "mediaType": "image", "count": 60, "bytes": 50000000 },
    { "mediaType": "video", "count": 20, "bytes": 120000000 },
    { "mediaType": "audio", "count": 3,  "bytes": 5000000 }
  ]
}
```

### 4.2 `POST /page`

请求：

```json
{ "scope": "all|active|history|orphan", "mediaType": "all|image|video|audio",
  "keyword": "shot_06", "pageNo": 1, "pageSize": 24 }
```

响应：

```json
{
  "total": 102, "pageNo": 1, "pageSize": 24,
  "items": [{
    "key": "images/xxx.jpg",
    "url": "https://afvs3.wanwaz.top/images/xxx.jpg",
    "size": 123456,
    "mediaType": "image",
    "extension": "jpg",
    "status": "active",
    "deletable": false,
    "projectId": 1,
    "projectName": "剑骨",
    "references": [
      { "category": "分镜", "table": "afv_storyboard_item", "column": "first_frame_image_url",
        "recordId": 6, "label": "《剑骨》/ 第1集 / S07-15 首帧图", "active": true }
    ]
  }]
}
```

### 4.3 `POST /delete`

```json
{ "keys": ["images/xxx.jpg"], "cleanupRecords": true }
```

响应：

```json
{ "deletedCount": 1, "deletedBytes": 123456, "failedCount": 0,
  "failedItems": [], "blockedKeys": [], "removedRecords": 1 }
```

约束：

- `keys` 中若含 `active` 资产 → 该 key 进入 `blockedKeys`，不删除，接口整体仍返回成功；
- `cleanupRecords=true` 时，删除后清理 `afv_image_item` 中指向该对象的行，并清理因此变空的 `afv_image_task` 行。

## 五、实施步骤

1. 需求文档（本目录）；
2. 后端：`MediaAssetService` + `MediaAssetController` + VO；
3. 前端 API 层 `lib/api/media-assets.ts`；
4. 前端页面 `settings/media` 与 `_components/`；
5. 侧边栏导航入口；
6. 类型检查与编译验证；
7. 本地构建部署，实测页面。

## 六、验收标准

- 页面能列出全部对象，数量与 `/overview` 一致；
- 三态标注与 `outputs/诊断/2026-10-13-孤儿分析/analyze_orphans.py` 的独立复核结论一致；
- 删除 `history` / `orphan` 资产后，桶内对象数与总字节同步下降；
- 尝试删除 `active` 资产会被拒绝并有明确提示；
- 前端 `tsc --noEmit` 与后端编译通过。
