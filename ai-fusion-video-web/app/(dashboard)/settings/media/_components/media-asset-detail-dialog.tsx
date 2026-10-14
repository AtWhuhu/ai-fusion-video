"use client";

import { Copy, ExternalLink, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  MEDIA_ASSET_STATUS_HINTS,
  MEDIA_ASSET_STATUS_LABELS,
  MEDIA_ASSET_TYPE_LABELS,
  type MediaAssetItem,
} from "@/lib/api/media-assets";
import { cn } from "@/lib/utils";
import { STATUS_DOT, STATUS_STYLES, formatBytes, formatDateTime, mediaTypeIcon } from "./media-asset-support";

interface MediaAssetDetailDialogProps {
  item: MediaAssetItem | null;
  onClose: () => void;
  onRequestDelete: (item: MediaAssetItem) => void;
  onCopy: (text: string) => void;
  busy: boolean;
}

export function MediaAssetDetailDialog({
  item,
  onClose,
  onRequestDelete,
  onCopy,
  busy,
}: MediaAssetDetailDialogProps) {
  const Icon = item ? mediaTypeIcon(item.mediaType) : null;

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            文件详情
          </DialogTitle>
          <DialogDescription className="break-all">{item?.key}</DialogDescription>
        </DialogHeader>

        {item && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
            {/* 状态 */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                  STATUS_STYLES[item.status]
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[item.status])} />
                {MEDIA_ASSET_STATUS_LABELS[item.status]}
              </span>
              <span className="text-xs text-muted-foreground">{MEDIA_ASSET_STATUS_HINTS[item.status]}</span>
            </div>

            {/* 元信息 */}
            <div className="rounded-lg border border-border/20 bg-background/70 p-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                <Field label="类型" value={MEDIA_ASSET_TYPE_LABELS[item.mediaType] ?? item.mediaType} />
                <Field label="格式" value={item.extension.toUpperCase() || "—"} />
                <Field label="大小" value={formatBytes(item.size)} />
                <Field label="产出时间" value={formatDateTime(item.lastModified)} />
                <Field label="所属项目" value={item.projectName ?? "—"} />
                <Field label="引用条数" value={String(item.references.length)} />
              </dl>

              <div className="mt-4 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border/20 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                  {item.url}
                </code>
                <Button variant="ghost" size="icon-sm" onClick={() => onCopy(item.url)} title="复制链接">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="在新标签页打开"
                  onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* 引用来源 */}
            <div>
              <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                引用来源（{item.references.length}）
              </h4>
              {item.references.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/30 bg-card/30 px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">没有任何数据库记录引用这个文件</p>
                  <p className="mt-1 text-xs text-muted-foreground/60">删除不会影响任何页面展示</p>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {item.references.map((reference, index) => (
                    <li
                      key={`${reference.table}-${reference.column}-${reference.recordId}-${index}`}
                      className="rounded-lg border border-border/20 bg-background/70 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            reference.active ? "bg-emerald-500" : "bg-muted-foreground/40"
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {reference.label}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-xs",
                            reference.active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                          )}
                        >
                          {reference.active ? "使用中" : "历史"}
                        </span>
                      </div>
                      <p className="mt-0.5 pl-3.5 text-xs text-muted-foreground/70">
                        {reference.table}.{reference.column}
                        {reference.recordId != null && ` · #${reference.recordId}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            关闭
          </Button>
          {item && item.deletable && (
            <Button variant="destructive" onClick={() => onRequestDelete(item)} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5" />
              删除此文件
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
