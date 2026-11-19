package com.stonewu.fusion.service.ai.comfyui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.stonewu.fusion.common.BusinessException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.io.InputStream;
import java.util.Iterator;
import java.util.Map;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Expected prompts are the ComfyUI frontend's own graphToPrompt output for the easycolab preset
 * workflows, captured from a ComfyUI instance whose /prompt validation accepted all of them.
 */
class ComfyUiGraphWorkflowConverterTests {

    private static final String FIXTURES = "/comfyui/easycolab/";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @ParameterizedTest
    @ValueSource(strings = {
            "01-wan22-i2v", "02-wan22-flf2v", "03-minimax-h3-i2v",
            "04-minimax-h3-flf2v", "05-ltx23-flf2v", "06-hunyuan15-i2v"})
    void convertsEasycolabPresetLikeComfyUiFrontend(String name) throws IOException {
        ObjectNode graph = (ObjectNode) read(name + ".ui.json");
        ObjectNode expected = (ObjectNode) read(name + ".api.json");

        ObjectNode prompt = ComfyUiGraphWorkflowConverter.convert(graph, objectInfo());

        assertThat(withoutMeta(prompt)).isEqualTo(withoutMeta(expected));
        String saveNodeId = prompt.properties().stream()
                .filter(entry -> "SaveVideo".equals(entry.getValue().path("class_type").asText()))
                .map(Map.Entry::getKey)
                .findFirst()
                .orElseThrow();
        ComfyUiWorkflowDefinition definition = new ComfyUiWorkflowDocumentService(MAPPER).normalize(
                3, graph.toString(), prompt.toString(), "{}",
                "[{\"nodeId\":\"" + saveNodeId + "\",\"mediaType\":\"video\",\"role\":\"primary\"}]");
        assertThat(MAPPER.readTree(definition.apiWorkflowJson())).isEqualTo(prompt);
    }

    @Test
    void flattensSubgraphWithInstanceWidgetValuesAndPrefixedIds() throws IOException {
        ObjectNode prompt = ComfyUiGraphWorkflowConverter.convert(
                (ObjectNode) read("01-wan22-i2v.ui.json"), objectInfo());

        assertThat(prompt.has("129")).isFalse();
        assertThat(prompt.path("129:98").path("inputs").path("width").asInt()).isEqualTo(1280);
        assertThat(prompt.path("129:98").path("inputs").path("start_image").toString()).isEqualTo("[\"97\",0]");
        assertThat(prompt.path("108").path("inputs").path("video").toString()).isEqualTo("[\"129:94\",0]");
    }

    @Test
    void skipsBypassedNodesAndPassesTheirInputThrough() throws IOException {
        ObjectNode prompt = ComfyUiGraphWorkflowConverter.convert(
                (ObjectNode) read("06-hunyuan15-i2v.ui.json"), objectInfo());

        prompt.forEach(node -> assertThat(node.path("class_type").asText()).isNotIn("EasyCache", "MarkdownNote"));
    }

    @Test
    void mapsPlainGraphWidgetsLinksAndDefaults() throws IOException {
        ObjectNode graph = (ObjectNode) MAPPER.readTree("""
                {"nodes":[
                  {"id":1,"type":"CheckpointLoaderSimple","mode":0,"inputs":[],"widgets_values":["model.safetensors"]},
                  {"id":2,"type":"Note","mode":0,"widgets_values":["hello"]},
                  {"id":3,"type":"KSamplerSelect","mode":2,"inputs":[],"widgets_values":["euler"]},
                  {"id":4,"type":"CLIPTextEncode","mode":0,
                   "inputs":[{"name":"clip","type":"CLIP","link":7}],"widgets_values":["a cat"]}
                ],"links":[[7,1,1,4,0,"CLIP"]]}
                """);

        ObjectNode prompt = ComfyUiGraphWorkflowConverter.convert(graph, objectInfo());

        assertThat(prompt.toString()).isEqualTo(MAPPER.readTree("""
                {"1":{"inputs":{"ckpt_name":"model.safetensors"},"class_type":"CheckpointLoaderSimple",
                      "_meta":{"title":"Load Checkpoint"}},
                 "4":{"inputs":{"text":"a cat","clip":["1",1]},"class_type":"CLIPTextEncode",
                      "_meta":{"title":"CLIP Text Encode (Prompt)"}}}
                """).toString());
    }

    @Test
    void rejectsNodesMissingOnTargetComfyUi() {
        ObjectNode graph = MAPPER.createObjectNode();
        graph.putArray("nodes").addObject().put("id", 1).put("type", "CustomNodeX").put("mode", 0);
        graph.putArray("links");

        assertThatThrownBy(() -> ComfyUiGraphWorkflowConverter.convert(graph, type -> MissingNode.getInstance()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("CustomNodeX");
    }

    private static Function<String, JsonNode> objectInfo() throws IOException {
        JsonNode objectInfo = read("object-info.json");
        return objectInfo::path;
    }

    private static JsonNode withoutMeta(ObjectNode prompt) {
        ObjectNode copy = prompt.deepCopy();
        for (Iterator<Map.Entry<String, JsonNode>> it = copy.fields(); it.hasNext(); ) {
            ((ObjectNode) it.next().getValue()).remove("_meta");
        }
        return copy;
    }

    private static JsonNode read(String name) throws IOException {
        try (InputStream input = ComfyUiGraphWorkflowConverterTests.class.getResourceAsStream(FIXTURES + name)) {
            return MAPPER.readTree(input);
        }
    }
}
