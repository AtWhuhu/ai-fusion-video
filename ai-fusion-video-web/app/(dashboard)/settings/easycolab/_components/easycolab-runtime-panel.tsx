"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Loader2, Power, Rocket } from "lucide-react";
import { toast } from "sonner";
import type { EasyColabGpu, EasyColabState } from "@/lib/api/easycolab";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { settingsTypography } from "../../_shared";
import { BUSY_PHASES, DEPLOY_STEPS, GPU_OPTIONS, IDLE_OPTIONS, PHASE_LABELS } from "./easycolab-support";

interface EasyColabRuntimePanelProps {
  state: EasyColabState | null;
  authorized: boolean;
  onWake: (gpu: EasyColabGpu, idleTimeoutMinutes: number) => void;
  onRelease: () => void;
}

export function EasyColabRuntimePanel({ state, authorized, onWake, onRelease }: EasyColabRuntimePanelProps) {
  const [gpu, setGpu] = useState<EasyColabGpu>("G4");
  const [idle, setIdle] = useState("30");
  const phase = state?.phase ?? "IDLE";
  const busy = BUSY_PHASES.includes(phase);
  const running = phase === "READY";
  const stepIndex = DEPLOY_STEPS.findIndex((s) => s.phase === phase);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border/30 bg-card/50 p-5 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">Colab GPU 实例</h2>
            <Badge variant={running ? "default" : phase === "FAILED" ? "destructive" : "secondary"}>
              {PHASE_LABELS[phase]}
            </Badge>
          </div>
          <p className={settingsTypography.sectionDescription}>
            {state?.message || "唤醒后自动部署 EasyColab + ComfyUI，并在 AI 配置里建立「EasyColab ComfyUI」渠道"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {(running || phase === "FAILED") && (
            <Button variant="destructive-ghost" onClick={onRelease}>
              <Power />
              释放
            </Button>
          )}
          {!running && (
            <span title={authorized ? undefined : "请先完成 Google 授权"}>
              <Button disabled={!authorized || busy} onClick={() => onWake(gpu, Number(idle))}>
                {busy ? <Loader2 className="animate-spin" /> : <Rocket />}
                {busy ? PHASE_LABELS[phase] : "一键唤醒"}
              </Button>
            </span>
          )}
        </div>
      </div>

      {!running && !busy && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className={settingsTypography.fieldLabel}>GPU</Label>
            <Select value={gpu} onValueChange={(v) => setGpu(v as EasyColabGpu)} items={GPU_OPTIONS}>
              <SelectTrigger className="w-full text-sm">
                <SelectValue placeholder="选择 GPU" />
              </SelectTrigger>
              <SelectContent className="text-sm">
                <SelectGroup>
                  {GPU_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-sm">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className={settingsTypography.fieldLabel}>省额度</Label>
            <Select value={idle} onValueChange={(v) => setIdle(v as string)} items={IDLE_OPTIONS}>
              <SelectTrigger className="w-full text-sm">
                <SelectValue placeholder="闲置释放" />
              </SelectTrigger>
              <SelectContent className="text-sm">
                <SelectGroup>
                  {IDLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-sm">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {(busy || running) && phase !== "RELEASING" && (
        <ol className="grid gap-2 sm:grid-cols-4">
          {DEPLOY_STEPS.map((step, i) => {
            const done = running || i < stepIndex;
            const active = i === stepIndex && !running;
            return (
              <li
                key={step.phase}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border/20 bg-background/70 p-3 text-xs",
                  active ? "text-foreground" : done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {done ? (
                  <Check className="size-3.5 text-primary" />
                ) : active ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <span className="size-3.5 rounded-full border border-border/40" />
                )}
                {step.label}
              </li>
            );
          })}
        </ol>
      )}

      {running && state && <RuntimeSummary state={state} />}
    </section>
  );
}

function RuntimeSummary({ state }: { state: EasyColabState }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/20 bg-background/70 p-3">
      <CopyRow label="ComfyUI 地址" value={state.comfyUiUrl} />
      <CopyRow label="EasyColab 控制台" value={state.serviceUrl} />
      <p className={settingsTypography.metadata}>
        管理用户名 easycolab，密码已写入渠道配置。新导入 {state.importedWorkflowCount ?? 0} 个预置视频工作流（草稿），
        在 EasyColab 控制台安装对应预设包的模型后，到{" "}
        <Link href="/settings/ai-models" className="text-primary underline-offset-4 hover:underline">
          AI 配置
        </Link>{" "}
        验证、试运行并发布即可用于生成。
      </p>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    toast.success(`已复制${label}`);
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className={settingsTypography.fieldLabel}>{label}</div>
        <div className="truncate font-mono text-xs text-foreground">{value}</div>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label={`复制${label}`} onClick={copy}>
        <Copy />
      </Button>
    </div>
  );
}
