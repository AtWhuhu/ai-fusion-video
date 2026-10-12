package com.stonewu.fusion.controller.asset.vo;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.stonewu.fusion.common.handler.RawJsonTextDeserializer;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 创建子资产请求 VO
 */
@Schema(description = "创建子资产请求")
@Data
public class AssetItemCreateReqVO {

    @NotNull(message = "资产ID不能为空")
    private Long assetId;

    private String itemType;
    private String name;
    private String imageUrl;
    private String thumbnailUrl;

    /** 动态属性：可传 JSON 对象，也可传 JSON 文本（兼容历史客户端） */
    @JsonDeserialize(using = RawJsonTextDeserializer.class)
    private String properties;

    private Integer sortOrder;
    private String aiPrompt;
}
