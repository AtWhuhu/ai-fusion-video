# 技术债务

## 生产库孤儿迁移 V1.1.2.1.0

- 生产库 `flyway_schema_history` 有 `V1.1.2.1.0__add_storyboard_auto_produce_task.sql`（checksum `1985456073`，建表 `afv_storyboard_auto_produce_task`），该脚本不在 fork 或上游任何 git 历史中，也不在 fork.13 至 fork.17 镜像里。
- 合并后存在比它更新的迁移（`V1.1.3.*`），Flyway 会把它判为 missing 并拒绝启动，因此 `application.yaml` 设置 `ignore-migration-patterns: "*:future,versioned:missing"`。
- 副作用：今后任何缺失的 versioned 迁移都不会再阻断启动。找回原脚本（或确认该表废弃并由维护者在生产库手动处理该历史记录）后，应删除该配置恢复默认 `*:future`。

## 旧资产 / 分镜 Service 与资源命令并存

- 上游删除了 `AssetService`，fork 的 Agent 工具（场景锚点、分镜查询、资产改图）仍通过旧 Service 读写；旧 Service 写分镜时同步递增 `version`，避免与资源命令的乐观锁冲突。
- 后续应把这些工具迁移到 `ResourceCommandService`，再删除旧 Service。

## 分镜工作区接口适配

- fork 分镜工作区的删除、排序、绑定剧本分集等操作在调用前先读取一次最新 `version`，再调用上游带乐观锁的接口；并发编辑时以服务端版本为准，后续可改为直接使用列表中携带的版本。
- 新增镜头要求场次内已有镜头绑定了场景资产，否则提示先绑定场景资产（上游接口要求 `sceneAssetItemId`）。
- 上游新增的 `storyboard-reference/*` 参考面板未被 fork 工作区使用，已移除；`editable-cell`、`storyboard-table-view` 沿用 fork 的删除决定。
