"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import type { AiChatReq } from "@/lib/api/ai-pipeline";
import { PromptConversationPanel } from "./_components/prompt-conversation-panel";
import { PromptSetupPanel } from "./_components/prompt-setup-panel";
import { usePromptConversation } from "./_hooks/use-prompt-conversation";
import { usePromptWorkspace } from "./_hooks/use-prompt-workspace";
import {
  describeModelPlatform,
  resolvePlatformSkill,
} from "./_lib/platform-skills";

const CONTAINER_VARIANTS = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.45,
      ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
    },
  },
};

export default function PromptWriterPage() {
  const workspace = usePromptWorkspace();
  const conversation = usePromptConversation();
  const { reset: resetConversation } = conversation;

  const {
    projects,
    loadingProjects,
    projectId,
    setProjectId,
    storyboard,
    storyboardId,
    loadingStoryboard,
    episodes,
    scenesOfEpisode,
    episodeId,
    changeEpisode,
    sceneId,
    changeScene,
    items,
    visibleItems,
    scopedItemCount,
    keyword,
    changeKeyword,
    selectedItemIds,
    toggleItem,
    clearItems,
    selectVisibleItems,
    reloadItems,
    targetType,
    setTargetType,
    modelsOfTarget,
    loadingModels,
    modelId,
    setModelId,
    selectedModel,
  } = workspace;

  const platformSkill = resolvePlatformSkill(selectedModel);

  /**
   * 选择变化意味着任务上下文变了：旧的会话不再适用，直接开新会话，
   * 避免模型拿着上一批镜头的信息继续聊。
   */
  const contextKey = `${projectId ?? "-"}|${storyboardId ?? "-"}|${targetType}|${modelId ?? "-"}`;
  const contextKeyRef = useRef(contextKey);
  useEffect(() => {
    if (contextKeyRef.current === contextKey) return;
    contextKeyRef.current = contextKey;
    resetConversation();
  }, [contextKey, resetConversation]);

  const readyHint = useMemo(() => {
    if (loadingProjects || loadingStoryboard) return "正在加载项目…";
    if (projectId === null) return "请先在左侧选择项目";
    if (!storyboard) return "该项目尚未初始化分镜";
    if (selectedItemIds.length === 0) return "请先在左侧勾选至少一个镜头";
    if (modelId === null) return "请先在左侧选择目标模型";
    return "";
  }, [
    loadingProjects,
    loadingStoryboard,
    projectId,
    storyboard,
    selectedItemIds.length,
    modelId,
  ]);

  const ready = readyHint === "";

  const buildBaseRequest = useCallback(():
    | Omit<AiChatReq, "message" | "conversationId">
    | null => {
    if (
      !ready ||
      projectId === null ||
      storyboardId === null ||
      modelId === null
    ) {
      return null;
    }
    return {
      agentType: "prompt_writer",
      category: "prompt_writer",
      title: `提示词生成：${selectedModel?.name ?? "目标模型"}`,
      projectId,
      // 注意：不要传 modelId。它是 Agent 自己用的大模型（后端 modelService.getById），
      // 生图/生视频模型只通过 context 的 targetModelName / targetModelType 告知 Agent。
      toolExecutionMode: "FULL_ACCESS",
      context: {
        storyboardId,
        targetModelName: selectedModel?.name ?? "",
        targetModelType: targetType,
        selectedStoryboardItemIds: selectedItemIds,
        activePlatformSkill: platformSkill?.skill ?? "",
        activePlatformSkillLabel: platformSkill?.label ?? "",
      },
      enabledSkills: platformSkill ? [platformSkill.skill] : undefined,
    };
  }, [
    ready,
    projectId,
    storyboardId,
    modelId,
    selectedModel,
    targetType,
    selectedItemIds,
    platformSkill,
  ]);

  const handleSend = useCallback(
    (text: string) => {
      const base = buildBaseRequest();
      if (!base) return;
      conversation.send(base, text);
    },
    [buildBaseRequest, conversation],
  );

  const handleRefresh = useCallback(() => {
    void reloadItems();
  }, [reloadItems]);

  const contextSummary = useMemo(() => {
    if (!ready) return "尚未就绪";
    const projectName =
      projects.find((project) => project.id === projectId)?.name ?? "—";
    const storyboardTitle = storyboard?.title?.trim() || "分镜";
    return `${projectName} · ${storyboardTitle} · ${selectedItemIds.length} 个镜头 · ${describeModelPlatform(
      selectedModel,
    )}`;
  }, [
    ready,
    projects,
    projectId,
    storyboard,
    selectedItemIds.length,
    selectedModel,
  ]);

  return (
    <motion.div
      className="flex min-h-0 flex-col"
      variants={CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
    >
      {/* ========== 页面标题 ========== */}
      <motion.div variants={ITEM_VARIANTS} className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">提示词生成</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          选定项目与分镜镜头，挂上目标模型对应的平台写法规范，用对话把提示词改到满意再写回分镜。
        </p>
      </motion.div>

      {/* ========== 工作区 ========== */}
      <motion.div
        variants={ITEM_VARIANTS}
        className="flex h-[calc(100dvh-6.5rem)] min-h-[540px] flex-col gap-4 lg:flex-row"
      >
        {/* 左栏：配置 */}
        <aside className="min-h-0 shrink-0 overflow-y-auto rounded-2xl border border-border/30 bg-card/50 p-4 backdrop-blur-sm lg:w-[330px]">
          <PromptSetupPanel
            projects={projects}
            loadingProjects={loadingProjects}
            projectId={projectId}
            onProjectChange={setProjectId}
            storyboard={storyboard}
            loadingStoryboard={loadingStoryboard}
            itemTotal={items.length}
            episodes={episodes}
            episodeId={episodeId}
            onEpisodeChange={changeEpisode}
            scenesOfEpisode={scenesOfEpisode}
            sceneId={sceneId}
            onSceneChange={changeScene}
            visibleItems={visibleItems}
            scopedItemCount={scopedItemCount}
            loadingItems={loadingStoryboard}
            keyword={keyword}
            onKeywordChange={changeKeyword}
            selectedItemIds={selectedItemIds}
            onToggleItem={toggleItem}
            onSelectVisibleItems={selectVisibleItems}
            onClearItems={clearItems}
            targetType={targetType}
            onTargetTypeChange={setTargetType}
            modelsOfTarget={modelsOfTarget}
            loadingModels={loadingModels}
            modelId={modelId}
            onModelChange={setModelId}
            selectedModel={selectedModel}
            disabled={conversation.isStreaming}
          />
        </aside>

        {/* 右栏：对话 */}
        <section className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl border border-border/30 bg-card/50 backdrop-blur-sm">
          <PromptConversationPanel
            turns={conversation.turns}
            isStreaming={conversation.isStreaming}
            ready={ready}
            readyHint={readyHint}
            contextSummary={contextSummary}
            onSend={handleSend}
            onCancel={() => void conversation.cancel()}
            onReset={conversation.reset}
            onRefresh={handleRefresh}
          />
        </section>
      </motion.div>
    </motion.div>
  );
}
