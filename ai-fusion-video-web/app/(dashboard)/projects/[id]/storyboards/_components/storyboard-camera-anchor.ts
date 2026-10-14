import type { StoryboardItem } from "@/lib/api/storyboard";

/**
 * 机位锚点的取值约定。
 *
 * 机位锚点表存在场景资产 `properties.blocking.cameras`，逐镜的显式指定存在
 * `custom_data.cameraAnchorId`；未指定时由后端按机位角度自动匹配。
 */

/** 表示「按机位角度自动匹配」的哨兵值：Select 不接受空字符串作为选中值 */
export const CAMERA_ANCHOR_AUTO = "__auto__";

/** 从 custom_data 读取导演逐镜指定的机位锚点编号 */
export function readCameraAnchorId(customData: string | null): string | null {
  if (!customData) return null;
  try {
    const parsed = JSON.parse(customData) as { cameraAnchorId?: unknown };
    const value = parsed?.cameraAnchorId;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** 从 custom_data 读取本镜的 3D 布景快照 URL（3D 导演台导出，供视频生成参考） */
export function readBlockingSnapshotUrl(customData: string | null): string | null {
  if (!customData) return null;
  try {
    const parsed = JSON.parse(customData) as { blocking3dImageUrl?: unknown };
    const value = parsed?.blocking3dImageUrl;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** 该镜可选的机位锚点；场景未配锚点表时返回空数组 */
export function cameraAnchorOptions(item: StoryboardItem) {
  return (item.sceneCameraOptions ?? []).map((option) => ({
    value: option.id,
    label: option.name ? `${option.id} · ${option.name}` : option.id,
  }));
}
