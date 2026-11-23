# 开发计划

## 目标

让 GoogleFlowReverseApi 平台跟上 Flow2API 上游（TheSmallHanCat/flow2api）当前的模型目录，优先接入 afv 尚未提供的 Omni 1.2 Flash 视频模型和 Gemini 3.1 Flash Lite 图片模型。

## 调研结论

- afv 已有完整的 Flow2API 客户端：OpenAI 兼容 `/v1/chat/completions` 流式生成、`/v1/models/aliases` 远程模型列表、图片 / 视频策略、参考图 Data URI、结果 URL 解析。不需要新增平台或协议。
- Flow2API 上游 2026-11 新增 Omni 1.2 Flash（`omni-1.2-flash-{3..15}s-{landscape|portrait}`，0-3 张参考图）与 `gemini-3.1-flash-lite-image`；新版图片接口已移除 `gemini-2.5-flash-image`、`imagen-4.0-generate-preview`。
- AtWhuhu/flow2api 当前落后上游 35 个提交、没有自有提交，部署上游版本即可获得上述模型；afv 侧只需补模型映射与预设。
- 其他开源方案：useapi/google-flow-api（第三方付费 API 示例与 MCP）、leopardbyte/google-flow-api-wrapper（无头浏览器 REST 包装）、lugondev/flow-google-captcha（浏览器扩展桥接）。均不如 Flow2API 的账号池、验证码、刷新与 OpenAI 兼容接口适合作为 afv 后端。

## 范围

1. `omni-1.2-flash` 预设：文生视频与 0-3 张参考图，16:9 / 9:16，3-15 秒，默认 8 秒；按任务时长与比例映射为 Flow2API 完整模型名。
2. `gemini-3.1-flash-lite-image` 预设与别名映射，比例与 2K / 4K 档位同 3.1 Flash。
3. 保留旧图片别名，兼容尚未升级的 Flow2API 部署。
