/**
 * 分镜字段的枚举词表。
 *
 * 取值口径两个来源：① 库中既有数据（`afv_storyboard_item` 各列的历史取值分布）；
 * ② 生成器／Agent 一直在用的镜头语言词表。
 *
 * 这些列在库里都是字符串，所以下拉只作「推荐值」：当前值不在词表里时仍原样展示并保留手填入口，
 * 不会把历史数据改坏，也不会因为新增一个词就得改代码。
 */

/** 景别 */
export const SHOT_TYPE_OPTIONS = ["远景", "全景", "中全景", "中景", "近景", "特写"];

/** 摄像机角度 */
export const CAMERA_ANGLE_OPTIONS = ["平视", "俯视", "仰视", "鸟瞰", "荷兰角"];

/** 运镜方式 */
export const CAMERA_MOVEMENT_OPTIONS = [
  "固定",
  "推",
  "拉",
  "摇",
  "移",
  "跟",
  "升降",
  "环绕",
  "晃动",
  "甩",
];

/** 摄像设备 */
export const CAMERA_EQUIPMENT_OPTIONS = [
  "固定机位",
  "三脚架",
  "手持",
  "稳定器",
  "滑轨",
  "摇臂",
  "无人机",
  "斯坦尼康",
];

/** 焦距 */
export const FOCAL_LENGTH_OPTIONS = [
  "14mm",
  "24mm",
  "28mm",
  "35mm",
  "50mm",
  "85mm",
  "105mm",
  "135mm",
  "200mm",
];

/** 转场 */
export const TRANSITION_OPTIONS = [
  "硬切",
  "叠化",
  "淡入",
  "淡出",
  "黑场",
  "白场",
  "闪白",
  "划像",
];
