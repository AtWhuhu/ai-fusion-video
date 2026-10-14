"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Loader2, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { AgentPipelineTimeline } from "@/components/dashboard/agent-pipeline/timeline";
import type { AgentPipelineState } from "@/components/dashboard/agent-pipeline/types";
import { cn } from "@/lib/utils";
import type { PromptTurn } from "../_hooks/use-prompt-conversation";

const QUICK_PROMPTS = [
  "先把这个镜头现有的提示词原样列出来给我看",
  "按当前平台规范，重写这个镜头的视频提示词",
  "画面再暗一点，加一点侧逆光，人物表情更紧张",
  "精简到 80 字以内，保留核心动作与运镜",
];

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/12 px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-foreground">
        {text}
      </div>
    </div>
  );
}

function TurnStatusLine({
  state,
  streaming,
}: {
  state: AgentPipelineState;
  streaming: boolean;
}) {
  if (streaming) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {state.status === "reasoning" ? "正在思考…" : "正在处理…"}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-destructive">
        <XCircle className="h-3 w-3" />
        {state.error ?? "本轮出错"}
      </div>
    );
  }
  if (state.status === "cancelled") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <XCircle className="h-3 w-3" />
        已取消
      </div>
    );
  }
  return null;
}

export interface PromptConversationPanelProps {
  turns: PromptTurn[];
  isStreaming: boolean;
  /** 运行前的前置条件是否满足 */
  ready: boolean;
  /** 条件不满足时提示缺什么 */
  readyHint: string;
  /** 顶部显示当前任务上下文 */
  contextSummary: string;
  onSend: (text: string) => void;
  onCancel: () => void;
  onReset: () => void;
  /** 一轮写回完成后刷新镜头现状 */
  onRefresh?: () => void;
}

/**
 * 右栏对话区：多轮对话式生成，复用 Pipeline 的时间线与工具调用渲染。
 */
export function PromptConversationPanel({
  turns,
  isStreaming,
  ready,
  readyHint,
  contextSummary,
  onSend,
  onCancel,
  onReset,
  onRefresh,
}: PromptConversationPanelProps) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const lastTurn = turns[turns.length - 1];

  // 有新内容时贴底
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [turns]);

  // 一轮结束（可能已写回分镜）后刷新左侧现状
  useEffect(() => {
    if (!lastTurn || lastTurn.streaming) return;
    if (lastTurn.state.status !== "done") return;
    onRefresh?.();
  }, [lastTurn, onRefresh]);

  const canSend = useMemo(
    () => ready && !isStreaming && draft.trim().length > 0,
    [ready, isStreaming, draft],
  );

  const submit = () => {
    if (!canSend) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部条 */}
      <div className="flex items-center justify-between gap-3 border-b border-border/30 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 text-sm font-semibold">提示词生成</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {contextSummary}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isStreaming && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border/40 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              取消
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            disabled={turns.length === 0 && !isStreaming}
            className="flex items-center gap-1 rounded-lg border border-border/40 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-40"
          >
            <RotateCcw className="h-3 w-3" />
            重新开始
          </button>
        </div>
      </div>

      {/* 对话区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">对话式生成提示词</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                左侧选好项目、分镜、镜头与目标模型，这里就能读取镜头已有提示词，
                并按对应平台的写法规范重写。
              </p>
            </div>
            {!ready && readyHint && (
              <p className="rounded-lg bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
                {readyHint}
              </p>
            )}
            {ready && (
              <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setDraft(prompt)}
                    className="rounded-full border border-border/40 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className="space-y-2.5">
              <UserBubble text={turn.userText} />
              <AgentPipelineTimeline
                timeline={turn.state.timeline}
                isActive={turn.streaming}
              />
              <TurnStatusLine state={turn.state} streaming={turn.streaming} />
            </div>
          ))
        )}
      </div>

      {/* 输入区 */}
      <div className="border-t border-border/30 px-4 py-3">
        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl border border-border/40 bg-muted/25 p-1.5",
            "transition-colors focus-within:border-primary/40",
          )}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={
              ready ? "说说你想怎么改，Enter 发送，Shift+Enter 换行" : readyHint
            }
            disabled={!ready || isStreaming}
            className={cn(
              "max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed outline-none",
              "placeholder:text-muted-foreground/70 disabled:cursor-not-allowed",
            )}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-colors",
              canSend
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-foreground/10 text-muted-foreground/60",
            )}
            aria-label="发送"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
