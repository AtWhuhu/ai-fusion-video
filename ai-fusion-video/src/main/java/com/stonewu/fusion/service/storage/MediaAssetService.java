package com.stonewu.fusion.service.storage;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.stonewu.fusion.common.BusinessException;
import com.stonewu.fusion.entity.asset.Asset;
import com.stonewu.fusion.entity.asset.AssetItem;
import com.stonewu.fusion.entity.generation.ImageItem;
import com.stonewu.fusion.entity.generation.ImageTask;
import com.stonewu.fusion.entity.generation.VideoItem;
import com.stonewu.fusion.entity.generation.VideoTask;
import com.stonewu.fusion.entity.project.Project;
import com.stonewu.fusion.entity.storyboard.Storyboard;
import com.stonewu.fusion.entity.storyboard.StoryboardEpisode;
import com.stonewu.fusion.entity.storyboard.StoryboardItem;
import com.stonewu.fusion.entity.storyboard.StoryboardScene;
import com.stonewu.fusion.mapper.asset.AssetItemMapper;
import com.stonewu.fusion.mapper.asset.AssetMapper;
import com.stonewu.fusion.mapper.generation.ImageItemMapper;
import com.stonewu.fusion.mapper.generation.ImageTaskMapper;
import com.stonewu.fusion.mapper.generation.VideoItemMapper;
import com.stonewu.fusion.mapper.generation.VideoTaskMapper;
import com.stonewu.fusion.mapper.project.ProjectMapper;
import com.stonewu.fusion.mapper.storyboard.StoryboardEpisodeMapper;
import com.stonewu.fusion.mapper.storyboard.StoryboardItemMapper;
import com.stonewu.fusion.mapper.storyboard.StoryboardMapper;
import com.stonewu.fusion.mapper.storyboard.StoryboardSceneMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Caching;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 媒体资产管理服务。
 * <p>
 * 枚举存储后端中的全部媒体对象，为每个对象建立"谁在引用它"的索引，并据此划分三种状态：
 * <ul>
 *   <li>{@code active} —— 被至少一个<b>当前有效字段</b>引用（分镜、资产、项目等正在使用的资源）；</li>
 *   <li>{@code history} —— 不被任何有效字段引用，但出现在<b>生成流水表</b>中（被替换掉的、历史生成产出的）；</li>
 *   <li>{@code orphan} —— 任何数据库记录都不引用。</li>
 * </ul>
 * 这是对 {@link MediaCleanupService} 口径的修正：后者把生成流水表也算作硬引用，导致旧文件永远不被识别为孤儿。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MediaAssetService {

    private static final Set<String> IMAGE_EXTENSIONS =
            Set.of("jpg", "jpeg", "png", "webp", "gif", "bmp", "svg");
    private static final Set<String> VIDEO_EXTENSIONS =
            Set.of("mp4", "webm", "mov", "m4v");
    private static final Set<String> AUDIO_EXTENSIONS =
            Set.of("mp3", "wav", "m4a", "aac", "ogg", "flac");
    private static final Set<String> MEDIA_EXTENSIONS = Stream
            .of(IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS)
            .flatMap(Set::stream)
            .collect(Collectors.toUnmodifiableSet());

    /** 对象键中不可能是键内容的字符（用于从长文本里截出 URL 后的 key 段）。 */
    private static final Set<Character> KEY_STOP_CHARS = Set.of(
            '"', '\'', '<', '>', '\\', ' ', '\t', '\n', '\r', ')', ']', '}', ',', ';', '(', '[', '{');

    public static final String STATUS_ACTIVE = "active";
    public static final String STATUS_HISTORY = "history";
    public static final String STATUS_ORPHAN = "orphan";

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
    private final StoryboardSceneMapper storyboardSceneMapper;
    private final StoryboardMapper storyboardMapper;

    // ============================================================
    // 对外能力
    // ============================================================

    /** 汇总统计：总量 + 三态分布 + 按媒体类型分布。 */
    public Overview overview() {
        String urlPrefix = requireOwnedUrlPrefix();
        List<StorageObject> objects = listMediaObjects();
        return buildOverview(objects, buildIndex(urlPrefix));
    }

    /**
     * 一次列举 + 一索引，同时返回概览与分页列表。
     * <p>
     * 概览与列表共用同一次存储列举结果，避免前端并行调用两个接口各自触发全量列举
     * （S3 兼容存储在并发 ListObjects 时偶发响应截断）。
     */
    public QueryResult query(PageQuery query) {
        String urlPrefix = requireOwnedUrlPrefix();
        List<StorageObject> objects = listMediaObjects();
        Map<String, List<Reference>> index = buildIndex(urlPrefix);
        Map<Long, String> projectNames = projectNamesSnapshot();
        Overview overview = buildOverview(objects, index);

        String scope = StrUtil.blankToDefault(query.scope(), "all");
        String mediaType = StrUtil.blankToDefault(query.mediaType(), "all");
        String keyword = StrUtil.trimToEmpty(query.keyword()).toLowerCase(Locale.ROOT);

        List<AssetItemVO> rows = new ArrayList<>();
        for (StorageObject object : objects) {
            if (!"all".equalsIgnoreCase(mediaType)
                    && !mediaType.equalsIgnoreCase(resolveMediaType(object.key()))) {
                continue;
            }
            List<Reference> refs = index.getOrDefault(object.key(), List.of());
            String status = resolveStatus(refs);
            if (!"all".equalsIgnoreCase(scope) && !scope.equalsIgnoreCase(status)) {
                continue;
            }
            if (!keyword.isEmpty() && !object.key().toLowerCase(Locale.ROOT).contains(keyword)) {
                continue;
            }
            rows.add(toItemVO(object, status, refs, projectNames, urlPrefix));
        }

        // 体积大的优先，便于集中处理占用空间最多的文件
        rows.sort(Comparator.comparingLong(AssetItemVO::size).reversed());

        int pageNo = Math.max(1, query.pageNo());
        int pageSize = Math.min(200, Math.max(1, query.pageSize()));
        int from = Math.min((pageNo - 1) * pageSize, rows.size());
        int to = Math.min(from + pageSize, rows.size());
        return new QueryResult(overview, new ArrayList<>(rows.subList(from, to)), rows.size());
    }

    /** 依据已经列举好的对象与索引计算概览。 */
    private Overview buildOverview(List<StorageObject> objects, Map<String, List<Reference>> index) {
        int activeCount = 0, historyCount = 0, orphanCount = 0;
        long activeBytes = 0, historyBytes = 0, orphanBytes = 0;
        Map<String, long[]> typeStat = new HashMap<>();

        for (StorageObject object : objects) {
            String status = resolveStatus(index.get(object.key()));
            if (STATUS_ACTIVE.equals(status)) {
                activeCount++;
                activeBytes += object.size();
            } else if (STATUS_HISTORY.equals(status)) {
                historyCount++;
                historyBytes += object.size();
            } else {
                orphanCount++;
                orphanBytes += object.size();
            }
            long[] stat = typeStat.computeIfAbsent(resolveMediaType(object.key()), k -> new long[2]);
            stat[0]++;
            stat[1] += object.size();
        }

        List<TypeStat> byType = typeStat.entrySet().stream()
                .map(e -> new TypeStat(e.getKey(), (int) e.getValue()[0], e.getValue()[1]))
                .sorted(Comparator.comparingLong(TypeStat::bytes).reversed())
                .toList();

        long totalBytes = objects.stream().mapToLong(StorageObject::size).sum();
        log.info("[MediaAsset] 概览: total={}, active={}, history={}, orphan={}",
                objects.size(), activeCount, historyCount, orphanCount);
        return new Overview(objects.size(), totalBytes,
                activeCount, activeBytes, historyCount, historyBytes, orphanCount, orphanBytes, byType);
    }

    /**
     * 批量删除资产。
     * <p>
     * 两种指定方式：给出 {@code keys} 删指定文件；或给出 {@code scope}（{@code history} / {@code orphan}）
     * 清空该状态下的全部文件。
     * <p>
     * 被当前有效字段引用的对象始终会被拒绝（进入 {@code blockedKeys}）；
     * {@code cleanupRecords} 为真时，同时清理生成流水表中指向已删对象的记录。
     */
    @Caching(evict = {
            @CacheEvict(value = "imageTask", allEntries = true),
            @CacheEvict(value = "imageItems", allEntries = true)
    })
    @Transactional
    public DeleteResult delete(List<String> keys, String scope, boolean cleanupRecords) {
        String urlPrefix = requireOwnedUrlPrefix();
        Map<String, List<Reference>> index = buildIndex(urlPrefix);
        Map<String, Long> sizeMap = listMediaObjects().stream()
                .collect(Collectors.toMap(StorageObject::key, StorageObject::size, (a, b) -> a));
        List<String> targets = resolveTargets(keys, scope, index, sizeMap.keySet());

        List<String> blocked = new ArrayList<>();
        List<String> failed = new ArrayList<>();
        List<String> deletedKeys = new ArrayList<>();
        long deletedBytes = 0;

        for (String key : targets) {
            if (StrUtil.isBlank(key)) {
                continue;
            }
            if (sizeMap.get(key) == null) {
                failed.add(key);
                continue;
            }
            if (STATUS_ACTIVE.equals(resolveStatus(index.get(key)))) {
                blocked.add(key);
                continue;
            }
            try {
                mediaStorageService.deleteObject(key);
                deletedKeys.add(key);
                deletedBytes += sizeMap.get(key);
            } catch (Exception e) {
                log.warn("[MediaAsset] 删除失败: key={}, err={}", key, e.getMessage());
                failed.add(key);
            }
        }

        int removedRecords = cleanupRecords ? removeDanglingRecords(deletedKeys, urlPrefix) : 0;

        log.info("[MediaAsset] 删除完成: deleted={}, bytes={}, blocked={}, failed={}, removedRecords={}",
                deletedKeys.size(), deletedBytes, blocked.size(), failed.size(), removedRecords);
        return new DeleteResult(deletedKeys.size(), deletedBytes, failed.size(), failed, blocked, removedRecords);
    }

    // ============================================================
    // 引用索引
    // ============================================================

    /** 构建「对象键 → 引用来源列表」索引。 */
    private Map<String, List<Reference>> buildIndex(String urlPrefix) {
        Map<String, List<Reference>> index = new HashMap<>();

        Map<Long, String> projectNames = projectMapper.selectList(null).stream()
                .collect(Collectors.toMap(Project::getId,
                        p -> StrUtil.blankToDefault(p.getName(), "项目 #" + p.getId()), (a, b) -> a));
        Map<Long, Long> storyboardToProject = storyboardMapper.selectList(null).stream()
                .filter(s -> s.getId() != null && s.getProjectId() != null)
                .collect(Collectors.toMap(Storyboard::getId, Storyboard::getProjectId, (a, b) -> a));
        Map<Long, String> episodeLabels = storyboardEpisodeMapper.selectList(null).stream()
                .collect(Collectors.toMap(StoryboardEpisode::getId,
                        e -> e.getEpisodeNumber() == null ? "第?集" : "第" + e.getEpisodeNumber() + "集",
                        (a, b) -> a));
        Map<Long, String> sceneLabels = storyboardSceneMapper.selectList(null).stream()
                .collect(Collectors.toMap(StoryboardScene::getId,
                        s -> StrUtil.blankToDefault(s.getSceneNumber(), "场景 #" + s.getId()), (a, b) -> a));
        Map<Long, String> assetNames = assetMapper.selectList(null).stream()
                .collect(Collectors.toMap(Asset::getId,
                        a -> StrUtil.blankToDefault(a.getName(), "资产 #" + a.getId()), (a, b) -> a));
        Map<Long, String> assetItemNames = assetItemMapper.selectList(null).stream()
                .collect(Collectors.toMap(AssetItem::getId,
                        i -> StrUtil.blankToDefault(i.getName(), "条目 #" + i.getId()), (a, b) -> a));

        // ---------- 当前有效引用 ----------

        for (StoryboardItem item : storyboardItemMapper.selectList(null)) {
            Long projectId = storyboardToProject.get(item.getStoryboardId());
            String scopeLabel = joinScope(projectNames.get(projectId),
                    episodeLabels.get(item.getStoryboardEpisodeId()),
                    sceneLabels.get(item.getStoryboardSceneId()),
                    item.getShotNumber());
            active(index, urlPrefix, item.getImageUrl(), "分镜", "afv_storyboard_item", "image_url",
                    item.getId(), scopeLabel + " · 分镜图", projectId);
            active(index, urlPrefix, item.getReferenceImageUrl(), "分镜", "afv_storyboard_item", "reference_image_url",
                    item.getId(), scopeLabel + " · 参考图", projectId);
            active(index, urlPrefix, item.getVideoUrl(), "分镜", "afv_storyboard_item", "video_url",
                    item.getId(), scopeLabel + " · 视频", projectId);
            active(index, urlPrefix, item.getGeneratedImageUrl(), "分镜", "afv_storyboard_item", "generated_image_url",
                    item.getId(), scopeLabel + " · 生成图", projectId);
            active(index, urlPrefix, item.getFirstFrameImageUrl(), "分镜", "afv_storyboard_item", "first_frame_image_url",
                    item.getId(), scopeLabel + " · 首帧图", projectId);
            active(index, urlPrefix, item.getLastFrameImageUrl(), "分镜", "afv_storyboard_item", "last_frame_image_url",
                    item.getId(), scopeLabel + " · 尾帧图", projectId);
            active(index, urlPrefix, item.getGeneratedVideoUrl(), "分镜", "afv_storyboard_item", "generated_video_url",
                    item.getId(), scopeLabel + " · 生成视频", projectId);
        }

        for (StoryboardEpisode episode : storyboardEpisodeMapper.selectList(null)) {
            Long projectId = storyboardToProject.get(episode.getStoryboardId());
            String scopeLabel = joinScope(projectNames.get(projectId), episodeLabels.get(episode.getId()), null, null);
            active(index, urlPrefix, episode.getComposedVideoUrl(), "成片", "afv_storyboard_episode", "composed_video_url",
                    episode.getId(), scopeLabel + " · 成片", projectId);
            active(index, urlPrefix, episode.getBgmAudioUrl(), "成片", "afv_storyboard_episode", "bgm_audio_url",
                    episode.getId(), scopeLabel + " · 配乐", projectId);
            active(index, urlPrefix, episode.getBgmSfxAudioUrl(), "成片", "afv_storyboard_episode", "bgm_sfx_audio_url",
                    episode.getId(), scopeLabel + " · 音效", projectId);
        }

        for (AssetItem item : assetItemMapper.selectList(null)) {
            Long projectId = null;
            String scopeLabel = joinScope(assetNames.get(item.getAssetId()), assetItemNames.get(item.getId()), null, null);
            active(index, urlPrefix, item.getImageUrl(), "资产", "afv_asset_item", "image_url",
                    item.getId(), scopeLabel + " · 资产图", projectId);
            active(index, urlPrefix, item.getThumbnailUrl(), "资产", "afv_asset_item", "thumbnail_url",
                    item.getId(), scopeLabel + " · 缩略图", projectId);
            active(index, urlPrefix, item.getProperties(), "资产", "afv_asset_item", "properties",
                    item.getId(), scopeLabel + " · 属性内嵌资源", projectId);
        }

        for (Asset asset : assetMapper.selectList(null)) {
            active(index, urlPrefix, asset.getCoverUrl(), "资产", "afv_asset", "cover_url",
                    asset.getId(), joinScope(assetNames.get(asset.getId()), null, null, null) + " · 封面",
                    asset.getProjectId());
        }

        for (Project project : projectMapper.selectList(null)) {
            String scopeLabel = projectNames.get(project.getId());
            active(index, urlPrefix, project.getCoverUrl(), "项目", "afv_project", "cover_url",
                    project.getId(), scopeLabel + " · 项目封面", project.getId());
            active(index, urlPrefix, project.getArtStyleImageUrl(), "项目", "afv_project", "art_style_image_url",
                    project.getId(), scopeLabel + " · 画风参考图", project.getId());
        }

        // ---------- 生成流水（历史产出） ----------

        for (ImageItem item : imageItemMapper.selectList(null)) {
            String scopeLabel = "图片生成 #" + item.getTaskId();
            history(index, urlPrefix, item.getImageUrl(), "生图历史", "afv_image_item", "image_url",
                    item.getId(), scopeLabel + " · 产出图");
            history(index, urlPrefix, item.getThumbnailUrl(), "生图历史", "afv_image_item", "thumbnail_url",
                    item.getId(), scopeLabel + " · 缩略图");
        }

        for (ImageTask task : imageTaskMapper.selectList(null)) {
            history(index, urlPrefix, task.getRefImageUrls(), "生图历史", "afv_image_task", "ref_image_urls",
                    task.getId(), "图片生成 #" + task.getId() + " · 参考图");
        }

        for (VideoItem item : videoItemMapper.selectList(null)) {
            String scopeLabel = "视频生成 #" + item.getTaskId();
            history(index, urlPrefix, item.getVideoUrl(), "视频历史", "afv_video_item", "video_url",
                    item.getId(), scopeLabel + " · 产出视频");
            history(index, urlPrefix, item.getCoverUrl(), "视频历史", "afv_video_item", "cover_url",
                    item.getId(), scopeLabel + " · 封面");
            history(index, urlPrefix, item.getFirstFrameUrl(), "视频历史", "afv_video_item", "first_frame_url",
                    item.getId(), scopeLabel + " · 首帧");
            history(index, urlPrefix, item.getLastFrameUrl(), "视频历史", "afv_video_item", "last_frame_url",
                    item.getId(), scopeLabel + " · 尾帧");
        }

        for (VideoTask task : videoTaskMapper.selectList(null)) {
            String scopeLabel = "视频生成 #" + task.getId();
            history(index, urlPrefix, task.getFirstFrameImageUrl(), "视频历史", "afv_video_task", "first_frame_image_url",
                    task.getId(), scopeLabel + " · 首帧输入");
            history(index, urlPrefix, task.getLastFrameImageUrl(), "视频历史", "afv_video_task", "last_frame_image_url",
                    task.getId(), scopeLabel + " · 尾帧输入");
            history(index, urlPrefix, task.getReferenceImageUrls(), "视频历史", "afv_video_task", "reference_image_urls",
                    task.getId(), scopeLabel + " · 参考图");
            history(index, urlPrefix, task.getReferenceVideoUrls(), "视频历史", "afv_video_task", "reference_video_urls",
                    task.getId(), scopeLabel + " · 参考视频");
            history(index, urlPrefix, task.getReferenceAudioUrls(), "视频历史", "afv_video_task", "reference_audio_urls",
                    task.getId(), scopeLabel + " · 参考音频");
        }

        return index;
    }

    private void active(Map<String, List<Reference>> index, String urlPrefix, String text, String category,
                        String table, String column, Long recordId, String label, Long projectId) {
        add(index, urlPrefix, text, new Reference(category, table, column, recordId, label, true, projectId));
    }

    private void history(Map<String, List<Reference>> index, String urlPrefix, String text, String category,
                         String table, String column, Long recordId, String label) {
        add(index, urlPrefix, text, new Reference(category, table, column, recordId, label, false, null));
    }

    private void add(Map<String, List<Reference>> index, String urlPrefix, String text, Reference reference) {
        for (String key : extractKeys(text, urlPrefix)) {
            index.computeIfAbsent(key, k -> new ArrayList<>()).add(reference);
        }
    }

    /** 从任意文本中提取所有「域名前缀 + 对象键」，并解码为原始 key。 */
    private Set<String> extractKeys(String text, String urlPrefix) {
        if (StrUtil.isBlank(text)) {
            return Set.of();
        }
        Set<String> keys = new LinkedHashSet<>();
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
        return keys;
    }

    private String decodeKey(String rawKey) {
        try {
            return URLDecoder.decode(rawKey, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return rawKey;
        }
    }

    // ============================================================
    // 内部工具
    // ============================================================

    /** 解析删除目标：优先按显式 keys；否则按 scope 匹配该状态下的全部文件。 */
    private List<String> resolveTargets(List<String> keys, String scope,
                                        Map<String, List<Reference>> index, Set<String> existingKeys) {
        if (keys != null && !keys.isEmpty()) {
            return keys.stream().filter(StrUtil::isNotBlank).distinct().toList();
        }
        if (StrUtil.isBlank(scope) || "all".equalsIgnoreCase(scope)) {
            throw new BusinessException("未指定要删除的文件");
        }
        if (STATUS_ACTIVE.equalsIgnoreCase(scope)) {
            throw new BusinessException("不支持批量删除使用中的资产");
        }
        return existingKeys.stream()
                .filter(key -> scope.equalsIgnoreCase(resolveStatus(index.get(key))))
                .toList();
    }

    /** 生成流水记录的清理：删除指向已删对象的条目，以及因此变为空的生成任务。 */
    private int removeDanglingRecords(List<String> deletedKeys, String urlPrefix) {
        if (deletedKeys.isEmpty()) {
            return 0;
        }
        List<String> urls = deletedKeys.stream().map(key -> urlPrefix + key).toList();
        List<ImageItem> items = imageItemMapper.selectList(new LambdaQueryWrapper<ImageItem>()
                .in(ImageItem::getImageUrl, urls)
                .or()
                .in(ImageItem::getThumbnailUrl, urls));
        if (items.isEmpty()) {
            return 0;
        }
        Set<Long> taskIds = items.stream().map(ImageItem::getTaskId)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        for (ImageItem item : items) {
            imageItemMapper.deleteById(item.getId());
        }
        int removedTasks = 0;
        for (Long taskId : taskIds) {
            Long remain = imageItemMapper.selectCount(new LambdaQueryWrapper<ImageItem>()
                    .eq(ImageItem::getTaskId, taskId));
            if (remain == null || remain == 0) {
                imageTaskMapper.deleteById(taskId);
                removedTasks++;
            }
        }
        return items.size() + removedTasks;
    }

    private List<StorageObject> listMediaObjects() {
        return mediaStorageService.listObjects(null).stream()
                .filter(object -> resolveMediaTypeOrNull(object.key()) != null)
                .toList();
    }

    private String resolveStatus(List<Reference> references) {
        if (references == null || references.isEmpty()) {
            return STATUS_ORPHAN;
        }
        boolean hasHistory = false;
        for (Reference reference : references) {
            if (reference.active()) {
                return STATUS_ACTIVE;
            }
            hasHistory = true;
        }
        return hasHistory ? STATUS_HISTORY : STATUS_ORPHAN;
    }

    private AssetItemVO toItemVO(StorageObject object, String status, List<Reference> references,
                                 Map<Long, String> projectNames, String urlPrefix) {
        Long projectId = references.stream()
                .map(Reference::projectId)
                .filter(Objects::nonNull)
                .findFirst().orElse(null);
        String projectName = projectId == null ? null : projectNames.get(projectId);
        return new AssetItemVO(object.key(), urlPrefix + object.key(),
                resolveMediaType(object.key()), extensionOf(object.key()),
                object.size(), object.lastModified(), status, !STATUS_ACTIVE.equals(status),
                projectId, projectName, references);
    }

    private Map<Long, String> projectNamesSnapshot() {
        return projectMapper.selectList(null).stream()
                .collect(Collectors.toMap(Project::getId,
                        p -> StrUtil.blankToDefault(p.getName(), "项目 #" + p.getId()), (a, b) -> a));
    }

    private String extensionOf(String key) {
        int dot = key.lastIndexOf('.');
        return dot < 0 ? "" : key.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private String resolveMediaType(String key) {
        String type = resolveMediaTypeOrNull(key);
        return type == null ? "other" : type;
    }

    private String resolveMediaTypeOrNull(String key) {
        int dot = key.lastIndexOf('.');
        if (dot < 0 || dot == key.length() - 1) {
            return null;
        }
        String extension = key.substring(dot + 1).toLowerCase(Locale.ROOT);
        if (!MEDIA_EXTENSIONS.contains(extension)) {
            return null;
        }
        if (IMAGE_EXTENSIONS.contains(extension)) {
            return "image";
        }
        if (VIDEO_EXTENSIONS.contains(extension)) {
            return "video";
        }
        return "audio";
    }

    private String joinScope(String... parts) {
        return Arrays.stream(parts)
                .filter(StrUtil::isNotBlank)
                .collect(Collectors.joining(" / "));
    }

    private String requireOwnedUrlPrefix() {
        String prefix = mediaStorageService.ownedUrlPrefix();
        if (StrUtil.isBlank(prefix)) {
            throw new BusinessException("无法确定本存储的公开访问前缀（请设置自定义域名 / CDN 域名）");
        }
        return prefix;
    }

    // ============================================================
    // 数据结构
    // ============================================================

    /** 查询条件。 */
    public record PageQuery(String scope, String mediaType, String keyword, int pageNo, int pageSize) {
    }

    /** 引用来源。 */
    public record Reference(
            String category,
            String table,
            String column,
            Long recordId,
            String label,
            boolean active,
            Long projectId) {
    }

    /** 列表条目。 */
    public record AssetItemVO(
            String key,
            String url,
            String mediaType,
            String extension,
            long size,
            Instant lastModified,
            String status,
            boolean deletable,
            Long projectId,
            String projectName,
            List<Reference> references) {
    }

    /** 查询结果：概览 + 当前页列表。 */
    public record QueryResult(Overview overview, List<AssetItemVO> list, long total) {
    }

    /** 概览。 */
    public record Overview(
            int totalObjects,
            long totalBytes,
            int activeCount,
            long activeBytes,
            int historyCount,
            long historyBytes,
            int orphanCount,
            long orphanBytes,
            List<TypeStat> byType) {
    }

    /** 按媒体类型的统计。 */
    public record TypeStat(String mediaType, int count, long bytes) {
    }

    /** 删除结果。 */
    public record DeleteResult(
            int deletedCount,
            long deletedBytes,
            int failedCount,
            List<String> failedKeys,
            List<String> blockedKeys,
            int removedRecords) {
    }
}
