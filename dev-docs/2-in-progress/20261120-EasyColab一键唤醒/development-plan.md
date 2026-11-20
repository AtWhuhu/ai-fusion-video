# EasyColab 一键唤醒 Colab 并接入 ComfyUI 渠道

## 目标

在 afv 内直接启动 Google Colab GPU，部署 [EasyColab](https://github.com/wy51ai/easycolab) 服务端与 ComfyUI，并自动接入为生图 / 生视频渠道，用完可释放实例。

## 方案

- 后端镜像内置固定版本（`fcad66f`）的 `colab_bridge.py`、`app.py`、`runtime_auth.py`，以及独立 Python venv（`google-colab-cli==0.7.5`）。
- `EasyColabBridge` 以子进程调用 `colab_bridge.py`，`HOME` 指向持久化目录 `fusion.easycolab.home-dir`（Docker 为 `/app/data/easycolab`，挂载 `easycolab_data` 卷），Google OAuth 令牌与 Colab 会话状态保存在其中。
- `EasyColabService` 编排：`wake` → 解析 `WAKE_URL` 得到 EasyColab 服务端地址 → `POST /minimax_api/comfyui/start` → 轮询 `/minimax_api/comfyui/status` 取得 `public_url`（trycloudflare 隧道）→ 创建或更新「EasyColab ComfyUI」API 配置（用户名 `easycolab`，随机 32 位管理密码写入 `apiKey`，沿用 Basic Auth）→ 导入 6 个预置视频工作流草稿 → `READY`。
- 运行中每 5 分钟调用 `keepalive`；释放调用 `stop_all` 并停用该 API 配置。
- 前端新增 `设置 → EasyColab` 页面：Google 一次性授权（授权链接 + 粘贴授权码）、GPU 与闲置释放选择、一键唤醒、部署进度与日志、释放。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/ai/easycolab/state` | 实例与渠道状态 |
| GET | `/api/ai/easycolab/auth/status` | Google 授权状态 |
| POST | `/api/ai/easycolab/auth/url` | 生成授权链接 |
| POST | `/api/ai/easycolab/auth/code` | 提交授权码 |
| POST | `/api/ai/easycolab/auth/logout` | 解除授权 |
| POST | `/api/ai/easycolab/wake` | 唤醒并部署 |
| POST | `/api/ai/easycolab/release` | 释放实例 |
