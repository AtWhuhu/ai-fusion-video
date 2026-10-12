package com.stonewu.fusion.common.handler;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;

import java.io.IOException;

/**
 * 请求体中「JSON 文本字段」的宽松反序列化器。
 * <p>
 * {@code properties} / {@code tags} 这类字段在 Java 侧与数据库侧都以 {@code String}（JSON 文本）存储，
 * 但接口<b>输出</b>时会被序列化成 JSON 对象/数组（见 {@link RawJsonSerializer}）。
 * 这就造成契约不对称：客户端读到的对象无法原样写回，一旦按对象提交，Jackson 无法把
 * JSON 对象塞进 {@code String} 字段，接口直接报 500；前端被迫手工 {@code JSON.stringify}，
 * 若某处漏了（例如展开了一个仍是字符串的旧值）就会写出 {@code {"0":"{",...}} 之类的脏数据。
 * <p>
 * 该反序列化器让接口<b>同时接受</b>两种形态，使读写契约对称：
 * <ul>
 *   <li>JSON 对象/数组 → 原样转成 JSON 文本字符串</li>
 *   <li>JSON 字符串 → 原样返回（兼容历史客户端）</li>
 *   <li>数字/布尔 → 其字面量（仍是合法 JSON）</li>
 *   <li>{@code null} 或空白 → {@code null}（MySQL JSON 列不接受空串）</li>
 * </ul>
 * 仅注册在请求 VO 字段上（反序列化方向），不涉及实体，也不影响 Web 层的输出序列化与 Redis 缓存。
 */
public class RawJsonTextDeserializer extends JsonDeserializer<String> {

    @Override
    public String deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
        JsonNode node = ctxt.readTree(p);
        if (node == null || node.isNull()) {
            return null;
        }
        // 已经是字符串的（历史客户端）：直接沿用其内容，避免二次转义
        String text = node.isTextual() ? node.asText() : node.toString();
        if (text == null || text.isBlank()) {
            return null;
        }
        return text;
    }
}
