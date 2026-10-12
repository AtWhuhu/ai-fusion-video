"use client";

import * as React from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { Asset } from "@/lib/api/asset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** 场景空间锚点表；与后端 SceneBlockingService 的数据契约一致 */
export interface SceneAnchor {
  id: string;
  name: string;
  /** 全场主地标：每镜必带 */
  key?: boolean;
  /** 环绕物：每镜必带 */
  ring?: boolean;
  desc: string;
}

export interface SceneCamera {
  id: string;
  name: string;
  angle: string;
  /** 运镜；填「环绕」时优先于角度匹配 */
  move?: string;
  desc: string;
}

export interface SceneRole {
  /** 指向锚点编号，如 P2（柱南面） */
  at: string;
  face: string;
  note?: string;
}

export interface SceneBlocking {
  anchors: SceneAnchor[];
  cameras: SceneCamera[];
  /** 键为角色资产 id */
  roles: Record<string, SceneRole>;
}

const CAMERA_ANGLES = ["平视", "仰视", "俯视", "鸟瞰", "荷兰角"];

const EMPTY_BLOCKING: SceneBlocking = { anchors: [], cameras: [], roles: {} };

/** 从资产 properties 解析 blocking，结构缺失时返回空表 */
export function readSceneBlocking(properties: unknown): SceneBlocking {
  const source = parsePlainObject(properties)?.blocking;
  const blocking = parsePlainObject(source);
  if (!blocking) return EMPTY_BLOCKING;
  return {
    anchors: Array.isArray(blocking.anchors)
      ? (blocking.anchors as SceneAnchor[])
      : [],
    cameras: Array.isArray(blocking.cameras)
      ? (blocking.cameras as SceneCamera[])
      : [],
    roles: parsePlainObject(blocking.roles)
      ? (blocking.roles as Record<string, SceneRole>)
      : {},
  };
}

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

interface SceneBlockingEditorProps {
  asset: Asset;
  /** 项目内全部角色资产，用于角色站位表 */
  characters: Asset[];
  saving: boolean;
  onSave: (blocking: SceneBlocking) => Promise<void>;
}

/**
 * 场景资产的「空间锚点」编辑器。
 * <p>
 * 锚点表定义场景内固定编号的位置与机位，站位表定义每个角色的默认站位；
 * 服务端据此在每次生成首帧/视频时按镜注入位置约束。
 */
export function SceneBlockingEditor({
  asset,
  characters,
  saving,
  onSave,
}: SceneBlockingEditorProps) {
  const [blocking, setBlocking] = React.useState<SceneBlocking>(() =>
    readSceneBlocking(asset.properties)
  );
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    setBlocking(readSceneBlocking(asset.properties));
    setDirty(false);
  }, [asset.id, asset.updateTime, asset.properties]);

  const update = (next: SceneBlocking) => {
    setBlocking(next);
    setDirty(true);
  };

  const save = async () => {
    await onSave(blocking);
    setDirty(false);
  };

  const activeRoles = characters.filter((character) => {
    const role = blocking.roles[String(character.id)];
    return role && (role.at?.trim() || role.face?.trim());
  });

  return (
    <section className="border-b border-border/40 bg-card/40 px-5 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">空间锚点</h2>
          <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
            定义场景内固定编号的位置与机位，生成首帧/视频时按镜注入，保证同一场景跨镜头位置一致。
            方位基准：正北为场地纵深远端（画面深处），正南为镜头来路。
          </p>
        </div>
        <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
          <Save className="h-3.5 w-3.5" />
          保存锚点
        </Button>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <AnchorTable
          anchors={blocking.anchors}
          onChange={(anchors) => update({ ...blocking, anchors })}
        />
        <CameraTable
          cameras={blocking.cameras}
          onChange={(cameras) => update({ ...blocking, cameras })}
        />
      </div>

      <RoleTable
        characters={characters}
        roles={blocking.roles}
        onChange={(roles) => update({ ...blocking, roles })}
      />

      <p className="mt-3 text-[11px] text-muted-foreground">
        已配置锚点 {blocking.anchors.length} 个、机位 {blocking.cameras.length} 个、角色站位{" "}
        {activeRoles.length} 条。
      </p>
    </section>
  );
}

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

interface AnchorTableProps {
  anchors: SceneAnchor[];
  onChange: (anchors: SceneAnchor[]) => void;
}

function AnchorTable({ anchors, onChange }: AnchorTableProps) {
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
            placeholder="空间位置描述：在哪、尺寸、朝向、是否为全场唯一"
            className="min-h-14 text-[11px]"
            aria-label="锚点描述"
          />
        </div>
      ))}
      <Button
        size="xs"
        variant="outline"
        className="self-start"
        onClick={() =>
          onChange([
            ...anchors,
            { id: `P${anchors.length + 1}`, name: "", desc: "" },
          ])
        }
      >
        <Plus className="h-3 w-3" />
        添加锚点
      </Button>
    </Panel>
  );
}

interface CameraTableProps {
  cameras: SceneCamera[];
  onChange: (cameras: SceneCamera[]) => void;
}

function CameraTable({ cameras, onChange }: CameraTableProps) {
  const replace = (index: number, patch: Partial<SceneCamera>) =>
    onChange(cameras.map((camera, i) => (i === index ? { ...camera, ...patch } : camera)));

  return (
    <Panel title="机位锚点" hint="描述物件在画面中的景位">
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
              aria-label="机位角度"
            />
            <ToggleChip
              active={camera.move === "环绕"}
              label="环绕"
              onClick={() =>
                replace(index, { move: camera.move === "环绕" ? "" : "环绕" })
              }
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
            { id: `C${cameras.length + 1}`, name: "", angle: "平视", move: "", desc: "" },
          ])
        }
      >
        <Plus className="h-3 w-3" />
        添加机位
      </Button>
    </Panel>
  );
}

interface RoleTableProps {
  characters: Asset[];
  roles: Record<string, SceneRole>;
  onChange: (roles: Record<string, SceneRole>) => void;
}

function RoleTable({ characters, roles, onChange }: RoleTableProps) {
  const replace = (assetId: number, patch: Partial<SceneRole>) => {
    const key = String(assetId);
    const next = { ...roles, [key]: { ...{ at: "", face: "", note: "" }, ...roles[key], ...patch } };
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
    <div className="mt-4">
      <Panel title="角色站位" hint="留空表示该角色在本场景用默认走位">
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
  "aria-label": string;
}

function NativeSelect({ value, onChange, "aria-label": ariaLabel }: NativeSelectProps) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 shrink-0 rounded-xl border border-border/30 bg-background/70 px-1.5 text-[11px]"
    >
      {CAMERA_ANGLES.map((angle) => (
        <option key={angle} value={angle}>
          {angle}
        </option>
      ))}
    </select>
  );
}
