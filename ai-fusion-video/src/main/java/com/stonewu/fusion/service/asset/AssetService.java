package com.stonewu.fusion.service.asset;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.stonewu.fusion.common.BusinessException;
import com.stonewu.fusion.common.handler.RawJsonSerializer;
import com.stonewu.fusion.entity.asset.Asset;
import com.stonewu.fusion.entity.asset.AssetItem;
import com.stonewu.fusion.mapper.asset.AssetItemMapper;
import com.stonewu.fusion.mapper.asset.AssetMapper;
import com.stonewu.fusion.security.SecurityUtils;
import com.stonewu.fusion.service.project.ProjectService;
import com.stonewu.fusion.service.team.TeamService;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 资产服务
 */
@Service
@RequiredArgsConstructor
public class AssetService {

    private static final int OWNER_TYPE_TEAM = 2;

    private final AssetMapper assetMapper;
    private final AssetItemMapper assetItemMapper;
    private final ProjectService projectService;
    private final TeamService teamService;

    // ========== 资产 ==========

    @Cacheable(value = "asset", key = "#id")
    public Asset getById(Long id) {
        Asset asset = assetMapper.selectById(id);
        if (asset == null)
            throw new BusinessException("资产不存在: " + id);
        return asset;
    }

    public List<Asset> listByProject(Long projectId) {
        return assetMapper.selectList(new LambdaQueryWrapper<Asset>()
                .eq(Asset::getProjectId, projectId)
                .orderByDesc(Asset::getCreateTime));
    }

    public List<Asset> listByProject(Long projectId, String type, String keyword) {
        LambdaQueryWrapper<Asset> wrapper = new LambdaQueryWrapper<Asset>()
                .eq(Asset::getProjectId, projectId)
                .orderByDesc(Asset::getCreateTime);
        if (type != null && !type.isEmpty()) {
            wrapper.eq(Asset::getType, type);
        }
        if (keyword != null && !keyword.isBlank()) {
            wrapper.like(Asset::getName, keyword.trim());
        }
        return assetMapper.selectList(wrapper);
    }

    public List<Map<String, Object>> listWithItemsByProject(Long projectId) {
        List<Asset> assets = listByProject(projectId);
        if (assets.isEmpty())
            return List.of();

        List<Long> assetIds = assets.stream().map(Asset::getId).collect(Collectors.toList());
        List<AssetItem> allItems = assetItemMapper.selectList(new LambdaQueryWrapper<AssetItem>()
                .in(AssetItem::getAssetId, assetIds)
                .orderByAsc(AssetItem::getSortOrder));

        Map<Long, List<AssetItem>> itemsMap = allItems.stream()
                .collect(Collectors.groupingBy(AssetItem::getAssetId));

        return assets.stream().map(asset -> {
            Map<String, Object> map = BeanUtil.beanToMap(asset, false, true);
            // properties/tags 在实体中是 JSON 文本(String)，此处手拼 Map 会让 Jackson 当作字符串输出，
            // 与前端「按对象读取」的约定不符，故显式解析为结构化节点。
            map.put("properties", RawJsonSerializer.parse(asset.getProperties()));
            map.put("tags", RawJsonSerializer.parse(asset.getTags()));
            map.put("items", itemsMap.getOrDefault(asset.getId(), List.of()));
            return map;
        }).collect(Collectors.toList());
    }

    /**
     * 按用户分页查询资产（跨项目），支持可选的 projectId / type / keyword 过滤
     */
    public IPage<Asset> pageByUser(Long userId, Long projectId, String type, String keyword, int page, int size) {
        LambdaQueryWrapper<Asset> wrapper = buildUserQueryWrapper(userId, projectId, type, keyword);
        return assetMapper.selectPage(new Page<>(page, size), wrapper);
    }

    public IPage<Asset> pageAccessibleByUser(Long userId, Long projectId, String type, String keyword, int page, int size) {
        LambdaQueryWrapper<Asset> wrapper = buildAccessibleQueryWrapper(userId, projectId, type, keyword);
        return assetMapper.selectPage(new Page<>(page, size), wrapper);
    }

    /**
     * 统计当前用户各类型资产数量（按 projectId / keyword 过滤，不按 type 过滤）
     * 返回 Map: type -> count
     */
    public Map<String, Long> countByUserGroupByType(Long userId, Long projectId, String keyword) {
        LambdaQueryWrapper<Asset> wrapper = buildUserQueryWrapper(userId, projectId, null, keyword);
        List<Asset> all = assetMapper.selectList(
                wrapper.select(Asset::getType));
        return all.stream().collect(
                Collectors.groupingBy(Asset::getType, Collectors.counting()));
    }

    public Map<String, Long> countAccessibleByUserGroupByType(Long userId, Long projectId, String keyword) {
        LambdaQueryWrapper<Asset> wrapper = buildAccessibleQueryWrapper(userId, projectId, null, keyword);
        List<Asset> all = assetMapper.selectList(
                wrapper.select(Asset::getType));
        return all.stream().collect(
                Collectors.groupingBy(Asset::getType, Collectors.counting()));
    }

    public boolean canAccessAsset(Long assetId, Long userId) {
        return canAccessAsset(getById(assetId), userId);
    }

    public boolean canAccessAsset(Asset asset, Long userId) {
        if (asset == null) {
            return false;
        }
        if (userId.equals(asset.getUserId()) || userId.equals(asset.getOwnerId())) {
            return true;
        }
        if (asset.getProjectId() != null) {
            return projectService.canAccessProject(asset.getProjectId(), userId);
        }
        Long currentTeamId = teamService.getCurrentTeamIdByUser(userId);
        if (currentTeamId == null) {
            return false;
        }
        if (OWNER_TYPE_TEAM == asset.getOwnerType() && currentTeamId.equals(asset.getOwnerId())) {
            return true;
        }
        return teamService.listMemberUserIds(currentTeamId).contains(asset.getUserId());
    }

    private LambdaQueryWrapper<Asset> buildUserQueryWrapper(Long userId, Long projectId, String type, String keyword) {
        LambdaQueryWrapper<Asset> wrapper = new LambdaQueryWrapper<Asset>()
                .eq(Asset::getUserId, userId)
                .orderByDesc(Asset::getUpdateTime);
        if (projectId != null) {
            wrapper.eq(Asset::getProjectId, projectId);
        }
        if (StrUtil.isNotBlank(type)) {
            wrapper.eq(Asset::getType, type);
        }
        if (StrUtil.isNotBlank(keyword)) {
            wrapper.like(Asset::getName, keyword.trim());
        }
        return wrapper;
    }

    private LambdaQueryWrapper<Asset> buildAccessibleQueryWrapper(Long userId, Long projectId, String type, String keyword) {
        Long currentTeamId = teamService.getCurrentTeamIdByUser(userId);
        if (currentTeamId == null) {
            return buildUserQueryWrapper(userId, projectId, type, keyword);
        }
        List<Long> memberUserIds = teamService.listMemberUserIds(currentTeamId);
        LambdaQueryWrapper<Asset> wrapper = new LambdaQueryWrapper<Asset>()
                .and(scope -> scope
                        .and(teamOwned -> teamOwned
                                .eq(Asset::getOwnerType, OWNER_TYPE_TEAM)
                    .eq(Asset::getOwnerId, currentTeamId))
                        .or(memberOwned -> memberOwned
                                .in(Asset::getUserId, memberUserIds)))
                .orderByDesc(Asset::getUpdateTime);
        if (projectId != null) {
            wrapper.eq(Asset::getProjectId, projectId);
        }
        if (StrUtil.isNotBlank(type)) {
            wrapper.eq(Asset::getType, type);
        }
        if (StrUtil.isNotBlank(keyword)) {
            wrapper.like(Asset::getName, keyword.trim());
        }
        return wrapper;
    }

    public List<Asset> listByOwner(Integer ownerType, Long ownerId, String type) {
        LambdaQueryWrapper<Asset> wrapper = new LambdaQueryWrapper<Asset>()
                .eq(Asset::getOwnerType, ownerType)
                .eq(Asset::getOwnerId, ownerId)
                .orderByDesc(Asset::getCreateTime);
        if (type != null && !type.isEmpty()) {
            wrapper.eq(Asset::getType, type);
        }
        return assetMapper.selectList(wrapper);
    }

    public List<Asset> listAccessibleByUser(Long userId, String type) {
        return assetMapper.selectList(buildAccessibleQueryWrapper(userId, null, type, null));
    }

    public Asset findByProjectTypeAndName(Long projectId, String type, String name) {
        return assetMapper.selectOne(new LambdaQueryWrapper<Asset>()
                .eq(Asset::getProjectId, projectId)
                .eq(Asset::getType, type)
                .eq(Asset::getName, name)
                .last("LIMIT 1"));
    }

    @CacheEvict(value = { "asset", "assetItem" }, allEntries = true)
    @Transactional
    public Asset create(Asset asset) {
        validateAssetMediaUrls(asset);
        applyCurrentTeamOwnership(asset);
        assetMapper.insert(asset);

        // 自动创建初始子资产，名称使用主资产名称
        AssetItem initialItem = AssetItem.builder()
                .assetId(asset.getId())
                .itemType("initial")
                .name(asset.getName())
                .sortOrder(0)
                .sourceType(asset.getSourceType() != null ? asset.getSourceType() : 1)
                .build();
        assetItemMapper.insert(initialItem);

        return asset;
    }

    @CacheEvict(value = "asset", allEntries = true)
    @Transactional
    public Asset update(Asset asset) {
        Asset existing = assetMapper.selectById(asset.getId());
        if (existing == null) {
            throw new BusinessException("资产不存在: " + asset.getId());
        }
        // 局部更新：以库内行为基准，只覆盖请求里显式给出的字段（null = 不改动）。
        //
        // 不能直接 assetMapper.updateById(入参实体)：入参由 MapStruct 经 Lombok builder 生成，
        // 而 sourceType/status 带 @Builder.Default，请求里没传也会被回填成 1 —— 于是一次普通的
        // 「改个名字/描述」会把 source_type（AI 生成 → 用户上传）和 status 一起悄悄改掉。
        // 逐字段合并可彻底摆脱这类「默认值反噬」，也让接口真正具备局部更新语义。
        if (asset.getType() != null) {
            existing.setType(asset.getType());
        }
        if (asset.getName() != null) {
            existing.setName(asset.getName());
        }
        if (asset.getDescription() != null) {
            existing.setDescription(asset.getDescription());
        }
        if (asset.getCoverUrl() != null) {
            existing.setCoverUrl(asset.getCoverUrl());
        }
        if (asset.getProperties() != null) {
            existing.setProperties(asset.getProperties());
        }
        if (asset.getTags() != null) {
            existing.setTags(asset.getTags());
        }
        if (asset.getAiPrompt() != null) {
            existing.setAiPrompt(asset.getAiPrompt());
        }
        validateAssetMediaUrls(existing);
        assetMapper.updateById(existing);
        return existing;
    }

    @CacheEvict(value = "asset", allEntries = true)
    @Transactional
    public void delete(Long id) {
        assetMapper.deleteById(id);
    }

    // ========== 子资产 ==========

    public AssetItem getItemById(Long id) {
        AssetItem item = assetItemMapper.selectById(id);
        if (item == null)
            throw new BusinessException("子资产不存在: " + id);
        return item;
    }

    @Cacheable(value = "assetItem", key = "'asset:' + #assetId")
    public List<AssetItem> listItems(Long assetId) {
        return assetItemMapper.selectList(new LambdaQueryWrapper<AssetItem>()
                .eq(AssetItem::getAssetId, assetId)
                .orderByAsc(AssetItem::getSortOrder));
    }

    @CacheEvict(value = { "assetItem", "asset" }, allEntries = true)
    @Transactional
    public AssetItem createItem(AssetItem item) {
        validateAssetItemMediaUrls(item);
        assetItemMapper.insert(item);
        syncCoverIfAbsent(item);
        return item;
    }

    @CacheEvict(value = { "assetItem", "asset" }, allEntries = true)
    @Transactional
    public AssetItem updateItem(AssetItem item) {
        AssetItem existing = assetItemMapper.selectById(item.getId());
        if (existing == null)
            throw new BusinessException("子资产不存在: " + item.getId());
        // 局部更新：只覆盖请求里显式给出的字段（null = 不改动），理由同 update()。
        // 尤其是 sortOrder —— 入参没带时 Lombok builder 会回填 @Builder.Default 的 0，
        // 直接把子资产的排序重置到最前，列表顺序错乱。
        if (item.getItemType() != null) {
            existing.setItemType(item.getItemType());
        }
        if (item.getName() != null) {
            existing.setName(item.getName());
        }
        if (item.getImageUrl() != null) {
            existing.setImageUrl(item.getImageUrl());
        }
        if (item.getThumbnailUrl() != null) {
            existing.setThumbnailUrl(item.getThumbnailUrl());
        }
        if (item.getProperties() != null) {
            existing.setProperties(item.getProperties());
        }
        if (item.getSortOrder() != null) {
            existing.setSortOrder(item.getSortOrder());
        }
        if (item.getSourceType() != null) {
            existing.setSourceType(item.getSourceType());
        }
        if (item.getAiPrompt() != null) {
            existing.setAiPrompt(item.getAiPrompt());
        }
        validateAssetItemMediaUrls(existing);
        assetItemMapper.updateById(existing);
        syncCoverIfAbsent(existing);
        return existing;
    }

    @CacheEvict(value = "assetItem", allEntries = true)
    @Transactional
    public void deleteItem(Long id) {
        assetItemMapper.deleteById(id);
    }

    private void validateAssetMediaUrls(Asset asset) {
        if (asset == null) {
            return;
        }
        rejectDataUrl(asset.getCoverUrl(), "coverUrl");
    }

    private void validateAssetItemMediaUrls(AssetItem item) {
        if (item == null) {
            return;
        }
        rejectDataUrl(item.getImageUrl(), "imageUrl");
        rejectDataUrl(item.getThumbnailUrl(), "thumbnailUrl");
    }

    private void rejectDataUrl(String rawUrl, String fieldName) {
        if (StrUtil.isNotBlank(rawUrl) && StrUtil.startWithIgnoreCase(rawUrl.trim(), "data:")) {
            throw new BusinessException(fieldName + " 不支持 base64，请先调用 /api/storage/upload 上传二进制文件");
        }
    }

    private void applyCurrentTeamOwnership(Asset asset) {
        Long creatorUserId = asset.getUserId() != null ? asset.getUserId() : SecurityUtils.getCurrentUserId();
        if (creatorUserId == null) {
            return;
        }
        asset.setUserId(creatorUserId);
        TeamService.OwnerScope ownerScope = teamService.getRequiredCurrentOwnerScopeByUser(creatorUserId);
        asset.setOwnerType(ownerScope.getOwnerType());
        asset.setOwnerId(ownerScope.getOwnerId());
    }

    /**
     * 同步主资产封面：
     * - initial 类型子资产：新增或更新图片时，始终同步为主资产封面
     * - 其他类型子资产：仅在主资产无封面时自动填充
     */
    private void syncCoverIfAbsent(AssetItem item) {
        if (StrUtil.isBlank(item.getImageUrl()) || item.getAssetId() == null) {
            return;
        }
        Asset asset = assetMapper.selectById(item.getAssetId());
        if (asset == null) {
            return;
        }
        if ("initial".equals(item.getItemType())) {
            asset.setCoverUrl(item.getImageUrl());
            assetMapper.updateById(asset);
        } else if (StrUtil.isBlank(asset.getCoverUrl())) {
            asset.setCoverUrl(item.getImageUrl());
            assetMapper.updateById(asset);
        }
    }
}
