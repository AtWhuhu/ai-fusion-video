package com.stonewu.fusion.controller.system;

import com.stonewu.fusion.common.CommonResult;
import com.stonewu.fusion.controller.system.vo.MediaAssetDeleteReqVO;
import com.stonewu.fusion.controller.system.vo.MediaAssetPageReqVO;
import com.stonewu.fusion.service.storage.MediaAssetService;
import com.stonewu.fusion.service.storage.MediaAssetService.DeleteResult;
import com.stonewu.fusion.service.storage.MediaAssetService.PageQuery;
import com.stonewu.fusion.service.storage.MediaAssetService.QueryResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 媒体资产 Controller。
 * <p>
 * 列出存储后端中的全部产出资产，标注其真实引用状态（使用中 / 历史产出 / 无引用），
 * 并提供删除能力。
 */
@Tag(name = "媒体资产")
@RestController
@RequestMapping("/api/system/media-assets")
@RequiredArgsConstructor
public class MediaAssetController {

    private final MediaAssetService mediaAssetService;

    @Operation(summary = "查询资产（概览 + 分页列表，一次列举）")
    @PostMapping("/query")
    public CommonResult<QueryResult> query(@RequestBody MediaAssetPageReqVO req) {
        return CommonResult.success(mediaAssetService.query(new PageQuery(
                req.getScope(),
                req.getMediaType(),
                req.getKeyword(),
                req.getPageNo() == null ? 1 : req.getPageNo(),
                req.getPageSize() == null ? 24 : req.getPageSize())));
    }

    @Operation(summary = "删除资产（使用中的资产会被拒绝）")
    @PostMapping("/delete")
    public CommonResult<DeleteResult> delete(@RequestBody MediaAssetDeleteReqVO req) {
        return CommonResult.success(mediaAssetService.delete(
                req.getKeys(), req.getScope(), !Boolean.FALSE.equals(req.getCleanupRecords())));
    }
}
