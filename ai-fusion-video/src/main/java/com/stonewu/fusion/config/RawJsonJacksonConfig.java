package com.stonewu.fusion.config;

import com.fasterxml.jackson.databind.BeanDescription;
import com.fasterxml.jackson.databind.Module;
import com.fasterxml.jackson.databind.SerializationConfig;
import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.databind.ser.BeanPropertyWriter;
import com.fasterxml.jackson.databind.ser.BeanSerializerModifier;
import com.stonewu.fusion.common.handler.RawJsonSerializer;
import com.stonewu.fusion.entity.asset.Asset;
import com.stonewu.fusion.entity.asset.AssetItem;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;
import java.util.Set;

/**
 * 仅作用于 Web 层（Spring MVC 自动配置的 ObjectMapper）的 Jackson 扩展。
 * <p>
 * 让资产实体的 JSON 文本字段（{@code properties} / {@code tags}）以结构化 JSON 输出，
 * 而不是被再次转义的字符串，从而与前端「按对象读取」的约定一致。
 * <p>
 * <b>为什么用 Module 而不是在实体上打 {@code @JsonSerialize}：</b>
 * Redis 缓存的 ObjectMapper 是独立实例（见 {@link CacheConfig#valueSerializer()}）且开启了默认
 * 类型信息，实体级注解会被其复用，序列化缓存值时抛出
 * {@code Type id handling not implemented for type java.lang.String}，导致缓存写入失败。
 * 注册为 Spring 的 {@code Module} Bean 后，Spring Boot 只会把它装配进 Web 层 ObjectMapper，
 * 缓存序列化保持原样（字符串安全往返）。
 * <p>
 * 注意：仅自定义「序列化」，请求体反序列化不受影响（前端仍以 JSON 字符串回传 properties）。
 */
@Configuration
public class RawJsonJacksonConfig {

    private static final Set<String> RAW_JSON_FIELDS = Set.of("properties", "tags");

    @Bean
    public Module rawJsonFieldModule() {
        SimpleModule module = new SimpleModule("rawJsonFieldModule");
        module.setSerializerModifier(new BeanSerializerModifier() {
            @Override
            public List<BeanPropertyWriter> changeProperties(SerializationConfig config,
                                                             BeanDescription beanDesc,
                                                             List<BeanPropertyWriter> beanProperties) {
                Class<?> beanClass = beanDesc.getBeanClass();
                if (beanClass == Asset.class || beanClass == AssetItem.class) {
                    for (BeanPropertyWriter writer : beanProperties) {
                        if (RAW_JSON_FIELDS.contains(writer.getName())) {
                            writer.assignSerializer(new RawJsonSerializer());
                        }
                    }
                }
                return beanProperties;
            }
        });
        return module;
    }
}
