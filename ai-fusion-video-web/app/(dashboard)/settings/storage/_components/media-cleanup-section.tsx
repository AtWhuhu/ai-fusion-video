"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { toastApiError } from "@/lib/api/toast-api-error";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  mediaCleanupApi,
  type MediaCleanupPurgeResult,
  type MediaCleanupScanResult,
} from "@/lib/api/storage";
import { itemVariants, settingsTypography } from "../../_shared";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function MediaCleanupSection() {
  const { confirm } = useConfirm();
  const [scan, setScan] = useState<MediaCleanupScanResult | null>(null);
  const [result, setResult] = useState<MediaCleanupPurgeResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [purging, setPurging] = useState(false);
  const busy = scanning || purging;

  const handleScan = async () => {
    try {
      setScanning(true);
      setResult(null);
      setScan(await mediaCleanupApi.scan());
    } catch (err) {
      toastApiError(err, "扫描孤儿媒体失败");
    } finally {
      setScanning(false);
    }
  };

  const handlePurge = async () => {
    if (!scan) return;
    const ok = await confirm({
      title: "清理孤儿媒体",
      description: `将删除 ${scan.orphanCount} 个未被任何记录引用的文件（约 ${formatBytes(scan.orphanBytes)}），此操作不可撤销。`,
      variant: "destructive",
      confirmText: "确认清理",
    });
    if (!ok) return;
    try {
      setPurging(true);
      setResult(await mediaCleanupApi.execute());
      setScan(await mediaCleanupApi.scan());
    } catch (err) {
      toastApiError(err, "清理孤儿媒体失败");
    } finally {
      setPurging(false);
    }
  };

  return (
    <motion.div variants={itemVariants} className="mt-10">
      <div className="mb-3 px-1">
        <h3 className={settingsTypography.sectionTitle}>媒体清理</h3>
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-border/30 bg-card/50 p-4 backdrop-blur-sm">
        <p className="text-xs leading-relaxed text-muted-foreground">
          重新生图、删除资产或项目都不会自动回收存储桶里的旧文件。这里可扫描并删除「未被任何记录引用」的孤儿媒体文件，释放空间。请先扫描确认，再执行清理。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleScan} disabled={busy}>
            {scanning ? <Loader2 className="animate-spin" /> : <Trash2 />}
            扫描孤儿文件
          </Button>
          {scan && scan.orphanCount > 0 && (
            <Button variant="destructive" size="sm" onClick={handlePurge} disabled={busy}>
              {purging ? <Loader2 className="animate-spin" /> : <Trash2 />}
              清理 {scan.orphanCount} 个（{formatBytes(scan.orphanBytes)}）
            </Button>
          )}
        </div>
        {scan && (
          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            <div>
              存储共 {scan.totalObjects} 个对象 / {formatBytes(scan.totalBytes)}；孤儿 {scan.orphanCount} 个 /{" "}
              {formatBytes(scan.orphanBytes)}
            </div>
            {scan.sampleOrphans.length > 0 && (
              <ul className="flex max-h-40 flex-col gap-0.5 overflow-auto rounded-lg border border-border/20 bg-background/70 p-2 font-mono text-[10px]">
                {scan.sampleOrphans.map((item) => (
                  <li key={item.key} className="truncate">
                    {item.key} · {formatBytes(item.size)}
                  </li>
                ))}
              </ul>
            )}
            {scan.orphanCount === 0 && <div className="text-green-500">没有需要清理的孤儿文件。</div>}
          </div>
        )}
        {result && (
          <div className="text-xs text-green-500">
            已删除 {result.deletedCount} 个，释放 {formatBytes(result.deletedBytes)}
            {result.failedCount > 0 ? `；失败 ${result.failedCount} 个` : ""}。
          </div>
        )}
      </div>
    </motion.div>
  );
}
