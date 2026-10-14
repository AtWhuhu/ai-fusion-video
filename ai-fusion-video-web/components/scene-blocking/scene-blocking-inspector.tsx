"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SceneCanvasSelection } from "@/components/scene-blocking/scene-blocking-canvas";
import {
  BEARING_LABELS,
  CAMERA_ANGLES,
  CAMERA_PITCHES,
  DIST_LABELS,
  PITCH_LABELS,
  SCENE_BEARINGS,
  SCENE_DISTS,
  type SceneAnchor,
  type SceneBlocking,
  type SceneCamera,
  type SceneRole,
} from "@/lib/scene-blocking";
import { Trash2 } from "lucide-react";

/**
 * 俯视图右侧的属性面板：编辑当前选中的锚点／机位／角色站位。
 *
 * 与画布是同一份数据的两个视图 —— 图上拖位置，这里的下拉改档位，两边实时同步。
 */

interface SceneBlockingInspectorProps {
  blocking: SceneBlocking;
  selection: SceneCanvasSelection | null;
  characters: { id: number; name: string }[];
  onChange: (next: SceneBlocking) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Picker({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-xl border border-border/30 bg-background/70 px-2 text-[11px]"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

const BEARING_OPTIONS = [
  { value: "C", label: "轴心（场地正中）" },
  ...SCENE_BEARINGS.map((bearing) => ({
    value: bearing,
    label: `${BEARING_LABELS[bearing]}（${bearing}）`,
  })),
];

const DIST_OPTIONS = SCENE_DISTS.map((dist) => ({
  value: dist,
  label: `${DIST_LABELS[dist]}（${dist}）`,
}));

export function SceneBlockingInspector({
  blocking,
  selection,
  characters,
  onChange,
}: SceneBlockingInspectorProps) {
  if (!selection) {
    // 未选中任何图元时展示场景级字段：开场句属于整个场景，不属于某个锚点，
    // 放在这里正好是「什么都没选」的默认态，不用单独占一行版面。
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border/30 bg-card/50 p-3">
        <h3 className="text-xs font-medium">场景开场句</h3>
        <p className="text-[10px] leading-4 text-muted-foreground">
          模型读到的第一句环境描述。写「这是什么地方、什么天气时辰、整体基调」，
          不要写人物站位与镜头。
        </p>
        <Textarea
          value={blocking.opening ?? ""}
          placeholder="如 夜里一座环形石坛，坛面平整，四周空旷无人"
          onChange={(event) =>
            onChange({ ...blocking, opening: event.target.value })
          }
          className="min-h-20 rounded-xl text-[11px]"
        />
        <div className="rounded-lg border border-dashed border-border/40 bg-background/50 px-3 py-4 text-center">
          <p className="text-[11px] text-muted-foreground">
            在俯视图上点选一个图元
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            双击空白处可新建锚点
          </p>
        </div>
      </div>
    );
  }

  if (selection.kind === "anchor") {
    const anchor = blocking.anchors.find((item) => item.id === selection.id);
    if (!anchor) return null;
    const patch = (next: Partial<SceneAnchor>) =>
      onChange({
        ...blocking,
        anchors: blocking.anchors.map((item) =>
          item.id === anchor.id ? { ...item, ...next } : item
        ),
      });
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border/30 bg-card/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium">位置锚点</h3>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="删除锚点"
            onClick={() =>
              onChange({
                ...blocking,
                anchors: blocking.anchors.filter((item) => item.id !== anchor.id),
              })
            }
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Row label="编号">
            <Input
              value={anchor.id}
              onChange={(event) => patch({ id: event.target.value })}
              className="h-8 rounded-xl text-[11px] font-mono"
            />
          </Row>
          <Row label="名称">
            <Input
              value={anchor.name}
              placeholder="如 中央刑柱"
              onChange={(event) => patch({ name: event.target.value })}
              className="h-8 rounded-xl text-[11px]"
            />
          </Row>
          <Row label="方位">
            <Picker
              value={(anchor.bearing ?? "C").toUpperCase()}
              onChange={(value) => patch({ bearing: value })}
              options={BEARING_OPTIONS}
              ariaLabel="锚点方位"
            />
          </Row>
          <Row label="距离">
            <Picker
              value={anchor.dist ?? "near"}
              onChange={(value) => patch({ dist: value })}
              options={DIST_OPTIONS}
              ariaLabel="锚点距离"
            />
          </Row>
          <Row label="父锚点（可选）">
            <Input
              value={anchor.of ?? ""}
              placeholder="填了按「父锚点的X方」表述"
              onChange={(event) => patch({ of: event.target.value || undefined })}
              className="h-8 rounded-xl text-[11px] font-mono"
            />
          </Row>
          <Row label="距离补语">
            <Input
              value={anchor.gap ?? ""}
              placeholder="如 约三尺"
              onChange={(event) => patch({ gap: event.target.value || undefined })}
              className="h-8 rounded-xl text-[11px]"
            />
          </Row>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <FlagChip active={!!anchor.key} label="主地标" onClick={() => patch({ key: !anchor.key })} />
          <FlagChip active={!!anchor.ring} label="环绕物" onClick={() => patch({ ring: !anchor.ring })} />
          <FlagChip
            active={!!anchor.always}
            label="固定结构"
            onClick={() => patch({ always: !anchor.always })}
          />
        </div>

        <Row label="形态与约束（只写材质、尺寸、是否全场唯一，不写方位）">
          <Textarea
            value={anchor.desc}
            onChange={(event) => patch({ desc: event.target.value })}
            className="min-h-16 rounded-xl text-[11px]"
          />
        </Row>
      </div>
    );
  }

  if (selection.kind === "camera") {
    const camera = blocking.cameras.find((item) => item.id === selection.id);
    if (!camera) return null;
    const patch = (next: Partial<SceneCamera>) =>
      onChange({
        ...blocking,
        cameras: blocking.cameras.map((item) =>
          item.id === camera.id ? { ...item, ...next } : item
        ),
      });
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border/30 bg-card/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium">机位锚点</h3>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="删除机位"
            onClick={() =>
              onChange({
                ...blocking,
                cameras: blocking.cameras.filter((item) => item.id !== camera.id),
              })
            }
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Row label="编号">
            <Input
              value={camera.id}
              onChange={(event) => patch({ id: event.target.value })}
              className="h-8 rounded-xl text-[11px] font-mono"
            />
          </Row>
          <Row label="名称">
            <Input
              value={camera.name}
              placeholder="如 坛下仰拍机位"
              onChange={(event) => patch({ name: event.target.value })}
              className="h-8 rounded-xl text-[11px]"
            />
          </Row>
          <Row label="机位角度">
            <Picker
              value={camera.angle}
              onChange={(value) => patch({ angle: value })}
              options={CAMERA_ANGLES.map((angle) => ({ value: angle, label: angle }))}
              ariaLabel="机位角度"
            />
          </Row>
          <Row label="俯仰档位">
            <Picker
              value={camera.pitch ?? "flat"}
              onChange={(value) => patch({ pitch: value })}
              options={CAMERA_PITCHES.map((pitch) => ({
                value: pitch,
                label: PITCH_LABELS[pitch] ?? pitch,
              }))}
              ariaLabel="机位俯仰"
            />
          </Row>
          <Row label="正对的世界方位">
            <Picker
              value={(camera.yaw ?? "N").toUpperCase()}
              onChange={(value) => patch({ yaw: value })}
              options={SCENE_BEARINGS.map((bearing) => ({
                value: bearing,
                label: `${BEARING_LABELS[bearing]}（${bearing}）`,
              }))}
              ariaLabel="机位朝向"
            />
          </Row>
          <Row label="运镜">
            <Input
              value={camera.move ?? ""}
              placeholder="填「环绕」则优先匹配"
              onChange={(event) => patch({ move: event.target.value || undefined })}
              className="h-8 rounded-xl text-[11px]"
            />
          </Row>
        </div>

        <Row label="机位说明">
          <Textarea
            value={camera.desc}
            onChange={(event) => patch({ desc: event.target.value })}
            className="min-h-16 rounded-xl text-[11px]"
          />
        </Row>
      </div>
    );
  }

  const role = blocking.roles[selection.id];
  if (!role) return null;
  const name =
    characters.find((character) => String(character.id) === selection.id)?.name ??
    `角色 ${selection.id}`;
  const patch = (next: Partial<SceneRole>) =>
    onChange({
      ...blocking,
      roles: {
        ...blocking.roles,
        [selection.id]: { ...{ at: "", face: "", note: "" }, ...role, ...next },
      },
    });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/30 bg-card/50 p-3">
      <h3 className="text-xs font-medium">{name} · 站位</h3>

      <div className="grid grid-cols-2 gap-2">
        <Row label="站位锚点">
          <Input
            value={role.at}
            placeholder="如 P2"
            onChange={(event) => patch({ at: event.target.value })}
            className="h-8 rounded-xl text-[11px] font-mono"
          />
        </Row>
        <Row label="朝向的具名对象">
          <Input
            value={role.faceTo ?? ""}
            placeholder="锚点编号，优先于方位"
            onChange={(event) => patch({ faceTo: event.target.value || undefined })}
            className="h-8 rounded-xl text-[11px] font-mono"
          />
        </Row>
        <Row label="朝向方位">
          <Picker
            value={(role.faceBearing ?? "C").toUpperCase()}
            onChange={(value) => patch({ faceBearing: value })}
            options={BEARING_OPTIONS}
            ariaLabel="角色朝向方位"
          />
        </Row>
        <Row label="画面称谓">
          <Input
            value={role.subject ?? ""}
            placeholder="如 一名黑衣少年"
            onChange={(event) => patch({ subject: event.target.value || undefined })}
            className="h-8 rounded-xl text-[11px]"
          />
        </Row>
        <Row label="自由站位方位">
          <Picker
            value={(role.bearing ?? "C").toUpperCase()}
            onChange={(value) => patch({ bearing: value })}
            options={BEARING_OPTIONS}
            ariaLabel="角色自由站位方位"
          />
        </Row>
        <Row label="自由站位距离">
          <Picker
            value={role.dist ?? "near"}
            onChange={(value) => patch({ dist: value })}
            options={DIST_OPTIONS}
            ariaLabel="角色自由站位距离"
          />
        </Row>
      </div>

      <Row label="朝向原文（未结构化时的兜底）">
        <Input
          value={role.face}
          placeholder="如 面朝坛下 P5 方向"
          onChange={(event) => patch({ face: event.target.value })}
          className="h-8 rounded-xl text-[11px]"
        />
      </Row>
      <Row label="动作与约束">
        <Input
          value={role.note ?? ""}
          placeholder="如 背贴柱身不得离开"
          onChange={(event) => patch({ note: event.target.value || undefined })}
          className="h-8 rounded-xl text-[11px]"
        />
      </Row>
    </div>
  );
}

function FlagChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        "rounded-full border px-2 py-0.5 text-[10px] transition-colors " +
        (active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border/40 text-muted-foreground hover:border-border/60")
      }
    >
      {label}
    </button>
  );
}
