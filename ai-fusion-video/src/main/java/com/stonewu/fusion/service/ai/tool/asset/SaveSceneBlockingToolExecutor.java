package com.stonewu.fusion.service.ai.tool.asset;

import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.stonewu.fusion.common.BusinessException;
import com.stonewu.fusion.entity.asset.Asset;
import com.stonewu.fusion.service.ai.ToolExecutionContext;
import com.stonewu.fusion.service.ai.ToolExecutor;
import com.stonewu.fusion.service.asset.AssetService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 保存场景空间锚点工具（save_scene_blocking）
 * <p>
 * 这是场景锚点表**唯一的模型写入入口**。{@code update_asset} 的 properties 在 schema 上只声明了
 * 字符串值，而 {@code blocking} 是三层嵌套（anchors[]／cameras[]／roles{}），模型按 schema 走根本塞不进来，
 * 所以推断锚点必须走本工具。
 * <p>
 * 与 {@code SceneBlockingService.parseBlocking} 共用同一份契约：字段名、枚举取值、引用关系都按那边的
 * 解析逻辑对齐。这里是**写入侧**的守门人 —— 模型最容易犯的错（方位写「正北」「北」而不是 N、
 * 距离写「近」而不是 near、roles 的键写成角色名而不是资产 id、at 指向不存在的锚点）全部在落库前拦下，
 * 并把所有问题一次性回给模型让它自修，而不是写进去留下一堆静默失效的数据。
 * <p>
 * 写入是浅合并：只替换 {@code properties.blocking} 这一个键，资产上挂的 setting／atmosphere 等不受影响。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SaveSceneBlockingToolExecutor implements ToolExecutor {

    /** 只有场景类资产才承载锚点表 */
    private static final String TYPE_SCENE = "scene";

    /** 角色资产类型：roles 的键必须是本项目的角色资产 id */
    private static final String TYPE_CHARACTER = "character";

    /** 世界八方位 + C（场景轴心）；与后端 SceneBlockingProjector.BEARING_DEGREE 一致 */
    private static final Set<String> BEARINGS = Set.of("N", "NE", "E", "SE", "S", "SW", "W", "NW", "C");

    /** 距离档位：贴附／近旁／中距／场缘 */
    private static final Set<String> DISTS = Set.of("touch", "near", "mid", "far");

    /** 机位俯仰档位；决定投影到哪张方位词表 */
    private static final Set<String> PITCHES = Set.of("top", "high", "flat", "low", "bird");

    /** 锚点编号：P1／T1 形式（P 为位置锚点，T 为流程性节点） */
    private static final Pattern ANCHOR_ID = Pattern.compile("([PT]\\d+)", Pattern.CASE_INSENSITIVE);

    /** 站位文本里的锚点引用，如「P2（柱南面）」——只取编号部分 */
    private static final Pattern ANCHOR_REF = Pattern.compile("[PT]\\d+", Pattern.CASE_INSENSITIVE);

    /** 单次写入的规模上限，防止模型把整本书塞进来 */
    private static final int MAX_ANCHORS = 40;
    private static final int MAX_CAMERAS = 20;

    private final AssetService assetService;

    @Override
    public String getToolName() {
        return "save_scene_blocking";
    }

    @Override
    public String getDisplayName() {
        return "保存场景空间锚点";
    }

    @Override
    public String getToolDescription() {
        return """
                把「场景空间锚点表」写入指定场景资产，供后续按镜生成首尾帧/视频时确定性注入。

                锚点表由三部分组成：
                - anchors：场地结构锚点（主地标/环绕物/台阶来路等固定结构），描述「在哪、长什么样」
                - cameras：该场景可用的机位（从哪拍、朝哪、什么俯仰）
                - roles：在场角色的默认站位（键必须是本项目的**角色资产 id**，不是角色名）

                写入语义：
                - mode=replace（默认）整表替换；mode=merge 只新增 id/键不冲突的条目，保留已有条目
                - 只影响场景资产的 properties.blocking，不动其他属性

                校验：方位/距离/俯仰必须是枚举内的值，锚点编号不得重复，roles 的 at/of/faceTo 必须指向
                本表中已存在的锚点，roles 的键必须是本项目真实存在的角色资产 id。校验不通过时**不会写入**，
                而是把所有问题一次性返回，请按提示修正后重新调用。
                """;
    }

    @Override
    public String getParametersSchema() {
        return """
                {
                  "type": "object",
                  "properties": {
                    "assetId": {
                      "type": "integer",
                      "description": "场景资产ID（必填，必须是 type=scene 的资产）"
                    },
                    "mode": {
                      "type": "string",
                      "enum": ["replace", "merge"],
                      "description": "replace=整表替换（默认）；merge=只补新增条目"
                    },
                    "opening": {
                      "type": "string",
                      "description": "场景开场句：本场景是哪儿、什么天气时辰、整体基调。不写人物与镜头"
                    },
                    "anchors": {
                      "type": "array",
                      "description": "场地结构锚点",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": { "type": "string", "description": "编号，形如 P1 / P2 / T1（P=位置锚点，T=流程节点），不得重复" },
                          "name": { "type": "string", "description": "名称，如 中央刑柱、坛下石阶" },
                          "key": { "type": "boolean", "description": "是否全场主地标（每镜必带，通常全场只有一个）" },
                          "ring": { "type": "boolean", "description": "是否环绕主地标一圈的结构（每镜必带）" },
                          "always": { "type": "boolean", "description": "是否固定结构如台阶/来路（每镜必带）" },
                          "of": { "type": "string", "description": "父锚点编号：填了按「父锚点的X方」表述，留空按画面绝对坐标" },
                          "bearing": {
                            "type": "string",
                            "enum": ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "C"],
                            "description": "世界八方位；C 表示落在场景轴心。注意是英文缩写不是中文"
                          },
                          "dist": {
                            "type": "string",
                            "enum": ["touch", "near", "mid", "far"],
                            "description": "距离档：touch 贴附／near 近旁／mid 中距／far 场缘。非环绕、非轴心锚点建议都写明；缺省时系统按 near 兜底并返回警告"
                          },
                          "gap": { "type": "string", "description": "量化补语，如 约三尺、半丈" },
                          "desc": {
                            "type": "string",
                            "description": "形态与约束：材质、尺寸、是否全场唯一。**只写长什么样，不写方位**（方位由 bearing 承担）"
                          }
                        },
                        "required": ["id", "name"]
                      }
                    },
                    "cameras": {
                      "type": "array",
                      "description": "该场景可用的机位",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": { "type": "string", "description": "机位编号，形如 C1 / C2，不得重复" },
                          "name": { "type": "string", "description": "机位名称，如 坛下仰拍机位" },
                          "angle": {
                            "type": "string",
                            "description": "机位角度，用于按分镜的机位角度自动匹配",
                            "enum": ["平视", "仰视", "俯视", "鸟瞰", "荷兰角"]
                          },
                          "move": { "type": "string", "description": "运镜标记；填「环绕」时该机位会被环绕镜头优先选中" },
                          "pitch": {
                            "type": "string",
                            "enum": ["top", "high", "flat", "low", "bird"],
                            "description": "俯仰档：top 垂直俯拍／high 斜俯／flat 平视／low 仰视／bird 鸟瞰"
                          },
                          "yaw": {
                            "type": "string",
                            "enum": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
                            "description": "相机正对的世界方位；俯拍时即画面上缘对应的方位"
                          },
                          "desc": { "type": "string", "description": "机位说明：位置高度、构图意图" }
                        },
                        "required": ["id", "name"]
                      }
                    },
                    "roles": {
                      "type": "object",
                      "description": "在场角色默认站位；键必须是本项目真实存在的角色资产 id（数字字符串），值为站位定义",
                      "additionalProperties": {
                        "type": "object",
                        "properties": {
                          "at": { "type": "string", "description": "站位锚点编号，如 P2；必须是 anchors 里存在的编号" },
                          "face": { "type": "string", "description": "朝向原文，未结构化时的兜底描述" },
                          "faceTo": { "type": "string", "description": "朝向的具名对象（锚点编号），优先于 faceBearing" },
                          "faceBearing": {
                            "type": "string",
                            "enum": ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "C"],
                            "description": "朝向的世界八方位，会按机位投影成「面朝画面X方」"
                          },
                          "subject": { "type": "string", "description": "角色在画面中的称谓，如 一名黑衣少年" },
                          "note": { "type": "string", "description": "动作与约束散文，如 背贴柱身不得离开" },
                          "of": { "type": "string", "description": "细微偏移时指定的父锚点编号，缺省即 at" },
                          "bearing": {
                            "type": "string",
                            "enum": ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "C"],
                            "description": "偏离锚点时的自由站位方位；不填则等同于站在 at 锚点上"
                          },
                          "dist": {
                            "type": "string",
                            "enum": ["touch", "near", "mid", "far"],
                            "description": "自由站位的距离档"
                          },
                          "gap": { "type": "string", "description": "自由站位的量化补语，如 约三步" }
                        }
                      }
                    }
                  },
                  "required": ["assetId"]
                }
                """;
    }

    @Override
    public String execute(String toolInput, ToolExecutionContext context) {
        try {
            JSONObject params = JSONUtil.parseObj(toolInput);
            Long assetId = params.getLong("assetId");
            if (assetId == null) {
                return error("缺少必要参数: assetId");
            }

            Asset asset;
            try {
                asset = assetService.getById(assetId);
            } catch (BusinessException e) {
                return error("未找到ID为 " + assetId + " 的资产");
            }
            if (!assetService.canAccessAsset(asset, context.getUserId())) {
                return error("未找到ID为 " + assetId + " 的资产或无权访问");
            }
            if (!TYPE_SCENE.equals(asset.getType())) {
                return error("资产 " + assetId + " 的类型是 " + asset.getType()
                        + "，只有场景资产（type=scene）能承载空间锚点表");
            }

            List<String> problems = new ArrayList<>();
            List<String> warnings = new ArrayList<>();

            boolean merge = "merge".equalsIgnoreCase(StrUtil.blankToDefault(params.getStr("mode"), "replace"));

            // ---------- 解析 anchors ----------
            List<JSONObject> anchors = new ArrayList<>();
            Set<String> anchorIds = new LinkedHashSet<>();
            JSONArray anchorArray = params.getJSONArray("anchors");
            if (anchorArray != null) {
                if (anchorArray.size() > MAX_ANCHORS) {
                    return error("anchors 数量 " + anchorArray.size() + " 超过上限 " + MAX_ANCHORS);
                }
                for (int i = 0; i < anchorArray.size(); i++) {
                    JSONObject node = anchorArray.getJSONObject(i);
                    String where = "anchors[" + i + "]";
                    if (node == null) {
                        problems.add(where + " 不是对象");
                        continue;
                    }
                    String id = StrUtil.trimToEmpty(node.getStr("id")).toUpperCase();
                    if (StrUtil.isBlank(id)) {
                        problems.add(where + " 缺少 id");
                        continue;
                    }
                    if (!ANCHOR_ID.matcher(id).matches()) {
                        problems.add(where + " 的 id「" + id + "」不合法，必须是 P1/P2/T1 这种「字母+数字」形式");
                        continue;
                    }
                    if (!anchorIds.add(id)) {
                        problems.add("锚点编号重复：" + id);
                        continue;
                    }
                    checkEnum(problems, where + ".bearing", node.getStr("bearing"), BEARINGS);
                    checkEnum(problems, where + ".dist", node.getStr("dist"), DISTS);
                    JSONObject clean = JSONUtil.createObj()
                            .set("id", id)
                            .set("name", StrUtil.trimToEmpty(node.getStr("name")))
                            .set("desc", StrUtil.trimToEmpty(node.getStr("desc")));
                    setIfTrue(clean, "key", node.getBool("key"));
                    setIfTrue(clean, "ring", node.getBool("ring"));
                    setIfTrue(clean, "always", node.getBool("always"));
                    setIfNotBlank(clean, "of", upperOrNull(node.getStr("of")));
                    setIfNotBlank(clean, "bearing", upperOrNull(node.getStr("bearing")));
                    String dist = StrUtil.trimToNull(node.getStr("dist"));
                    if (dist == null
                            && !Boolean.TRUE.equals(node.getBool("ring"))
                            && !"C".equalsIgnoreCase(StrUtil.trimToEmpty(node.getStr("bearing")))) {
                        // 缺省距离档按 near 兜底写入并警告：硬拒绝反而诱导模型删锚点绕检，
                        // 先保住结构，提示模型下次把 dist 写全
                        dist = "near";
                        warnings.add(where + "（" + id + "）未写 dist，已按 near 处理；"
                                + "下次请为每个非环绕锚点明确写出距离档 touch/near/mid/far");
                    }
                    setIfNotBlank(clean, "dist", dist);
                    setIfNotBlank(clean, "gap", StrUtil.trimToNull(node.getStr("gap")));
                    anchors.add(clean);
                }
            }

            // ---------- 解析 cameras ----------
            List<JSONObject> cameras = new ArrayList<>();
            Set<String> cameraIds = new LinkedHashSet<>();
            JSONArray cameraArray = params.getJSONArray("cameras");
            if (cameraArray != null) {
                if (cameraArray.size() > MAX_CAMERAS) {
                    return error("cameras 数量 " + cameraArray.size() + " 超过上限 " + MAX_CAMERAS);
                }
                for (int i = 0; i < cameraArray.size(); i++) {
                    JSONObject node = cameraArray.getJSONObject(i);
                    String where = "cameras[" + i + "]";
                    if (node == null) {
                        problems.add(where + " 不是对象");
                        continue;
                    }
                    String id = StrUtil.trimToEmpty(node.getStr("id")).toUpperCase();
                    if (StrUtil.isBlank(id)) {
                        problems.add(where + " 缺少 id");
                        continue;
                    }
                    if (!id.startsWith("C") || id.length() < 2) {
                        problems.add(where + " 的 id「" + id + "」不合法，机位编号应为 C1/C2 形式");
                        continue;
                    }
                    if (!cameraIds.add(id)) {
                        problems.add("机位编号重复：" + id);
                        continue;
                    }
                    checkEnum(problems, where + ".pitch", node.getStr("pitch"), PITCHES);
                    // yaw 允许省略（省略即视为平视朝北），但填了就必须合法
                    if (StrUtil.isNotBlank(node.getStr("yaw"))) {
                        checkEnum(problems, where + ".yaw", node.getStr("yaw"), BEARINGS);
                    }
                    JSONObject clean = JSONUtil.createObj()
                            .set("id", id)
                            .set("name", StrUtil.trimToEmpty(node.getStr("name")))
                            .set("angle", StrUtil.trimToEmpty(node.getStr("angle")))
                            .set("desc", StrUtil.trimToEmpty(node.getStr("desc")));
                    setIfNotBlank(clean, "move", StrUtil.trimToNull(node.getStr("move")));
                    // pitch 缺省时按中文 angle 兜底推导：模型偶尔只写 angle，缺了 pitch
                    // 后端投影会退回 flat，仰拍/俯拍机位的方位词表就全错了
                    String pitch = StrUtil.trimToNull(node.getStr("pitch"));
                    if (pitch == null) {
                        pitch = pitchFromAngle(node.getStr("angle"));
                    }
                    setIfNotBlank(clean, "pitch", pitch);
                    setIfNotBlank(clean, "yaw", upperOrNull(node.getStr("yaw")));
                    cameras.add(clean);
                }
            }

            // ---------- 解析 roles ----------
            Map<String, JSONObject> roles = new LinkedHashMap<>();
            JSONObject roleObject = params.getJSONObject("roles");
            Map<String, String> characterNames = null;
            if (roleObject != null && !roleObject.isEmpty()) {
                characterNames = loadCharacterNames(asset.getProjectId());
                for (String key : roleObject.keySet()) {
                    JSONObject node = roleObject.getJSONObject(key);
                    String normalizedKey = StrUtil.trimToEmpty(key);
                    String where = "roles[" + key + "]";
                    if (node == null) {
                        problems.add(where + " 不是对象");
                        continue;
                    }
                    if (!normalizedKey.chars().allMatch(Character::isDigit)) {
                        problems.add(where + " 的键「" + key + "」不是角色资产 id。roles 必须以**数字资产 id**为键，"
                                + "不要用角色名；请先用 list_project_assets 取角色资产 id");
                        continue;
                    }
                    if (characterNames != null && !characterNames.containsKey(normalizedKey)) {
                        problems.add(where + " 指向的角色资产 id " + normalizedKey + " 在本项目中不存在"
                                + (characterNames.isEmpty() ? "" : "；可用角色资产：" + describeCharacters(characterNames)));
                        continue;
                    }
                    String at = StrUtil.trimToNull(node.getStr("at"));
                    String face = StrUtil.trimToNull(node.getStr("face"));
                    if (at == null && face == null) {
                        problems.add(where + " 至少要给 at（站位锚点）或 face（朝向原文），"
                                + "两个都为空时该角色站位会被后端直接忽略");
                        continue;
                    }
                    JSONObject clean = JSONUtil.createObj()
                            .set("at", StrUtil.trimToEmpty(at))
                            .set("face", StrUtil.trimToEmpty(face));
                    setIfNotBlank(clean, "faceTo", upperOrNull(node.getStr("faceTo")));
                    setIfNotBlank(clean, "faceBearing", upperOrNull(node.getStr("faceBearing")));
                    setIfNotBlank(clean, "subject", StrUtil.trimToNull(node.getStr("subject")));
                    setIfNotBlank(clean, "note", StrUtil.trimToNull(node.getStr("note")));
                    setIfNotBlank(clean, "of", upperOrNull(node.getStr("of")));
                    setIfNotBlank(clean, "bearing", upperOrNull(node.getStr("bearing")));
                    setIfNotBlank(clean, "dist", StrUtil.trimToNull(node.getStr("dist")));
                    setIfNotBlank(clean, "gap", StrUtil.trimToNull(node.getStr("gap")));
                    checkEnum(problems, where + ".faceBearing", node.getStr("faceBearing"), BEARINGS);
                    checkEnum(problems, where + ".bearing", node.getStr("bearing"), BEARINGS);
                    checkEnum(problems, where + ".dist", node.getStr("dist"), DISTS);
                    roles.put(normalizedKey, clean);
                }
            }

            // ---------- 交叉校验：锚点引用必须落在本表内 ----------
            for (JSONObject anchor : anchors) {
                String of = anchor.getStr("of");
                if (StrUtil.isNotBlank(of) && !anchorIds.contains(of)) {
                    problems.add("锚点 " + anchor.getStr("id") + " 的 of=" + of + " 在本表 anchors 里不存在");
                }
            }
            for (Map.Entry<String, JSONObject> entry : roles.entrySet()) {
                JSONObject role = entry.getValue();
                for (String field : List.of("at", "of", "faceTo")) {
                    String raw = role.getStr(field);
                    if (StrUtil.isBlank(raw)) {
                        continue;
                    }
                    String referenced = extractAnchorId(raw);
                    if (referenced == null) {
                        if (!"at".equals(field)) {
                            problems.add("角色 " + entry.getKey() + " 的 " + field + "「" + raw + "」里找不到锚点编号");
                        }
                        continue;
                    }
                    if (!anchorIds.contains(referenced)) {
                        problems.add("角色 " + entry.getKey() + " 的 " + field + "=" + referenced
                                + " 在本表 anchors 里不存在");
                    }
                }
            }

            if (!problems.isEmpty()) {
                return JSONUtil.createObj()
                        .set("status", "error")
                        .set("message", "锚点表未通过校验，未写入。请修正后重新调用：")
                        .set("problems", problems)
                        .set("hint", "bearing/dist/pitch 必须用枚举里的英文值，不要写中文；roles 的键用数字资产 id")
                        .toString();
            }

            // ---------- 合并与写入 ----------
            JSONObject blocking;
            if (merge) {
                blocking = readExistingBlocking(asset);
                if (StrUtil.isNotBlank(params.getStr("opening"))) {
                    blocking.set("opening", StrUtil.trimToEmpty(params.getStr("opening")));
                }
                int addedAnchors = mergeAnchorsById(blocking, anchors);
                int addedCameras = mergeCamerasById(blocking, cameras);
                int addedRoles = mergeRolesByKey(blocking, roles);
                if (addedAnchors + addedCameras + addedRoles == 0) {
                    return JSONUtil.createObj()
                            .set("assetId", assetId)
                            .set("mode", "merge")
                            .set("status", "noop")
                            .set("message", "merge 模式只增不改，提交的锚点/机位/角色站位都已存在，"
                                    + "本次什么都没写。如果你的意图是修正或补充已有条目的字段"
                                    + "（如补 dist、pitch），请改用 mode=replace 整表重新提交")
                            .toString();
                }
                writeBlocking(asset, blocking);
                assetService.update(asset);
                return JSONUtil.createObj()
                        .set("assetId", assetId)
                        .set("mode", "merge")
                        .set("addedAnchors", addedAnchors)
                        .set("addedCameras", addedCameras)
                        .set("addedRoles", addedRoles)
                        .set("totalAnchors", blocking.getJSONArray("anchors").size())
                        .set("totalCameras", blocking.getJSONArray("cameras").size())
                        .set("message", "已合并写入场景空间锚点：新增锚点 " + addedAnchors
                                + " 个、机位 " + addedCameras + " 个、角色站位 " + addedRoles + " 条")
                        .toString();
            }

            blocking = JSONUtil.createObj();
            if (StrUtil.isNotBlank(params.getStr("opening"))) {
                blocking.set("opening", StrUtil.trimToEmpty(params.getStr("opening")));
            }
            blocking.set("anchors", anchors);
            blocking.set("cameras", cameras);
            blocking.set("roles", roles);
            writeBlocking(asset, blocking);
            assetService.update(asset);

            return JSONUtil.createObj()
                    .set("assetId", assetId)
                    .set("mode", "replace")
                    .set("anchorCount", anchors.size())
                    .set("cameraCount", cameras.size())
                    .set("roleCount", roles.size())
                    .set("cameraIds", new ArrayList<>(cameraIds))
                    .set("message", "已写入场景空间锚点：锚点 " + anchors.size() + " 个、机位 "
                            + cameras.size() + " 个、角色站位 " + roles.size() + " 条")
                    .set("warnings", warnings)
                    .toString();

        } catch (Exception e) {
            log.error("[save_scene_blocking] 写入失败", e);
            return error("写入失败: " + e.getMessage());
        }
    }

    // ==================== 合并 ====================

    /** 读出现有 blocking；不存在时返回空表 */
    private JSONObject readExistingBlocking(Asset asset) {
        if (StrUtil.isBlank(asset.getProperties())) {
            return JSONUtil.createObj();
        }
        try {
            JSONObject blocking = JSONUtil.parseObj(asset.getProperties()).getJSONObject("blocking");
            return blocking == null ? JSONUtil.createObj() : blocking;
        } catch (Exception e) {
            log.warn("[save_scene_blocking] 现有 properties 解析失败，按空表处理: {}", e.getMessage());
            return JSONUtil.createObj();
        }
    }

    private int mergeAnchorsById(JSONObject blocking, List<JSONObject> anchors) {
        JSONArray existing = ensureArray(blocking, "anchors");
        Set<String> ids = new LinkedHashSet<>();
        for (int i = 0; i < existing.size(); i++) {
            JSONObject node = existing.getJSONObject(i);
            if (node != null && StrUtil.isNotBlank(node.getStr("id"))) {
                ids.add(node.getStr("id").toUpperCase());
            }
        }
        int added = 0;
        for (JSONObject anchor : anchors) {
            if (ids.add(anchor.getStr("id"))) {
                existing.add(anchor);
                added++;
            }
        }
        return added;
    }

    private int mergeCamerasById(JSONObject blocking, List<JSONObject> cameras) {
        JSONArray existing = ensureArray(blocking, "cameras");
        Set<String> ids = new LinkedHashSet<>();
        for (int i = 0; i < existing.size(); i++) {
            JSONObject node = existing.getJSONObject(i);
            if (node != null && StrUtil.isNotBlank(node.getStr("id"))) {
                ids.add(node.getStr("id").toUpperCase());
            }
        }
        int added = 0;
        for (JSONObject camera : cameras) {
            if (ids.add(camera.getStr("id"))) {
                existing.add(camera);
                added++;
            }
        }
        return added;
    }

    private int mergeRolesByKey(JSONObject blocking, Map<String, JSONObject> roles) {
        JSONObject existing = blocking.getJSONObject("roles");
        if (existing == null) {
            existing = JSONUtil.createObj();
            blocking.set("roles", existing);
        }
        int added = 0;
        for (Map.Entry<String, JSONObject> entry : roles.entrySet()) {
            if (!existing.containsKey(entry.getKey())) {
                existing.set(entry.getKey(), entry.getValue());
                added++;
            }
        }
        return added;
    }

    private JSONArray ensureArray(JSONObject blocking, String key) {
        JSONArray array = blocking.getJSONArray(key);
        if (array == null) {
            array = new JSONArray();
            blocking.set(key, array);
        }
        return array;
    }

    /** 只替换 blocking 键，保留资产上其他属性 */
    private void writeBlocking(Asset asset, JSONObject blocking) {
        JSONObject properties = StrUtil.isBlank(asset.getProperties())
                ? JSONUtil.createObj()
                : JSONUtil.parseObj(asset.getProperties());
        properties.set("blocking", blocking);
        asset.setProperties(properties.toString());
    }

    // ==================== 校验工具 ====================

    /**
     * 枚举校验。空值放过（字段可选），非空且不在枚举内才报错 ——
     * 报错文案里带上收到的原值，模型才知道自己写的是「北」还是「N」。
     */
    private void checkEnum(List<String> problems, String where, String value, Set<String> allowed) {
        if (StrUtil.isBlank(value)) {
            return;
        }
        String normalized = value.trim().toUpperCase();
        if (!allowed.contains(normalized)) {
            problems.add(where + " 的值「" + value + "」不在允许范围 " + allowed + " 内");
        }
    }

    private void setIfNotBlank(JSONObject target, String key, String value) {
        if (StrUtil.isNotBlank(value)) {
            target.set(key, value);
        }
    }

    private void setIfTrue(JSONObject target, String key, Boolean value) {
        if (Boolean.TRUE.equals(value)) {
            target.set(key, true);
        }
    }

    private String upperOrNull(String value) {
        return StrUtil.isBlank(value) ? null : value.trim().toUpperCase();
    }

    /**
     * 按中文机位角度推导俯仰档，用于模型漏填 pitch 时兜底。
     *
     * 「俯视」无法区分斜俯与垂直俯拍，取中间档 high；「荷兰角」不改变俯仰语义，归平视。
     */
    private String pitchFromAngle(String angle) {
        if (StrUtil.isBlank(angle)) {
            return null;
        }
        String trimmed = angle.trim();
        if (trimmed.startsWith("鸟瞰")) {
            return "bird";
        }
        if (trimmed.startsWith("俯视")) {
            return "high";
        }
        if (trimmed.startsWith("仰视")) {
            return "low";
        }
        if (trimmed.startsWith("平视") || trimmed.startsWith("荷兰角")) {
            return "flat";
        }
        return null;
    }

    private String extractAnchorId(String text) {
        Matcher matcher = ANCHOR_REF.matcher(text);
        return matcher.find() ? matcher.group().toUpperCase() : null;
    }

    /** 项目内角色资产：id → 名称 */
    private Map<String, String> loadCharacterNames(Long projectId) {
        Map<String, String> names = new LinkedHashMap<>();
        if (projectId == null) {
            return names;
        }
        for (Asset asset : assetService.listByProject(projectId, TYPE_CHARACTER, null)) {
            names.put(String.valueOf(asset.getId()), asset.getName());
        }
        return names;
    }

    private String describeCharacters(Map<String, String> characterNames) {
        StringBuilder text = new StringBuilder();
        for (Map.Entry<String, String> entry : characterNames.entrySet()) {
            if (text.length() > 0) {
                text.append('、');
            }
            text.append(entry.getKey()).append('=').append(entry.getValue());
        }
        return text.toString();
    }

    private String error(String message) {
        return JSONUtil.createObj().set("status", "error").set("message", message).toString();
    }
}
