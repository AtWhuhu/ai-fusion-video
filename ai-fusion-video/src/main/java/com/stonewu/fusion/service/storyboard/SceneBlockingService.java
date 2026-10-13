package com.stonewu.fusion.service.storyboard;

import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.stonewu.fusion.entity.asset.Asset;
import com.stonewu.fusion.entity.asset.AssetItem;
import com.stonewu.fusion.entity.storyboard.StoryboardItem;
import com.stonewu.fusion.service.asset.AssetService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 场景空间锚点组装器
 * <p>
 * 融光没有站位结构化字段，人物与场景结构的相对位置只能靠提示词表达。本类把「场景空间锚点表 +
 * 机位方位 + 人物站位」确定性拼成一段文本（{@link StoryboardItem#getSpatialBlock()}），
 * 使同一场景内所有镜头的人物站位与关键物件景位可复现。
 * <p>
 * 数据契约见 dev-docs/2-in-progress/20261012-场景空间锚点与人物站位/development-plan.md：
 * 锚点、机位、默认站位存放在场景资产的 {@code properties.blocking}；导演逐镜指定的机位锚点存放在
 * 分镜条目的 {@code custom_data.cameraAnchorId}。未配置 blocking 的场景不注入、不报错。
 * <p>
 * 组装规则与 build/to-fusion.mjs 的 JS 版逐条对齐（见 technical-debt 第 2 条：规则目前有两份实现）。
 * <p>
 * 本类是无状态纯函数式组装器，不含 create/update/delete 写入路径，读取全部走已带缓存的
 * {@link AssetService}，故不重复声明 {@code @Cacheable}/{@code @CacheEvict}。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SceneBlockingService {

    /** 特写不注入环境结构与机位锚点：否则模型会把立柱、火把等结构硬塞进面部特写 */
    private static final String SHOT_EXTREME_CLOSE = "特写";

    /** 运镜为环绕/跟时优先选用标记了 move=环绕 的机位 */
    private static final String MOVE_ARC = "环绕";
    private static final String MOVE_TRACK = "跟";
    private static final String ANGLE_EYE_LEVEL = "平视";

    /** 站位的恒定声明：逐镜都必须重申，否则模型会在不同镜头间自由移动主体 */
    private static final String CONSTANT_TAIL = "同一场景内上述锚点位置、机位方位与主体站位全程恒定，不得随镜头改变。";

    private final AssetService assetService;

    // ==================== 对外入口 ====================

    /**
     * 为分镜条目批量填充空间上下文：锚点文本（{@code spatialBlock}）与可选机位锚点列表
     * （{@code sceneCameraOptions}，供前端下拉）。调用方拿到的是刚从缓存反序列化出的对象副本，
     * 可安全就地写入。
     *
     * @param items 分镜条目列表；为 null 或空时直接返回
     */
    public void fillSpatialContext(List<StoryboardItem> items) {
        if (items == null || items.isEmpty()) {
            return;
        }

        Set<Long> sceneAssetItemIds = new LinkedHashSet<>();
        Set<Long> characterAssetItemIds = new LinkedHashSet<>();
        for (StoryboardItem item : items) {
            if (item.getSceneAssetItemId() != null) {
                sceneAssetItemIds.add(item.getSceneAssetItemId());
            }
            collectIdArray(characterAssetItemIds, item.getCharacterIds());
        }

        // 场景：子资产 → 场景资产（锚点表与场景名都挂在资产上）
        Map<Long, BlockingDef> blockingBySceneItemId = new HashMap<>();
        Map<Long, String> sceneNameByItemId = new HashMap<>();
        for (Long sceneItemId : sceneAssetItemIds) {
            Asset sceneAsset = resolveAssetByItemId(sceneItemId);
            if (sceneAsset == null) {
                continue;
            }
            sceneNameByItemId.put(sceneItemId, sceneAsset.getName());
            BlockingDef def = parseBlocking(sceneAsset.getProperties());
            if (def != null) {
                blockingBySceneItemId.put(sceneItemId, def);
            }
        }

        // 角色：子资产 → 角色资产 id 与角色名（roles 的键是资产 id，一个角色的多个子资产共享站位）
        Map<Long, String> characterAssetIdByItemId = new HashMap<>();
        Map<String, String> characterNameByAssetId = new HashMap<>();
        for (Long charItemId : characterAssetItemIds) {
            Asset charAsset = resolveAssetByItemId(charItemId);
            if (charAsset == null) {
                continue;
            }
            characterAssetIdByItemId.put(charItemId, String.valueOf(charAsset.getId()));
            characterNameByAssetId.put(String.valueOf(charAsset.getId()), charAsset.getName());
        }

        for (StoryboardItem item : items) {
            BlockingDef def = blockingBySceneItemId.get(item.getSceneAssetItemId());
            if (def == null) {
                continue;
            }
            item.setSceneCameraOptions(toCameraOptions(def));
            List<String> characterAssetIds = new ArrayList<>();
            for (Long charItemId : idList(item.getCharacterIds())) {
                String assetId = characterAssetIdByItemId.get(charItemId);
                if (assetId != null) {
                    characterAssetIds.add(assetId);
                }
            }
            String text = buildText(
                    sceneNameByItemId.get(item.getSceneAssetItemId()),
                    def,
                    characterAssetIds,
                    characterNameByAssetId,
                    readCameraAnchorId(item.getCustomData()),
                    item.getCameraAngle(),
                    item.getCameraMovement(),
                    item.getShotType());
            if (text != null) {
                item.setSpatialBlock(text);
            }
        }
    }

    /**
     * 解析单个分镜条目的空间锚点文本，供不经过列表接口的调用方使用。
     *
     * @return 锚点文本；场景未配置 blocking 时返回 null
     */
    public String resolveSpatialBlock(StoryboardItem item) {
        List<StoryboardItem> single = new ArrayList<>();
        single.add(item);
        fillSpatialContext(single);
        return item.getSpatialBlock();
    }

    // ==================== 历史 baked 锚点剥离 ====================

    /** 全角方括号：用码点构造，切勿改回字面量（落盘时会被清洗） */
    private static final String LBR = new String(Character.toChars(0x3010));
    private static final String RBR = new String(Character.toChars(0x3011));

    /** baked 锚点段的起止标记（与前端 lib/scene-expectation.ts 保持一致，双实现需同步修改） */
    private static final List<String> BAKED_ANCHOR_MARKERS =
            List.of(LBR + "空间锚点" + RBR, LBR + "机位方位" + RBR, LBR + "人物站位" + RBR);

    /** 恒定声明残句（baked 文本的收尾） */
    private static final String BAKED_CONSTANT_TAIL = "同一场景内上述锚点位置、机位方位与主体站位全程恒定，不得随镜头改变。";

    /** Veo `Space:` 行注入残留 */
    private static final Pattern BAKED_SPACE_LINE = Pattern.compile("(?m)^Space:.*$");

    /**
     * 剥离 scene_expectation 里历史 baked 的锚点文本。
     * <p>
     * to-fusion.mjs 曾把锚点直接写进 scene_expectation；系统改为按镜注入 spatialBlock 后，
     * 旧数据里的锚点段会与 spatialBlock 重复注入。仅在 spatialBlock 非空时调用。
     * baked 锚点段视为延续到下一个标记或文末：标记之后的内容一律按 baked 处理。
     *
     * @return 剥离后的纯画面期望；入参为 null/空时返回 ""
     */
    public static String stripBakedAnchors(String text) {
        if (text == null || text.isBlank()) {
            return "";
        }
        String result = BAKED_SPACE_LINE.matcher(text).replaceAll("");
        for (String marker : BAKED_ANCHOR_MARKERS) {
            int idx = result.indexOf(marker);
            while (idx != -1) {
                int end = result.length();
                for (String other : BAKED_ANCHOR_MARKERS) {
                    if (other.equals(marker)) {
                        continue;
                    }
                    int j = result.indexOf(other, idx + marker.length());
                    if (j != -1 && j < end) {
                        end = j;
                    }
                }
                result = result.substring(0, idx) + result.substring(end);
                idx = result.indexOf(marker);
            }
        }
        result = result.replace(BAKED_CONSTANT_TAIL, "");
        // 收敛残留空白：多空格压单、3+ 连续换行压成双换行、去首尾空白
        return result.replaceAll("[ \\t　]+", " ").replaceAll("\\n{3,}", "\n\n").trim();
    }

    /** 场景可用机位锚点 → 前端下拉选项 */
    private List<Map<String, String>> toCameraOptions(BlockingDef def) {
        List<Map<String, String>> options = new ArrayList<>();
        for (Camera camera : def.cameras()) {
            Map<String, String> option = new LinkedHashMap<>();
            option.put("id", camera.id());
            option.put("name", camera.name());
            option.put("angle", camera.angle());
            options.add(option);
        }
        return options;
    }

    // ==================== 组装规则 ====================

    /**
     * 拼装锚点文本。返回 null 表示该镜无可注入内容。
     */
    private String buildText(String sceneName, BlockingDef def, List<String> characterAssetIds,
            Map<String, String> characterNameByAssetId, String customCameraId,
            String cameraAngle, String cameraMovement, String shotType) {
        List<String> roleLines = new ArrayList<>();
        for (String assetId : characterAssetIds) {
            Role role = def.roles().get(assetId);
            if (role == null) {
                continue;
            }
            StringBuilder line = new StringBuilder()
                    .append(characterNameByAssetId.getOrDefault(assetId, assetId))
                    .append("：位于").append(role.at())
                    .append("，").append(role.face());
            if (StrUtil.isNotBlank(role.note())) {
                line.append("，").append(role.note());
            }
            roleLines.add(line.toString());
        }

        List<String> paragraphs = new ArrayList<>();
        if (SHOT_EXTREME_CLOSE.equals(shotType)) {
            paragraphs.add("【空间锚点】场景为" + sceneName + "。本镜为特写，画面只表现主体局部，背景为失焦暗部，不表现任何建筑或环境结构。");
        } else {
            List<String> anchors = new ArrayList<>();
            for (Anchor anchor : def.anchors()) {
                if (anchor.key() || anchor.ring() || isReferenced(anchor, def, characterAssetIds)) {
                    anchors.add(anchor.id() + "（" + anchor.name() + "）＝" + anchor.desc());
                }
            }
            if (!anchors.isEmpty()) {
                paragraphs.add("【空间锚点】场景为" + sceneName + "。" + String.join("；", anchors) + "。");
            }
            Camera camera = pickCamera(def, customCameraId, cameraAngle, cameraMovement);
            if (camera != null && StrUtil.isNotBlank(camera.desc())) {
                paragraphs.add("【机位方位】" + camera.id() + "（" + camera.name() + "）＝" + camera.desc() + "。");
            }
        }
        if (!roleLines.isEmpty()) {
            paragraphs.add("【人物站位】" + String.join("；", roleLines) + "。" + CONSTANT_TAIL);
        }
        return paragraphs.isEmpty() ? null : String.join("\n", paragraphs);
    }

    /** 锚点是否被在场角色的默认站位引用 */
    private boolean isReferenced(Anchor anchor, BlockingDef def, List<String> characterAssetIds) {
        for (String assetId : characterAssetIds) {
            Role role = def.roles().get(assetId);
            if (role != null && role.at() != null && role.at().contains(anchor.id())) {
                return true;
            }
        }
        return false;
    }

    /**
     * 机位选取顺序：导演指定的机位锚点 → 运镜为环绕/跟且存在环绕机位 → 机位角度精确匹配
     * → 该场景第一个平视机位 → 该场景第一个机位。
     */
    private Camera pickCamera(BlockingDef def, String customCameraId, String cameraAngle, String cameraMovement) {
        List<Camera> cameras = def.cameras();
        if (cameras.isEmpty()) {
            return null;
        }
        if (StrUtil.isNotBlank(customCameraId)) {
            for (Camera camera : cameras) {
                if (customCameraId.equals(camera.id())) {
                    return camera;
                }
            }
            log.warn("[scene-blocking] 分镜指定的机位锚点不存在，回退自动匹配: cameraAnchorId={}", customCameraId);
        }
        if (MOVE_ARC.equals(cameraMovement) || MOVE_TRACK.equals(cameraMovement)) {
            for (Camera camera : cameras) {
                if (MOVE_ARC.equals(camera.move())) {
                    return camera;
                }
            }
        }
        if (cameraAngle != null) {
            for (Camera camera : cameras) {
                if (cameraAngle.equals(camera.angle())) {
                    return camera;
                }
            }
        }
        for (Camera camera : cameras) {
            if (ANGLE_EYE_LEVEL.equals(camera.angle())) {
                return camera;
            }
        }
        return cameras.get(0);
    }

    // ==================== 解析 ====================

    /**
     * 解析 {@code properties.blocking}。结构缺失或非法时按「未配置」处理并告警，不中断链路。
     */
    private BlockingDef parseBlocking(String propertiesJson) {
        if (StrUtil.isBlank(propertiesJson)) {
            return null;
        }
        try {
            JSONObject blocking = JSONUtil.parseObj(propertiesJson).getJSONObject("blocking");
            if (blocking == null) {
                return null;
            }

            List<Anchor> anchors = new ArrayList<>();
            JSONArray anchorArray = blocking.getJSONArray("anchors");
            if (anchorArray != null) {
                for (int i = 0; i < anchorArray.size(); i++) {
                    JSONObject node = anchorArray.getJSONObject(i);
                    if (node == null || StrUtil.isBlank(node.getStr("id"))) {
                        continue;
                    }
                    anchors.add(new Anchor(
                            node.getStr("id"),
                            node.getStr("name"),
                            Boolean.TRUE.equals(node.getBool("key")),
                            Boolean.TRUE.equals(node.getBool("ring")),
                            node.getStr("desc")));
                }
            }

            List<Camera> cameras = new ArrayList<>();
            JSONArray cameraArray = blocking.getJSONArray("cameras");
            if (cameraArray != null) {
                for (int i = 0; i < cameraArray.size(); i++) {
                    JSONObject node = cameraArray.getJSONObject(i);
                    if (node == null || StrUtil.isBlank(node.getStr("id"))) {
                        continue;
                    }
                    cameras.add(new Camera(
                            node.getStr("id"),
                            node.getStr("name"),
                            node.getStr("angle"),
                            node.getStr("move"),
                            node.getStr("desc")));
                }
            }

            Map<String, Role> roles = new HashMap<>();
            JSONObject roleObject = blocking.getJSONObject("roles");
            if (roleObject != null) {
                for (String assetId : roleObject.keySet()) {
                    JSONObject node = roleObject.getJSONObject(assetId);
                    if (node == null) {
                        continue;
                    }
                    String at = node.getStr("at");
                    String face = node.getStr("face");
                    if (StrUtil.isBlank(at) || StrUtil.isBlank(face)) {
                        log.warn("[scene-blocking] 角色站位缺少 at 或 face，已忽略: assetId={}", assetId);
                        continue;
                    }
                    roles.put(assetId, new Role(at, face, node.getStr("note")));
                }
            }

            if (anchors.isEmpty() && cameras.isEmpty() && roles.isEmpty()) {
                return null;
            }
            return new BlockingDef(anchors, cameras, roles);
        } catch (Exception e) {
            log.warn("[scene-blocking] properties.blocking 解析失败，按未配置处理: {}", e.getMessage());
            return null;
        }
    }

    /** 读取导演逐镜指定的机位锚点 {@code custom_data.cameraAnchorId} */
    private String readCameraAnchorId(String customDataJson) {
        if (StrUtil.isBlank(customDataJson)) {
            return null;
        }
        try {
            return JSONUtil.parseObj(customDataJson).getStr("cameraAnchorId");
        } catch (Exception e) {
            log.warn("[scene-blocking] custom_data 解析失败: {}", e.getMessage());
            return null;
        }
    }

    // ==================== 工具 ====================

    /** 子资产 id → 其所属资产；子资产不存在时返回 null */
    private Asset resolveAssetByItemId(Long assetItemId) {
        if (assetItemId == null) {
            return null;
        }
        try {
            AssetItem assetItem = assetService.getItemById(assetItemId);
            if (assetItem == null || assetItem.getAssetId() == null) {
                return null;
            }
            return assetService.getById(assetItem.getAssetId());
        } catch (Exception e) {
            log.warn("[scene-blocking] 解析子资产所属资产失败: assetItemId={}", assetItemId, e);
            return null;
        }
    }

    private void collectIdArray(Set<Long> target, String jsonArrayStr) {
        target.addAll(idList(jsonArrayStr));
    }

    private List<Long> idList(String jsonArrayStr) {
        List<Long> ids = new ArrayList<>();
        if (StrUtil.isBlank(jsonArrayStr)) {
            return ids;
        }
        try {
            JSONArray array = JSONUtil.parseArray(jsonArrayStr);
            for (int i = 0; i < array.size(); i++) {
                Long id = array.getLong(i);
                if (id != null) {
                    ids.add(id);
                }
            }
        } catch (Exception e) {
            log.warn("[scene-blocking] 解析子资产ID列表失败: {}", jsonArrayStr, e);
        }
        return ids;
    }

    // ==================== 数据结构 ====================

    /** 场景空间锚点定义 */
    public record BlockingDef(List<Anchor> anchors, List<Camera> cameras, Map<String, Role> roles) {
    }

    /** 位置锚点；key 为全场主地标（每镜必带），ring 为环绕物（每镜必带） */
    public record Anchor(String id, String name, boolean key, boolean ring, String desc) {
    }

    /** 机位锚点；angle 为机位角度，move 为环绕/跟等运镜，desc 描述物件在画面中的景位 */
    public record Camera(String id, String name, String angle, String move, String desc) {
    }

    /** 角色默认站位；at 指向锚点 id */
    public record Role(String at, String face, String note) {
    }
}
