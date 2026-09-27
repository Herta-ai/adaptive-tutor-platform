# 知序 · 自适应学习工作室

基于 docs 的一期开发中版本：Next.js 本地界面、Node 常驻服务、**node:sqlite**、Antigravity CLI 与课程 MCP。只有 Windows 11 / Edge 的已记录场景经过本机验证；**尚未满足完整一期验收**，见 [验收追踪](specs/phase-1/acceptance.md) 和 [剩余工作](specs/phase-1/remaining.md)。

Windows 用户可使用便携预览 ZIP：完整解压后双击 `start.cmd`，无需安装 Node/pnpm。构建命令、GitHub 草稿发布流程和验证范围见 [便携版发布](docs/便携版发布.md)；方案背景见 [发布方案调研](docs/发布方案.md)。

## 启动

使用 Node.js **24.10.0** 与 pnpm。无需 node-gyp、Python 构建工具或 Visual Studio C++ 工具链；SQLite 使用 Node 内置模块。Next/SWC 与 esbuild 使用已发布的预编译包，sharp 已排除。

```powershell
fnm use 24.10.0
pnpm install
pnpm runtimes:build
# 可选：准备经固定 hash 校验的 NumPy WASM wheel
pnpm runtimes:prepare
pnpm dev
```

生产运行：

```powershell
pnpm build
pnpm start
```

打开终端打印的引导链接。服务使用系统分配的端口，只监听 `127.0.0.1`。链接含一次性引导 token，5 分钟内有效，打开后从地址栏移除。不要分享此链接。应用停止后浏览器会话失效。

课程保存在 `~/.herta-ai/adaptive-tutor-platform/`，与启动目录无关。测试显式使用独立临时目录。一个用户数据根只允许一个写实例；普通退出用 Ctrl+C，清理最多等待10秒。新版本会自动恢复强制退出遗留的 writer.lock；请勿删除 runtime/writer-lease.sqlite。旧格式锁在 PID 已不存在时自动恢复，旧进程仍存活时需先停止该实例，不要直接删锁。

## 在线导师与 MCP

自行安装并登录 `agy`。本机验证的兼容版本为 **1.2.11**；应用不接管登录、不修改 CLI 权限、不切换其他 API。设置页的连通检查和生成会使用用户自己的额度。

编译完成后，由用户确认注册（本次开发已获用户授权并完成注册）：

```text
agy mcp add --type stdio adaptive-tutor "Node 24 可执行文件绝对路径" "应用目录/dist/mcp/stdio.js"
```

环境设置页会显示本机已填好路径的 PowerShell 命令。便携版可在 `portable-settings.json` 指定 `agyPath`，保存后重启；移动程序目录后需重新检查 MCP 注册。

MCP 适配器不直接写数据库，只连接同一应用的私有网关；没有有效任务 scope 不能读写课程。草稿只有在 CLI 成功退出、最终回执及版本检查通过后才可发布；大纲和正文重写另需用户确认。

CLI 继承当前 OS 用户权限。实际探针报告权限模式 `always-proceed`；`plan` / `sandbox` 不等于操作系统隔离。代码实验使用另一套 opaque-origin iframe + Worker + WASM 环境，与 CLI 权限不同。

## 验证命令

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:coverage
```

端到端测试使用本机 Edge，自动创建隔离测试数据库。`verify:coverage` 会更新覆盖报告；一期未达标时**故意返回非零**。真实 CLI 探针 `scripts/probe-cli.ts` 会消耗额度、建立归档测试课程，不属于自动测试或应用启动流程。

## 现有功能与限制

- 课程规划/草稿确认、按节点生成、独立作答证据、复习、补课领域规则、笔记、归档、导师流式会话、取消、断线恢复。
- 内置几何、力学两条三节点示例；全学科的计算模板原型、三维截面与理想甲烷结构；CPU 小网络训练。
- JS/SQL/Python 小程序实际在 WASM 中运行，可停止和限时；Pyodide 默认标准库，NumPy 需预备固定运行库。浏览器环境不承诺 OS 级硬内存上限。
- 当前 `.learn` 往返支持**无外部资源**的内容包和个人备份；存在资源引用时明确拒绝，尚未实现分子文件/GLB/图片/数据集完整资源迁移。
- 缺失的完整主题、八条学科讲练路径、人工科学复核和性能基准均保留在一期范围内，不以现有模板数量冒充完成。

## 许可证

本项目采用 [MIT License](LICENSE)。第三方组件保留各自许可证，便携包附带完整依赖版本清单、许可文件和源码获取说明。
