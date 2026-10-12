package com.stonewu.fusion.entity.asset;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.stonewu.fusion.common.handler.JsonbTypeHandler;
import com.stonewu.fusion.common.BaseEntity;
import lombok.*;

/**
 * 子资产实体（资产的图片/变体）
 * <p>
 * 对应数据库表：afv_asset_item
 * 管理主资产下的子项，如角色的不同角度立绘、服装变体、受伤状态等。
 * 每个子资产可关联一张图片。
 */
@TableName(value = "afv_asset_item", autoResultMap = true)
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AssetItem extends BaseEntity {

    /** 主键ID，自增 */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属主资产ID */
    private Long assetId;

    /** 子资产类型：front-正面 / side-侧面 / back-背面 / detail-细节 / expression-表情 / pose-姿势 / variant-变体 / original-原始 */
    private String itemType;

    /** 子资产名称 */
    private String name;

    /** 图片URL */
    private String imageUrl;

    /** 缩略图URL */
    private String thumbnailUrl;

    /** 动态属性 JSON，存储子资产特有属性 */
    @TableField(typeHandler = JsonbTypeHandler.class)
    private String properties;

    /** 排列顺序（默认值由数据库列默认承担，理由见 AFV 资产实体注释） */
    private Integer sortOrder;

    /** 来源类型：1-用户上传 2-AI生成 */
    private Integer sourceType;

    /** AI生成时使用的提示词 */
    private String aiPrompt;
}
