"use client";

import * as React from "react";
import { ImageDown, Save, Sparkles } from "lucide-react";
import { assetApi, type Asset } from "@/lib/api/asset";
import { uploadFile } from "@/lib/api/storage";
import { Button } from "@/components/ui/button";
import {
  SCENE_TOPDOWN_ITEM_NAME,
  SCENE_TOPDOWN_ITEM_TYPE,
} from "@/lib/asset-item-types";
import { renderSvgToPngBlob } from "@/lib/svg-export";
import {
  SceneBlockingCanvas,
  type SceneCanvasSelection,
} from "@/components/scene-blocking/scene-blocking-canvas";
import { readSceneBlocking, type SceneBlocking } from "@/lib/scene-blocking";
import { SceneBlockingInspector } from "@/components/scene-blocking/scene-blocking-inspector";
import { SceneBlockingLists } from "./scene-blocking-lists";

export type { SceneBlocking, SceneAnchor, SceneCamera, SceneRole } from "@/lib/scene-blocking";

interface SceneBlockingEditorProps {
  asset: Asset;
  /** 项目内全部角色资产，用于角色站位表与俯视图上的角色标记 */
  characters: Asset[];
  saving: boolean;
  onSave: (blocking: SceneBlocking) => Promise<void>;
  /** 俯视图存入资产后通知外部刷新（子资产列表要更新） */
  onAssetChanged?: () => void;
  /**
   * 派发「场景锚点推断」：让模型通读本场景在全片中出现的所有镜头，反推出一整套锚点。
   * 推断会整表替换现有锚点，调用方必须先做二次确认。
   */
  onInferBlocking?: () => void;
}

/**
 * 场景资产的「空间锚点」编辑器。
 *
 * 主视图是一张俯视布局图：锚点、机位、角色站位都画在同一张图上，拖动即改数据。
 * 下方的列表视图负责画布上摆不下的部分（未设方位的锚点、纯文本描述）。
 * 数据仍然只存一处 —— 场景资产的 `properties.blocking`，服务端据此按镜投影注入。
 */
export function SceneBlockingEditor({
  asset,
  characters,
  saving,
  onSave,
  onAssetChanged,
  onInferBlocking,
}: SceneBlockingEditorProps) {
  const [blocking, setBlocking] = React.useState<SceneBlocking>(() =>
    readSceneBlocking(asset.properties)
  );
  const [dirty, setDirty] = React.useState(false);
  const [selection, setSelection] = React.useState<SceneCanvasSelection | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  React.useEffect(() => {
    setBlocking(readSceneBlocking(asset.properties));
    setDirty(false);
    setSelection(null);
  }, [asset.id, asset.updateTime, asset.properties]);

  const update = (next: SceneBlocking) => {
    setBlocking(next);
    setDirty(true);
  };

  const save = async () => {
    await onSave(blocking);
    setDirty(false);
  };

  /**
   * 把当前俯视图渲染成 PNG 存进场景资产，作为独立的 `topdown` 子资产。
   *
   * 图是算出来的而不是画出来的：重存即覆盖同一张子资产，不去调生图模型 ——
   * 模型每画一次都不一样，等于把跨镜一致性又交还给运气。
   */
  const saveTopdownImage = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = await renderSvgToPngBlob(svg, { size: 1024 });
      const file = new File([blob], `${asset.name || "scene"}-topdown.png`, {
        type: "image/png",
      });
      const imageUrl = await uploadFile(file, "assets");
      const items = await assetApi.listItems(asset.id);
      const existing = items.find((item) => item.itemType === SCENE_TOPDOWN_ITEM_TYPE);
      if (existing) {
        await assetApi.updateItem({
          id: existing.id,
          itemType: SCENE_TOPDOWN_ITEM_TYPE,
          name: SCENE_TOPDOWN_ITEM_NAME,
          imageUrl,
        });
      } else {
        await assetApi.createItem({
          assetId: asset.id,
          itemType: SCENE_TOPDOWN_ITEM_TYPE,
          name: SCENE_TOPDOWN_ITEM_NAME,
          imageUrl,
        });
      }
      onAssetChanged?.();
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "存入场景资产失败");
    } finally {
      setExporting(false);
    }
  };

  const characterOptions = React.useMemo(
    () => characters.map((character) => ({ id: character.id, name: character.name })),
    [characters]
  );

  const activeRoleCount = Object.values(blocking.roles).filter(
    (role) => role.at?.trim() || role.bearing?.trim()
  ).length;

  return (
    <section className="border-b border-border/40 bg-card/40 px-5 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">空间锚点</h2>
          <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
            在俯视图上摆好位置锚点、机位与角色站位，生成首帧/视频时按镜注入，保证同一场景跨镜头位置一致。
            编号只是人机之间的约定，不会出现在给模型的提示词里 —— 服务端会按机位把它投影成画面语言
            （如「画面中央偏左下方约三尺」）。方位基准：正北为场地纵深远端，正南为镜头来路。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onInferBlocking && (
            <Button
              variant="outline"
              size="sm"
              disabled={saving || dirty}
              title={
                dirty
                  ? "有未保存的改动，先保存或刷新页面再推断"
                  : "让 AI 通读本场景在全片中的所有镜头，反推出一整套空间锚点"
              }
              onClick={onInferBlocking}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI 推断锚点
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={exporting || blocking.anchors.length === 0}
            title="把当前俯视图渲染成 PNG，存进本场景资产的「空间俯视图」子资产"
            onClick={() => void saveTopdownImage()}
          >
            <ImageDown className="h-3.5 w-3.5" />
            {exporting ? "生成中…" : "存入场景资产"}
          </Button>
          <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
            <Save className="h-3.5 w-3.5" />
            保存锚点
          </Button>
        </div>
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <SceneBlockingCanvas
          blocking={blocking}
          characters={characterOptions}
          selection={selection}
          onSelect={setSelection}
          onChange={update}
          svgRef={svgRef}
        />
        <SceneBlockingInspector
          blocking={blocking}
          selection={selection}
          characters={characterOptions}
          onChange={update}
        />
      </div>

      <div className="mt-4">
        <SceneBlockingLists
          blocking={blocking}
          characters={characterOptions}
          onChange={update}
        />
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        已配置锚点 {blocking.anchors.length} 个、机位 {blocking.cameras.length} 个、角色站位{" "}
        {activeRoleCount} 条。
        {dirty ? " 有未保存的改动。" : ""}
        {exportError ? <span className="text-destructive"> {exportError}</span> : null}
      </p>
    </section>
  );
}
