package com.stonewu.fusion.controller.ai.vo.easycolab;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class EasyColabAuthCodeReqVO {

    @NotBlank(message = "请粘贴 Google 授权码")
    private String code;
}
