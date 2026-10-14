"use client";

import { Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StoryboardItem } from "@/lib/api/storyboard";

/**
 * 视频提示词预览弹窗（只读）
 *
 * 与首尾帧的提示词弹窗对齐：提交生成前先把提示词摆出来。
 * 视频提示词由后端 storyboard_video_executor 按镜头上下文编排并回填到 videoPrompt，
 * 此处只负责展示，不参与编辑，生成流程保持不变。
 */
export function StoryboardVideoPromptDialog({
  open,
  item,
  onClose,
  onConfirm,
}: {
  open: boolean;
  item: StoryboardItem | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open || !item) return null;

  const prompt = item.videoPrompt?.trim() || "";
  const shotLabel = item.shotNumber || item.autoShotNumber || String(item.id);
  const hasVideo = !!(item.generatedVideoUrl || item.videoUrl);

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-card border border-border/30 rounded-2xl shadow-2xl w-[520px] max-w-[92vw] max-h-[calc(100vh-2rem)] sm:max-h-[82vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/20 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Video className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate">
                镜头 #{shotLabel} 视频提示词
              </h3>
              <p className="text-[10px] text-muted-foreground">
                由 AI 按镜头上下文自动编排，此处仅供查看
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-5 min-h-0 flex-1 overflow-hidden flex flex-col">
          {prompt ? (
            <div className="min-h-0 max-h-[min(52vh,28rem)] overflow-y-auto overscroll-contain rounded-lg border border-border/20 bg-background/70 p-3">
              <p className="text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground/80">
                {prompt}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/30 bg-background/70 px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                该镜头暂无视频提示词
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                提交生成后，AI 编写的提示词会自动回填到这里
              </p>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-border/20 flex items-center justify-end gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button variant="video" size="sm" onClick={handleConfirm}>
            <Video className="h-3.5 w-3.5" />
            {hasVideo ? "重新生成视频" : "生成视频"}
          </Button>
        </div>
      </div>
    </div>
  );
}
