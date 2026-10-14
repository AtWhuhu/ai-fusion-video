"use client";

import * as React from "react";
import {
  DIST_RATIOS,
  bearingToPoint,
  cameraToPoint,
  distForRadius,
  nextAnchorId,
  pointToBearing,
  ringCenterPoint,
  ringMarkerPoint,
  roleToPoint,
  type SceneAnchor,
  type SceneBlocking,
  type SceneRole,
} from "@/lib/scene-blocking";
import { BLOCKING_COLORS } from "@/components/scene-blocking/palette";

/**
 * 场景空间俯视图（可交互）。
 *
 * 一张图同时承载三件事：锚点在哪、机位朝哪、角色站哪。拖拽即改数据 ——
 * 锚点落点反算 bearing/dist，角色落点够近就吸附到锚点（写 `at`），否则写自由站位。
 *
 * 方位基准与后端投影器一致：正北＝场地纵深远端＝画布上方。
 */

export interface SceneCanvasSelection {
  kind: "anchor" | "camera" | "role";
  id: string;
}

interface SceneBlockingCanvasProps {
  blocking: SceneBlocking;
  /** 项目内角色资产，用于把 roles 的资产 id 显示成名字 */
  characters: { id: number; name: string }[];
  selection: SceneCanvasSelection | null;
  onSelect: (selection: SceneCanvasSelection | null) => void;
  onChange: (next: SceneBlocking) => void;
  /** 供外部导出 PNG（存成场景资产的俯视图子资产） */
  svgRef?: React.Ref<SVGSVGElement>;
}

/** viewBox 半宽：归一化坐标 1.0 对应 100 个用户单位 */
const UNIT = 100;
/** 角色拖到锚点多近算吸附 */
const SNAP_RADIUS = 0.2;

// 色板与 3D 导演台共用，改色只改 palette.ts 那一处
const FLOOR_FILL = BLOCKING_COLORS.floorFill;
const FLOOR_STROKE = BLOCKING_COLORS.floorStroke;
const GRID_STROKE = BLOCKING_COLORS.grid;

const ANCHOR_FILL = BLOCKING_COLORS.anchorFill;
const ANCHOR_STROKE = BLOCKING_COLORS.anchorStroke;
const ANCHOR_TEXT = BLOCKING_COLORS.anchorText;

const RING_STROKE = BLOCKING_COLORS.ringStroke;
const RING_TEXT = BLOCKING_COLORS.ringText;

const CAMERA_FILL = BLOCKING_COLORS.cameraFill;
const CAMERA_STROKE = BLOCKING_COLORS.cameraStroke;
const CAMERA_TEXT = BLOCKING_COLORS.cameraText;

const ROLE_FILL = BLOCKING_COLORS.roleFill;
const ROLE_STROKE = BLOCKING_COLORS.roleStroke;
const ROLE_TEXT = BLOCKING_COLORS.roleText;

const SELECT_STROKE = BLOCKING_COLORS.select;

export function SceneBlockingCanvas({
  blocking,
  characters,
  selection,
  onSelect,
  onChange,
  svgRef,
}: SceneBlockingCanvasProps) {
  const dragRef = React.useRef<{ kind: "anchor" | "role"; id: string } | null>(null);

  const nameOf = React.useCallback(
    (assetId: string) =>
      characters.find((character) => String(character.id) === assetId)?.name ??
      `角色 ${assetId}`,
    [characters]
  );

  /** 屏幕坐标 → 画布归一化坐标（-1 ~ 1） */
  const toLocal = React.useCallback(
    (clientX: number, clientY: number, element: SVGSVGElement) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: 0, y: 0 };
      return {
        x: ((clientX - rect.left) / rect.width) * 2 - 1,
        y: ((clientY - rect.top) / rect.height) * 2 - 1,
      };
    },
    []
  );

  const commitAnchor = (id: string, x: number, y: number) => {
    const anchor = blocking.anchors.find((item) => item.id === id);
    if (anchor?.ring) {
      // 环绕物拖拽只改半径（距离档）：它的语义是绕主地标一圈，方位无意义
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
  };

  const commitRole = (assetId: string, x: number, y: number) => {
    const role = blocking.roles[assetId];
    if (!role) return;

    // 够近就吸附到锚点（写 at，等价于「站在该锚点上」）；
    // 否则写自由站位 bearing/dist，at 留作父锚点参照。
    let nearest: SceneAnchor | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const anchor of blocking.anchors) {
      const point = bearingToPoint(anchor.bearing, anchor.dist);
      if (!point) continue;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = anchor;
      }
    }

    const next: SceneRole =
      nearest && nearestDistance <= SNAP_RADIUS
        ? { ...role, at: nearest.id, bearing: undefined, dist: undefined }
        : { ...role, ...pointToBearing(x, y) };

    onChange({ ...blocking, roles: { ...blocking.roles, [assetId]: next } });
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toLocal(event.clientX, event.clientY, event.currentTarget);
    if (drag.kind === "anchor") commitAnchor(drag.id, point.x, point.y);
    else commitRole(drag.id, point.x, point.y);
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const startDrag = (
    event: React.PointerEvent<SVGGElement>,
    kind: "anchor" | "role",
    id: string
  ) => {
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement;
    svg?.setPointerCapture(event.pointerId);
    dragRef.current = { kind, id };
    onSelect({ kind, id });
  };

  const handleBackgroundDoubleClick = (event: React.MouseEvent<SVGRectElement>) => {
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const point = toLocal(event.clientX, event.clientY, svg);
    const { bearing, dist } = pointToBearing(point.x, point.y);
    const id = nextAnchorId(blocking.anchors);
    onChange({
      ...blocking,
      anchors: [...blocking.anchors, { id, name: "", desc: "", bearing, dist }],
    });
    onSelect({ kind: "anchor", id });
  };

  const isSelected = (kind: "anchor" | "camera" | "role", id: string) =>
    selection?.kind === kind && selection.id === id;

  const placedAnchors = blocking.anchors.filter((anchor) => anchor.bearing || anchor.ring);
  const unplacedCount = blocking.anchors.length - placedAnchors.length;
  const roles = Object.entries(blocking.roles);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full overflow-hidden rounded-xl border border-border/30 bg-card/50 p-2">
        <svg
          ref={svgRef}
          viewBox="-100 -100 200 200"
          className="w-full select-none touch-none"
          role="img"
          aria-label="场景空间俯视图"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <rect
            x={-UNIT}
            y={-UNIT}
            width={UNIT * 2}
            height={UNIT * 2}
            rx={6}
            fill={FLOOR_FILL}
            stroke={FLOOR_STROKE}
            strokeWidth={0.5}
            className="cursor-crosshair"
            onPointerDown={() => onSelect(null)}
            onDoubleClick={handleBackgroundDoubleClick}
          />

          <g stroke={GRID_STROKE} strokeWidth={0.5} strokeDasharray="3 3">
            <line x1={0} y1={-UNIT} x2={0} y2={UNIT} />
            <line x1={-UNIT} y1={0} x2={UNIT} y2={0} />
          </g>

          <g fontSize={5} fill="#888780">
            <text x={0} y={-UNIT + 7} textAnchor="middle">北 · 纵深远端</text>
            <text x={0} y={UNIT - 4} textAnchor="middle">南 · 镜头来路</text>
            <text x={-UNIT + 4} y={2}>西</text>
            <text x={UNIT - 9} y={2}>东</text>
          </g>

          {blocking.anchors
            .filter((anchor) => anchor.ring)
            .map((anchor) => {
              // 环绕物：以主地标为圆心的虚线圆，方位无关（后端也只消费它的 desc）
              const center = ringCenterPoint(blocking.anchors);
              const radius = (DIST_RATIOS[anchor.dist ?? "far"] ?? 0.88) * UNIT;
              const marker = ringMarkerPoint(anchor, blocking.anchors);
              const selected = isSelected("anchor", anchor.id);
              return (
                <g key={`ring-${anchor.id}`}>
                  <circle
                    cx={center.x * UNIT}
                    cy={center.y * UNIT}
                    r={radius}
                    fill="none"
                    stroke={selected ? SELECT_STROKE : RING_STROKE}
                    strokeWidth={selected ? 1.2 : 0.5}
                    strokeDasharray="4 4"
                  />
                  {/* 加宽的透明描边只是拖拽热区：虚线细圈用指针很难抓 */}
                  <circle
                    cx={center.x * UNIT}
                    cy={center.y * UNIT}
                    r={radius}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={3}
                    className="cursor-grab active:cursor-grabbing"
                    onPointerDown={(event) => startDrag(event, "anchor", anchor.id)}
                  />
                  <text
                    x={marker.x * UNIT + 3}
                    y={marker.y * UNIT + 1.5}
                    fontSize={5}
                    fill={RING_TEXT}
                  >
                    {anchor.id} {anchor.name || "环绕物"}
                  </text>
                </g>
              );
            })}

          {blocking.cameras.map((camera) => {
            const point = cameraToPoint(camera);
            const x = point.x * UNIT;
            const y = point.y * UNIT;
            const selected = isSelected("camera", camera.id);
            return (
              <g key={`camera-${camera.id}`}>
                <line
                  x1={x}
                  y1={y}
                  x2={0}
                  y2={0}
                  stroke={CAMERA_STROKE}
                  strokeWidth={0.5}
                  strokeDasharray="3 3"
                />
                <rect
                  x={x - 7}
                  y={y - 6}
                  width={14}
                  height={12}
                  rx={3}
                  fill={CAMERA_FILL}
                  stroke={selected ? SELECT_STROKE : CAMERA_STROKE}
                  strokeWidth={selected ? 1.5 : 0.5}
                />
                <text
                  x={x}
                  y={y}
                  fontSize={5}
                  fill={CAMERA_TEXT}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {camera.id}
                </text>
                <text x={x + 9} y={y - 4} fontSize={4.5} fill={CAMERA_TEXT}>
                  {camera.name || "机位"}
                  {camera.pitch ? ` · ${camera.pitch}` : ""}
                </text>
              </g>
            );
          })}

          {placedAnchors
            .filter((anchor) => !anchor.ring)
            .map((anchor) => {
              const point = bearingToPoint(anchor.bearing, anchor.dist);
              if (!point) return null;
              const selected = isSelected("anchor", anchor.id);
              const radius = anchor.key ? 7 : 5.5;
              return (
                <g
                  key={`anchor-${anchor.id}`}
                  className="cursor-grab active:cursor-grabbing"
                  onPointerDown={(event) => startDrag(event, "anchor", anchor.id)}
                >
                  <circle
                    cx={point.x * UNIT}
                    cy={point.y * UNIT}
                    r={radius}
                    fill={ANCHOR_FILL}
                    stroke={selected ? SELECT_STROKE : ANCHOR_STROKE}
                    strokeWidth={selected ? 1.5 : anchor.key ? 1 : 0.5}
                  />
                  <text
                    x={point.x * UNIT}
                    y={point.y * UNIT}
                    fontSize={4.5}
                    fill={ANCHOR_TEXT}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {anchor.id}
                  </text>
                  <text
                    x={point.x * UNIT + radius + 2}
                    y={point.y * UNIT + 1.5}
                    fontSize={5}
                    fill={ANCHOR_TEXT}
                  >
                    {anchor.name || "未命名"}
                    {anchor.key ? " · 主地标" : ""}
                  </text>
                </g>
              );
            })}

          {roles.map(([assetId, role]) => {
            const point = roleToPoint(role, blocking.anchors);
            if (!point) return null;
            const selected = isSelected("role", assetId);
            return (
              <g
                key={`role-${assetId}`}
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(event) => startDrag(event, "role", assetId)}
              >
                <circle
                  cx={point.x * UNIT}
                  cy={point.y * UNIT}
                  r={4.5}
                  fill={ROLE_FILL}
                  stroke={selected ? SELECT_STROKE : ROLE_STROKE}
                  strokeWidth={selected ? 1.5 : 0.5}
                />
                <text
                  x={point.x * UNIT + 6.5}
                  y={point.y * UNIT + 1.5}
                  fontSize={5}
                  fill={ROLE_TEXT}
                >
                  {nameOf(assetId)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          锚点 {blocking.anchors.length} · 机位 {blocking.cameras.length} · 角色站{" "}
          {roles.filter(([, role]) => role.at?.trim() || role.bearing).length}
        </span>
        {unplacedCount > 0 && (
          <span className="text-amber-600">
            有 {unplacedCount} 个锚点未设方位，不会出现在图上
          </span>
        )}
        <span className="ml-auto">双击空白新建锚点 · 拖动图元改位置</span>
      </div>
    </div>
  );
}
