# 合并上游 v1.3.1 开发计划

## 目标

将 `Stonewuu/ai-fusion-video` 的 `v1.3.1` 合并进 `AtWhuhu/ai-fusion-video`，保留 fork 自有功能，并保证生产库（Flyway 历史停在 `1.1.2.1.0`）可以直接升级。

## 需保留的 fork 功能

- ComfyUI Basic Auth、UI 格式工作流转换
- EasyColab 一键唤醒页面、CI 镜像内 EasyColab bridge
- 版本检查对比 fork 自身标签与 GHCR 镜像
- 场景空间锚点 / 人物站位 / 机位锚点 / 3D 布景快照、俯视图保护
- 首尾帧改造模式与邻镜参考、资产 AI 改图、媒体孤儿文件清理
- 资产 JSON 字段兼容、局部更新不覆盖未传列

## 合并策略

- 后端以上游 resource/canvas 架构为主；fork 的旧 `AssetService` / `StoryboardService` 保留给 Agent 工具与场景锚点使用。
- Agent 工具链同时保留上游 `ResourceCommandContext`、`AgentToolInvocationPolicy` 与 fork 的 `StoryboardBlockingRefInjector`。
- Prompt 以上游规则为主体，追加 fork 的锚点、首尾帧与俯视图约束。
- 前端分镜工作区保留 fork 的条目编辑弹窗与参考面板，接口调用迁到上游带 `version`/`requestId` 的资源接口；上游新拆出的设置页、存储配置组件直接采用，fork 功能迁入新组件。
