"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Film,
  Image as ImageIcon,
  Link2,
  MapPin,
  Maximize2,
  Play,
  Users,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SafeImage } from "@/components/ui/safe-image";
import { cn } from "@/lib/utils";
import { resolveMediaUrl } from "@/lib/api/client";
import { FrameReferenceSection, type FrameGenerateOptions, type FrameNeighborCandidate } from "./storyboard-frame-reference-dialog";
import type { Project } from "@/lib/api/project";
import type { Asset, AssetItem } from "@/lib/api/asset";
import type {
  StoryboardFrameType,
  StoryboardItem,
} from "@/lib/api/storyboard";

/** 安全解析 ID 数组（characterIds / propIds 在库里是 JSON 字符串） */
function parseIds(raw: number[] | string | null | undefined): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 关联资产展示项：子资产 + 主资产 */
interface LinkedAssetEntry {
  sub: AssetItem;
  asset: Asset;
}

const linkedTypeConfig = {
  character: { label: "角色", fallback: "avatar" },
  scene: { label: "场景", fallback: "scene" },
  prop: { label: "道具", fallback: "prop" },
} as const;

/**
 * 弹窗左侧：本镜的画面、首尾帧参考图、参考图、关联资产与空间锚定。
 * 右侧详情抽屉的镜头级信息已全部并入这里。
 */
export function StoryboardItemEditorPreview({
  item,
  projectId,
  project,
  assetLookup,
  onUpdateFrame,
  onGenerateFrame,
  onGenerateVideo,
  onEditAssets,
  neighborCandidates,
}: {
  item: StoryboardItem;
  projectId: number;
  project?: Project | null;
  assetLookup: Record<number, { item: AssetItem; asset: Asset }>;
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
  /** 前后相邻镜头的可用帧图（改造时可选参考，做连贯性镜头） */
  neighborCandidates?: FrameNeighborCandidate[];
}) {
  const router = useRouter();
  const hasVideo = !!(item.generatedVideoUrl || item.videoUrl);
  const frameImageUrl = item.firstFrameImageUrl || item.generatedImageUrl || item.imageUrl;
  const hasImage = !!(frameImageUrl || item.referenceImageUrl);
  const [mediaMode, setMediaMode] = useState<"image" | "video">(
    hasVideo ? "video" : "image"
  );
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(
    null
  );

  const videoSrc = resolveMediaUrl(item.generatedVideoUrl || item.videoUrl) || "";
  const imageSrc = resolveMediaUrl(frameImageUrl || item.referenceImageUrl) || "";

  /** 按类型分组的关联资产（带主资产封面） */
  const linkedGroups = useMemo(() => {
    const resolve = (id: number): LinkedAssetEntry | null => {
      const hit = assetLookup[id];
      return hit ? { sub: hit.item, asset: hit.asset } : null;
    };
    const characters = parseIds(item.characterIds)
      .map(resolve)
      .filter((e): e is LinkedAssetEntry => e !== null);
    const props = parseIds(item.propIds)
      .map(resolve)
      .filter((e): e is LinkedAssetEntry => e !== null);
    const scene =
      item.sceneAssetItemId && item.sceneAssetItemId > 0
        ? ([resolve(item.sceneAssetItemId)].filter(
            (e): e is LinkedAssetEntry => e !== null
          ))
        : [];
    return { characters, scene, props };
  }, [assetLookup, item.characterIds, item.propIds, item.sceneAssetItemId]);

  const hasLinked =
    linkedGroups.characters.length > 0 ||
    linkedGroups.scene.length > 0 ||
    linkedGroups.props.length > 0;

  const displayName = (entry: LinkedAssetEntry) => {
    const subName = entry.sub.name?.trim();
    return subName && subName !== "初始设定" && subName !== "默认" && subName !== entry.asset.name
      ? subName
      : entry.asset.name;
  };

  const openAsset = (assetId: number) =>
    router.push(`/projects/${projectId}/assets?highlight=${assetId}`);

  return (
    <div className="flex flex-col gap-4">
      {/* 画面 / 视频 */}
      <div className="rounded-xl border border-border/30 bg-card/50 p-3">
        <div className="aspect-video relative overflow-hidden rounded-lg border border-border/20 bg-muted/30">
          {mediaMode === "video" && hasVideo ? (
            <video
              src={videoSrc}
              className="h-full w-full object-contain"
              controls
              preload="metadata"
              playsInline
            />
          ) : hasImage ? (
            <>
              <SafeImage
                src={imageSrc || undefined}
                alt={item.content || `镜头 ${item.shotNumber ?? item.id}`}
                fallbackType="image"
                className="h-full w-full object-contain"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-2 top-2 bg-black/45 text-white hover:bg-black/65"
                aria-label="放大查看"
                onClick={() =>
                  setLightbox({
                    url: frameImageUrl || item.referenceImageUrl || "",
                    title: `镜头 ${item.shotNumber ?? item.id}`,
                  })
                }
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/40">
              <ImageIcon className="h-7 w-7" />
              <span className="text-[11px]">暂无画面</span>
            </div>
          )}

          {hasImage && hasVideo && (
            <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg bg-black/50 p-0.5 backdrop-blur-sm">
              {(["image", "video"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setMediaMode(mode)}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
                    mediaMode === mode
                      ? "bg-white/20 text-white"
                      : "text-white/60 hover:text-white/90"
                  )}
                >
                  {mode === "image" ? (
                    <ImageIcon className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  {mode === "image" ? "画面" : "视频"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3">
          <Button
            variant="video"
            size="sm"
            className="w-full"
            onClick={() => onGenerateVideo?.(item)}
          >
            <Video className="h-3.5 w-3.5" />
            {hasVideo ? "重新生成视频" : "生成视频"}
          </Button>
        </div>
      </div>

      {/* 首帧参考图（原右侧详情抽屉） */}
      <div className="rounded-xl border border-border/30 bg-card/50 p-3">
        <FrameReferenceSection
          item={item}
          project={project}
          frameType="first"
          imageUrl={item.firstFrameImageUrl}
          prompt={item.firstFramePrompt}
          className="border-t-0 pt-0"
          onUpdateFrame={onUpdateFrame}
          onGenerateFrame={onGenerateFrame}
          neighborCandidates={neighborCandidates}
          onPreviewImage={(url, title) => setLightbox({ url, title })}
        />
      </div>

      {/* 尾帧参考图（原右侧详情抽屉） */}
      <div className="rounded-xl border border-border/30 bg-card/50 p-3">
        <FrameReferenceSection
          item={item}
          project={project}
          frameType="last"
          imageUrl={item.lastFrameImageUrl}
          prompt={item.lastFramePrompt}
          className="border-t-0 pt-0"
          onUpdateFrame={onUpdateFrame}
          onGenerateFrame={onGenerateFrame}
          neighborCandidates={neighborCandidates}
          onPreviewImage={(url, title) => setLightbox({ url, title })}
        />
      </div>

      {/* 参考图（分镜静态参考，非首尾帧） */}
      {item.referenceImageUrl && (
        <div className="rounded-xl border border-border/30 bg-card/50 p-3">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <ImageIcon className="h-3 w-3" />
            参考图
          </span>
          <div
            onClick={() =>
              setLightbox({
                url: item.referenceImageUrl as string,
                title: `镜头 ${item.shotNumber ?? item.id} 参考图`,
              })
            }
            className="mt-2 overflow-hidden rounded-lg border border-border/20 cursor-zoom-in transition-colors hover:border-primary/40"
          >
            <SafeImage
              src={resolveMediaUrl(item.referenceImageUrl) || undefined}
              alt="参考图"
              fallbackType="image"
              className="w-full aspect-video object-cover"
            />
          </div>
        </div>
      )}

      {/* 关联资产（原右侧详情抽屉：带封面、可跳转、可放大） */}
      <div className="rounded-xl border border-border/30 bg-card/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Link2 className="h-3 w-3" />
            关联资产
          </span>
          <Button variant="ghost" size="xs" onClick={() => onEditAssets?.(item)}>
            编辑
          </Button>
        </div>
        {hasLinked ? (
          <div className="mt-2 flex flex-col gap-3">
            {(
              [
                ["character", linkedGroups.characters],
                ["scene", linkedGroups.scene],
                ["prop", linkedGroups.props],
              ] as const
            )
              .filter(([, entries]) => entries.length > 0)
              .map(([type, entries]) => {
                const config = linkedTypeConfig[type];
                return (
                  <div key={type} className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                      <Users className="h-2.5 w-2.5" />
                      {config.label}
                      <span className="ml-auto">{entries.length}</span>
                    </span>
                    <div className="flex flex-wrap gap-x-3 gap-y-2.5">
                      {entries.map((entry) => {
                        const name = displayName(entry);
                        const imageUrl = entry.sub.imageUrl || entry.asset.coverUrl;
                        return (
                          <button
                            key={`${entry.asset.id}-${entry.sub.id}`}
                            type="button"
                            onClick={() => openAsset(entry.asset.id)}
                            className="flex w-14 flex-col items-center gap-1 group/asset cursor-pointer select-none"
                            title={`${config.label}：${name}${entry.asset.description ? `\n${entry.asset.description}` : ""}`}
                          >
                            {imageUrl ? (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLightbox({
                                    url: imageUrl,
                                    title: `${config.label}：${name}`,
                                  });
                                }}
                                className={cn(
                                  "h-11 w-11 bg-muted/30 border border-border/10 overflow-hidden flex items-center justify-center group/coverimg cursor-zoom-in transition-colors hover:border-primary/40",
                                  type === "character" ? "rounded-full" : "rounded-lg"
                                )}
                              >
                                <SafeImage
                                  src={resolveMediaUrl(imageUrl) || undefined}
                                  alt={name}
                                  fallbackType={config.fallback}
                                  className="h-full w-full object-cover transition-transform duration-200 group-hover/asset:scale-110"
                                />
                              </div>
                            ) : (
                              <div
                                className={cn(
                                  "h-11 w-11 border flex items-center justify-center text-xs font-semibold",
                                  type === "character"
                                    ? "rounded-full bg-blue-500/10 text-blue-500 border-blue-500/20"
                                    : type === "scene"
                                      ? "rounded-lg bg-green-500/10 text-green-500 border-green-500/20"
                                      : "rounded-lg bg-amber-500/10 text-amber-500 border-amber-500/20"
                                )}
                              >
                                {name.charAt(0)}
                              </div>
                            )}
                            <span className="max-w-full truncate text-[10px] font-medium text-muted-foreground group-hover/asset:text-foreground">
                              {name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground/60">
            尚未关联角色、场景或道具
          </p>
        )}
      </div>

      {/* 空间锚定（只读） */}
      <div className="rounded-xl border border-border/30 bg-card/50 p-3">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <MapPin className="h-3 w-3" />
          空间锚定
        </span>
        {item.spatialBlock ? (
          <p className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border/20 bg-background/70 p-2.5 text-[11px] leading-relaxed text-foreground/75">
            {item.spatialBlock}
          </p>
        ) : (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
            <Film className="h-3 w-3" />
            该镜暂无空间锚定（场景未配锚点表，或本镜为特写）
          </p>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/60">
          由所属场景的锚点表按本镜机位自动生成，随「机位锚点」变化，不能直接编辑。
        </p>
      </div>

      {/* 画面大图灯箱 */}
      {lightbox && (
        <div
          data-overlay-root
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            <SafeImage
              src={resolveMediaUrl(lightbox.url) || undefined}
              alt={lightbox.title}
              fallbackType="image"
              className="max-h-[80vh] max-w-full select-none rounded-lg border border-border/40 object-contain shadow-2xl"
            />
            <span className="rounded-full border border-border/40 bg-background/85 px-3 py-1.5 text-xs font-medium shadow-xl backdrop-blur-xl">
              {lightbox.title}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
