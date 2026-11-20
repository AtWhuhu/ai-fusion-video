"use client";

import { settingsTypography } from "../../_shared";

export function EasyColabLogPanel({ logs }: { logs: string[] }) {
  if (logs.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className={`${settingsTypography.sectionTitle} px-1`}>部署日志</h3>
      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/30 bg-card/50 p-4 font-mono text-xs leading-relaxed text-muted-foreground backdrop-blur-sm">
        {logs.join("\n")}
      </pre>
    </section>
  );
}
