package com.stonewu.fusion.service.storyboard;

import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONUtil;
import com.stonewu.fusion.entity.ai.AiModel;
import com.stonewu.fusion.entity.storyboard.StoryboardItem;
import com.stonewu.fusion.service.ai.AiModelService;
import com.stonewu.fusion.service.generation.GenerationModelCapabilityService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 场景 3D 布景快照的确定性注入。
 *
 * <p>镜头在 3D 导演台导出过布景快照后，URL 存在 {@code custom_data.blocking3dImageUrl}。
 * 生图／生视频时该快照应当作为参考图参与构图，但「要不要带、放在第几位」此前完全由模型自行决定，
 * 实测漏带率不低（同批四镜只带了两镜）。本类把这件事从「模型自觉」改成「框架保证」：
 *
 * <ol>
 *   <li>Pipeline 起跑时按 {@code selectedStoryboardItemIds} 解析出快照 URL，登记到会话上
 *       （{@link #register(String, Object)}）；子 Agent 与父 Agent 共用 conversationId，
 *       所以子 run 里的工具调用也能取到。</li>
 *   <li>工具执行前，若工具是 {@code generate_image} / {@code generate_video} 且入参里的参考图
 *       没带这段快照，就自动插入，并把提示词里的「图片N」编号整体顺移，保证编号与实际图片顺序一致
 *       （编号错位会让模型把 3D 示意图当成人物参考图，比不带更糟）。</li>
 * </ol>
 *
 * <p>插入位置遵循既定优先级「首帧／风格图 → 场景 3D 快照 → 出场角色 → 场景 → 道具」，
 * 并且**只在目标模型的能力允许时插**：不支持参考图、图位已满、首尾帧与参考图模式互斥时一律不插，
 * 因为硬插只会把生成任务推成 {@code validateVideoTask} 的校验失败。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class StoryboardBlockingRefInjector {

    /** 生图工具的参考图字段 */
    private static final String IMAGE_FIELD = "imageUrls";
    /** 生视频工具的参考图字段 */
    private static final String VIDEO_FIELD = "referenceImageUrls";

    /** pipeline context 里可能携带目标镜头的键名 */
    private static final List<String> CONTEXT_ITEM_KEYS = List.of(
            "selectedStoryboardItemIds", "storyboardItemIds", "storyboardItemId");

    /** 模型类型：图片生成 */
    private static final int MODEL_TYPE_IMAGE = 2;
    /** 模型类型：视频生成 */
    private static final int MODEL_TYPE_VIDEO = 3;

    /** 会话 → 本镜场景 3D 快照 URL（按最近使用淘汰，纯缓存，丢了只是退回模型自觉） */
    private static final int MAX_CONVERSATIONS = 256;

    /** 提示词里的参考图编号，如「图片1」「图片 12」 */
    private static final Pattern IMAGE_REF = Pattern.compile("图片\\s*(\\d{1,2})");

    /** 「以图片1为起始画面」这类引导句：出现即说明参考图第 1 位是首帧（R2V 首帧提升） */
    private static final Pattern PROMOTED_FRAME_CLAUSE = Pattern.compile("^以\\s*图片\\s*1\\s*为");

    private final Map<String, List<String>> byConversation =
            Collections.synchronizedMap(new LinkedHashMap<>(32, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, List<String>> eldest) {
                    return size() > MAX_CONVERSATIONS;
                }
            });

    private final StoryboardService storyboardService;
    private final AiModelService aiModelService;
    private final GenerationModelCapabilityService capabilityService;

    /**
     * 从 pipeline context 里取目标镜头登记。不同 pipeline 用过的键名有
     * {@code selectedStoryboardItemIds}（数组）与 {@code storyboardItemId}（标量），都认。
     */
    public void registerFromContext(String conversationId, Map<String, Object> context) {
        if (context == null || context.isEmpty()) {
            return;
        }
        List<Object> raw = new ArrayList<>();
        for (String key : CONTEXT_ITEM_KEYS) {
            Object value = context.get(key);
            if (value != null) {
                raw.add(value);
            }
        }
        register(conversationId, raw);
    }

    /**
     * 登记会话对应的场景 3D 布景快照。
     *
     * @param conversationId 会话 ID（Pipeline 根 run 与子 run 共用）
     * @param rawItemIds     目标镜头 ID，容忍 List／嵌套 List／字符串／数字
     */
    public void register(String conversationId, Object rawItemIds) {
        if (StrUtil.isBlank(conversationId)) {
            return;
        }
        List<Long> itemIds = toIds(rawItemIds);
        if (itemIds.isEmpty()) {
            return;
        }
        LinkedHashSet<String> snapshots = new LinkedHashSet<>();
        for (Long itemId : itemIds) {
            String url = snapshotUrlOf(itemId);
            if (StrUtil.isNotBlank(url)) {
                snapshots.add(url);
            }
        }
        if (snapshots.isEmpty()) {
            byConversation.remove(conversationId);
            return;
        }
        byConversation.put(conversationId, List.copyOf(snapshots));
        log.info("[BlockingRefs] 会话 {} 登记 {} 张场景 3D 布景快照（镜头 {}）",
                conversationId, snapshots.size(), itemIds);
    }

    /**
     * 按工具名注入快照。不命中的工具原样返回。
     *
     * @return 可直接交给工具执行器的入参（可能与入参同一实例）
     */
    public Map<String, Object> apply(String toolName, String conversationId, Map<String, Object> input) {
        if (input == null || StrUtil.isBlank(conversationId)) {
            return input;
        }
        boolean image = "generate_image".equals(toolName);
        boolean video = "generate_video".equals(toolName);
        if (!image && !video) {
            return input;
        }
        List<String> snapshots = byConversation.get(conversationId);
        if (snapshots == null || snapshots.isEmpty()) {
            return input;
        }

        String field = image ? IMAGE_FIELD : VIDEO_FIELD;
        List<String> current = toStringList(input.get(field));
        List<String> missing = new ArrayList<>();
        for (String url : snapshots) {
            if (!current.contains(url) && !missing.contains(url)) {
                missing.add(url);
            }
        }
        if (missing.isEmpty()) {
            return input;
        }

        // 插不插、插几张，由目标模型的能力说话：不支持参考图、图位已满、
        // 或首尾帧模式与参考图模式互斥时，硬插只会把生成任务推成校验失败。
        Capacity capacity = capacityOf(image, current, input, toolName);
        if (capacity.slots() <= 0) {
            log.info("[BlockingRefs] 跳过注入: tool={}, 模型={}, 原因={}（参考图 {} 张）",
                    toolName, capacity.modelLabel(), capacity.reason(), current.size());
            return input;
        }
        if (missing.size() > capacity.slots()) {
            missing = new ArrayList<>(missing.subList(0, capacity.slots()));
        }

        int insertAt = insertPosition(video, current, input);
        List<String> merged = new ArrayList<>(current);
        merged.addAll(Math.min(insertAt, merged.size()), missing);

        Map<String, Object> patched = new LinkedHashMap<>(input);
        patched.put(field, merged);
        patchPrompt(patched, insertAt, missing.size(), video);

        log.info("[BlockingRefs] 自动注入场景 3D 布景快照: tool={}, 模型={}, 插到第 {} 位, 参考图 {} → {} 张, 该镜 {}",
                toolName, capacity.modelLabel(), insertAt + 1, current.size(), merged.size(),
                StrUtil.maxLength(missing.get(0), 64));
        return patched;
    }

    /** 提示词里的「图片N」按插入张数顺移，并补一句说明快照的参考范围 */
    private void patchPrompt(Map<String, Object> patched, int insertAt, int inserted, boolean video) {
        Object raw = patched.get("prompt");
        if (!(raw instanceof String prompt) || StrUtil.isBlank(prompt)) {
            return;
        }
        String shifted = shiftImageRefs(prompt, insertAt + 1, inserted);
        StringBuilder note = new StringBuilder();
        for (int i = 0; i < inserted; i++) {
            int index = insertAt + 1 + i;
            if (note.length() > 0) {
                note.append(' ');
            }
            note.append("参考图片").append(index)
                    .append("为本镜场景的 3D 布景示意图：仅参考其空间布局与透视，不参考其材质、配色与画风。");
        }
        patched.put("prompt", video ? insertAfterLeadingClause(shifted, note.toString())
                : note + shifted);
    }

    /**
     * 快照插入位置。优先级既定：「首帧／风格图 → 场景 3D 快照 → 出场角色 → 场景 → 道具」。
     *
     * <p>关键区别在于首帧是「走独立字段」还是「提升进参考图」：
     *
     * <ul>
     *   <li>支持首帧的模型（i2v）：首帧走 {@code firstFrameImageUrl}，且按约定**不得**放进
     *       {@code referenceImageUrls}；此时参考图里没有首帧，快照占据第 1 位（优先于风格图与角色图）。</li>
     *   <li>不支持首帧的参考图模型（R2V）：首帧被「提升」为参考图第 1 位，prompt 以
     *       「以图片1为起始画面」开头；快照紧随其后放第 2 位，不能用编号错位的代价换位置。</li>
     * </ul>
     */
    private int insertPosition(boolean video, List<String> current, Map<String, Object> input) {
        if (!video || current.isEmpty()) {
            return 0;
        }
        if (StrUtil.isNotBlank(str(input.get("firstFrameImageUrl")))) {
            // I2V：首帧在独立字段，参考图第 1 位不是首帧
            return 0;
        }
        String prompt = str(input.get("prompt"));
        // R2V 首帧提升：prompt 引导句把图片1 指为起始画面，说明第 1 位就是首帧
        return prompt != null && PROMOTED_FRAME_CLAUSE.matcher(prompt.stripLeading()).find() ? 1 : 0;
    }

    /** 生视频的提示词以「以图片1为起始画面…」开头，所以说明句插在该引导句之后，而不是整个前置 */
    private String insertAfterLeadingClause(String prompt, String note) {
        String trimmed = prompt.stripLeading();
        if (!trimmed.startsWith("以图片")) {
            return note + prompt;
        }
        int mark = prompt.indexOf('。');
        int lineEnd = prompt.indexOf('\n');
        int cut = mark >= 0 ? mark + 1 : (lineEnd >= 0 ? lineEnd : prompt.length());
        if (lineEnd >= 0 && lineEnd < cut) {
            cut = lineEnd;
        }
        return prompt.substring(0, cut) + note + prompt.substring(cut);
    }

    /** 编号 ≥ fromIndex 的「图片N」整体加 delta */
    private String shiftImageRefs(String text, int fromIndex, int delta) {
        Matcher matcher = IMAGE_REF.matcher(text);
        StringBuilder out = new StringBuilder();
        while (matcher.find()) {
            int number;
            try {
                number = Integer.parseInt(matcher.group(1));
            } catch (NumberFormatException ignored) {
                matcher.appendReplacement(out, Matcher.quoteReplacement(matcher.group()));
                continue;
            }
            String replacement = number >= fromIndex
                    ? "图片" + (number + delta)
                    : matcher.group();
            matcher.appendReplacement(out, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    /**
     * 解析目标模型的可插槽位。
     *
     * <p>与 {@code GenerateImageToolExecutor} / {@code GenerateVideoToolExecutor} 取的是同一个模型
     * （各自的默认模型），所以这里算出的上限就是执行时会被校验的上限。
     */
    private Capacity capacityOf(
            boolean image, List<String> current, Map<String, Object> input, String toolName) {
        AiModel model = resolveModel(image ? MODEL_TYPE_IMAGE : MODEL_TYPE_VIDEO);
        if (model == null) {
            return new Capacity(0, "-", "未配置可用的生成模型");
        }
        String label = model.getName() != null ? model.getName() : String.valueOf(model.getId());

        if (image) {
            GenerationModelCapabilityService.ImageModelCapability capability =
                    capabilityService.resolveImageCapability(model);
            if (!capability.supportsReferenceImages()) {
                return new Capacity(0, label, "模型不支持参考图");
            }
            int max = capability.maxReferenceImages() != null
                    ? capability.maxReferenceImages() : Integer.MAX_VALUE;
            return new Capacity(max - current.size(), label, "参考图数量已达模型上限 " + max);
        }

        GenerationModelCapabilityService.VideoModelCapability capability =
                capabilityService.resolveVideoCapability(model);
        if (!capability.supportsReferenceImages()) {
            return new Capacity(0, label, "模型不支持 referenceImageUrls");
        }
        int frameCount = (StrUtil.isNotBlank(str(input.get("firstFrameImageUrl"))) ? 1 : 0)
                + (StrUtil.isNotBlank(str(input.get("lastFrameImageUrl"))) ? 1 : 0);
        if (frameCount > 0 && capabilityService.hasExclusiveInputModes(model)) {
            return new Capacity(0, label, "模型声明首尾帧与参考图模式互斥，已用首尾帧");
        }
        // 两个上限都要看：参考图张数上限，以及「首尾帧 + 参考图」的总图数上限
        int byReference = capability.maxReferenceImages() != null
                ? capability.maxReferenceImages() : Integer.MAX_VALUE;
        int byTotal = capability.maxImageInputs() != null
                ? capability.maxImageInputs() - frameCount : Integer.MAX_VALUE;
        int max = Math.min(byReference, byTotal);
        return new Capacity(max - current.size(), label, "图位已满（上限 " + max + " 张）");
    }

    private AiModel resolveModel(int modelType) {
        try {
            AiModel defaultModel = aiModelService.getDefaultByType(modelType);
            if (defaultModel != null) {
                return defaultModel;
            }
            List<AiModel> models = aiModelService.getListByType(modelType);
            return models == null || models.isEmpty() ? null : models.get(0);
        } catch (Exception cause) {
            log.warn("[BlockingRefs] 解析模型类型 {} 失败: {}", modelType, cause.getMessage());
            return null;
        }
    }

    private String str(Object value) {
        return value == null ? null : String.valueOf(value).trim();
    }

    /** 可插槽位与不插时的原因，用于日志 */
    private record Capacity(int slots, String modelLabel, String reason) {
    }

    private String snapshotUrlOf(Long itemId) {
        try {
            StoryboardItem item = storyboardService.getItemById(itemId);
            String customData = item.getCustomData();
            if (StrUtil.isBlank(customData)) {
                return null;
            }
            return StrUtil.trimToNull(JSONUtil.parseObj(customData).getStr("blocking3dImageUrl"));
        } catch (Exception cause) {
            log.warn("[BlockingRefs] 读取镜头 {} 的 3D 布景快照失败: {}", itemId, cause.getMessage());
            return null;
        }
    }

    private List<Long> toIds(Object raw) {
        List<Long> ids = new ArrayList<>();
        collectIds(raw, ids);
        return ids;
    }

    /** 递归收集 ID：兼容标量、数组、以及「数组套数组」（多个 context 键合并后的形态） */
    private void collectIds(Object raw, List<Long> ids) {
        if (raw == null) {
            return;
        }
        if (raw instanceof Collection<?> collection) {
            collection.forEach(value -> collectIds(value, ids));
            return;
        }
        if (raw instanceof Number number) {
            ids.add(number.longValue());
            return;
        }
        String text = String.valueOf(raw).trim();
        if (text.matches("\\d+")) {
            long id = Long.parseLong(text);
            if (!ids.contains(id)) {
                ids.add(id);
            }
        }
    }

    private List<String> toStringList(Object raw) {
        List<String> urls = new ArrayList<>();
        Collection<?> values = raw instanceof Collection<?> collection
                ? collection
                : raw == null ? List.of() : List.of(raw);
        for (Object value : values) {
            if (value == null) {
                continue;
            }
            String text = String.valueOf(value).trim();
            if (StrUtil.isNotBlank(text)) {
                urls.add(text);
            }
        }
        return urls;
    }

    /** 会话结束后可主动清理；不清理也会被 LRU 淘汰 */
    public void forget(String conversationId) {
        if (Objects.nonNull(conversationId)) {
            byConversation.remove(conversationId);
        }
    }
}
