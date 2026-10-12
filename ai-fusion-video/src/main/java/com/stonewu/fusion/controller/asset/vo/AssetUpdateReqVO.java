package com.stonewu.fusion.controller.asset.vo;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.stonewu.fusion.common.handler.RawJsonTextDeserializer;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 更新资产请求 VO
 */
@Schema(description = "更新资产请求")
@Data
public class AssetUpdateReqVO {

    @NotNull(message = "资产ID不能为空")
    private Long id;

    private String type;
    private String name;
    private String description;
    private String coverUrl;

    /** 动态属性：可传 JSON 对象，也可传 JSON 文本（兼容历史客户端） */
    @JsonDeserialize(using = RawJsonTextDeserializer.class)
    private String properties;

    /** 标签数组：可传 JSON 数组，也可传 JSON 文本（兼容历史客户端） */
    @JsonDeserialize(using = RawJsonTextDeserializer.class)
    private String tags;

    private String aiPrompt;
}
