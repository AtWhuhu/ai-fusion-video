package com.stonewu.fusion.controller.ai.vo.comfyui;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class ComfyUiWorkflowConvertReqVO {

    @NotNull(message = "API 配置 ID 不能为空")
    private Long apiConfigId;

    @NotBlank(message = "UI-format 工作流不能为空")
    private String uiWorkflowJson;
}
