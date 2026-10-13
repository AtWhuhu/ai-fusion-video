package com.stonewu.fusion.controller.system;

import com.stonewu.fusion.common.CommonResult;
import com.stonewu.fusion.service.storage.MediaCleanupService;
import com.stonewu.fusion.service.storage.MediaCleanupService.CleanupPurgeResult;
import com.stonewu.fusion.service.storage.MediaCleanupService.CleanupScanResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 媒体孤儿清理 Controller。
 * <p>
 * 用于回收存储桶内"未被任何数据库记录引用"的孤儿媒体文件（重新生图 / 删资产留下的旧文件）。
 * {@code /scan} 为只读预检，{@code /execute} 才实际删除。
 */
@Tag(name = "媒体清理")
@RestController
@RequestMapping("/api/system/media-cleanup")
@RequiredArgsConstructor
public class MediaCleanupController {

    private final MediaCleanupService mediaCleanupService;

    @Operation(summary = "扫描孤儿媒体文件（只读预检，不删除）")
    @PostMapping("/scan")
    public CommonResult<CleanupScanResult> scan() {
        return CommonResult.success(mediaCleanupService.scan());
    }

    @Operation(summary = "清理孤儿媒体文件（删除未被任何记录引用的文件）")
    @PostMapping("/execute")
    public CommonResult<CleanupPurgeResult> execute() {
        return CommonResult.success(mediaCleanupService.purge());
    }
}
