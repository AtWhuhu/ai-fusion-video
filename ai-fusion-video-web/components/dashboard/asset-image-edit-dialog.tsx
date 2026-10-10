"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Brush, ImagePlus, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SafeImage } from "@/components/ui/safe-image";
import {
  aiModelApi,
  type AiModel,
  type ModelPreset,
} from "@/lib/api/ai-model";
import { generationApi } from "@/lib/api/generation";
import { getApiErrorMessage } from "@/lib/api/api-error";
import { toastApiError } from "@/lib/api/toast-api-error";
import { resolveMediaUrl } from "@/lib/api/client";
import { resolveGenerationCapabilities } from "@/lib/generation-capabilities";
import { cn } from "@/lib/utils";

type EditMode = "edit" | "reference";
type Phase = "form" | "running" | "done" | "error";

const POLL_INTERVAL_MS = 3000;

const MODE_META: Record<
  EditMode,
  { label: string; placeholder: string; hint: string }
> = {
  edit: {
    label: "改图微调",
    placeholder:
      "描述要修改的内容，例如：把帽子改成红色，其他保持不变",
    hint: "以原图为底，按指令做局部修改，其余保持不动",
  },
  reference: {
    label: "参考生图",
    placeholder:
      "描述要生成的新画面，例如：同角色站在夜晚的集市中，电影质感",
    hint: "以原图为角色 / 风格参考，重新生成一张图",
  },
};

const EDIT_EXAMPLES = [
  "把背景换成夜晚的街道",
  "改为水彩插画风格",
  "让人物面带微笑",
];

interface AssetImageEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: number;
  /** 作为参考的原图 URL */
  sourceImageUrl: string;
  assetName?: string;
  /** 用户确认应用生成结果时回调（返回新图 URL） */
  onApply: (imageUrl: string) => void;
}

/**
 * 资产图 AI 改图弹窗：以当前资产图为参考，支持指令改图 / 参考生图。
 * 直接调用图片生成接口（refImageUrls），完成后由调用方决定是否应用。
 */
export function AssetImageEditDialog({
  open,
  onOpenChange,
  projectId,
  sourceImageUrl,
  assetName,
  onApply,
}: AssetImageEditDialogProps) {
  const [mode, setMode] = useState<EditMode>("edit");
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelId, setModelId] = useState<number | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const pollTimerRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // 弹窗每次打开时重置为初始状态（render 阶段的 guarded reset，见 React 文档 "Adjusting some state when a prop changes"）
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode("edit");
      setPrompt("");
      setPhase("form");
      setTaskId(null);
      setResultUrl(null);
      setErrorMsg("");
      setModelId(null);
      setModels([]);
      setModelsLoaded(false);
    }
  }

  const loadingModels = open && !modelsLoaded;

  // 加载支持参考图的圖片模型（setState 均在异步回调中，符合 lint 规则）
  useEffect(() => {
    if (!open || modelsLoaded) return;
    let cancelled = false;
    Promise.all([aiModelApi.listByType(2), aiModelApi.presets(2)])
      .then(([modelList, presetList]: [AiModel[], ModelPreset[]]) => {
        if (cancelled) return;
        const usable = modelList.filter(
          (model) =>
            model.status === 1 &&
            resolveGenerationCapabilities(model, presetList)
              .supportsReferenceImages,
        );
        setModels(usable);
        setModelId(
          usable.find((model) => model.defaultModel)?.id ?? usable[0]?.id ?? null,
        );
        setModelsLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        toastApiError(error, "加载图片模型失败");
        setModels([]);
        setModelsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, modelsLoaded]);

  useEffect(() => stopPolling, []);

  const pollTask = (id: string) => {
    stopPolling();
    const tick = async () => {
      try {
        const task = await generationApi.getImageTask(id);
        if (task.status === 2) {
          stopPolling();
          const items = await generationApi.listImageItems(task.id);
          const url = items.find((item) => item.imageUrl)?.imageUrl;
          if (url) {
            setResultUrl(url);
            setPhase("done");
          } else {
            setErrorMsg("任务已完成，但未返回图片");
            setPhase("error");
          }
        } else if (task.status === 3) {
          stopPolling();
          setErrorMsg(task.errorMsg || "生成失败，请重试");
          setPhase("error");
        }
        // status 0/1 继续等待
      } catch (error) {
        stopPolling();
        setErrorMsg(getApiErrorMessage(error));
        setPhase("error");
      }
    };
    pollTimerRef.current = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    void tick();
  };

  const handleSubmit = async () => {
    const finalPrompt = prompt.trim();
    if (!finalPrompt) {
      toast.error("请先填写改图指令");
      return;
    }
    if (modelId == null) {
      toast.error("没有可用的参考生图模型");
      return;
    }
    setPhase("running");
    setErrorMsg("");
    setResultUrl(null);
    try {
      const id = await generationApi.submitImage({
        projectId,
        prompt: finalPrompt,
        refImageUrls: JSON.stringify([sourceImageUrl]),
        modelId,
        category: "asset_image_edit",
      });
      setTaskId(id);
      pollTask(id);
    } catch (error) {
      setErrorMsg(getApiErrorMessage(error));
      setPhase("error");
    }
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) stopPolling();
    onOpenChange(nextOpen);
  };

  const selectedModel = models.find((model) => model.id === modelId) ?? null;
  const canSubmit =
    phase !== "running" && prompt.trim().length > 0 && modelId != null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[calc(100vh-2rem)] sm:max-h-[85vh] flex flex-col overflow-hidden rounded-2xl p-0 gap-0">
        <DialogHeader className="px-6 py-5 border-b border-border/30 shrink-0">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Brush className="h-4 w-4 text-primary" />
            AI 改图{assetName ? ` · ${assetName}` : ""}
          </DialogTitle>
          <DialogDescription className="text-xs">
            以当前资产图为参考进行 AI 重绘 / 微调，确认后再应用
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 p-5">
          {phase === "running" ? (
            <div className="py-14 flex flex-col items-center justify-center text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary/70 mb-3" />
              <p className="text-sm font-medium">AI 正在改图中…</p>
              <p className="text-xs text-muted-foreground mt-1">
                参考原图生成中，请稍候（可关闭弹窗，任务会在后台继续）
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-4"
                onClick={() => handleClose(false)}
              >
                关闭弹窗
              </Button>
            </div>
          ) : phase === "done" && resultUrl ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                    原图
                  </p>
                  <div className="rounded-xl overflow-hidden border border-border/30 bg-muted/20 aspect-square">
                    <SafeImage
                      src={resolveMediaUrl(sourceImageUrl) || undefined}
                      alt="原图"
                      fallbackType="image"
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                    改图结果
                  </p>
                  <div className="rounded-xl overflow-hidden border border-primary/30 bg-muted/20 aspect-square ring-1 ring-primary/20">
                    <SafeImage
                      src={resolveMediaUrl(resultUrl) || undefined}
                      alt="改图结果"
                      fallbackType="image"
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
              </div>
              {taskId && (
                <p className="text-[10px] text-muted-foreground/60">
                  不满意可以返回重新调整指令再生成一次
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* 参考原图 */}
              <div className="flex gap-4">
                <div className="w-28 shrink-0">
                  <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                    参考原图
                  </p>
                  <div className="rounded-lg overflow-hidden border border-border/30 bg-muted/20 aspect-square">
                    <SafeImage
                      src={resolveMediaUrl(sourceImageUrl) || undefined}
                      alt="参考原图"
                      fallbackType="image"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
                <div className="flex-1 min-w-0 space-y-3">
                  {/* 模式切换 */}
                  <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-muted/40 p-1">
                    {(Object.keys(MODE_META) as EditMode[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setMode(key)}
                        className={cn(
                          "h-8 rounded-lg px-3 text-xs font-medium transition-all",
                          mode === key
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {MODE_META[key].label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground/80">
                    {MODE_META[mode].hint}
                  </p>
                </div>
              </div>

              {/* 指令输入 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  改图指令
                </label>
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder={MODE_META[mode].placeholder}
                  className="text-sm leading-6 resize-none"
                />
                {mode === "edit" && (
                  <div className="flex flex-wrap gap-1.5">
                    {EDIT_EXAMPLES.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() =>
                          setPrompt((current) =>
                            current.trim() ? `${current.trim()}；${example}` : example,
                          )
                        }
                        className="h-6 rounded-md border border-border/50 bg-background/65 px-2 text-[10px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                      >
                        + {example}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 模型选择 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  生图模型（需支持参考图）
                </label>
                {loadingModels ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    加载模型中…
                  </div>
                ) : models.length === 0 ? (
                  <p className="text-xs text-amber-600 bg-amber-500/10 rounded-lg px-3 py-2">
                    没有支持参考图的图片模型，请先在「设置 → AI
                    模型」中添加并开启「支持参考图」
                  </p>
                ) : (
                  <Select
                    value={modelId}
                    onValueChange={(value) => setModelId(Number(value))}
                    items={models.map((model) => ({
                      value: model.id,
                      label: model.name,
                    }))}
                  >
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {models.map((model) => (
                          <SelectItem
                            key={model.id}
                            value={model.id}
                            className="text-xs"
                          >
                            {model.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
                {selectedModel?.code && (
                  <p className="text-[10px] text-muted-foreground/60 font-mono truncate">
                    {selectedModel.code}
                  </p>
                )}
              </div>

              {phase === "error" && errorMsg && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  {errorMsg}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border/20 flex items-center justify-end gap-2 shrink-0">
          {phase === "done" && resultUrl ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPhase("form");
                  setResultUrl(null);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重新生成
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onApply(resultUrl);
                  handleClose(false);
                }}
              >
                <ImagePlus className="h-3.5 w-3.5" />
                应用为资产图
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
                取消
              </Button>
              <Button size="sm" disabled={!canSubmit} onClick={() => void handleSubmit()}>
                {phase === "running" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                开始改图
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
