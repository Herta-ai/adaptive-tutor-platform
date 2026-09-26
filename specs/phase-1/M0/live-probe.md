# 已授权的真实接入验证

2026-09-26，Windows，agy **1.2.11**，Node **24.10.0**。

用户明确许可新增 MCP 配置及少量额度调用后，注册 `adaptive-tutor`，保留已有 `codegraph`。配置使用 Node 24 和本项目编译后的 `dist/mcp/stdio.js` 绝对路径；没有写入凭证或修改 CLI 权限。

实际验证：

1. CLI 调用 `get_curriculum`。
2. CLI 调用 `save_generation_draft` 保存严格结构的大纲。
3. 最终 `structured_output` 返回 `GenerationReceipt`。
4. 应用核对任务归属及 hash，发布一个节点并将测试课程归档。
5. 文本标记响应、显式 `--conversation` 续聊成功。

MCP 链路约 40.5 秒；文本加续聊约 25.3 秒。权限模式实际报告 **always-proceed**。不据此宣称操作系统隔离、所有异常或整个 M0 已通过。

机器可读证据：[live-probe.json](live-probe.json)。重跑脚本为 `scripts/probe-cli.ts`，会消耗额度；不自动执行。
