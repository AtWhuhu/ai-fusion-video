"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CAMERA_ANGLES,
  nextAnchorId,
  nextCameraId,
  type SceneAnchor,
  type SceneBlocking,
  type SceneCamera,
  type SceneRole,
} from "@/lib/scene-blocking";
import { Plus, Trash2 } from "lucide-react";

/**
 * 俯视图的列表视图。
 *
 * 画布负责「看得见的位置」，这里负责「画布上摆不下的东西」——
 * 没设方位的锚点、纯文本描述、批量核对。两边改的是同一份数据。
 */

interface PanelProps {
  title: string;
  hint: string;
  children: React.ReactNode;
}

function Panel({ title, hint, children }: PanelProps) {
  return (
    <div className="rounded-lg border border-border/20 bg-background/70 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium">{title}</h3>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </div>
  );
}

interface ToggleChipProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

function ToggleChip({ active, label, onClick }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] transition-colors " +
        (active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border/40 text-muted-foreground hover:border-border/60")
      }
    >
      {label}
    </button>
  );
}

interface NativeSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  "aria-label": string;
  className?: string;
}

function NativeSelect({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  className,
}: NativeSelectProps) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className={
        "h-7 shrink-0 rounded-xl border border-border/30 bg-background/70 px-1.5 text-[11px] " +
        (className ?? "")
      }
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface AnchorListProps {
  anchors: SceneAnchor[];
  onChange: (anchors: SceneAnchor[]) => void;
}

function AnchorList({ anchors, onChange }: AnchorListProps) {
  const replace = (index: number, patch: Partial<SceneAnchor>) =>
    onChange(anchors.map((anchor, i) => (i === index ? { ...anchor, ...patch } : anchor)));

  return (
    <Panel title="位置锚点" hint="主地标与环绕物每镜必带">
      {anchors.map((anchor, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Input
              value={anchor.id}
              onChange={(event) => replace(index, { id: event.target.value })}
              placeholder="P1"
              className="h-7 w-16 font-mono text-[11px]"
              aria-label="锚点编号"
            />
            <Input
              value={anchor.name}
              onChange={(event) => replace(index, { name: event.target.value })}
              placeholder="名称，如 中央刑柱"
              className="h-7 flex-1 text-[11px]"
              aria-label="锚点名称"
            />
            <ToggleChip
              active={anchor.key === true}
              label="主地标"
              onClick={() => replace(index, { key: !anchor.key })}
            />
            <ToggleChip
              active={anchor.ring === true}
              label="环绕物"
              onClick={() => replace(index, { ring: !anchor.ring })}
            />
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="删除锚点"
              onClick={() => onChange(anchors.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Textarea
            value={anchor.desc}
            onChange={(event) => replace(index, { desc: event.target.value })}
            placeholder="只写形态与约束：什么物件、多大、是否为全场唯一。不要写方位（方位在图上拖）"
            className="min-h-14 text-[11px]"
            aria-label="锚点描述"
          />
        </div>
      ))}
      <Button
        size="xs"
        variant="outline"
        className="self-start"
        onClick={() => onChange([...anchors, { id: nextAnchorId(anchors), name: "", desc: "" }])}
      >
        <Plus className="h-3 w-3" />
        添加锚点
      </Button>
    </Panel>
  );
}

interface CameraListProps {
  cameras: SceneCamera[];
  onChange: (cameras: SceneCamera[]) => void;
}

function CameraList({ cameras, onChange }: CameraListProps) {
  const replace = (index: number, patch: Partial<SceneCamera>) =>
    onChange(cameras.map((camera, i) => (i === index ? { ...camera, ...patch } : camera)));

  return (
    <Panel title="机位锚点" hint="俯仰与朝向决定投影结果">
      {cameras.map((camera, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Input
              value={camera.id}
              onChange={(event) => replace(index, { id: event.target.value })}
              placeholder="C1"
              className="h-7 w-16 font-mono text-[11px]"
              aria-label="机位编号"
            />
            <Input
              value={camera.name}
              onChange={(event) => replace(index, { name: event.target.value })}
              placeholder="名称，如 坛下仰拍机位"
              className="h-7 flex-1 text-[11px]"
              aria-label="机位名称"
            />
            <NativeSelect
              value={camera.angle}
              onChange={(value) => replace(index, { angle: value })}
              options={CAMERA_ANGLES.map((angle) => ({ value: angle, label: angle }))}
              aria-label="机位角度"
            />
            <ToggleChip
              active={camera.move === "环绕"}
              label="环绕"
              onClick={() => replace(index, { move: camera.move === "环绕" ? "" : "环绕" })}
            />
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="删除机位"
              onClick={() => onChange(cameras.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Textarea
            value={camera.desc}
            onChange={(event) => replace(index, { desc: event.target.value })}
            placeholder="机位在哪、朝哪拍，以及关键物件在画面中的景位"
            className="min-h-14 text-[11px]"
            aria-label="机位描述"
          />
        </div>
      ))}
      <Button
        size="xs"
        variant="outline"
        className="self-start"
        onClick={() =>
          onChange([
            ...cameras,
            { id: nextCameraId(cameras), name: "", angle: "平视", move: "", desc: "" },
          ])
        }
      >
        <Plus className="h-3 w-3" />
        添加机位
      </Button>
    </Panel>
  );
}

interface RoleListProps {
  characters: { id: number; name: string }[];
  roles: Record<string, SceneRole>;
  onChange: (roles: Record<string, SceneRole>) => void;
}

function RoleList({ characters, roles, onChange }: RoleListProps) {
  const replace = (assetId: number, patch: Partial<SceneRole>) => {
    const key = String(assetId);
    const next = {
      ...roles,
      [key]: { ...{ at: "", face: "", note: "" }, ...roles[key], ...patch },
    };
    onChange(next);
  };

  if (characters.length === 0) {
    return (
      <Panel title="角色站位" hint="需先在项目内建立角色资产">
        <p className="text-[11px] text-muted-foreground">暂无角色资产。</p>
      </Panel>
    );
  }

  return (
    <Panel title="角色站位" hint="也可直接在俯视图上把角色拖到点位">
      {characters.map((character) => {
        const role = roles[String(character.id)] ?? { at: "", face: "", note: "" };
        return (
          <div key={character.id} className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0 truncate text-[11px]">{character.name}</span>
            <Input
              value={role.at}
              onChange={(event) => replace(character.id, { at: event.target.value })}
              placeholder="站位，如 P2（柱南面）"
              className="h-7 w-44 text-[11px]"
              aria-label={`${character.name} 站位`}
            />
            <Input
              value={role.face}
              onChange={(event) => replace(character.id, { face: event.target.value })}
              placeholder="朝向，如 面朝坛下 P5 方向"
              className="h-7 w-52 text-[11px]"
              aria-label={`${character.name} 朝向`}
            />
            <Input
              value={role.note ?? ""}
              onChange={(event) => replace(character.id, { note: event.target.value })}
              placeholder="约束，如 背贴柱身不得离开"
              className="h-7 flex-1 text-[11px]"
              aria-label={`${character.name} 约束`}
            />
          </div>
        );
      })}
    </Panel>
  );
}

interface SceneBlockingListsProps {
  blocking: SceneBlocking;
  characters: { id: number; name: string }[];
  onChange: (next: SceneBlocking) => void;
}

export function SceneBlockingLists({
  blocking,
  characters,
  onChange,
}: SceneBlockingListsProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <AnchorList
        anchors={blocking.anchors}
        onChange={(anchors) => onChange({ ...blocking, anchors })}
      />
      <CameraList
        cameras={blocking.cameras}
        onChange={(cameras) => onChange({ ...blocking, cameras })}
      />
      <RoleList
        characters={characters}
        roles={blocking.roles}
        onChange={(roles) => onChange({ ...blocking, roles })}
      />
    </div>
  );
}
