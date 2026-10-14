package com.stonewu.fusion.controller.system.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * 媒体资产分页查询请求。
 */
@Data
@Schema(description = "媒体资产分页查询")
public class MediaAssetPageReqVO {

    /** 状态范围：all / active / history / orphan */
    @Schema(description = "状态范围", example = "all")
    private String scope = "all";

    /** 媒体类型：all / image / video / audio */
    @Schema(description = "媒体类型", example = "all")
    private String mediaType = "all";

    @Schema(description = "对象键关键字")
    private String keyword;

    @Schema(description = "页码，从 1 开始")
    private Integer pageNo = 1;

    @Schema(description = "每页条数，最大 200")
    private Integer pageSize = 24;
}
