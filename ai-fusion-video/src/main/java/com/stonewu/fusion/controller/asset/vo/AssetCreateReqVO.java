package com.stonewu.fusion.controller.asset.vo;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.stonewu.fusion.common.handler.RawJsonTextDeserializer;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 创建资产请求 VO
 */
@Schema(description = "创建资产请求")
@Data
public class AssetCreateReqVO {

    @NotNull(message = "项目ID不能为空")
    private Long projectId;

    @NotBlank(message = "资产类型不能为空")
    private String type;

    @NotBlank(message = "资产名称不能为空")
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
