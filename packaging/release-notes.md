Windows 11 x64 便携版，使用 Edge/Chrome。版本是否为预发布以 Release 标记为准；完整一期验收尚未完成。

下载 ZIP 并完整解压到固定目录，双击 start.cmd。包内包含 Node 24、JS/SQL/Python/NumPy 运行库，无需安装 Node、pnpm 或编译工具。在线功能需自行安装、登录 agy（已验证 1.2.11），并按设置页命令注册 MCP；这些操作不会自动执行。

数据保存于当前用户 `%USERPROFILE%\.herta-ai\adaptive-tutor-platform\`。升级前停止应用并冷备份数据目录。完整说明见包内 README-安装说明.md。下载后用附带 SHA-256 文件核对 ZIP；verification.json 记录自动化实际验收范围，不能替代未完成的人工验收。

当前包含课程学习闭环、导师对话、几何/力学示例与计算实验；全学科主题、八条讲练路径、完整外部资源迁移、科学人工复核和性能验收仍有缺口，见仓库 specs/phase-1/remaining.md。

本项目采用 MIT；第三方组件保留其原许可证，详见发行包的许可清单。未包含 agy 程序或账号。

维护者公开本草稿前请复核：干净 Windows 首次安装、手按 Ctrl+C/自动浏览器、真实 agy MCP 注册、更新备份与恢复，以及当前固定 Node/Next 版本的安全更新状态。
