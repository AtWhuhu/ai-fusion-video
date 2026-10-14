/**
 * 子资产类型枚举。
 *
 * 库里 `afv_asset_item.item_type` 是自由字符串，各处工具与执行器也在写不同取值。
 * 这里集中登记前端用到的取值与显示名，避免在页面里散落硬编码字符串。
 */

export const ASSET_ITEM_TYPE_LABELS: Record<string, string> = {
  initial: "初始图",
  three_view: "三视图",
  variant: "变体",
  original: "原始",
  front: "正面",
  side: "侧面",
  back: "背面",
  detail: "细节",
  expression: "表情",
  pose: "姿势",
  /** 场景的空间俯视布局图：由锚点数据确定性渲染，非生图模型产出 */
  topdown: "空间俯视图",
};

/**
 * 空间俯视图的子资产类型。
 *
 * 一个场景资产至多一张，重存即覆盖；它不参与「生成资产图」，因为内容是算出来的、
 * 不是画出来的 —— 生图模型每画一次都会不一样，等于把跨镜一致性又交还给运气。
 */
export const SCENE_TOPDOWN_ITEM_TYPE = "topdown";

export const SCENE_TOPDOWN_ITEM_NAME = "空间俯视图";

/** 取显示名，未知类型原样返回 */
export function assetItemTypeLabel(itemType?: string | null): string {
  if (!itemType) return "未分类";
  return ASSET_ITEM_TYPE_LABELS[itemType] ?? itemType;
}
