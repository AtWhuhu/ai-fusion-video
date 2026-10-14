import type { AiModel } from "@/lib/api/ai-model";

/**
 * 目标模型 → 平台提示词规范 Skill 的映射。
 *
 * 「加载对应平台 skill」的实现方式：用户选定目标模型后，这里按模型 code 前缀
 * 推断出该模型所属平台，再映射到应用 Skill 库里那台平台的官方提示词规范。
 * 推断失败时按模型类型落到通用规范，保证任何模型都能拿到一份可用的写法约束。
 */

export const IMAGE_MODEL_TYPE = 2;
export const VIDEO_MODEL_TYPE = 3;

interface PlatformSkillRule {
  /** 命中模型 code 子串（小写）即采用 */
  match: string[];
  skill: string;
  label: string;
}

/** 视频平台规范：先匹配到的优先 */
const VIDEO_RULES: PlatformSkillRule[] = [
  { match: ["veo"], skill: "veo-manual", label: "Veo 官方写法" },
  { match: ["kling", "kwaipilot"], skill: "kling-prompt-library", label: "可灵提示词库" },
  { match: ["seedance", "jimeng", "doubao"], skill: "seedance-manual", label: "Seedance 分镜公式" },
  { match: ["sora"], skill: "sora-prompt-zh", label: "Sora 中文指南" },
  { match: ["omni", "lanshu"], skill: "lanshu-video-kit", label: "通用视频工具包" },
  { match: ["wan", "hailuo", "minimax", "runway", "pika", "luma", "vidu", "grok"], skill: "visual-skills-video", label: "通用视频规范" },
];

/** 生图平台规范 */
const IMAGE_RULES: PlatformSkillRule[] = [
  { match: ["nano-banana", "nbp", "nb2"], skill: "visual-skills-image", label: "Nano Banana 规范" },
  { match: ["gemini", "imagen", "gtv", "banana"], skill: "visual-skills-image", label: "Gemini 图像规范" },
  { match: ["gpt-image", "dall", "dalle", "openai"], skill: "visual-skills-image", label: "GPT Image 规范" },
  { match: ["flux", "midjourney", "mj", "sd", "stable"], skill: "prompt-gallery", label: "通用图像词库" },
];

const VIDEO_FALLBACK: PlatformSkillRule = {
  match: [],
  skill: "video-prompting-guide",
  label: "通用视频规范",
};
const IMAGE_FALLBACK: PlatformSkillRule = {
  match: [],
  skill: "image-prompt-engineering",
  label: "通用生图规范",
};

export interface PlatformSkillMatch {
  /** 应用 Skill 名，用于请求体的 enabledSkills */
  skill: string;
  /** 展示给用户的平台规范名 */
  label: string;
}

/** 按模型推断应加载的平台提示词规范 Skill。 */
export function resolvePlatformSkill(model: AiModel | null | undefined): PlatformSkillMatch | null {
  if (!model) return null;
  const isImage = model.modelType === IMAGE_MODEL_TYPE;
  const rules = isImage ? IMAGE_RULES : VIDEO_RULES;
  const haystack = `${model.code} ${model.name} ${model.capabilityPresetCode ?? ""}`.toLowerCase();
  for (const rule of rules) {
    if (rule.match.some((token) => haystack.includes(token))) {
      return { skill: rule.skill, label: rule.label };
    }
  }
  const fallback = isImage ? IMAGE_FALLBACK : VIDEO_FALLBACK;
  return { skill: fallback.skill, label: fallback.label };
}

/** 模型平台短名，用于在 UI 上做一栏简介。 */
export function describeModelPlatform(model: AiModel | null | undefined): string {
  if (!model) return "未选择模型";
  const code = model.code.toLowerCase();
  if (code.includes("veo")) return "Google Veo";
  if (code.includes("kling")) return "可灵 Kling";
  if (code.includes("seedance") || code.includes("jimeng")) return "Seedance / 即梦";
  if (code.includes("sora")) return "OpenAI Sora";
  if (code.includes("omni")) return "Omni";
  if (code.includes("gemini") || code.includes("imagen")) return "Google Gemini / Imagen";
  if (code.includes("gpt-image")) return "OpenAI Image";
  return model.modelType === IMAGE_MODEL_TYPE ? "生图模型" : "生视频模型";
}
