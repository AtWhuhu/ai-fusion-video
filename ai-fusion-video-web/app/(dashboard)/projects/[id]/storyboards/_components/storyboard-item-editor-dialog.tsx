"use client";

import { useEffect, useMemo, useState } from "react";
import { Hash, MapPin, PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Asset, AssetItem } from "@/lib/api/asset";
import type { Project } from "@/lib/api/project";
import { storyboardApi, type StoryboardFrameType, type StoryboardItem } from "@/lib/api/storyboard";
import { uploadFile } from "@/lib/api/storage";
import { toast } from "sonner";
import { toastApiError } from "@/lib/api/toast-api-error";
import {
  StoryboardEnumField,
  StoryboardField,
  StoryboardNumberField,
  StoryboardTextAreaField,
  StoryboardTextField,
} from "./storyboard-item-field";
import { StoryboardItemEditorPreview } from "./storyboard-item-editor-preview";
import type { FrameGenerateOptions, FrameNeighborCandidate } from "./storyboard-frame-reference-dialog";
import { StoryboardVideoPromptDialog } from "./storyboard-video-prompt-dialog";
import { StoryboardSceneBlockingDialog } from "./storyboard-scene-blocking-dialog";
import {
  CAMERA_ANCHOR_AUTO,
  cameraAnchorOptions,
  readBlockingSnapshotUrl,
  readCameraAnchorId,
} from "./storyboard-camera-anchor";
import {
  CAMERA_ANGLE_OPTIONS,
  CAMERA_EQUIPMENT_OPTIONS,
  CAMERA_MOVEMENT_OPTIONS,
  FOCAL_LENGTH_OPTIONS,
  SHOT_TYPE_OPTIONS,
  TRANSITION_OPTIONS,
} from "../storyboard-options";

/** 分组容器：右侧表单按语义分块，避免一长条铺平 */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/30 bg-card/50 p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h4 className="text-xs font-semibold text-foreground/85">{title}</h4>
        {description && (
          <span className="text-[10px] text-muted-foreground/70">{description}</span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

/** 机位锚点：选项来自所属场景锚点表，写进 custom_data.cameraAnchorId */
function CameraAnchorField({
  item,
  onSave,
  onEditBlocking,
}: {
  item: StoryboardItem;
  onSave: (itemId: number, cameraAnchorId: string | null) => void;
  /** 打开本场景的空间锚点编辑层（位置锚点／机位／角色站位） */
  onEditBlocking?: () => void;
}) {
  const options = item.sceneCameraOptions ?? [];

  const editButton = onEditBlocking ? (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      onClick={onEditBlocking}
      title="编辑本场景的位置锚点、机位与角色站位"
    >
      <PenLine className="h-3.5 w-3.5" />
      编辑锚点
    </Button>
  ) : null;

  if (options.length === 0) {
    return (
      <StoryboardField label="机位锚点" hint="所属场景尚未配置机位锚点表">
        <div className="flex items-center gap-2">
          <div className="flex h-9 flex-1 items-center rounded-xl border border-border/20 bg-background/70 px-3 text-[11px] text-muted-foreground">
            未配置锚点
          </div>
          {editButton}
        </div>
      </StoryboardField>
    );
  }

  const items = [
    { value: CAMERA_ANCHOR_AUTO, label: "自动（按机位角度匹配）" },
    ...cameraAnchorOptions(item),
  ];

  return (
    <StoryboardField label="机位锚点" hint="指定本镜用场景里的哪个机位，决定空间锚定的投影结果">
      <div className="flex items-center gap-2">
        <Select
          value={readCameraAnchorId(item.customData) ?? CAMERA_ANCHOR_AUTO}
          items={items}
          onValueChange={(next) => {
            if (next == null) return;
            const picked = String(next);
            onSave(item.id, picked === CAMERA_ANCHOR_AUTO ? null : picked);
          }}
        >
          <SelectTrigger className="h-9 min-w-0 flex-1 rounded-xl text-sm">
            <SelectValue placeholder="自动" />
          </SelectTrigger>
          <SelectContent className="text-sm">
            <SelectGroup>
              {items.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {editButton}
      </div>
    </StoryboardField>
  );
}

/**
 * 分镜条目全屏编辑弹窗。
 *
 * 卡片双击打开，集中放该镜的全部可编辑字段：枚举列走下拉，其余走输入框，
 * 全部「失焦即存」，不设保存按钮，避免改一项要点一次确认。
 */
export function StoryboardItemEditorDialog({
  open,
  item,
  sceneLabel,
  projectId,
  project,
  assetLookup,
  suspendDismiss,
  onClose,
  onUpdateField,
  onUpdateFrame,
  onGenerateFrame,
  onGenerateVideo,
  onEditAssets,
  onSceneBlockingSaved,
  neighborCandidates,
}: {
  open: boolean;
  item: StoryboardItem | null;
  sceneLabel?: string;
  projectId: number;
  project?: Project | null;
  assetLookup: Record<number, { item: AssetItem; asset: Asset }>;
  /** 上层还叠着首尾帧／关联资产弹窗时，Esc 先不关本弹窗 */
  suspendDismiss?: boolean;
  onClose: () => void;
  onUpdateField: (
    itemId: number,
    field: string,
    value: string | number | null
  ) => void;
  onUpdateFrame?: (
    itemId: number,
    frameType: StoryboardFrameType,
    imageUrl: string | null
  ) => Promise<void> | void;
  onGenerateFrame?: (
    item: StoryboardItem,
    frameType: StoryboardFrameType,
    prompt: string,
    options?: FrameGenerateOptions
  ) => Promise<void> | void;
  onGenerateVideo?: (item: StoryboardItem) => void;
  onEditAssets?: (item: StoryboardItem) => void;
  /** 空间锚点保存成功后刷新分镜数据（机位锚点选项与空间锚定文本都依赖场景资产） */
  onSceneBlockingSaved?: () => void;
  /** 前后相邻镜头的可用帧图（改造时可选参考，做连贯性镜头） */
  neighborCandidates?: FrameNeighborCandidate[];
}) {
  /** 生成视频前先看一遍提示词，与右侧详情面板的行为保持一致 */
  const [videoPromptOpen, setVideoPromptOpen] = useState(false);
  /** 本场景空间锚点编辑层 */
  const [blockingOpen, setBlockingOpen] = useState(false);

  useEffect(() => {
    if (!open || suspendDismiss || videoPromptOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 内层浮层（首尾帧提示词弹窗、灯箱）开着时，Esc 交给它们自己处理
      if (document.querySelector("[data-overlay-root]")) return;
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, suspendDismiss, videoPromptOpen, onClose]);

  /** 本镜所属的场景资产与项目内角色资产，供空间锚点编辑层使用 */
  const sceneAsset =
    item?.sceneAssetItemId != null ? assetLookup[item.sceneAssetItemId]?.asset ?? null : null;

  const characterAssets = useMemo(() => {
    const byId = new Map<number, Asset>();
    for (const entry of Object.values(assetLookup)) {
      if (entry.asset.type === "character") byId.set(entry.asset.id, entry.asset);
    }
    return [...byId.values()];
  }, [assetLookup]);

  /**
   * 导出本镜 3D 布景快照：dataURL → 上传拿 URL → 落到该镜的 custom_data。
   *
   * 存的是「导演此刻在 3D 导演台里看到的取景」，生成视频时作为空间布局参考图。
   */
  const saveBlockingSnapshot = async (dataUrl: string) => {
    if (!item) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `blocking3d-${item.id}.png`, { type: "image/png" });
      const url = await uploadFile(file, "blocking3d");
      await storyboardApi.updateItemBlockingSnapshot(item.id, url);
      toast.success("本镜 3D 视图已导出，生成视频时会作为空间布局参考");
      onSceneBlockingSaved?.();
    } catch (cause) {
      toastApiError(cause, "导出 3D 视图失败");
    }
  };

  if (!open || !item) return null;

  const save = (field: string) => (value: string | number | null) =>
    onUpdateField(item.id, field, value);

  return (
    // 层级契约：与 Shadcn Dialog 同层（z-50），靠 DOM 顺序压住页面（本弹窗在布局中靠后）。
    // 确认框、资产选择等 body 门户弹窗天然盖在其上；从本弹窗内部再打开的次级浮层
    // （提示词弹窗、灯箱）用 z-[60]，不得再用 8000+ 的大数层级。
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          "relative flex h-full w-full max-w-[1600px] flex-col overflow-hidden border border-border/40 bg-card shadow-2xl",
          "rounded-none sm:rounded-2xl"
        )}
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/20 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Hash className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">
                镜头 {item.shotNumber || item.autoShotNumber || item.id}
              </h3>
              <p className="truncate text-[10px] text-muted-foreground">
                {sceneLabel ? `${sceneLabel} · ` : ""}
                所有修改在失焦时自动保存
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!sceneAsset}
              title={sceneAsset ? "编辑本场景的空间锚点（站位／机位），该场景所有镜头一起生效" : "本镜未关联场景资产"}
              onClick={() => setBlockingOpen(true)}
            >
              <MapPin className="h-3.5 w-3.5" />
              空间锚点
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 主体 */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="w-full shrink-0 overflow-y-auto border-b border-border/20 p-4 lg:h-full lg:w-[360px] lg:border-b-0 lg:border-r">
            <StoryboardItemEditorPreview
              item={item}
              projectId={projectId}
              project={project}
              assetLookup={assetLookup}
              onUpdateFrame={onUpdateFrame}
              onGenerateFrame={onGenerateFrame}
              onGenerateVideo={() => setVideoPromptOpen(true)}
              onEditAssets={onEditAssets}
              neighborCandidates={neighborCandidates}
            />
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <Section title="镜头" description="构图与拍摄参数">
              <StoryboardField label="镜号">
                <StoryboardTextField
                  value={item.shotNumber}
                  placeholder={item.autoShotNumber ?? ""}
                  onChange={save("shotNumber")}
                />
              </StoryboardField>
              <StoryboardField label="景别">
                <StoryboardEnumField
                  value={item.shotType}
                  options={SHOT_TYPE_OPTIONS}
                  onChange={save("shotType")}
                />
              </StoryboardField>
              <StoryboardField label="时长（秒）">
                <StoryboardNumberField
                  value={item.duration}
                  placeholder="如 3"
                  onChange={save("duration")}
                />
              </StoryboardField>
              <StoryboardField label="摄像机角度">
                <StoryboardEnumField
                  value={item.cameraAngle}
                  options={CAMERA_ANGLE_OPTIONS}
                  onChange={save("cameraAngle")}
                />
              </StoryboardField>
              <StoryboardField label="运镜">
                <StoryboardEnumField
                  value={item.cameraMovement}
                  options={CAMERA_MOVEMENT_OPTIONS}
                  onChange={save("cameraMovement")}
                />
              </StoryboardField>
              <CameraAnchorField
                item={item}
                onSave={(itemId, cameraAnchorId) =>
                  onUpdateField(itemId, "cameraAnchorId", cameraAnchorId)
                }
                onEditBlocking={() => setBlockingOpen(true)}
              />
              <StoryboardField label="摄像设备">
                <StoryboardEnumField
                  value={item.cameraEquipment}
                  options={CAMERA_EQUIPMENT_OPTIONS}
                  onChange={save("cameraEquipment")}
                />
              </StoryboardField>
              <StoryboardField label="焦距">
                <StoryboardEnumField
                  value={item.focalLength}
                  options={FOCAL_LENGTH_OPTIONS}
                  onChange={save("focalLength")}
                />
              </StoryboardField>
              <StoryboardField label="转场">
                <StoryboardEnumField
                  value={item.transition}
                  options={TRANSITION_OPTIONS}
                  onChange={save("transition")}
                />
              </StoryboardField>
            </Section>

            <Section title="内容" description="画面、台词与声音">
              <StoryboardField label="分镜内容" className="sm:col-span-2 xl:col-span-3">
                <StoryboardTextAreaField
                  value={item.content}
                  rows={3}
                  placeholder="本镜画面里发生什么"
                  onChange={save("content")}
                />
              </StoryboardField>
              <StoryboardField
                label="画面期望"
                className="sm:col-span-2 xl:col-span-3"
                hint="会随首尾帧提示词一起提交给模型"
              >
                <StoryboardTextAreaField
                  value={item.sceneExpectation}
                  rows={3}
                  placeholder="希望这一镜呈现出的氛围、光线与质感"
                  onChange={save("sceneExpectation")}
                />
              </StoryboardField>
              <StoryboardField label="对白" className="sm:col-span-2 xl:col-span-3">
                <StoryboardTextAreaField
                  value={item.dialogue}
                  rows={3}
                  placeholder="台词或旁白；没有就留空"
                  onChange={save("dialogue")}
                />
              </StoryboardField>
              <StoryboardField label="声音" className="sm:col-span-2 xl:col-span-3">
                <StoryboardTextAreaField
                  value={item.sound}
                  rows={2}
                  placeholder="环境音与动作音"
                  onChange={save("sound")}
                />
              </StoryboardField>
              <StoryboardField label="音效">
                <StoryboardTextField
                  value={item.soundEffect}
                  placeholder="如 剑鸣"
                  onChange={save("soundEffect")}
                />
              </StoryboardField>
              <StoryboardField label="音乐">
                <StoryboardTextField
                  value={item.music}
                  placeholder="如 低频持续音"
                  onChange={save("music")}
                />
              </StoryboardField>
              <StoryboardField label="备注">
                <StoryboardTextField
                  value={item.remark}
                  placeholder="给自己看的备注"
                  onChange={save("remark")}
                />
              </StoryboardField>
            </Section>

            <Section title="提示词" description="提交给生图／生视频模型的文本">
              <StoryboardField
                label="首帧提示词"
                className="sm:col-span-2 xl:col-span-3"
              >
                <StoryboardTextAreaField
                  value={item.firstFramePrompt}
                  rows={4}
                  placeholder="留空则由弹窗里的默认模板现拼"
                  onChange={save("firstFramePrompt")}
                />
              </StoryboardField>
              <StoryboardField
                label="尾帧提示词"
                className="sm:col-span-2 xl:col-span-3"
              >
                <StoryboardTextAreaField
                  value={item.lastFramePrompt}
                  rows={3}
                  placeholder="留空则由弹窗里的默认模板现拼"
                  onChange={save("lastFramePrompt")}
                />
              </StoryboardField>
              <StoryboardField
                label="视频提示词"
                className="sm:col-span-2 xl:col-span-3"
                hint="提交生成视频前会先过一遍，生成后由 AI 回填"
              >
                <StoryboardTextAreaField
                  value={item.videoPrompt}
                  rows={5}
                  placeholder="描述这一镜的动作与运镜"
                  onChange={save("videoPrompt")}
                />
              </StoryboardField>
            </Section>
          </div>
        </div>

        {/* 底部：只读元信息 + 关闭 */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/20 px-5 py-3">
          <p className="min-w-0 truncate text-[10px] text-muted-foreground">
            自动镜号 {item.autoShotNumber || "—"} · 排序 {item.sortOrder}
            {item.aiGenerated ? " · AI 生成" : ""} · 更新于 {item.updateTime}
          </p>
          <Button variant="secondary" size="sm" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>

      {/* 生成视频前先摆出提示词，确认后才提交 */}
      <StoryboardVideoPromptDialog
        open={videoPromptOpen}
        item={item}
        onClose={() => setVideoPromptOpen(false)}
        onConfirm={() => onGenerateVideo?.(item)}
      />

      {/* 本场景的空间锚点：改的是场景资产，该场景所有镜一起生效 */}
      <StoryboardSceneBlockingDialog
        open={blockingOpen}
        asset={sceneAsset}
        characters={characterAssets}
        shotCameraId={readCameraAnchorId(item.customData)}
        hasSnapshot={Boolean(readBlockingSnapshotUrl(item.customData))}
        onExportSnapshot={saveBlockingSnapshot}
        onSaved={onSceneBlockingSaved}
        onClose={() => setBlockingOpen(false)}
      />
    </div>
  );
}
