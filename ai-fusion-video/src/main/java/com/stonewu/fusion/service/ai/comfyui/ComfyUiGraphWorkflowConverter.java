package com.stonewu.fusion.service.ai.comfyui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.stonewu.fusion.common.BusinessException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Converts a ComfyUI UI-format (graph) workflow into an API-format prompt, following the
 * ComfyUI frontend's {@code graphToPrompt}: muted/bypassed and frontend-only nodes are dropped,
 * bypassed nodes pass their matching input through, subgraphs are flattened with
 * {@code "<instanceId>:<innerId>"} node IDs, and widget values are mapped to input names using
 * the target instance's {@code /object_info} node definitions.
 */
public final class ComfyUiGraphWorkflowConverter {

    private static final int MODE_NEVER = 2;
    private static final int MODE_BYPASS = 4;
    private static final int SUBGRAPH_INPUT_NODE_ID = -10;
    private static final Set<String> FRONTEND_ONLY_NODES = Set.of("Note", "MarkdownNote", "Reroute", "PrimitiveNode");
    private static final Set<String> WIDGET_TYPES = Set.of(
            "INT", "FLOAT", "STRING", "BOOLEAN", "COMBO", "COMFY_DYNAMICCOMBO_V3");
    private static final Set<String> CONTROL_AFTER_GENERATE_VALUES = Set.of("fixed", "increment", "decrement", "randomize");
    private static final Set<String> UPLOAD_OPTIONS = Set.of("image_upload", "video_upload", "audio_upload");
    private static final Set<String> UPLOAD_WIDGET_VALUES = Set.of("image", "video", "audio", "upload");

    private final Function<String, JsonNode> nodeDefinitions;
    private final Map<String, JsonNode> definitionCache = new HashMap<>();
    private final Map<String, JsonNode> subgraphs = new HashMap<>();
    private final Set<String> missingClasses = new LinkedHashSet<>();
    private final ObjectNode output = JsonNodeFactory.instance.objectNode();

    private ComfyUiGraphWorkflowConverter(Function<String, JsonNode> nodeDefinitions) {
        this.nodeDefinitions = nodeDefinitions;
    }

    /**
     * @param nodeDefinitions returns the {@code /object_info} definition of a node class, or a
     *                        missing node when the target ComfyUI does not have it
     */
    public static ObjectNode convert(ObjectNode graph, Function<String, JsonNode> nodeDefinitions) {
        return new ComfyUiGraphWorkflowConverter(nodeDefinitions).run(graph);
    }

    public static boolean isGraphWorkflow(JsonNode workflow) {
        return workflow != null && workflow.isObject() && workflow.path("nodes").isArray();
    }

    private ObjectNode run(ObjectNode graph) {
        for (JsonNode subgraph : graph.path("definitions").path("subgraphs")) {
            subgraphs.put(subgraph.path("id").asText(), subgraph);
        }
        emit(new Scope(graph, "", null, null));
        if (!missingClasses.isEmpty()) {
            throw invalid("目标 ComfyUI 缺少节点定义，无法转换 UI-format 工作流: " + String.join(", ", missingClasses));
        }
        removeDanglingLinks();
        if (output.isEmpty()) {
            throw invalid("UI-format 工作流中没有可执行的节点");
        }
        return output;
    }

    private void emit(Scope scope) {
        for (JsonNode node : scope.nodes.values()) {
            int mode = node.path("mode").asInt(0);
            String type = node.path("type").asText();
            if (mode == MODE_NEVER || mode == MODE_BYPASS || FRONTEND_ONLY_NODES.contains(type)) {
                continue;
            }
            if (subgraphs.containsKey(type)) {
                emit(scope.child(node, subgraphs.get(type)));
                continue;
            }
            JsonNode definition = definition(type);
            if (definition == null) {
                continue;
            }
            ObjectNode inputs = JsonNodeFactory.instance.objectNode();
            mapWidgetValues(node, definition, inputs);
            for (JsonNode input : node.path("inputs")) {
                if (input.path("link").isNull() || input.path("link").isMissingNode()) {
                    continue;
                }
                JsonNode resolved = resolveLink(scope, input.path("link").asText());
                if (resolved != null) {
                    inputs.set(input.path("name").asText(), resolved);
                }
            }
            ObjectNode apiNode = output.putObject(scope.prefix + node.path("id").asText());
            apiNode.set("inputs", inputs);
            apiNode.put("class_type", type);
            apiNode.putObject("_meta").put("title", node.hasNonNull("title")
                    ? node.path("title").asText()
                    : definition.path("display_name").asText(type));
        }
    }

    private JsonNode definition(String type) {
        JsonNode definition = definitionCache.computeIfAbsent(type, nodeDefinitions);
        if (definition == null || !definition.isObject()) {
            missingClasses.add(type);
            return null;
        }
        return definition;
    }

    private void mapWidgetValues(JsonNode node, JsonNode definition, ObjectNode inputs) {
        JsonNode widgetValues = node.path("widgets_values");
        List<Map.Entry<String, JsonNode>> specs = orderedInputs(definition.path("input"), definition.path("input_order"));
        if (widgetValues.isObject()) {
            for (Map.Entry<String, JsonNode> spec : specs) {
                if (isWidget(spec.getValue())) {
                    JsonNode value = widgetValues.get(spec.getKey());
                    putWidget(inputs, spec.getKey(), value == null ? defaultValue(spec.getValue()) : value);
                }
            }
            return;
        }
        WidgetCursor cursor = new WidgetCursor(widgetValues);
        for (Map.Entry<String, JsonNode> spec : specs) {
            mapWidget(spec.getKey(), spec.getValue(), cursor, inputs);
        }
    }

    private void mapWidget(String name, JsonNode spec, WidgetCursor cursor, ObjectNode inputs) {
        if (!isWidget(spec)) {
            return;
        }
        JsonNode options = spec.path(1);
        JsonNode value = cursor.next();
        if (value == null) {
            value = defaultValue(spec);
        }
        putWidget(inputs, name, value);
        if (options.has("control_after_generate")) {
            cursor.skipIf(CONTROL_AFTER_GENERATE_VALUES);
        }
        for (String uploadOption : UPLOAD_OPTIONS) {
            if (options.path(uploadOption).asBoolean(false)) {
                cursor.skipIf(UPLOAD_WIDGET_VALUES);
            }
        }
        if ("COMFY_DYNAMICCOMBO_V3".equals(spec.path(0).asText())) {
            for (JsonNode option : options.path("options")) {
                if (option.path("key").asText().equals(value.asText())) {
                    for (Map.Entry<String, JsonNode> child : orderedInputs(option.path("inputs"), null)) {
                        mapWidget(name + "." + child.getKey(), child.getValue(), cursor, inputs);
                    }
                }
            }
        }
    }

    private static List<Map.Entry<String, JsonNode>> orderedInputs(JsonNode inputSpec, JsonNode inputOrder) {
        List<Map.Entry<String, JsonNode>> result = new ArrayList<>();
        for (String section : List.of("required", "optional")) {
            JsonNode specs = inputSpec.path(section);
            JsonNode order = inputOrder == null ? null : inputOrder.get(section);
            if (order != null && order.isArray()) {
                for (JsonNode name : order) {
                    JsonNode spec = specs.get(name.asText());
                    if (spec != null) {
                        result.add(Map.entry(name.asText(), spec));
                    }
                }
            } else {
                specs.fields().forEachRemaining(result::add);
            }
        }
        return result;
    }

    private static boolean isWidget(JsonNode spec) {
        JsonNode type = spec.path(0);
        JsonNode options = spec.path(1);
        if (options.path("forceInput").asBoolean(false)) {
            return false;
        }
        return type.isArray() || WIDGET_TYPES.contains(type.asText()) || options.hasNonNull("widgetType");
    }

    private static JsonNode defaultValue(JsonNode spec) {
        JsonNode type = spec.path(0);
        JsonNode options = spec.path(1);
        if (options.has("default")) {
            return options.get("default");
        }
        JsonNode choices = type.isArray() ? type : options.path("options");
        if (choices.isArray() && !choices.isEmpty()) {
            JsonNode first = choices.get(0);
            return first.isObject() ? first.path("key") : first;
        }
        JsonNodeFactory factory = JsonNodeFactory.instance;
        return switch (type.asText()) {
            case "INT" -> factory.numberNode(0);
            case "FLOAT" -> factory.numberNode(0.0);
            case "BOOLEAN" -> factory.booleanNode(false);
            default -> factory.textNode("");
        };
    }

    private static void putWidget(ObjectNode inputs, String name, JsonNode value) {
        if (value.isArray()) {
            inputs.putObject(name).set("__value__", value);
        } else {
            inputs.set(name, value);
        }
    }

    private JsonNode resolveLink(Scope scope, String linkId) {
        Link link = scope.links.get(linkId);
        return link == null ? null : resolveOutput(scope, link.originId(), link.originSlot(), link.type());
    }

    private JsonNode resolveOutput(Scope scope, String originId, int originSlot, String type) {
        if (String.valueOf(SUBGRAPH_INPUT_NODE_ID).equals(originId)) {
            return resolveSubgraphInput(scope, originSlot);
        }
        JsonNode origin = scope.nodes.get(originId);
        if (origin == null) {
            return null;
        }
        int mode = origin.path("mode").asInt(0);
        String originType = origin.path("type").asText();
        if (mode == MODE_NEVER) {
            return null;
        }
        if (mode == MODE_BYPASS) {
            JsonNode input = bypassInput(origin, originSlot, type);
            return input == null ? null : resolveLink(scope, input.path("link").asText());
        }
        if ("Reroute".equals(originType)) {
            JsonNode input = origin.path("inputs").path(0);
            return input.path("link").isNull() || input.path("link").isMissingNode()
                    ? null : resolveLink(scope, input.path("link").asText());
        }
        if ("PrimitiveNode".equals(originType)) {
            JsonNode value = origin.path("widgets_values").path(0);
            return value.isMissingNode() ? null : wrapValue(value);
        }
        if (subgraphs.containsKey(originType)) {
            Scope child = scope.child(origin, subgraphs.get(originType));
            JsonNode linkIds = child.subgraph.path("outputs").path(originSlot).path("linkIds");
            return linkIds.isEmpty() ? null : resolveLink(child, linkIds.get(0).asText());
        }
        ArrayNode reference = JsonNodeFactory.instance.arrayNode();
        reference.add(scope.prefix + originId);
        reference.add(originSlot);
        return reference;
    }

    private JsonNode resolveSubgraphInput(Scope scope, int slot) {
        JsonNode subgraphInputs = scope.subgraph.path("inputs");
        String name = subgraphInputs.path(slot).path("name").asText();
        for (JsonNode instanceInput : scope.instance.path("inputs")) {
            if (name.equals(instanceInput.path("name").asText())
                    && !instanceInput.path("link").isNull() && !instanceInput.path("link").isMissingNode()) {
                return resolveLink(scope.parent, instanceInput.path("link").asText());
            }
        }
        int widgetIndex = 0;
        for (int i = 0; i < slot; i++) {
            if (targetsWidget(scope, subgraphInputs.get(i))) {
                widgetIndex++;
            }
        }
        JsonNode value = scope.instance.path("widgets_values").path(widgetIndex);
        return targetsWidget(scope, subgraphInputs.path(slot)) && !value.isMissingNode() ? wrapValue(value) : null;
    }

    private static boolean targetsWidget(Scope scope, JsonNode subgraphInput) {
        for (JsonNode linkId : subgraphInput.path("linkIds")) {
            Link link = scope.links.get(linkId.asText());
            JsonNode target = link == null ? null : scope.nodes.get(link.targetId());
            if (target != null && target.path("inputs").path(link.targetSlot()).has("widget")) {
                return true;
            }
        }
        return false;
    }

    private static JsonNode bypassInput(JsonNode node, int slot, String type) {
        JsonNode inputs = node.path("inputs");
        JsonNode sameSlot = inputs.path(slot);
        if (isLinked(sameSlot) && typesMatch(sameSlot.path("type").asText(), type)) {
            return sameSlot;
        }
        for (JsonNode input : inputs) {
            if (isLinked(input) && typesMatch(input.path("type").asText(), type)) {
                return input;
            }
        }
        return null;
    }

    private static boolean isLinked(JsonNode input) {
        return !input.isMissingNode() && !input.path("link").isNull() && !input.path("link").isMissingNode();
    }

    private static boolean typesMatch(String inputType, String outputType) {
        if (inputType.equals("*") || outputType.equals("*") || inputType.equals(outputType)) {
            return true;
        }
        for (String candidate : inputType.split(",")) {
            for (String other : outputType.split(",")) {
                if (candidate.trim().equals(other.trim())) {
                    return true;
                }
            }
        }
        return false;
    }

    private static JsonNode wrapValue(JsonNode value) {
        if (!value.isArray()) {
            return value;
        }
        ObjectNode wrapped = JsonNodeFactory.instance.objectNode();
        wrapped.set("__value__", value);
        return wrapped;
    }

    private void removeDanglingLinks() {
        for (JsonNode node : output) {
            Iterator<Map.Entry<String, JsonNode>> inputs = node.path("inputs").fields();
            while (inputs.hasNext()) {
                JsonNode value = inputs.next().getValue();
                if (value.isArray() && value.size() == 2 && !output.has(value.get(0).asText())) {
                    inputs.remove();
                }
            }
        }
    }

    private static BusinessException invalid(String message) {
        return new BusinessException(400, message);
    }

    private record Link(String originId, int originSlot, String targetId, int targetSlot, String type) {

        static Link of(JsonNode link) {
            if (link.isArray()) {
                return new Link(link.path(1).asText(), link.path(2).asInt(), link.path(3).asText(),
                        link.path(4).asInt(), link.path(5).asText("*"));
            }
            return new Link(link.path("origin_id").asText(), link.path("origin_slot").asInt(),
                    link.path("target_id").asText(), link.path("target_slot").asInt(), link.path("type").asText("*"));
        }
    }

    private static final class Scope {

        private final JsonNode subgraph;
        private final String prefix;
        private final Scope parent;
        private final JsonNode instance;
        private final Map<String, JsonNode> nodes = new LinkedHashMap<>();
        private final Map<String, Link> links = new HashMap<>();

        private Scope(JsonNode graph, String prefix, Scope parent, JsonNode instance) {
            this.subgraph = graph;
            this.prefix = prefix;
            this.parent = parent;
            this.instance = instance;
            for (JsonNode node : graph.path("nodes")) {
                nodes.put(node.path("id").asText(), node);
            }
            for (JsonNode link : graph.path("links")) {
                Link parsed = Link.of(link);
                String id = link.isArray() ? link.path(0).asText() : link.path("id").asText();
                links.put(id, parsed);
            }
        }

        private Scope child(JsonNode instanceNode, JsonNode definition) {
            return new Scope(definition, prefix + instanceNode.path("id").asText() + ":", this, instanceNode);
        }
    }

    private static final class WidgetCursor {

        private final JsonNode values;
        private int index;

        private WidgetCursor(JsonNode values) {
            this.values = values;
        }

        private JsonNode next() {
            return values.isArray() && index < values.size() ? values.get(index++) : null;
        }

        private void skipIf(Set<String> expected) {
            if (values.isArray() && index < values.size()
                    && values.get(index).isTextual() && expected.contains(values.get(index).asText())) {
                index++;
            }
        }
    }
}
