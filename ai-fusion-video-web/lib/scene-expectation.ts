/**
 * 历史数据兼容：to-fusion.mjs 曾把锚点文本直接写进 scene_expectation（剑骨 483 条）。
 * 系统改为按镜注入 spatialBlock 后，旧数据里的锚点段会与 spatialBlock 重复注入，
 * 故在 spatialBlock 存在时先剥离 baked 锚点段，让 scene_expectation 回归纯画面期望。
 *
 * 标记与后端 SceneBlockingService.stripBakedAnchors 保持一致（双实现需同步修改）。
 * baked 锚点段视为延续到下一个标记或文末：标记之后的内容一律按 baked 处理。
 */

// 全角方括号用 fromCharCode 构造（0x3010/0x3011），切勿改回字面量，否则落盘时会被清洗。
const LBR = String.fromCharCode(0x3010);
const RBR = String.fromCharCode(0x3011);

/** baked 锚点段的起止标记（与后端保持一致） */
const BAKED_ANCHOR_MARKERS = [
  `${LBR}空间锚点${RBR}`,
  `${LBR}机位方位${RBR}`,
  `${LBR}人物站位${RBR}`,
] as const;

/** 恒定声明残句（baked 文本的收尾） */
const BAKED_CONSTANT_TAIL =
  "同一场景内上述锚点位置、机位方位与主体站位全程恒定，不得随镜头改变。";

/** Veo `Space:` 行注入残留 */
const BAKED_SPACE_LINE = /^Space:.*$/gim;

/**
 * 剥离 `scene_expectation` 里历史 baked 的锚点文本。
 * 纯画面期望原样返回；null/undefined/空返回 ""。
 */
export function stripBakedSpatialAnchors(text: string | null | undefined): string {
  if (!text) {
    return "";
  }
  let result = text.replace(BAKED_SPACE_LINE, "");
  for (const marker of BAKED_ANCHOR_MARKERS) {
    let idx = result.indexOf(marker);
    while (idx !== -1) {
      let end = result.length;
      for (const other of BAKED_ANCHOR_MARKERS) {
        if (other === marker) {
          continue;
        }
        const j = result.indexOf(other, idx + marker.length);
        if (j !== -1 && j < end) {
          end = j;
        }
      }
      result = result.slice(0, idx) + result.slice(end);
      idx = result.indexOf(marker);
    }
  }
  result = result.split(BAKED_CONSTANT_TAIL).join("");
  // 收敛残留空白：多空格压单、3+ 连续换行压成双换行、去首尾空白
  return result
    .replace(/[ \t　]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
