"use client";

import { useMemo } from "react";
import {
  CheckSquare2,
  Clapperboard,
  Cpu,
  Film,
  FolderKanban,
  ImageIcon,
  Layers,
  Loader2,
  MapPin,
  Search,
  Square,
  Video,
  Wand2,
} from "lucide-react";
import type { AiModel } from "@/lib/api/ai-model";
import type {
  Storyboard,
  StoryboardEpisode,
  StoryboardItem,
  StoryboardScene,
} from "@/lib/api/storyboard";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  describeModelPlatform,
  resolvePlatformSkill,
} from "../_lib/platform-skills";
import {
  describeEpisode,
  describeScene,
  describeStoryboardItem,
  PROMPT_TARGET_TYPES,
  type PromptTargetType,
} from "../_hooks/use-prompt-workspace";

const ALL_OPTION = "all";

/** 单张提示词字段的现状展示块 */
function PromptFieldPreview({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const filled = Boolean(value?.trim());
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {label}
        </span>
        {!filled && (
          <span className="text-[10px] text-muted-foreground/60">未填写</span>
        )}
      </div>
      <p
        className={cn(
          "max-h-28 overflow-y-auto rounded-lg border border-border/30 bg-muted/25 px-2.5 py-2",
          "text-[11px] leading-relaxed break-words whitespace-pre-wrap",
          filled ? "text-foreground/85" : "text-muted-foreground/50",
        )}
      >
        {value?.trim() || "—"}
      </p>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof FolderKanban;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <Icon className="h-3.5 w-3.5 translate-y-0.5 shrink-0 text-muted-foreground" />
      <span className="text-xs font-semibold">{title}</span>
      {hint && (
        <span className="truncate text-[10px] text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

export interface PromptSetupPanelProps {
  projects: Array<{ id: number; name: string }>;
  loadingProjects: boolean;
  projectId: number | null;
  onProjectChange: (id: number | null) => void;

  storyboard: Storyboard | null;
  loadingStoryboard: boolean;
  itemTotal: number;

  episodes: StoryboardEpisode[];
  episodeId: number | null;
  onEpisodeChange: (id: number | null) => void;

  scenesOfEpisode: StoryboardScene[];
  sceneId: number | null;
  onSceneChange: (id: number | null) => void;

  visibleItems: StoryboardItem[];
  scopedItemCount: number;
  loadingItems: boolean;
  keyword: string;
  onKeywordChange: (value: string) => void;
  selectedItemIds: number[];
  onToggleItem: (id: number) => void;
  onSelectVisibleItems: () => void;
  onClearItems: () => void;

  targetType: PromptTargetType;
  onTargetTypeChange: (type: PromptTargetType) => void;
  modelsOfTarget: AiModel[];
  loadingModels: boolean;
  modelId: number | null;
  onModelChange: (id: number | null) => void;
  selectedModel: AiModel | null;

  disabled?: boolean;
}

/**
 * 左栏配置区：项目 → 分镜 → 集 → 场 → 镜头 → 目标模型，
 * 以及选中镜头「已有提示词」的现状预览。
 */
export function PromptSetupPanel({
  projects,
  loadingProjects,
  projectId,
  onProjectChange,
  storyboard,
  loadingStoryboard,
  itemTotal,
  episodes,
  episodeId,
  onEpisodeChange,
  scenesOfEpisode,
  sceneId,
  onSceneChange,
  visibleItems,
  scopedItemCount,
  loadingItems,
  keyword,
  onKeywordChange,
  selectedItemIds,
  onToggleItem,
  onSelectVisibleItems,
  onClearItems,
  targetType,
  onTargetTypeChange,
  modelsOfTarget,
  loadingModels,
  modelId,
  onModelChange,
  selectedModel,
  disabled,
}: PromptSetupPanelProps) {
  const selectedItems = useMemo(
    () =>
      selectedItemIds
        .map((id) => visibleItems.find((item) => item.id === id))
        .filter((item): item is StoryboardItem => Boolean(item)),
    [visibleItems, selectedItemIds],
  );

  /** 勾选列表里可能有被筛选藏起来的镜头，预览时优先显示可见的那一个 */
  const previewItem = selectedItems[0] ?? null;

  const platformSkill = resolvePlatformSkill(selectedModel);
  const TargetIcon = targetType === "image" ? ImageIcon : Video;
  const selectionDisabled = disabled || !storyboard;

  return (
    <div className="space-y-5">
      {/* ===== 项目 ===== */}
      <section className="space-y-2">
        <SectionTitle icon={FolderKanban} title="项目" />
        <Select
          value={projectId}
          onValueChange={(value) =>
            onProjectChange(value === null ? null : Number(value))
          }
          items={projects.map((project) => ({
            value: project.id,
            label: project.name,
          }))}
          disabled={disabled}
        >
          <SelectTrigger className="h-9 w-full rounded-xl">
            <SelectValue
              placeholder={loadingProjects ? "加载项目…" : "选择项目"}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </section>

      {/* ===== 分镜 ===== */}
      <section className="space-y-2">
        <SectionTitle icon={Film} title="分镜" hint="每个项目对应一个分镜工作区" />
        <div className="rounded-xl border border-border/30 bg-muted/25 px-2.5 py-2">
          {loadingStoryboard ? (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              加载分镜…
            </div>
          ) : storyboard ? (
            <>
              <p className="truncate text-[11px] font-medium">
                {storyboard.title?.trim() || `分镜 #${storyboard.id}`}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {episodes.length} 集 · {itemTotal} 个镜头
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {projectId === null
                ? "请先选择项目"
                : "该项目尚未初始化分镜，请先在分镜页生成"}
            </p>
          )}
        </div>
      </section>

      {/* ===== 集 / 场 ===== */}
      <section className="space-y-2">
        <SectionTitle icon={Layers} title="集 · 场" hint="用于快速收敛镜头范围" />
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={episodeId === null ? ALL_OPTION : String(episodeId)}
            onValueChange={(value) =>
              onEpisodeChange(value === ALL_OPTION ? null : Number(value))
            }
            items={[
              { value: ALL_OPTION, label: "全部集" },
              ...episodes.map((episode) => ({
                value: String(episode.id),
                label: describeEpisode(episode),
              })),
            ]}
            disabled={selectionDisabled || episodes.length === 0}
          >
            <SelectTrigger className="h-8 w-full rounded-xl text-xs">
              <SelectValue placeholder="全部集" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_OPTION}>全部集</SelectItem>
                {episodes.map((episode) => (
                  <SelectItem key={episode.id} value={String(episode.id)}>
                    {describeEpisode(episode)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select
            value={sceneId === null ? ALL_OPTION : String(sceneId)}
            onValueChange={(value) =>
              onSceneChange(value === ALL_OPTION ? null : Number(value))
            }
            items={[
              { value: ALL_OPTION, label: "全部场次" },
              ...scenesOfEpisode.map((scene) => ({
                value: String(scene.id),
                label: describeScene(scene),
              })),
            ]}
            disabled={selectionDisabled || scenesOfEpisode.length === 0}
          >
            <SelectTrigger className="h-8 w-full rounded-xl text-xs">
              <SelectValue placeholder="全部场次" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_OPTION}>全部场次</SelectItem>
                {scenesOfEpisode.map((scene) => (
                  <SelectItem key={scene.id} value={String(scene.id)}>
                    {describeScene(scene)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* ===== 镜头 ===== */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle
            icon={MapPin}
            title="镜头"
            hint={`已选 ${selectedItemIds.length} · 可选 ${scopedItemCount}`}
          />
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onSelectVisibleItems}
              disabled={selectionDisabled || visibleItems.length === 0}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              选当前
            </button>
            <button
              type="button"
              onClick={onClearItems}
              disabled={disabled || selectedItemIds.length === 0}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              清空
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            placeholder="按镜号、景别或画面内容筛选"
            disabled={selectionDisabled || itemTotal === 0}
            className="h-8 rounded-xl pl-8 text-xs"
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-xl border border-border/30 bg-muted/15 p-1.5">
          {loadingItems ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              加载镜头…
            </div>
          ) : itemTotal === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {storyboard ? "该分镜暂无镜头" : "请先选择项目"}
            </p>
          ) : visibleItems.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              没有匹配的镜头
            </p>
          ) : (
            <div className="space-y-1">
              {visibleItems.map((item) => {
                const checked = selectedItemIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onToggleItem(item.id)}
                    disabled={disabled}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                      checked
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-foreground/5",
                      disabled && "pointer-events-none opacity-60",
                    )}
                  >
                    {checked ? (
                      <CheckSquare2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : (
                      <Square className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium">
                          {describeStoryboardItem(item)}
                        </span>
                        {item.duration ? (
                          <span className="text-[10px] text-muted-foreground">
                            {item.duration}s
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                        {item.content?.trim() || "（无画面描述）"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ===== 目标模型 ===== */}
      <section className="space-y-2">
        <SectionTitle icon={Cpu} title="目标模型" hint="决定用哪套平台写法规范" />

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/55 p-1">
          {PROMPT_TARGET_TYPES.map((option) => {
            const Icon = option.value === "image" ? ImageIcon : Video;
            const active = targetType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onTargetTypeChange(option.value)}
                disabled={disabled}
                className={cn(
                  "flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-all",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                  disabled && "pointer-events-none opacity-60",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>

        <Select
          value={modelId}
          onValueChange={(value) =>
            onModelChange(value === null ? null : Number(value))
          }
          items={modelsOfTarget.map((model) => ({
            value: model.id,
            label: model.name,
          }))}
          disabled={disabled || loadingModels}
        >
          <SelectTrigger className="h-9 w-full rounded-xl">
            <SelectValue
              placeholder={
                loadingModels
                  ? "加载模型…"
                  : modelsOfTarget.length === 0
                    ? "暂无可用模型"
                    : "选择模型"
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {modelsOfTarget.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="rounded-xl border border-border/30 bg-muted/25 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[11px]">
            <TargetIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">
              {describeModelPlatform(selectedModel)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <Wand2 className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">已加载规范</span>
            <span className="truncate rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {platformSkill?.label ?? "—"}
            </span>
          </div>
        </div>
      </section>

      {/* ===== 已有提示词现状 ===== */}
      <section className="space-y-2">
        <SectionTitle
          icon={Clapperboard}
          title="已有提示词"
          hint={
            selectedItemIds.length > 1
              ? `共选 ${selectedItemIds.length} 个镜头，展示首个`
              : undefined
          }
        />
        {!previewItem ? (
          <p className="rounded-xl border border-dashed border-border/40 py-6 text-center text-[11px] text-muted-foreground">
            勾选镜头后这里会列出它现有的提示词
          </p>
        ) : (
          <div className="space-y-2.5 rounded-xl border border-border/30 bg-muted/15 p-2.5">
            <p className="text-[10px] text-muted-foreground">
              {describeStoryboardItem(previewItem)}
            </p>
            <PromptFieldPreview
              label="首帧提示词"
              value={previewItem.firstFramePrompt}
            />
            <PromptFieldPreview
              label="尾帧提示词"
              value={previewItem.lastFramePrompt}
            />
            <PromptFieldPreview
              label="视频提示词"
              value={previewItem.videoPrompt}
            />
            <PromptFieldPreview
              label="画面期望"
              value={previewItem.sceneExpectation}
            />
          </div>
        )}
      </section>
    </div>
  );
}
