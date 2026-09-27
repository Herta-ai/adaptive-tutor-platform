# M1 实现

本地清空对话按用户最终确认实施：POST /sessions/{id}/clear 需要confirm=true并经现有Cookie/CSRF、幂等事务处理。Jobs先拒绝活动任务及尚未回收的本任务进程，再清理当前会话消息、任务、scope、上下文和事件，移除providerConversationId，发出session.cleared。界面收到事件后清除引用及输入并刷新快照；其他标签同步，后续问答不携带旧会话或历史。保留幂等回执以防旧请求重放。agy内部数据不操作。

导师五分钟与可见进度：runCli/NativeStream 新增只含类别、状态、步骤号的 onActivity 回调，过滤原始文本和参数并去重。Jobs 在事务内保存最多80条 activities、startedAt/finishedAt/timeoutMs，并发送限定课程及会话的 job.progress。浏览器通过现有 SSE 刷新服务器快照，ChatProgress 展示真实步骤列表及本地耗时计时；终态停止计时，静默期间只报告距最近步骤更新的时间。聊天的 CLI 参数与监督定时器均使用300000ms，不自动重跑。

课程删除入口复用既有 DELETE /api/v1/courses/{id}，提交 expectedRevision、confirm 和幂等请求标识。课程卡片改为容器内两个独立按钮，避免嵌套按钮及误触进入课程。使用浏览器确认框；确认后锁定重复操作，成功从列表移除，失败刷新列表并显示服务端原因。服务端已有事务删除课程关联记录及活动任务保护。

2026-09-26 对话修复决定：原问答提示会让 agy 1.2.11 进入工具步骤，简短问候也可能超时并得到空 SUCCESS；改为带当前上下文的直接文本教学问答，不提供 scopeId，不请求工具/规划，空最终文本拒绝。真实应用队列续聊还触发过 5 秒退出宽限；独立时序探针测得 SUCCESS 后约 3.7 秒才 exit(0)，说明正常清理也接近原门槛。将结果后退出宽限改为 15 秒，并保留任务总超时、成功结果及 exit(0) 三个必要条件；不将流式预览当作完成。该决定同步技术设计 §2 的监督规则。提示词不是 OS 安全隔离。

contracts/v1 维护严格Zod契约；storage/database 使用node:sqlite、WAL、单写锁及事务outbox；domain 负责课程、判分、SI单位、补课。server/http 负责同源鉴权，server/jobs 负责全局单并发和取消。UI使用服务器快照及fetch SSE，界面状态不写学习成绩。

当前SQLite使用带索引的JSON实体记录，完整表级外键及迁移备份仍须落地。

退出决定：使用 node:sqlite 独立 writer-lease.sqlite 的 EXCLUSIVE 事务作为操作系统级租约，禁止删除租约文件。writer.lock 仅作诊断及旧版本兼容标记，以原子替换写入，释放时检查 token。启动器在 Next 初始化前安装信号处理，禁用 Next 自有信号退出，停止 HTTP 连接后等待任务回收；10秒兜底及同步 exit 清理。
