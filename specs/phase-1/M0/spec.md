# M0 接入规格（A01/A02/A13/A30）

- Given agy 1.2.11 可运行，When 最终 result.SUCCESS 且进程退出0，Then 才能进入发布校验；DONE步骤不能作为任务终态。
- Given UTF-8和JSON跨chunk，When 流解析，Then 中文不损坏、工具文本不进入聊天；未知事件忽略，畸形已知事件拒绝。
- Given MCP有效私有凭证及scope，When 保存草稿，Then 按run/operationId幂等；越界、终态scope或版本过期均拒绝。
- Given 缺少最终回执、hash不匹配或取消，When 任务结束，Then 不发布半成品。
- Given 指定应用会话续聊，When 供应商会话失效，Then 使用已完成本地消息恢复，不能全局continue。

尚未实测的权限、认证、额度及网络异常必须保持待验证。
