# 进度

- [x] 后端：子进程桥接、唤醒编排、ComfyUI 渠道自动维护、预置工作流导入、心跳、释放
- [x] Docker：内置 EasyColab 组件与 Python venv，新增 `easycolab_data` 卷
- [x] 前端：设置 → EasyColab 页面与侧边栏入口
- [x] 单元测试：`EasyColabServiceTests`（假 `colab_bridge.py` 走完整唤醒 / 释放流程）、`EasyColabPresetsTests`（6 个预置工作流 + 绑定通过 normalize）
- [x] 本地联调：真实 `colab_bridge.py` + `google-colab-cli==0.7.5` 的 `auth_status` / `auth_url` 经 afv 接口返回正常
- [ ] 真实 Colab：完成 Google 授权后实际唤醒、ComfyUI 隧道、生成、释放（需要 Google 账号授权，尚未验证）
