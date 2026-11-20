package com.stonewu.fusion.service.ai.easycolab;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.nio.file.Path;

@Data
@Component
@ConfigurationProperties(prefix = "fusion.easycolab")
public class EasyColabProperties {

    /** 包含 colab_bridge.py、app.py、runtime_auth.py 的目录 */
    private String bridgeDir = "/opt/easycolab";

    /** 已安装 google-colab-cli 依赖的 Python 解释器 */
    private String python = "/opt/easycolab/venv/bin/python";

    /** 传给 colab_bridge.py 的 HOME，保存 Google OAuth 令牌与 Colab 会话状态 */
    private String homeDir = "./data/easycolab";

    public Path bridgeScript() {
        return Path.of(bridgeDir, "colab_bridge.py").toAbsolutePath();
    }

    public Path appPy() {
        return Path.of(bridgeDir, "app.py").toAbsolutePath();
    }

    public Path home() {
        return Path.of(homeDir).toAbsolutePath();
    }
}
