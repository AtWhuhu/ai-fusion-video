/**
 * 场景空间锚点：数据契约与坐标换算。
 *
 * 契约与后端 `SceneBlockingService` 一致：锚点、机位、角色站位都挂在场景资产的
 * `properties.blocking` 上，服务端按机位投影成画面语言后注入提示词。
 *
 * 本文件额外提供「世界方位 + 距离档」与「俯视图归一化坐标」的双向换算，
 * 供俯视画布做拖拽编辑 —— 拖完立刻能反算出 bearing/dist 写回去，不需要人工推算。
 *
 * 坐标约定（与后端投影器一致）：正北 = 场地纵深远端 = 俯视图上方；x 向右为正，y 向下为正。
 */

/** 位置锚点；编号只是人机约定，不会出现在给模型的提示词里 */
export interface SceneAnchor {
  id: string;
  name: string;
  /** 全场主地标：每镜必带 */
  key?: boolean;
  /** 环绕物：每镜必带 */
  ring?: boolean;
  /** 固定结构（台阶、来路等）：每镜必带 */
  always?: boolean;
  /** 父锚点编号：填了按「父锚点的X方」表述，留空按画面绝对坐标 */
  of?: string;
  /** 世界八方位 N/NE/E/SE/S/SW/W/NW；写 C 表示落在场景轴心 */
  bearing?: string;
  /** 距离档位：touch 贴附／near 近旁／mid 中距／far 场缘 */
  dist?: string;
  /** 量化短语，如「约三尺」 */
  gap?: string;
  /** 形态与约束描述：只写材质、尺寸、是否全场唯一，**不写方位** */
  desc: string;
}

/** 机位锚点；位置由 yaw（正对的世界方位）与 pitch（俯仰档位）共同决定 */
export interface SceneCamera {
  id: string;
  name: string;
  angle: string;
  /** 运镜；填「环绕」时优先于角度匹配 */
  move?: string;
  /** 俯仰档位：top 垂直俯拍／high 斜俯／flat 平视／low 仰视／bird 鸟瞰 */
  pitch?: string;
  /** 相机正对的世界八方位；俯拍时即画面上缘对应的世界方位 */
  yaw?: string;
  desc: string;
}

/** 角色默认站位；键为角色资产 id */
export interface SceneRole {
  /** 指向锚点编号，如 P2（柱南面） */
  at: string;
  face: string;
  /** 朝向的具名对象（锚点编号），优先于 faceBearing */
  faceTo?: string;
  /** 朝向的世界八方位，会按机位投影成「面朝画面X方」 */
  faceBearing?: string;
  /** 角色在画面中的称谓，如「一名黑衣少年」；留空用角色名 */
  subject?: string;
  note?: string;
  /** 站位相对 at 锚点的细微偏移：可选 of／bearing／dist／gap，与锚点同义 */
  of?: string;
  bearing?: string;
  dist?: string;
  gap?: string;
}

export interface SceneBlocking {
  /**
   * 场景开场句：模型读到的第一句环境描述（本场景是哪儿、什么天气时辰、整体基调）。
   *
   * 后端 `SceneBlockingService` 会把它放在注入文本的最前面。**前端读到后必须原样带回去** ——
   * 早先 `readSceneBlocking` 没读这个字段，保存一次就把后端写入的 opening 抹掉了。
   */
  opening?: string;
  anchors: SceneAnchor[];
  cameras: SceneCamera[];
  /** 键为角色资产 id */
  roles: Record<string, SceneRole>;
}

export const EMPTY_SCENE_BLOCKING: SceneBlocking = {
  anchors: [],
  cameras: [],
  roles: {},
};

// ==================== 词表与档位 ====================

export const SCENE_BEARINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export const BEARING_LABELS: Record<string, string> = {
  N: "北",
  NE: "东北",
  E: "东",
  SE: "东南",
  S: "南",
  SW: "西南",
  W: "西",
  NW: "西北",
  C: "轴心",
};

const BEARING_DEGREES: Record<string, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

export const SCENE_DISTS = ["touch", "near", "mid", "far"] as const;

/** 距离档位在俯视图上的半径比例（相对画布半边长） */
export const DIST_RATIOS: Record<string, number> = {
  touch: 0.16,
  near: 0.36,
  mid: 0.62,
  far: 0.88,
};

export const DIST_LABELS: Record<string, string> = {
  touch: "贴附",
  near: "近旁",
  mid: "中距",
  far: "场缘",
};

export const CAMERA_ANGLES = ["平视", "仰视", "俯视", "鸟瞰", "荷兰角"];

export const CAMERA_PITCHES = ["top", "high", "flat", "low", "bird"];

export const PITCH_LABELS: Record<string, string> = {
  top: "垂直俯拍",
  high: "斜俯",
  flat: "平视",
  low: "仰视",
  bird: "鸟瞰",
};

// ==================== 坐标换算 ====================

export interface ScenePoint {
  x: number;
  y: number;
}

/** 落点离轴心多近算「场景轴心」 */
const CENTER_RADIUS = 0.08;

/** 世界方位 + 距离档 → 俯视图归一化坐标；方位缺失或非法时返回 null */
export function bearingToPoint(bearing?: string, dist?: string): ScenePoint | null {
  if (!bearing) return null;
  const key = bearing.trim().toUpperCase();
  if (key === "C") return { x: 0, y: 0 };
  const degree = BEARING_DEGREES[key];
  if (degree == null) return null;
  const radius = DIST_RATIOS[dist ?? "near"] ?? DIST_RATIOS.near;
  const radian = ((degree - 90) * Math.PI) / 180;
  return { x: radius * Math.cos(radian), y: radius * Math.sin(radian) };
}

/** 俯视图归一化坐标 → 最近的世界方位与距离档（拖拽落点反算） */
export function pointToBearing(x: number, y: number): { bearing: string; dist: string } {
  const radius = Math.hypot(x, y);
  return { bearing: bearingAt(x, y), dist: distForRadius(radius) };
}

/** 极坐标半径 → 最近的距离档 */
export function distForRadius(radius: number): string {
  return nearestDist(radius);
}

/** 落点 → 世界方位（不带距离档） */
export function bearingAt(x: number, y: number): string {
  const radius = Math.hypot(x, y);
  if (radius < CENTER_RADIUS) return "C";
  const degree = (Math.atan2(y, x) * 180) / Math.PI + 90;
  const normalized = ((degree % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % SCENE_BEARINGS.length;
  return SCENE_BEARINGS[index];
}

function nearestDist(radius: number): string {
  let best: string = SCENE_DISTS[0];
  let minDelta = Number.POSITIVE_INFINITY;
  for (const key of SCENE_DISTS) {
    const delta = Math.abs(DIST_RATIOS[key] - radius);
    if (delta < minDelta) {
      minDelta = delta;
      best = key;
    }
  }
  return best;
}

/**
 * 机位在俯视图上的落点。
 *
 * 相机站在「正对方向」的反侧朝场内看：yaw 为北时相机在南缘。垂直俯拍与鸟瞰没有
 * 平面朝向，统一落在左上角，靠图标区分。
 */
export function cameraToPoint(camera: SceneCamera): ScenePoint {
  const pitch = (camera.pitch ?? "flat").trim().toLowerCase();
  if (pitch === "top" || pitch === "bird") return { x: -0.76, y: -0.76 };
  const degree = BEARING_DEGREES[(camera.yaw ?? "N").trim().toUpperCase()] ?? 0;
  const radian = ((degree - 90 + 180) * Math.PI) / 180;
  const radius = 0.92;
  return { x: radius * Math.cos(radian), y: radius * Math.sin(radian) };
}

/**
 * 俯视图落点 → 机位 yaw（相机正对的世界方位）。
 *
 * 与 {@link cameraToPoint} 互为逆运算：机位站在正对方向的反侧，所以落点的极角比 yaw 大 90°。
 * 3D 导演台里拖动一个机位时用它反算 yaw。
 */
export function pointToCameraYaw(x: number, y: number): string {
  const degree = (Math.atan2(y, x) * 180) / Math.PI - 90;
  const normalized = ((degree % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % SCENE_BEARINGS.length;
  return SCENE_BEARINGS[index];
}

/** 从「P2（柱南面）」这类站位文本里取出锚点编号 */
export function extractAnchorId(text?: string): string | null {
  if (!text) return null;
  const match = text.match(/[PT]\d+/i);
  return match ? match[0].toUpperCase() : null;
}

/** 角色在俯视图上的落点：优先自身 bearing/dist，其次 at 所指锚点 */
export function roleToPoint(role: SceneRole, anchors: SceneAnchor[]): ScenePoint | null {
  if (role.bearing) return bearingToPoint(role.bearing, role.dist);
  const anchorId = extractAnchorId(role.at);
  if (!anchorId) return null;
  const anchor = anchors.find((item) => item.id === anchorId);
  if (!anchor) return null;
  return bearingToPoint(anchor.bearing, anchor.dist);
}

/** 锚点是否有可画的位置 */
export function anchorHasPosition(anchor: SceneAnchor): boolean {
  // 环绕物没有平面落点，但整体是一个可画的圆环，不算「未设方位」
  return Boolean(anchor.bearing) || Boolean(anchor.ring);
}

/**
 * 环绕物（ring）的圆心：语义是「绕主地标一圈」，所以圆心取主地标落点；
 * 场里没有主地标时退化为绕场心。
 */
export function ringCenterPoint(anchors: SceneAnchor[]): ScenePoint {
  const key = anchors.find((anchor) => anchor.key);
  const point = key ? bearingToPoint(key.bearing, key.dist) : null;
  return point ?? { x: 0, y: 0 };
}

/**
 * 环绕物在圆周上的标记落点：有方位就落在该方位的圆周上，没有方位缺省放在
 * 圆环东南侧 —— 中轴线与北侧已挤满主地标与方向标注，东南侧最空。
 */
export function ringMarkerPoint(anchor: SceneAnchor, anchors: SceneAnchor[]): ScenePoint {
  const center = ringCenterPoint(anchors);
  const radius = DIST_RATIOS[anchor.dist ?? "far"] ?? DIST_RATIOS.far;
  const radian = anchor.bearing
    ? (((BEARING_DEGREES[anchor.bearing.trim().toUpperCase()] ?? 135) - 90) * Math.PI) / 180
    : ((135 - 90) * Math.PI) / 180;
  return {
    x: center.x + radius * Math.cos(radian),
    y: center.y + radius * Math.sin(radian),
  };
}

// ==================== 形态推断 ====================

/** 锚点在 3D 舞台上的实体形态；按 key/ring/名称语义推断，不需要额外字段 */
export type AnchorShape = "pillar" | "torch-ring" | "steps" | "marker";

/**
 * 锚点该画成什么实体。
 *
 * 主地标 → 石柱（本片场的主地标是中央刑柱）；环绕物 → 火把环；
 * 名称/描述里带「台阶/阶」的固定结构 → 台阶；其余退化为通用标记柱。
 */
export function anchorShape(anchor: SceneAnchor): AnchorShape {
  if (anchor.ring) return "torch-ring";
  if (anchor.key) return "pillar";
  const text = `${anchor.name ?? ""}${anchor.desc ?? ""}`;
  if (/台阶|石阶|阶梯/.test(text)) return "steps";
  return "marker";
}

const CN_NUMERALS: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 中文数字串 → 数值：支持 十／十二／二十／二十四 等组合 */
function parseCnNumeral(text: string): number | null {
  const digit = (c: string) => CN_NUMERALS[c] ?? null;
  const tenIdx = text.indexOf("十");
  if (tenIdx === -1) return digit(text[0]);
  const tens = tenIdx === 0 ? 1 : digit(text[tenIdx - 1]);
  const ones = tenIdx + 1 < text.length ? digit(text[tenIdx + 1]) : 0;
  return (tens ?? 1) * 10 + (ones ?? 0);
}

/** 从环绕物描述里解析数量词（「立着八支火把」「十二盏石灯」→ 数值），解析不出按 8 兜底。
 * 必须锚定量词（支/根/盏…），否则会先匹配到「一圈」「一周」的「一」。 */
export function ringItemCount(anchor: SceneAnchor): number {
  const match = (anchor.desc ?? "").match(/([一二两三四五六七八九十]{1,3})(?=[支根盏个只座])/);
  const value = match ? parseCnNumeral(match[1]) : null;
  return value && value > 0 ? value : 8;
}

/** 世界方位 → 俯视图单位方向向量（归一化）；轴心或非法返回 null */
export function bearingToDirection(bearing?: string): ScenePoint | null {
  if (!bearing) return null;
  const key = bearing.trim().toUpperCase();
  if (key === "C") return null;
  const degree = BEARING_DEGREES[key];
  if (degree == null) return null;
  const radian = ((degree - 90) * Math.PI) / 180;
  return { x: Math.cos(radian), y: Math.sin(radian) };
}

/**
 * 角色面朝的单位方向向量（俯视图坐标系）。
 *
 * 优先 faceTo 所指锚点的实际方位差，其次 faceBearing —— 「面朝石柱」这种相对朝向
 * 必须按站位与目标的连线算，写死的八方位只是兜底。
 */
export function roleFacingDirection(role: SceneRole, anchors: SceneAnchor[]): ScenePoint | null {
  const from = roleToPoint(role, anchors);
  const targetId = extractAnchorId(role.faceTo);
  if (from && targetId) {
    const target = anchors.find((item) => item.id === targetId);
    const to = target ? bearingToPoint(target.bearing, target.dist) : null;
    if (to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      if (length > 1e-4) return { x: dx / length, y: dy / length };
    }
  }
  return bearingToDirection(role.faceBearing ?? role.face);
}

/** 下一个可用的锚点编号，如已有 P1/P2 则返回 P3 */
export function nextAnchorId(anchors: SceneAnchor[]): string {
  let max = 0;
  for (const anchor of anchors) {
    const match = anchor.id.match(/^P(\d+)$/i);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `P${max + 1}`;
}

/** 下一个可用的机位编号 */
export function nextCameraId(cameras: SceneCamera[]): string {
  let max = 0;
  for (const camera of cameras) {
    const match = camera.id.match(/^C(\d+)$/i);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `C${max + 1}`;
}

// ==================== 解析 ====================

function parsePlainObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** 从资产 properties 解析 blocking，结构缺失时返回空表 */
export function readSceneBlocking(properties: unknown): SceneBlocking {
  const source = parsePlainObject(properties)?.blocking;
  const blocking = parsePlainObject(source);
  if (!blocking) return EMPTY_SCENE_BLOCKING;
  return {
    opening: typeof blocking.opening === "string" ? blocking.opening : undefined,
    anchors: Array.isArray(blocking.anchors) ? (blocking.anchors as SceneAnchor[]) : [],
    cameras: Array.isArray(blocking.cameras) ? (blocking.cameras as SceneCamera[]) : [],
    roles: parsePlainObject(blocking.roles)
      ? (blocking.roles as Record<string, SceneRole>)
      : {},
  };
}

/**
 * 把资产 properties 归一化成普通对象。
 *
 * 写回时必须在原 properties 上做合并 —— 资产上还挂着 `setting`／`atmosphere` 等
 * 其他字段，整体替换会把它们抹掉。
 */
export function parseAssetProperties(properties: unknown): Record<string, unknown> {
  return parsePlainObject(properties) ?? {};
}
