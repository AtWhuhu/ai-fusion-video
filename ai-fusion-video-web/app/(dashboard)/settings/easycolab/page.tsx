"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  easyColabApi,
  type EasyColabAuthStatus,
  type EasyColabGpu,
  type EasyColabState,
} from "@/lib/api/easycolab";
import { toastApiError } from "@/lib/api/toast-api-error";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { containerVariants, itemVariants, settingsTypography } from "../_shared";
import { EasyColabAuthPanel } from "./_components/easycolab-auth-panel";
import { EasyColabLogPanel } from "./_components/easycolab-log-panel";
import { EasyColabRuntimePanel } from "./_components/easycolab-runtime-panel";
import { BUSY_PHASES } from "./_components/easycolab-support";

const POLL_INTERVAL_MS = 3000;

export default function EasyColabSettingsPage() {
  const [state, setState] = useState<EasyColabState | null>(null);
  const [auth, setAuth] = useState<EasyColabAuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const { confirm } = useConfirm();

  const loadState = useCallback(async () => {
    try {
      setState(await easyColabApi.state());
    } catch (e) {
      toastApiError(e, "读取 EasyColab 状态失败");
    }
  }, []);

  useEffect(() => {
    easyColabApi
      .state()
      .then(setState)
      .catch((e) => toastApiError(e, "读取 EasyColab 状态失败"));
    easyColabApi
      .authStatus()
      .then(setAuth)
      .catch((e) => toastApiError(e, "读取 Google 授权状态失败"))
      .finally(() => setAuthLoading(false));
  }, []);

  const busy = state ? BUSY_PHASES.includes(state.phase) : false;
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void loadState(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [busy, loadState]);

  const wake = async (gpu: EasyColabGpu, idleTimeoutMinutes: number) => {
    try {
      setState(await easyColabApi.wake({ gpu, idleTimeoutMinutes }));
    } catch (e) {
      toastApiError(e, "唤醒 Colab 失败");
    }
  };

  const release = async () => {
    const ok = await confirm({
      title: "释放 Colab 实例？",
      description: "会同步 Google Drive 后停止全部 Colab 实例，EasyColab ComfyUI 渠道随之停用。",
      confirmText: "释放",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      setState(await easyColabApi.release());
    } catch (e) {
      toastApiError(e, "释放 Colab 实例失败");
    }
  };

  return (
    <motion.div className="flex w-full flex-col gap-6" variants={containerVariants} initial={false} animate="visible">
      <motion.div variants={itemVariants}>
        <h1 className={settingsTypography.pageTitle}>EasyColab</h1>
        <p className={settingsTypography.pageDescription}>
          一键唤醒 Google Colab GPU，自动部署 ComfyUI 并接入为生图生视频渠道
        </p>
      </motion.div>
      <motion.div variants={itemVariants}>
        <EasyColabRuntimePanel
          state={state}
          authorized={auth?.logged_in === true}
          onWake={wake}
          onRelease={release}
        />
      </motion.div>
      <motion.div variants={itemVariants}>
        <EasyColabAuthPanel auth={auth} loading={authLoading} onChange={setAuth} />
      </motion.div>
      <motion.div variants={itemVariants}>
        <EasyColabLogPanel logs={state?.logs ?? []} />
      </motion.div>
    </motion.div>
  );
}
