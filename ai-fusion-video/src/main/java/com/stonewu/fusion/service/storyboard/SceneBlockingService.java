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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 场景空间锚点组装器
 * <p>
 * 融光没有站位结构化字段，人物与场景结构的相对位置只能靠提示词表达。本类把「场景空间锚点表 +
 * 机位方位 + 人物站位」确定性拼成一段**画面语言散文**（{@link StoryboardItem#getSpatialBlock()}），
 * 使同一场景内所有镜头的人物站位与关键物件景位可复现。
 * <p>
 * 产出形态由主人定死：**只给模型纯画面语言，不得出现 P1／T1 这类代号，也不得分节贴标签**。
 * 锚点表里的世界方位（正北、西南）与绝对尺寸（一尺、丈二）对模型无效，必须先经
 * {@link SceneBlockingProjector} 按机位投影成画面方位再落笔。目标形态：
 * <pre>
 * 正上方垂直俯拍，一座巨大的圆形石质祭坛占满画面。画面正中央偏上一根丈二高的石柱垂直立于
 * 坛面，柱身缠骨环与铁链；这是全画面唯一的一根立柱，四周再无其他石柱。中央刑柱的正下方紧贴
 * 柱身，一名黑衣少年背靠石柱、面朝画面下方，双臂被两条铁链向左右拉直、锁死在柱身上。
 * </pre>
 * <p>
 * 数据契约见 dev-docs/2-in-progress/20261012-场景空间锚点与人物站位/development-plan.md：
 * 锚点、机位、默认站位存放在场景资产的 {@code properties.blocking}；导演逐镜指定的机位锚点存放在
 * 分镜条目的 {@code custom_data.cameraAnchorId}。未配置 blocking 的场景不注入、不报错。
 * <p>
 * 本类是空间约束的唯一来源：build/to-fusion.mjs 里的 JS 版锚点拼装已废弃（旧数据残留由
 * {@link #stripBakedAnchors(String)} 在消费端剥离），规则不再双实现。
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

    /** 机位未标注俯仰时的默认假设：平视 */
    private static final String PITCH_DEFAULT = "flat";

    /** 站位里的锚点编号，如「P2（柱南面）」中的 P2 */
    private static final Pattern ANCHOR_ID = Pattern.compile("([PT]\\d+)");

    /** 纯距离补语（「约三步」「半丈」），不含介词也不带「内／旁」这类方位限制 */
    private static final Pattern BARE_DISTANCE =
            Pattern.compile("^(约|不足|不到)?[0-9一二三四五六七八九十百千万两半]+(尺|丈|步|寸|米|里)$");

    /** 站位的恒定声明：逐镜都必须重申，否则模型会在不同镜头间自由移动主体 */
    private static final String CONSTANT_TAIL = "本场景内主地标的位置与在场人物的站位全程不变，不得随镜头改变。";

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
     * 拼装画面语言散文。返回 null 表示该镜无可注入内容。
     * <p>
     * 叙事顺序固定：机位与场景 → 主地标 → 在场人物 → 环绕物 → 其他固定结构 → 恒定约束。
     * 先立地标，再让人物贴上去，最后铺环境；不出现任何编号与标签。
     */
    private String buildText(String sceneName, BlockingDef def, List<String> characterAssetIds,
            Map<String, String> characterNameByAssetId, String customCameraId,
            String cameraAngle, String cameraMovement, String shotType) {

        boolean extremeClose = SHOT_EXTREME_CLOSE.equals(shotType);

        Camera camera = pickCamera(def, customCameraId, cameraAngle, cameraMovement);
        String pitch = camera == null ? PITCH_DEFAULT : StrUtil.blankToDefault(camera.pitch(), PITCH_DEFAULT);
        Integer yaw = camera == null ? null : SceneBlockingProjector.degreeOf(camera.yaw());

        List<String> sentences = new ArrayList<>();

        if (extremeClose) {
            // 特写只说「画面只有局部」，但仍要锁住人物站位
            sentences.add("本镜为特写，画面只表现主体局部，背景为失焦暗部，不表现任何建筑或环境结构");
        } else {
            // ① 机位与场景：一句话同时交代「从哪拍」与「拍的是什么」
            String opening = StrUtil.blankToDefault(def.opening(),
                    "场景为" + StrUtil.blankToDefault(sceneName, "本场景"));
            String cameraDesc = camera == null ? "" : StrUtil.blankToDefault(camera.desc(), "");
            sentences.add(StrUtil.isBlank(cameraDesc) ? opening : cameraDesc + "，" + opening);

            // ② 主地标：全场唯一轴心，先把它立在画面里
            for (Anchor anchor : def.anchors()) {
                if (anchor.key()) {
                    sentences.add(anchorSentence(anchor, def, pitch, yaw, false));
                }
            }
        }

        // ③ 在场人物：贴着主地标站位，用「主地标的X方」而不是再报一次画面坐标
        for (String assetId : characterAssetIds) {
            Role role = def.roles().get(assetId);
            if (role == null) {
                continue;
            }
            // 特写门控：位置与朝向短语一律留空，只保留人物本身与动作约束
            Anchor at = resolveRolePosition(role, def);
            String sentence = roleSentence(
                    characterNameByAssetId.getOrDefault(assetId, assetId), role,
                    extremeClose ? "" : rolePlace(at, role, def, pitch, yaw),
                    extremeClose ? "" : facePhrase(role, def, pitch, yaw));
            if (StrUtil.isNotBlank(sentence)) {
                sentences.add(sentence);
            }
        }

        if (!extremeClose) {
            // ④ 环绕物：环绕主地标一圈的结构，方位由自身语义决定，不随镜头改变
            for (Anchor anchor : def.anchors()) {
                if (anchor.ring() && StrUtil.isNotBlank(anchor.desc())) {
                    sentences.add(trimPeriod(anchor.desc()));
                }
            }

            // ⑤ 其他固定结构（台阶、来路等），按画面坐标落在画幅上
            for (Anchor anchor : def.anchors()) {
                if (!anchor.key() && !anchor.ring() && anchor.always()) {
                    sentences.add(anchorSentence(anchor, def, pitch, yaw, true));
                }
            }
        }

        if (sentences.isEmpty()) {
            return null;
        }
        sentences.add(CONSTANT_TAIL);
        return joinSentences(sentences);
    }

    /**
     * 主地标／固定结构句：画面坐标 + 形态散文。
     *
     * @param asPredicate 固定结构（台阶、来路）一律用判断句「画面最下方是…」；
     *                    主地标则看形态描述有没有起头的量词 —— 有量词用同位语
     *                    「画面正中央偏上一根丈二高的石柱…」，没量词补「是」，
     *                    否则会拼出「画面深处正中双方对峙的中轴点」这种缺谓语的名词堆
     */
    private String anchorSentence(Anchor anchor, BlockingDef def, String pitch, Integer yaw, boolean asPredicate) {
        String place = placePhrase(anchor, def, pitch, yaw);
        String form = trimPeriod(anchor.desc());
        if (StrUtil.isBlank(place)) {
            return form;
        }
        if (StrUtil.isBlank(form)) {
            return place;
        }
        return place + (asPredicate || !startsWithQuantifier(form) ? "是" : "") + form;
    }

    /** 形态描述是否以量词起头（「一根石柱」「万柄残剑」），决定用同位语还是判断句 */
    private boolean startsWithQuantifier(String form) {
        return "一二三四五六七八九十两几数满成遍半".indexOf(form.charAt(0)) >= 0;
    }

    /** 人物句：画面位置 + 角色称谓 + 动作约束 + 朝向 */
    private String roleSentence(String characterName, Role role, String place, String face) {
        StringBuilder sentence = new StringBuilder();
        if (StrUtil.isNotBlank(place)) {
            sentence.append(place).append("，");
        }
        sentence.append(StrUtil.blankToDefault(role.subject(), characterName));
        String note = trimPeriod(role.note());
        if (StrUtil.isNotBlank(note)) {
            sentence.append(note);
        }
        if (StrUtil.isNotBlank(face)) {
            sentence.append('，').append(face);
        }
        return sentence.toString();
    }

    /** 人物的画面位置短语；锚点没配方位（或用的是老数据）时退回锚点名字，绝不吐代号 */
    private String rolePlace(Anchor at, Role role, BlockingDef def, String pitch, Integer yaw) {
        String place = at == null ? "" : placePhrase(at, def, pitch, yaw);
        if (StrUtil.isBlank(place) && at != null) {
            place = StrUtil.blankToDefault(at.name(), "");
        }
        if (StrUtil.isBlank(place) && StrUtil.isNotBlank(role.at())) {
            place = trimPeriod(role.at());
        }
        return place;
    }

    /**
     * 解析角色实际站位。
     * <p>
     * 站位默认为 {@code at} 所指锚点；若角色自带 {@code bearing}（如「中心偏北三尺」「悬在柱顶上方」），
     * 则以此为基准合成一个匿名锚点，父锚点默认就是 {@code at}。这样数据侧不必为每个人的细微偏移
     * 都造一个锚点。
     */
    private Anchor resolveRolePosition(Role role, BlockingDef def) {
        if (StrUtil.isNotBlank(role.bearing())) {
            return new Anchor("__role__", "__role__", false, false, false,
                    StrUtil.blankToDefault(role.of(), anchorIdOf(role.at())),
                    role.bearing(), role.dist(), role.gap(), "");
        }
        return findAnchor(def, anchorIdOf(role.at()));
    }

    /**
     * 位置短语。锚点带 {@code of} 时以父锚点的名字为参照（「中央刑柱的正下方」），
     * 否则用画面绝对坐标（「画面正中央偏上」）；{@code bearing} 写 C 表示场景轴心。
     * 无 {@code bearing} 时返回空串，退化为纯形态描述。
     */
    private String placePhrase(Anchor anchor, BlockingDef def, String pitch, Integer yaw) {
        String raw = StrUtil.blankToDefault(anchor.bearing(), "");
        String gap = StrUtil.blankToDefault(anchor.gap(), "");
        if ("C".equalsIgnoreCase(raw)) {
            return attachGap(SceneBlockingProjector.centerPhrase(anchor.dist(), pitch), gap);
        }
        Integer bearing = SceneBlockingProjector.degreeOf(raw);
        if (bearing == null) {
            return "";
        }
        int rel = yaw == null ? bearing : SceneBlockingProjector.relative(bearing, yaw);
        Anchor parent = StrUtil.isBlank(anchor.of()) ? null : findAnchor(def, anchor.of());
        if (parent != null) {
            return attachGap(SceneBlockingProjector.relativePhrase(parent.name(), rel, pitch), gap);
        }
        return attachGap(SceneBlockingProjector.framePhrase(rel, anchor.dist(), pitch), gap);
    }

    /**
     * 把距离补语接到位置短语上。
     * <p>
     * 「紧贴着台沿」自带介词、直接相接；「约三步」这类纯距离若也直接贴上去，会拼出
     * 「画面近端前景约三步」这种断句不清的句子，改成顿号加「处」断开。
     */
    private String attachGap(String place, String gap) {
        if (StrUtil.isBlank(gap)) {
            return place;
        }
        if (StrUtil.isBlank(place)) {
            return gap;
        }
        return BARE_DISTANCE.matcher(gap.trim()).matches() ? place + "、" + gap + "处" : place + gap;
    }

    /** 朝向短语：优先指向具名对象，其次按世界方位投影，最后回退锚点表里的原文 */
    private String facePhrase(Role role, BlockingDef def, String pitch, Integer yaw) {
        if (StrUtil.isNotBlank(role.faceTo())) {
            Anchor target = findAnchor(def, anchorIdOf(role.faceTo()));
            if (target != null) {
                return "面朝" + target.name() + "方向";
            }
        }
        Integer bearing = SceneBlockingProjector.degreeOf(role.faceBearing());
        if (bearing != null) {
            int rel = yaw == null ? bearing : SceneBlockingProjector.relative(bearing, yaw);
            return SceneBlockingProjector.facePhrase(rel, pitch);
        }
        return trimPeriod(role.face());
    }

    private Anchor findAnchor(BlockingDef def, String anchorId) {
        if (StrUtil.isBlank(anchorId)) {
            return null;
        }
        for (Anchor anchor : def.anchors()) {
            if (anchorId.equals(anchor.id())) {
                return anchor;
            }
        }
        return null;
    }

    /** 从「P2（柱南面）」这类站位文本里取出锚点编号；取不到返回 null */
    private String anchorIdOf(String text) {
        if (StrUtil.isBlank(text)) {
            return null;
        }
        Matcher matcher = ANCHOR_ID.matcher(text);
        return matcher.find() ? matcher.group(1) : null;
    }

    /** 去掉句尾句号与空白，避免拼接出「。。」 */
    private String trimPeriod(String text) {
        return StrUtil.isBlank(text) ? "" : text.trim().replaceAll("[。\\s]+$", "");
    }

    /** 拼成单段散文：中文句号收尾，句间不加换行（换行在落库/IPC 环节被压平过） */
    private String joinSentences(List<String> sentences) {
        StringBuilder text = new StringBuilder();
        for (String sentence : sentences) {
            String cleaned = trimPeriod(sentence);
            if (StrUtil.isBlank(cleaned)) {
                continue;
            }
            if (text.length() > 0) {
                text.append('。');
            }
            text.append(cleaned);
        }
        return text.length() == 0 ? "" : text.append('。').toString();
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
                            Boolean.TRUE.equals(node.getBool("always")),
                            node.getStr("of"),
                            node.getStr("bearing"),
                            node.getStr("dist"),
                            node.getStr("gap"),
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
                            node.getStr("pitch"),
                            node.getStr("yaw"),
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
                    if (StrUtil.isBlank(at) && StrUtil.isBlank(face)) {
                        log.warn("[scene-blocking] 角色站位缺少 at 与 face，已忽略: assetId={}", assetId);
                        continue;
                    }
                    roles.put(assetId, new Role(
                            StrUtil.blankToDefault(at, ""),
                            StrUtil.blankToDefault(face, ""),
                            node.getStr("faceTo"),
                            node.getStr("faceBearing"),
                            node.getStr("subject"),
                            node.getStr("note"),
                            node.getStr("of"),
                            node.getStr("bearing"),
                            node.getStr("dist"),
                            node.getStr("gap")));
                }
            }

            if (anchors.isEmpty() && cameras.isEmpty() && roles.isEmpty()) {
                return null;
            }
            return new BlockingDef(anchors, cameras, roles, blocking.getStr("opening"));
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

    /** 场景空间锚点定义；opening 为场景开场句，模型读到的第一句环境描述 */
    public record BlockingDef(List<Anchor> anchors, List<Camera> cameras, Map<String, Role> roles, String opening) {
    }

    /**
     * 位置锚点。
     * <p>
     * {@code key} 全场主地标、{@code ring} 环绕物、{@code always} 固定结构（台阶、来路等），三者每镜必带。
     * {@code of} 为父锚点编号：填了就按「父锚点的X方」表述，否则按画面绝对坐标。
     * {@code bearing} 世界八方位（N/NE/E/SE/S/SW/W/NW），写 {@code C} 表示落在场景轴心；
     * {@code dist} 距离档位（touch 贴附／near 近旁／mid 中距／far 场缘）；{@code gap} 量化短语，如「约三尺」。
     * {@code desc} 只写**形态与约束**（材质、尺寸、是否全场唯一），不再承担方位。
     */
    public record Anchor(String id, String name, boolean key, boolean ring, boolean always,
            String of, String bearing, String dist, String gap, String desc) {
    }

    /**
     * 机位锚点。
     * <p>
     * {@code angle} 机位角度（平视／仰视／俯视／鸟瞰）供自动匹配，{@code move} 为环绕／跟等运镜。
     * {@code pitch} 俯仰档位（top 垂直俯拍／high 斜俯／flat 平视／low 仰视／bird 鸟瞰）决定方位投影表；
     * {@code yaw} 相机正对的世界方位（俯拍时即画面上缘对应的世界方位）。
     */
    public record Camera(String id, String name, String angle, String move, String pitch, String yaw, String desc) {
    }

    /**
     * 角色默认站位。
     * <p>
     * {@code at} 指向锚点编号；{@code subject} 角色在画面中的称谓（如「一名黑衣少年」）；
     * {@code note} 动作与约束散文。朝向优先取 {@code faceTo}（具名对象），其次 {@code faceBearing}
     * （世界方位，会按机位投影），都没有时回退 {@code face} 原文。
     * <p>
     * 站位本身默认就是 {@code at} 所指锚点；需要细微偏移时填 {@code bearing}/{@code dist}/{@code gap}
     * （可选 {@code of} 指定父锚点，缺省即 {@code at}），不必为偏移另造锚点。
     */
    public record Role(String at, String face, String faceTo, String faceBearing,
            String subject, String note, String of, String bearing, String dist, String gap) {
    }
}
