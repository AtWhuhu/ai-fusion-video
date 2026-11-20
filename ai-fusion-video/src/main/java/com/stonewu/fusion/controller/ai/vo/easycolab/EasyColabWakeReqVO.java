package com.stonewu.fusion.controller.ai.vo.easycolab;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class EasyColabWakeReqVO {

    @NotBlank(message = "请选择 GPU 类型")
    private String gpu;

    /** 无 ComfyUI 任务多少分钟后由 EasyColab 自动释放实例，0 表示不自动释放 */
    @Min(value = 0, message = "闲置释放时间不能为负数")
    @Max(value = 720, message = "闲置释放时间不能超过 720 分钟")
    private Integer idleTimeoutMinutes = 30;
}
