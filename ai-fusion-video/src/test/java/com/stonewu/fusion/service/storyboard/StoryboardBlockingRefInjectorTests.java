package com.stonewu.fusion.service.storyboard;

import com.stonewu.fusion.entity.ai.AiModel;
import com.stonewu.fusion.entity.storyboard.StoryboardItem;
import com.stonewu.fusion.service.ai.AiModelService;
import com.stonewu.fusion.service.generation.GenerationModelCapabilityService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 场景 3D 布景快照的自动注入。
 *
 * <p>两件事必须同时成立：位置与提示词编号正确；**模型能力允许时才插**——
 * 不支持参考图、图位已满、首尾帧与参考图互斥时硬插，会把生成任务推成校验失败。
 */
class StoryboardBlockingRefInjectorTests {

    private static final String SNAPSHOT = "https://cdn.test/blocking3d/abc.png";
    private static final String CONVERSATION = "conv-1";

    // ---------- 能力桩 ----------

    private static AiModel model(long id, String name) {
        AiModel model = new AiModel();
        model.setId(id);
        model.setName(name);
        return model;
    }

    private static GenerationModelCapabilityService.ImageModelCapability imageCapability(
            boolean supportsReferenceImages, Integer maxReferenceImages) {
        return new GenerationModelCapabilityService.ImageModelCapability(
                supportsReferenceImages, 0, maxReferenceImages, List.of("data_uri"), false, true);
    }

    private static GenerationModelCapabilityService.VideoModelCapability videoCapability(
            boolean supportsReferenceImages, Integer maxReferenceImages, Integer maxImageInputs) {
        return new GenerationModelCapabilityService.VideoModelCapability(
                false, false, supportsReferenceImages, false, false,
                List.of("data_uri"), false, true, 0, maxImageInputs, maxReferenceImages, 0, 0);
    }

    private static AiModelService modelService(
            GenerationModelCapabilityService.ImageModelCapability imageCapability,
            GenerationModelCapabilityService.VideoModelCapability videoCapability) {
        AiModelService aiModelService = mock(AiModelService.class);
        if (imageCapability != null) {
            when(aiModelService.getDefaultByType(2)).thenReturn(model(7L, "测试生图模型"));
        } else {
            when(aiModelService.getDefaultByType(2)).thenReturn(null);
            when(aiModelService.getListByType(2)).thenReturn(List.of());
        }
        if (videoCapability != null) {
            when(aiModelService.getDefaultByType(3)).thenReturn(model(37L, "测试生视频模型"));
        } else {
            when(aiModelService.getDefaultByType(3)).thenReturn(null);
            when(aiModelService.getListByType(3)).thenReturn(List.of());
        }
        return aiModelService;
    }

    private static GenerationModelCapabilityService capabilityService(
            GenerationModelCapabilityService.ImageModelCapability imageCapability,
            GenerationModelCapabilityService.VideoModelCapability videoCapability,
            boolean exclusiveInputModes) {
        GenerationModelCapabilityService capabilityService = mock(GenerationModelCapabilityService.class);
        if (imageCapability != null) {
            when(capabilityService.resolveImageCapability(any())).thenReturn(imageCapability);
        }
        if (videoCapability != null) {
            when(capabilityService.resolveVideoCapability(any())).thenReturn(videoCapability);
            when(capabilityService.hasExclusiveInputModes(any())).thenReturn(exclusiveInputModes);
        }
        return capabilityService;
    }

    /**
     * 造一个已登记快照的注入器。
     *
     * @param itemId              快照所属镜头；null 表示只造壳不登记
     * @param imageCapability     默认生图模型能力，null 表示没配生图模型
     * @param videoCapability     默认生视频模型能力，null 表示没配生视频模型
     * @param exclusiveInputModes 模型是否声明首尾帧与参考图互斥
     */
    private static StoryboardBlockingRefInjector injector(
            Long itemId,
            GenerationModelCapabilityService.ImageModelCapability imageCapability,
            GenerationModelCapabilityService.VideoModelCapability videoCapability,
            boolean exclusiveInputModes) {
        StoryboardService storyboardService = mock(StoryboardService.class);
        if (itemId != null) {
            StoryboardItem item = new StoryboardItem();
            item.setId(itemId);
            item.setCustomData("{\"cameraAnchorId\":\"C4\",\"blocking3dImageUrl\":\"" + SNAPSHOT + "\"}");
            when(storyboardService.getItemById(itemId)).thenReturn(item);
        }
        StoryboardBlockingRefInjector injector = new StoryboardBlockingRefInjector(
                storyboardService,
                modelService(imageCapability, videoCapability),
                capabilityService(imageCapability, videoCapability, exclusiveInputModes));
        if (itemId != null) {
            injector.register(CONVERSATION, List.of(itemId));
        }
        return injector;
    }

    /** 默认场景：生图不限张数，生视频 3 个图位（对应线上默认模型） */
    private static StoryboardBlockingRefInjector injectorWithSnapshot(Long itemId) {
        return injector(itemId, imageCapability(true, null), videoCapability(true, 3, 3), false);
    }

    // ---------- 基础行为 ----------

    @Test
    void imageToolPutsSnapshotFirstAndShiftsPromptNumbering() {
        Map<String, Object> input = Map.of(
                "prompt", "严格参考图片1（柳如烟）的外貌，背景参考图片2（祭骨坛）。",
                "imageUrls", List.of("char.jpg", "scene.jpg"));

        Map<String, Object> applied = injectorWithSnapshot(5L)
                .apply("generate_image", CONVERSATION, input);

        assertEquals(List.of(SNAPSHOT, "char.jpg", "scene.jpg"), applied.get("imageUrls"));
        String prompt = String.valueOf(applied.get("prompt"));
        assertTrue(prompt.startsWith("参考图片1为本镜场景的 3D 布景示意图"), prompt);
        assertTrue(prompt.contains("严格参考图片2（柳如烟）"), prompt);
        assertTrue(prompt.contains("背景参考图片3（祭骨坛）"), prompt);
    }

    /**
     * R2V 首帧提升：模型不支持首帧字段，首帧被放进 {@code referenceImageUrls[0]}，
     * prompt 以「以图片1为起始画面」开头。快照必须紧随首帧之后，编号整体后移。
     */
    @Test
    void videoInsertsAfterPromotedFirstFrameAndShiftsNumbering() {
        Map<String, Object> input = Map.of(
                "prompt", "以图片1为起始画面，人物位置与构图都跟图片1走。参考图片2中的陆天骄形象。",
                "referenceImageUrls", List.of("first.jpg", "char.jpg"));

        Map<String, Object> applied = injectorWithSnapshot(8L)
                .apply("generate_video", CONVERSATION, input);

        assertEquals(List.of("first.jpg", SNAPSHOT, "char.jpg"), applied.get("referenceImageUrls"));
        String prompt = String.valueOf(applied.get("prompt"));
        assertTrue(prompt.startsWith("以图片1为起始画面，人物位置与构图都跟图片1走。"), prompt);
        assertTrue(prompt.contains("参考图片2为本镜场景的 3D 布景示意图"), prompt);
        assertTrue(prompt.contains("参考图片3中的陆天骄形象"), prompt);
    }

    /** I2V：首帧走独立字段且不进参考图列表，快照占据参考图第 1 位 */
    @Test
    void videoWithSeparateFirstFramePutsSnapshotAtFront() {
        Map<String, Object> input = Map.of(
                "prompt", "参考图片1中的陆天骄形象，人物缓缓抬头。",
                "firstFrameImageUrl", "first.jpg",
                "referenceImageUrls", List.of("char.jpg"));

        Map<String, Object> applied = injectorWithSnapshot(8L)
                .apply("generate_video", CONVERSATION, input);

        assertEquals(List.of(SNAPSHOT, "char.jpg"), applied.get("referenceImageUrls"));
        assertEquals("first.jpg", applied.get("firstFrameImageUrl"));
        String prompt = String.valueOf(applied.get("prompt"));
        assertTrue(prompt.startsWith("参考图片1为本镜场景的 3D 布景示意图"), prompt);
        assertTrue(prompt.contains("参考图片2中的陆天骄形象"), prompt);
    }

    @Test
    void snapshotAlreadyPresentIsLeftUntouched() {
        Map<String, Object> input = Map.of(
                "prompt", "仅参考图片1的空间布局与透视。",
                "imageUrls", List.of(SNAPSHOT, "char.jpg"));

        assertSame(input, injectorWithSnapshot(3L).apply("generate_image", CONVERSATION, input));
    }

    @Test
    void unrelatedToolAndUnknownConversationAreLeftUntouched() {
        StoryboardBlockingRefInjector injector = injectorWithSnapshot(3L);
        Map<String, Object> input = Map.of("prompt", "随便", "imageUrls", List.of("char.jpg"));

        assertSame(input, injector.apply("update_storyboard_item_frame", CONVERSATION, input));
        assertSame(input, injector.apply("generate_image", "other-conversation", input));
    }

    @Test
    void itemWithoutSnapshotRegistersNothing() {
        StoryboardService storyboardService = mock(StoryboardService.class);
        StoryboardItem item = new StoryboardItem();
        item.setId(9L);
        item.setCustomData("{\"cameraAnchorId\":\"C2\"}");
        when(storyboardService.getItemById(9L)).thenReturn(item);
        StoryboardBlockingRefInjector injector = new StoryboardBlockingRefInjector(
                storyboardService,
                modelService(imageCapability(true, null), videoCapability(true, 3, 3)),
                capabilityService(imageCapability(true, null), videoCapability(true, 3, 3), false));

        injector.register(CONVERSATION, List.of(9L));

        Map<String, Object> input = Map.of("prompt", "随手一写", "imageUrls", List.of("char.jpg"));
        assertSame(input, injector.apply("generate_image", CONVERSATION, input));
    }

    // ---------- 模型能力门控 ----------

    @Test
    void skipsWhenModelDoesNotSupportReferenceImages() {
        Map<String, Object> input = Map.of(
                "prompt", "严格参考图片1（柳如烟）。", "imageUrls", List.of("char.jpg"));

        // 生图模型不支持参考图：文生图模型上硬塞参考图会被校验直接拒掉
        StoryboardBlockingRefInjector injector = injector(
                5L, imageCapability(false, null), videoCapability(true, 3, 3), false);

        assertSame(input, injector.apply("generate_image", CONVERSATION, input));
    }

    @Test
    void skipsImageWhenReferenceSlotsAreFull() {
        Map<String, Object> input = Map.of(
                "prompt", "严格参考图片1（柳如烟）。", "imageUrls", List.of("a.jpg", "b.jpg"));

        // 生图模型声明最多 2 张参考图，当前已满
        StoryboardBlockingRefInjector injector = injector(
                5L, imageCapability(true, 2), videoCapability(true, 3, 3), false);

        assertSame(input, injector.apply("generate_image", CONVERSATION, input));
    }

    @Test
    void skipsVideoWhenReferenceSlotsAreFull() {
        Map<String, Object> input = Map.of(
                "prompt", "以图片1为起始画面。参考图片2与图片3的角色。",
                "referenceImageUrls", List.of("first.jpg", "a.jpg", "b.jpg"));

        assertSame(input, injectorWithSnapshot(8L).apply("generate_video", CONVERSATION, input));
    }

    /**
     * 首帧走独立字段时，它照样占一个图位：参考图上限 3、总图位 3，
     * 「首帧 + 2 张参考图」已经到顶，此时不该再塞快照（服务端校验会抛「最多支持 3 张图片输入」）。
     */
    @Test
    void videoRespectsMaxImageInputsIncludingFrames() {
        Map<String, Object> input = Map.of(
                "prompt", "参考图片1中的陆天骄形象与图片2中的道具。",
                "firstFrameImageUrl", "first.jpg",
                "referenceImageUrls", List.of("char.jpg", "prop.jpg"));

        StoryboardBlockingRefInjector injector = injector(
                8L, imageCapability(true, null), videoCapability(true, 3, 3), false);

        assertSame(input, injector.apply("generate_video", CONVERSATION, input));
    }

    @Test
    void videoSkipsWhenFrameModeExcludesReferences() {
        Map<String, Object> input = Map.of(
                "prompt", "参考图片1中的陆天骄形象。",
                "firstFrameImageUrl", "first.jpg",
                "referenceImageUrls", List.of("char.jpg"));

        // 模型声明首尾帧与参考图互斥，且调用里已经用了首帧
        StoryboardBlockingRefInjector injector = injector(
                8L, imageCapability(true, null), videoCapability(true, 3, 3), true);

        assertSame(input, injector.apply("generate_video", CONVERSATION, input));
    }

    @Test
    void skipsWhenNoModelConfigured() {
        Map<String, Object> input = Map.of("prompt", "参考图片1。", "imageUrls", List.of("char.jpg"));

        assertSame(input, injector(5L, null, null, false)
                .apply("generate_image", CONVERSATION, input));
    }

    // ---------- context 解析 ----------

    @Test
    void registersFromPipelineContextToleratingBothKeyShapes() {
        StoryboardService storyboardService = mock(StoryboardService.class);
        StoryboardItem item = new StoryboardItem();
        item.setId(5L);
        item.setCustomData("{\"blocking3dImageUrl\":\"" + SNAPSHOT + "\"}");
        when(storyboardService.getItemById(5L)).thenReturn(item);

        StoryboardBlockingRefInjector injector = new StoryboardBlockingRefInjector(
                storyboardService,
                modelService(imageCapability(true, null), videoCapability(true, 3, 3)),
                capabilityService(imageCapability(true, null), videoCapability(true, 3, 3), false));

        injector.registerFromContext(CONVERSATION, Map.of(
                "selectedStoryboardItemIds", List.of(5),
                "storyboardItemId", 5));

        Map<String, Object> input = Map.of("prompt", "参考图片1。", "imageUrls", List.of("char.jpg"));
        assertEquals(List.of(SNAPSHOT, "char.jpg"),
                injector.apply("generate_image", CONVERSATION, input).get("imageUrls"));
    }

    @Test
    void contextWithoutTargetItemRegistersNothing() {
        StoryboardBlockingRefInjector injector = injectorWithSnapshot(null);

        injector.registerFromContext(CONVERSATION, Map.of("storyboardId", 1L));

        Map<String, Object> input = Map.of("prompt", "参考图片1。", "imageUrls", List.of("char.jpg"));
        assertSame(input, injector.apply("generate_image", CONVERSATION, input));
    }
}
