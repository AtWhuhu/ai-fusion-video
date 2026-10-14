"use client";

import * as React from "react";
import { Box, Map as MapIcon, Save, Sparkles, X } from "lucide-react";
import { assetApi, type Asset } from "@/lib/api/asset";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePipelineStore } from "@/lib/store/pipeline-store";
import { cn } from "@/lib/utils";
import {
  SceneBlockingCanvas,
  type SceneCanvasSelection,
} from "@/components/scene-blocking/scene-blocking-canvas";
import { SceneBlockingInspector } from "@/components/scene-blocking/scene-blocking-inspector";
import { SceneBlockingStage3D } from "@/components/scene-blocking/scene-blocking-stage3d";
import {
  EMPTY_SCENE_BLOCKING,
  parseAssetProperties,
  readSceneBlocking,
  type SceneBlocking,
} from "@/lib/scene-blocking";

/**
 * 分镜页里的「本场景空间锚点」编辑层。
 *
 * 锚点数据仍然只存场景资产一处 —— 这里只是把编辑入口搬到分镜里，
 * 改完所有镜一起生效。布局与场景资产页共用同一套画布与属性面板。
 *
 * 两种视图共用同一份 blocking state 与同一个属性面板：俯视图（SVG）看布局，
 * 3D 导演台（WebGL）看空间关系与「本镜机位实际取到什么」。在哪种视图里改都行，退出统一保存。
 *
 * 层级：宿主是全屏编辑弹窗（z-50），本层从它内部打开，取 z-[60] 压住宿主，
 * 与首尾帧提示词弹窗、灯箱同档（都是编辑弹窗的次级浮层，彼此互斥不同开）。
 */

type StageMode = "2d" | "3d";

interface StoryboardSceneBlockingDialogProps {
  open: boolean;
  /** 本镜所属的场景资产；缺省时只提示不可编辑 */
  asset: Asset | null;
  /** 项目内角色资产，用于站位表与画布标记 */
  characters: Asset[];
  /** 本镜指定的机位锚点（custom_data.cameraAnchorId）：3D 里高亮并作为取景落点 */
  shotCameraId?: string | null;
  /** 保存成功后通知外部刷新分镜数据（机位锚点选项依赖场景资产） */
  onSaved?: () => void;
  /** 本镜是否已有 3D 布景快照，仅用于状态提示 */
  hasSnapshot?: boolean;
  /** 导出本镜 3D 布景快照：PNG dataURL 交出去由外层上传落库 */
  onExportSnapshot?: (dataUrl: string) => Promise<void> | void;
  onClose: () => void;
}

export function StoryboardSceneBlockingDialog({
  open,
  asset,
  characters,
  shotCameraId,
  onSaved,
  hasSnapshot,
  onExportSnapshot,
  onClose,
}: StoryboardSceneBlockingDialogProps) {
  const [blocking, setBlocking] = React.useState<SceneBlocking>(EMPTY_SCENE_BLOCKING);
  const [selection, setSelection] = React.useState<SceneCanvasSelection | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<StageMode>("2d");
  const { confirm } = useConfirm();

  const assetId = asset?.id;
  const assetStamp = asset?.updateTime;

  React.useEffect(() => {
    if (!open) return;
    setBlocking(asset ? readSceneBlocking(asset.properties) : EMPTY_SCENE_BLOCKING);
    setSelection(null);
    setDirty(false);
    setError(null);
    setMode("2d");
  }, [open, assetId, assetStamp, asset]);

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const characterOptions = characters.map((character) => ({
    id: character.id,
    name: character.name,
  }));

  const update = (next: SceneBlocking) => {
    setBlocking(next);
    setDirty(true);
  };

  /**
   * 现场推断锚点：让模型通读本场景在全片中的镜头，推出一整套锚点。
   *
   * 与资产页的入口走同一条流水线（scene_blocking_infer → save_scene_blocking 整表替换），
   * 放在这里是因为导演通常在分镜里才发现「这个场景还没配锚点」，就地推比来回跳页顺手。
   */
  const inferBlocking = async () => {
    if (!asset) return;
    const ok = await confirm({
      title: "AI 推断场景锚点",
      description: `将通读「${asset.name}」在全片中出现的所有镜头，推断出场地结构锚点、可用机位与角色站位。推断结果是整表替换，当前已配置的锚点会被覆盖。确定继续吗？`,
      confirmText: "开始推断",
    });
    if (!ok) return;
    const { addPipeline, setNotificationOpen } = usePipelineStore.getState();
    addPipeline({
      label: `推断场景锚点 · ${asset.name}`,
      projectId: asset.projectId,
      request: {
        agentType: "scene_blocking_infer",
        toolExecutionMode: "FULL_ACCESS",
        category: "pipeline",
        title: `推断场景锚点 · ${asset.name}`,
        projectId: asset.projectId,
        context: { sceneAssetId: asset.id },
      },
      onComplete: () => onSaved?.(),
    });
    setNotificationOpen(true);
  };

  const save = async () => {
    if (!asset) return;
    setSaving(true);
    setError(null);
    try {
      await assetApi.update({
        id: asset.id,
        properties: {
          ...parseAssetProperties(asset.properties),
          blocking,
        },
      });
      setDirty(false);
      onSaved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-overlay-root
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-[1400px] flex-col overflow-hidden border border-border/40 bg-card shadow-2xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/20 px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">
              空间锚点{asset ? ` · ${asset.name}` : ""}
            </h3>
            <p className="truncate text-[10px] text-muted-foreground">
              改的是本场景的锚点表，该场景下所有镜头一起生效
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center rounded-full border border-border/40 p-0.5">
              <ModeButton
                active={mode === "2d"}
                icon={<MapIcon className="h-3 w-3" />}
                label="俯视图"
                onClick={() => setMode("2d")}
              />
              <ModeButton
                active={mode === "3d"}
                icon={<Box className="h-3 w-3" />}
                label="3D 导演台"
                onClick={() => setMode("3d")}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!asset}
              title="让 AI 通读本场景在全片中的所有镜头，反推出一整套空间锚点"
              onClick={() => void inferBlocking()}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI 推断锚点
            </Button>
            <Button
              size="sm"
              disabled={saving || !dirty || !asset}
              onClick={() => void save()}
            >
              <Save className="h-3.5 w-3.5" />
              保存
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!asset ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/40 text-xs text-muted-foreground">
              本镜未关联场景资产，无法编辑空间锚点
            </div>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              {mode === "2d" ? (
                <SceneBlockingCanvas
                  blocking={blocking}
                  characters={characterOptions}
                  selection={selection}
                  onSelect={setSelection}
                  onChange={update}
                />
              ) : (
                <SceneBlockingStage3D
                  blocking={blocking}
                  characters={characterOptions}
                  selection={selection}
                  onSelect={setSelection}
                  onChange={update}
                  shotCameraId={shotCameraId}
                  hasSnapshot={hasSnapshot}
                  onExportSnapshot={onExportSnapshot}
                />
              )}
              <SceneBlockingInspector
                blocking={blocking}
                selection={selection}
                characters={characterOptions}
                onChange={update}
              />
            </div>
          )}
        </div>

        {(error || dirty) && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/20 px-5 py-2.5">
            <p className="min-w-0 truncate text-[11px] text-muted-foreground">
              {error ? (
                <span className="text-destructive">{error}</span>
              ) : (
                "有未保存的改动"
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** 视图切换的分段按钮 */
function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
