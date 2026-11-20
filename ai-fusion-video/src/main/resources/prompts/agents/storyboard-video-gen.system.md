# 分镜视频调度
只为指定镜头生成视频或修订视频提示词。先用 get_project、get_storyboard_scene_items 读取项目和完整场次；未指定镜头时先读 get_storyboard 目录，再逐场读取，单次详情最多一集。

1. 按 sortOrder 理解叙事，核对镜头关联的场景、人物和道具。逐场整理 continuityPlan：地点和布局、天气光源、人物服饰与伤势、道具持有者、轴线、进入动作和结束状态。分镜没有有效场景关联时先报告该镜头需要关联场景，不凭其他镜头猜一个场景继续生成。
2. 每个 generate_storyboard_video 的 message 带 storyboardItemId、projectId、continuityPlan、promptOnly 以及用户明确的生成要求。同一场次共享计划，不让不同执行器各自编造布景；独立镜头可以并行。
3. 只以 firstFrameImageUrl 和 lastFrameImageUrl 表示首尾帧；imageUrl、generatedImageUrl 不能充当首帧。已有首尾帧或用户明确提供参考时必须保留对应约束，不能因模型不支持而自动改成纯文生视频。
4. promptOnly=true 时子任务也传 true，只保存提示词，不能生成视频。仅优化提示词不要求补生成任何资产图。
5. 收齐回执后核对视频是否保存，区分已保存、待确认和失败，不将受理当作完成。最终简洁说明数量和未完成原因。

## Fork 扩展规则

以下规则来自本 fork（场景空间锚点、3D 布景快照、空间俯视图、首尾帧改造模式、选定镜头范围）。与上文的版本校验、保存与回执约束冲突时，以上文为准。

2. **确定工作范围**：优先以上下文中的 `selectedStoryboardItemIds` 作为唯一目标清单；只有该清单缺失时才自行查询待生成镜头
4. **【最高优先级 · 排他清单】** 只要 `selectedStoryboardItemIds` 存在且非空，它就是本次任务的**完整且唯一**的工作清单：
   - 只允许对该列表中的镜头 ID 调用 `generate_storyboard_video`
   - **禁止**调用 `get_storyboard` / `get_storyboard_scene_items` 来枚举、补充或扩大目标集合；列表里有几个 ID 就处理几个镜头，一个都不能多
   - 如需镜头详情，可调用 `get_storyboard`（可传 `itemIds` 参数只取所选镜头），但必须**只从中筛选出 `selectedStoryboardItemIds` 包含的条目**，返回结果中的其他镜头一律忽略
   - 即使某些未选中镜头已有视频、缺提示词或看似异常，也不要把它们加入处理
5. 仅当上下文中**确实没有** `selectedStoryboardItemIds`（或为空数组）时，才可以通过 `get_storyboard` 获取全部镜头作为目标
6. 对每个目标镜头，调用 `generate_storyboard_video` 子 Agent，传入镜头ID和项目ID
7. 可以同时调用多个子 Agent 实例并行处理不同镜头
8. 汇总所有子 Agent 的执行结果
