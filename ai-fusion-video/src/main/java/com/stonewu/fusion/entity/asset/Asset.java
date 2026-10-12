package com.stonewu.fusion.entity.asset;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.stonewu.fusion.common.handler.JsonbTypeHandler;
import com.stonewu.fusion.common.BaseEntity;
import lombok.*;

/**
 * 资产实体（角色、场景、道具等）
 * <p>
 * 对应数据库表：afv_asset
 * 管理项目中的各类创作素材，如角色设定、场景配置、道具信息等。
 */
@TableName(value = "afv_asset", autoResultMap = true)
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Asset extends BaseEntity {

    /** 主键ID，自增 */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 创建者用户ID */
    private Long userId;

    /** 所属项目ID */
    private Long projectId;

    /** 资产类型：character-角色 / scene-场景 / prop-道具 / vehicle-载具 / building-建筑 / costume-服装 / effect-特效 / material-材质 / image-图片 */
    private String type;

    /** 资产名称 */
    private String name;

    /** 资产描述 */
    private String description;

    /** 封面图URL */
    private String coverUrl;

    /** 动态属性 JSON，存储资产特有的键值对信息，如角色的 appearance、age 等 */
    @TableField(typeHandler = JsonbTypeHandler.class)
    private String properties;

    /** 标签列表 JSON */
    @TableField(typeHandler = JsonbTypeHandler.class)
    private String tags;

    /**
     * 来源类型：1-用户上传 2-AI生成
     * <p>
     * 故意<b>不</b>用 {@code @Builder.Default} 给默认值：实体同时承担「局部更新入参」的角色，
     * 字段初始化器会让 MapStruct（走 Lombok builder）转换出的更新对象带上非空默认值，
     * 于是「只改名称」也会把 source_type 一起写掉。默认值交由数据库列默认承担（NOT NULL DEFAULT 1）。
     */
    private Integer sourceType;

    /** AI生成时使用的提示词 */
    private String aiPrompt;

    /** 拥有者类型：1-个人 2-团队 */
    private Integer ownerType;

    /** 拥有者ID，关联用户或团队 */
    private Long ownerId;

    /** 状态：0-草稿 1-正常（默认值由数据库列默认承担，理由同 sourceType） */
    private Integer status;
}
