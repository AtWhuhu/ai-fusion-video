/**
 * 场景锚点视图的统一配色。
 *
 * 2D 俯视图（SVG）与 3D 导演台（WebGL）共用同一份色板 —— 同一个图元在两边必须是同一个颜色，
 * 否则导演在两种视图之间切换时会以为看错了东西。改色只改这里。
 */
export const BLOCKING_COLORS = {
  /** 地面 */
  floorFill: "#F1EFE8",
  floorStroke: "#B4B2A9",
  grid: "#D3D1C7",
  groundText: "#888780",

  /** 位置锚点 */
  anchorFill: "#E6F1FB",
  anchorStroke: "#185FA5",
  anchorText: "#0C447C",

  /** 环绕物 */
  ringStroke: "#D4537E",
  ringText: "#993556",

  /** 机位 */
  cameraFill: "#EEEDFE",
  cameraStroke: "#534AB7",
  cameraText: "#3C3489",

  /** 角色站位 */
  roleFill: "#E1F5EE",
  roleStroke: "#0F6E56",
  roleText: "#085041",

  /** 选中态描边 */
  select: "#BA7517",
} as const;
