"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Check, Image as ImageIcon, Loader2, Sparkles, Wand2, X, ZoomIn } from "lucide-react";
import ImageInput from "@/components/dashboard/image-input";
import { SafeImage } from "@/components/ui/safe-image";
import { Textarea } from "@/components/ui/textarea";
import { resolveMediaUrl } from "@/lib/api/client";
import { stripBakedSpatialAnchors } from "@/lib/scene-expectation";
import { toastApiError } from "@/lib/api/toast-api-error";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/api/project";
import type { StoryboardFrameType, StoryboardItem } from "@/lib/api/storyboard";

type FrameUpdateHandler = (
  itemId: number,
  frameType: StoryboardFrameType,
  imageUrl: string | null
) => Promise<void> | void;

/** 生成方式：generate = 重新生成（抽卡）；refine = 以当前已有帧图为底图做改造精修 */
export type FrameGenerateMode = "generate" | "refine";

/** 相邻镜头的一张可用帧图（候选参考） */
export type FrameNeighborFrame = {
  type: StoryboardFrameType;
  imageUrl: string;
};

/**
 * 可参考的相邻镜头。做连贯性镜头时会拿上一镜／下一镜的画面当参考，
 * 让本镜与前后镜的人物、光影、场景接得上。
 */
export type FrameNeighborCandidate = {
  slot: "prev" | "next";
  /** 显示名，如「上一镜 #12」 */
  label: string;
  /** 该镜可用的帧图，按推荐顺序排列（上一镜尾帧优先、下一镜首帧优先） */
  frames: FrameNeighborFrame[];
};

/** 用户最终勾选的邻镜参考 */
export type FrameNeighborPick = {
  slot: "prev" | "next";
  type: StoryboardFrameType;
};

export type FrameGenerateOptions = {
  mode?: FrameGenerateMode;
  /** 改造时额外参考的相邻镜头帧（连贯性镜头用） */
  refNeighbors?: FrameNeighborPick[];
};

type FrameGenerateHandler = (
  item: StoryboardItem,
  frameType: StoryboardFrameType,
  prompt: string,
  options?: FrameGenerateOptions
) => Promise<void> | void;

function getFrameLabel(frameType: StoryboardFrameType) {
  return frameType === "first" ? "首帧" : "尾帧";
}

/** 收成一句：去首尾空白与残留标点，统一用中文句号收尾 */
function toSentence(text: string) {
  const trimmed = text.trim().replace(/[。；;、\s]+$/, "");
  return trimmed ? `${trimmed}。` : "";
}

function buildDefaultFramePrompt(
  item: StoryboardItem,
  project: Project | null | undefined,
  frameType: StoryboardFrameType
) {
  const style =
    [
      project?.artStyleDescription,
      project?.artStyleImagePrompt,
      project?.artStyle,
    ].find((text) => text && text.trim()) || "高质量精细画面";
  // spatialBlock 已是唯一的空间约束来源：剥离 sceneExpectation 里历史 baked 的锚点段，避免双注入
  const expectation = item.spatialBlock
    ? stripBakedSpatialAnchors(item.sceneExpectation)
    : (item.sceneExpectation ?? "");
  // 只拼「能画进一帧静止图」的信息：
  //   - 不拼对白/旁白：图像模型不发声，台词原文会被当作可渲染文字（字幕/乱码）；
  //     且生成器口径下 content 本身已含「说话人（语气）：“台词”」，再拼一次就是重复
  //   - 不拼运镜：首尾帧是静止的一帧，没有时间轴，运镜只会诱导动态模糊
  //   - 不拼镜号：编号对画面无任何意义，纯噪声
  //   - 不拼机位角度：空间段开篇已经用画面语言交代了机位，再贴一次标签是重复
  // 按「画风 → 景别 → 画面内容 → 画面期望 → 空间与站位」的顺序收成一段连续的画面语言散文，
  // 不分条贴标签：标签会抢走注意力，连续的画面描述更容易被生图模型整体遵循。
  // 空间段由服务端按机位投影而成，本身已是画面语言，不得再包一层标签或塞回锚点代号。
  const parts = [
    style,
    item.shotType,
    item.content,
    expectation,
    item.spatialBlock,
  ].filter((part): part is string => Boolean(part && part.trim()));

  const frameInstruction =
    frameType === "first"
      ? "生成该镜头视频的首帧定格图，表现动作开始前或刚开始的关键瞬间，画面要能自然作为视频开场。"
      : "生成该镜头视频的尾帧定格图，表现动作完成后的结尾状态，画面要能自然作为视频结束帧。";

  return `${frameInstruction}\n${parts.map(toSentence).join("")}`;
}

/**
 * 改造（图生图）的默认提示词：只写「要改什么」，不重复描述画面其余部分。
 * 底图本身已承载构图与主体，服务端会把这张图作为参考图首位，并统一加上
 * 「保持构图/主体/视角/光影/画风不变」的约束，所以这里只需列改动点。
 */
function buildDefaultRefinePrompt(frameType: StoryboardFrameType) {
  const label = getFrameLabel(frameType);
  return [
    `要改的地方（没写到的部分保持原样）：`,
    "- ",
    "",
    `例：把人物外袍换成深灰色、背景改成黄昏、右上角加一层薄雾（当前${label}图作底图）`,
  ].join("\n");
}

export function buildDefaultBatchFramePrompt(frameType: StoryboardFrameType) {
  const frameInstruction =
    frameType === "first"
      ? "生成每个分镜镜头视频的首帧定格图，表现动作开始前或刚开始的关键瞬间，画面要能自然作为视频开场。"
      : "生成每个分镜镜头视频的尾帧定格图，表现动作完成后的结尾状态，画面要能自然作为视频结束帧。";

  return `${frameInstruction}\n请结合每个镜头自身的画面内容、画面期望、景别、机位角度、角色、道具、场景和项目画风补足构图、主体关系、环境氛围与细节。保持同一分镜集内角色、道具、场景和画面风格一致。`;
}

function FramePromptDialog({
  open,
  title,
  hint,
  defaultPrompt,
  submitting,
  extra,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  hint?: string;
  defaultPrompt: string;
  submitting?: boolean;
  /** 提示词之外的可选项（改造模式下的邻镜参考） */
  extra?: ReactNode;
  onClose: () => void;
  onConfirm: (prompt: string) => Promise<void> | void;
}) {
  const [prompt, setPrompt] = useState(defaultPrompt);

  if (!open) return null;

  const canSubmit = prompt.trim().length > 0 && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    await onConfirm(prompt.trim());
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      data-overlay-root
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => !submitting && onClose()}
      />
      <div className="relative bg-card border border-border/30 rounded-xl shadow-2xl w-[520px] max-w-[92vw] max-h-[calc(100vh-2rem)] sm:max-h-[82vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/20 shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="text-[10px] text-muted-foreground">
                {hint ?? "编辑后提交到任务中心"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 min-h-0 space-y-3 overflow-y-auto">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className={cn(
              "min-h-40 max-h-full overflow-y-auto overscroll-contain text-xs leading-relaxed resize-none [field-sizing:fixed]",
              extra ? "h-[min(34vh,17rem)]" : "h-[min(52vh,28rem)]"
            )}
          />
          {extra}
        </div>

        <div className="px-5 py-3.5 border-t border-border/20 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-40 disabled:pointer-events-none"
            )}
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            提交生成
          </button>
        </div>
      </div>
    </div>
  );
}

export function FrameReferenceSection({
  item,
  project,
  frameType,
  imageUrl,
  prompt,
  className,
  onUpdateFrame,
  onGenerateFrame,
  onGenerateSubmitted,
  onPreviewImage,
  neighborCandidates,
}: {
  item: StoryboardItem;
  project?: Project | null;
  frameType: StoryboardFrameType;
  imageUrl: string | null;
  prompt: string | null;
  className?: string;
  onUpdateFrame?: FrameUpdateHandler;
  onGenerateFrame?: FrameGenerateHandler;
  onGenerateSubmitted?: () => void;
  onPreviewImage?: (url: string, title: string) => void;
  /** 前后相邻镜头的可用帧图，供改造时勾选参考（连贯性镜头） */
  neighborCandidates?: FrameNeighborCandidate[];
}) {
  const label = getFrameLabel(frameType);
  /** 当前打开的是哪种提示词弹窗：null = 关闭 */
  const [promptMode, setPromptMode] = useState<FrameGenerateMode | null>(null);
  /** 改造时勾选的邻镜参考：slot → 选中的帧类型（缺省＝不参考该邻居） */
  const [neighborPicks, setNeighborPicks] = useState<
    Partial<Record<"prev" | "next", StoryboardFrameType>>
  >({});
  const [updating, setUpdating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const skipNextChangeConfirmRef = useRef(false);
  const defaultPrompt = buildDefaultFramePrompt(item, project, frameType);
  const defaultRefinePrompt = buildDefaultRefinePrompt(frameType);
  const { confirm } = useConfirm();

  const confirmOverwrite = useCallback(async () => {
    if (!imageUrl) return true;
    return await confirm({
      title: "覆盖参考图",
      description: `${label}参考图已存在，确认覆盖吗？`,
      variant: "warning",
      confirmText: "确认覆盖",
    });
  }, [confirm, imageUrl, label]);

  const handleChange = async (nextValue: string) => {
    if (!onUpdateFrame) return;
    const nextUrl = nextValue.trim() || null;
    const currentUrl = imageUrl?.trim() || null;
    if (
      nextUrl &&
      currentUrl &&
      nextUrl !== currentUrl &&
      !skipNextChangeConfirmRef.current &&
      !(await confirmOverwrite())
    ) {
      return;
    }
    skipNextChangeConfirmRef.current = false;
    try {
      setUpdating(true);
      await onUpdateFrame(item.id, frameType, nextUrl);
    } catch (err) {
      console.error(`更新${label}失败:`, err);
      toastApiError(err, `更新${label}失败，请重试`);
    } finally {
      setUpdating(false);
    }
  };

  /** 重新生成：会丢掉现有图，先确认覆盖 */
  const handleOpenPrompt = async () => {
    if (!onGenerateFrame) return;
    if (!(await confirmOverwrite())) return;
    setPromptMode("generate");
  };

  /** 改造：以当前这张图为底重画，本来就是覆盖它，不再二次确认 */
  const handleOpenRefine = () => {
    if (!onGenerateFrame || !imageUrl) return;
    setNeighborPicks({});
    setPromptMode("refine");
  };

  /** 勾选/取消一个邻镜参考；首次勾选时用候选里排在最前的那张帧图 */
  const toggleNeighbor = (candidate: FrameNeighborCandidate) => {
    setNeighborPicks((prev) => {
      const next = { ...prev };
      if (next[candidate.slot]) {
        delete next[candidate.slot];
      } else {
        next[candidate.slot] = candidate.frames[0]?.type;
      }
      return next;
    });
  };

  const handleConfirmPrompt = async (nextPrompt: string) => {
    if (!onGenerateFrame || !promptMode) return;
    const mode = promptMode;
    const refNeighbors: FrameNeighborPick[] = [];
    if (mode === "refine") {
      for (const slot of ["prev", "next"] as const) {
        const picked = neighborPicks[slot];
        if (picked) refNeighbors.push({ slot, type: picked });
      }
    }
    try {
      setSubmitting(true);
      await onGenerateFrame(item, frameType, nextPrompt, {
        mode,
        ...(refNeighbors.length ? { refNeighbors } : {}),
      });
      setPromptMode(null);
      setSubmitting(false);
      onGenerateSubmitted?.();
    } catch (err) {
      console.error(`提交${label}生成失败:`, err);
      toastApiError(err, `提交${label}生成失败，请重试`);
      setSubmitting(false);
    }
  };

  /**
   * 改造弹窗里的邻镜参考区：做连贯性镜头时，拿上一镜／下一镜的画面一起喂给模型，
   * 让本镜的人物、光影、场景接得上。默认取对方的首帧，有尾帧时可就地切换。
   */
  const neighborList = neighborCandidates ?? [];
  const neighborExtra = neighborList.length ? (
    <div className="rounded-lg border border-border/25 bg-muted/15 p-2.5">
      <p className="text-[10px] font-medium text-muted-foreground">
        参考相邻镜头（做连贯性镜头时勾选）
      </p>
      <p className="mb-2 mt-0.5 text-[10px] leading-relaxed text-muted-foreground/70">
        勾选后本镜的构图、机位与位置关系以该镜为准
      </p>
      <div className="space-y-1.5">
        {neighborList.map((candidate) => {
          const picked = neighborPicks[candidate.slot];
          const active = Boolean(picked);
          const shown =
            candidate.frames.find((frame) => frame.type === picked) ?? candidate.frames[0];
          return (
            <div key={candidate.slot} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleNeighbor(candidate)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors",
                    active ? "border-primary bg-primary" : "border-border/60 bg-background/60"
                  )}
                >
                  {active && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </span>
                <span
                  className={cn(
                    "truncate text-[11px]",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {candidate.label}
                </span>
              </button>
              {shown && (
                <SafeImage
                  src={resolveMediaUrl(shown.imageUrl) || undefined}
                  alt={candidate.label}
                  fallbackType="image"
                  className={cn(
                    "h-8 w-12 shrink-0 rounded object-cover transition-opacity",
                    active ? "opacity-100" : "opacity-45"
                  )}
                />
              )}
              {candidate.frames.length > 1 && (
                <div className="flex shrink-0 gap-0.5">
                  {candidate.frames.map((frame) => {
                    const selected = active && frame.type === picked;
                    return (
                      <button
                        key={frame.type}
                        type="button"
                        onClick={() =>
                          setNeighborPicks((prev) => ({
                            ...prev,
                            [candidate.slot]: frame.type,
                          }))
                        }
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                          selected
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground/70 hover:text-foreground"
                        )}
                      >
                        {getFrameLabel(frame.type)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div className={cn("border-t border-border/20 pt-4", className)}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <ImageIcon className="h-3 w-3" /> {label}参考图
        </h4>
        <div className="flex items-center gap-1">
          {imageUrl && onPreviewImage && (
            <button
              type="button"
              onClick={() => onPreviewImage(imageUrl, `${label}参考图`)}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              title={`预览${label}`}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          )}
          {imageUrl && onGenerateFrame && (
            <button
              type="button"
              onClick={handleOpenRefine}
              disabled={submitting}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-foreground/65 hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
              title={`在原图上改造${label}`}
            >
              <Wand2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onGenerateFrame && (
            <button
              type="button"
              onClick={handleOpenPrompt}
              disabled={submitting}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
              title={`AI生成${label}`}
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      <div className={cn(updating && "opacity-70 pointer-events-none")}>
        <ImageInput
          value={imageUrl || ""}
          onChange={(nextUrl) => {
            void handleChange(nextUrl);
          }}
          previewHeight="h-96"
          previewContainerClassName="mx-auto w-[360px] max-w-full bg-muted/20"
          previewImageClassName="object-contain"
          projectId={project?.id}
          onPreviewClick={
            imageUrl && onPreviewImage
              ? () => onPreviewImage(imageUrl, `${label}参考图`)
              : undefined
          }
          uploadSubDir="storyboard-frames"
          placeholder={`粘贴${label}图片链接...`}
          beforeUpload={async () => {
            const ok = await confirmOverwrite();
            skipNextChangeConfirmRef.current = ok;
            if (ok) {
              window.setTimeout(() => {
                skipNextChangeConfirmRef.current = false;
              }, 5000);
            }
            return ok;
          }}
        />
      </div>

      {prompt && (
        <p className="mt-2 text-[10px] text-muted-foreground/60 line-clamp-4 leading-relaxed">
          {prompt}
        </p>
      )}

      <FramePromptDialog
        key={`${item.id}-${frameType}-${promptMode ?? "closed"}`}
        open={promptMode !== null}
        title={promptMode === "refine" ? `改造${label}` : `AI生成${label}`}
        hint={
          promptMode === "refine"
            ? "以当前这张图为底重画，生成后覆盖它"
            : "编辑后提交到任务中心"
        }
        defaultPrompt={promptMode === "refine" ? defaultRefinePrompt : defaultPrompt}
        submitting={submitting}
        extra={promptMode === "refine" ? neighborExtra : undefined}
        onClose={() => setPromptMode(null)}
        onConfirm={handleConfirmPrompt}
      />
    </div>
  );
}

export function StoryboardFrameReferenceDialog({
  open,
  item,
  project,
  initialFrameType = "first",
  neighborCandidates,
  onClose,
  onUpdateFrame,
  onGenerateFrame,
}: {
  open: boolean;
  item: StoryboardItem | null;
  project?: Project | null;
  initialFrameType?: StoryboardFrameType;
  /** 该镜前后相邻镜头的可用帧图，透传给改造弹窗 */
  neighborCandidates?: FrameNeighborCandidate[];
  onClose: () => void;
  onUpdateFrame?: FrameUpdateHandler;
  onGenerateFrame?: FrameGenerateHandler;
}) {
  const [activeFrameType, setActiveFrameType] =
    useState<StoryboardFrameType>(initialFrameType);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewImageTitle, setPreviewImageTitle] = useState("");

  const handlePreviewImage = useCallback((url: string, title: string) => {
    setPreviewImageUrl(url);
    setPreviewImageTitle(title);
  }, []);

  if (!open || !item) return null;

  const shotLabel = item.shotNumber || item.autoShotNumber || String(item.id);
  const activeImageUrl =
    activeFrameType === "first"
      ? item.firstFrameImageUrl
      : item.lastFrameImageUrl;
  const activePrompt =
    activeFrameType === "first" ? item.firstFramePrompt : item.lastFramePrompt;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
        <div className="relative w-[720px] max-w-[96vw] h-[min(780px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] overflow-hidden rounded-xl border border-border/30 bg-card shadow-2xl flex flex-col">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/20 shrink-0">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate">
                镜头 #{shotLabel} 首尾帧
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                设置该镜号视频生成时使用的首帧和尾帧参考
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors shrink-0"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 pt-4 shrink-0">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/25 p-1">
              {(["first", "last"] as StoryboardFrameType[]).map((frameType) => {
                const label = getFrameLabel(frameType);
                const hasFrame =
                  frameType === "first"
                    ? !!item.firstFrameImageUrl
                    : !!item.lastFrameImageUrl;
                const active = activeFrameType === frameType;
                return (
                  <button
                    key={frameType}
                    type="button"
                    onClick={() => setActiveFrameType(frameType)}
                    className={cn(
                      "h-9 rounded-md px-3 text-xs font-medium transition-all flex items-center justify-center gap-2",
                      active
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span>{label}</span>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        hasFrame ? "bg-emerald-500" : "bg-muted-foreground/30"
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-5 overflow-y-auto min-h-0 flex-1">
            <FrameReferenceSection
              key={`${item.id}-${activeFrameType}`}
              item={item}
              project={project}
              frameType={activeFrameType}
              imageUrl={activeImageUrl}
              prompt={activePrompt}
              className="border-t-0 pt-0"
              onUpdateFrame={onUpdateFrame}
              onGenerateFrame={onGenerateFrame}
              neighborCandidates={neighborCandidates}
              onPreviewImage={handlePreviewImage}
            />
          </div>
        </div>
      </div>

      {previewImageUrl && (
        <div
          className="modal-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setPreviewImageUrl(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={() => setPreviewImageUrl(null)}
              className="absolute -top-12 right-0 rounded-full border border-border/40 bg-background/80 p-1.5 text-foreground shadow-xl backdrop-blur-xl transition-colors hover:bg-background"
              type="button"
            >
              <X className="h-5 w-5" />
            </button>
            <SafeImage
              src={resolveMediaUrl(previewImageUrl)}
              alt={previewImageTitle}
              fallbackType="image"
              className="max-w-full max-h-[80vh] rounded-lg object-contain shadow-2xl border border-border/40 select-none pointer-events-none"
            />
            <p className="rounded-full border border-border/40 bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground shadow-xl backdrop-blur-xl">
              {previewImageTitle}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
