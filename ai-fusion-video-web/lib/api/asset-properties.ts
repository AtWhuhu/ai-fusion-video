/**
 * 资产 properties 的归一化工具。
 *
 * 后端在读取时把 `properties` 输出为 **JSON 对象**，但历史版本/历史数据里也可能出现
 * **JSON 字符串**。任何「展开」「改写」properties 的代码都必须先经过这里归一化，
 * 否则对一个字符串做 `{ ...value }` 会得到 `{"0":"{","1":"\"",...}` 这样的垃圾数据，
 * 保存后会把真实属性整块写坏。
 *
 * 归一化后恒返回一个普通对象（无法解析时返回空对象），保证调用方拿到的形态稳定。
 */
export function normalizeAssetProperties(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};

  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    try {
      return toPlainObject(JSON.parse(text));
    } catch {
      return {};
    }
  }

  return toPlainObject(raw);
}

function toPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
