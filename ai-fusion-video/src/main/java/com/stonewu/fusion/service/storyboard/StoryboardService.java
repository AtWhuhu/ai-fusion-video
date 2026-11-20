package com.stonewu.fusion.service.storyboard;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.bean.copier.CopyOptions;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.stonewu.fusion.common.BusinessException;
import com.stonewu.fusion.entity.script.Script;
import com.stonewu.fusion.entity.storyboard.Storyboard;
import com.stonewu.fusion.entity.storyboard.StoryboardEpisode;
import com.stonewu.fusion.entity.storyboard.StoryboardItem;
import com.stonewu.fusion.entity.storyboard.StoryboardScene;
import com.stonewu.fusion.mapper.script.ScriptMapper;
import com.stonewu.fusion.mapper.storyboard.StoryboardEpisodeMapper;
import com.stonewu.fusion.mapper.storyboard.StoryboardItemMapper;
import com.stonewu.fusion.mapper.storyboard.StoryboardMapper;
import com.stonewu.fusion.mapper.storyboard.StoryboardSceneMapper;
import com.stonewu.fusion.service.storyboard.dto.StoryboardStatistics;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;
import java.util.Map;
import org.springframework.util.StringUtils;
import org.springframework.transaction.annotation.Transactional;
import com.stonewu.fusion.service.storyboard.dto.StoryboardItemAssetsPatch;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;

/**
 * 供尚在迁移的合成服务与资源守卫使用的只读查询；业务修改统一进入资源命令。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class StoryboardService {
    private final StoryboardMapper storyboardMapper;
    private final StoryboardEpisodeMapper episodeMapper;
    private final StoryboardSceneMapper sceneMapper;
    private final StoryboardItemMapper itemMapper;
    private final ScriptMapper scriptMapper;

    @Cacheable(value = "storyboard", key = "#id", unless = "#result == null")
    public Storyboard getById(Long id) {
        Storyboard sb = storyboardMapper.selectById(id);
        if (sb == null) {
            throw new BusinessException("分镜脚本不存在: " + id);
        }
        return sb;
    }

    @Cacheable(value = "storyboard", key = "'project:' + #projectId", unless = "#result == null")
    public Storyboard getByProjectId(Long projectId) {
        Script script = scriptMapper.selectPage(new Page<>(1, 1, false), new LambdaQueryWrapper<Script>()
                .eq(Script::getProjectId, projectId)
                .orderByDesc(Script::getCreateTime)
                .orderByDesc(Script::getId)).getRecords().stream().findFirst().orElse(null);
        if (script == null) {
            return null;
        }
        return storyboardMapper.selectPage(new Page<>(1, 1, false), new LambdaQueryWrapper<Storyboard>()
                .eq(Storyboard::getProjectId, projectId)
                .eq(Storyboard::getScriptId, script.getId())
                .orderByDesc(Storyboard::getCreateTime)
                .orderByDesc(Storyboard::getId)).getRecords().stream().findFirst().orElse(null);
    }

    @Cacheable(value = "storyboardStatistics", key = "#storyboardId", unless = "#result == null")
    public StoryboardStatistics getStatistics(Long storyboardId) {
        long episodeCount = episodeMapper.selectCount(new LambdaQueryWrapper<StoryboardEpisode>()
                .eq(StoryboardEpisode::getStoryboardId, storyboardId));
        long sceneCount = sceneMapper.selectCount(new LambdaQueryWrapper<StoryboardScene>()
                .eq(StoryboardScene::getStoryboardId, storyboardId));
        long itemCount = itemMapper.selectCount(new LambdaQueryWrapper<StoryboardItem>()
                .eq(StoryboardItem::getStoryboardId, storyboardId));
        return new StoryboardStatistics(episodeCount, sceneCount, itemCount);
    }

    @Cacheable(value = "storyboardEpisode", key = "#id", unless = "#result == null")
    public StoryboardEpisode getEpisodeById(Long id) {
        StoryboardEpisode ep = episodeMapper.selectById(id);
        if (ep == null) {
            throw new BusinessException("分镜集不存在: " + id);
        }
        return ep;
    }

    @Cacheable(value = "storyboardEpisode", key = "'storyboard:' + #storyboardId", unless = "#result == null")
    public List<StoryboardEpisode> listEpisodes(Long storyboardId) {
        return episodeMapper.selectList(new LambdaQueryWrapper<StoryboardEpisode>()
                .eq(StoryboardEpisode::getStoryboardId, storyboardId)
                .orderByAsc(StoryboardEpisode::getSortOrder)
                .orderByAsc(StoryboardEpisode::getEpisodeNumber));
    }

    @Cacheable(value = "storyboardEpisode", key = "'binding:' + #storyboardId + ':' + #scriptEpisodeId", unless = "#result == null")
    public StoryboardEpisode getEpisodeByScriptEpisode(Long storyboardId, Long scriptEpisodeId) {
        if (storyboardId == null || scriptEpisodeId == null) {
            return null;
        }
        return episodeMapper.selectOne(new LambdaQueryWrapper<StoryboardEpisode>()
                .eq(StoryboardEpisode::getStoryboardId, storyboardId)
                .eq(StoryboardEpisode::getScriptEpisodeId, scriptEpisodeId));
    }

    @Cacheable(value = "storyboardScene", key = "#id", unless = "#result == null")
    public StoryboardScene getSceneById(Long id) {
        StoryboardScene scene = sceneMapper.selectById(id);
        if (scene == null) {
            throw new BusinessException("分镜场次不存在: " + id);
        }
        return scene;
    }

    @Cacheable(value = "storyboardScene", key = "'episode:' + #episodeId", unless = "#result == null")
    public List<StoryboardScene> listScenesByEpisode(Long episodeId) {
        return sceneMapper.selectList(new LambdaQueryWrapper<StoryboardScene>()
                .eq(StoryboardScene::getEpisodeId, episodeId)
                .orderByAsc(StoryboardScene::getSortOrder));
    }

    @Cacheable(value = "storyboardScene", key = "'storyboard:' + #storyboardId", unless = "#result == null")
    public List<StoryboardScene> listScenesByStoryboard(Long storyboardId) {
        return sceneMapper.selectList(new LambdaQueryWrapper<StoryboardScene>()
                .eq(StoryboardScene::getStoryboardId, storyboardId)
                .orderByAsc(StoryboardScene::getSortOrder));
    }

    @Cacheable(value = "storyboardItem", key = "#id", unless = "#result == null")
    public StoryboardItem getItemById(Long id) {
        StoryboardItem item = itemMapper.selectById(id);
        if (item == null) {
            throw new BusinessException("分镜条目不存在: " + id);
        }
        return item;
    }

    @Cacheable(value = "storyboardItem", key = "'storyboard:' + #storyboardId", unless = "#result == null")
    public List<StoryboardItem> listItems(Long storyboardId) {
        return itemMapper.selectList(new LambdaQueryWrapper<StoryboardItem>()
                .eq(StoryboardItem::getStoryboardId, storyboardId)
                .orderByAsc(StoryboardItem::getSortOrder));
    }

    @Cacheable(value = "storyboardItem", key = "'scene:' + #sceneId", unless = "#result == null")
    public List<StoryboardItem> listItemsByScene(Long sceneId) {
        return itemMapper.selectList(new LambdaQueryWrapper<StoryboardItem>()
                .eq(StoryboardItem::getStoryboardSceneId, sceneId)
                .orderByAsc(StoryboardItem::getSortOrder));
    }

    @CacheEvict(value = { "storyboardItem", "storyboardStatistics" }, allEntries = true)
    @Transactional
    public StoryboardItem createItem(StoryboardItem item) {
        itemMapper.insert(item);
        return item;
    }

    @CacheEvict(value = { "storyboardItem", "storyboardStatistics" }, allEntries = true)
    @Transactional
    public StoryboardItem updateItem(StoryboardItem item) {
        getItemById(item.getId());
        itemMapper.updateById(item);
        return itemMapper.selectById(item.getId());
    }

    /**
     * 更新分镜条目的机位锚点。
     *
     * <p>机位锚点存放在 custom_data.cameraAnchorId，是导演对「本镜用哪个机位」的显式指定；
     * 传 null 或空白表示清除该指定，回到按机位角度自动匹配。</p>
     *
     * @param itemId         分镜条目ID
     * @param cameraAnchorId 场景锚点表中的机位编号，如 C2；空值表示自动
     * @return 更新后的分镜条目
     */
    @CacheEvict(value = "storyboardItem", allEntries = true)
    @Transactional
    public StoryboardItem updateItemCameraAnchor(Long itemId, String cameraAnchorId) {
        StoryboardItem existing = getItemById(itemId);
        JSONObject customData = readCustomData(existing.getCustomData());
        String normalized = StringUtils.hasText(cameraAnchorId) ? cameraAnchorId.trim() : null;
        if (normalized == null) {
            customData.remove("cameraAnchorId");
        } else {
            customData.set("cameraAnchorId", normalized);
        }
        itemMapper.update(null, new UpdateWrapper<StoryboardItem>()
                .eq("id", itemId)
                // 共享资源快照按 version 缓存，旧路径写入也必须推进版本
                .setSql("version = version + 1")
                .set("custom_data", customData.isEmpty() ? null : customData.toString()));
        return itemMapper.selectById(itemId);
    }

    /**
     * 读取 custom_data JSON。为空或历史脏数据解析失败时返回空对象并告警，
     * 避免一条脏数据阻断后续写入。
     */
    private JSONObject readCustomData(String customDataJson) {
        if (!StringUtils.hasText(customDataJson)) {
            return new JSONObject();
        }
        try {
            return JSONUtil.parseObj(customDataJson);
        } catch (Exception e) {
            log.warn("分镜条目 custom_data 解析失败，按空对象处理: {}", customDataJson, e);
            return new JSONObject();
        }
    }

    /**
     * 更新分镜条目的 3D 布景快照。
     *
     * <p>快照是从空间锚点 3D 导演台按本镜视角导出的渲染图，存放在
     * {@code custom_data.blocking3dImageUrl}；生成视频时作为「场景 3D 布局参考图」
     * 传给多图参考模型。传 null 或空白表示清除。</p>
     *
     * @param itemId  分镜条目ID
     * @param imageUrl 快照图片 URL；空值表示清除
     * @return 更新后的分镜条目
     */
    @CacheEvict(value = "storyboardItem", allEntries = true)
    @Transactional
    public StoryboardItem updateItemBlockingSnapshot(Long itemId, String imageUrl) {
        StoryboardItem existing = getItemById(itemId);
        JSONObject customData = readCustomData(existing.getCustomData());
        String normalized = StringUtils.hasText(imageUrl) ? imageUrl.trim() : null;
        if (normalized == null) {
            customData.remove("blocking3dImageUrl");
        } else {
            customData.set("blocking3dImageUrl", normalized);
        }
        itemMapper.update(null, new UpdateWrapper<StoryboardItem>()
                .eq("id", itemId)
                // 共享资源快照按 version 缓存，旧路径写入也必须推进版本
                .setSql("version = version + 1")
                .set("custom_data", customData.isEmpty() ? null : customData.toString()));
        return itemMapper.selectById(itemId);
    }

    /**
     * 局部更新分镜条目的角色、场景和道具关联。
     *
     * <p>字段缺省时不修改；角色、道具空数组写入 JSON 空数组；场景显式 null 写入数据库 null。</p>
     */
    @CacheEvict(value = "storyboardItem", allEntries = true)
    @Transactional
    public StoryboardItem updateItemAssets(Long itemId, StoryboardItemAssetsPatch patch) {
        StoryboardItem existing = getItemById(itemId);
        if (!patch.hasUpdates()) {
            return existing;
        }
        if (patch.characterIdsPresent() && patch.characterIds() == null) {
            throw new BusinessException("角色关联清空时请传空数组，不能传 null");
        }
        if (patch.propIdsPresent() && patch.propIds() == null) {
            throw new BusinessException("道具关联清空时请传空数组，不能传 null");
        }

        UpdateWrapper<StoryboardItem> wrapper = new UpdateWrapper<StoryboardItem>()
                .eq("id", itemId)
                // 共享资源快照按 version 缓存，旧路径写入也必须推进版本
                .setSql("version = version + 1");
        if (patch.characterIdsPresent()) {
            wrapper.set("character_ids", JSONUtil.toJsonStr(patch.characterIds()));
        }
        if (patch.sceneAssetItemIdPresent()) {
            wrapper.set("scene_asset_item_id", patch.sceneAssetItemId());
        }
        if (patch.propIdsPresent()) {
            wrapper.set("prop_ids", JSONUtil.toJsonStr(patch.propIds()));
        }
        itemMapper.update(null, wrapper);
        return itemMapper.selectById(itemId);
    }

    /**
     * 更新分镜条目的首帧或尾帧字段。
     *
     * @param itemId    分镜条目ID
     * @param frameType 帧类型：first-首帧，last-尾帧
     * @param imageUrl  图片URL，允许为空，空值表示清空对应帧
     * @param prompt    AI生成提示词，允许为空，空值表示清空对应提示词
     * @return 更新后的分镜条目
     */
    @CacheEvict(value = "storyboardItem", allEntries = true)
    @Transactional
    public StoryboardItem updateItemFrame(Long itemId, String frameType, String imageUrl, String prompt) {
        getItemById(itemId);
        String normalizedFrameType = normalizeFrameType(frameType);
        String normalizedImageUrl = StringUtils.hasText(imageUrl) ? imageUrl.trim() : null;
        String normalizedPrompt = StringUtils.hasText(prompt) ? prompt.trim() : null;
        UpdateWrapper<StoryboardItem> wrapper = new UpdateWrapper<StoryboardItem>()
                .eq("id", itemId)
                // 共享资源快照按 version 缓存，旧路径写入也必须推进版本
                .setSql("version = version + 1");
        if ("first".equals(normalizedFrameType)) {
            wrapper.set("first_frame_image_url", normalizedImageUrl);
            // prompt 传空表示「本次不改动提示词」：手动换图、图生图改造精修都不该把原提示词清掉
            if (normalizedPrompt != null) {
                wrapper.set("first_frame_prompt", normalizedPrompt);
            }
        } else {
            wrapper.set("last_frame_image_url", normalizedImageUrl);
            if (normalizedPrompt != null) {
                wrapper.set("last_frame_prompt", normalizedPrompt);
            }
        }
        itemMapper.update(null, wrapper);
        return itemMapper.selectById(itemId);
    }

    /**
     * 规范化帧类型。
     *
     * @param frameType 原始帧类型
     * @return 规范化后的帧类型
     */
    public String normalizeFrameType(String frameType) {
        String normalizedFrameType = StringUtils.hasText(frameType) ? frameType.trim() : "";
        if ("first".equals(normalizedFrameType) || "last".equals(normalizedFrameType)) {
            return normalizedFrameType;
        }
        throw new BusinessException("帧类型仅支持 first 或 last");
    }

    @CacheEvict(value = { "storyboardItem", "storyboardStatistics" }, allEntries = true)
    @Transactional
    public void deleteItem(Long id) {
        itemMapper.deleteById(id);
    }

    @CacheEvict(value = { "storyboardItem", "storyboardStatistics" }, allEntries = true)
    @Transactional
    public void batchCreateItems(List<StoryboardItem> items) {
        for (StoryboardItem item : items) {
            itemMapper.insert(item);
        }
    }

    @CacheEvict(value = "storyboardItem", allEntries = true)
    @Transactional
    public void batchUpdateItemSort(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return;
        }
        for (int i = 0; i < ids.size(); i++) {
            StoryboardItem item = new StoryboardItem();
            item.setId(ids.get(i));
            item.setSortOrder(i);
            itemMapper.updateById(item);
        }
    }
}
