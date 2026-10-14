package com.stonewu.fusion.service.storage;

import java.time.Instant;

/**
 * 存储后端中的一个对象（文件）。
 *
 * @param key          对象键（即相对存储根的路径，如 {@code images/xxxx.jpg}）
 * @param size         字节大小
 * @param lastModified 最后修改时间；存储后端不提供时为 {@code null}
 */
public record StorageObject(String key, long size, Instant lastModified) {
}
