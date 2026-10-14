"use client";

import { motion } from "framer-motion";
import { HardDrive, Loader2 } from "lucide-react";
import {
  MEDIA_ASSET_TYPE_LABELS,
  type MediaAssetOverview,
  type MediaAssetStatus,
} from "@/lib/api/media-assets";
import { cn } from "@/lib/utils";
import { containerVariants, itemVariants, settingsTypography } from "@/app/(dashboard)/settings/_shared";
import { STATUS_DOT, formatBytes } from "./media-asset-support";

type ScopeFilter = MediaAssetStatus | "all";

interface MediaAssetsOverviewProps {
  overview: MediaAssetOverview | null;
  loading: boolean;
  scope: ScopeFilter;
  onScopeChange: (scope: ScopeFilter) => void;
}

const PANEL = "rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm";

export function MediaAssetsOverview({ overview, loading, scope, onScopeChange }: MediaAssetsOverviewProps) {
  const scopes: { key: ScopeFilter; label: string; hint: string; count: number; bytes: number }[] = overview
    ? [
        { key: "all", label: "全部文件", hint: "存储后端中的所有媒体", count: overview.totalObjects, bytes: overview.totalBytes },
        { key: "active", label: "使用中", hint: "仍被分镜 / 资产 / 项目引用", count: overview.activeCount, bytes: overview.activeBytes },
        { key: "history", label: "历史产出", hint: "被替换或历史生成留下", count: overview.historyCount, bytes: overview.historyBytes },
        { key: "orphan", label: "无引用", hint: "没有任何记录引用", count: overview.orphanCount, bytes: overview.orphanBytes },
      ]
    : [];

  const reclaimable = overview ? overview.historyBytes + overview.orphanBytes : 0;

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* 主：存储总览 */}
      <motion.div variants={itemVariants} className={cn(PANEL, "p-5")}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <h3 className={settingsTypography.sectionTitle}>存储总览</h3>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="mt-4 flex items-end gap-3">
          <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
            {overview ? formatBytes(overview.totalBytes) : "—"}
          </span>
          <span className="pb-1 text-sm text-muted-foreground">
            {overview ? `${overview.totalObjects} 个文件` : "读取中"}
          </span>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {overview?.byType.length ? (
            overview.byType.map((stat) => (
              <span
                key={stat.mediaType}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/30 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground"
              >
                <span className="font-medium text-foreground">
                  {MEDIA_ASSET_TYPE_LABELS[stat.mediaType] ?? stat.mediaType}
                </span>
                <span className="tabular-nums">{stat.count}</span>
                <span className="text-muted-foreground/60">·</span>
                <span className="tabular-nums">{formatBytes(stat.bytes)}</span>
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">暂无数据</span>
          )}
        </div>
      </motion.div>

      {/* 次：状态分布（可点击筛选） */}
      <motion.div variants={itemVariants} className={cn(PANEL, "p-3")}>
        <div className="flex items-center justify-between px-1 pb-2">
          <h3 className={settingsTypography.fieldLabel}>按引用状态筛选</h3>
          {reclaimable > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400 tabular-nums">
              可回收 {formatBytes(reclaimable)}
            </span>
          )}
        </div>

        <div className="space-y-1">
          {scopes.map((item) => {
            const active = scope === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onScopeChange(item.key)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-primary/10" : "hover:bg-muted/60"
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    item.key === "all" ? "bg-muted-foreground/50" : STATUS_DOT[item.key]
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", active ? "font-medium text-foreground" : "text-foreground/90")}>
                    {item.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm text-foreground tabular-nums">{item.count}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">{formatBytes(item.bytes)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
