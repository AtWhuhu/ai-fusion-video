"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * 分镜编辑弹窗的字段控件。
 *
 * 统一「失焦即存」：输入过程中只改本地草稿，失焦时与传入值比对，有变化才回调，
 * 避免每敲一个字就打一次接口，也避免外部刷新把正在输入的内容顶掉。
 */

/** Select 不接受空字符串作为选中值，用哨兵表示「未设置」 */
const EMPTY_VALUE = "__empty__";
/** 词表兜不住时的自定义取值入口 */
const CUSTOM_VALUE = "__custom__";

/** 字段外壳：标签在上、控件在下，说明文字走 title，不堆解释 */
export function StoryboardField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5 min-w-0", className)}>
      <span
        className="text-[11px] font-medium text-muted-foreground"
        title={hint}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/** 单行文本 */
export function StoryboardTextField({
  value,
  placeholder,
  onChange,
  className,
}: {
  value: string | null | undefined;
  placeholder?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const committed = value ?? "";
  const [draft, setDraft] = useState(committed);

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  return (
    <Input
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== committed) onChange(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(committed);
      }}
      className={cn("h-9 rounded-xl text-sm", className)}
    />
  );
}

/** 多行文本 */
export function StoryboardTextAreaField({
  value,
  placeholder,
  onChange,
  rows = 3,
  className,
}: {
  value: string | null | undefined;
  placeholder?: string;
  onChange: (value: string) => void;
  rows?: number;
  className?: string;
}) {
  const committed = value ?? "";
  const [draft, setDraft] = useState(committed);

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  return (
    <Textarea
      value={draft}
      placeholder={placeholder}
      rows={rows}
      style={{ minHeight: `${rows * 1.65 + 1.5}rem` }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== committed) onChange(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setDraft(committed);
      }}
      className={cn("rounded-xl text-sm leading-relaxed", className)}
    />
  );
}

/** 数字（时长等） */
export function StoryboardNumberField({
  value,
  placeholder,
  onChange,
  className,
}: {
  value: number | null | undefined;
  placeholder?: string;
  onChange: (value: number | null) => void;
  className?: string;
}) {
  const committed = value == null ? "" : String(value);
  const [draft, setDraft] = useState(committed);

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  return (
    <Input
      value={draft}
      placeholder={placeholder}
      inputMode="decimal"
      onChange={(event) => setDraft(event.target.value.replace(/[^\d.]/g, ""))}
      onBlur={() => {
        if (draft === committed) return;
        const parsed = draft.trim() ? Number(draft) : null;
        onChange(parsed == null || Number.isNaN(parsed) ? null : parsed);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(committed);
      }}
      className={cn("h-9 rounded-xl text-sm", className)}
    />
  );
}

/**
 * 枚举下拉。
 *
 * 当前值不在词表里（历史数据或手填）时，把当前值连同「（当前值）」一起置顶展示，
 * 末尾再给一个「自定义…」入口 —— 词表之外的值照样能写，不用改代码。
 */
export function StoryboardEnumField({
  value,
  options,
  placeholder = "未设置",
  onChange,
  className,
}: {
  value: string | null | undefined;
  options: string[];
  placeholder?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const current = value ?? "";
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(current);

  useEffect(() => {
    setDraft(current);
  }, [current]);

  const items = useMemo(() => {
    const list = options.map((option) => ({ value: option, label: option }));
    if (current && !options.includes(current)) {
      list.unshift({ value: current, label: `${current}（当前值）` });
    }
    list.unshift({ value: EMPTY_VALUE, label: placeholder });
    return list;
  }, [options, current, placeholder]);

  if (custom) {
    return (
      <Input
        autoFocus
        value={draft}
        placeholder="填一个词表外的取值"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setCustom(false);
          if (draft !== current) onChange(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(current);
            setCustom(false);
          }
        }}
        className={cn("h-9 rounded-xl text-sm", className)}
      />
    );
  }

  return (
    <Select
      value={current || EMPTY_VALUE}
      items={[
        ...items,
        { value: CUSTOM_VALUE, label: "自定义…" },
      ]}
      onValueChange={(next) => {
        if (next == null) return;
        const picked = String(next);
        if (picked === CUSTOM_VALUE) {
          setDraft(current);
          setCustom(true);
          return;
        }
        onChange(picked === EMPTY_VALUE ? "" : picked);
      }}
    >
      <SelectTrigger className={cn("h-9 w-full rounded-xl text-sm", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="text-sm">
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectItem value={CUSTOM_VALUE}>自定义…</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
