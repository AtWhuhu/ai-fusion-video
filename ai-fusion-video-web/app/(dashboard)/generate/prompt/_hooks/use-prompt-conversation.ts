"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelPipeline,
  pipelineStream,
  type AiChatReq,
  type AiChatStreamEvent,
} from "@/lib/api/ai-pipeline";
import {
  createPendingPipelineState,
  reducePipelineEvent,
} from "@/components/dashboard/agent-pipeline/state";
import type { AgentPipelineState } from "@/components/dashboard/agent-pipeline/types";
import {
  cancelCallingTimelineTools,
  restoreOptimisticallyCancelledTimelineTools,
} from "@/lib/store/pipeline-timeline";

/** 一轮对话：用户说的话 + Agent 这一轮的运行状态 */
export interface PromptTurn {
  id: string;
  userText: string;
  state: AgentPipelineState;
  /** 这一轮是否仍在流式接收 */
  streaming: boolean;
}

function isSettled(status: AgentPipelineState["status"]): boolean {
  return status === "done" || status === "error" || status === "cancelled";
}

/**
 * 提示词生成的对话式会话。
 *
 * 与一次性 Pipeline 组件的区别：这里维护多轮 `turns`。第二轮起复用首轮拿到的
 * `conversationId`，服务端据此续用同一个 Agent 会话状态，从而保持上下文记忆。
 */
export function usePromptConversation() {
  const [turns, setTurns] = useState<PromptTurn[]>([]);
  const controllersRef = useRef(new Map<string, AbortController>());

  // 首轮之后所有请求都要带上会话 ID
  const conversationId = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const id = turns[index].state.conversationId;
      if (id) return id;
    }
    return undefined;
  }, [turns]);

  const conversationIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(
    () => () => {
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
    },
    [],
  );

  const applyEvent = useCallback((turnId: string, event: AiChatStreamEvent) => {
    setTurns((prev) =>
      prev.map((turn) => {
        if (turn.id !== turnId) return turn;
        let next: AgentPipelineState;
        try {
          next = reducePipelineEvent(turn.state, event);
        } catch (error) {
          return {
            ...turn,
            streaming: false,
            state: {
              ...turn.state,
              status: "error",
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
        if (turn.state.status === "cancelling" && next.status === "cancelling") {
          next = { ...next, timeline: cancelCallingTimelineTools(next.timeline) };
        }
        return {
          ...turn,
          state: next,
          streaming: isSettled(next.status) ? false : turn.streaming,
        };
      }),
    );
  }, []);

  /**
   * 发一轮对话。
   *
   * @param baseReq 这一轮的基础请求（Agent 类型、项目、上下文、平台 Skill）；
   *                `message` 与 `conversationId` 由本 hook 补齐。
   */
  const send = useCallback(
    (baseReq: Omit<AiChatReq, "message" | "conversationId">, userText: string) => {
      const text = userText.trim();
      if (!text) return;

      const turnId = `turn-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const req: AiChatReq = {
        ...baseReq,
        message: text,
        ...(conversationIdRef.current
          ? { conversationId: conversationIdRef.current }
          : {}),
      };

      setTurns((prev) => [
        ...prev,
        {
          id: turnId,
          userText: text,
          state: createPendingPipelineState(),
          streaming: true,
        },
      ]);

      const controller = pipelineStream(req, {
        onEvent: (event) => applyEvent(turnId, event),
        onError: (error) => {
          setTurns((prev) =>
            prev.map((turn) =>
              turn.id === turnId
                ? {
                    ...turn,
                    streaming: false,
                    state: {
                      ...turn.state,
                      status: "error",
                      error: `连接中断：${error.message}`,
                    },
                  }
                : turn,
            ),
          );
        },
        // 终止状态一律由 journal 事件约简得出，不以传输结束作为业务结束
        onComplete: () => undefined,
      });

      controllersRef.current.set(turnId, controller);
    },
    [applyEvent],
  );

  const cancel = useCallback(async () => {
    const active = [...turns]
      .reverse()
      .find((turn) => turn.streaming && turn.state.runId);
    if (!active?.state.runId) return;
    const runId = active.state.runId;
    const previousState = active.state;

    setTurns((prev) =>
      prev.map((turn) =>
        turn.id === active.id
          ? {
              ...turn,
              state: {
                ...turn.state,
                status: "cancelling",
                error: undefined,
                timeline: cancelCallingTimelineTools(turn.state.timeline),
              },
            }
          : turn,
      ),
    );

    try {
      await cancelPipeline({ runId });
      // 继续消费流，直到持久的 CANCELLED 终止事件到达
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === active.id && turn.state.status === "cancelling"
            ? {
                ...turn,
                state: {
                  ...turn.state,
                  status: previousState.status,
                  timeline: restoreOptimisticallyCancelledTimelineTools(
                    turn.state.timeline,
                    previousState.timeline,
                  ),
                  error: message,
                },
              }
            : turn,
        ),
      );
    }
  }, [turns]);

  const isStreaming = turns.some((turn) => turn.streaming);

  const reset = useCallback(() => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    setTurns([]);
  }, []);

  return { turns, isStreaming, conversationId, send, cancel, reset };
}
