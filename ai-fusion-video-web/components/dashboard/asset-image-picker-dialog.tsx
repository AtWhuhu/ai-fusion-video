"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Images, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SafeImage } from "@/components/ui/safe-image";
import { assetApi } from "@/lib/api/asset";
import { getApiErrorMessage } from "@/lib/api/api-error";
import { resolveMediaUrl } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface PickableImage {
  key: string;
  /** 选中后返回的原图 URL */
  url: string;
  /** 网格展示用的缩略图 URL */
  displayUrl: string;
  name: string;
  assetName: string;
}

interface AssetImagePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 项目 ID，用于拉取该项目的资产 */
  projectId: number;
  title?: string;
  description?: string;
  /** 选中图片后回调（返回原图 URL），调用方负责关闭弹窗 */
  onSelect: (url: string) => void;
}

/**
 * 从项目资产库选择图片的通用弹窗。
 * 网格展示缩略图，点击后返回原图 URL。
 */
export function AssetImagePickerDialog({
  open,
  onOpenChange,
  projectId,
  title = "从资产库选择图片",
  description = "点击图片即可选用",
  onSelect,
}: AssetImagePickerDialogProps) {
  const [images, setImages] = useState<PickableImage[]>([]);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const loading = open && projectId > 0 && loadedFor !== projectId;

  useEffect(() => {
    if (!open || projectId <= 0 || loadedFor === projectId) return;
    let cancelled = false;
    assetApi
      .listWithItems(projectId)
      .then((assets) => {
        if (cancelled) return;
        const list: PickableImage[] = [];
        for (const asset of assets) {
          for (const item of asset.items ?? []) {
            const url = item.imageUrl || item.thumbnailUrl;
            if (!url) continue;
            list.push({
              key: `${asset.id}-${item.id}`,
              url,
              displayUrl: item.thumbnailUrl || item.imageUrl || "",
              name: item.name || asset.name,
              assetName: asset.name,
            });
          }
        }
        setImages(list);
        setLoadedFor(projectId);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("加载资产图片失败:", err);
        toast.error(getApiErrorMessage(err));
        setImages([]);
        setLoadedFor(projectId);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, loadedFor]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // 层级契约：body 门户默认 z-50，DOM 顺序晚于分镜编辑弹窗（同为 z-50），自然盖在其上。
        data-overlay-root
        className="max-w-3xl max-h-[calc(100vh-2rem)] sm:max-h-[80vh] flex flex-col overflow-hidden bg-card/95 backdrop-blur-md rounded-2xl p-0 gap-0"
      >
        <DialogHeader className="px-6 py-5 border-b border-border/30 shrink-0">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-xs">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0 p-5">
          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
            </div>
          ) : images.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-muted-foreground/30">
              <Images className="h-8 w-8 mb-2" />
              <p className="text-xs">项目资产库中暂无图片</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {images.map((img) => (
                <button
                  key={img.key}
                  type="button"
                  title={img.name}
                  onClick={() => {
                    onSelect(img.url);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "group relative aspect-square rounded-lg overflow-hidden",
                    "border border-border/30 bg-muted/20",
                    "cursor-pointer transition-all",
                    "hover:border-primary/50 hover:ring-2 hover:ring-primary/20 hover:shadow-lg"
                  )}
                >
                  <SafeImage
                    src={resolveMediaUrl(img.displayUrl) || undefined}
                    alt={img.name}
                    fallbackType="image"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-black/55 backdrop-blur-sm">
                    <p className="text-[10px] text-white/90 truncate">
                      {img.assetName}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
