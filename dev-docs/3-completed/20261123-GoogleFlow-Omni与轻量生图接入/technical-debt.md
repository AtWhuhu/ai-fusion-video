# 技术债务

- 兼容项：`gemini-2.5-flash-image`、`imagen-4.0-generate-preview` 仍保留在别名集合与预设中，兼容对象是未同步上游 5644df2 之前的 Flow2API 部署（包括当前 AtWhuhu/flow2api）。Flow2API 部署升级到上游新版后应删除这两项。
- Omni 1.1 Flash（abra 系列）上游标记 2026-12-05 下线，afv 不接入。
- Omni 1.2 Flash 11-15 秒需要 Google AI Plus / Pro / Ultra 订阅，账号不满足时由 Flow2API 返回错误。
- 未用真实 Flow 账号做端到端生成验证。
