"use client";

import { useCallback, useEffect, useState } from "react";
import { FileVideo2, Images, Loader2, Music2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SafeImage } from "@/components/ui/safe-image";
import { mediaAssetApi, type MediaAssetItem } from "@/lib/api/media-assets";
import { getApiErrorMessage } from "@/lib/api/api-error";
import { toast } from "sonner";
import { resolveMediaUrl } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 40;

const MEDIA_TYPE_LABELS = {
  image: "图片",
  video: "视频",
  audio: "音频",
} as const;

interface GenerationStoragePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 要浏览的媒体类型 */
  mediaType: "image" | "video" | "audio";
  title?: string;
  description?: string;
  /** 选中后回调（返回文件 URL），调用方负责关闭弹窗 */
  onSelect: (url: string) => void;
}

/**
 * 从存储库（对象存储桶）选择媒体文件的通用弹窗。
 * 数据来自 /api/system/media-assets/query，与设置页「存储」卡片同源。
 */
export function GenerationStoragePickerDialog({
  open,
  onOpenChange,
  mediaType,
  title = "从存储库选择",
  description = "点击文件即可选用",
  onSelect,
}: GenerationStoragePickerDialogProps) {
  const [items, setItems] = useState<MediaAssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      const loadingSetter = append ? setLoadingMore : setLoading;
      loadingSetter(true);
      try {
        const result = await mediaAssetApi.query({
          mediaType,
          scope: "all",
          keyword: keyword.trim() || undefined,
          pageNo: page,
          pageSize: PAGE_SIZE,
        });
        setTotal(result.total);
        setItems((prev) =>
          append ? [...prev, ...result.list] : result.list
        );
      } catch (err) {
        console.error("加载存储库文件失败:", err);
        toast.error(getApiErrorMessage(err));
        if (!append) setItems([]);
      } finally {
        loadingSetter(false);
      }
    },
    [keyword, mediaType]
  );

  // 打开或切换媒体类型时重置并加载第一页
  useEffect(() => {
    if (!open) return;
    setItems([]);
    setTotal(0);
    setKeyword("");
    void fetchPage(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mediaType]);

  const hasMore = items.length < total;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-overlay-root
        className="max-w-3xl max-h-[calc(100vh-2rem)] sm:max-h-[80vh] flex flex-col overflow-hidden bg-card/95 backdrop-blur-md rounded-2xl p-0 gap-0"
      >
        <DialogHeader className="px-6 py-5 border-b border-border/30 shrink-0 gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold">
                {title}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {description} · 共 {total} 个{MEDIA_TYPE_LABELS[mediaType]}文件
              </DialogDescription>
            </div>
            <div className="relative w-56 shrink-0">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void fetchPage(1, false);
                  }
                }}
                placeholder="搜索文件名…"
                className="h-8 pl-8 text-xs rounded-lg"
              />
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 p-5">
          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-muted-foreground/30">
              <Images className="h-8 w-8 mb-2" />
              <p className="text-xs">存储库中暂无{MEDIA_TYPE_LABELS[mediaType]}文件</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    title={item.key}
                    onClick={() => {
                      onSelect(item.url);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "group relative aspect-square rounded-lg overflow-hidden",
                      "border border-border/30 bg-muted/20",
                      "cursor-pointer transition-all",
                      "hover:border-primary/50 hover:ring-2 hover:ring-primary/20 hover:shadow-lg"
                    )}
                  >
                    {item.mediaType === "image" ? (
                      <SafeImage
                        src={resolveMediaUrl(item.url) || undefined}
                        alt={item.key}
                        fallbackType="image"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-muted-foreground/50">
                        {item.mediaType === "video" ? (
                          <FileVideo2 className="h-7 w-7" />
                        ) : (
                          <Music2 className="h-7 w-7" />
                        )}
                        <span className="text-[10px] uppercase">
                          {item.extension}
                        </span>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-black/55 backdrop-blur-sm">
                      <p className="text-[10px] text-white/90 truncate">
                        {item.projectName || "未归属项目"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              {hasMore && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingMore}
                    onClick={() => void fetchPage(items.length / PAGE_SIZE + 1, true)}
                  >
                    {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    加载更多（{items.length}/{total}）
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
