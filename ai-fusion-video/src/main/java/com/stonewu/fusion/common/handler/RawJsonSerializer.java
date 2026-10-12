package com.stonewu.fusion.common.handler;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializerProvider;

import java.io.IOException;

/**
 * JSON 文本字段的「原样输出」序列化器。
 * <p>
 * {@code afv_asset.properties}/{@code tags}、{@code afv_asset_item.properties} 等字段在数据库与
 * Java 侧均以 {@code String}（JSON 文本）存储，而前端一律按「对象/数组」读取。若直接序列化，
 * 会输出成被转义的字符串（{@code "{\"a\":1}"}），导致前端取不到值。
 * <p>
 * 该序列化器把非空文本以原始 JSON 结构写出；空值/空串安全地输出为 {@code null}，
 * 避免产生非法 JSON。通过 {@code BeanSerializerModifier} 仅注册到 Web 层 ObjectMapper
 * （见 {@code RawJsonJacksonConfig}），不会影响 Redis 缓存的序列化。
 */
public class RawJsonSerializer extends JsonSerializer<Object> {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * 将 JSON 文本解析为结构化节点，供需要放入 Map/DTO 的场景使用。
     * 空值或解析失败时返回 {@code null}。
     */
    public static JsonNode parse(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        try {
            return MAPPER.readTree(text);
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public void serialize(Object value, JsonGenerator gen, SerializerProvider serializers) throws IOException {
        if (value == null) {
            gen.writeNull();
            return;
        }
        String text = value.toString();
        if (text.isBlank()) {
            gen.writeNull();
            return;
        }
        try {
            gen.writeRawValue(text);
        } catch (IOException e) {
            // 兜底：万一不是合法 JSON，则退回普通字符串，保证输出仍是合法 JSON
            gen.writeString(text);
        }
    }
}
