"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, PackageOpen } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MEDIA_ASSET_STATUS_HINTS,
  MEDIA_ASSET_STATUS_LABELS,
  type MediaAssetItem,
} from "@/lib/api/media-assets";
import { cn } from "@/lib/utils";
import { containerVariants, itemVariants } from "@/app/(dashboard)/settings/_shared";
import {
  STATUS_DOT,
  STATUS_STYLES,
  formatBytes,
  formatDateTime,
  mediaTypeIcon,
  thumbnailUrl,
} from "./media-asset-support";

interface MediaAssetGridProps {
  items: MediaAssetItem[];
  loading: boolean;
  selected: Set<string>;
  onToggleSelect: (key: string) => void;
  onOpenDetail: (item: MediaAssetItem) => void;
}

export function MediaAssetGrid({
  items,
  loading,
  selected,
  onToggleSelect,
  onOpenDetail,
}: MediaAssetGridProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-border/30 bg-card/30 py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/30 bg-card/30 py-16">
        <PackageOpen className="mb-2 h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">没有符合条件的文件</p>
        <p className="mt-1 text-xs text-muted-foreground/60">换个筛选条件或清空搜索词试试</p>
      </div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {items.map((item) => (
        <MediaAssetCard
          key={item.key}
          item={item}
          selected={selected.has(item.key)}
          onToggleSelect={() => onToggleSelect(item.key)}
          onOpenDetail={() => onOpenDetail(item)}
        />
      ))}
    </motion.div>
  );
}

interface MediaAssetCardProps {
  item: MediaAssetItem;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenDetail: () => void;
}

function MediaAssetCard({ item, selected, onToggleSelect, onOpenDetail }: MediaAssetCardProps) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const Icon = mediaTypeIcon(item.mediaType);
  const preview = thumbnailUrl(item.url, item.mediaType);
  const fileName = item.key.split("/").pop() ?? item.key;

  return (
    <motion.div
      variants={itemVariants}
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetail();
        }
      }}
      className={cn(
        "group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card/50 backdrop-blur-sm",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary/50" : "border-border/30 hover:border-border/50"
      )}
    >
      {/* 预览区 */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted/40">
        {preview && !previewFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={fileName}
            loading="lazy"
            onError={() => setPreviewFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Icon className="h-8 w-8 text-muted-foreground/25" />
          </div>
        )}

        <div
          className="absolute left-2 top-2"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            aria-label={`选择 ${fileName}`}
            className="bg-background/80 backdrop-blur-sm"
          />
        </div>

        <span
          className={cn(
            "absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            STATUS_STYLES[item.status]
          )}
          title={MEDIA_ASSET_STATUS_HINTS[item.status]}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[item.status])} />
          {MEDIA_ASSET_STATUS_LABELS[item.status]}
        </span>
      </div>

      {/* 信息区 */}
      <div className="flex flex-col gap-1.5 p-3">
        <p className="truncate text-sm text-foreground" title={item.key}>
          {fileName}
        </p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">{formatBytes(item.size)}</span>
          <span className="tabular-nums">{formatDateTime(item.lastModified)}</span>
        </div>
        {item.projectName && (
          <span className="truncate text-xs text-muted-foreground/80">所属项目：{item.projectName}</span>
        )}
        <span className="truncate text-xs text-muted-foreground/60">
          {item.references.length > 0 ? item.references[0].label : "无引用记录"}
          {item.references.length > 1 && ` 等 ${item.references.length} 处`}
        </span>
      </div>
    </motion.div>
  );
}
