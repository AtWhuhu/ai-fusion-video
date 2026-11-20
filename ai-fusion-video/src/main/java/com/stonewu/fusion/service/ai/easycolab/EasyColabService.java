package com.stonewu.fusion.service.ai.easycolab;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.stonewu.fusion.common.BusinessException;
import com.stonewu.fusion.entity.ai.ApiConfig;
import com.stonewu.fusion.service.ai.ApiConfigService;
import com.stonewu.fusion.service.ai.easycolab.EasyColabRuntimeState.Phase;
import cn.hutool.core.util.StrUtil;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * EasyColab 一键唤醒：Google 授权 → 申请 Colab GPU → 部署 EasyColab 服务端 → 启动 ComfyUI 隧道
 * → 自动维护 afv 的 ComfyUI API 配置并导入预置工作流 → 释放实例。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EasyColabService {

    public static final String API_CONFIG_NAME = "EasyColab ComfyUI";
    public static final Set<String> GPU_TYPES = Set.of("T4", "L4", "G4", "A100", "H100");
    private static final String PASSWORD_ALPHABET =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    private static final int PASSWORD_LENGTH = 32;
    private static final int MAX_LOGS = 200;
    private static final Duration WAKE_TIMEOUT = Duration.ofMinutes(20);
    private static final Duration COMFYUI_TIMEOUT = Duration.ofMinutes(30);
    private static final Duration COMFYUI_POLL_INTERVAL = Duration.ofSeconds(5);

    private final EasyColabProperties properties;
    private final EasyColabBridge bridge;
    private final EasyColabRuntimeClient runtimeClient;
    private final EasyColabPresetImporter presetImporter;
    private final ApiConfigService apiConfigService;
    private final ObjectMapper objectMapper;
    private final SecureRandom random = new SecureRandom();

    private EasyColabRuntimeState state = new EasyColabRuntimeState();

    @PostConstruct
    void loadState() {
        Path file = stateFile();
        if (!Files.isRegularFile(file)) {
            return;
        }
        try {
            state = objectMapper.readValue(file.toFile(), EasyColabRuntimeState.class);
        } catch (IOException e) {
            log.warn("[EasyColab] 读取状态文件失败: {}", e.getMessage());
            return;
        }
        if (state.getPhase().busy()) {
            fail("afv 重启打断了上一次操作，请重新唤醒或释放实例");
        }
    }

    public synchronized EasyColabRuntimeState getState() {
        return objectMapper.convertValue(state, EasyColabRuntimeState.class);
    }

    /** 渠道配置里的 EasyColab 管理密码，用于登录 EasyColab 控制台 */
    public String adminPassword() {
        ApiConfig managed;
        synchronized (this) {
            managed = findManagedApiConfig();
        }
        if (managed == null || StrUtil.isBlank(managed.getApiKey())) {
            throw new BusinessException(404, "EasyColab 渠道尚未就绪，请先唤醒实例");
        }
        return managed.getApiKey();
    }

    public JsonNode authStatus() {
        return bridge.runJson("auth_status");
    }

    public JsonNode authUrl() {
        return bridge.runJson("auth_url");
    }

    public JsonNode submitAuthCode(String code) {
        return bridge.runJson("auth_code", code.trim());
    }

    public JsonNode logout() {
        return bridge.runJson("auth_logout");
    }

    public synchronized EasyColabRuntimeState wake(String gpu, int idleTimeoutMinutes) {
        String gpuType = gpu.trim().toUpperCase();
        if (!GPU_TYPES.contains(gpuType)) {
            throw new BusinessException(400, "不支持的 GPU 类型: " + gpu);
        }
        if (state.getPhase().busy()) {
            throw new BusinessException(400, "EasyColab 正在" + describe(state.getPhase()) + "，请稍候");
        }
        state.setGpu(gpuType);
        state.setIdleTimeoutMinutes(idleTimeoutMinutes);
        state.setServiceUrl(null);
        state.setComfyUiUrl(null);
        state.setImportedWorkflowCount(null);
        state.setError(null);
        state.getLogs().clear();
        transition(Phase.WAKING, "正在申请 Colab " + gpuType + " 实例");
        Thread.ofVirtual().name("easycolab-wake").start(() -> runWake(gpuType, idleTimeoutMinutes));
        return getState();
    }

    public synchronized EasyColabRuntimeState release() {
        if (state.getPhase().busy()) {
            throw new BusinessException(400, "EasyColab 正在" + describe(state.getPhase()) + "，请稍候");
        }
        transition(Phase.RELEASING, "正在释放 Colab 实例");
        Thread.ofVirtual().name("easycolab-release").start(this::runRelease);
        return getState();
    }

    /** Colab 无浏览器会话需要定期心跳，否则会被回收 */
    @Scheduled(fixedDelay = 5 * 60 * 1000L, initialDelay = 5 * 60 * 1000L)
    public void keepalive() {
        if (state.getPhase() != Phase.READY) {
            return;
        }
        try {
            JsonNode result = bridge.runJson("keepalive");
            if (!result.path("ok").asBoolean()) {
                appendLog("心跳失败: " + result.path("error").asText());
            }
        } catch (BusinessException e) {
            appendLog("心跳失败: " + e.getMessage());
        }
    }

    private void runWake(String gpuType, int idleTimeoutMinutes) {
        try {
            ApiConfig existing = findManagedApiConfig();
            String password = existing != null && StrUtil.isNotBlank(existing.getApiKey())
                    ? existing.getApiKey() : generatePassword();
            String serviceUrl = deploy(gpuType, idleTimeoutMinutes, password);
            synchronized (this) {
                state.setServiceUrl(serviceUrl);
            }
            transition(Phase.STARTING_COMFYUI, "EasyColab 服务端已上线，正在启动 ComfyUI");
            String comfyUiUrl = startComfyUi(serviceUrl, password);
            Long apiConfigId = upsertApiConfig(existing, comfyUiUrl, password);
            synchronized (this) {
                state.setComfyUiUrl(comfyUiUrl);
                state.setApiConfigId(apiConfigId);
            }
            transition(Phase.IMPORTING_WORKFLOWS, "ComfyUI 已就绪，正在导入预置工作流");
            int imported = presetImporter.importPresets(apiConfigId);
            synchronized (this) {
                state.setImportedWorkflowCount(imported);
            }
            transition(Phase.READY, "ComfyUI 渠道已就绪");
        } catch (RuntimeException e) {
            log.warn("[EasyColab] 唤醒失败", e);
            fail(e.getMessage());
        }
    }

    private String deploy(String gpuType, int idleTimeoutMinutes, String password) {
        StringBuilder serviceUrl = new StringBuilder();
        StringBuilder error = new StringBuilder();
        bridge.run(
                List.of("wake", "--gpu", gpuType, "--app-py", properties.appPy().toString()),
                Map.of("EASYCOLAB_ADMIN_PASSWORD", password,
                        "EASYCOLAB_IDLE_TIMEOUT_MINUTES", String.valueOf(idleTimeoutMinutes)),
                line -> {
                    if (line.startsWith("WAKE_URL:")) {
                        serviceUrl.append(StrUtil.removeSuffix(line.substring("WAKE_URL:".length()).trim(), "/"));
                    } else if (line.startsWith("WAKE_ERROR:")) {
                        error.append(line.substring("WAKE_ERROR:".length()).trim());
                    } else if (line.startsWith("WAKE_LOG:")) {
                        appendLog(line.substring("WAKE_LOG:".length()).trim());
                    }
                },
                WAKE_TIMEOUT);
        if (!error.isEmpty()) {
            throw new BusinessException(502, error.toString());
        }
        if (serviceUrl.isEmpty()) {
            throw new BusinessException(504, "Colab 实例未返回 EasyColab 服务地址");
        }
        return serviceUrl.toString();
    }

    private String startComfyUi(String serviceUrl, String password) {
        runtimeClient.startComfyUi(serviceUrl, password);
        long deadline = System.nanoTime() + COMFYUI_TIMEOUT.toNanos();
        String lastMessage = null;
        boolean seenStarting = false;
        while (System.nanoTime() < deadline) {
            sleep(COMFYUI_POLL_INTERVAL);
            JsonNode status = runtimeClient.comfyUiStatus(serviceUrl, password);
            String message = status.path("status_message").asText("");
            if (!message.isBlank() && !message.equals(lastMessage)) {
                appendLog(message);
                lastMessage = message;
            }
            boolean running = status.path("is_running").asBoolean();
            boolean starting = status.path("is_starting").asBoolean();
            String publicUrl = status.path("public_url").asText("");
            if (running && !publicUrl.isBlank()) {
                return StrUtil.removeSuffix(publicUrl, "/");
            }
            if (seenStarting && !starting && !running) {
                throw new BusinessException(502, "ComfyUI 启动失败: " + message);
            }
            seenStarting = seenStarting || starting;
        }
        throw new BusinessException(504, "等待 ComfyUI 隧道超时");
    }

    private Long upsertApiConfig(ApiConfig existing, String comfyUiUrl, String password) {
        String remark = "由 EasyColab 一键唤醒自动维护，地址随每次唤醒更新";
        if (existing != null) {
            apiConfigService.updateApiConfig(existing.getId(), null, null, null, null, null, null,
                    comfyUiUrl, false, null, null, null, null, null,
                    password, EasyColabRuntimeClient.ADMIN_USERNAME, null, null, 1, remark);
            return existing.getId();
        }
        return apiConfigService.createApiConfig(ApiConfig.builder()
                .name(API_CONFIG_NAME)
                .platform("comfyui")
                .apiUrl(comfyUiUrl)
                .autoAppendV1Path(false)
                .appId(EasyColabRuntimeClient.ADMIN_USERNAME)
                .apiKey(password)
                .status(1)
                .remark(remark)
                .build());
    }

    private void runRelease() {
        try {
            JsonNode result = bridge.runJson("stop_all");
            if (!result.path("ok").asBoolean()) {
                throw new BusinessException(502, result.path("error").asText("释放 Colab 实例失败"));
            }
            ApiConfig managed = findManagedApiConfig();
            if (managed != null) {
                apiConfigService.updateApiConfig(managed.getId(), null, null, null, null, null, null,
                        null, null, null, null, null, null, null,
                        null, null, null, null, 0, null);
            }
            synchronized (this) {
                state.setServiceUrl(null);
                state.setComfyUiUrl(null);
            }
            transition(Phase.IDLE, result.path("message").asText("Colab 实例已释放"));
        } catch (RuntimeException e) {
            log.warn("[EasyColab] 释放失败", e);
            fail(e.getMessage());
        }
    }

    private ApiConfig findManagedApiConfig() {
        Long id = state.getApiConfigId();
        if (id == null) {
            return null;
        }
        ApiConfig config = apiConfigService.getById(id);
        return config != null && "comfyui".equals(config.getPlatform()) ? config : null;
    }

    String generatePassword() {
        StringBuilder sb = new StringBuilder(PASSWORD_LENGTH);
        for (int i = 0; i < PASSWORD_LENGTH; i++) {
            sb.append(PASSWORD_ALPHABET.charAt(random.nextInt(PASSWORD_ALPHABET.length())));
        }
        return sb.toString();
    }

    private synchronized void transition(Phase phase, String message) {
        state.setPhase(phase);
        state.setMessage(message);
        appendLog(message);
    }

    private synchronized void fail(String error) {
        state.setPhase(Phase.FAILED);
        state.setError(error);
        state.setMessage(error);
        appendLog("失败: " + error);
    }

    private synchronized void appendLog(String line) {
        List<String> logs = state.getLogs();
        logs.add(line);
        if (logs.size() > MAX_LOGS) {
            logs.subList(0, logs.size() - MAX_LOGS).clear();
        }
        state.setUpdatedAt(LocalDateTime.now());
        persist();
    }

    private void persist() {
        try {
            Files.createDirectories(properties.home());
            objectMapper.writeValue(stateFile().toFile(), state);
        } catch (IOException e) {
            log.warn("[EasyColab] 写入状态文件失败: {}", e.getMessage());
        }
    }

    private Path stateFile() {
        return properties.home().resolve("afv-easycolab-state.json");
    }

    private static String describe(Phase phase) {
        return switch (phase) {
            case WAKING -> "唤醒 Colab";
            case STARTING_COMFYUI -> "启动 ComfyUI";
            case IMPORTING_WORKFLOWS -> "导入工作流";
            case RELEASING -> "释放实例";
            default -> "处理";
        };
    }

    private static void sleep(Duration duration) {
        try {
            Thread.sleep(duration);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BusinessException(500, "等待 ComfyUI 启动被中断");
        }
    }
}
