#!/usr/bin/env python3
"""扫描并修复 MySQL 中的 cp1252 二次编码乱码（UTF-8 -> cp1252 -> UTF-8）。

损坏特征：正确的 UTF-8 字节被当作 cp1252 解码后重新以 UTF-8 存储，
例如 "（" (EF BC 88) 变成 "ï¼ˆ" (C3AF C2BC CB86)。

修复：把字符串按 cp1252 编码回原始字节，再按 UTF-8 解码。

用法：
  python repair_mojibake.py --scan          # 只扫描，输出候选
  python repair_mojibake.py --apply         # 备份后原地修复
"""
import argparse
import os
import sys
import pymysql

def db_config():
    return dict(
        host=os.getenv("DB_HOST", "mysql"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", "123456"),
        database=os.getenv("DB_NAME", "ai_fusion_video"),
        charset="utf8mb4",
    )


DB = db_config()

TEXT_TYPES = {"char", "varchar", "text", "mediumtext", "tinytext", "longtext"}
# 二次编码的典型指示字符（这些字符单独出现在正常中文文本里几乎不可能）
MARKERS = set("ÃÂïåèéæäç¸ž›")


def has_cjk(text):
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def repair(text):
    """返回修复后的字符串；不可修复返回 None。"""
    if not text:
        return None
    try:
        raw = text.encode("cp1252")      # -> 原始 UTF-8 字节
    except UnicodeEncodeError:
        return None                       # 含 cp1252 无法映射的字符，放弃
    try:
        fixed = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None                       # 字节序列不是合法 UTF-8，放弃
    return fixed


def is_candidate(text):
    if not text or not isinstance(text, str):
        return False
    if not (MARKERS & set(text)):
        return False
    if has_cjk(text):                     # 已含中文，多半是正常文本
        return False
    fixed = repair(text)
    if fixed is None or fixed == text:
        return False
    return has_cjk(fixed)                 # 修复后是中文 -> 判定为乱码


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--scan", action="store_true")
    args = parser.parse_args()
    apply = args.apply

    conn = pymysql.connect(**DB)
    cur = conn.cursor()

    cur.execute("""
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = %s AND data_type IN %s
        ORDER BY table_name, ordinal_position
    """, (DB["database"], tuple(TEXT_TYPES)))
    cols = cur.fetchall()

    total_found = 0
    total_fixed = 0
    for table, column in cols:
        key = "id" if _has_id(cur, table) else None
        select = f"SELECT `id`, `{column}` FROM `{table}`" if key else \
                 f"SELECT NULL, `{column}` FROM `{table}`"
        cur.execute(select)
        rows = cur.fetchall()
        hits = []
        for idx, row in enumerate(rows):
            rid, value = row[0] if row[0] is not None else idx, row[1]
            if is_candidate(value):
                hits.append((rid, value, repair(value)))
        if not hits:
            continue
        total_found += len(hits)
        print(f"\n=== {table}.{column} : {len(hits)} 行 ===")
        for rid, before, after in hits[:5]:
            print(f"  key={rid}\n    修复前: {before[:70]}\n    修复后: {after[:70]}")
        if len(hits) > 5:
            print(f"  ... 其余 {len(hits) - 5} 行同类型")
        if apply and key:
            for rid, before, after in hits:
                cur.execute(
                    f"UPDATE `{table}` SET `{column}` = %s WHERE `id` = %s",
                    (after, rid))
            total_fixed += len(hits)
        elif apply and not key:
            print(f"  [跳过] {table} 无 id 主键，需手工处理")

    if apply:
        conn.commit()
        print(f"\n已修复 {total_fixed} 处，共发现 {total_found} 处")
    else:
        print(f"\n共发现 {total_found} 处乱码（未修改，加 --apply 执行修复）")
    cur.close()
    conn.close()


def _has_id(cur, table):
    cur.execute("""
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s AND column_name = 'id'
    """, (DB["database"], table))
    return cur.fetchone()[0] > 0


if __name__ == "__main__":
    sys.exit(main())
