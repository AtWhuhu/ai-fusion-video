"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { aiModelApi, type AiModel } from "@/lib/api/ai-model";
import { projectApi, type Project } from "@/lib/api/project";
import {
  storyboardApi,
  type Storyboard,
  type StoryboardEpisode,
  type StoryboardItem,
  type StoryboardScene,
} from "@/lib/api/storyboard";
import { toastApiError } from "@/lib/api/toast-api-error";
import { IMAGE_MODEL_TYPE, VIDEO_MODEL_TYPE } from "../_lib/platform-skills";

/** 目标模型类型：生图 / 生视频 */
export type PromptTargetType = "image" | "video";

export const PROMPT_TARGET_TYPES: Array<{
  value: PromptTargetType;
  label: string;
}> = [
  { value: "video", label: "生视频" },
  { value: "image", label: "生图" },
];

/** 镜头在列表里的短标签 */
export function describeStoryboardItem(item: StoryboardItem): string {
  const shot = item.shotNumber || item.autoShotNumber || `#${item.id}`;
  return item.shotType ? `${shot} · ${item.shotType}` : shot;
}

/** 分镜集的展示名 */
export function describeEpisode(episode: StoryboardEpisode): string {
  return `第 ${episode.episodeNumber ?? "?"} 集 · ${episode.title?.trim() || "未命名"}`;
}

/** 场次的展示名 */
export function describeScene(scene: StoryboardScene): string {
  const number = scene.sceneNumber ? `${scene.sceneNumber} ` : "";
  return `${number}${
    scene.sceneHeading?.trim() || scene.location?.trim() || "未命名场次"
  }`;
}

/** 一次拉全的分镜内容，用 `projectId` 标记它属于哪个项目 */
interface WorkspaceContent {
  projectId: number;
  storyboard: Storyboard | null;
  episodes: StoryboardEpisode[];
  scenes: StoryboardScene[];
  items: StoryboardItem[];
}

const EMPTY_CONTENT: Pick<
  WorkspaceContent,
  "episodes" | "scenes" | "items"
> = {
  episodes: [],
  scenes: [],
  items: [],
};

/** 稳定的空数组，避免派生出新引用导致下游 memo 失效 */
const NO_IDS: number[] = [];

/**
 * 提示词生成工作区的数据与选择状态。
 *
 * 链路：项目 → 分镜工作区 → 集 → 场 → 镜头 → 目标模型。
 * 集 / 场 / 镜头都在一次拉取之后本地筛选，不额外发请求；它们以及勾选结果
 * 都带着 `projectId` 归属，切项目时旧数据自动失效，不需要手工清空。
 */
export function usePromptWorkspace() {
  // ---- 项目 ----
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectId, setProjectId] = useState<number | null>(null);

  // ---- 分镜内容（带归属标记）----
  const [content, setContent] = useState<WorkspaceContent | null>(null);
  /** 递增即重新拉取当前项目的内容，用于 AI 写回后刷新 */
  const [refreshToken, setRefreshToken] = useState(0);

  // ---- 筛选与勾选（同样带归属标记，切项目自动作废）----
  const [episodeId, setEpisodeId] = useState<number | null>(null);
  const [episodeOwner, setEpisodeOwner] = useState<number | null>(null);
  const [sceneId, setSceneId] = useState<number | null>(null);
  const [sceneOwner, setSceneOwner] = useState<number | null>(null);
  const [keyword, setKeyword] = useState("");
  const [keywordOwner, setKeywordOwner] = useState<number | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectionOwner, setSelectionOwner] = useState<number | null>(null);

  // ---- 目标模型 ----
  const [targetType, setTargetType] = useState<PromptTargetType>("video");
  const [models, setModels] = useState<AiModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [pickedModelId, setPickedModelId] = useState<number | null>(null);

  // ---- 项目列表 ----
  useEffect(() => {
    let cancelled = false;
    projectApi
      .list()
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        setProjectId(list[0]?.id ?? null);
      })
      .catch((error) => {
        if (cancelled) return;
        toastApiError(error, "加载项目列表失败");
        setProjects([]);
        setProjectId(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- 模型列表（生图 + 生视频一次取回，切换目标类型无需重新请求）----
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      aiModelApi.listByType(IMAGE_MODEL_TYPE),
      aiModelApi.listByType(VIDEO_MODEL_TYPE),
    ])
      .then(([imageModels, videoModels]) => {
        if (cancelled) return;
        setModels([
          ...imageModels.filter((model) => model.status === 1),
          ...videoModels.filter((model) => model.status === 1),
        ]);
      })
      .catch((error) => {
        if (cancelled) return;
        toastApiError(error, "加载生成模型失败");
        setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- 当前项目对应的分镜内容与镜头 ----
  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const found = await storyboardApi.getByProject(projectId);
        const [episodeList, sceneList, itemList] = found
          ? await Promise.all([
              storyboardApi.listEpisodes(found.id),
              storyboardApi.listScenesByStoryboard(found.id),
              storyboardApi.listItems(found.id),
            ])
          : [[], [], []];
        if (cancelled) return;
        setContent({
          projectId,
          storyboard: found,
          episodes: episodeList,
          scenes: sceneList,
          items: itemList,
        });
      } catch (error) {
        if (cancelled) return;
        toastApiError(error, "加载分镜失败");
        setContent({ projectId, storyboard: null, ...EMPTY_CONTENT });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshToken]);

  // 内容是否与当前项目匹配；不匹配即为「正在加载」
  const contentMatches = content !== null && content.projectId === projectId;
  const storyboard = contentMatches ? content.storyboard : null;
  const episodes = contentMatches ? content.episodes : EMPTY_CONTENT.episodes;
  const scenes = contentMatches ? content.scenes : EMPTY_CONTENT.scenes;
  const items = contentMatches ? content.items : EMPTY_CONTENT.items;
  const loadingStoryboard = projectId !== null && !contentMatches;

  const storyboardId = storyboard?.id ?? null;

  // ---- 目标模型：用户没显式选过（或所选不属于当前类型）时落到默认模型 ----
  const modelsOfTarget = useMemo(
    () =>
      models.filter((model) =>
        targetType === "image"
          ? model.modelType === IMAGE_MODEL_TYPE
          : model.modelType === VIDEO_MODEL_TYPE,
      ),
    [models, targetType],
  );

  const modelId = useMemo(() => {
    if (
      pickedModelId !== null &&
      modelsOfTarget.some((model) => model.id === pickedModelId)
    ) {
      return pickedModelId;
    }
    return (
      modelsOfTarget.find((model) => model.defaultModel)?.id ??
      modelsOfTarget[0]?.id ??
      null
    );
  }, [pickedModelId, modelsOfTarget]);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === modelId) ?? null,
    [models, modelId],
  );

  // ---- 派生出当前项目下生效的筛选与勾选 ----
  const activeEpisodeId = useMemo(
    () => (episodeOwner === projectId ? episodeId : null),
    [episodeOwner, projectId, episodeId],
  );
  const activeSceneId = useMemo(
    () => (sceneOwner === projectId ? sceneId : null),
    [sceneOwner, projectId, sceneId],
  );
  const activeKeyword = useMemo(
    () => (keywordOwner === projectId ? keyword : ""),
    [keywordOwner, projectId, keyword],
  );
  const activeSelectedItemIds = useMemo(
    () => (selectionOwner === projectId ? selectedItemIds : NO_IDS),
    [selectionOwner, projectId, selectedItemIds],
  );

  const changeEpisode = useCallback(
    (next: number | null) => {
      setEpisodeId(next);
      setEpisodeOwner(projectId);
      setSceneId(null);
      setSceneOwner(projectId);
    },
    [projectId],
  );

  const changeScene = useCallback(
    (next: number | null) => {
      setSceneId(next);
      setSceneOwner(projectId);
    },
    [projectId],
  );

  const changeKeyword = useCallback(
    (value: string) => {
      setKeyword(value);
      setKeywordOwner(projectId);
    },
    [projectId],
  );

  const toggleItem = useCallback(
    (id: number) => {
      const base = selectionOwner === projectId ? selectedItemIds : [];
      const next = base.includes(id)
        ? base.filter((value) => value !== id)
        : [...base, id];
      setSelectedItemIds(next);
      setSelectionOwner(projectId);
    },
    [projectId, selectionOwner, selectedItemIds],
  );

  const clearItems = useCallback(() => {
    setSelectedItemIds([]);
    setSelectionOwner(projectId);
  }, [projectId]);

  /** 当前集下可选的场次；未选集时给出全部场次 */
  const scenesOfEpisode = useMemo(() => {
    if (activeEpisodeId === null) return scenes;
    return scenes.filter((scene) => scene.episodeId === activeEpisodeId);
  }, [scenes, activeEpisodeId]);

  /** 只按集 / 场过滤、尚未套关键词的镜头集合 */
  const scopedItems = useMemo(() => {
    let result = items;
    if (activeEpisodeId !== null) {
      result = result.filter((item) => item.storyboardEpisodeId === activeEpisodeId);
    }
    if (activeSceneId !== null) {
      result = result.filter((item) => item.storyboardSceneId === activeSceneId);
    }
    return result;
  }, [items, activeEpisodeId, activeSceneId]);

  const visibleItems = useMemo(() => {
    const trimmed = activeKeyword.trim().toLowerCase();
    if (!trimmed) return scopedItems;
    return scopedItems.filter((item) => {
      const haystack = [
        item.shotNumber,
        item.autoShotNumber,
        item.shotType,
        item.cameraMovement,
        item.cameraAngle,
        item.content,
        item.sceneExpectation,
        item.dialogue,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [scopedItems, activeKeyword]);

  /** 勾选当前可见（已套筛选）的全部镜头，不覆盖已有的其它勾选 */
  const selectVisibleItems = useCallback(() => {
    const base = selectionOwner === projectId ? selectedItemIds : [];
    const merged = new Set(base);
    visibleItems.forEach((item) => merged.add(item.id));
    setSelectedItemIds([...merged]);
    setSelectionOwner(projectId);
  }, [projectId, selectionOwner, selectedItemIds, visibleItems]);

  const selectedItems = useMemo(
    () =>
      activeSelectedItemIds
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is StoryboardItem => Boolean(item)),
    [items, activeSelectedItemIds],
  );

  /** AI 写回提示词后重新拉取，保持左侧现状与数据库一致 */
  const reloadItems = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  return {
    // 项目
    projects,
    loadingProjects,
    projectId,
    setProjectId,
    // 分镜工作区
    storyboard,
    storyboardId,
    loadingStoryboard,
    // 集 / 场
    episodes,
    scenesOfEpisode,
    episodeId: activeEpisodeId,
    changeEpisode,
    sceneId: activeSceneId,
    changeScene,
    // 镜头
    items,
    visibleItems,
    scopedItemCount: scopedItems.length,
    keyword: activeKeyword,
    changeKeyword,
    selectedItemIds: activeSelectedItemIds,
    selectedItems,
    toggleItem,
    clearItems,
    selectVisibleItems,
    reloadItems,
    // 模型
    targetType,
    setTargetType,
    modelsOfTarget,
    loadingModels,
    modelId,
    setModelId: setPickedModelId,
    selectedModel,
  };
}
