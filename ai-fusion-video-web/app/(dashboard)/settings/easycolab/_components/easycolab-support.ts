import type { EasyColabGpu, EasyColabPhase } from "@/lib/api/easycolab";

export const GPU_OPTIONS: { value: EasyColabGpu; label: string }[] = [
  { value: "G4", label: "G4（RTX PRO 6000 96GB）" },
  { value: "H100", label: "H100 80GB" },
  { value: "A100", label: "A100 40/80GB" },
  { value: "L4", label: "L4 24GB" },
  { value: "T4", label: "T4 16GB（免费额度）" },
];

export const IDLE_OPTIONS = [
  { value: "30", label: "闲置 30 分钟自动释放" },
  { value: "60", label: "闲置 60 分钟自动释放" },
  { value: "120", label: "闲置 2 小时自动释放" },
  { value: "0", label: "不自动释放" },
];

export const PHASE_LABELS: Record<EasyColabPhase, string> = {
  IDLE: "未运行",
  WAKING: "唤醒 Colab 中",
  STARTING_COMFYUI: "启动 ComfyUI 中",
  IMPORTING_WORKFLOWS: "导入工作流中",
  READY: "运行中",
  RELEASING: "释放中",
  FAILED: "失败",
};

export const BUSY_PHASES: EasyColabPhase[] = [
  "WAKING",
  "STARTING_COMFYUI",
  "IMPORTING_WORKFLOWS",
  "RELEASING",
];

export const DEPLOY_STEPS: { phase: EasyColabPhase; label: string }[] = [
  { phase: "WAKING", label: "申请 GPU 并部署 EasyColab" },
  { phase: "STARTING_COMFYUI", label: "启动 ComfyUI 隧道" },
  { phase: "IMPORTING_WORKFLOWS", label: "建立渠道并导入工作流" },
  { phase: "READY", label: "可用于生图生视频" },
];
