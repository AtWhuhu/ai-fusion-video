"use client";

import { useState } from "react";
import { ExternalLink, KeyRound, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { easyColabApi, type EasyColabAuthStatus } from "@/lib/api/easycolab";
import { toastApiError } from "@/lib/api/toast-api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { settingsTypography } from "../../_shared";

interface EasyColabAuthPanelProps {
  auth: EasyColabAuthStatus | null;
  loading: boolean;
  onChange: (auth: EasyColabAuthStatus) => void;
}

export function EasyColabAuthPanel({ auth, loading, onChange }: EasyColabAuthPanelProps) {
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const loggedIn = auth?.logged_in === true;

  const requestUrl = async () => {
    try {
      const res = await easyColabApi.authUrl();
      setAuthUrl(res.auth_url);
      window.open(res.auth_url, "_blank", "noopener");
    } catch (e) {
      toastApiError(e, "生成授权链接失败");
    }
  };

  const submitCode = async () => {
    setSubmitting(true);
    try {
      const res = await easyColabApi.authCode(code);
      if (!res.logged_in) {
        toast.error(res.error || "授权失败，请重新获取授权码");
        return;
      }
      toast.success(`已绑定 ${res.email || "Google 账号"}`);
      setAuthUrl(null);
      setCode("");
      onChange(res);
    } catch (e) {
      toastApiError(e, "提交授权码失败");
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    try {
      onChange(await easyColabApi.logout());
    } catch (e) {
      toastApiError(e, "解除授权失败");
    }
  };

  return (
    <section className="rounded-xl border border-border/30 bg-card/50 p-4 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className={settingsTypography.sectionTitle}>Google 账号</h3>
          <p className={settingsTypography.sectionDescription}>
            {loading
              ? "正在读取授权状态…"
              : loggedIn
                ? `${auth?.email || "已授权"} · 剩余 ${auth?.paid_balance ?? 0} 计算单元`
                : "一次性授权后，afv 才能代你申请 Colab GPU"}
          </p>
        </div>
        {loading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : loggedIn ? (
          <Button variant="destructive-ghost" size="sm" onClick={logout}>
            <LogOut />
            解除
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={requestUrl}>
            <KeyRound />
            授权
          </Button>
        )}
      </div>
      {!loggedIn && authUrl && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border/20 bg-background/70 p-3">
          <a
            href={authUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary underline-offset-4 hover:underline"
          >
            <ExternalLink className="size-3.5" />
            在新窗口完成 Google 授权，然后把页面显示的授权码粘贴到下方
          </a>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="easycolab-auth-code" className={settingsTypography.fieldLabel}>
              授权码
            </Label>
            <div className="flex gap-2">
              <Input
                id="easycolab-auth-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="4/0A…"
              />
              <Button size="sm" disabled={!code.trim() || submitting} onClick={submitCode}>
                {submitting && <Loader2 className="animate-spin" />}
                提交
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
