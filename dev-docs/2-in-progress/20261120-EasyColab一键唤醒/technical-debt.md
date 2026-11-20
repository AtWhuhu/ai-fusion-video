# 技术债务

- 实例状态只保存在 `home-dir/afv-easycolab-state.json`，单实例部署有效；多副本后端需要改为数据库或分布式锁。
- 预置工作流以草稿导入；模型权重需在 EasyColab 控制台安装对应预设包后，再在 AI 配置里验证、试运行并发布。afv 内暂未提供安装预设包入口。
- `colab_bridge.py` 依赖 `google-colab-cli` 0.7.5 的内部模块；0.7.6 起移除了 `TOKEN_CONFIG_PATH`，升级前需同步升级 EasyColab 版本。
- 每次唤醒 Cloudflare 隧道地址都会变化，渠道 `apiUrl` 由唤醒流程更新；手动修改该渠道地址会在下次唤醒时被覆盖。
