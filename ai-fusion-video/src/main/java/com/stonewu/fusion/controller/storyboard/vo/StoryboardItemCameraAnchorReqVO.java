package com.stonewu.fusion.controller.storyboard.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * 更新分镜条目机位锚点请求 VO
 * <p>
 * 机位锚点来自所属场景资产的 properties.blocking.cameras，用于指定该镜的机位方位。
 */
@Schema(description = "更新分镜条目机位锚点请求")
@Data
public class StoryboardItemCameraAnchorReqVO {

    @Schema(description = "场景锚点表中的机位编号，如 C2；null 或留空表示回到按机位角度自动匹配")
    private String cameraAnchorId;
}
