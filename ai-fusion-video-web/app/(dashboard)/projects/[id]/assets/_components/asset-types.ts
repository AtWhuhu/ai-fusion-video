import { MapPin, Users, Wrench, type LucideIcon } from "lucide-react";
import type { AssetItem } from "@/lib/api/asset";
import { normalizeAssetProperties } from "@/lib/api/asset-properties";

export const ASSET_TYPES: Array<{
  value: string;
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
}> = [
  { value: "character", label: "角色", icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
  { value: "scene", label: "场景", icon: MapPin, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { value: "prop", label: "道具", icon: Wrench, color: "text-amber-500", bg: "bg-amber-500/10" },
];

export function getAssetType(value: string) {
  return ASSET_TYPES.find(item => item.value === value) || ASSET_TYPES[0];
}

export function getAppearance(item: AssetItem | null) {
  if (!item?.properties) return "";
  const properties = normalizeAssetProperties(item.properties);
  const value = properties.appearanceDescription ?? properties.appearance ?? properties.description;
  return typeof value === "string" ? value : "";
}

const APPEARANCE_HINTS: Record<string, string[]> = {
  character: ["体态", "服饰", "发型", "表情", "姿态"],
  scene: ["空间", "时间", "光线", "色调", "陈设"],
  prop: ["形制", "材质", "颜色", "尺寸", "细节"],
};

export function getAppearanceHints(assetType: string) {
  return APPEARANCE_HINTS[assetType] || APPEARANCE_HINTS.prop;
}

/**
 * 读取子资产属性。后端返回对象，历史数据可能是 JSON 文本，统一归一化后再用，
 * 避免把字符串直接展开成 `{"0":"{",...}` 之类的脏数据。
 */
export function parseProperties(properties: unknown) {
  return normalizeAssetProperties(properties);
}
