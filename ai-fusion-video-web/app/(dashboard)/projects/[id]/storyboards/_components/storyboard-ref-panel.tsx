"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toastApiError } from "@/lib/api/toast-api-error";
import {
  Info,
  Camera,
  Sparkles,
  Loader2,
  Users,
  MapPin,
  Package,
  ExternalLink,
  Video,
  X,
  ZoomIn,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveMediaUrl } from "@/lib/api/client";
import { assetApi } from "@/lib/api/asset";
import { SafeImage } from "@/components/ui/safe-image";

import type { AssetItem } from "@/lib/api/asset";
import type { Project } from "@/lib/api/project";
import type { StoryboardItem, Storyboard, StoryboardScene } from "@/lib/api/storyboard";
import { BatchGenDialog } from "./batch-gen-dialog";
import type { AssetItemWithInfo, SelectedAssetItem } from "./batch-gen-dialog";
import { VideoGenDialog } from "./video-gen-dialog";
import {
  BatchFrameGenerateControl,
  type BatchFrameGenerateHandler,
} from "./storyboard-batch-frame";
import { usePipelineStore } from "@/lib/store/pipeline-store";

// ========== 类型 ==========

interface SceneWithItems {
  scene: StoryboardScene;
  items: StoryboardItem[];
}

/** 带主资产名称和类型的子资产 */
interface AssetItemWithParent extends AssetItem {
  parentName: string;
  parentType: string;
}

/** 资产分组 */
interface GroupedAssets {
  characters: AssetItemWithParent[];
  scenes: AssetItemWithParent[];
  props: AssetItemWithParent[];
}

// ========== 常量 ==========

const typeConfig = {
  character: {
    label: "角色",
    icon: Users,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
  },
  scene: {
    label: "场景",
    icon: MapPin,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
  },
  prop: {
    label: "道具",
    icon: Package,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
  },
} as const;

/** 安全解析 ID 数组（兼容后端返回的 JSON 字符串或原生数组） */
function parseIds(raw: number[] | string | null | undefined): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ========== 场次资产面板 ==========

function SceneAssetPanel({
  sceneGroup,
  projectId,
  storyboard,
  onBatchGenerateFrames,
  onPreviewImage,
}: {
  sceneGroup: SceneWithItems;
  projectId: number;
  storyboard: Storyboard;
  onBatchGenerateFrames?: BatchFrameGenerateHandler;
  onPreviewImage?: (url: string, title: string) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [groupedAssets, setGroupedAssets] = useState<GroupedAssets>({
    characters: [],
    scenes: [],
    props: [],
  });
  const [showBatchGen, setShowBatchGen] = useState(false);
  const [showVideoGen, setShowVideoGen] = useState(false);

  // 直接从分镜 items 聚合子资产 ID（characterIds / sceneAssetItemId / propIds）
  // 批量查子资产详情，附带主资产名称做辅助展示
  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const characterItemIds = new Set<number>();
      const sceneItemIds = new Set<number>();
      const propItemIds = new Set<number>();

      for (const item of sceneGroup.items) {
        const charIds = parseIds(item.characterIds);
        charIds.forEach((id) => characterItemIds.add(id));
        if (item.sceneAssetItemId) sceneItemIds.add(item.sceneAssetItemId);
        const pIds = parseIds(item.propIds);
        pIds.forEach((id) => propItemIds.add(id));
      }

      const allItemIds = [
        ...characterItemIds,
        ...sceneItemIds,
        ...propItemIds,
      ];

      if (allItemIds.length === 0) {
        setGroupedAssets({ characters: [], scenes: [], props: [] });
        return;
      }

      // 批量获取子资产详情
      const results = await Promise.all(
        allItemIds.map((id) => assetApi.getItem(id).catch((error) => {
          toastApiError(error, "加载资产项失败");
          return null;
        }))
      );

      // 收集主资产ID用于查名称
      const parentAssetIds = new Set<number>();
      const itemMap = new Map<number, AssetItem>();
      for (const r of results) {
        if (!r) continue;
        itemMap.set(r.id, r);
        if (r.assetId) parentAssetIds.add(r.assetId);
      }

      // 批量获取主资产（用于获取名称和类型做辅助标注）
      const parentAssets = await Promise.all(
        Array.from(parentAssetIds).map((id) => assetApi.get(id).catch((error) => {
          toastApiError(error, "加载父级资产失败");
          return null;
        }))
      );
      const parentInfoMap = new Map<number, { name: string; type: string }>();
      for (const a of parentAssets) {
        if (a) parentInfoMap.set(a.id, { name: a.name, type: a.type });
      }

      // 直接展示子资产，附带主资产名称和类型
      const toItemsWithParent = (ids: Set<number>): AssetItemWithParent[] => {
        const result: AssetItemWithParent[] = [];
        for (const itemId of ids) {
          const item = itemMap.get(itemId);
          if (!item) continue;
          const info = parentInfoMap.get(item.assetId);
          result.push({
            ...item,
            parentName: info?.name || "未知资产",
            parentType: info?.type || "unknown",
          });
        }
        return result;
      };

      setGroupedAssets({
        characters: toItemsWithParent(characterItemIds),
        scenes: toItemsWithParent(sceneItemIds),
        props: toItemsWithParent(propItemIds),
      });
    } catch (err) {
      console.error("加载场次资产失败:", err);
      toastApiError(err, "加载场次资产失败");
    } finally {
      setLoading(false);
    }
  }, [sceneGroup]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const allItems = [
    ...groupedAssets.characters,
    ...groupedAssets.scenes,
    ...groupedAssets.props,
  ];
  const hasAssets = allItems.length > 0;

  // 点击子资产时跳转到其主资产
  const handleItemClick = (item: AssetItemWithParent) => {
    router.push(`/projects/${projectId}/assets?highlight=${item.assetId}`);
  };

  const addPipeline = usePipelineStore((s) => s.addPipeline);
  const setNotificationOpen = usePipelineStore((s) => s.setNotificationOpen);

  // 构建传给 BatchGenDialog 的子资产列表
  const batchGenItems: AssetItemWithInfo[] = allItems.map((ai) => ({
    item: ai,
    parentName: ai.parentName,
    parentType: ai.parentType,
    assetId: ai.assetId,
  }));

  const handleBatchGenConfirm = (selectedItems: SelectedAssetItem[]) => {
    // 提取去重的主资产ID和选中的子资产ID
    const selectedAssetIds = [...new Set(selectedItems.map((s) => s.assetId))];
    const selectedAssetItemIds = selectedItems.map((s) => s.itemId);

    // 触发 Agent Pipeline
    addPipeline({
      label: `批量生图 (${selectedItems.length} 个子资产)`,
      projectId,
      request: {
        agentType: "asset_image_gen",
        toolExecutionMode: "FULL_ACCESS",
        projectId,
        context: {
          selectedAssetIds,
          selectedAssetItemIds,
        },
      },
      onComplete: () => {
        loadAssets();
      },
    });

    // 打开通知面板让用户看到进度
    setNotificationOpen(true);
  };

  /** 批量生视频确认 */
  const handleVideoGenConfirm = (selectedItemIds: number[], promptOnly?: boolean) => {
    addPipeline({
      label: promptOnly
        ? `批量生成视频提示词 (${selectedItemIds.length} 个镜头)`
        : `批量生视频 (${selectedItemIds.length} 个镜头)`,
      projectId,
      request: {
        agentType: "storyboard_video_gen",
        toolExecutionMode: "FULL_ACCESS",
        projectId,
        context: {
          selectedStoryboardItemIds: selectedItemIds,
          storyboardId: storyboard.id,
          promptOnly: promptOnly || false,
        },
      },
      onComplete: () => {
        // 视频生成完成后可能需要刷新分镜数据
      },
    });
    setNotificationOpen(true);
  };

  return (
    <div className="p-4 space-y-4">
      {/* 标题 */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
          <Camera className="h-3 w-3" /> 场次详情
        </h4>
        <p className="text-sm font-semibold">
          {sceneGroup.scene.sceneHeading ||
            `场次 ${sceneGroup.scene.sceneNumber || sceneGroup.scene.id}`}
        </p>
        {sceneGroup.scene.location && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {sceneGroup.scene.intExt && `${sceneGroup.scene.intExt} `}
            {sceneGroup.scene.location}
            {sceneGroup.scene.timeOfDay && ` · ${sceneGroup.scene.timeOfDay}`}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
          {sceneGroup.items.length} 个镜头
        </p>
      </div>

      {/* 批量生图按钮 */}
      {hasAssets && (
        <button
          onClick={() => setShowBatchGen(true)}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-all",
            "bg-linear-to-r from-cyan-600 to-blue-600 text-white",
            "hover:shadow-lg hover:shadow-cyan-500/20 hover:scale-[1.02]",
            "active:scale-[0.98]"
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          批量生图
        </button>
      )}

      <BatchFrameGenerateControl
        items={sceneGroup.items}
        currentEpisodeId={sceneGroup.scene.episodeId}
        currentSceneId={sceneGroup.scene.id}
        onConfirm={onBatchGenerateFrames}
      />

      {/* 批量生视频按钮 */}
      <button
        onClick={() => setShowVideoGen(true)}
        className={cn(
          "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-all",
          "bg-linear-to-r from-purple-600 to-pink-600 text-white",
          "hover:shadow-lg hover:shadow-purple-500/20 hover:scale-[1.02]",
          "active:scale-[0.98]"
        )}
      >
        <Video className="h-3.5 w-3.5" />
        批量生视频
      </button>

      {/* 加载中 */}
      {loading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* 资产列表 */}
      {!loading && (
        <>
          {!hasAssets && (
            <div className="text-center py-6 border-t border-border/20 pt-4">
              <Package className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                该场次暂无关联资产
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                请先在剧本场次中设置角色、场景和道具
              </p>
            </div>
          )}

          {/* 按类型分组展示 */}
          {(
            [
              ["character", groupedAssets.characters],
              ["scene", groupedAssets.scenes],
              ["prop", groupedAssets.props],
            ] as [keyof typeof typeConfig, AssetItemWithParent[]][]
          ).map(
            ([type, items]) =>
              items.length > 0 && (
                <AssetItemGroup
                  key={type}
                  type={type}
                  items={items}
                  onItemClick={handleItemClick}
                  onPreviewImage={onPreviewImage}
                />
              )
          )}
        </>
      )}

      {/* 批量生图弹窗 — 传入子资产列表 */}
      <BatchGenDialog
        key={showBatchGen ? "batch-gen-open" : "batch-gen-closed"}
        open={showBatchGen}
        onClose={() => setShowBatchGen(false)}
        assetItems={batchGenItems}
        onConfirm={handleBatchGenConfirm}
      />

      {/* 批量生视频弹窗 */}
      <VideoGenDialog
        key={showVideoGen ? "video-gen-open" : "video-gen-closed"}
        open={showVideoGen}
        onClose={() => setShowVideoGen(false)}
        items={sceneGroup.items}
        onConfirm={handleVideoGenConfirm}
      />
    </div>
  );
}

/** 子资产分组展示 */
function AssetItemGroup({
  type,
  items,
  onItemClick,
  onPreviewImage,
}: {
  type: keyof typeof typeConfig;
  items: AssetItemWithParent[];
  onItemClick: (item: AssetItemWithParent) => void;
  onPreviewImage?: (url: string, title: string) => void;
}) {
  const config = typeConfig[type];
  const Icon = config.icon;

  return (
    <div className="border-t border-border/20 pt-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <Icon className={cn("h-3 w-3", config.color)} />
        {config.label}
        <span className="text-[10px] font-normal text-muted-foreground/60 ml-auto">
          {items.length}
        </span>
      </h4>
      <div className="space-y-1.5">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onItemClick(item)}
            className={cn(
              "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-left group",
              "hover:bg-muted/30"
            )}
          >
            {/* 缩略图 */}
            <div
              onClick={(e) => {
                if (item.imageUrl && onPreviewImage) {
                  e.stopPropagation();
                  onPreviewImage(item.imageUrl, `${item.parentName}: ${item.name || "初始设定"}`);
                }
              }}
              className={cn(
                "h-10 w-10 bg-muted/30 border border-border/10 overflow-hidden shrink-0 flex items-center justify-center relative group/img",
                type === "character" ? "rounded-full" : "rounded-lg",
                item.imageUrl && "cursor-zoom-in hover:border-primary/40 transition-colors"
              )}
            >
              {item.imageUrl ? (
                <>
                  <SafeImage
                    src={resolveMediaUrl(item.imageUrl)}
                    alt={item.name || item.parentName}
                    fallbackType={type === "character" ? "avatar" : type === "scene" ? "scene" : "prop"}
                    className="w-full h-full object-cover transition-transform group-hover/img:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-all">
                    <ZoomIn className="h-3.5 w-3.5 text-white/90" />
                  </div>
                </>
              ) : (
                <Icon
                  className={cn("h-4 w-4 text-muted-foreground/30")}
                />
              )}
            </div>
            {/* 信息 */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">
                {item.name || item.parentName}
              </p>
              <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5">
                {item.parentName}
              </p>
            </div>
            {/* 跳转图标 */}
            <ExternalLink className="h-3 w-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ========== 分镜概览（未选中场次时） ==========

function StoryboardOverview({
  storyboard,
  items,
  projectName,
  onBatchGenerateFrames,
}: {
  storyboard: Storyboard;
  items: StoryboardItem[];
  projectName?: string;
  onBatchGenerateFrames?: BatchFrameGenerateHandler;
}) {
  const totalDuration = items.reduce(
    (sum, item) => sum + (item.duration || 0),
    0
  );
  const withImage = items.filter(
    (i) => i.firstFrameImageUrl || i.lastFrameImageUrl || i.imageUrl || i.generatedImageUrl || i.referenceImageUrl
  ).length;

  return (
    <div className="p-4 space-y-5">
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Info className="h-3 w-3" /> 分镜概览
        </h4>
        <p className="text-sm font-semibold mb-1">
          {projectName || "未命名项目"}
        </p>
        {storyboard.description && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {storyboard.description}
          </p>
        )}
      </div>

      <BatchFrameGenerateControl
        items={[]}
        currentEpisodeId={null}
        currentSceneId={null}
        onConfirm={onBatchGenerateFrames}
      />

      {/* 统计 */}
      <div className="border-t border-border/20 pt-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          统计
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-2.5 rounded-lg bg-muted/20">
            <p className="text-lg font-bold text-primary">{items.length}</p>
            <p className="text-[10px] text-muted-foreground">总镜头数</p>
          </div>
          <div className="text-center p-2.5 rounded-lg bg-muted/20">
            <p className="text-lg font-bold text-cyan-400">
              {totalDuration > 0 ? `${totalDuration}s` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">总时长</p>
          </div>
          <div className="text-center p-2.5 rounded-lg bg-muted/20">
            <p className="text-lg font-bold text-amber-400">{withImage}</p>
            <p className="text-[10px] text-muted-foreground">有画面</p>
          </div>
          <div className="text-center p-2.5 rounded-lg bg-muted/20">
            <p className="text-lg font-bold text-violet-400">
              {items.length - withImage}
            </p>
            <p className="text-[10px] text-muted-foreground">无画面</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== 主面板 ==========

/**
 * 右侧栏：场次级操作（批量生图/批量首尾帧/批量生视频）与场次资产。
 * 镜头级详情已全部并入双击卡片的全屏编辑弹窗，这里不再展示单镜信息。
 */
export function StoryboardRefPanel({
  storyboard,
  items,
  activeSceneGroup,
  projectId,
  project,
  onBatchGenerateFrames,
}: {
  storyboard: Storyboard;
  items: StoryboardItem[];
  activeSceneGroup?: SceneWithItems | null;
  projectId: number;
  project?: Project | null;
  onBatchGenerateFrames?: BatchFrameGenerateHandler;
}) {
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewImageTitle, setPreviewImageTitle] = useState<string>("");

  const handlePreviewImage = useCallback((url: string, title: string) => {
    setPreviewImageUrl(url);
    setPreviewImageTitle(title);
  }, []);

  return (
    <div className="w-full lg:w-72 border-l border-border/20 flex flex-col shrink-0 bg-card/20 overflow-y-auto h-full relative">
      {activeSceneGroup ? (
        <SceneAssetPanel
          sceneGroup={activeSceneGroup}
          projectId={projectId}
          storyboard={storyboard}
          onBatchGenerateFrames={onBatchGenerateFrames}
          onPreviewImage={handlePreviewImage}
        />
      ) : (
        <StoryboardOverview
          storyboard={storyboard}
          items={items}
          projectName={project?.name}
          onBatchGenerateFrames={onBatchGenerateFrames}
        />
      )}

      {/* 图片大图预览灯箱 */}
      {previewImageUrl && (
        <div
          className="modal-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setPreviewImageUrl(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
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
    </div>
  );
}
