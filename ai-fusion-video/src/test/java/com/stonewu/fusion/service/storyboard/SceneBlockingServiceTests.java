package com.stonewu.fusion.service.storyboard;

import com.stonewu.fusion.entity.asset.Asset;
import com.stonewu.fusion.entity.asset.AssetItem;
import com.stonewu.fusion.entity.storyboard.StoryboardItem;
import com.stonewu.fusion.service.asset.AssetService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 场景空间锚点组装器的规则测试：机位选取、景别门控、锚点选取三条分支。
 * <p>
 * 服务是无状态纯函数组装器，只依赖 {@link AssetService} 的两处读取，故用 Mockito 打桩即可覆盖，
 * 不需要起 Spring 容器。
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
        assertThat(item.getSpatialBlock()).contains("中央刑柱").doesNotContain("【人物站位】");
    }

    // ==================== 锚点选取 ====================

    @Test
    void alwaysIncludesKeyAndRingAnchorsButSkipsPlainOnes() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        StoryboardItem item = item(SCENE_ITEM_ID, "[]", null, "平视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock())
                .contains("P1（中央刑柱）＝画面正中偏上")
                .contains("T1（火把环）＝环绕刑柱脚下的火光")
                .doesNotContain("偏殿角");
    }

    @Test
    void includesPlainAnchorWhenReferencedByRolePosition() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛",
                blocking(ANCHORS, CAMERAS, "{\"" + HERO_ASSET_ID + "\":{\"at\":\"P9\",\"face\":\"面朝北\"}}"));
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).contains("偏殿角");
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

        assertThat(item.getSpatialBlock()).contains("C2（坛下仰拍）");
    }

    @Test
    void fallsBackToAngleMatchWhenOverrideIsUnknown() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        StoryboardItem item = item(SCENE_ITEM_ID, "[]", "{\"cameraAnchorId\":\"C9\"}", "仰视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).contains("C2（坛下仰拍）");
    }

    @Test
    void prefersArcCameraWhenMovementIsArcOrTrack() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        StoryboardItem arc = item(SCENE_ITEM_ID, "[]", null, "平视", "环绕", "近景");
        StoryboardItem track = item(SCENE_ITEM_ID, "[]", null, "平视", "跟", "近景");

        service.fillSpatialContext(list(arc, track));

        assertThat(arc.getSpatialBlock()).contains("C3（环绕）");
        assertThat(track.getSpatialBlock()).contains("C3（环绕）");
    }

    @Test
    void fallsBackToFirstEyeLevelCameraWhenAngleUnknown() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        StoryboardItem item = item(SCENE_ITEM_ID, "[]", null, "荷兰角", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).contains("C1（坛沿平视）");
    }

    @Test
    void fallsBackToFirstCameraWhenNoEyeLevelExists() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS,
                "[{\"id\":\"C2\",\"name\":\"坛下仰拍\",\"angle\":\"仰视\",\"desc\":\"刑柱自底部升起\"}]", ROLES));
        StoryboardItem item = item(SCENE_ITEM_ID, "[]", null, "荷兰角", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).contains("C2（坛下仰拍）");
    }

    // ==================== 景别门控 ====================

    @Test
    void extremeCloseUpOmitsEnvironmentStructureAndCamera() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "特写");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock())
                .contains("本镜为特写")
                .contains("不表现任何建筑或环境结构")
                .doesNotContain("【机位方位】")
                .doesNotContain("中央刑柱");
        // 特写仍锁人物站位
        assertThat(item.getSpatialBlock()).contains("沈砚：位于P1");
    }

    // ==================== 人物站位 ====================

    @Test
    void rendersRolePositionWithConstantTail() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock())
                .contains("【人物站位】沈砚：位于P1，面朝南，被缚于柱上。")
                .contains("全程恒定，不得随镜头改变");
    }

    @Test
    void ignoresRoleMissingAtOrFace() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛",
                blocking(ANCHORS, CAMERAS, "{\"" + HERO_ASSET_ID + "\":{\"at\":\"\",\"face\":\"\"}}"));
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "近景");

        service.fillSpatialContext(list(item));

        assertThat(item.getSpatialBlock()).doesNotContain("【人物站位】");
    }

    // ==================== 单条入口 ====================

    @Test
    void resolveSpatialBlockFillsSingleItem() {
        stubScene(SCENE_ITEM_ID, SCENE_ASSET_ID, "祭骨坛", blocking(ANCHORS, CAMERAS, ROLES));
        stubCharacter(HERO_ITEM_ID, HERO_ASSET_ID, "沈砚");
        StoryboardItem item = item(SCENE_ITEM_ID, "[" + HERO_ITEM_ID + "]", null, "平视", null, "近景");

        String text = service.resolveSpatialBlock(item);

        assertThat(text).isEqualTo(item.getSpatialBlock());
        assertThat(text).contains("祭骨坛").contains("沈砚：位于P1");
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
}
