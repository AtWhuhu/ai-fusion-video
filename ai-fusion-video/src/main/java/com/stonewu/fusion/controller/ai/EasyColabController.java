package com.stonewu.fusion.controller.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.stonewu.fusion.common.CommonResult;
import com.stonewu.fusion.controller.ai.vo.easycolab.EasyColabAuthCodeReqVO;
import com.stonewu.fusion.controller.ai.vo.easycolab.EasyColabWakeReqVO;
import com.stonewu.fusion.service.ai.easycolab.EasyColabRuntimeState;
import com.stonewu.fusion.service.ai.easycolab.EasyColabService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import static com.stonewu.fusion.common.CommonResult.success;

@Tag(name = "EasyColab 一键唤醒")
@RestController
@RequestMapping("/api/ai/easycolab")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class EasyColabController {

    private final EasyColabService easyColabService;

    @GetMapping("/state")
    @Operation(summary = "查询 Colab 实例与 ComfyUI 渠道状态")
    public CommonResult<EasyColabRuntimeState> state() {
        return success(easyColabService.getState());
    }

    @GetMapping("/auth/status")
    @Operation(summary = "查询 Google Colab 授权状态")
    public CommonResult<JsonNode> authStatus() {
        return success(easyColabService.authStatus());
    }

    @PostMapping("/auth/url")
    @Operation(summary = "生成 Google Colab 授权链接")
    public CommonResult<JsonNode> authUrl() {
        return success(easyColabService.authUrl());
    }

    @PostMapping("/auth/code")
    @Operation(summary = "提交 Google 授权码")
    public CommonResult<JsonNode> authCode(@Valid @RequestBody EasyColabAuthCodeReqVO request) {
        return success(easyColabService.submitAuthCode(request.getCode()));
    }

    @PostMapping("/auth/logout")
    @Operation(summary = "解除 Google Colab 授权")
    public CommonResult<JsonNode> logout() {
        return success(easyColabService.logout());
    }

    @PostMapping("/wake")
    @Operation(summary = "唤醒 Colab GPU 并部署 ComfyUI 渠道")
    public CommonResult<EasyColabRuntimeState> wake(@Valid @RequestBody EasyColabWakeReqVO request) {
        return success(easyColabService.wake(request.getGpu(), request.getIdleTimeoutMinutes()));
    }

    @PostMapping("/release")
    @Operation(summary = "释放 Colab 实例")
    public CommonResult<EasyColabRuntimeState> release() {
        return success(easyColabService.release());
    }
}
