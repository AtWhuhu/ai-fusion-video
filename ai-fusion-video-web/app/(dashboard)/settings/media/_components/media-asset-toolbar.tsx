"use client";

import { Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MEDIA_ASSET_TYPE_LABELS, type MediaAssetType } from "@/lib/api/media-assets";

type TypeFilter = MediaAssetType | "all";

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "image", label: MEDIA_ASSET_TYPE_LABELS.image },
  { value: "video", label: MEDIA_ASSET_TYPE_LABELS.video },
  { value: "audio", label: MEDIA_ASSET_TYPE_LABELS.audio },
];

interface MediaAssetToolbarProps {
  keyword: string;
  onKeywordChange: (value: string) => void;
  mediaType: TypeFilter;
  onMediaTypeChange: (value: TypeFilter) => void;
  selectedCount: number;
  pageItemCount: number;
  pageAllSelected: boolean;
  onToggleSelectPage: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  busy: boolean;
}

export function MediaAssetToolbar({
  keyword,
  onKeywordChange,
  mediaType,
  onMediaTypeChange,
  selectedCount,
  pageItemCount,
  pageAllSelected,
  onToggleSelectPage,
  onClearSelection,
  onDeleteSelected,
  busy,
}: MediaAssetToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder="按文件名搜索"
          className="h-9 pl-8 text-sm"
        />
      </div>

      <Select
        value={mediaType}
        onValueChange={(next) => onMediaTypeChange(String(next) as TypeFilter)}
        items={TYPE_OPTIONS}
      >
        <SelectTrigger className="h-9 w-[130px] text-sm">
          <SelectValue placeholder="全部类型" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {pageItemCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onToggleSelectPage} disabled={busy}>
          {pageAllSelected ? "取消本页全选" : "选中本页"}
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        {selectedCount > 0 && (
          <>
            <span className="text-xs text-muted-foreground tabular-nums">已选 {selectedCount} 项</span>
            <Button variant="ghost" size="sm" onClick={onClearSelection} disabled={busy}>
              <X className="h-3.5 w-3.5" />
              清空
            </Button>
          </>
        )}
        <Button
          variant="destructive"
          size="sm"
          onClick={onDeleteSelected}
          disabled={selectedCount === 0 || busy}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除选中
        </Button>
      </div>
    </div>
  );
}
