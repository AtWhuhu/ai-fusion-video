package com.stonewu.fusion.controller.storyboard.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * 更新分镜条目的 3D 布景快照请求 VO
 * <p>
 * 快照是从空间锚点 3D 导演台按本镜视角导出的渲染图，存放在 custom_data.blocking3dImageUrl，
 * 生成视频时作为「场景 3D 布局参考图」传给多图参考模型。
 */
@Schema(description = "更新分镜条目 3D 布景快照请求")
@Data
public class StoryboardItemBlockingSnapshotReqVO {

    @Schema(description = "快照图片 URL；null 或留空表示清除该镜的快照")
    private String imageUrl;
}
