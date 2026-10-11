-- 将 Agent 消息表的推理过程字段由 TEXT 扩展为 MEDIUMTEXT。
-- V1.0.4.0.1 已将同表的 content 扩展为 MEDIUMTEXT，但遗漏了 reasoning_content；
-- 长对话的累计思维链内容可超过 TEXT 的 65535 字节上限，导致消息投影写入时
-- 抛出 Data truncation / DataIntegrityViolationException 并反复重试失败。

ALTER TABLE `afv_agent_message`
  MODIFY COLUMN `reasoning_content` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'AI推理过程内容（思维链）';
