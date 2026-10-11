#!/usr/bin/env python3
"""扫描并修复 MySQL 中的 cp1252 二次编码乱码（UTF-8 -> cp1252 -> UTF-8）。

损坏特征：正确的 UTF-8 字节被当作 cp1252 解码后重新以 UTF-8 存储，
例如 "（" (EF BC 88) 变成 "ï¼ˆ" (C3AF C2BC CB86)。

修复：把字符串按 cp1252 编码回原始字节，再按 UTF-8 解码。

依赖：pip install pymysql

环境变量：
  DB_HOST / DB_PORT / DB_USER / DB_PASSWORD（必填） / DB_NAME

用法：
  python repair_mojibake.py --scan          # 只扫描，输出候选，不修改
  python repair_mojibake.py --apply         # 先写备份 SQL，再原地修复
  python repair_mojibake.py --apply --backup-dir ./backups

备份：--apply 会在执行 UPDATE 前，把所有待修复行的原始值写成
  mojibake_backup_<时间戳>.sql（含按 id 还原的 UPDATE 语句），
  出问题用该文件回滚。
"""
import argparse
import os
import sys
from datetime import datetime

try:
    import pymysql
except ImportError:
    print("缺少依赖：pip install pymysql", file=sys.stderr)
    sys.exit(2)


def db_config():
    password = os.getenv("DB_PASSWORD")
    if not password:
        print("错误：必须设置 DB_PASSWORD 环境变量（不设默认值，避免误连生产库）",
              file=sys.stderr)
        sys.exit(2)
    return dict(
        host=os.getenv("DB_HOST", "mysql"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=password,
        database=os.getenv("DB_NAME", "ai_fusion_video"),
        charset="utf8mb4",
    )


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


def _has_id(cur, db_name, table):
    cur.execute("""
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s AND column_name = 'id'
    """, (db_name, table))
    return cur.fetchone()[0] > 0


def _sql_escape(value):
    return value.replace("\\", "\\\\").replace("'", "\\'")


def write_backup(path, plan):
    """把待修复行的原始值写成可回滚的 UPDATE 语句。

    plan: [(table, column, id, original_value), ...]
    """
    with open(path, "w", encoding="utf-8") as f:
        f.write("-- mojibake 修复备份：用以下语句可还原原始值\n")
        f.write(f"-- 生成时间：{datetime.now().isoformat(timespec='seconds')}\n")
        for table, column, rid, before in plan:
            f.write(
                f"UPDATE `{table}` SET `{column}` = '{_sql_escape(before)}' "
                f"WHERE `id` = {rid};\n"
            )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="执行修复（先备份）")
    parser.add_argument("--scan", action="store_true", help="只扫描不修改")
    parser.add_argument("--backup-dir", default=".",
                        help="备份 SQL 存放目录（默认当前目录）")
    args = parser.parse_args()
    apply = args.apply
    if not apply and not args.scan:
        parser.print_help()
        return 1

    db = db_config()
    conn = pymysql.connect(**db)
    cur = conn.cursor()

    cur.execute("""
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = %s AND data_type IN %s
        ORDER BY table_name, ordinal_position
    """, (db["database"], tuple(TEXT_TYPES)))
    cols = cur.fetchall()

    # plan: [(table, column, id, before, after)]，只有有 id 主键的表才可修复
    plan = []
    total_found = 0
    for table, column in cols:
        has_id = _has_id(cur, db["database"], table)
        select = f"SELECT `id`, `{column}` FROM `{table}`" if has_id else \
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
        if has_id:
            plan.extend((table, column, rid, before, after)
                        for rid, before, after in hits)
        elif apply:
            print(f"  [跳过] {table} 无 id 主键，需手工处理")

    if apply:
        if not plan:
            print("\n没有可修复的行，不执行任何修改。")
        else:
            backup_path = os.path.join(
                args.backup_dir,
                f"mojibake_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sql")
            write_backup(backup_path,
                         [(t, c, rid, before) for t, c, rid, before, _ in plan])
            print(f"\n已写入备份：{backup_path}（{len(plan)} 行原始值）")
            for table, column, rid, _before, after in plan:
                cur.execute(
                    f"UPDATE `{table}` SET `{column}` = %s WHERE `id` = %s",
                    (after, rid))
            conn.commit()
            print(f"已修复 {len(plan)} 处，共发现 {total_found} 处")
    else:
        print(f"\n共发现 {total_found} 处乱码（未修改，加 --apply 执行修复）")
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
