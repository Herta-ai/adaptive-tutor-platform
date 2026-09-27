# Windows 便携发行：规格与验证追踪

状态：本地便携预览产物与自动验收通过；GitHub 工作流尚未在远端运行，人工安装验收待办。开发预览发行不等于一期 A01～A30 全部完成。

## 契约

- P01 / A01：Given Windows 11 x64 未装 Node/pnpm，When 解压 ZIP 并启动 start.cmd，Then 使用包内固定 Node 24 启动同源回环服务；就绪后打开引导链接，失败保留错误，不修改全局环境。
- P02 / A17/A29：数据仍在当前用户统一主目录；包内无课程、凭证、锁、开发缓存；退出与单写保护继续生效。用户在便携配置中指定 agy 路径，配置只影响本次进程。
- P03 / A18/A24：断网且无源码/开发 node_modules 的情况下，本地页面与 JS/Python/SQL、NumPy 运行库可用；所有必需文件与 SHA-256 清单随包分发。
- P04 / A30：设置页显示实际包内 Node 与 MCP 入口的 PowerShell 注册命令，正确转义空格/中文/单引号；只显示命令，不自动写用户 CLI 配置或调用模型。
- P05：附 MIT 项目许可证，保留 Node、生产依赖、被捆绑的 WASM/前端代码之许可和版本信息；拒绝包含 node-gyp 依赖。ZIP 解压后无文件链接指向包外。
- P06：固定工具版本与锁文件构建，生成 ZIP、SHA-256、版本清单；GitHub Actions 只在通过测试后生成开发预览草稿 Release，不将一期未完成项描述为已完成。

## 实现顺序

1. 许可、文件白名单与便携配置契约。
2. 依赖 staging、Node 校验下载、WASM/Next 产物复制、许可收集与 ZIP 清单。
3. 同进程启动器、自动浏览器和具体 MCP 命令。
4. 最终 ZIP 临时解压、隔离用户目录/路径与本机回环测试；不访问用户学习数据。
5. 自动化发布与用户文档，记录实际测试及待人工项目。

## 验证

2026-09-27 实际记录：

| 规格 | 实现与证据 | 状态 |
| --- | --- | --- |
| P01 | start.cmd → 包内 Node → launch.mjs → 生产服务；中文/空格路径、不同 cwd、PATH 无 Node/pnpm/agy 的最终 ZIP 启动 | 自动验收通过；双击/浏览器自动打开待人工 |
| P02 | 隔离 USERPROFILE/HOME 下检测到正确数据根；真实强杀恢复、合成 SIGINT 后 writer.lock 与 connection.json 消失 | 自动验收通过；真实键盘 Ctrl+C 待人工 |
| P03 | Edge 阻断非回环请求时 JS/SQL/Python/NumPy 实际计算成功；完整 ZIP hash 与所有文件 hash 校验 | 通过 |
| P04 | 实际解压目录下 MCP 命令包含正确的包内 Node/适配器路径；PowerShell 单引号转义单测 | 路径验证通过；真实注册待用户人工 |
| P05 | MIT、Node 原文许可、生产依赖库存、补充上游许可及 hash、NumPy wheel 许可、MPL 源码获取说明；无符号链接，未新增依赖 | 本地构建检查通过 |
| P06 | 冻结锁文件安装、固定 SHA 校验 Node、生成 ZIP/校验和/清单；Actions 配置生成 draft prerelease | 本地通过；远端 CI/Release 未执行 |

产物：`releases/adaptive-tutor-platform-v0.1.0-alpha.1-win-x64.zip`，234,412,447 bytes（约 224 MiB），解压文件约 780 MiB；含24,090个清单文件及 release-manifest.json。SHA-256：`1d79a73571c63ca792d5db466a6ebcfe707ec75cfe705857e847a0fc118953af`。工作区未提交，清单如实记录 sourceDirty=true；不能把此包冒充干净 tag 的远端产物。

完整机器可读结果见 [portable-release-verification.json](portable-release-verification.json)。全量 Vitest 13文件/124项、类型检查、生产构建通过；Edge 8项回归通过（39.9秒）。GitHub Actions 尚未实际运行，不能以本机测试替代远端 CI 证据。

首次候选 ZIP 在中文路径退出清理失败，没有当作合格产物保留在 releases 中。独立复现确认 Node 24.10.0 Windows 的 rmSync 对中文文件名/路径可能静默不删除；改用 unlinkSync 并新增回归后，重新打包与完整 ZIP 验收通过。原失败包及报告仅保留在被 Git 忽略的 .release-work/rejected-alpha.1 供诊断。

待人工：干净 Windows 11 无开发环境首次安装、实际双击/自动浏览器、手按 Ctrl+C、真实 agy 安装登录/MCP 注册、升级冷备份与恢复、移动目录重新注册；公开草稿前复核固定运行时的维护/安全状态。Windows 完整人工验收和真实用户 agy 注册不能以模拟结果替代。
