"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StoryboardItem } from "@/lib/api/storyboard";

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

interface StoryboardCameraAnchorCellProps {
  item: StoryboardItem;
  /** null 表示清除指定、回到自动匹配 */
  onSave: (itemId: number, cameraAnchorId: string | null) => void;
}

/**
 * 分镜表格的「机位锚点」单元格。
 * 选项来自该镜所属场景资产的 properties.blocking.cameras，由服务端随分镜条目一并返回。
 */
export function StoryboardCameraAnchorCell({
  item,
  onSave,
}: StoryboardCameraAnchorCellProps) {
  const options = item.sceneCameraOptions ?? [];
  if (options.length === 0) {
    return (
      <span className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
        未配锚点
      </span>
    );
  }

  const selectItems = [
    { value: CAMERA_ANCHOR_AUTO, label: "自动" },
    ...options.map((option) => ({
      value: option.id,
      label: option.angle ? `${option.id} · ${option.angle}` : option.id,
    })),
  ];

  return (
    <Select
      value={readCameraAnchorId(item.customData) ?? CAMERA_ANCHOR_AUTO}
      onValueChange={(value) => {
        if (value == null) return;
        onSave(item.id, value === CAMERA_ANCHOR_AUTO ? null : String(value));
      }}
      items={selectItems}
    >
      <SelectTrigger
        size="sm"
        className="w-full bg-background/70 text-[11px]"
        aria-label="选择本镜的机位锚点"
      >
        <SelectValue placeholder="自动" />
      </SelectTrigger>
      <SelectContent className="text-[11px]">
        <SelectGroup>
          {selectItems.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-[11px]">
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
