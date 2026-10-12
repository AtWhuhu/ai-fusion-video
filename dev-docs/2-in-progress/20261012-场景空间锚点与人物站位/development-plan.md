# 场景空间锚点与人物站位 · 开发方案

## 1. 问题

同一场景内，人物与场景结构的相对位置在镜头之间不一致。最典型的是《剑骨》第 1 集「祭骨坛」：少年被绑在刑柱上，而这根柱子在相邻镜头里位置飘忽、数量不定，甚至凭空消失。

根因链（已在真实链路上验证）：

1. **融光没有站位/空间的结构化字段。** 位置只能靠提示词文本表达。
2. **场景资产只描述到「有什么」，没描述到「在哪里」。** 祭骨坛的 `asset.description` 只写「四周石柱矗立」——多根、无编号、无朝向。模型每镜随机挑一根。
3. **每个镜头的首帧提示词是逐镜独立生成的。** 场景侧只有一张参考图进入 prompt，资产文字描述不自动进 prompt（`storyboard-frame-executor.system.md` §1.4/§2/§3）。指望场景描述锁柱子无效。
4. **没有任何一处按镜注入空间约束的机制。** 前端「生成首帧」默认提示词由 `storyboard-frame-reference-dialog.tsx:buildDefaultFramePrompt()` 拼装，只读画风/景别/内容/画面期望/对白/运镜/机位角度。

## 2. 目标

把「场景空间锚点 + 人物站位」做成融光的系统能力：导演在资产页定义一次场景的空间语汇，系统在生成首帧/视频时按镜确定性注入，使同一场景内所有镜头的人物站位与关键物件景位可复现、可审计、可人工覆盖。

## 3. 数据契约（复用现有 JSON 字段，不新增表）

### 3.1 场景资产 `afv_asset.properties.blocking`

```json
{
  "locationType": "exterior",
  "atmosphere": "肃杀压抑，阴森",
  "timeOfDay": "night",
  "description": "既有的场景可视化描述",
  "blocking": {
    "anchors": [
      { "id": "P1", "name": "中央刑柱", "key": true, "ring": false, "desc": "坛面几何中心偏北一尺，柱径一尺、高丈二，全坛唯一立柱，画面绝对轴心" },
      { "id": "T1", "name": "火把环", "key": false, "ring": true, "desc": "沿坛沿等距环立的八支火把，自正北起顺时针编号，全场唯一光源" }
    ],
    "cameras": [
      { "id": "C1", "name": "坛沿平视机位", "angle": "平视", "move": "", "desc": "机位在坛面西缘朝东正对 P1，柱体位于画面中央偏右" }
    ],
    "roles": {
      "1": { "at": "P2（柱南面）", "face": "面朝坛下 P5 方向", "note": "背贴 P1 柱身，铁链向左右两侧拉开" }
    }
  }
}
```

- `anchors[].key=true` = 全场主地标，**每镜必带**；`ring=true` = 环绕物，**每镜必带**；其余锚点仅在该镜有角色站在此处时才带。
- `cameras[].angle` ∈ 平视/仰视/俯视/鸟瞰/荷兰角；`move` 为「环绕」「跟」时优先于角度匹配。
- `roles` 的键是**角色资产 id（`afv_asset.id`）**，不是角色名、也不是 `afv_asset_item.id`——一个角色的多个子资产（三视图/变体）应共享同一份站位。
- 方位基准：**正北＝场地纵深远端（画面深处），正南＝镜头来路／场外，东西＝画面左右**。

### 3.2 分镜条目 `afv_storyboard_item.custom_data`

```json
{ "cameraAnchorId": "C2" }
```

导演在分镜表格里手工指定的机位锚点。缺省（不写）时按 `camera_angle` + `camera_movement` 自动匹配。

### 3.3 实体瞬态字段 `StoryboardItem.spatialBlock`

`@TableField(exist = false)`，不入库，由服务端组装器按请求填充，随分镜条目一起返回给前端与 AI 工具。

## 4. 组装规则（确定性，与 `build/to-fusion.mjs` 的 JS 版逐条对齐）

1. **景别门控**：景别为「特写」时**不注入任何环境结构与机位锚点**，只注入人物站位，并声明「画面只表现主体局部，背景为失焦暗部，不表现任何建筑或环境结构」；否则模型会把立柱、火把硬塞进面部特写。
2. **机位选取顺序**：`custom_data.cameraAnchorId` 精确命中 → 运镜为「环绕/跟」且存在 `move=环绕` 的机位 → `camera_angle` 精确匹配 → 平面上第一个 `angle=平视` 的机位 → 该场景第一个机位。都取不到则该段省略。
3. **锚点选取**：`key=true` 与 `ring=true` 全带；其余仅当某在场角色的 `roles[].at` 包含该锚点 id 时才带。
4. **站位选取**：按在场角色的**资产 id** 查 `roles`。
5. **输出文本**（三段，缺数据则整段省略）：

```
【空间锚点】场景为{场景名}。{id（名称）＝desc；…}。
【机位方位】{id（名称）}＝{desc}。
【人物站位】{角色名}：位于{at}，{face}{，note}；…。同一场景内上述锚点位置、机位方位与主体站位全程恒定，不得随镜头改变。
```

6. **未配置 `blocking` 的场景**：不注入、不报错（未配置＝无约束，不是降级）。

## 5. 消费方

| 消费方 | 文件 | 改动 |
| --- | --- | --- |
| 前端「生成首帧」默认提示词 | `storyboard-frame-reference-dialog.tsx:buildDefaultFramePrompt` | 追加 `空间锚点：${item.spatialBlock}` |
| 分镜表格「机位锚点」列 | `storyboard-table-view.tsx` COLUMNS + `use-storyboard-workspace.ts` | 新增下拉列，写 `custom_data.cameraAnchorId` |
| 资产页「空间锚点」编辑器 | `projects/[id]/assets/page.tsx` + 新 `_components/scene-blocking-editor.tsx` | 编辑 `properties.blocking` |
| AI 生图执行器 | `GetStoryboardSceneItemsToolExecutor` | item JSON 追加 `spatialBlock` |
| AI 生视频执行器 | 同上 | 同上（同一工具，T2V 降级也受约束） |
| 元数据说明 | `AssetMetadataRegistry` scene schema | 追加 `blocking` 字段定义，供 `query_asset_metadata` 与 REST metadata 暴露 |

## 6. 实施顺序

1. 后端：`SceneBlockingService`（解析 + 组装 + 校验）+ 实体瞬态字段 + Controller/AI 工具接线 + `AssetMetadataRegistry` 字段定义。
2. 后端编译验证。
3. 前端：TS 类型 → `buildDefaultFramePrompt` 消费 → 分镜机位锚点列 → 资产页锚点编辑器。
4. 前端构建验证。
5. 《剑骨》数据迁移：把 `build/anchors.json` 的锚点写入 7 个场景资产的 `properties.blocking`，`roles` 键由 `C01` 代号换算为角色资产 id。
6. `scene_expectation` 去重：系统功能上线后，`scene_expectation` 回归纯画面期望，锚点由 `spatialBlock` 单一来源提供（一次性定向 UPDATE）。

## 7. 验收

- 后端：单元测试覆盖机位选取顺序、景别门控、锚点选取三种分支。
- 集成：对《剑骨》第 1 集祭骨坛的 9 个镜头调用分镜条目接口，`spatialBlock` 输出与 `build/to-fusion.mjs` 生成的文本一致（同一份锚点数据、同一套规则）。
- 前端：分镜页能看到并修改机位锚点；「生成首帧」默认提示词包含锚点段。
- 数据安全：任何步骤不得触碰 `image_url` / `*_frame_image_url`。

## 8. 不做

- 不新增数据表（首期）。将来若要做成跨项目模板/团队共享，再按 3.1 的 JSON schema 拆成 `afv_asset_anchor` + `afv_asset_blocking`。
- 不做逐镜站位覆盖 UI（`custom_data` 已留位，需要时再开）。
- 不做道具锚点（`prop_ids` 的锚定留待后续）。
