import { http } from "./client";

export type EasyColabPhase =
  | "IDLE"
  | "WAKING"
  | "STARTING_COMFYUI"
  | "IMPORTING_WORKFLOWS"
  | "READY"
  | "RELEASING"
  | "FAILED";

export type EasyColabGpu = "T4" | "L4" | "G4" | "A100" | "H100";

export interface EasyColabState {
  phase: EasyColabPhase;
  gpu: EasyColabGpu | null;
  idleTimeoutMinutes: number | null;
  serviceUrl: string | null;
  comfyUiUrl: string | null;
  apiConfigId: number | null;
  importedWorkflowCount: number | null;
  message: string | null;
  error: string | null;
  updatedAt: string | null;
  logs: string[];
}

export interface EasyColabSession {
  name: string;
  endpoint: string;
  accelerator: string;
  variant: string;
  shape: string;
}

export interface EasyColabAuthStatus {
  ok: boolean;
  logged_in: boolean;
  email?: string;
  paid_balance?: number;
  burn_rate_hourly?: number;
  sessions?: EasyColabSession[];
  error?: string;
}

export interface EasyColabWakeReq {
  gpu: EasyColabGpu;
  idleTimeoutMinutes: number;
}

export const easyColabApi = {
  state: () => http.get<never, EasyColabState>("/api/ai/easycolab/state"),
  adminPassword: () => http.get<never, string>("/api/ai/easycolab/admin-password"),
  authStatus: () => http.get<never, EasyColabAuthStatus>("/api/ai/easycolab/auth/status"),
  authUrl: () => http.post<never, { ok: boolean; auth_url: string }>("/api/ai/easycolab/auth/url"),
  authCode: (code: string) =>
    http.post<never, EasyColabAuthStatus>("/api/ai/easycolab/auth/code", { code }),
  logout: () => http.post<never, EasyColabAuthStatus>("/api/ai/easycolab/auth/logout"),
  wake: (data: EasyColabWakeReq) => http.post<never, EasyColabState>("/api/ai/easycolab/wake", data),
  release: () => http.post<never, EasyColabState>("/api/ai/easycolab/release"),
};
