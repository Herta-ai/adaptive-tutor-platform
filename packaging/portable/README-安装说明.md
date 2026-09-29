# 知序 · Windows 便携版

适用于 Windows 11 x64、Edge/Chrome。版本是否为预发布以 Release 标记及 release-manifest.json 的 preview 字段为准；完整一期全学科覆盖仍在开发。

## 启动

完整解压到当前用户可写的固定目录，双击 `start.cmd`，浏览器会自动打开。不要在 ZIP 预览窗口中直接运行。无需安装 Node、pnpm、Git、Python 或 C++ 构建工具；不需要管理员权限。

保留终端，退出用 Ctrl+C，退出清理最多等待10秒。若浏览器没有自动打开，复制终端中的完整链接到 Edge/Chrome；不要分享含一次性 token 的链接。链接5分钟内一次有效，重启后请使用新链接。重复启动时会提示已有实例，请使用原窗口或先停止旧实例。

未安装 agy 也能使用离线示例和代码实验，包括 Python/NumPy。在线规划、课程生成和导师问答需要用户自行安装并登录 Antigravity CLI；已验证版本为 **1.2.11**，不承诺其他版本兼容。

## 配置 agy 和课程 MCP

通常通过 PATH 自动查找 agy。若设置页显示未安装，编辑同目录 `portable-settings.json`，填写 agy.exe 的完整路径，例如：

```json
{
  "agyPath": "C:/Users/你的用户名/工具/agy.exe",
  "openBrowser": true
}
```

JSON 路径推荐使用 `/`；使用反斜杠时须写成 `\\`。保存并重启。本配置仅影响此应用进程，不修改系统 PATH。设置 `openBrowser: false` 可关闭自动打开浏览器。

进入设置页，复制显示的完整注册命令到 PowerShell 执行。命令使用本包内 Node 和 MCP 适配器；已有同名 adaptive-tutor 配置时先检查，不要直接覆盖。移动程序目录或修改 agy 路径后重新检查注册。应用不会自动注册 MCP、登录或发起收费探针；主动运行连通性检查会使用你的额度。

CLI 继承当前用户及其配置的权限；plan/sandbox 参数不代表操作系统级隔离。不要把个人 agy 登录目录或凭证复制进本程序目录。

## 数据、更新和卸载

课程保存在 `%USERPROFILE%\.herta-ai\adaptive-tutor-platform\`，不在程序目录。“便携”不表示课程自动跟随 U 盘移动。不要删除 `writer-lease.sqlite`；新版会恢复强制退出遗留的锁标记。

更新前停止应用，完整复制上述数据目录作为冷备份（必须确认旧实例已退出），保留自己的 portable-settings.json；将新版完整解压，使用相同固定安装路径，避免混合覆盖旧依赖。数据库升级后，不能仅换回旧程序来保证回滚，应恢复对应备份。程序安装目录变动时需重新注册 MCP。

删除程序目录默认不会删除课程。是否删除数据或移除 MCP 配置由你单独决定。当前 `.learn` 不能迁移所有外部资源，不应替代整个数据目录的升级备份。

## 校验和许可

下载页提供 ZIP 的 SHA-256 文件，可在 PowerShell 使用 `Get-FileHash <ZIP路径> -Algorithm SHA256` 核对。`release-manifest.json` 记录各文件校验和、源码提交、构建环境与预览版本。

本项目采用 MIT，见 LICENSE；第三方组件不因此改为 MIT，见 THIRD-PARTY-NOTICES.md 和 THIRD-PARTY-NOTICES/。包内未包含 agy 程序或用户账号。

错误反馈请提供预览版本、Windows 版本、错误文字和重现步骤；不要公开引导 token、connection.json、个人课程数据库或登录信息。
