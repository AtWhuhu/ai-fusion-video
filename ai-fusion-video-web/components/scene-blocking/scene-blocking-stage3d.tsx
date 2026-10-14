"use client";

import * as React from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Camera, Compass, RotateCcw } from "lucide-react";
import {
  DIST_RATIOS,
  anchorShape,
  bearingToPoint,
  cameraToPoint,
  distForRadius,
  pointToBearing,
  pointToCameraYaw,
  ringCenterPoint,
  ringItemCount,
  ringMarkerPoint,
  roleFacingDirection,
  roleToPoint,
  type SceneAnchor,
  type SceneBlocking,
  type SceneCamera,
  type ScenePoint,
} from "@/lib/scene-blocking";
import { BLOCKING_COLORS } from "@/components/scene-blocking/palette";
import type { SceneCanvasSelection } from "@/components/scene-blocking/scene-blocking-canvas";

/**
 * 3D 导演台：把同一份锚点数据摆成一个可转、可拖的实体沙盘。
 *
 * 与 2D 俯视图共用 `properties.blocking` 一处数据源 —— 在 3D 里拖动人物或机位，
 * 走的是和 2D 画布同一套反算（`pointToBearing` / `pointToCameraYaw`），落点即写回。
 *
 * ## 坐标映射
 *
 * 2D 归一化坐标 `(x, y)` → 世界 `(x·SCALE, 0, y·SCALE)`：`z = y`，所以**正北 = −Z**。
 * 与后端投影器一致：正北＝场地纵深远端，正南＝镜头来路。
 *
 * ## 场景实体
 *
 * 锚点不再是一根光秃秃的标记柱，而是按语义长成实物：主地标 → 石柱（立在祭台基座上）、
 * 环绕物 → 一圈火把、台阶类固定结构 → 三级踏步。角色是带朝向的简易人形，
 * 用来校对比例与脸朝向。全部形态由 `anchorShape` 从既有数据推断，不需要新字段。
 *
 * ## 依赖
 *
 * 只用 `@react-three/fiber` + `three`（都已在依赖里）。环绕控制器与标签投影都是自写的，
 * 没有引入 drei —— 只为 OrbitControls 和 Html 拉一整棵依赖树不划算。
 */

// ==================== 常量 ====================

/** 归一化 1.0 → 10 个世界单位；1 单位约等于「一步」 */
const SCALE = 10;
/** 地面半边长 */
const FLOOR_HALF = 11;
/** 机位所在环的半径（与 cameraToPoint 的 0.92 一致） */
const CAMERA_RING = 0.92;
/** 角色拖到锚点多近算吸附 */
const SNAP_RADIUS = 0.2;
/** 视点环绕的中心（抬到人眼高度附近，转起来才像是在场地里看） */
const CENTER = new THREE.Vector3(0, 1, 0);
/** 地面平面，用于把屏幕落点反投到场地 */
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** 俯仰档 → 机位离地高度（世界单位）。垂直俯拍与鸟瞰飞到场地上方 */
const CAMERA_HEIGHTS: Record<string, number> = {
  top: 11,
  bird: 14,
  high: 6,
  flat: 1.7,
  low: 0.9,
};

/** 祭台基座高度；台阶从这级降到地面 */
const ALTAR_HEIGHT = 0.55;
/** 石柱高度（主地标） */
const PILLAR_HEIGHT = 4;

/** 坛石配色：比地面略深的暖灰，边沿再压一圈 */
const ALTAR_FILL = "#E2DCCC";
const ALTAR_RIM = "#BFB69F";
const STONE_FILL = "#98A0A8";
const STONE_RING = "#C8CDD3";
const STEP_FILL = "#D8D2C1";
const FLAME_FILL = "#FFB25C";
const FLAME_EMISSIVE = "#FF6A1E";

const VIEW_MIN_PHI = 0.14;
const VIEW_MAX_PHI = 1.5;

const DEFAULT_VIEW = { theta: Math.PI / 2, phi: 0.95, radius: 30 };

interface StageView {
  theta: number;
  phi: number;
  radius: number;
}

type DragKind = "anchor" | "camera" | "role";

/** 装饰性线条关掉拾取：Line 的默认 raycast 阈值很宽，会误伤拖拽判定 */
const NO_RAYCAST = () => {};

/** 垂直俯拍/鸟瞰没有平面位置，只在场地上方悬着，拖不动 */
function isOverTop(camera: SceneCamera) {
  const pitch = (camera.pitch ?? "").trim().toLowerCase();
  return pitch === "top" || pitch === "bird";
}

/** 机位的世界落点 */
function cameraWorld(camera: SceneCamera): THREE.Vector3 {
  const pitch = (camera.pitch ?? "flat").trim().toLowerCase();
  const height = CAMERA_HEIGHTS[pitch] ?? CAMERA_HEIGHTS.flat;
  if (isOverTop(camera)) {
    return new THREE.Vector3(0, height, 0);
  }
  const point = cameraToPoint(camera);
  return new THREE.Vector3(point.x * SCALE, height, point.y * SCALE);
}

/** 机位视锥的线框：顶点在机位，底面落在视点处的画幅 */
function frustumPositions(from: THREE.Vector3, to: THREE.Vector3, halfW: number, halfH: number) {
  const forward = new THREE.Vector3().subVectors(to, from).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let right = new THREE.Vector3().crossVectors(forward, worldUp);
  if (right.lengthSq() < 1e-6) right = new THREE.Vector3(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const corners = [
    new THREE.Vector3().copy(to).addScaledVector(right, -halfW).addScaledVector(up, -halfH),
    new THREE.Vector3().copy(to).addScaledVector(right, halfW).addScaledVector(up, -halfH),
    new THREE.Vector3().copy(to).addScaledVector(right, halfW).addScaledVector(up, halfH),
    new THREE.Vector3().copy(to).addScaledVector(right, -halfW).addScaledVector(up, halfH),
  ];

  const positions: number[] = [];
  for (const corner of corners) {
    positions.push(from.x, from.y, from.z, corner.x, corner.y, corner.z);
  }
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  return new THREE.Float32BufferAttribute(positions, 3);
}

/** 祭台基座的几何参数：圆心与半径都由主地标 + 环绕物距离档推出 */
interface AltarSpec {
  center: ScenePoint;
  radius: number;
}

function altarSpec(anchors: SceneAnchor[]): AltarSpec | null {
  const center = ringCenterPoint(anchors);
  const ring = anchors.find((anchor) => anchor.ring);
  const radius = (ring ? DIST_RATIOS[ring.dist ?? "far"] : DIST_RATIOS.far) * SCALE;
  if (!ring && !anchors.some((anchor) => anchor.key)) return null;
  return { center, radius };
}

/** 场地某点离地高度：落在祭台范围内即坛面高度，否则地面 */
function groundHeightAt(point: ScenePoint, altar: AltarSpec | null): number {
  if (!altar) return 0;
  const d = Math.hypot(point.x * SCALE - altar.center.x * SCALE, point.y * SCALE - altar.center.y * SCALE);
  return d <= altar.radius ? ALTAR_HEIGHT : 0;
}

// ==================== 标签叠层 ====================

interface LabelItem {
  key: string;
  text: string;
  color: string;
  position: [number, number, number];
}

/**
 * 把 3D 点投影成屏幕坐标，写进 HTML 叠层里的对应节点。
 *
 * 用 HTML 而不是 3D 文字：中文字形不必打包、不受透视畸变、字号恒定清晰，
 * 而且和 2D 画布上的标注是同一套视觉。每帧直接改 DOM 样式，不走 React 重渲染。
 */
function LabelProjector({
  items,
  refs,
}: {
  items: LabelItem[];
  refs: React.RefObject<Map<string, HTMLDivElement>>;
}) {
  const { camera, size } = useThree();
  const projected = React.useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    for (const item of items) {
      const element = refs.current?.get(item.key);
      if (!element) continue;
      projected.set(item.position[0], item.position[1], item.position[2]).project(camera);
      const x = (projected.x * 0.5 + 0.5) * size.width;
      const y = (-projected.y * 0.5 + 0.5) * size.height;
      element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      element.style.opacity = projected.z < 1 ? "1" : "0";
    }
  });

  return null;
}

// ==================== 环绕 + 拾取 ====================

interface StageRigProps {
  view: React.RefObject<StageView>;
  onSelect: (selection: SceneCanvasSelection | null) => void;
  onDrag: (kind: DragKind, id: string, x: number, y: number) => void;
  /** 按下/松开时上报，由外层驱动光标样式 */
  onDragging: (dragging: boolean) => void;
}

/**
 * 相机环绕 + 图元拖拽，合在一个控制器里。
 *
 * 不依赖 R3F 的对象事件：自己 raycast 拾取。原因是环绕拖拽和图元拖拽必须互斥，
 * 而两者在 R3F 的事件系统里走不同通道，靠 stopPropagation 协调既脆又难查。
 * 这里一次 raycast 定分支 —— 命中带 `afvDrag` 标记的对象就拖它，否则转视角。
 */
function StageRig({ view, onSelect, onDrag, onDragging }: StageRigProps) {
  const { camera, gl, scene, raycaster } = useThree();
  const mode = React.useRef<
    { kind: "orbit" } | { kind: "drag"; dragKind: DragKind; id: string } | null
  >(null);
  const last = React.useRef({ x: 0, y: 0 });
  const ndc = React.useMemo(() => new THREE.Vector2(), []);
  const hitPoint = React.useMemo(() => new THREE.Vector3(), []);

  // 回调放 ref 里：拖拽过程中 blocking 每帧都变，若直接进 effect 依赖会不停重挂监听
  const handlers = React.useRef({ onSelect, onDrag, onDragging });
  React.useEffect(() => {
    handlers.current = { onSelect, onDrag, onDragging };
  });

  useFrame(() => {
    const { theta, phi, radius } = view.current ?? DEFAULT_VIEW;
    const sinPhi = Math.sin(phi);
    camera.position.set(
      CENTER.x + radius * sinPhi * Math.cos(theta),
      CENTER.y + radius * Math.cos(phi),
      CENTER.z + radius * sinPhi * Math.sin(theta)
    );
    camera.lookAt(CENTER);
  });

  React.useEffect(() => {
    const element = gl.domElement;

    const updateNdc = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    /** 命中可拖图元返回它；命中地面或空白返回 null */
    const pick = (): { kind: DragKind; id: string } | null => {
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        let node: THREE.Object3D | null = hit.object;
        while (node) {
          const drag = node.userData?.afvDrag as { kind: DragKind; id: string } | undefined;
          if (drag) return drag;
          if (node.userData?.afvGround) return null;
          node = node.parent;
        }
      }
      return null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      updateNdc(event);
      const target = pick();
      last.current = { x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
      handlers.current.onDragging(true);
      if (target) {
        mode.current = { kind: "drag", dragKind: target.kind, id: target.id };
        handlers.current.onSelect({ kind: target.kind, id: target.id });
        return;
      }
      mode.current = { kind: "orbit" };
      handlers.current.onSelect(null);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const current = mode.current;
      if (!current) return;

      if (current.kind === "orbit") {
        const dx = event.clientX - last.current.x;
        const dy = event.clientY - last.current.y;
        last.current = { x: event.clientX, y: event.clientY };
        const next = view.current ?? DEFAULT_VIEW;
        view.current = {
          theta: next.theta - dx * 0.007,
          phi: THREE.MathUtils.clamp(next.phi - dy * 0.007, VIEW_MIN_PHI, VIEW_MAX_PHI),
          radius: next.radius,
        };
        return;
      }

      updateNdc(event);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(GROUND_PLANE, hitPoint)) return;
      handlers.current.onDrag(current.dragKind, current.id, hitPoint.x / SCALE, hitPoint.z / SCALE);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      handlers.current.onDragging(false);
      mode.current = null;
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const next = view.current ?? DEFAULT_VIEW;
      view.current = {
        theta: next.theta,
        phi: next.phi,
        radius: THREE.MathUtils.clamp(next.radius * (1 + event.deltaY * 0.0012), 6, 90),
      };
    };

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointermove", handlePointerMove);
    element.addEventListener("pointerup", handlePointerUp);
    element.addEventListener("pointercancel", handlePointerUp);
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("pointermove", handlePointerMove);
      element.removeEventListener("pointerup", handlePointerUp);
      element.removeEventListener("pointercancel", handlePointerUp);
      element.removeEventListener("wheel", handleWheel);
    };
  }, [camera, gl, ndc, raycaster, scene, view, hitPoint]);

  return null;
}

// ==================== 机位图元 ====================

function CameraGizmo({ camera, selected }: { camera: SceneCamera; selected: boolean }) {
  const overTop = isOverTop(camera);
  const position = cameraWorld(camera);
  const { x, y, z } = position;
  const stroke = selected ? BLOCKING_COLORS.select : BLOCKING_COLORS.cameraStroke;

  // 只按落点三要素建几何：拖拽时相机会被重建，靠这三个原始值挡住无谓的几何重分配
  const geometry = React.useMemo(() => {
    const from = new THREE.Vector3(x, y, z);
    const length = THREE.MathUtils.clamp(from.distanceTo(CENTER), 3, 18);
    const base = new THREE.Vector3()
      .copy(from)
      .addScaledVector(new THREE.Vector3().subVectors(CENTER, from).normalize(), length);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", frustumPositions(from, base, length * 0.42, length * 0.28));
    return geo;
  }, [x, y, z]);

  React.useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group userData={overTop ? undefined : { afvDrag: { kind: "camera", id: camera.id } }}>
      <lineSegments geometry={geometry} raycast={NO_RAYCAST}>
        <lineBasicMaterial color={stroke} transparent opacity={0.7} />
      </lineSegments>
      <mesh position={position}>
        <boxGeometry args={[1.1, 0.8, 1.5]} />
        <meshStandardMaterial
          color={selected ? BLOCKING_COLORS.select : BLOCKING_COLORS.cameraFill}
        />
      </mesh>
    </group>
  );
}

// ==================== 快照捕获 ====================

/**
 * 把当前 WebGL 画面导成 PNG dataURL 的能力，注册给外层按钮调用。
 *
 * 必须在同一帧里 `render` 完立刻 `toDataURL`：即便开了 `preserveDrawingBuffer`，
 * 也不能保证浏览器没在两次调用之间清了缓冲区。
 */
function SnapshotCapture({
  captureRef,
}: {
  captureRef: React.RefObject<(() => string) | null>;
}) {
  const { gl, scene, camera } = useThree();
  React.useEffect(() => {
    captureRef.current = () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    };
    return () => {
      captureRef.current = null;
    };
  }, [gl, scene, camera, captureRef]);
  return null;
}

// ==================== 场景实体 ====================

/** 火苗：轻微摇曳的发光锥体，纯装饰不参与拾取 */
function Flame({ position }: { position: [number, number, number] }) {
  const ref = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.elapsedTime * 7 + position[0] * 3.1 + position[2] * 1.7;
    const sway = Math.sin(t) * 0.12;
    mesh.scale.set(1 + Math.sin(t * 1.3) * 0.08, 1 + Math.sin(t * 0.9) * 0.16, 1);
    mesh.rotation.z = sway;
    mesh.rotation.x = Math.cos(t * 0.8) * 0.08;
  });
  return (
    <mesh ref={ref} position={position} raycast={NO_RAYCAST}>
      <coneGeometry args={[0.11, 0.42, 10]} />
      <meshStandardMaterial
        color={FLAME_FILL}
        emissive={FLAME_EMISSIVE}
        emissiveIntensity={1.6}
      />
    </mesh>
  );
}

/** 主地标石柱：柱身 + 三道骨环 + 柱顶石帽，立在坛面上 */
function AnchorPillar({ anchor, point, selected }: {
  anchor: SceneAnchor;
  point: ScenePoint;
  selected: boolean;
}) {
  const x = point.x * SCALE;
  const z = point.y * SCALE;
  const color = selected ? BLOCKING_COLORS.select : STONE_FILL;
  const ringColor = selected ? BLOCKING_COLORS.select : STONE_RING;
  const base = ALTAR_HEIGHT;
  const ringHeights = [1.35, 2.25, 3.15];
  return (
    <group>
      <mesh
        position={[x, base + PILLAR_HEIGHT / 2, z]}
        userData={{ afvDrag: { kind: "anchor", id: anchor.id } }}
      >
        <cylinderGeometry args={[0.5, 0.58, PILLAR_HEIGHT, 24]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {ringHeights.map((h) => (
        <mesh
          key={h}
          position={[x, base + h, z]}
          rotation={[Math.PI / 2, 0, 0]}
          raycast={NO_RAYCAST}
        >
          <torusGeometry args={[0.56, 0.09, 12, 28]} />
          <meshStandardMaterial color={ringColor} roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[x, base + PILLAR_HEIGHT + 0.1, z]} raycast={NO_RAYCAST}>
        <cylinderGeometry args={[0.66, 0.5, 0.22, 24]} />
        <meshStandardMaterial color={ringColor} roughness={0.9} />
      </mesh>
    </group>
  );
}

/** 环绕物火把环：沿圆周均布火盆 + 火苗；圆周上保留可拖标记（拖它改半径） */
function AnchorTorchRing({ anchor, anchors, selected }: {
  anchor: SceneAnchor;
  anchors: SceneAnchor[];
  selected: boolean;
}) {
  const center = ringCenterPoint(anchors);
  const radius = (DIST_RATIOS[anchor.dist ?? "far"] ?? 0.88) * SCALE;
  const marker = ringMarkerPoint(anchor, anchors);
  const count = ringItemCount(anchor);
  const torches = React.useMemo(
    () =>
      Array.from({ length: count }, (_, index) => {
        // 整体偏 22.5°：让火把与可拖标记（正东南）错开，也避免火把正好压在正方位上
        const radian = ((index + 0.5) / count) * Math.PI * 2;
        return {
          key: index,
          x: center.x * SCALE + radius * Math.cos(radian),
          z: center.y * SCALE + radius * Math.sin(radian),
        };
      }),
    [center.x, center.y, count, radius]
  );

  return (
    <group>
      {torches.map((torch) => (
        <group key={torch.key}>
          <mesh position={[torch.x, ALTAR_HEIGHT + 0.55, torch.z]} raycast={NO_RAYCAST}>
            <cylinderGeometry args={[0.07, 0.09, 1.1, 10]} />
            <meshStandardMaterial color="#4A4238" roughness={0.8} />
          </mesh>
          <mesh position={[torch.x, ALTAR_HEIGHT + 1.16, torch.z]} raycast={NO_RAYCAST}>
            <cylinderGeometry args={[0.18, 0.12, 0.16, 12]} />
            <meshStandardMaterial color="#3A342C" roughness={0.8} />
          </mesh>
          <Flame position={[torch.x, ALTAR_HEIGHT + 1.52, torch.z]} />
        </group>
      ))}
      <mesh
        position={[marker.x * SCALE, ALTAR_HEIGHT + 0.45, marker.y * SCALE]}
        userData={{ afvDrag: { kind: "anchor", id: anchor.id } }}
      >
        <sphereGeometry args={[0.45, 20, 16]} />
        <meshStandardMaterial
          color={selected ? BLOCKING_COLORS.select : BLOCKING_COLORS.ringStroke}
        />
      </mesh>
    </group>
  );
}

/** 台阶：从坛沿向锚点方向铺三级踏步，降到广场地面 */
function AnchorSteps({ anchor, altar, point, selected }: {
  anchor: SceneAnchor;
  altar: AltarSpec | null;
  point: ScenePoint;
  selected: boolean;
}) {
  if (!altar) return null;
  const cx = altar.center.x * SCALE;
  const cz = altar.center.y * SCALE;
  const tx = point.x * SCALE;
  const tz = point.y * SCALE;
  const dx = tx - cx;
  const dz = tz - cz;
  const total = Math.hypot(dx, dz);
  if (total < 1e-3) return null;
  const ux = dx / total;
  const uz = dz / total;
  const color = selected ? BLOCKING_COLORS.select : STEP_FILL;
  const width = 3.2;
  // 顶阶贴着坛沿，往锚点方向铺；每级比前一级矮，最低一级落到地面
  const tiers = [
    { start: altar.radius - 1.1, depth: 1.2, height: ALTAR_HEIGHT },
    { start: altar.radius + 0.1, depth: 1.2, height: ALTAR_HEIGHT * 0.62 },
    { start: altar.radius + 1.3, depth: 1.2, height: ALTAR_HEIGHT * 0.3 },
  ];
  return (
    <group>
      {tiers.map((tier, index) => {
        const mid = tier.start + tier.depth / 2;
        return (
          <mesh
            key={index}
            position={[cx + ux * mid, tier.height / 2, cz + uz * mid]}
            rotation={[0, Math.atan2(ux, uz), 0]}
            userData={{ afvDrag: { kind: "anchor", id: anchor.id } }}
          >
            <boxGeometry args={[width, tier.height, tier.depth]} />
            <meshStandardMaterial color={color} roughness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

/** 角色人形：双腿 + 躯干 + 头，胸前一只小锥指向面朝方向；整体随朝向旋转。
 * 坐标由外层拖拽组给出，这里只在本地原点摆姿态。 */
function RoleFigure({ yaw, groundY, selected }: {
  yaw: number | null;
  groundY: number;
  selected: boolean;
}) {
  const body = selected ? BLOCKING_COLORS.select : BLOCKING_COLORS.roleStroke;
  const head = selected ? BLOCKING_COLORS.select : "#D9CBAE";
  return (
    <group position={[0, groundY, 0]} rotation={[0, yaw ?? 0, 0]}>
      {/* 双腿 */}
      <mesh position={[-0.14, 0.38, 0]} raycast={NO_RAYCAST}>
        <cylinderGeometry args={[0.09, 0.1, 0.76, 10]} />
        <meshStandardMaterial color={body} roughness={0.85} />
      </mesh>
      <mesh position={[0.14, 0.38, 0]} raycast={NO_RAYCAST}>
        <cylinderGeometry args={[0.09, 0.1, 0.76, 10]} />
        <meshStandardMaterial color={body} roughness={0.85} />
      </mesh>
      {/* 躯干：上窄下宽的收腰柱 */}
      <mesh position={[0, 1.1, 0]} raycast={NO_RAYCAST}>
        <cylinderGeometry args={[0.19, 0.26, 0.72, 14]} />
        <meshStandardMaterial color={body} roughness={0.85} />
      </mesh>
      {/* 头 */}
      <mesh position={[0, 1.63, 0]} raycast={NO_RAYCAST}>
        <sphereGeometry args={[0.17, 18, 14]} />
        <meshStandardMaterial color={head} roughness={0.6} />
      </mesh>
      {/* 朝向锥：本地 +Z 即面朝方向，随 group 旋转 */}
      <mesh position={[0, 1.12, 0.3]} rotation={[Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
        <coneGeometry args={[0.09, 0.22, 10]} />
        <meshStandardMaterial
          color={selected ? BLOCKING_COLORS.select : BLOCKING_COLORS.roleText}
        />
      </mesh>
    </group>
  );
}

// ==================== 主组件 ====================

interface SceneBlockingStage3DProps {
  blocking: SceneBlocking;
  characters: { id: number; name: string }[];
  selection: SceneCanvasSelection | null;
  onSelect: (selection: SceneCanvasSelection | null) => void;
  onChange: (next: SceneBlocking) => void;
  /** 当前分镜指定的机位锚点：高亮，并作为「切到本镜机位」的落点 */
  shotCameraId?: string | null;
  /** 导出本镜 3D 布景快照：传入了才显示导出按钮，参数是 PNG dataURL */
  onExportSnapshot?: (dataUrl: string) => Promise<void> | void;
  /** 本镜是否已有 3D 快照（仅用于底部状态提示） */
  hasSnapshot?: boolean;
}

export function SceneBlockingStage3D({
  blocking,
  characters,
  selection,
  onSelect,
  onChange,
  shotCameraId,
  onExportSnapshot,
  hasSnapshot,
}: SceneBlockingStage3DProps) {
  const [mounted, setMounted] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const view = React.useRef<StageView>({ ...DEFAULT_VIEW });
  const labelRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const captureRef = React.useRef<(() => string) | null>(null);

  // WebGL 上下文不能在服务端渲染，等挂载后再建
  React.useEffect(() => setMounted(true), []);

  const nameOf = React.useCallback(
    (assetId: string) =>
      characters.find((character) => String(character.id) === assetId)?.name ??
      `角色 ${assetId}`,
    [characters]
  );

  const shotCamera = shotCameraId
    ? blocking.cameras.find((camera) => camera.id === shotCameraId) ?? null
    : null;

  const altar = React.useMemo(() => altarSpec(blocking.anchors), [blocking.anchors]);

  /**
   * 拖动落点写回数据。
   *
   * 三条分支与 2D 画布完全同构：锚点写 bearing/dist；角色够近就吸附到锚点（写 at），
   * 否则写自由站位；机位没有平面位置，落点只用来反算 yaw。
   */
  const handleDrag = React.useCallback(
    (kind: DragKind, id: string, x: number, y: number) => {
      if (kind === "anchor") {
        const anchor = blocking.anchors.find((item) => item.id === id);
        if (anchor?.ring) {
          // 环绕物拖拽只改半径（距离档）：语义是绕主地标一圈，方位无意义
          const center = ringCenterPoint(blocking.anchors);
          const dist = distForRadius(Math.hypot(x - center.x, y - center.y));
          onChange({
            ...blocking,
            anchors: blocking.anchors.map((item) =>
              item.id === id ? { ...item, dist } : item
            ),
          });
          return;
        }
        const { bearing, dist } = pointToBearing(x, y);
        onChange({
          ...blocking,
          anchors: blocking.anchors.map((item) =>
            item.id === id ? { ...item, bearing, dist } : item
          ),
        });
        return;
      }

      if (kind === "camera") {
        onChange({
          ...blocking,
          cameras: blocking.cameras.map((camera) =>
            camera.id === id ? { ...camera, yaw: pointToCameraYaw(x, y) } : camera
          ),
        });
        return;
      }

      const role = blocking.roles[id];
      if (!role) return;

      let nearestId: string | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const anchor of blocking.anchors) {
        const point = bearingToPoint(anchor.bearing, anchor.dist);
        if (!point) continue;
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestId = anchor.id;
        }
      }

      const next =
        nearestId && nearestDistance <= SNAP_RADIUS
          ? { ...role, at: nearestId, bearing: undefined, dist: undefined }
          : { ...role, ...pointToBearing(x, y) };

      onChange({ ...blocking, roles: { ...blocking.roles, [id]: next } });
    },
    [blocking, onChange]
  );

  const focusShotCamera = React.useCallback(() => {
    if (!shotCamera) return;
    const position = cameraWorld(shotCamera);
    const dx = position.x - CENTER.x;
    const dy = position.y - CENTER.y;
    const dz = position.z - CENTER.z;
    const radius = Math.max(Math.hypot(dx, dy, dz), 0.5);
    view.current = {
      theta: Math.atan2(dz, dx),
      phi: THREE.MathUtils.clamp(
        Math.acos(THREE.MathUtils.clamp(dy / radius, -1, 1)),
        VIEW_MIN_PHI,
        VIEW_MAX_PHI
      ),
      // 站到机位上，但略往后退一点，免得近裁剪面把前景切掉
      radius: Math.max(radius - 1.2, 0.8),
    };
  }, [shotCamera]);

  const resetView = React.useCallback(() => {
    view.current = { ...DEFAULT_VIEW };
  }, []);

  /**
   * 导出当前视角的 3D 布景渲染图。
   *
   * 导出的是「导演此刻看到的这一帧」，所以用法是：先拖到自己想要的取景
   * （或点「切到本镜机位」），再导出。快照落到该镜的 custom_data，生视频时作为
   * 空间布局参考图传给多图参考模型。
   */
  const exportSnapshot = React.useCallback(async () => {
    const capture = captureRef.current;
    if (!capture || !onExportSnapshot) return;
    setExporting(true);
    try {
      await onExportSnapshot(capture());
    } finally {
      setExporting(false);
    }
  }, [onExportSnapshot]);

  // ---------- 标签 ----------
  const labels = React.useMemo<LabelItem[]>(() => {
    const items: LabelItem[] = [
      { key: "dir-n", text: "北 · 纵深远端", color: BLOCKING_COLORS.groundText, position: [0, 0.4, -FLOOR_HALF + 1.2] },
      { key: "dir-s", text: "南 · 镜头来路", color: BLOCKING_COLORS.groundText, position: [0, 0.4, FLOOR_HALF - 1.2] },
      { key: "dir-w", text: "西", color: BLOCKING_COLORS.groundText, position: [-FLOOR_HALF + 1, 0.4, 0] },
      { key: "dir-e", text: "东", color: BLOCKING_COLORS.groundText, position: [FLOOR_HALF - 1, 0.4, 0] },
    ];

    for (const anchor of blocking.anchors) {
      const point = anchor.ring
        ? ringMarkerPoint(anchor, blocking.anchors)
        : bearingToPoint(anchor.bearing, anchor.dist);
      if (!point) continue;
      const shape = anchorShape(anchor);
      const lift = shape === "pillar" ? PILLAR_HEIGHT + 0.9 : shape === "torch-ring" ? 2.4 : 2.2;
      items.push({
        key: `anchor-${anchor.id}`,
        text: `${anchor.id} ${anchor.name || "未命名"}${anchor.key ? " · 主地标" : ""}`,
        color: anchor.ring ? BLOCKING_COLORS.ringText : BLOCKING_COLORS.anchorText,
        position: [point.x * SCALE, lift, point.y * SCALE],
      });
    }

    for (const camera of blocking.cameras) {
      const position = cameraWorld(camera);
      items.push({
        key: `camera-${camera.id}`,
        text: `${camera.id} ${camera.name || "机位"}${camera.pitch ? ` · ${camera.pitch}` : ""}`,
        color: BLOCKING_COLORS.cameraText,
        position: [position.x, position.y + 0.7, position.z],
      });
    }

    for (const [assetId, role] of Object.entries(blocking.roles)) {
      const point = roleToPoint(role, blocking.anchors);
      if (!point) continue;
      items.push({
        key: `role-${assetId}`,
        text: nameOf(assetId),
        color: BLOCKING_COLORS.roleText,
        position: [point.x * SCALE, groundHeightAt(point, altar) + 2.2, point.y * SCALE],
      });
    }

    return items;
  }, [blocking, nameOf, altar]);

  const overTopCameras = blocking.cameras.filter(isOverTop);

  return (
    <div className="flex flex-col gap-2">
      {/* 光标交给外层容器：canvas 继承父级的 cursor，避免直接改 WebGL 上下文里的 DOM 样式 */}
      <div
        className="relative h-[440px] w-full overflow-hidden rounded-xl border border-border/30 bg-card/50"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        {mounted ? (
          <Canvas
            camera={{ fov: 42, near: 0.1, far: 400, position: [0, 18, 26] }}
            dpr={[1, 2]}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            onCreated={({ gl }) => {
              // 关掉色调映射：2D 与 3D 必须是同一组颜色，被 ACES 再压一道就对不上了
              gl.toneMapping = THREE.NoToneMapping;
            }}
          >
            <ambientLight intensity={1.6} />
            <directionalLight position={[12, 22, 10]} intensity={1.1} />
            <directionalLight position={[-14, 12, -8]} intensity={0.4} />

            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0, 0]}
              userData={{ afvGround: true }}
            >
              <planeGeometry args={[FLOOR_HALF * 2, FLOOR_HALF * 2]} />
              <meshStandardMaterial color={BLOCKING_COLORS.floorFill} />
            </mesh>

            <gridHelper
              args={[FLOOR_HALF * 2, 22, BLOCKING_COLORS.grid, BLOCKING_COLORS.grid]}
              position={[0, 0.01, 0]}
              raycast={NO_RAYCAST}
            />

            {/* 祭台基座：圆心随主地标、半径随环绕物距离档，台阶与火把都落在它的边沿 */}
            {altar ? (
              <group>
                <mesh
                  position={[altar.center.x * SCALE, ALTAR_HEIGHT / 2, altar.center.y * SCALE]}
                  raycast={NO_RAYCAST}
                >
                  <cylinderGeometry args={[altar.radius, altar.radius * 1.03, ALTAR_HEIGHT, 72]} />
                  <meshStandardMaterial color={ALTAR_FILL} roughness={0.95} />
                </mesh>
                <mesh
                  rotation={[-Math.PI / 2, 0, 0]}
                  position={[altar.center.x * SCALE, ALTAR_HEIGHT + 0.012, altar.center.y * SCALE]}
                  raycast={NO_RAYCAST}
                >
                  <ringGeometry args={[altar.radius - 0.55, altar.radius, 72]} />
                  <meshBasicMaterial color={ALTAR_RIM} side={THREE.DoubleSide} />
                </mesh>
              </group>
            ) : null}

            {/* 机位所在的环：拖动机位时它会吸回这个圈上，先把圈画出来 */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} raycast={NO_RAYCAST}>
              <ringGeometry args={[CAMERA_RING * SCALE - 0.06, CAMERA_RING * SCALE, 96]} />
              <meshBasicMaterial
                color={BLOCKING_COLORS.cameraStroke}
                side={THREE.DoubleSide}
                transparent
                opacity={0.35}
              />
            </mesh>

            {/* 锚点 */}
            {blocking.anchors.map((anchor) => {
              const selected = selection?.kind === "anchor" && selection.id === anchor.id;
              const shape = anchorShape(anchor);

              // 环绕物的圆周线仍然单独画（火把环组件只负责火把与标记）
              if (shape === "torch-ring") {
                const center = ringCenterPoint(blocking.anchors);
                const radius = (DIST_RATIOS[anchor.dist ?? "far"] ?? 0.88) * SCALE;
                return (
                  <group key={`ring-${anchor.id}`}>
                    <mesh
                      rotation={[-Math.PI / 2, 0, 0]}
                      position={[center.x * SCALE, ALTAR_HEIGHT + 0.03, center.y * SCALE]}
                      raycast={NO_RAYCAST}
                    >
                      <ringGeometry args={[radius - 0.1, radius, 96]} />
                      <meshBasicMaterial
                        color={selected ? BLOCKING_COLORS.select : BLOCKING_COLORS.ringStroke}
                        side={THREE.DoubleSide}
                        transparent
                        opacity={selected ? 1 : 0.7}
                      />
                    </mesh>
                    <AnchorTorchRing
                      anchor={anchor}
                      anchors={blocking.anchors}
                      selected={selected}
                    />
                  </group>
                );
              }

              const point = bearingToPoint(anchor.bearing, anchor.dist);
              if (!point) return null;

              if (shape === "pillar") {
                return (
                  <AnchorPillar
                    key={`anchor-${anchor.id}`}
                    anchor={anchor}
                    point={point}
                    selected={selected}
                  />
                );
              }
              if (shape === "steps") {
                return (
                  <AnchorSteps
                    key={`anchor-${anchor.id}`}
                    anchor={anchor}
                    altar={altar}
                    point={point}
                    selected={selected}
                  />
                );
              }

              // 通用标记柱
              const height = 1.5;
              const radius = 0.28;
              return (
                <mesh
                  key={`anchor-${anchor.id}`}
                  position={[point.x * SCALE, groundHeightAt(point, altar) + height / 2, point.y * SCALE]}
                  userData={{ afvDrag: { kind: "anchor", id: anchor.id } }}
                >
                  <cylinderGeometry args={[radius, radius, height, 20]} />
                  <meshStandardMaterial
                    color={selected ? BLOCKING_COLORS.select : BLOCKING_COLORS.anchorStroke}
                  />
                </mesh>
              );
            })}

            {/* 角色站位：人形 + 地面站位圈 */}
            {Object.entries(blocking.roles).map(([assetId, role]) => {
              const point = roleToPoint(role, blocking.anchors);
              if (!point) return null;
              const selected = selection?.kind === "role" && selection.id === assetId;
              const facing = roleFacingDirection(role, blocking.anchors);
              // three.js 里 rotation.y = atan2(dx, dz) 让本地 +Z 指向 (dx, dz)
              const yaw = facing ? Math.atan2(facing.x, facing.y) : null;
              const groundY = groundHeightAt(point, altar);
              return (
                <group key={`role-${assetId}`}>
                  <mesh
                    rotation={[-Math.PI / 2, 0, 0]}
                    position={[point.x * SCALE, groundY + 0.04, point.y * SCALE]}
                    raycast={NO_RAYCAST}
                  >
                    <circleGeometry args={[0.62, 28]} />
                    <meshBasicMaterial
                      color={BLOCKING_COLORS.roleStroke}
                      transparent
                      opacity={selected ? 0.55 : 0.25}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                  <group
                    position={[point.x * SCALE, 0, point.y * SCALE]}
                    userData={{ afvDrag: { kind: "role", id: assetId } }}
                  >
                    {/* 可拖代理体：包住人形的隐形柱，拖它比精确点人形顺手 */}
                    <mesh position={[0, groundY + 0.95, 0]} visible={false}>
                      <cylinderGeometry args={[0.42, 0.42, 1.9, 8]} />
                    </mesh>
                    <RoleFigure
                      yaw={yaw}
                      groundY={groundY}
                      selected={selected}
                    />
                  </group>
                </group>
              );
            })}

            {/* 机位 */}
            {blocking.cameras.map((camera) => (
              <CameraGizmo
                key={`camera-${camera.id}`}
                camera={camera}
                selected={
                  (selection?.kind === "camera" && selection.id === camera.id) ||
                  camera.id === shotCameraId
                }
              />
            ))}

            <StageRig
              view={view}
              onSelect={onSelect}
              onDrag={handleDrag}
              onDragging={setDragging}
            />
            <SnapshotCapture captureRef={captureRef} />
            <LabelProjector items={labels} refs={labelRefs} />
          </Canvas>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            正在准备 3D 视图…
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {labels.map((item) => (
            <div
              key={item.key}
              ref={(element) => {
                if (element) labelRefs.current.set(item.key, element);
                else labelRefs.current.delete(item.key);
              }}
              className="absolute left-0 top-0 whitespace-nowrap text-[10px] leading-none opacity-0"
              style={{ color: item.color }}
            >
              {item.text}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={focusShotCamera}
          disabled={!shotCamera}
          className="inline-flex items-center gap-1 rounded-full border border-border/40 px-2 py-0.5 transition-colors enabled:hover:border-border/70 disabled:opacity-40"
        >
          <Compass className="h-3 w-3" />
          切到本镜机位
        </button>
        <button
          type="button"
          onClick={resetView}
          className="inline-flex items-center gap-1 rounded-full border border-border/40 px-2 py-0.5 transition-colors hover:border-border/70"
        >
          <RotateCcw className="h-3 w-3" />
          复位视角
        </button>
        {onExportSnapshot ? (
          <button
            type="button"
            onClick={() => void exportSnapshot()}
            disabled={exporting}
            title="把当前视角的 3D 布景导成一张图，存为本镜的 3D 参考，生成视频时一并送给模型"
            className="inline-flex items-center gap-1 rounded-full border border-border/40 px-2 py-0.5 transition-colors enabled:hover:border-border/70 disabled:opacity-40"
          >
            <Camera className="h-3 w-3" />
            {exporting ? "导出中…" : "导出本镜 3D 视图"}
          </button>
        ) : null}
        <span className="ml-auto">
          拖动地面转视角 · 滚轮缩放 · 拖图元改位置
          {hasSnapshot ? " · 本镜 3D 快照已保存" : ""}
          {overTopCameras.length
            ? ` · ${overTopCameras.map((camera) => camera.id).join("/")} 为俯拍机位，无平面位置`
            : ""}
        </span>
      </div>
    </div>
  );
}
