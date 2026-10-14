import {
  FileAudio,
  FileQuestion,
  FileVideo,
  Image as ImageIcon,
} from "lucide-react";
import type { MediaAssetStatus, MediaAssetType } from "@/lib/api/media-assets";

/** 字节数格式化 */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, index);
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/** 时间格式化（本地时区，精确到分钟） */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 状态对应的展示样式（文本 / 背景 / 边框） */
export const STATUS_STYLES: Record<MediaAssetStatus, string> = {
  active: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  history: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30",
  orphan: "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30",
};

/** 状态对应的圆点颜色 */
export const STATUS_DOT: Record<MediaAssetStatus, string> = {
  active: "bg-emerald-500",
  history: "bg-amber-500",
  orphan: "bg-rose-500",
};

const TYPE_ICONS = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
  other: FileQuestion,
} as const;

export function mediaTypeIcon(type: MediaAssetType) {
  return TYPE_ICONS[type] ?? FileQuestion;
}

/** 缩略图地址（仅图片类型返回预览地址） */
export function thumbnailUrl(url: string, mediaType: MediaAssetType): string | null {
  return mediaType === "image" ? url : null;
}
