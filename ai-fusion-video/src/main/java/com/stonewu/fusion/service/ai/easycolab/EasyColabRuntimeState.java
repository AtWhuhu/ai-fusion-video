package com.stonewu.fusion.service.ai.easycolab;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * afv 管理的 EasyColab Colab 实例状态，持久化在 EasyColab HOME 目录下。
 */
@Data
public class EasyColabRuntimeState {

    public enum Phase {
        IDLE, WAKING, STARTING_COMFYUI, IMPORTING_WORKFLOWS, READY, RELEASING, FAILED;

        public boolean busy() {
            return this == WAKING || this == STARTING_COMFYUI || this == IMPORTING_WORKFLOWS || this == RELEASING;
        }
    }

    private Phase phase = Phase.IDLE;
    private String gpu;
    private Integer idleTimeoutMinutes;
    /** EasyColab 服务端（app.py）公网地址 */
    private String serviceUrl;
    /** ComfyUI 公网隧道地址 */
    private String comfyUiUrl;
    private Long apiConfigId;
    private Integer importedWorkflowCount;
    private String message;
    private String error;
    private LocalDateTime updatedAt;
    private List<String> logs = new ArrayList<>();
}
