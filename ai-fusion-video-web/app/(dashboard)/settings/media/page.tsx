"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { toastApiError } from "@/lib/api/toast-api-error";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  mediaAssetApi,
  type MediaAssetItem,
  type MediaAssetOverview,
  type MediaAssetStatus,
  type MediaAssetType,
} from "@/lib/api/media-assets";
import { containerVariants, itemVariants, settingsTypography } from "../_shared";
import { MediaAssetsOverview } from "./_components/media-assets-overview";
import { MediaAssetToolbar } from "./_components/media-asset-toolbar";
import { MediaAssetGrid } from "./_components/media-asset-grid";
import { MediaAssetDetailDialog } from "./_components/media-asset-detail-dialog";
import { formatBytes } from "./_components/media-asset-support";

const PAGE_SIZE = 24;

type ScopeFilter = MediaAssetStatus | "all";
type TypeFilter = MediaAssetType | "all";

export default function MediaAssetsPage() {
  const { confirm } = useConfirm();

  const [overview, setOverview] = useState<MediaAssetOverview | null>(null);
  const [items, setItems] = useState<MediaAssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [scope, setScope] = useState<ScopeFilter>("all");
  const [mediaType, setMediaType] = useState<TypeFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [pageNo, setPageNo] = useState(1);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<MediaAssetItem | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await mediaAssetApi.query({
        scope,
        mediaType,
        keyword: debouncedKeyword,
        pageNo,
        pageSize: PAGE_SIZE,
      });
      setOverview(result.overview);
      setItems(result.list);
      setTotal(Number(result.total));
    } catch (error) {
      toastApiError(error, "加载媒体资产失败");
    } finally {
      setLoading(false);
    }
  }, [scope, mediaType, debouncedKeyword, pageNo]);

  useEffect(() => {
    void load();
  }, [load]);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  // 筛选条件变化时回到第一页并清空选择
  useEffect(() => {
    setPageNo(1);
    setSelected(new Set());
  }, [scope, mediaType, debouncedKeyword]);

  const pageKeys = useMemo(() => items.map((item) => item.key), [items]);
  const pageAllSelected = pageKeys.length > 0 && pageKeys.every((key) => selected.has(key));
  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.key)),
    [items, selected]
  );

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelectPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) {
        pageKeys.forEach((key) => next.delete(key));
      } else {
        pageKeys.forEach((key) => next.add(key));
      }
      return next;
    });
  };

  /** 删除指定文件 */
  const deleteByKeys = async (keys: string[]) => {
    const targets = items.filter((item) => keys.includes(item.key));
    const bytes = targets.reduce((sum, item) => sum + item.size, 0);
    const ok = await confirm({
      title: "删除选中的文件",
      description: `将删除 ${keys.length} 个文件（${formatBytes(bytes)}），并同时清理数据库中指向它们的生成记录。此操作不可撤销。`,
      variant: "destructive",
      confirmText: "确认删除",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const result = await mediaAssetApi.remove({ keys });
      if (result.blockedKeys.length > 0) {
        toast.warning(`${result.blockedKeys.length} 个文件正在被使用，已跳过`);
      }
      toast.success(
        `已删除 ${result.deletedCount} 个文件（${formatBytes(result.deletedBytes)}）` +
          (result.removedRecords > 0 ? `，清理 ${result.removedRecords} 条生成记录` : "")
      );
      setSelected(new Set());
      setDetailItem(null);
      await load();
    } catch (error) {
      toastApiError(error, "删除失败");
    } finally {
      setBusy(false);
    }
  };

  /** 批量清空某个状态下的全部文件 */
  const purgeScope = async (target: MediaAssetStatus) => {
    if (!overview) return;
    const count = target === "history" ? overview.historyCount : overview.orphanCount;
    const bytes = target === "history" ? overview.historyBytes : overview.orphanBytes;
    if (count === 0) return;

    const label = target === "history" ? "历史产出" : "无引用";
    const ok = await confirm({
      title: `清理全部${label}文件`,
      description: `将删除 ${count} 个「${label}」文件（${formatBytes(bytes)}），并清理对应的生成记录。使用中的文件不会被删除。此操作不可撤销。`,
      variant: "destructive",
      confirmText: `确认清理 ${count} 个`,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const result = await mediaAssetApi.remove({ scope: target });
      toast.success(
        `已删除 ${result.deletedCount} 个文件（${formatBytes(result.deletedBytes)}）` +
          (result.removedRecords > 0 ? `，清理 ${result.removedRecords} 条生成记录` : "")
      );
      setSelected(new Set());
      await load();
    } catch (error) {
      toastApiError(error, "清理失败");
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("链接已复制");
    } catch {
      toast.error("复制失败，请手动选择复制");
    }
  };

  const reclaimableCount = overview ? overview.historyCount + overview.orphanCount : 0;

  return (
    <motion.div className="w-full" variants={containerVariants} initial="hidden" animate="visible">
      {/* 标题 */}
      <motion.div variants={itemVariants} className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className={settingsTypography.pageTitle}>媒体资产</h1>
          <p className={settingsTypography.pageDescription}>
            查看存储后端中的全部产出文件，标注是否仍被当前项目引用，并清理被替换掉的与历史生成的冗余文件
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || busy}>
          <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          重新扫描
        </Button>
      </motion.div>

      {/* 概览 */}
      <div className="mb-6">
        <MediaAssetsOverview
          overview={overview}
          loading={loading}
          scope={scope}
          onScopeChange={setScope}
        />
      </div>

      {/* 快捷清理 */}
      {reclaimableCount > 0 && (
        <motion.div
          variants={itemVariants}
          className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border/20 bg-background/70 px-4 py-3"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-sm text-foreground">
            发现 {reclaimableCount} 个可回收文件
            <span className="ml-2 text-xs text-muted-foreground">
              历史产出 {overview?.historyCount ?? 0} 个 · 无引用 {overview?.orphanCount ?? 0} 个
            </span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            {(overview?.historyCount ?? 0) > 0 && (
              <Button variant="outline" size="sm" onClick={() => void purgeScope("history")} disabled={busy}>
                清理全部历史产出
              </Button>
            )}
            {(overview?.orphanCount ?? 0) > 0 && (
              <Button variant="outline" size="sm" onClick={() => void purgeScope("orphan")} disabled={busy}>
                清理全部无引用
              </Button>
            )}
          </div>
        </motion.div>
      )}

      {/* 工具栏 */}
      <div className="mb-4">
        <MediaAssetToolbar
          keyword={keyword}
          onKeywordChange={setKeyword}
          mediaType={mediaType}
          onMediaTypeChange={setMediaType}
          selectedCount={selected.size}
          pageItemCount={items.length}
          pageAllSelected={pageAllSelected}
          onToggleSelectPage={toggleSelectPage}
          onClearSelection={() => setSelected(new Set())}
          onDeleteSelected={() => void deleteByKeys(Array.from(selected))}
          busy={busy}
        />
      </div>

      {/* 列表 */}
      <MediaAssetGrid
        items={items}
        loading={loading}
        selected={selected}
        onToggleSelect={toggleSelect}
        onOpenDetail={setDetailItem}
      />

      {/* 分页 */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">
            共 {total} 个文件 · 第 {pageNo} / {totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageNo((prev) => Math.max(1, prev - 1))}
              disabled={pageNo <= 1 || loading}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageNo((prev) => Math.min(totalPages, prev + 1))}
              disabled={pageNo >= totalPages || loading}
            >
              下一页
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* 详情 */}
      <MediaAssetDetailDialog
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onRequestDelete={(item) => void deleteByKeys([item.key])}
        onCopy={(text) => void copyText(text)}
        busy={busy}
      />

      {/* 选中提示（滚动时保持可见） */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border/40 bg-popover/80 px-4 py-2 shadow-xl backdrop-blur-xl">
            <span className="text-sm text-foreground tabular-nums">
              已选 {selected.size} 项
              <span className="ml-2 text-xs text-muted-foreground">
                {formatBytes(selectedItems.reduce((sum, item) => sum + item.size, 0))}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={busy}>
              清空
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void deleteByKeys(Array.from(selected))}
              disabled={busy}
            >
              删除
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
