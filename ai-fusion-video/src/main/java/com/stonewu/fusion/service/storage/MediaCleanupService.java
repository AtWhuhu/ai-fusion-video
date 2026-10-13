package com.stonewu.fusion.service.storage;

import cn.hutool.core.util.StrUtil;
import com.stonewu.fusion.common.BusinessException;
import com.stonewu.fusion.entity.asset.Asset;
import com.stonewu.fusion.entity.asset.AssetItem;
import com.stonewu.fusion.entity.generation.ImageItem;
import com.stonewu.fusion.entity.generation.ImageTask;
import com.stonewu.fusion.entity.generation.VideoItem;
import com.stonewu.fusion.entity.generation.VideoTask;
import com.stonewu.fusion.entity.project.Project;
import com.stonewu.fusion.entity.storyboard.StoryboardEpisode;
import com.stonewu.fusion.entity.storyboard.StoryboardItem;
import com.stonewu.fusion.mapper.asset.AssetItemMapper;
import com.stonewu.fusion.mapper.asset.AssetMapper;
import com.stonewu.fusion.mapper.generation.ImageItemMapper;
import com.stonewu.fusion.mapper.generation.ImageTaskMapper;
import com.stonewu.fusion.mapper.generation.VideoItemMapper;
import com.stonewu.fusion.mapper.generation.VideoTaskMapper;
import com.stonewu.fusion.mapper.project.ProjectMapper;
import com.stonewu.fusion.mapper.storyboard.StoryboardEpisodeMapper;
import com.stonewu.fusion.mapper.storyboard.StoryboardItemMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 媒体孤儿清理服务。
 * <p>
 * 融光存储层无删除能力，重新生图 / 删资产 / 删项目都不会回收文件，桶只增不减。本服务枚举存储后端中的对象，
 * 与全库引用的媒体 URL 做差集，删除"未被任何数据库记录引用"的孤儿文件。
 * <p>
 * 安全约束：
 * <ul>
 *   <li>只处理对象键扩展名在白名单内的媒体文件；</li>
 *   <li>只删除落在<b>本存储公开域名前缀</b>下的对象（外链如 flow-content.google 不在此列）；</li>
 *   <li>引用集合覆盖所有可能存放媒体 URL 的列，含 JSON 文本列内嵌的 URL；</li>
 *   <li>{@link #scan()} 为只读预检，{@link #purge()} 才实际删除。</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MediaCleanupService {

    /** 允许清理的媒体扩展名（其余对象一律不动）。 */
    private static final Set<String> MEDIA_EXTENSIONS = Set.of(
            "jpg", "jpeg", "png", "webp", "gif", "bmp", "svg",
            "mp4", "webm", "mov", "m4v",
            "mp3", "wav", "m4a", "aac", "ogg", "flac");

    /** 对象键中不可能是键内容的字符（用于从长文本里截出 URL 后的 key 段）。 */
    private static final Set<Character> KEY_STOP_CHARS = Set.of(
            '"', '\'', '<', '>', '\\', ' ', '\t', '\n', '\r', ')', ']', '}', ',', ';', '(', '[', '{');

    private static final int SAMPLE_LIMIT = 100;

    private final MediaStorageService mediaStorageService;
    private final AssetItemMapper assetItemMapper;
    private final AssetMapper assetMapper;
    private final ProjectMapper projectMapper;
    private final ImageItemMapper imageItemMapper;
    private final ImageTaskMapper imageTaskMapper;
    private final VideoItemMapper videoItemMapper;
    private final VideoTaskMapper videoTaskMapper;
    private final StoryboardItemMapper storyboardItemMapper;
    private final StoryboardEpisodeMapper storyboardEpisodeMapper;

    /** 只读预检：返回存储总量与孤儿统计，不删除任何文件。 */
    public CleanupScanResult scan() {
        String urlPrefix = requireOwnedUrlPrefix();
        List<StorageObject> objects = mediaStorageService.listObjects(null);
        List<StorageObject> orphans = filterOrphans(objects, collectReferencedKeys(urlPrefix));
        long totalBytes = objects.stream().mapToLong(StorageObject::size).sum();
        long orphanBytes = orphans.stream().mapToLong(StorageObject::size).sum();
        List<CleanupItem> sample = new ArrayList<>();
        for (int i = 0; i < orphans.size() && i < SAMPLE_LIMIT; i++) {
            StorageObject object = orphans.get(i);
            sample.add(new CleanupItem(object.key(), object.size()));
        }
        log.info("[MediaCleanup] 扫描完成: total={}, totalBytes={}, orphans={}, orphanBytes={}",
                objects.size(), totalBytes, orphans.size(), orphanBytes);
        return new CleanupScanResult(objects.size(), totalBytes, orphans.size(), orphanBytes, sample);
    }

    /** 执行清理：删除全部孤儿文件。 */
    public CleanupPurgeResult purge() {
        String urlPrefix = requireOwnedUrlPrefix();
        List<StorageObject> objects = mediaStorageService.listObjects(null);
        List<StorageObject> orphans = filterOrphans(objects, collectReferencedKeys(urlPrefix));
        int deleted = 0;
        long deletedBytes = 0;
        List<CleanupItem> failed = new ArrayList<>();
        for (StorageObject object : orphans) {
            try {
                mediaStorageService.deleteObject(object.key());
                deleted++;
                deletedBytes += object.size();
            } catch (Exception e) {
                log.warn("[MediaCleanup] 删除失败: key={}, err={}", object.key(), e.getMessage());
                failed.add(new CleanupItem(object.key(), object.size()));
            }
        }
        log.info("[MediaCleanup] 清理完成: deleted={}, deletedBytes={}, failed={}",
                deleted, deletedBytes, failed.size());
        return new CleanupPurgeResult(deleted, deletedBytes, failed.size(), failed);
    }

    /** 本存储公开域名前缀；未配置自定义域名时无法可靠反查，直接报错而不是冒险删除。 */
    private String requireOwnedUrlPrefix() {
        String prefix = mediaStorageService.ownedUrlPrefix();
        if (StrUtil.isBlank(prefix)) {
            throw new BusinessException("无法确定本存储的公开访问前缀（请在存储配置中设置自定义域名/ CDN 域名），不支持按 URL 反查清理");
        }
        return prefix;
    }

    private List<StorageObject> filterOrphans(List<StorageObject> objects, Set<String> referenced) {
        List<StorageObject> orphans = new ArrayList<>();
        for (StorageObject object : objects) {
            if (!isMediaObject(object.key())) {
                continue;
            }
            if (referenced.contains(object.key())) {
                continue;
            }
            orphans.add(object);
        }
        return orphans;
    }

    private boolean isMediaObject(String key) {
        int dot = key.lastIndexOf('.');
        if (dot < 0 || dot == key.length() - 1) {
            return false;
        }
        return MEDIA_EXTENSIONS.contains(key.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

    /** 聚合全库引用的对象键（凡落在本存储域名前缀下的 URL）。 */
    private Set<String> collectReferencedKeys(String urlPrefix) {
        Set<String> keys = new HashSet<>();

        for (AssetItem item : assetItemMapper.selectList(null)) {
            addUrls(keys, urlPrefix, item.getImageUrl());
            addUrls(keys, urlPrefix, item.getThumbnailUrl());
            addUrls(keys, urlPrefix, item.getProperties());
        }
        for (Asset asset : assetMapper.selectList(null)) {
            addUrls(keys, urlPrefix, asset.getCoverUrl());
        }
        for (Project project : projectMapper.selectList(null)) {
            addUrls(keys, urlPrefix, project.getCoverUrl());
            addUrls(keys, urlPrefix, project.getArtStyleImageUrl());
        }
        for (ImageItem item : imageItemMapper.selectList(null)) {
            addUrls(keys, urlPrefix, item.getImageUrl());
            addUrls(keys, urlPrefix, item.getThumbnailUrl());
        }
        for (ImageTask task : imageTaskMapper.selectList(null)) {
            addUrls(keys, urlPrefix, task.getRefImageUrls());
        }
        for (VideoItem item : videoItemMapper.selectList(null)) {
            addUrls(keys, urlPrefix, item.getVideoUrl());
            addUrls(keys, urlPrefix, item.getCoverUrl());
            addUrls(keys, urlPrefix, item.getFirstFrameUrl());
            addUrls(keys, urlPrefix, item.getLastFrameUrl());
        }
        for (VideoTask task : videoTaskMapper.selectList(null)) {
            addUrls(keys, urlPrefix, task.getFirstFrameImageUrl());
            addUrls(keys, urlPrefix, task.getLastFrameImageUrl());
            addUrls(keys, urlPrefix, task.getReferenceImageUrls());
            addUrls(keys, urlPrefix, task.getReferenceVideoUrls());
            addUrls(keys, urlPrefix, task.getReferenceAudioUrls());
        }
        for (StoryboardItem item : storyboardItemMapper.selectList(null)) {
            addUrls(keys, urlPrefix, item.getImageUrl());
            addUrls(keys, urlPrefix, item.getReferenceImageUrl());
            addUrls(keys, urlPrefix, item.getVideoUrl());
            addUrls(keys, urlPrefix, item.getGeneratedImageUrl());
            addUrls(keys, urlPrefix, item.getFirstFrameImageUrl());
            addUrls(keys, urlPrefix, item.getLastFrameImageUrl());
            addUrls(keys, urlPrefix, item.getGeneratedVideoUrl());
        }
        for (StoryboardEpisode episode : storyboardEpisodeMapper.selectList(null)) {
            addUrls(keys, urlPrefix, episode.getComposedVideoUrl());
            addUrls(keys, urlPrefix, episode.getBgmAudioUrl());
            addUrls(keys, urlPrefix, episode.getBgmSfxAudioUrl());
        }
        return keys;
    }

    /** 从任意文本中提取所有"域名前缀 + 对象键"，并解码为原始 key。 */
    private void addUrls(Set<String> keys, String urlPrefix, String text) {
        if (StrUtil.isBlank(text)) {
            return;
        }
        int index = 0;
        while ((index = text.indexOf(urlPrefix, index)) >= 0) {
            int start = index + urlPrefix.length();
            int end = start;
            while (end < text.length() && !KEY_STOP_CHARS.contains(text.charAt(end))) {
                end++;
            }
            if (end > start) {
                keys.add(decodeKey(text.substring(start, end)));
            }
            index = end > start ? end : start;
        }
    }

    private String decodeKey(String rawKey) {
        try {
            return URLDecoder.decode(rawKey, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return rawKey;
        }
    }

    /** 扫描结果（样例列表最多 {@value #SAMPLE_LIMIT} 条）。 */
    public record CleanupScanResult(
            int totalObjects,
            long totalBytes,
            int orphanCount,
            long orphanBytes,
            List<CleanupItem> sampleOrphans) {
    }

    /** 清理结果。 */
    public record CleanupPurgeResult(
            int deletedCount,
            long deletedBytes,
            int failedCount,
            List<CleanupItem> failedItems) {
    }

    /** 单个对象条目。 */
    public record CleanupItem(String key, long size) {
    }
}
