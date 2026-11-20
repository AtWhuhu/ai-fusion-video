package com.stonewu.fusion.service.ai.easycolab;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.stonewu.fusion.entity.ai.ApiConfig;
import com.stonewu.fusion.service.ai.ApiConfigService;
import com.stonewu.fusion.service.ai.easycolab.EasyColabRuntimeState.Phase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EasyColabServiceTests {

    private static final ObjectMapper MAPPER = new ObjectMapper().registerModule(new JavaTimeModule());

    @TempDir
    Path dir;
    @Mock
    private EasyColabRuntimeClient runtimeClient;
    @Mock
    private EasyColabPresetImporter presetImporter;
    @Mock
    private ApiConfigService apiConfigService;

    private EasyColabService service;
    private Path envDump;

    @BeforeEach
    void setUp() throws IOException {
        Path bridgeDir = Files.createDirectories(dir.resolve("bridge"));
        envDump = dir.resolve("env.txt");
        Files.writeString(bridgeDir.resolve("colab_bridge.py"), """
                import json, os, sys
                cmd = sys.argv[1]
                if cmd == "wake":
                    with open(%s, "w") as f:
                        f.write(os.environ["HOME"] + "\\n" + os.environ["EASYCOLAB_ADMIN_PASSWORD"] + "\\n"
                                + os.environ["EASYCOLAB_IDLE_TIMEOUT_MINUTES"] + "\\n" + " ".join(sys.argv[2:]))
                    print("WAKE_LOG: 正在申请", flush=True)
                    print("noise", flush=True)
                    print("WAKE_URL:https://abc.gradio.live/", flush=True)
                elif cmd == "stop_all":
                    print("log line")
                    print(json.dumps({"ok": True, "message": "released"}))
                else:
                    print(json.dumps({"ok": True, "cmd": cmd, "home": os.environ["HOME"]}))
                """.formatted(MAPPER.writeValueAsString(envDump.toString())));
        EasyColabProperties properties = new EasyColabProperties();
        properties.setBridgeDir(bridgeDir.toString());
        properties.setPython("python3");
        properties.setHomeDir(dir.resolve("home").toString());
        EasyColabBridge bridge = new EasyColabBridge(properties, MAPPER);
        service = new EasyColabService(properties, bridge, runtimeClient, presetImporter, apiConfigService, MAPPER);
    }

    @Test
    void authCommandsRunBridgeWithPersistentHome() {
        assertThat(service.authStatus().path("cmd").asText()).isEqualTo("auth_status");
        assertThat(service.authStatus().path("home").asText()).isEqualTo(dir.resolve("home").toString());
    }

    @Test
    void wakeDeploysComfyUiAndCreatesBasicAuthChannel() throws Exception {
        ObjectNode starting = MAPPER.createObjectNode().put("is_starting", true).put("status_message", "启动中");
        ObjectNode running = MAPPER.createObjectNode().put("is_running", true)
                .put("public_url", "https://x.trycloudflare.com/").put("status_message", "运行中");
        when(runtimeClient.comfyUiStatus(eq("https://abc.gradio.live"), anyString()))
                .thenReturn(starting, running);
        when(apiConfigService.createApiConfig(any())).thenReturn(42L);
        when(presetImporter.importPresets(42L)).thenReturn(6);

        service.wake("l4", 0);
        EasyColabRuntimeState state = awaitPhase(Phase.READY);

        String[] env = Files.readString(envDump).split("\n");
        assertThat(env[0]).isEqualTo(dir.resolve("home").toString());
        assertThat(env[1]).matches("[A-Za-z0-9_-]{32}");
        assertThat(env[2]).isEqualTo("0");
        assertThat(env[3]).startsWith("--gpu L4 --app-py ").endsWith("app.py");
        ArgumentCaptor<ApiConfig> config = ArgumentCaptor.forClass(ApiConfig.class);
        verify(apiConfigService).createApiConfig(config.capture());
        assertThat(config.getValue().getPlatform()).isEqualTo("comfyui");
        assertThat(config.getValue().getApiUrl()).isEqualTo("https://x.trycloudflare.com");
        assertThat(config.getValue().getAppId()).isEqualTo("easycolab");
        assertThat(config.getValue().getApiKey()).isEqualTo(env[1]);
        verify(runtimeClient).startComfyUi("https://abc.gradio.live", env[1]);
        assertThat(state.getServiceUrl()).isEqualTo("https://abc.gradio.live");
        assertThat(state.getComfyUiUrl()).isEqualTo("https://x.trycloudflare.com");
        assertThat(state.getApiConfigId()).isEqualTo(42L);
        assertThat(state.getImportedWorkflowCount()).isEqualTo(6);
        assertThat(state.getLogs()).contains("正在申请", "启动中", "运行中").doesNotContain("noise");
        assertThat(Files.exists(dir.resolve("home/afv-easycolab-state.json"))).isTrue();
    }

    @Test
    void releaseStopsRuntimeAndDisablesChannel() throws Exception {
        Files.createDirectories(dir.resolve("home"));
        EasyColabRuntimeState saved = new EasyColabRuntimeState();
        saved.setPhase(Phase.READY);
        saved.setApiConfigId(42L);
        saved.setComfyUiUrl("https://x.trycloudflare.com");
        MAPPER.writeValue(dir.resolve("home/afv-easycolab-state.json").toFile(), saved);
        service.loadState();
        when(apiConfigService.getById(42L)).thenReturn(ApiConfig.builder().id(42L).platform("comfyui").build());

        service.release();
        EasyColabRuntimeState state = awaitPhase(Phase.IDLE);

        assertThat(state.getComfyUiUrl()).isNull();
        assertThat(state.getMessage()).isEqualTo("released");
        verify(apiConfigService).updateApiConfig(42L, null, null, null, null, null, null,
                null, null, null, null, null, null, null,
                null, null, null, null, 0, null);
    }

    private EasyColabRuntimeState awaitPhase(Phase phase) throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            EasyColabRuntimeState state = service.getState();
            if (state.getPhase() == phase) {
                return state;
            }
            assertThat(state.getPhase()).as(String.join("\n", state.getLogs())).isNotEqualTo(Phase.FAILED);
            Thread.sleep(100);
        }
        throw new AssertionError("phase did not reach " + phase + ": " + service.getState().getPhase());
    }
}
