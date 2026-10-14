package com.stonewu.fusion.controller.system.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;

/**
 * 媒体资产删除请求。
 * <p>
 * 两种用法：给出 {@code keys} 删指定文件；或给出 {@code scope} 清空某个状态下的全部文件。
 */
@Data
@Schema(description = "媒体资产删除")
public class MediaAssetDeleteReqVO {

    @Schema(description = "要删除的对象键列表；与 scope 二选一")
    private List<String> keys;

    /** 批量清理范围：history / orphan */
    @Schema(description = "批量清理范围", example = "history")
    private String scope;

    @Schema(description = "是否同时清理数据库中指向这些文件的生成流水记录", example = "true")
    private Boolean cleanupRecords = true;
}
