# 完成总结

## 最终范围

- 新增 `omni-1.2-flash` 视频预设：文生视频与 0-3 张参考图，16:9 / 9:16，3-15 秒；后端按任务时长与比例解析为 `omni-1.2-flash-{秒}s-{landscape|portrait}`，拒绝超出 3-15 秒或指定分辨率的请求。
- 新增 `gemini-3.1-flash-lite-image` 图片预设与别名映射，复用现有比例后缀与 2K / 4K 档位。
- 远程模型列表把 `omni*` 识别为视频模型。

## 验证

- `GoogleFlowReverseApiSupportTests` 覆盖 Omni 时长与方向映射、越界拒绝、Flash Lite 类型识别；后端 `./mvnw test` 全量通过。

## 遗留

- 需要把 AtWhuhu/flow2api 同步到上游后再部署，Omni 1.2 Flash 与 Flash Lite 才能实际生成。
- 未使用真实 Flow 账号验证，见 technical-debt.md。
