# 技术债务

## TD-1 `afv_video_item` 的引用归属待定

当前方案把 `afv_video_item` 归入**生成流水**（不计入 `active`），依据是它由视频生成任务写入、前端未直接消费。

风险：若后续把"已生成视频"作为成片来源直接展示，其 `video_url` 会变成活跃引用，而本页会把对应文件标为「历史产出」并允许删除，存在误删风险。

处理：接入前需确认前端是否有读取 `afv_video_item` 的链路（`lib/api/generation.ts` 的视频部分）。**未确认前，删除 `history` 类资产需要在界面上给出显式警示。**

## TD-2 引用来源定位依赖全表扫描

`MediaAssetService` 构建引用索引时会 `selectList(null)` 拉取全部相关表。当前数据量（数百行）无压力，但随生成流水增长会变慢，且每次打开页面都要重算。

处理：后续可加缓存（`@Cacheable`）或改为按需计算 + 本地短时缓存；数据量上千后再考虑物化 refs 表。

## TD-3 未覆盖非媒体对象

只处理白名单扩展名（jpg/png/mp4/mp3 等）。agent 上传的 txt/json/md 等不会被列出，也不会被清理。

处理：若这些也会堆积，需扩展白名单并重新评估引用来源。

## TD-4 存储策略需支持列举与删除

`MediaStorageService.listObjects` / `deleteObject` 已在 `S3StorageStrategy` 与 `LocalStorageStrategy` 实现。若接入新的存储后端，必须同时实现这两个方法，否则页面不可用。

## TD-5 未接入自动回收

本需求只提供"看得见 + 手动删"。根治仍需在 `ImageGenerationService.delete()` 与故事板替换首帧的链路中回收旧对象（见诊断报告方案 D）。未实施，堆积仍会发生。

## TD-6 并发 ListObjects 会触发存储响应截断

开发期间实测：前端并行调用两个各自全量列举的接口时，Cloudflare R2 偶发返回被截断的 XML（`Premature end of Content-Length delimited message body`），表现为 500。

已通过"服务端合并为单次列举"规避，但**任何新增的、会并发触发 `listObjects` 的调用路径都需要注意**。若后续并发场景不可避免，应给 `MediaStorageService.listObjects` 加短时缓存（如 10 秒）而不是让每个请求各拉一次。

## TD-7 权限粒度

`/api/system/media-assets/*` 未加额外的角色校验，与既有 `MediaCleanupController` 保持一致（依赖全局登录拦截）。前端入口仅在管理员侧边栏出现。

风险：非管理员若能直接构造请求仍可调用删除接口。若部署面向多租户，需要补 `@PreAuthorize` 或等价校验。
