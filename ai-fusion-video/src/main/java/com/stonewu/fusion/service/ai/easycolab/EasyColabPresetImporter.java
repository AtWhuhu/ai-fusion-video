package com.stonewu.fusion.service.ai.easycolab;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.stonewu.fusion.common.BusinessException;
import com.stonewu.fusion.entity.ai.ComfyUiWorkflow;
import com.stonewu.fusion.mapper.ai.ComfyUiWorkflowMapper;
import com.stonewu.fusion.service.ai.comfyui.ComfyUiWorkflowService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * 把 EasyColab 自带的 6 个预置视频工作流（与 app.py 预设包一一对应）导入到指定 ComfyUI 配置下，作为草稿版本。
 */
@Component
@RequiredArgsConstructor
public class EasyColabPresetImporter {

    private static final String BASE = "comfyui/easycolab/";

    private final ComfyUiWorkflowService workflowService;
    private final ComfyUiWorkflowMapper workflowMapper;
    private final ObjectMapper objectMapper;

    /** 返回本次新导入的工作流数量；已存在相同标识的工作流保持不动 */
    public int importPresets(Long apiConfigId) {
        int imported = 0;
        for (JsonNode preset : readJson(BASE + "presets.json")) {
            String code = preset.path("code").asText();
            boolean exists = workflowMapper.selectCount(new LambdaQueryWrapper<ComfyUiWorkflow>()
                    .eq(ComfyUiWorkflow::getApiConfigId, apiConfigId)
                    .eq(ComfyUiWorkflow::getCode, code)) > 0;
            if (exists) {
                continue;
            }
            String file = preset.path("file").asText();
            Long workflowId = workflowService.createWorkflow(
                    apiConfigId,
                    preset.path("name").asText(),
                    code,
                    preset.path("modelType").asInt(),
                    "EasyColab 预置工作流，需先在 EasyColab 安装预设包 " + preset.path("packId").asText()
                            + " 的模型权重，再验证、试运行并发布",
                    1);
            workflowService.createVersion(
                    workflowId,
                    readText(BASE + file + ".ui.json"),
                    readText(BASE + file + ".api.json"),
                    preset.path("inputBindings").toString(),
                    preset.path("outputBindings").toString());
            imported++;
        }
        return imported;
    }

    private JsonNode readJson(String path) {
        try {
            return objectMapper.readTree(readText(path));
        } catch (IOException e) {
            throw new BusinessException(500, "读取 EasyColab 预置工作流清单失败");
        }
    }

    private String readText(String path) {
        try (InputStream in = new ClassPathResource(path).getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new BusinessException(500, "读取 EasyColab 预置工作流失败: " + path);
        }
    }
}
