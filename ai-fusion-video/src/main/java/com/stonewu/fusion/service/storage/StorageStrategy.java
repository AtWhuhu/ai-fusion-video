package com.stonewu.fusion.service.storage;

import com.stonewu.fusion.entity.storage.StorageConfig;

import java.nio.file.Path;
import java.util.List;

/**
 * 存储策略接口
 * <p>
 * 不同存储后端（本地磁盘 / 阿里云 OSS / 腾讯 COS 等）实现此接口。
 */
public interface StorageStrategy {

    /**
     * 策略类型标识（对应 StorageConfig.type）
     */
    String getType();

    /**
     * 从远程 URL 下载文件并保存到当前存储后端
     *
     * @param remoteUrl 远程文件 URL
     * @param subDir    子目录（如 images、videos）
     * @param config    存储配置
     * @return 持久化后的可访问 URL
     */
    String store(String remoteUrl, String subDir, StorageConfig config);

    /**
     * 从字节数组保存文件（适用于 VertexAI 返回 base64 的场景）
     *
     * @param data      文件字节数据
     * @param subDir    子目录
     * @param extension 文件扩展名（如 png、mp4）
     * @param config    存储配置
     * @return 持久化后的可访问 URL
     */
    String storeBytes(byte[] data, String subDir, String extension, StorageConfig config);

    /**
     * 从本地文件保存到当前存储后端。
     *
     * @param filePath   本地文件路径
     * @param subDir     子目录
     * @param extension  文件扩展名
     * @param config     存储配置
     * @return 持久化后的可访问 URL
     */
    String storeFile(Path filePath, String subDir, String extension, StorageConfig config);

    /**
     * 列举存储后端中指定子目录前缀下的对象（用于媒体清理）。
     *
     * @param subDirPrefix 子目录前缀（如 {@code images}）；为空则列举配置根下全部对象
     * @param config       存储配置
     * @return 对象列表（对象键 + 大小）
     */
    List<StorageObject> listObjects(String subDirPrefix, StorageConfig config);

    /**
     * 删除存储后端中指定对象键的文件。
     *
     * @param objectKey 对象键（相对存储根的路径）
     * @param config    存储配置
     */
    void deleteObject(String objectKey, StorageConfig config);
}
