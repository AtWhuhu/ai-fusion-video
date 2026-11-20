package com.stonewu.fusion.service.ai.easycolab;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import cn.hutool.json.JSONObject;
import com.stonewu.fusion.entity.ai.AiModel;
import com.stonewu.fusion.entity.ai.ComfyUiWorkflowVersion;
import com.stonewu.fusion.service.ai.comfyui.ComfyUiWorkflowCapabilities;
import com.stonewu.fusion.service.ai.comfyui.ComfyUiWorkflowDefinition;
import com.stonewu.fusion.service.ai.comfyui.ComfyUiWorkflowDocumentService;
import com.stonewu.fusion.service.generation.ReferenceImageTransportService;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class EasyColabPresetsTests {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void everyPresetNormalizesWithItsBindings() throws IOException {
        JsonNode presets = MAPPER.readTree(read("presets.json"));
        assertThat(presets).hasSize(6);
        ComfyUiWorkflowDocumentService documents = new ComfyUiWorkflowDocumentService(MAPPER);
        for (JsonNode preset : presets) {
            String file = preset.path("file").asText();
            ComfyUiWorkflowDefinition definition = documents.normalize(
                    preset.path("modelType").asInt(),
                    read(file + ".ui.json"),
                    read(file + ".api.json"),
                    preset.path("inputBindings").toString(),
                    preset.path("outputBindings").toString());
            assertThat(definition.inputBindings()).as(file).isNotEmpty();
            assertThat(definition.outputBindings()).as(file).hasSize(1);
            assertThat(preset.path("inputBindings").has("prompt")).as(file).isTrue();
            assertThat(preset.path("inputBindings").has("firstFrame")).as(file).isTrue();
        }
    }

    /** 导入后直接建模型（不填任何能力配置）也必须能把首尾帧传给 ComfyUI。 */
    @Test
    void everyPresetAcceptsFrameImagesWithoutManualModelConfig() throws IOException {
        JsonNode presets = MAPPER.readTree(read("presets.json"));
        ComfyUiWorkflowDocumentService documents = new ComfyUiWorkflowDocumentService(MAPPER);
        ComfyUiWorkflowCapabilities capabilities = new ComfyUiWorkflowCapabilities(null, documents);
        ReferenceImageTransportService transports = new ReferenceImageTransportService(null, null, null, null);
        for (JsonNode preset : presets) {
            String file = preset.path("file").asText();
            ComfyUiWorkflowDefinition definition = documents.normalize(
                    preset.path("modelType").asInt(),
                    read(file + ".ui.json"),
                    read(file + ".api.json"),
                    preset.path("inputBindings").toString(),
                    preset.path("outputBindings").toString());
            AiModel model = AiModel.builder().modelType(preset.path("modelType").asInt()).config("{}").build();
            ComfyUiWorkflowVersion version = ComfyUiWorkflowVersion.builder().id(1L).versionNo(1)
                    .apiWorkflowJson(definition.apiWorkflowJson())
                    .inputBindingsJson(definition.inputBindingsJson()).build();

            JSONObject config = capabilities.describe(model, version, new JSONObject());

            assertThat(config.getBool("supportFirstFrame")).as(file).isTrue();
            assertThat(config.getJSONArray("referenceImageInputFormats").toList(String.class)).as(file)
                    .containsExactly("url", "data_uri");
            assertThat(transports.resolveCapability(config).supportsAny()).as(file).isTrue();
        }
    }

    private static String read(String name) throws IOException {
        try (InputStream in = new ClassPathResource("comfyui/easycolab/" + name).getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
