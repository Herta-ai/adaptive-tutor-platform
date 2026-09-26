# M1 实现

contracts/v1 维护严格Zod契约；storage/database 使用node:sqlite、WAL、单写锁及事务outbox；domain 负责课程、判分、SI单位、补课。server/http 负责同源鉴权，server/jobs 负责全局单并发和取消。UI使用服务器快照及fetch SSE，界面状态不写学习成绩。

当前SQLite使用带索引的JSON实体记录，完整表级外键及迁移备份仍须落地。
