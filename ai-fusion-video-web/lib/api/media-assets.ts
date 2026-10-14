import { http } from "./client";

// ============================================================
// 类型定义
// ============================================================

/** 资产引用状态：使用中 / 历史产出 / 无引用 */
export type MediaAssetStatus = "active" | "history" | "orphan";

/** 媒体类型 */
export type MediaAssetType = "image" | "video" | "audio" | "other";

/** 一条引用来源 */
export interface MediaAssetReference {
  category: string;
  table: string;
  column: string;
  recordId: number | null;
  label: string;
  active: boolean;
  projectId: number | null;
}

/** 单个资产条目 */
export interface MediaAssetItem {
  key: string;
  url: string;
  mediaType: MediaAssetType;
  extension: string;
  size: number;
  lastModified: string | null;
  status: MediaAssetStatus;
  deletable: boolean;
  projectId: number | null;
  projectName: string | null;
  references: MediaAssetReference[];
}

export interface MediaAssetTypeStat {
  mediaType: MediaAssetType;
  count: number;
  bytes: number;
}

export interface MediaAssetOverview {
  totalObjects: number;
  totalBytes: number;
  activeCount: number;
  activeBytes: number;
  historyCount: number;
  historyBytes: number;
  orphanCount: number;
  orphanBytes: number;
  byType: MediaAssetTypeStat[];
}

export interface MediaAssetPageReq {
  scope?: MediaAssetStatus | "all";
  mediaType?: MediaAssetType | "all";
  keyword?: string;
  pageNo?: number;
  pageSize?: number;
}

/** 单次查询结果：概览与列表一次返回 */
export interface MediaAssetQueryResult {
  overview: MediaAssetOverview;
  list: MediaAssetItem[];
  total: number;
}

export interface MediaAssetDeleteResult {
  deletedCount: number;
  deletedBytes: number;
  failedCount: number;
  failedKeys: string[];
  blockedKeys: string[];
  removedRecords: number;
}

// ============================================================
// 展示映射
// ============================================================

export const MEDIA_ASSET_STATUS_LABELS: Record<MediaAssetStatus, string> = {
  active: "使用中",
  history: "历史产出",
  orphan: "无引用",
};

export const MEDIA_ASSET_STATUS_HINTS: Record<MediaAssetStatus, string> = {
  active: "正在被分镜、资产或项目引用，不可删除",
  history: "被替换掉或历史生成产出的文件，可以删除",
  orphan: "没有任何数据库记录引用，可以删除",
};

export const MEDIA_ASSET_TYPE_LABELS: Record<MediaAssetType, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  other: "其他",
};

// ============================================================
// API
// ============================================================

export interface MediaAssetDeleteReq {
  /** 要删除的对象键；与 scope 二选一 */
  keys?: string[];
  /** 批量清理范围：一次清空该状态下的全部文件 */
  scope?: MediaAssetStatus;
  cleanupRecords?: boolean;
}

export const mediaAssetApi = {
  /** 一次拿到概览与分页列表（后端共用同一次存储列举） */
  async query(req: MediaAssetPageReq): Promise<MediaAssetQueryResult> {
    return http.post<never, MediaAssetQueryResult>("/api/system/media-assets/query", req, { timeout: 0 });
  },

  /** 删除资产；使用中的资产会被后端拒绝并回传 blockedKeys */
  async remove(req: MediaAssetDeleteReq): Promise<MediaAssetDeleteResult> {
    return http.post<never, MediaAssetDeleteResult>(
      "/api/system/media-assets/delete",
      { cleanupRecords: true, ...req },
      { timeout: 0 }
    );
  },
};
