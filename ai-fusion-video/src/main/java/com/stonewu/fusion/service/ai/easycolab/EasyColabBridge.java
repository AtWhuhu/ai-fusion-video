package com.stonewu.fusion.service.ai.easycolab;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.stonewu.fusion.common.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * 以子进程方式调用 EasyColab 的 colab_bridge.py（google-colab-cli 无头唤醒 / 授权 / 释放）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class EasyColabBridge {

    private static final Duration JSON_COMMAND_TIMEOUT = Duration.ofMinutes(3);

    private final EasyColabProperties properties;
    private final ObjectMapper objectMapper;

    /** 执行输出单行 JSON 的命令（auth_status / auth_url / auth_code / auth_logout / keepalive / stop_all） */
    public JsonNode runJson(String... args) {
        List<String> lines = new ArrayList<>();
        run(List.of(args), Map.of(), lines::add, JSON_COMMAND_TIMEOUT);
        return parseLastJson(lines);
    }

    /** 逐行回调 stdout，直到进程结束或超时 */
    public void run(List<String> args, Map<String, String> env, Consumer<String> onLine, Duration timeout) {
        Path script = properties.bridgeScript();
        if (!Files.isRegularFile(script)) {
            throw new BusinessException(500, "未找到 EasyColab 唤醒组件: " + script);
        }
        Path home = properties.home();
        List<String> command = new ArrayList<>();
        command.add(properties.getPython());
        command.add(script.toString());
        command.addAll(args);
        ProcessBuilder builder = new ProcessBuilder(command)
                .directory(script.getParent().toFile())
                .redirectError(ProcessBuilder.Redirect.appendTo(home.resolve("colab_bridge.stderr.log").toFile()));
        builder.environment().put("HOME", home.toString());
        builder.environment().put("PYTHONUNBUFFERED", "1");
        builder.environment().put("PYTHONIOENCODING", "utf-8");
        builder.environment().putAll(env);
        Process process;
        try {
            Files.createDirectories(home);
            process = builder.start();
        } catch (IOException e) {
            throw new BusinessException(500, "启动 EasyColab 唤醒组件失败: " + e.getMessage());
        }
        Thread killer = Thread.ofVirtual().start(() -> {
            try {
                if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                    log.warn("[EasyColab] colab_bridge.py {} 超时，强制结束", args.getFirst());
                    process.destroyForcibly();
                }
            } catch (InterruptedException e) {
                process.destroyForcibly();
                Thread.currentThread().interrupt();
            }
        });
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                onLine.accept(line);
            }
            process.waitFor();
        } catch (IOException e) {
            throw new BusinessException(500, "读取 EasyColab 唤醒组件输出失败: " + e.getMessage());
        } catch (InterruptedException e) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new BusinessException(500, "EasyColab 唤醒组件被中断");
        } finally {
            killer.interrupt();
        }
    }

    JsonNode parseLastJson(List<String> lines) {
        for (int i = lines.size() - 1; i >= 0; i--) {
            String line = lines.get(i).trim();
            if (line.startsWith("{")) {
                try {
                    return objectMapper.readTree(line);
                } catch (JsonProcessingException e) {
                    throw new BusinessException(500, "EasyColab 唤醒组件返回了无法解析的 JSON");
                }
            }
        }
        throw new BusinessException(500, "EasyColab 唤醒组件没有返回结果，请查看 "
                + properties.home().resolve("colab_bridge.stderr.log"));
    }
}
