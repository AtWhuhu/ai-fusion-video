package com.stonewu.fusion.service.storyboard;

import cn.hutool.core.io.FileUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.stonewu.fusion.entity.asset.Asset;
import com.stonewu.fusion.entity.asset.AssetItem;
import com.stonewu.fusion.entity.storyboard.StoryboardItem;
import com.stonewu.fusion.service.asset.AssetService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 场景空间锚点组装器的规则测试：机位选取、景别门控、站位渲染、代号不泄漏。
 * <p>
 * 服务是无状态纯函数组装器，只依赖 {@link AssetService} 的两处读取，故用 Mockito 打桩即可覆盖，
 * 不需要起 Spring 容器。
 * <p>
 * 产出形态由主人定死：**只给模型纯画面语言，不得出现 P1／T1 这类代号，也不得分节贴标签**，
 * 故本类专设 {@link #neverLeaksAnchorCodesToModel()} 与 {@link #rendersRealSceneTableAsPictureProse()}
 * 两道闸。
 */
@ExtendWith(MockitoExtension.class)
class SceneBlockingServiceTests {

    private static final Long SCENE_ITEM_ID = 71L;
    private static final Long SCENE_ASSET_ID = 7L;
    private static final Long HERO_ITEM_ID = 11L;
    private static final Long HERO_ASSET_ID = 1L;

    /** 标准锚点表：P1 主地标、T1 环绕物、P9 普通锚点（默认不带） */
    private static final String ANCHORS =
            "[{\"id\":\"P1\",\"name\":\"中央刑柱\",\"key\":true,\"desc\":\"画面正中偏上\"},"
                    + "{\"id\":\"T1\",\"name\":\"火把环\",\"ring\":true,\"desc\":\"环绕刑柱脚下的火光\"},"
                    + "{\"id\":\"P9\",\"name\":\"偏殿角\",\"desc\":\"画面左后角\"}]";

    /** 标准机位表：C1 平视、C2 仰视、C3 平视+环绕 */
    private static final String CAMERAS =
            "[{\"id\":\"C1\",\"name\":\"坛沿平视\",\"angle\":\"平视\",\"desc\":\"刑柱居中，人物在画面中轴\"},"
                    + "{\"id\":\"C2\",\"name\":\"坛下仰拍\",\"angle\":\"仰视\",\"desc\":\"刑柱自画面底部升起\"},"
                    + "{\"id\":\"C3\",\"name\":\"环绕\",\"angle\":\"平视\",\"move\":\"环绕\",\"desc\":\"刑柱始终居中\"}]";

    /** 角色默认站位：roles 的键是角色资产 id */
    private static final String ROLES = "{\"" + HERO_ASSET_ID + "\":{\"at\":\"P1\",\"face\":\"面朝南\",\"note\":\"被缚于柱上\"}}";

    @Mock
    private AssetService assetService;

    private SceneBlockingService service;

    @BeforeEach
    void setUp() {
        service = new SceneBlockingService(assetService);
    }

    // ==================== 空值与容错 ====================

    @Test
    void ignoresNullOrEmptyItemList() {
        service.fillSpatialContext(null);
        service.fillSpatialContext(new ArrayList<>());

        verifyNoInteractions(assetService);
    }

    @Test
    void leavesFieldsNullWhenSceneHasNoBlocking() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", "{\"type\":\"scene\"}");
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).isNull();
        assertThat(item.getSceneCameraOptions()).isNull();
    }

    @Test
    void toleratesMalformedPropertiesJson() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", "这不是JSON{{{");
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).isNull();
    }

    @Test
    void toleratesMalformedCharacterIdsAndCustomData() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        StoryboardItem item = item(SCENE_ITEM_ID, "不是数组", "也不是JSON", "平视", null, "近景");

        service.fillSpatialContext(list(item));

        // 场景锚点仍注入，人物站位因解析失败而缺席，整体不抛异常
        assertThat(item.getSpatialBlock()).contains("画面正中偏上").doesNotContain("沈砚");
    }

    // ==================== 锚点选取 ====================

    @Test
    void alwaysIncludesKeyAndRingAnchorsButSkipsPlainOnes() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        StoryboardItem item = item(SCENE_ITEM_ID, "[]", null, "平视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock())
                .contains("画面正中偏上")
                .contains("环绕刑柱脚下的火光")
                .doesNotContain("偏殿角");
    }

    @Test
    void inlinesPlainAnchorNameWhenReferencedByRolePosition() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛",
                blocking(ANCHORS, CAMERAS, "{\"" + HERO_ASSET_ID + "\":{\"at\":\"P9\",\"face\":\"面朝北\"}}"));
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "近景");

        service.fillSpatialContext(list(item));

        // 普通锚点不再单独出句，而是作为人物位置内联进人物句；用的是锚点名字，不是 P9
        assertThat(item.getSpatialBlock()).contains("偏殿角").doesNotContain("P9");
    }

    // ==================== 机位选取 ====================

    @Test
    void exposesCameraOptionsForDropdown() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        StoryboardItem item = item(SCENE_ITEM_ID, "[]", null, "平视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSceneCameraOptions()).hasSize(3);
        assertThat(item.getSceneCameraOptions().get(0)).containsEntry("id", "C1").containsEntry("name", "坛沿平视");
        assertThat(item.getSceneCameraOptions().get(2)).containsEntry("id", "C3");
    }

    @Test
    void prefersDirectorCameraOverrideOverAngleMatch() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        StoryboardItem item = item(SCENE_ITEM_ID, "[]", "{\"cameraAnchorId\":\"C2\"}", "平视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).contains("刑柱自画面底部升起");
    }

    @Test
    void fallsBackToAngleMatchWhenOverrideIsUnknown() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        StoryboardItem item = item(SCENE_ITEM_ID, "[]", "{\"cameraAnchorId\":\"C9\"}", "仰视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).contains("刑柱自画面底部升起");
    }

    @Test
    void prefersArcCameraWhenMovementIsArcOrTrack() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        StoryboardItem arc = item(SCENE_ITEM_ID, "[]", null, "平视", "环绕", "近景");
        StoryboardItem track = item(SCENE_ITEM_ID, "[]", null, "平视", "跟", "近景");

        service.fillSpatialContext(list(arc, track));

        assertThat(arc.getSpatialBlock()).contains("刑柱始终居中");
        assertThat(track.getSpatialBlock()).contains("刑柱始终居中");
    }

    @Test
    void fallsBackToFirstEyeLevelCameraWhenAngleUnknown() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        StoryboardItem item = item(SCENE_ITEM_ID, "[]", null, "荷兰角", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).contains("刑柱居中，人物在画面中轴");
    }

    @Test
    void fallsBackToFirstCameraWhenNoEyeLevelExists() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS,
                "[{\"id\":\"C2\",\"name\":\"坛下仰拍\",\"angle\":\"仰视\",\"desc\":\"刑柱自底部升起\"}]", ROLES));
        StoryboardItem item = item(SCENE_ITEM_ID, "[]", null, "荷兰角", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).contains("刑柱自底部升起");
    }

    // ==================== 景别门控 ====================

    @Test
    void extremeCloseUpOmitsEnvironmentStructureButKeepsRoleLock() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "特写");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock())
                .contains("本镜为特写")
                .contains("不表现任何建筑或环境结构")
                .doesNotContain("中央刑柱")
                .doesNotContain("环绕刑柱脚下的火光");
        // 特写仍锁人物站位，且不给画面坐标（背景不许出现结构）
        assertThat(item.getSpatialBlock()).contains("沈砚").doesNotContain("画面中央");
    }

    // ==================== 人物站位 ====================

    @Test
    void rendersRolePositionWithConstantTail() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock())
                .contains("沈砚被缚于柱上，面朝南")
                .contains("全程不变，不得随镜头改变");
    }

    @Test
    void ignoresRoleMissingAtAndFace() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛",
                blocking(ANCHORS, CAMERAS, "{\"" + HERO_ASSET_ID + "\":{\"at\":\"\",\"face\":\"\"}}"));
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).doesNotContain("沈砚");
    }

    // ==================== 单条入口 ====================

    @Test
    void resolveSpatialBlockFillsSingleItem() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "近景");

        String text = service.resolveSpatialBlock(item);

        assertThat(text).isEqualTo(item.getSpatialBlock());
        assertThat(text).contains("祭骨坛").contains("沈砚");
    }

    // ==================== 代号零泄漏 ====================

    /** 分节标签与锚点代号一律不得出现在给模型的文本里 */
    private static final Pattern ANCHOR_CODE = Pattern.compile("[PT]\\d+");

    @Test
    void neverLeaksAnchorCodesToModel() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", "{\"cameraAnchorId\":\"C2\"}", "平视", null, "近景");

        service.fillSpatialContext(list(item));

        String text = item.getSpatialBlock();
        assertThat(ANCHOR_CODE.matcher(text).find()).as("不得出现 P1／T1 这类代号：%s", text).isFalse();
        assertThat(text).doesNotContain("【").doesNotContain("空间锚点").doesNotContain("＝");
    }

    // ==================== 真实场景表端到端样张 ====================

    /** 《剑骨》真实锚点表与资产对照表（未跟踪目录，缺失时跳过） */
    private static final File ANCHORS_JSON = new File("../outputs/剑骨/build/anchors.json");
    private static final File ASSETS_JSON = new File("../outputs/剑骨/build/assets.json");

    @Test
    void rendersRealSceneTableAsPictureProse() {
        if (!ANCHORS_JSON.isFile() || !ASSETS_JSON.isFile()) {
            return;
        }
        JSONObject table = JSONUtil.parseObj(FileUtil.readUtf8String(ANCHORS_JSON));
        JSONObject assets = JSONUtil.parseObj(FileUtil.readUtf8String(ASSETS_JSON));

        Map<String, JSONObject> sceneMeta = new LinkedHashMap<>();
        for (Object node : assets.getJSONArray("scenes")) {
            JSONObject scene = (JSONObject) node;
            sceneMeta.put(scene.getStr("id"), scene);
        }
        Map<String, JSONObject> charMeta = new LinkedHashMap<>();
        for (Object node : assets.getJSONArray("characters")) {
            JSONObject character = (JSONObject) node;
            charMeta.put(character.getStr("id"), character);
        }

        StringBuilder report = new StringBuilder();
        JSONObject scenes = table.getJSONObject("scenes");
        for (String sceneId : scenes.keySet()) {
            JSONObject scene = scenes.getJSONObject(sceneId);
            JSONObject meta = sceneMeta.get(sceneId);
            if (meta == null) {
                continue;
            }
            List<StoryboardItem> items = stubRealScene(sceneId, scene, meta, charMeta);
            service.fillSpatialContext(items);
            for (StoryboardItem item : items) {
                String text = item.getSpatialBlock();
                String cameraId = JSONUtil.parseObj(item.getCustomData()).getStr("cameraAnchorId");
                report.append("\n### ").append(sceneId).append('/').append(cameraId).append('\n')
                        .append(text).append('\n');
                assertThat(text).as("有场景锚点就必须产出文本").isNotBlank();
                assertThat(ANCHOR_CODE.matcher(text).find())
                        .as("%s/%s 泄漏了锚点代号：%s", sceneId, cameraId, text).isFalse();
                assertThat(text).doesNotContain("【");
            }
        }
        FileUtil.writeString(report.toString(), new File("target/scene-blocking-sample.txt"), StandardCharsets.UTF_8);
    }

    /** 按真实场景表打桩，逐机位造一个分镜条目 */
    private List<StoryboardItem> stubRealScene(String sceneId, JSONObject scene, JSONObject meta,
            Map<String, JSONObject> charMeta) {
        long sceneItemId = meta.getLong("itemId");
        long sceneAssetId = meta.getLong("assetId");
        String sceneName = meta.getStr("name");

        JSONObject roles = new JSONObject();
        JSONArray characterIds = new JSONArray();
        JSONObject blocking = scene.getJSONObject("blocking");
        if (blocking != null) {
            for (String charCode : blocking.keySet()) {
                JSONObject character = charMeta.get(charCode);
                if (character == null) {
                    continue;
                }
                roles.set(String.valueOf(character.getLong("assetId")), blocking.getJSONObject(charCode));
                characterIds.add(character.getLong("itemId"));
                stubCharacter(character.getLong("itemId"), character.getLong("assetId"), character.getStr("name"));
            }
        }

        JSONObject payload = new JSONObject();
        payload.set("opening", scene.getStr("opening"));
        payload.set("anchors", scene.getJSONArray("anchors"));
        payload.set("cameras", scene.getJSONArray("cameras"));
        payload.set("roles", roles);
        JSONObject properties = new JSONObject();
        properties.set("blocking", payload);
        stubScene(sceneItemId, sceneAssetId, sceneName, properties.toString());

        List<StoryboardItem> items = new ArrayList<>();
        for (Object node : scene.getJSONArray("cameras")) {
            String cameraId = ((JSONObject) node).getStr("id");
            items.add(item(sceneItemId, characterIds.toString(),
                    "{\"cameraAnchorId\":\"" + cameraId + "\"}", "平视", null, "中景"));
        }
        return items;
    }

    // ==================== 夹具 ====================

    private static List<StoryboardItem> list(StoryboardItem... items) {
        List<StoryboardItem> result = new ArrayList<>();
        for (StoryboardItem item : items) {
            result.add(item);
        }
        return result;
    }

    private static StoryboardItem item(Long sceneItemId, String characterIds, String customData,
            String cameraAngle, String cameraMovement, String shotType) {
        StoryboardItem item = new StoryboardItem();
        item.setSceneAssetItemId(sceneItemId);
        item.setCharacterIds(characterIds);
        item.setCustomData(customData);
        item.setCameraAngle(cameraAngle);
        item.setCameraMovement(cameraMovement);
        item.setShotType(shotType);
        return item;
    }

    private static String blocking(String anchors, String cameras, String roles) {
        return "{\"blocking\":{\"anchors\":" + anchors + ",\"cameras\":" + cameras + ",\"roles\":" + roles + "}}";
    }

    private void stubScene(Long itemId, Long assetId, String name, String properties) {
        AssetItem sceneItem = new AssetItem();
        sceneItem.setId(itemId);
        sceneItem.setAssetId(assetId);
        when(assetService.getItemById(itemId)).thenReturn(sceneItem);

        Asset sceneAsset = new Asset();
        sceneAsset.setId(assetId);
        sceneAsset.setName(name);
        sceneAsset.setProperties(properties);
        when(assetService.getById(assetId)).thenReturn(sceneAsset);
    }

    private void stubCharacter(Long itemId, Long assetId, String name) {
        AssetItem charItem = new AssetItem();
        charItem.setId(itemId);
        charItem.setAssetId(assetId);
        when(assetService.getItemById(itemId)).thenReturn(charItem);

        Asset charAsset = new Asset();
        charAsset.setId(assetId);
        charAsset.setName(name);
        when(assetService.getById(assetId)).thenReturn(charAsset);
    }

    // ==================== 历史 baked 锚点剥离 ====================

    /** 全角方括号：用码点构造，切勿改回字面量（落盘时会被清洗） */
    private static final String LBR = new String(Character.toChars(0x3010));
    private static final String RBR = new String(Character.toChars(0x3011));
    private static final String BAKED_TAIL = "同一场景内上述锚点位置、机位方位与主体站位全程恒定，不得随镜头改变。";

    @Test
    void stripBakedAnchors_removesAppendedAnchorBlock() {
        String input = "夜晚，祭骨坛，火光摇曳。"
                + LBR + "空间锚点" + RBR + "场景为祭骨坛。P1（中央刑柱）＝画面正中；"
                + LBR + "机位方位" + RBR + "C1（坛沿平视）＝刑柱居中；"
                + LBR + "人物站位" + RBR + "沈砚：位于P1，面朝南。"
                + BAKED_TAIL;
        assertThat(SceneBlockingService.stripBakedAnchors(input)).isEqualTo("夜晚，祭骨坛，火光摇曳。");
    }

    @Test
    void stripBakedAnchors_leavesPureExpectationUntouched() {
        String input = "夜晚，祭骨坛，火光摇曳，氛围肃杀。";
        assertThat(SceneBlockingService.stripBakedAnchors(input)).isEqualTo(input);
    }

    @Test
    void stripBakedAnchors_handlesNullAndBlank() {
        assertThat(SceneBlockingService.stripBakedAnchors(null)).isEmpty();
        assertThat(SceneBlockingService.stripBakedAnchors("   ")).isEmpty();
    }

    @Test
    void stripBakedAnchors_removesSpaceLines() {
        assertThat(SceneBlockingService.stripBakedAnchors("Space: P1 central pillar\n夜晚祭骨坛"))
                .isEqualTo("夜晚祭骨坛");
    }

    @Test
    void stripBakedAnchors_removesStandaloneAnchorBlock() {
        String input = LBR + "空间锚点" + RBR + "场景为祭骨坛。P1（中央刑柱）＝画面正中。";
        assertThat(SceneBlockingService.stripBakedAnchors(input)).isEmpty();
    }
}
