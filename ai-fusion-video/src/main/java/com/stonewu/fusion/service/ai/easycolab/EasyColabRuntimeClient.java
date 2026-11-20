package com.stonewu.fusion.service.ai.easycolab;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.stonewu.fusion.common.BusinessException;
import lombok.RequiredArgsConstructor;
import okhttp3.Credentials;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Duration;

/**
 * 访问 Colab 上 EasyColab 服务端（app.py）的管理 API，用于启动 ComfyUI 并读取其公网隧道地址。
 */
@Component
@RequiredArgsConstructor
public class EasyColabRuntimeClient {

    public static final String ADMIN_USERNAME = "easycolab";
    private static final MediaType JSON = MediaType.get("application/json");

    private final ObjectMapper objectMapper;
    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(Duration.ofSeconds(20))
            .readTimeout(Duration.ofSeconds(60))
            .build();

    public void startComfyUi(String serviceUrl, String password) {
        execute(new Request.Builder()
                .url(serviceUrl + "/minimax_api/comfyui/start")
                .post(RequestBody.create("{\"unload_existing\":false,\"force_restart\":false}", JSON)), password);
    }

    /** 返回 app.py 的 comfyui 状态对象（含 running / is_starting / public_url / status_message 等） */
    public JsonNode comfyUiStatus(String serviceUrl, String password) {
        JsonNode body = execute(new Request.Builder()
                .url(serviceUrl + "/minimax_api/comfyui/status")
                .get(), password);
        return body.path("comfyui");
    }

    private JsonNode execute(Request.Builder builder, String password) {
        Request request = builder
                .header("Authorization", Credentials.basic(ADMIN_USERNAME, password))
                .build();
        try (Response response = client.newCall(request).execute()) {
            ResponseBody body = response.body();
            String text = body == null ? "" : body.string();
            if (!response.isSuccessful()) {
                throw new BusinessException(502, "EasyColab 服务端返回 HTTP " + response.code());
            }
            return objectMapper.readTree(text);
        } catch (IOException e) {
            throw new BusinessException(502, "访问 EasyColab 服务端失败: " + e.getMessage());
        }
    }
}
