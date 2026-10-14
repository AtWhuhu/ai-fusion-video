package com.stonewu.fusion.service.ai.tool.storyboard;

import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.stonewu.fusion.entity.asset.Asset;
import com.stonewu.fusion.entity.asset.AssetItem;
import com.stonewu.fusion.entity.storyboard.Storyboard;
import com.stonewu.fusion.entity.storyboard.StoryboardItem;
import com.stonewu.fusion.entity.storyboard.StoryboardScene;
import com.stonewu.fusion.service.ai.ToolExecutionContext;
import com.stonewu.fusion.service.ai.ToolExecutor;
import com.stonewu.fusion.service.ai.tool.ToolResourceAccessGuard;
import com.stonewu.fusion.service.asset.AssetService;
import com.stonewu.fusion.service.storyboard.SceneBlockingService;
import com.stonewu.fusion.service.storyboard.StoryboardService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * 查询分镜场次镜头列表工具（get_storyboard_scene_items）
 * <p>
 * 返回指定场次下的所有镜头详情，含完整的镜头信息（画面内容、运镜、对白、图片、视频等）。
 * 也支持通过 storyboardItemId 查询该镜头所在场次的所有镜头（用于获取上下文）。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class GetStoryboardSceneItemsToolExecutor implements ToolExecutor {

    /** 场景的空间俯视布局图子资产类型：是给人看的布局示意图，不作为模型参考图 */
    private static final String SCENE_TOPDOWN_ITEM_TYPE = "topdown";

    private final StoryboardService storyboardService;
    private final AssetService assetService;
    private final ToolResourceAccessGuard accessGuard;
    private final SceneBlockingService sceneBlockingService;

    @Override
    public String getToolName() {
        return "get_storyboard_scene_items";
    }

    @Override
    public boolean isReadOnly() {
        return true;
    }

    @Override
    public String getDisplayName() {
        return "查询场次镜头列表";
    }

    @Override
    public String getToolDescription() {
        return """
                查询分镜镜头详情，支持三种查询方式（传其一即可）：
                1. 通过 storyboardSceneId 查询该场次下的所有镜头
                2. 通过 storyboardItemId 查询该镜头所在场次的所有镜头（自动定位场次）
                3. 通过 sceneAssetId 查询**全项目**所有用到该场景资产的镜头（跨集跨场次聚合，
                   按分镜顺序排列）。想看「这个场景在整部片子里都发生过什么」时用这个 ——
                   归纳场景的空间结构锚点、可用机位与人物站位就属于这种情况。

                返回的每个镜头包含完整信息：画面内容、景别、运镜、对白、音效、首尾帧图片URL、视频URL等。
                可用于获取上下文信息（上一个/下一个镜头），以便生成连贯的视频提示词。

                **资产引用解析**：每个镜头的 characterIds、propIds、sceneAssetItemId 会自动解析为带图片URL的资产引用信息，
                返回在 characterRefs、propRefs、sceneRef 字段中，包含子资产ID、名称、类型和图片URL，无需额外调用 query_asset_items。
                """;
    }

    @Override
    public String getParametersSchema() {
        return """
                {
                    "type": "object",
                    "properties": {
                        "storyboardSceneId": {
                            "type": "integer",
                            "description": "分镜场次ID，直接查询该场次的所有镜头"
                        },
                        "storyboardItemId": {
                            "type": "integer",
                            "description": "分镜条目ID，自动找到所在场次并返回该场次所有镜头"
                        },
                        "sceneAssetId": {
                            "type": "integer",
                            "description": "场景资产ID；返回全项目所有使用该场景的镜头（跨集跨场次聚合）"
                        }
                    }
                }
                """;
    }

    @Override
    public boolean isEnabled() {
        return true;
    }

    @Override
    public String execute(String toolInput, ToolExecutionContext context) {
        try {
            JSONObject params = JSONUtil.parseObj(toolInput);
            Long storyboardSceneId = params.getLong("storyboardSceneId");
            Long storyboardItemId = params.getLong("storyboardItemId");
            Long sceneAssetId = params.getLong("sceneAssetId");

            if (storyboardSceneId == null && storyboardItemId == null && sceneAssetId == null) {
                return errorResult("请提供 storyboardSceneId、storyboardItemId 或 sceneAssetId 之一");
            }

            Long targetItemId = storyboardItemId;
            List<StoryboardItem> items;
            JSONObject header = JSONUtil.createObj();

            if (storyboardSceneId == null && storyboardItemId == null) {
                // 路径三：按场景资产跨集聚合 —— 归纳空间锚点时要看的是「这个场景全部发生过什么」
                Asset sceneAsset;
                try {
                    sceneAsset = assetService.getById(sceneAssetId);
                } catch (Exception e) {
                    return errorResult("未找到ID为 " + sceneAssetId + " 的场景资产");
                }
                accessGuard.requireProject(sceneAsset.getProjectId(), context.getUserId());

                Set<Long> sceneItemIds = new LinkedHashSet<>();
                for (AssetItem assetItem : assetService.listItems(sceneAssetId)) {
                    sceneItemIds.add(assetItem.getId());
                }
                if (sceneItemIds.isEmpty()) {
                    return errorResult("场景资产 " + sceneAssetId + " 下没有子资产，无法定位使用它的分镜镜头");
                }
                Storyboard storyboard = storyboardService.getByProjectId(sceneAsset.getProjectId());
                if (storyboard == null) {
                    return errorResult("项目 " + sceneAsset.getProjectId() + " 还没有分镜");
                }
                items = new ArrayList<>();
                for (StoryboardItem item : storyboardService.listItems(storyboard.getId())) {
                    if (item.getSceneAssetItemId() != null && sceneItemIds.contains(item.getSceneAssetItemId())) {
                        items.add(item);
                    }
                }
                header.set("sceneAssetId", sceneAssetId)
                        .set("sceneAssetName", sceneAsset.getName())
                        .set("projectId", sceneAsset.getProjectId());
            } else {
                // 路径一/二：场次内查询
                StoryboardItem targetItem = null;
                if (storyboardSceneId == null) {
                    targetItem = accessGuard.requireStoryboardItem(storyboardItemId, context.getUserId());
                    storyboardSceneId = targetItem.getStoryboardSceneId();
                    if (storyboardSceneId == null) {
                        return errorResult("该分镜条目没有关联场次");
                    }
                }
                StoryboardScene scene = accessGuard.requireStoryboardScene(storyboardSceneId, context.getUserId());
                if (targetItem != null && !Objects.equals(targetItem.getStoryboardId(), scene.getStoryboardId())) {
                    return errorResult("分镜条目与场次归属不一致");
                }
                items = storyboardService.listItemsByScene(storyboardSceneId);
                header.set("storyboardSceneId", scene.getId())
                        .set("sceneName", scene.getSceneHeading());
            }

            // 收集所有镜头中引用的子资产ID，批量查询
            Set<Long> allAssetItemIds = new LinkedHashSet<>();
            for (StoryboardItem item : items) {
                collectAssetItemIds(allAssetItemIds, item.getCharacterIds());
                collectAssetItemIds(allAssetItemIds, item.getPropIds());
                if (item.getSceneAssetItemId() != null) {
                    allAssetItemIds.add(item.getSceneAssetItemId());
                }
            }
            // 批量查询子资产信息
            Map<Long, AssetItem> assetItemMap = batchGetAssetItems(allAssetItemIds);

            // 批量查询父资产：角色引用需要内联服装与外貌设定（锁服装一致性、防比例失调）
            Set<Long> parentAssetIds = new LinkedHashSet<>();
            for (AssetItem assetItem : assetItemMap.values()) {
                if (assetItem.getAssetId() != null) {
                    parentAssetIds.add(assetItem.getAssetId());
                }
            }
            Map<Long, Asset> parentAssetMap = batchGetAssets(parentAssetIds);

            // 注入场景空间锚点：人物站位与关键物件的画面景位按镜确定性生成，是唯一的空间约束来源
            sceneBlockingService.fillSpatialContext(items);

            JSONArray itemList = new JSONArray();
            for (StoryboardItem item : items) {
                // 系统已按镜注入 spatialBlock：剥离 sceneExpectation 里历史 baked 的锚点段，避免双注入
                String sceneExpectation = item.getSpatialBlock() != null
                        ? SceneBlockingService.stripBakedAnchors(item.getSceneExpectation())
                        : item.getSceneExpectation();
                JSONObject itemObj = JSONUtil.createObj()
                        .set("id", item.getId())
                        .set("shotNumber", item.getShotNumber())
                        .set("autoShotNumber", item.getAutoShotNumber())
                        .set("sortOrder", item.getSortOrder())
                        .set("shotType", item.getShotType())
                        .set("content", item.getContent())
                        .set("sceneExpectation", sceneExpectation)
                        .set("dialogue", item.getDialogue())
                        .set("sound", item.getSound())
                        .set("soundEffect", item.getSoundEffect())
                        .set("music", item.getMusic())
                        .set("duration", item.getDuration())
                        .set("cameraMovement", item.getCameraMovement())
                        .set("cameraAngle", item.getCameraAngle())
                        .set("cameraEquipment", item.getCameraEquipment())
                        .set("focalLength", item.getFocalLength())
                        .set("transition", item.getTransition())
                        .set("imageUrl", item.getImageUrl())
                        .set("generatedImageUrl", item.getGeneratedImageUrl())
                        .set("firstFrameImageUrl", item.getFirstFrameImageUrl())
                        .set("lastFrameImageUrl", item.getLastFrameImageUrl())
                        .set("firstFramePrompt", item.getFirstFramePrompt())
                        .set("lastFramePrompt", item.getLastFramePrompt())
                        .set("videoUrl", item.getVideoUrl())
                        .set("generatedVideoUrl", item.getGeneratedVideoUrl())
                        .set("videoPrompt", item.getVideoPrompt())
                        .set("characterIds", item.getCharacterIds())
                        .set("sceneAssetItemId", item.getSceneAssetItemId())
                        .set("propIds", item.getPropIds())
                        .set("remark", item.getRemark())
                        .set("spatialBlock", item.getSpatialBlock())
                        .set("blocking3dImageUrl", readBlockingSnapshotUrl(item.getCustomData()));

                // 内联角色参考图信息（含父资产服装/外貌设定）
                JSONArray characterRefs = buildAssetRefs(item.getCharacterIds(), assetItemMap, parentAssetMap);
                if (!characterRefs.isEmpty()) {
                    itemObj.set("characterRefs", characterRefs);
                }

                // 内联道具参考图信息
                JSONArray propRefs = buildAssetRefs(item.getPropIds(), assetItemMap, parentAssetMap);
                if (!propRefs.isEmpty()) {
                    itemObj.set("propRefs", propRefs);
                }

                // 内联场景参考图信息
                if (item.getSceneAssetItemId() != null) {
                    AssetItem sceneAssetItem = assetItemMap.get(item.getSceneAssetItemId());
                    if (sceneAssetItem != null) {
                        itemObj.set("sceneRef", buildSingleAssetRef(sceneAssetItem, parentAssetMap));
                    }
                }

                // 标记当前目标镜头
                if (targetItemId != null && targetItemId.equals(item.getId())) {
                    itemObj.set("isCurrentTarget", true);
                }

                itemList.add(itemObj);
            }

            return header
                    .set("totalItems", items.size())
                    .set("items", itemList)
                    .toString();

        } catch (Exception e) {
            log.error("[get_storyboard_scene_items] 查询失败", e);
            return errorResult("查询失败: " + e.getMessage());
        }
    }

    private String errorResult(String message) {
        return JSONUtil.createObj().set("status", "error").set("message", message).toString();
    }

    /** 从 custom_data JSON 里读取 3D 布景快照 URL（blocking3dImageUrl），无则返回 null */
    private String readBlockingSnapshotUrl(String customDataJson) {
        if (StrUtil.isBlank(customDataJson)) return null;
        try {
            return StrUtil.trimToNull(JSONUtil.parseObj(customDataJson).getStr("blocking3dImageUrl"));
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 从 JSON 数组字符串中提取子资产 ID 到集合
     */
    private void collectAssetItemIds(Set<Long> ids, String jsonArrayStr) {
        if (StrUtil.isBlank(jsonArrayStr)) return;
        try {
            JSONArray arr = JSONUtil.parseArray(jsonArrayStr);
            for (int i = 0; i < arr.size(); i++) {
                Long id = arr.getLong(i);
                if (id != null) ids.add(id);
            }
        } catch (Exception e) {
            log.warn("[get_storyboard_scene_items] 解析子资产ID列表失败: {}", jsonArrayStr, e);
        }
    }

    /**
     * 批量查询子资产信息，返回 id → AssetItem 映射
     */
    private Map<Long, AssetItem> batchGetAssetItems(Set<Long> ids) {
        Map<Long, AssetItem> map = new HashMap<>();
        for (Long id : ids) {
            try {
                AssetItem item = assetService.getItemById(id);
                map.put(id, item);
            } catch (Exception e) {
                log.warn("[get_storyboard_scene_items] 查询子资产失败: id={}", id, e);
            }
        }
        return map;
    }

    /**
     * 根据 ID 列表 JSON 构建资产引用数组
     */
    private JSONArray buildAssetRefs(String idsJson, Map<Long, AssetItem> assetItemMap,
                                     Map<Long, Asset> parentAssetMap) {
        JSONArray refs = new JSONArray();
        if (StrUtil.isBlank(idsJson)) return refs;
        try {
            JSONArray arr = JSONUtil.parseArray(idsJson);
            for (int i = 0; i < arr.size(); i++) {
                Long id = arr.getLong(i);
                if (id == null) continue;
                AssetItem assetItem = assetItemMap.get(id);
                if (assetItem == null) {
                    continue;
                }
                // 俯视图是布局示意图，不是画面素材：喂给模型会把线框和标注画进画面
                if (SCENE_TOPDOWN_ITEM_TYPE.equals(assetItem.getItemType())) {
                    continue;
                }
                refs.add(buildSingleAssetRef(assetItem, parentAssetMap));
            }
        } catch (Exception e) {
            log.warn("[get_storyboard_scene_items] 构建资产引用失败: {}", idsJson, e);
        }
        return refs;
    }

    /**
     * 构建单个子资产的引用信息。
     *
     * 角色类资产额外内联父资产上的服装（clothing）与外貌（appearance）设定：
     * 参考图只能锁脸和体型，服装一致性必须靠逐字文本约束兜底 —— 否则同一角色跨镜
     * 会出现白衣/绿袍漂移。
     */
    private JSONObject buildSingleAssetRef(AssetItem assetItem, Map<Long, Asset> parentAssetMap) {
        JSONObject ref = JSONUtil.createObj()
                .set("assetItemId", assetItem.getId())
                .set("assetId", assetItem.getAssetId())
                .set("name", assetItem.getName())
                .set("itemType", assetItem.getItemType())
                .set("imageUrl", assetItem.getImageUrl())
                .set("thumbnailUrl", assetItem.getThumbnailUrl());
        Asset parent = assetItem.getAssetId() != null ? parentAssetMap.get(assetItem.getAssetId()) : null;
        if (parent != null && "character".equals(parent.getType())
                && StrUtil.isNotBlank(parent.getProperties())) {
            try {
                JSONObject props = JSONUtil.parseObj(parent.getProperties());
                String clothing = props.getStr("clothing", null);
                String appearance = props.getStr("appearance", null);
                if (StrUtil.isNotBlank(clothing)) {
                    ref.set("clothing", clothing);
                }
                if (StrUtil.isNotBlank(appearance)) {
                    ref.set("appearance", appearance);
                }
            } catch (Exception e) {
                log.warn("[get_storyboard_scene_items] 解析角色资产设定失败: assetId={}", parent.getId(), e);
            }
        }
        return ref;
    }

    /**
     * 批量查询父资产信息，返回 id → Asset 映射
     */
    private Map<Long, Asset> batchGetAssets(Set<Long> ids) {
        Map<Long, Asset> map = new HashMap<>();
        for (Long id : ids) {
            try {
                map.put(id, assetService.getById(id));
            } catch (Exception e) {
                log.warn("[get_storyboard_scene_items] 查询父资产失败: id={}", id, e);
            }
        }
        return map;
    }
}
