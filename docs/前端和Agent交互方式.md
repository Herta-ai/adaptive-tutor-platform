# 前端与 Antigravity CLI 交互：一期技术设计

版本：0.4 · 更新日期：2026-09-26 · 状态：一期全学科演示与 MCP 设计基线；CLI 最小接入已实测，应用与 MCP 服务尚未实现

产品范围与教学判定以 [PRD](PRD.md) 为准。本文是实现契约，示例中的应用类型、HTTP 路由和事件不是 CLI 原生协议。实现时应把这些定义落到共享 Schema、数据库迁移和测试夹具中。

## 1. 架构决定

采用 **Next.js 本地界面 + 常驻 Node.js 应用服务 + 按任务启动 `agy` 非交互子进程 + HTTP 命令/SSE 事件 + 课程读写 MCP 适配器 + SQLite**。课程数据统一保存在 `~/.herta-ai/adaptive-tutor-platform/`。全学科演示在这个架构上增加**声明式组件注册表、可信数值内核和浏览器隔离计算环境**；不把科学演示计算转交给 CLI，也不为新增学科接入其他 Agent。

```text
本机浏览器
  ├─ POST/GET /api/v1/...：命令、查询、取消
  ├─ GET /api/v1/events：SSE 增量及状态变更
  ├─ 演示组件：公式 / 2D / 3D / 图表 / 分子 / 过程与算法
  └─ 演示计算：可信 Worker、ML/DL 小模型、隔离代码实验
             │ 同源，127.0.0.1
本地 Node.js 服务（同一监听端口）
  ├─ Next.js 请求处理器：页面与静态资源
  ├─ 会话鉴权、输入校验、幂等、任务队列
  ├─ 教学规则 / 课程服务 / 内容校验 / 导入导出
  ├─ 内部课程网关：接收本地 MCP 适配器的受控调用
  ├─ SQLite：内容版本、学习状态、消息、任务、事件
  └─ AntigravityAdapter
       └─ spawn agy：参数数组 + stdout NDJSON + 独立 stderr
                      │
                用户自己的 CLI 登录与模型服务
                      │ MCP tools（STDIO）
                本应用 MCP 薄适配器
                      └─ 经鉴权的回环请求 → 同一个课程服务与 SQLite
```

### 1.1 为什么这样选择

| 选择 | 原因 |
| --- | --- |
| 非交互 CLI 管道 | 本机 `agy 1.2.11` 已确认支持结构化流和指定会话续聊，不需要解析终端画面 |
| 每任务一个进程 | 完成、取消、崩溃和隔离边界清楚；启动耗时先测量，再决定是否优化 |
| 常驻应用服务 | 保留队列、数据库、浏览器连接和任务监督；并不要求 CLI 常驻 |
| HTTP + SSE | 提交、取消用 HTTP，服务端事件单向流出，足以覆盖一期；SSE 是 HTTP 流，不是 WebSocket |
| SQLite 单一状态源 | CLI 内存与聊天摘要都不能替代课程和作答记录 |
| 一期提供 MCP 薄适配器 | CLI 通过工具读取课程上下文、保存生成草稿；课程服务执行校验和最终提交，MCP 不直接操作数据库或创建第二套存储 |

不采用 PTY、`strip-ansi` 抓屏、模拟键盘回车或 Agent 死循环轮询。一次性进程也能流式与续聊；这些能力取决于 CLI 协议而非进程是否常驻。MCP 用于课程读写，CLI 结构化输出用于任务完成回执，HTTP/SSE 用于前端通信，三者职责独立。

技术基线：Node.js 24 LTS、TypeScript、稳定版 Next.js App Router、React、Tailwind/shadcn/ui、Zod、SQLite（例如 `better-sqlite3`）。渲染使用 KaTeX/mhchem、受控 SVG/JSXGraph、ECharts、Three.js/React Three Fiber、SmilesDrawer/3Dmol、Cytoscape；数值与小模型使用可信固定算法和 TensorFlow.js；代码实验使用 QuickJS-WASM、Pyodide 和 sql.js。具体版本在 M1 原型验证后写入 lockfile/运行库清单，按需加载，不全部塞入首屏。Zustand 只保存界面状态；服务器快照是课程状态依据。

新增库是设计选型，尚未做本项目集成验证；尤其 Pyodide 资源加载、代码隔离、WebGL/Worker 配合及三维性能要在 M1 验证。单项库不可用时可更换实现该契约的库，不据此取消整个学科的教学演示。

Node 自定义 HTTP 入口负责 `/api/v1/*`，其他请求交给 Next.js 的请求处理器；生产构建在本机启动，不使用 Serverless 或 Next.js 静态导出承载子进程。端口由系统分配并由启动器打开确切地址，禁止自动监听 `0.0.0.0`。

## 2. CLI 接入与已验证事实

### 2.1 2026-09-25 最小验证记录

在本机 Windows 上对用户已安装的 `agy` 做了只读帮助查询和两次最小模型调用；工作目录是专用临时目录，提示未包含仓库文件或学习记录。

| 项目 | 结果 |
| --- | --- |
| `agy --version` | `1.2.11` |
| `agy --help` | 存在 `--print`、`--output-format stream-json`、`--conversation`、`--json-schema`、`--print-timeout` |
| 普通打印请求 | 实际收到 `init` → `step_update` → `result`，退出码 0 |
| 指定会话续聊 | 使用第一次的 `conversation_id`，正确复述第一次的标记，退出码 0 |
| Schema 输出 | 最终 `result.structured_output` 得到符合 Schema 的对象 |
| 原始文本 | Schema 任务先出现 Markdown JSON，后出现附加文字；`result.response` 并非单一可直接解析的 JSON |
| 权限行为 | `--mode plan` 与 `--disable-slash-commands` 同用会警告前者无效；两次初始化均报告 `permission_mode=always-proceed` |
| 计量字段 | 续聊结果中的耗时/用量可能覆盖多步或历史；不得直接当作本次请求延迟或新增账单 |

当前是 **1.2.11 的接入候选基线**，不是“所有 1.2.x 均兼容”的承诺。未实测：未登录、限流、取消、网络中断、运行时授权交互及其他 CLI 版本；这些必须在 M0 补齐。官网页面当次访问超时，因此本节以本机帮助和真实事件为依据，不借用其他 CLI 的参数。

### 2.2 调用约定

等价命令形态如下。正文和参数通过 `spawn` 的参数数组传递，绝不拼接进 shell：

```text
agy --print <固定教学指令与JSON任务封装>
    --output-format stream-json
    --mode plan
    --sandbox
    --print-timeout 180s

续聊时追加：--conversation <该应用会话绑定的CLI会话ID>
结构化任务追加：--json-schema <应用生成的Schema文件绝对路径>
```

- 可执行路径从 PATH 检测或由用户选择，解析为绝对路径；不硬编码用户安装目录，不执行来自课程包的命令。
- Windows 使用 `spawn(executable, args, { shell: false, windowsHide: true, cwd, stdio: ['ignore', 'pipe', 'pipe'] })`，由监督器管理退出和取消。
- `cwd` 固定为数据根目录下的 `jobs/<requestId>/<runId>/`，只放当前需要的 Schema 等文件，不设为用户项目、下载目录或课程包解压目录。数据库不放在该任务目录内；课程位置不能依据 CLI 的 cwd 推导。
- 不传 `--dangerously-skip-permissions`，不修改 CLI 全局配置，不把 API key 注入环境来替代用户登录。沿用用户正常运行 CLI 所需环境，日志不打印环境变量。
- 不同时传 `--disable-slash-commands` 与 `--mode plan`；实际警告说明不能依赖此组合。输入固定以应用指令前缀和 JSON 封装开始，用户输入作为数据，不直接作为 slash command。
- `--sandbox` 和 `--mode plan` **不能被本应用宣称为操作系统级隔离或全部工具禁用**。实测权限字段仍可为 `always-proceed`。产品沿用用户配置的 CLI 权限，设置页如实展示；提示词里的“不要使用工具”不是安全边界。
- 一期仅向 CLI 提供受控的课程 MCP 工具，不要求它通过 shell 或任意文件写入修改课程；所有教学变更在应用课程服务中执行。若任务进入需交互授权状态且适配器无法安全处理，则结束为 `CLI_INTERACTION_REQUIRED`，引导用户在自己的 CLI 中处理；不自动回车同意或跳过权限。
- `--input-format stream-json` 在帮助中存在，但其输入消息结构尚未实测，一期不依赖该模式。未来常驻优化需独立验证。
- Windows 参数总长度含转义后须少于 24,000 UTF-16 单元。应用指令、上下文和问题超过预算时按第 9 节裁剪，不悄悄改用 shell 或不明输入协议。

### 2.3 原生事件到应用事件的映射

下列为实际观察到的最小结构，省略工具列表和计量信息。`cli-conversation-example` 是占位标识：

```json
{"event":"init","conversation_id":"cli-conversation-example","init":{"permission_mode":"always-proceed"}}
```

```json
{"event":"step_update","step_update":{"conversation_id":"cli-conversation-example","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"TUTOR_PROBE_OK"}}
```

```json
{"event":"result","result":{"conversation_id":"cli-conversation-example","status":"SUCCESS","response":"TUTOR_PROBE_OK\n"}}
```

结构化结果示例：

```json
{"event":"result","result":{"conversation_id":"cli-conversation-example","status":"SUCCESS","structured_output":{"marker":"TUTOR_PROBE_OK"}}}
```

适配器规则：

1. 使用 UTF-8 增量解码器按换行解析 NDJSON，支持跨 chunk 的汉字、JSON 和最后一个无换行记录。单记录上限 1 MiB，每任务 stdout 上限 10 MiB；超过上限终止并报告错误。
2. `init` 记录 CLI 会话 ID 和权限模式，不把工具列表广播到学习界面。
3. 仅在聊天任务中将 `step_type=agent_response` 的 `text_delta` 映射成文字预览，保留 `step_index` 做顺序处理。工具、系统、内部执行日志不作为导师消息。
4. `step_update.state=DONE` 只表示一个步骤结束，绝不是整个回复结束。
5. 必须收到 `result.status=SUCCESS`，并等到子进程以 0 退出，才有成功候选。缺少 result、非零退出或未知状态均不得发布内容；result 后 15 秒仍不退出则回收本任务进程并报协议异常，任务总超时保持不变。2026-09-26 真实续聊触发原 5 秒门槛，独立时序探针也测得正常清理约 3.7 秒；因此为 CLI 清理保留有限宽限，不跳过退出码验证。
6. 普通聊天以最终 `result.response` 替换对应消息的预览，不能再次追加最终全文。保留实际 Markdown，而非终端控制字符。
7. 课程、大纲、题目、诊断等任务通过 MCP 保存候选草稿；最终只读取 `result.structured_output` 中的 `GenerationReceipt`，再验证并提交对应草稿。普通 JSON Schema 探针仍可返回其自身测试对象；不从 `response` 里用正则“捞 JSON”，不渲染中间结构化输出。
8. CLI 的新增未知事件可记录类型后忽略；已知事件缺字段、无可识别终态或非 JSON stdout 是协议错误。stderr 单独限长、脱敏，不混入聊天流。
9. 以应用单调时钟记录 `spawn → firstDelta → processExit`；CLI 原生用量仅作为未校准的诊断信息，不冒充费用或本轮独立消耗。

### 2.4 一期课程 MCP 接口

#### 接入方式与验证状态

采用官方 MCP SDK 的 STDIO 服务作为薄适配器：Antigravity CLI 是 MCP client，适配器将工具调用转发到同一 Node 应用服务的受控回环网关。适配器不直接打开 SQLite、不按自己的 cwd 写课程，也不提供任意文件读写工具。浏览器仍使用 HTTP/SSE，不直接连接 MCP。

2026-09-26 本机帮助查询确认：`agy mcp add` 支持 `--type stdio|http`、command/args、环境变量和 HTTP header；参数标志需位于服务名之前。尚未注册本应用 MCP、启动课程 MCP 服务或实测工具调用，不把帮助查询当成联调通过。

安装完成后的配置形态如下，路径是占位符，不是当前仓库已经存在的程序：

```text
agy mcp add --type stdio adaptive-tutor <Node可执行文件绝对路径> <应用安装目录中的mcp-stdio.js绝对路径>
```

由用户在设置流程中完成/确认注册；路径含空格时按所在 shell 的规则分别引用，不使用 `npx` 临时下载未知包。CLI 帮助没有证明项目级配置作用域，因此应用不得假装此配置只影响当前项目，也不自动覆盖用户已有的同名 MCP 项。M0 验证注册作用域、进程复用行为与中文/空格路径后给出准确安装说明。

适配器通过共享目录定位模块读取 `runtime/` 中的活动服务地址和私有 MCP 网关凭证，验证回环地址和服务身份后连接。服务未启动则返回 `APP_NOT_RUNNING`，不能自建另一个数据库。STDIO stdout 只输出 MCP 协议消息，诊断走独立 stderr/受控日志。

#### 调用范围与工具契约

每次应用发起的 CLI run 都由服务端创建 `mcpScopeId`，绑定 requestId、runId、courseId、允许的节点/操作和过期时间；只把这个操作范围标识交给当前任务。scopeId **不是认证凭证**，实际客户端认证使用私有网关凭证。读写工具既检查客户端身份，又检查 scope 对应任务仍有效；会话复用不能扩大新任务的范围。

聊天 scope 只允许读取相关课程；生成/诊断 scope 可写对应类型草稿。即使用户把该 MCP 配置到其他 CLI 会话，无有效应用任务范围也不能任意读写课程。实际 CLI 如何发起/复用工具进程在 M0 验证，设计不依赖临时环境变量一定能穿透 CLI 的共享后台进程。

| MCP 工具 | 输入 | 结果与限制 |
| --- | --- | --- |
| `get_curriculum` | scopeId、可选 revision | 返回 scope 所属课程目标、节点、依赖、相关掌握摘要；不接受任意课程路径 |
| `get_node_content` | scopeId、nodeId、可选 lessonVersion/blockId/cursor | 返回范围内已发布正文与演示配置；不含未揭示答案键，长内容分页/切片 |
| `get_assessment_context` | scopeId、attemptIds | 仅诊断任务可读允许的已提交作答、对应题目和判分依据；不能伪造或新增作答 |
| `list_course_assets` | scopeId、可选 cursor/filter | 返回本课程已验证 assetId、类型和摘要，不返回任意主机文件路径 |
| `save_generation_draft` | scopeId、operationId、kind、payload | 使用第 5 节草稿 Schema 校验并保存 staged 记录，返回 draftId、kind、contentHash；只写任务允许的候选结果 |

`kind` 为 `plan_course / generate_lesson / generate_exercises / diagnose / revise_lesson`。工具从 scope 推导课程、任务和版本，不相信 payload 自报的归属。读取每页最多 20 项/8,000 字符，超限给出游标，不静默截断；单次写入 payload 上限 1 MiB，并应用更细的内容限制。所有工具错误以 MCP 错误结果返回稳定 code/message，不将错误当成功文本。

幂等键为 `(runId, operationId)`：相同内容返回原 draftId，异文返回 `IDEMPOTENCY_CONFLICT`。跨课程/超出工具权限返回 `SCOPE_DENIED`，过期或终态任务返回 `SCOPE_EXPIRED`，服务端版本变化返回 `VERSION_CONFLICT`。scope 状态检查与草稿写入处于同一事务，取消后的晚到工具调用不能继续写候选结果。

不暴露 `set_mastery`、任意 SQL、任意路径写入、直接发布课程图或直接执行补丁工具。补丁建议仍在 DiagnosisDraft 中表达，经第 8 节规则提交。MCP 写调用只进行校验/保存，**不能启动 CLI 生成任务或等待外层任务结束**，避免全局并发为 1 时发生嵌套等待。

#### 草稿与完成回执

```text
前端创建任务和 scope
  -> CLI 用 MCP 读取必要上下文
  -> CLI 用 save_generation_draft 保存候选内容到统一数据目录
  -> MCP 返回 draftId / kind / contentHash
  -> CLI 在最终 structured_output 返回 GenerationReceipt
  -> 应用验证成功终态、退出码、scope/草稿归属、版本与业务规则
  -> 发布初次节点/补题/诊断结果，或将大纲/重写草稿标为 pending 等待用户确认
```

`GenerationReceipt v1` 的 CLI JSON Schema 只接受下面的字段；其 kind 必须与本任务相同，contentHash 由服务端对已保存的规范化 payload 计算，模型应原样回传：

```json
{
  "schemaVersion": "1.0",
  "delivery": "mcp_draft",
  "kind": "generate_lesson",
  "draftId": "draft-example",
  "contentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

上例哈希是格式占位值；真实回执必须匹配数据库中已保存草稿。仅调用 MCP 成功不代表课程生成成功；缺少有效最终回执、CLI 失败/取消、错误 scope 或草稿 hash 不匹配时均不发布。候选保留为可审计/可清理的草稿，不成为学生可见的正式内容。

同一 run 可因校验错误保存新的候选，但仅最终回执引用的草稿可以提交；旧候选不能被另一任务借用。一次结构修复属于原 request 的新 run，创建新 scope 并撤销旧 scope。发布/进度事件仍由应用事务发出，而非适配器直接广播。

MCP 不可用时返回 `MCP_UNAVAILABLE` 并保留已有课程；一期不静默退回任意文件写入或另一套内容存储协议。只读离线学习不要求 MCP 正常运行。

## 3. 应用会话、任务与进程生命周期

### 3.1 标识与隔离

- `courseId` 标识课程，`sessionId` 标识该课程的一段导师对话，两者由应用生成 UUID。
- `requestId` 标识一次逻辑任务，`clientRequestId` 是客户端生成的幂等键，`runId` 标识实际 CLI 尝试。结构修复仍属同一 request，但有新的 run。
- `providerConversationId` 只由适配器保存，不发给前端，不导出、不跨应用 session 共用；禁止使用全局 `--continue` 猜最近会话。
- 同一个导师 session 最多存在一个 `queued/running/validating` 任务；另一个标签页提交新问题返回 `SESSION_BUSY`。相同幂等键的网络重试返回原任务。
- 大纲、生成和诊断使用全新的独立 CLI 对话，不复用导师对话。一个课程的计划提示和另一课程的答疑不能共享上下文。
- 聊天在成功完成后才更新 session 的 CLI 会话绑定；取消、失败、CLI 会话缺失时将该绑定标记为不可续用，下次由本地已完成消息构造新会话。

### 3.2 状态机

```text
queued -> running -> validating -> completed
   |         |           |
   +---------+-----------+--> failed / cancelled / interrupted
```

`completed`、`failed`、`cancelled`、`interrupted` 是互斥终态，不再被晚到事件覆盖。`interrupted` 用于应用重启时无法确认结束的历史任务。任务终态与领域变更、最终消息、完成事件须一起提交。

- 一期全局运行并发为 1，待运行上限 10。导师任务优先，其余按入队顺序；队列满返回 `QUEUE_FULL`，前端保留输入。
- 默认运行超时：导师 300 秒、诊断 180 秒，单节点生成/重写/补题 300 秒，大纲生成 600 秒；排队不占运行超时，结构修复消耗同一任务剩余预算。CLI `--print-timeout` 与应用监督超时同时设置。导师通过持久化 job.progress 事件显示脱敏步骤类别、状态、步骤号及更新时间，不发送原始工具参数或内部推理文本。
- 取消使用数据库状态比较更新：若终态已提交，返回原终态；否则先写 `cancelled`，拒绝后续变更，回收所拥有的子进程及子树。不能按进程名杀掉用户自己开的 CLI。
- Windows 的进程树回收通过监督器/Job Object 等已验证机制实现，应用退出同步释放。CLI 自身管理的共享后台进程不作为可随意终止的应用子进程。
- 限流、认证失败和交互授权问题不自动重试。内容校验失败允许一次结构修复；若用户取消，则不再修复。其他失败由用户显式重试，使用新的请求标识并链接 `retryOf`。
- 应用重启将未结束任务标为 `interrupted`，恢复已提交数据，不自动重放模型请求。浏览器断开但应用还在运行时任务继续。

### 3.3 登录与能力检测

启动只做无模型调用的可执行文件、版本和帮助检查。真正的认证/网络探针由用户触发，使用无个人数据的固定短提示。状态为 `not_installed / incompatible / unchecked / ready / auth_required / quota_limited / unavailable`。

一期针对 1.2.11 保存适配器契约测试样本。其他版本显示“未验证”，完成用户触发的兼容探针与协议校验前，不默认为 ready。没有证据的错误返回通用类别，保留可供用户查看的脱敏诊断。

## 4. 持久化数据契约

### 4.1 通用约定

- 统一数据根目录为 `~/.herta-ai/adaptive-tutor-platform/`，由 `path.join(os.homedir(), '.herta-ai', 'adaptive-tutor-platform')` 定位。主应用和 MCP 适配器共用同一定位模块；不能使用 `process.cwd()`、代码仓库路径或字面量 `~`，不继续使用旧设计的 `%LOCALAPPDATA%/AdaptiveTutor/`。
- 启用 SQLite 外键、WAL 和短事务；数据库 schema 版本通过 migration 管理，迁移前做一致性备份。
- 时间是 UTC ISO 8601；业务 ID 是应用生成 UUID。Agent 提案使用局部 key，提交时映射为正式 ID，不能任意指定全局主键。
- `courseRevision`、`lessonVersion`、`exerciseVersion` 是正整数；内容版本不可原地改写。写请求带目标版本，冲突返回 409。
- 所有请求严格校验对象结构、字符串长度、有限数值、枚举及跨对象引用。JSON Schema 合格不代表业务合法。

#### 4.1.1 目录布局与数据归属

```text
~/.herta-ai/adaptive-tutor-platform/
  tutor-v2.sqlite             # 课程/草稿/学习状态/历史/消息/事件，唯一结构化状态源
  tutor-v2.sqlite-wal / -shm   # SQLite 自己管理，不单独清理
  assets/                  # 持久资源：图片、模型、分子、数据集、快照产物，按内容哈希管理
  jobs/<requestId>/<runId>/ # CLI 工作目录、Schema、必要任务暂存
  imports/<importId>/      # 课程包验证暂存，未提交不能成为可见课程
  exports/                 # 应用生成的导出包；用户可显式另存为到其他目录
  backups/<backupId>/      # 一致性数据库备份与所需资源/校验清单
  cache/runtimes/          # 固定版本运行库/WASM，可校验后重新获取
  logs/                    # 限长、限时、脱敏诊断日志
  runtime/                 # 本机实例锁、服务发现和 MCP 连接信息；不进入课程导出
```

`tutor-v2.sqlite` 保存课程正文 JSON 和题库，不另外在工作树维护可写的课程 Markdown/JSON 副本；导出时才从已发布版本生成文件。旧版数据库不会迁移，首次启动需要用户确认清除。assets 是持久数据，不能因名字像“缓存”就删除；可重新下载不代表用户导入资源总能重新取得。

在本机，Node 解析出的目录是 `C:\Users\wyate\.herta-ai\adaptive-tutor-platform\`（仅为当前用户示例，禁止硬编码）。其他用户使用自己的主目录。即使从不同盘符或代码检出目录启动，也应得到同一用户的数据目录；一期不提供容易造成两套数据库的自动 cwd/env 回退。

远程代码仓库为 `https://github.com/Herta-ai/adaptive-tutor-platform.git`。其中只保存代码、文档、迁移与脱敏测试夹具；个人课程、运行数据、备份和连接凭证不提交 Git。CI/自动测试使用显式创建的隔离测试目录，不能写入真实用户数据根；该测试入口不作为生产环境静默切换路径的机制。

#### 4.1.2 创建、访问与迁移

- 首次启动由应用服务按需创建并检查目录权限/可写性；磁盘满、无权限和数据库版本不兼容应明确失败，禁止回退到仓库或系统临时目录保存课程。
- 根目录下的资源路径在数据库中保存为 assetId/受控相对路径。写入时规范化并检查最终落点仍在该根目录内，防止 `..`、绝对路径或符号链接/目录联接绕过；课程标题不用于直接拼接文件路径。
- 同一数据根只允许一个应用服务拥有写实例锁。第二次启动连接现有服务或报告已运行；多个 MCP 适配器是同一服务的客户端，不各自打开 SQLite 写入。服务发现文件不能代替活动性/身份验证，也不能仅凭旧 PID 就杀进程。
- runtime 中 MCP 连接凭证仅授权当前 OS 用户读取（Windows 用户 ACL，POSIX 对应用户权限），随服务启动轮换，不写入仓库、课程包、普通日志或模型提示。普通浏览器 token 与 MCP 网关 token 不共用。
- 缓存/任务清理只操作已确认不在使用的子目录，禁止递归删除 `.herta-ai` 父目录；其他 Herta 应用的数据不属于本应用。
- 旧 `%LOCALAPPDATA%/AdaptiveTutor/` 仅是此前文档方案，不表示已经存在或需要自动迁移。若将来检测到旧数据，先停写、做含必要资源的一致性备份，再显式迁移并验证；不自动合并两个已有数据库，也不在本次文档修改中创建或迁移数据。
- 备份必须能够找回其引用资源，不能仅保存数据库后又把被引用 assets 回收；恢复时检查版本和资源哈希。缓存清理不得触碰备份，用户删除课程时应说明独立备份仍可保留历史数据。

### 4.2 核心实体

| 实体/表 | 必须字段与约束 |
| --- | --- |
| `courses` | id、title、topic、goal、profile、status(draft/active/archived)、revision、createdAt；profile 包含 background、weeklyMinutes、language、可选 targetDate |
| `concepts` | id、courseId、key、label；课程内 key 唯一，用于补课去重，不把自由文本标题当唯一键 |
| `nodes` | id、courseId、conceptId、title、kind(main/remedial)、objectives、estimatedMinutes、contentStatus(not_generated/generating/ready/error)、currentLessonVersion；每节点 1～3 个带 id 的目标，有旧发布版本时重生成失败仍保持 ready |
| `edges` | id、courseId、fromNodeId、toNodeId、kind(prerequisite/remediation)、patchId?、active；方向始终是先修 → 后续 |
| `lessons` | nodeId、version、documentJson、status(draft/published/invalid)、generatedBy、createdAt；联合主键 |
| `drafts` | id、requestId、runId、courseId、nodeId?、kind、baseRevision、payload、contentHash、operationId、status(staged/pending/published/applied/rejected/stale)；MCP 候选为 staged，校验完成的大纲/重写为 pending，其余按发布/应用结果流转 |
| `exercises` | id、version、nodeId、objectiveId、familyId、prompt、answerSchema、grading、explanation、status；答案规则只在服务端普通查询之外保存 |
| `learning_cycles` | id、nodeId、remediationEpochId、kind(initial/verification/review)、status、startedAt、completedAt?；每节点一个当前轮 |
| `assignments` | id、cycleId、exerciseId/version、eligibleForEvidence、issuedAt、hintRevealedAt?、solutionRevealedAt?；历史已用家族的复练标记为不贡献证据，提示暴露由服务端写入 |
| `attempts` | id、assignmentId、clientRequestId、answer、correct、evidenceScore、firstInFamily、createdAt、voidedAt?、diagnosisState(not_required/pending/queued/completed/failed)、diagnosisRequestId?；原始答案不可覆盖；不具备证据资格的复练或重复首答的 evidenceScore 为 null |
| `progress` | nodeId、cycleId、status、masteredOnce、masteredAt?、reviewStage、nextReviewAt?、objectiveEvidence、bypass；可从保留证据重算 |
| `diagnoses` | id、requestId、nodeId、cycleId、objectiveId、attemptIds、errorType、confidence、explanation、suggestedConceptId?、status(usable/stale/voided)；不直接代替判分 |
| `patches` | id、courseId、targetNodeId、cycleId、remediationEpochId、baseRevision、diagnosisId、conceptIds、proposal、status(applied/reverted)、createdAt；按阶段记录次数与去重键 |
| `sessions` | id、courseId、status、providerConversationId?、providerBindingValid、createdAt；供应商标识不导出 |
| `messages` | id、sessionId、requestId、role、text、status、contextSnapshotId?、createdAt；以 messageId 更新，绝不按数组最后一条猜归属 |
| `context_snapshots` | id、courseId、nodeId、lessonVersion、blockId?、selection?、componentState?、createdAt；保存发送瞬间状态 |
| `jobs` / `runs` | requestId、clientRequestId、payloadHash、kind、courseId、sessionId?、state、retryOf?；run 另存 CLI 版本、退出码、计时、修复次数 |
| `mcp_scopes` | id、requestId、runId、courseId、allowedNodeIds、allowedTools、allowedKind、expiresAt、revokedAt?；范围由应用签发，scopeId 不充当客户端认证凭证 |
| `events` | eventId（递增整数）、requestId、sequence、courseId、sessionId?、type、payload、createdAt；同一 request 的 sequence 唯一 |
| `notes` / `assets` | notes 绑定节点及可选内容版本；assets 保存 id、hash、mime、size、受控相对路径、来源及再分发许可 |
| `demo_snapshots` | id、courseId、nodeId、lessonVersion、blockId、templateId/version、stateSchemaVersion、parameters、seed?、step/time?、selectedIds、summary、artifactRefs、createdAt；只保存明确需要的可复现状态，不保存 Worker 内存或可执行运行库 |

`objectiveEvidence` 只是缓存，计算规则必须与 PRD 的 `mastery-v1` 一致。`masteredOnce` 在单纯复习到期时保留；目标或答案被判无效造成历史达标依据撤销时重算，并标记受影响后续节点待复核，不删除其进度。

### 4.3 一致性要求

- 幂等范围为“操作种类 + 所属课程/会话 + clientRequestId”。相同 key、相同规范化 payload 返回原响应；相同 key、不同内容返回 `IDEMPOTENCY_CONFLICT`。幂等记录随业务记录保留，不随 SSE 事件清理。
- 作答、证据更新、进度更新和领域事件在同一事务中提交；首答判定也在该事务内，防止双标签页都成为首答。
- 题目无效化通过 `voidedAt` 和审计信息表达，不删历史；重新计算相关进度和复习状态。
- 补丁事务同时验证 revision、当前 cycle、补丁次数、去重和 DAG，再写图与事件；不得先通知前端成功后才尝试落库。
- 流式预览以不超过每 50ms 一批的频率把消息增量和事件一起持久化；最终替换及终态独立提交。未持久化的数据不发给浏览器，避免重连时出现无法补发的片段。
- 事件表作为持久化 outbox，SSE 只读取已提交事件；数据库失败时不得对外宣称任务成功。

## 5. 内容和模型输出契约

### 5.1 统一校验方式

应用维护 `contracts/v1` 的 Zod 定义，并从同一来源导出 MCP 输入与草稿 JSON Schema；CLI 的最终输出约束使用 GenerationReceipt Schema，普通探针仍用对应测试 Schema。所有对象默认拒绝未知业务字段。以下表格规定必须落地的字段和约束，不代表仅凭 TypeScript 类型就完成运行时验证。应用尚未发布，扩充本基线的 v1 块类型而不假定已存在旧版课程迁移；首次发布后新增不兼容字段必须走版本迁移。

结构化任务类型固定为 `plan_course / generate_lesson / generate_exercises / diagnose / revise_lesson`，每种类型对应一个 MCP payload Schema，最终 CLI 回执引用已保存草稿。外层课程、版本、请求归属由应用补充，不能信任模型自行指定的 `courseId` 或进度。

| 输出类型 | 模型应返回的字段 |
| --- | --- |
| `CurriculumDraft` | schemaVersion、title、summary、concepts[{key,label}]、nodes[{key,conceptKey,title,objectives[{key,description}],estimatedMinutes}]、edges[{fromKey,toKey}]、sources |
| `LessonDraft` | schemaVersion、title、blocks、exercises、sources、assetRefs；目标 ID 来自任务输入，不允许偷偷增加目标；演示只使用本次提供的 capabilities 子集 |
| `ExerciseBatch` | schemaVersion、exercises；每题绑定输入允许的 objectiveId，familyKey 必须声明是新家族还是已有家族 |
| `DiagnosisDraft` | schemaVersion、objectiveId、attemptIds、errorType、confidence、explanation、nextAction、patchProposal（可为 null） |

大纲初始最多 80 个节点；一个课程最多 500 个节点；节点目标 1～3 个，预计分钟数为 5～15。新节点使用局部 key，服务端校验、去重后分配 UUID。大纲确认前为草稿，确认时重新检查 DAG 和版本。

生成节点前按目标选取相关模板摘要与参数 Schema，不向 CLI 一次塞入全科全部引擎说明。输入包含 capabilityId/version、允许参数、限制、可用资源摘要和可验证样例；模型返回声明式配置，不能生成新模板代码。模型提出未注册能力时先匹配通用组件或报告 `CAPABILITY_UNSUPPORTED`，不能伪造完成状态。

### 5.2 `LessonDocument v1`

发布对象包含 `schemaVersion: "1.0"`、courseId、nodeId、lessonVersion、title、objectives、blocks、exercises、sources、assetRefs、requiredCapabilities、provenance。模型只生成上节的草稿子集，其余字段由应用写入。requiredCapabilities 根据实际块计算，包含模板和数据格式版本。provenance 仅含 runtime、cliVersion、可选模型显示名、schemaVersion 和 createdAt，不包含原始 prompt、供应商会话 ID 或本机路径。

每篇最多 64 个内容块、正文合计 60,000 字符、18 道初始题。发布时每个目标至少有 3 个合格家族；若未满足则补题或保持草稿，不能假装课程已就绪。

| 块类型 | 字段及渲染行为 |
| --- | --- |
| `markdown` | blockId、type、role(goal/explanation/worked_example/recap)、text；用受限 Markdown 与 KaTeX 排版，代码只高亮 |
| `geometry2d` | 通用演示字段，config 为几何约束/坐标；由本地受控 SVG/JSXGraph 模板构造，不接收 SVG/JS 源码 |
| `function_plot` | 通用演示字段，config 包含 expression、domain、parameters；安全 AST 求值后生成采样点，再传给本地 ECharts 固定配置 |
| `exercise_ref` | blockId、type、exerciseKey；必须引用本文已定义的题目 |
| `math_manipulative` | 分数块、数轴、竖式、比例等小学教具，支持分步状态 |
| `scene3d` | 内置几何体/受限静态模型、曲面/曲线/向量场、截面与标注 |
| `matrix_lab` | 小矩阵、向量与固定的消元/投影/分解算法及步骤 |
| `data_chart` | 数据表/样本、受控统计/时频图表和抽样配置 |
| `simulation` | 物理、电路、控制、化学动力学、种群等已注册模型与初始条件 |
| `molecule` | 二维 SMILES 或已有三维坐标资源，结构来源和选中原子状态 |
| `process_diagram` | 网络/流程、阶段转换、时间线及相关局部计算，用于生物/化学/系统/论证 |
| `annotated_asset` | 图片、受限三维模型或地图上的标签/区域/图层，含来源和替代说明 |
| `algorithm_trace` | 可信算法/系统状态机，输入数据、步骤及变量/栈/内存/报文视图 |
| `code_lab` | language、source、示例输入和允许包；只在用户显式运行后执行，正文渲染不执行 |
| `ml_lab` | 已注册的小型 ML 任务、数据引用、数据划分、超参数与评价视图 |
| `neural_lab` | 小网络/单层算子、张量输入、训练或逐步传播配置，禁止自定义执行代码 |

`blockId` 在同一版本内唯一，同一语义块修订时尽量保留。每篇必须包含四种 Markdown role；发布前检查所有引用存在。除 markdown/exercise_ref 外，演示块统一使用 `{blockId,type,templateId,templateVersion,config,modelInfo,alt}`；表中的功能字段位于对应 config Schema 内，详见第 5.5 节。

二维几何一期起步模板（必须在同一期扩展到 PRD S01～S03 所需的构造链、辅助线、相似/全等、圆锥曲线等，不能只停留于下面三个形状）：

- `math.triangle`：A/B/C 三点坐标、允许拖动的顶点集合；坐标限定在 [-1000,1000]，拖动退化到共线时提示，不输出不存在的角度。
- `math.right_triangle`：origin、width、height，宽高范围 [0.1,100]；通过模板参数保持直角关系。
- `math.circle`：center、radius，半径范围 [0.1,100]；仅允许内置的半径、直径、圆心标注。

例如下面是一个完整图形块，不能被解释为可执行代码：

```json
{
  "blockId": "right-triangle-example",
  "type": "geometry2d",
  "templateId": "math.right_triangle",
  "templateVersion": 1,
  "config": {"origin": [0, 0], "width": 4, "height": 3},
  "modelInfo": {"mode": "computed", "assumptions": ["欧氏平面几何"], "units": {"length": ""}, "sourceIds": [], "tolerance": 1e-9},
  "alt": "两条直角边长分别为4和3的直角三角形；可调整宽高。"
}
```

表达式只允许有限数字、常量 pi/e、模板声明的自变量（单曲线为 x，曲面/场按需为 x/y/z，时间为 t）、显式声明的最多 8 个数值参数、`+ - * / ^`、括号，以及 `sin/cos/tan/asin/acos/atan/atan2/exp/log/sqrt/abs/min/max`。采用专用 tokenizer/parser 和 AST 解释器，禁止属性访问、字符串、赋值、循环和函数构造。AST 深度最多 32、节点最多 256、每曲线最多 1000 个采样点；定义域端点有限且在 [-1e6,1e6]，遇到非有限结果绘制断点而非连接跨越。参数必须声明 min/max/step/value 并校验范围。多维网格、ODE/PDE 只由相应固定内核调度，不能利用表达式语言声明任意求解程序。

Markdown 禁止原始 HTML、MDX、脚本链接和任意 iframe；资源只允许应用内部 assetId。KaTeX 使用不信任模式并限制展开量。图形与数学失败显示 `alt`/原式及错误标识，不执行备用生成脚本。

### 5.3 题目及判分契约

每题必须有 `key、objectiveId、familyKey、kind、prompt、grading、explanation`；`prompt` 为受限 Markdown，单选/多选另含 `{id,label}` 选项数组。familyKey 由应用映射为稳定 familyId，改数字不能绕过家族去重。

| kind | 学生 answer | 服务端 grading |
| --- | --- | --- |
| `single_choice` | `{optionId}` | `{correctOptionId}` |
| `multiple_choice` | `{optionIds: string[]}` | `{correctOptionIds: string[]}` |
| `numeric` | `{value: string, unit: string}` | `{expected: number, unit, allowedUnits, absTolerance, relTolerance}` |
| `parameter` | `{values: Record<string, number>}` | `{template: "parameter_targets", targets: [{key,expected,absTolerance,relTolerance}], blockId}` |

选项 ID 必须存在，多选不得重复。数值输入只接受有限十进制数或科学计数法，单位必须在该题允许的预定义单位表中，先转成 grading.unit 再按 PRD 容差判定；禁止把输入当表达式执行。容差必须是非负有限数。参数题的 key 必须属于关联图形的可调参数，值在允许范围内，各目标都满足数值容差才通过。

全学科使用服务端 `UnitRegistry v1`：以 SI 七种基本量纲建立单位记录，内置 m/s/kg/A/K/mol/cd 及受控前缀，并注册 N/Pa/J/W/C/V/ohm/F/H/T/Hz、L、eV、rad/deg、百分数等教学常用单位和别名。复合单位只允许白名单单位、乘除及有限整数幂（如 m/s^2、mol/L），校验量纲和倍率；角度保留语义标记，deg 转 rad 的倍率为 π/180。摄氏度与 K 使用明确的仿射转换，仅用于允许的温度题，不把偏移单位直接放进乘除。每题声明标准单位与 allowedUnits；模型不能自行定义换算代码，未注册单位提示不支持而不猜测。

服务端向学生发送 `ExercisePublic` 时移除 grading、explanation 及未揭示提示；返回 `assignmentId` 和答题输入约束。提交前揭示提示/解析必须先写 exposure，再返回内容；提交后的评分和解析可以一起返回，评分使用提交瞬间此前的暴露状态。

已在以前学习轮见过的家族可以复练，但新验证轮应分配历史未使用的家族；无新题且离线时提示“新验证题需要联网生成”，不得用已展示答案的题伪造新证据。课程包含答案，因此这是学习规则而非防作弊系统。

### 5.4 来源和输出发布

`Source` 包含 id、title、url?、status(verified/suggested)、accessedAt?、supportsBlockIds、license?。只有存在实际获取/人工核对记录时服务端才允许 verified；模型自报 verified 不被直接采纳。资源记录真实格式、hash、来源和是否允许再分发，禁止自动执行或加载远端资源。

MCP 保存候选前先验证 JSON Schema、字段长度/枚举、引用与目标归属、图形模板/题目规则。生成完成后再校验最终回执与草稿 hash/归属、任务状态和版本冲突，才允许发布初次节点；大纲和人工请求重写的内容须预览确认。失败允许一次携带精简校验错误的修复，仍失败则返回 `CONTENT_INVALID`，保留之前版本。CLI 中间输出与 MCP staged 草稿都不能直接作为正式 LessonDocument 下发。

### 5.5 全学科组件注册表与模板计划

每个模板由应用开发时注册，记录 `capabilityId、version、blockType、subjects、configSchema、stateSchema、observableSchema、resourceFormats、computeKernel、limits、referenceCases、fallback`。配置仅为数据；模块、算法实现、着色器、运行库和事件处理器来自应用可信构建产物。

演示通用字段：

- templateId/templateVersion：分别对应注册表的 capabilityId/version，精确匹配已注册版本；不能运行课程包携带的新实现。
- config：模板专属参数、资源 ID 和初始状态；参数为有限值，矩阵/张量形状及引用完整性均校验。
- modelInfo：`mode=computed|simplified|precomputed|illustrative`、assumptions、units、sourceIds、seed?、tolerance?。mode 必须在该模板允许集合内；模型不能把过程示意自报为真实求解。
- alt：可独立理解的文本替代；fallback 可以是表格、可信生成的多视图图像或过程步骤。未知模板仍拒绝，已知模板因 WebGL/资源暂不可用才走降级。
- 所有随机/训练模板固定 seed 并记录实现版本。预计算数据须带生成条件和参数有效域，超出有效域不能继续播放旧数据并假装实时计算。

下面是一期必须实现的模板族；同一引擎可服务多个学科。细化子模板时使用稳定 ID，不因换库改变课程语义。

| 模板族与底层能力 | 一期子模板覆盖 | 科学/算法验收依据 | PRD 学科 |
| --- | --- | --- | --- |
| `math.*` / SVG、JSXGraph | 数轴、分数块、竖式、比例、方程/不等式步骤、函数/数列、约束几何构造、三角/圆/圆锥曲线、复平面 | 分数面积、运算步骤、长度/角度约束和退化情形 | S01～S03 |
| `calculus.*` / AST、数值核、ECharts | 切线/极限、黎曼和、级数、偏导/梯度、方向场、求根/数值积分 | 已知函数解析结果、收敛误差和奇点处理 | S04/S07 |
| `optimization.*`、`logic.*` | 低维线性规划可行域/顶点、梯度下降/步长、集合关系、真值表与递推 | 已知最优点、不可行/无界提示、布尔参考表和递推步骤 | S07/S18 |
| `scene.*` / Three.js | 立体几何、平面截多面体/球、显式/参数曲面、向量场、轨道/时空示意 | 坐标与交点、单位/轴方向、裁剪/采样边界 | S03～S05/S09/S11 |
| `matrix.*` / 固定数值内核 | 消元、行列式、线性变换、正交投影、特征分解、SVD/低秩重建 | 小矩阵参考结果；奇异/病态矩阵提示与误差；变换动画共享数值结果 | S05/S18 |
| `statistics.*` / seeded RNG、ECharts | 概率树、离散/连续分布、抽样/CLT、区间检验、回归与混淆矩阵 | 理论分布/参考计算、样本量、重复种子结果 | S06/S18 |
| `physics.*` / 解析/可信 ODE、Matter.js | 抛体、摆/弹簧、碰撞、转动、理想流体、气体/热机、低维扩散与热/波动网格 | 守恒量、已知周期/轨迹、稳定步长、数值误差；理想流体不冒充 CFD | S08/S10/S11 |
| `fields.*`、`optics.*` | 点电荷/线电流、场线/等势线、几何光路、双缝/单缝、偏振、光电效应、势阱/隧穿解析模型 | 对称性、场强、干涉极值/能级和归一化；声明理想近似 | S09/S11 |
| `circuit.*`、`control.*`、`signal.*` | 小型线性 RLC/源电路、常见二极管/晶体管教学曲线、PID、二阶系统、FFT/采样/滤波、简化结构受力 | Kirchhoff/解析阶跃解、稳定性边界、已知频谱与混叠；非线性元件不承诺通用 SPICE | S09/S20 |
| `chemistry.*` | 元素周期表、原子/电荷守恒配平、物质的量、简单酸碱滴定/平衡/速率、电池示意、机理步骤 | 守恒、浓度/单位、模板条件下解析/参考曲线；配平不代表反应可发生 | S12/S13 |
| `molecule.*` / SmilesDrawer、3Dmol | 二维骨架、手性标记、球棍/空间填充、蛋白 cartoon、选择原子/键与测距 | 原子/键对应、坐标来源与立体信息；无坐标时不伪造三维 | S13/S14 |
| `process.*`、`annotation.*` / SVG、Cytoscape、受限模型 | 细胞/器官分层图、分裂/复制/转录/翻译、遗传概率、代谢/酶、食物网/系统树、种群与选择模型 | 生物阶段、结构标注、遗传概率、米氏/种群解析对照；标注示意比例 | S14/S15 |
| `algorithm.*`、`systems.*` / 可信状态机 | 排序/搜索/递归、树图/哈希/DP、逻辑门/流水线/缓存、调度/分页、路由/协议、索引/事务 | 参考执行轨迹、状态不变量、每步输入/输出；绝不操作真实系统状态 | S07/S16/S17 |
| `code.*` / 隔离运行环境 | 可编辑 JS/Python、NumPy 小数组、内存 SQLite/SQL；示例输入和打印/表格/受控绘图输出 | 小程序真实输出、资源限额、隔离与取消；不把预录 trace 当用户程序运行结果 | S16/S17/S18 |
| `ml.*` / 固定算法、TensorFlow.js | 线性/逻辑回归、kNN、小决策树、朴素贝叶斯、二维线性 SVM、k-means、PCA、划分/归一化/评价 | 已知小数据集、损失/边界、训练验证分离；高级核 SVM 可先做可信预计算对照 | S18 |
| `neural.*` / TensorFlow.js、张量可视化 | MLP 前向/反向及训练、CNN 卷积/池化、RNN 单步状态、嵌入、小序列缩放点积注意力/多头/掩码与 Transformer 结构 | 小矩阵手算、有限差分梯度、卷积输出、注意力归一化/屏蔽位置；不声称完整大模型训练 | S19 |
| `geo.*`、`timeline.*`、`economics.*` / GeoJSON、SVG/ECharts、过程图 | 地形/地层/板块/水循环、气候数据、季节/太阳系、供需/边际/收益矩阵、历史时间线、语言/论证关系 | 公开数据、日期/坐标、模型条件、收益计算、标注来源 | S21/S22 |

共用 process/annotation/scene 不等于拿任意流程图代替学科结构。每个 S 组需要相应的示例资源、参数模型和科学检查，逐项登记覆盖表内主题。可预置来源明确的标注图/模型；不要求所有解剖或地形都由 Agent 从零构建。

### 5.6 演示计算、状态与性能

区分两个运行域：`jobs` 是 CLI 生成任务；浏览器的 `demoRunId` 是演示计算。暂停实验不会取消导师请求，CLI 排队也不阻止已有本地实验运行。重型演示默认同时激活一个，轻量静态块可并存。

组件通过统一命令 `setParameters / play / pause / step / reset / select / snapshot / dispose` 工作，产生 `state / observable / completed / error` 消息。config 是课程不可变初始配置；交互 state 独立保存，不能拖动参数就修改课程版本。

- 一个 compute kernel 输出同一时刻/步骤的所有观测量，图像、表格和曲线订阅同一状态。禁止不同面板各运行一份时间轴造成不一致。
- 计算在可信 Web Worker 内执行；绘制在主线程或经验证的 OffscreenCanvas 路径完成。可见绘制最多每帧一次，非可见实验暂停；切换课程须 dispose WebGL/Worker/张量资源。
- ODE 使用模板声明的解析解或固定步长方法（如 RK4），PDE 使用声明稳定条件的小网格格式。超出稳定条件拒绝或显式缩小步长，不能把发散轨迹绘制成真实现象。
- 稳定 ID 标识原子、图节点、张量轴、变量与算法步骤。改变参数产生新的 runRevision，晚到的旧 Worker 输出丢弃；停止后不能继续覆盖新实验状态。
- 默认资源上限：每场景 100,000 三角形、向量箭头 2,000；曲面网格 128×128；矩阵 32×32；物理对象 200、数值轨迹 10,000 步；热/波网格 128×128；线性电路 50 节点；图网络 500 节点/2,000 边；图表单序列 10,000 点。模板可设置更低上限，不能由模型提高。
- 分子最多 50,000 原子，大结构使用 cartoon/抽样标签；全原子表面等昂贵显示另设更低模板限额。蛋白显示只承担已有结构浏览，不进行折叠预测。
- 小型 ML 数据最多 5,000 行×32 特征；默认演示用更小的二维/低维数据。深度学习训练最多 100,000 参数、2,000 样本，单算子张量最多 1,000,000 个元素，训练设置最大迭代和墙钟预算（默认 30 秒）。达到预算显示中断/部分结果，不伪装收敛。
- 以 CPU 或已验证的 WASM 后端保证基础计算可用，WebGL 加速按能力选择；不要求 WebGPU 或独立 GPU。不同后端按数值容差比较结果，不能假定浮点位级一致。
- snapshot 保存参数、seed、步骤、选中对象、实现版本和结果摘要；需要完整轨迹或权重时保存为经校验的数据 asset。模型答疑只读取摘要和相关局部切片，不接收整个数据集/训练权重。
- 错误类型包括 `DEMO_LIMIT_EXCEEDED / NUMERIC_UNSTABLE / RESOURCE_MISSING / CAPABILITY_UNAVAILABLE / DEMO_CANCELLED`。给出当前参数、原因和恢复办法，不改动学习进度。

演示/代码成功、训练损失下降、播放完毕都不直接产生掌握证据。参数题仍只使用第 5.3 节的确定性判分器；若询问计算结果，使用预先核对的数值题或可信内核给出的题目参考值，不直接相信浏览器提交的训练指标。代码自动裁判不是一期全科演示的前提。

### 5.7 小型代码实验

`code_lab.config` 包含 `language=javascript|python|sql`、source（最多 16 KiB）、input、allowedPackages、datasetRefs、outputViews。只有用户点击运行才启动，来自 Agent 或导入包的程序同样不能自动执行。

- 实验处于独立的 opaque-origin sandbox iframe（仅 allow-scripts，不授予 allow-same-origin），内部 Worker 承担运算。父页面只通过专用 MessageChannel 传递已验证输入并接收限长结果，所有消息校验 runId/schema/大小。
- JavaScript 运行于 QuickJS-WASM 虚拟机，不把浏览器 DOM、fetch、Node API 或宿主对象暴露给用户代码。Python 使用固定版本 Pyodide，标准库及预装 NumPy；SQL 使用独立 sql.js 内存数据库，不连接 tutor.sqlite。
- 运行库由应用管理、预校验并加载。实验的 CSP 阻止网络和顶层导航；初始化所需包资源只能来自父页面提供的固定版本只读资源映射，不提供任意 URL 代理。禁止 pip/npm 安装、宿主 shell、文件系统挂载和数据库扩展加载。
- Python 可访问的浏览器桥接也必须被限制在隔离环境内；不能仅以“用了 Worker”就声称隔离完成。M1 必须验证 Cookie/同源 API、父页面数据、任意联网、存储和弹窗不可达。
- 默认运行超时：JS/SQL 2 秒、Python 5 秒，初始化下载单独显示；输出文本最多 64 KiB、表格 1,000 行，受控绘图使用规范数据或校验后的 PNG，不返回任意 HTML。超时由宿主终止 Worker，保留代码方便修改。
- QuickJS 使用其可配置的内存/中断限制；Pyodide/sql.js 采用已验证构建上限、输入/输出/时长限额和监控。浏览器不能提供等同独立 OS 进程的统一硬内存隔离，不能作此承诺；任意不可信大程序、持久服务和系统级工具留到通用运行环境阶段。
- 用户程序输出只能作为实验反馈或题目答案输入，不能直接调用 progress/patch API。示例程序、独立的标准算法 trace 与实际运行结果必须有清楚区分。

若某一语言的隔离验证失败，在解决前禁用该语言的实际执行并显示原因；同学科的算法/状态机演示继续可用，但不能把失败的语言执行项算作 A24 已通过。不能仅因隔离尚未实现就把全部编程演示降为高亮代码。

### 5.8 多学科资源与模型来源

资源服务接受的教学数据包括：PNG/JPEG/WebP、经验证的静态 GLB、PDB/mmCIF/SDF、数值 CSV/JSON、受限 GeoJSON，以及受控模型模板的纯权重/张量数据。每种格式有专门解析器、大小/数量限制和 MIME/结构检查；不得因扩展名合法就直接信任文件内容。

- GLB 禁止外部 URI、未注册扩展和可执行内容；纹理必须内嵌或引用已登记本地 asset，解码尺寸受限。导入的动画只作为标明来源的预制过程，不等于物理求解。
- SMILES 先做解析与二维显示。三维优先使用随应用提供的来源明确结构或用户导入的 SDF/PDB/mmCIF；用户请求外部结构时，经支持的结构库 ID（如 PubChem CID/PDB ID）取回、核对分子/立体信息后缓存。取不到匹配坐标时保留二维并说明，不伪造三维构象。
- 标注图保存对象 ID、区域/层、说明、来源及必要比例说明；解剖/细胞图可采用公开许可图片加交互标注，避免把关系网络误作真实形态。
- 数据集显式记录字段、单位、行数、来源、缺失值和标签。ML 划分使用固定 seed，归一化等预处理只拟合训练集；不得用验证标签生成训练特征。
- 深度学习优先在固定模板中构建小网络。外部权重只能匹配已注册结构和形状，不执行下载的模型代码、自定义层或任意图算子。Attention 等大型概念可用小张量真实计算与来源明确的大模型结果共同解释。
- 远端资料只通过受控导入服务下载并缓存，目标限定到支持的来源 ID/域名且验证重定向；渲染器不接收任意远程 URL。失败时显示资源缺口及已有 fallback。
- 可信运行库/WASM/标准包归应用安装缓存管理，有版本、hash、体积与下载状态；课程包只能声明所需 capability，不能自行附带并安装运行库。首次启用提示所需下载，缓存就绪后标准演示离线可用。

## 6. HTTP API v1

### 6.1 通用返回与幂等

所有接口位于同源 `/api/v1`，JSON 默认为 UTF-8。普通 JSON 请求体上限 64 KiB，草稿确认上限 1 MiB，课程包使用独立流式上传限制。需要生成的接口不等待 CLI 完成，接收成功即返回 202：

```json
{"requestId":"request-example","state":"queued","courseId":"course-example","sessionId":"session-example"}
```

错误响应固定为：

```json
{"error":{"code":"VERSION_CONFLICT","message":"课程已更新，请刷新后重试。","retryable":false,"requestId":"request-example","details":{"expectedRevision":3,"actualRevision":4}}}
```

HTTP 使用 400（结构错误）、401（未连接本地应用）、403（来源/权限不符）、404、409（冲突/忙/事件游标过期）、413（体积超限）、422（业务校验失败）、429（队列已满）、503（CLI 不可用）。模型额度问题在已经受理的任务中表现为失败事件，不伪装成浏览器网络故障。

除一次性引导 token 交换外，所有写操作携带 `clientRequestId`（导入上传放在 multipart 字段中），并按第 4 节去重；涉及修改已有课程元数据、图和内容另传 `expectedRevision`。作答等使用自身的 assignment/cycle 版本，不因无关元数据变更被拒绝。客户端不自行构造 attempt 分数、当前节点状态或 CLI 会话 ID。

### 6.2 路由表

| 方法与路径 | 输入和返回 |
| --- | --- |
| `POST /bootstrap` | 启动器提供的一次性本地 token；换取浏览器会话，详见第 11 节 |
| `GET /runtime` | CLI 路径的显示名、版本、能力状态、最近探针结果；不返回凭证 |
| `GET /capabilities` | 注册的模板/版本、参数与状态 Schema、当前设备限制、所需运行库是否就绪、可用 fallback |
| `POST /demo-runtimes/{id}/prepare` | clientRequestId；用户触发下载应用清单中的固定版本运行库，返回本地准备任务 requestId，不调用 CLI |
| `POST /assets/import` | clientRequestId；上传文件或选择支持的 provider/catalogId，按第 5.8 节验证/缓存，返回 assetId；不接受任意可执行依赖 |
| `POST /runtime/probe` | clientRequestId；用户主动执行短探针，返回 requestId，可通过任务查询获取结果 |
| `GET /courses` | 本地课程摘要与归档状态 |
| `POST /courses` | clientRequestId、topic、goal、profile；创建 draft，201 返回 courseId/revision |
| `PATCH /courses/{id}` | clientRequestId、expectedRevision、允许的元数据或 status；归档不删除数据 |
| `DELETE /courses/{id}` | clientRequestId、expectedRevision、confirm=true；用户确认后删除应用管理的课程数据 |
| `POST /courses/{id}/jobs` | clientRequestId、expectedRevision、kind、payload；kind 是第 5 节结构化任务类型，202 |
| `POST /courses/{id}/drafts/{draftId}/publish` | clientRequestId、expectedRevision；确认规划/重写草稿，校验后返回新 revision |
| `GET /courses/{id}/snapshot?sessionId=...` | 图、进度、当前 session 消息、活动任务和 eventCursor；从一致性读事务取得 |
| `GET /courses/{id}/nodes/{nodeId}/lesson?version=...` | 已发布的 LessonPublic，去除答案键；没有内容则返回 contentStatus，不自动触发模型 |
| `POST /courses/{id}/sessions` | clientRequestId；新建导师 session，201 |
| `POST /sessions/{id}/turns` | 第 6.3 节提问对象，202；服务端验证该 session 的课程归属 |
| `GET /jobs/{requestId}` | 持久化状态、错误、最终资源引用或 probe 结果；可替代 SSE 查询 |
| `POST /jobs/{requestId}/cancel` | clientRequestId；幂等取消，返回最终或取消状态 |
| `GET /events?courseId=...&sessionId=...&after=...` | 第 7 节的 SSE；只返回指定会话事件和该课程的公共领域事件 |
| `POST /nodes/{nodeId}/assignments` | clientRequestId、cycleId、objectiveId；分配可用题目，返回 ExercisePublic；缺题返回 `EXERCISES_REQUIRED` |
| `POST /assignments/{id}/reveal` | clientRequestId、kind(hint/solution)；先记暴露再返回内容 |
| `POST /assignments/{id}/attempts` | clientRequestId、answer；201 返回 attemptId、correct、explanation、progress、diagnosisRequestId? |
| `POST /attempts/{id}/invalidate` | clientRequestId、reason；确认题目有误后将该题版本的相关证据作废并重算，不能改写原答题内容 |
| `POST /nodes/{id}/progress-actions` | clientRequestId、action(start/review/bypass/revoke_bypass)、reason?；按规则开始当前轮或记录绕过 |
| `POST /patches/{id}/revert` | clientRequestId、expectedRevision；受控撤销，返回课程新版本 |
| `PUT /nodes/{id}/notes` | clientRequestId、expectedNoteVersion、text；保存独立笔记版本 |
| `POST /nodes/{id}/demo-snapshots` | clientRequestId、lessonVersion、blockId、模板版本、有限状态与 artifactRefs；保存可复现快照，201 返回 snapshotId |
| `GET /nodes/{id}/demo-snapshots` | 已保存快照摘要；可选 snapshotId 返回已校验的具体状态，恢复前检查模板版本兼容 |
| `POST /courses/{id}/exports` | clientRequestId、mode(content/backup)、format(learn/markdown)；返回本地下载资源 ID |
| `POST /imports/validate` | 流式上传 `.learn`，返回 importId、预览和校验问题；不发布课程 |
| `POST /imports/{id}/commit` | clientRequestId、mode(fresh/restore_copy)；原子创建新课程并返回映射结果 |

探针、导入导出、运行库准备等无 courseId 的任务由 `/jobs/{requestId}` 查询，不强行塞入某一课程 SSE。生成任务 payload 白名单：plan_course 引用课程目标和 profile；generate_lesson/revise_lesson 指定 nodeId 与基准 lessonVersion；generate_exercises 指定 nodeId/cycleId/objectiveId；diagnose 指定本课程当前轮的 attemptIds。不得接受任意 prompt、命令或文件路径作为任务种类。

运行库准备与资源导入是独立的本地任务种类（runtime_prepare/asset_import），只运行应用固定处理器，不能调度 CLI；下载/验证状态复用任务查询但不占 CLI 队列。实际浏览器演示使用 demoRunId，不在 jobs 中伪造一项模型调用。资源上传走单文件 20 MiB 上限及格式数量限制；运行库只按应用清单从固定来源准备，不接受课程或用户传入脚本 URL。

### 6.3 导师提问契约

```json
{
  "clientRequestId": "client-request-example",
  "question": "把高度改成3以后，这个角为什么变化了？",
  "context": {
    "nodeId": "node-example",
    "lessonVersion": 2,
    "blockId": "right-triangle-example",
    "selection": null,
    "componentState": {"templateId": "math.right_triangle", "templateVersion": 1, "runRevision": 3, "parameters": {"width": 4, "height": 3}, "selectedIds": [], "observables": {}},
    "activeAssignmentId": null
  }
}
```

问题最长 2,000 UTF-16 单元；selection 是 null 或 `{text,startOffset,endOffset}`，最多 2,000 单元且必须与对应正文切片相符。组件状态使用该模板专属 Schema。课程标题、学科、正文由服务端按 session 和 node 查询，不相信浏览器任意拼接的“系统上下文”。

提问被受理时创建不可变 contextSnapshot、用户消息、assistant 占位消息与任务，再返回 202。涉及正在作答的 assignment 的导师求助按提示处理：先记录提示暴露，再调用 Agent，避免另一个标签页同时提交获得不应计入的独立分。

## 7. SSE 与前端恢复

### 7.1 事件信封

SSE 的 `id` 是数据库 eventId 的十进制字符串，`event` 是应用事件类型，`data` 为 JSON：

```text
id: 1042
event: message.delta
data: {"protocolVersion":1,"eventId":"1042","requestId":"request-example","sequence":3,"courseId":"course-example","sessionId":"session-example","type":"message.delta","payload":{"messageId":"message-example","text":"角度由两条边的比例决定。"}}

```

`sequence` 在同一 request 内递增，eventId 在全应用递增但过滤后不保证连续；客户端不能因 eventId 不连续就认定丢包。领域更新事件的 sessionId 为 null，发送给该课程订阅者；聊天事件只发给绑定该 session 的订阅者，不广播其他会话正文。

| 事件类型 | payload 与含义 |
| --- | --- |
| `job.accepted` / `job.started` | kind、state、queuePosition?；界面进入等待或运行 |
| `message.delta` | messageId、text；仅更新对应请求的 assistant 预览 |
| `message.final` | messageId、text；原子替换最终消息，不追加全文 |
| `job.validating` | phase；生成已结束，正在本地校验 |
| `course.updated` | revision、changedNodeIds、patchId?；前端按版本刷新，不从聊天文本推测图变化 |
| `progress.updated` | nodeId、cycleId、progress；判分与掌握变更 |
| `job.completed` | resultRef?；最终结果已持久化 |
| `job.failed` | error.code、message、retryable；不含密钥和原始堆栈 |
| `job.cancelled` / `job.interrupted` | reason；终态，保留必要的不完整消息标识 |

每请求只出现一个 `job.completed/failed/cancelled/interrupted` 终态。message.final 与领域事件可以在终态前出现，但都来自同一最终提交事务。SSE 注释心跳每 15 秒发送，不写数据库、不推进游标。

### 7.2 断线与快照

1. 首次打开先读取 snapshot，获得该事务可见状态和 eventCursor，再从 `after=eventCursor` 订阅，避免“查状态与连事件之间”的竞态。
2. 前端使用支持状态码检查的 `fetch` 流式 SSE 解析器，支持跨 chunk 行、多个 data 行和 UTF-8；携带本地会话 Cookie。
3. 接收事件后按 eventId 去重、按 messageId 更新，并保存最后游标。断线采用 1/2/4/8 秒递增、最高 30 秒重连，抖动后继续；不再次 POST 原问题。
4. 服务端先补发游标后的持久化事件再持续推送，不允许切换到实时监听时漏掉中间事件。
5. 普通事件保留 7 天且每课程最多 100,000 条；若超出上限，先压缩已经结束任务的事件为可恢复快照。运行中任务事件不删除。消息、作答、补丁和幂等记录不受此清理影响。
6. 游标早于保留范围返回 `409 EVENT_CURSOR_EXPIRED`；客户端丢弃增量缓存，重新读快照并继续订阅。
7. 单连接发送缓冲超过 1 MiB 时关闭慢连接，让其按游标重连，避免拖垮应用或无界内存增长。

前端以任务终态控制输入锁和停止按钮，首个 delta 只将“等待首字”改为“正在回答”。发送失败保留输入并显示重试；最终错误解除锁。组件卸载只关闭订阅，取消任务必须调用 cancel。

## 8. 教学服务执行规则

### 8.1 作答事务

```text
验证 assignment 属于当前节点/当前 cycle，题目版本可用
  -> 检查幂等键；重复则返回原响应
  -> 校验答案格式，用固定判分器计算 correct
  -> 在事务中读取提示暴露记录、判定本 family 是否已有首答
  -> 写 attempt；若有证据资格且为本家族首答，按 mastery-v1 写 evidenceScore，否则为 null
  -> 重算当前轮各 objective 最近 5 个家族首答和节点状态
  -> 写 progress.updated；提交
  -> 错误时按运行时可用性排入诊断，或记录待诊断状态
```

必须先保存作答，再开展诊断。CLI 不可用、排队已满或诊断失败时，答案和掌握状态不能回滚；界面可手动“继续诊断”。联网恢复不静默把离线积压答案全部提交给模型。

错误首答的 `diagnosisState=pending` 与作答一起保存；入队后更新为 queued 并绑定 diagnosisRequestId。即使进程在判分后、入队前退出，也能在重启后发现待诊断记录，交由用户决定是否继续。

旧 cycle、已作废题目或不匹配版本的提交返回 409 并附当前状态，不按新题判旧答案。点击揭示解析与提交答案通过同一 assignment 的事务顺序决定证据状态，不接受客户端自行声称 `hintUsed=false`。

节点满足全部目标条件时关闭当前轮，记录 `masteredOnce/masteredAt`、安排复习、解锁依赖节点。进入新的验证轮后旧证据仍可查看，但不参与新轮比率。关闭的轮不再接受新作答；达标后选择继续练习等价于显式开始复习轮。题目作废导致达标依据失效时转为 review_due，保留原轮供审计。

### 8.2 诊断与补丁输出

`DiagnosisDraft.nextAction` 为 `hint / reexplain / practice / propose_patch / flag_item`。`errorType` 与 PRD 一致；confidence 是 [0,1] 有限数；attemptIds 必须来自输入给本次诊断的真实记录，禁止模型捏造证据。

`PatchProposal` 必须包含：

| 字段 | 约束 |
| --- | --- |
| targetNodeId、objectiveId、cycleId、remediationEpochId、baseRevision | 必须与任务启动快照相同，提交时还需与当前状态比较 |
| reason、evidenceAttemptIds | 非空理由，至少两个符合重复错误门槛的首答 |
| prerequisiteConceptRefs | 每项为已有 conceptId，或 `{newConceptKey,label}`；新 key 由服务端规范化并对现有概念/别名去重 |
| newNodes | 0～2 个补课节点草稿，使用局部 key；允许复用已有补课节点而不新建 |
| reuseNodeIds | 仅限本课程中适合该概念的节点；不得把目标自己的后继伪装成先修 |
| addedEdges | `{fromRef,toRef}`，引用现有节点或本提案局部 key，至少有一条补课 → 目标依赖 |

提交器不接受任意 JSON Patch、删除节点、执行代码、直接修改成绩等操作。补丁节点仍通过正常内容生成和掌握规则完成，不把标题插入等同于课程内容已生成。

### 8.3 补丁提交算法

1. 在事务外完成结构校验，并加载真实作答，验证 PRD 的“最近 3 家族至少 2 次错误 + prerequisite_gap + confidence>=0.8”。
2. 开启写事务，重新检查课程 revision、当前 cycle/epoch、目标未达标、诊断未作废；重新计算当前最近 3 个家族首答，要求引用的错误仍在窗口且门槛仍成立。过期结果返回 `STALE_DIAGNOSIS`，保留诊断供阅读，不自动插图。
3. 计算该主节点/epoch 已提交补丁数，包含已撤销项；不得超过 2。目标自身为 remedial 时拒绝继续递归补丁。
4. 对每个先修概念检查去重键 `(targetNodeId, remediationEpochId, conceptId)`，已存在则返回已有补丁信息。新概念解析和唯一约束也在事务内完成。
5. 合并现有主线与活动补充依赖，检查端点归属、自环和拓扑排序结果；任何环都拒绝。
6. 写 patch、节点、补充边、目标验证门槛，课程 revision 加一，写 course.updated；一次提交。

补丁的活动边只作用于该目标当前 remediationEpoch 的验证门槛；epoch 达标结束后可关闭这些额外门槛，保留补丁记录和导航关联。补丁完成后主节点开新的 verification cycle，但沿用同一 epoch 的次数与概念去重记录，避免“新一轮就重新获得两次补丁”的无限循环。

撤销是受控业务动作：失活该 patch 的补充边和门槛，归档只由其创建且无其他引用的节点，保留课程修订、作答与原始原因。只撤销自己添加的部分，不回滚整个课程到旧快照。若撤销后主节点已满足规则，重新计算进度；否则保持学习中。

当补丁上限、图校验或诊断证据不满足时，返回可解释原因并提供重讲、练习、暂停或显式跳过；不能通过修改 epoch ID 来绕过限制。只有节点达标后再次复习，才开始新的补课预算阶段。

## 9. 上下文定位与多轮记忆

### 9.1 前端定位

活跃引用按优先级确定：用户显式固定的引用 > 当前有效文本选择 > 最近操作的图形/题目 > IntersectionObserver 判断的主要可见段落。课程切换时清空旧引用；手动选择优先于滚动变化。

blockId 由 LessonDocument 提供，组件通过标准接口报告白名单语义状态：templateId/version、runRevision、参数、选中对象、可选 step/time/seed 和相关 observables。除三角形/函数外，还需覆盖三维截面、原子/键 ID、反应/生物阶段、算法变量和调用栈、网络报文、训练轮次、张量形状与选中的注意力行。相机位置等不影响题意的显示状态通常不发送。

observables 只代表用户看到的实验结果，须带计算版本和 modelInfo；不能作为服务端掌握度证据。只发送与问题相关的小范围数据，避免把全部原子坐标、数据集或模型权重塞进 prompt。不能仅传“某个 SVG”或“模型 ID”，也不把整个 DOM 发给模型。

提交按钮按下时捕获快照；随后用户拖动图形不改变已发送问题。界面在问题旁显示引用名称和参数摘要，用户可以核对、清除或重新提问。

### 9.2 服务端上下文组装

1. 按 session 查 course，再校验 node、lessonVersion、block 和 assignment 全部属于该课程。
2. 按指定内容版本读取相关目标、正文切片、公式、图形配置；若旧版本存在则按旧版本回答，若不存在返回 `CONTEXT_STALE`，不能偷偷改用最新版。
3. 验证组件参数符合模板取值范围；selection 必须与指定块相符。保存校验后的上下文，不相信浏览器给出的解释性结论。
4. 输入分为固定教学指令、受限的状态事实、被引用的“不可信教材数据”和用户问题。教材/导入内容中的命令性文字不升级为系统指令。
5. 按预算裁剪：固定指令最多 4,000 UTF-16 单元，问题 2,000，当前内容与状态 8,000，恢复历史 6,000；计入 JSON 转义后总参数仍须符合 24,000 上限。先移除较老历史和相邻段落，保留问题、目标及指定图形核心参数；无法保留必需内容则报 `CONTEXT_TOO_LARGE`。

正常续聊显式传 providerConversationId，并在每次提问带上最新已验证内容和进度摘要。CLI 会话失效时，新建 CLI 会话，附带课程目标、当前节点、最近完成消息及本地摘要；界面提示“已重建导师上下文”。数据库消息完整保留，不声称模型无限记忆。

只有成功结束的历史回复参与恢复摘要。失败或取消的半截回复可在界面展示“不完整”，但不作为已确认教学事实。摘要可使用确定性选取和截断，一期不为整理历史额外启动隐藏模型任务。

## 10. 导入导出协议

### 10.1 包结构与 manifest

```text
manifest.json
course.json
lessons/<nodeKey>/<version>.json
chapters/<nodeKey>.md
assets/<sha256>.<extension>
personal/progress.json       # 仅 backup
personal/attempts.json       # 仅 backup，含 cycles/assignments/diagnoses/patch history
personal/notes.json          # 仅 backup
personal/conversations.json  # 仅 backup，含相关上下文快照，不含 providerConversationId
personal/demo-snapshots.json # 仅 backup，明确保存的参数/步骤/seed/结果摘要与资源引用
```

manifest 必填：`format="adaptive-tutor-learn"`、`formatVersion="1.0"`、`exportMode=content|backup`、`exportedAt`、`sourceCourseRevision`、`title`、`files[{path,size,sha256,mime}]`、`generatedNodeKeys`、`notGeneratedNodeKeys`、`requiredCapabilities[{capabilityId,version}]`。files 包含除 manifest 自身外的全部文件，禁止额外未声明文件。哈希用于检测损坏，不证明作者身份。

course.json 包含规范化课程元数据、概念、节点、主线依赖、内容版本索引。content 模式移除学习者 profile 中的个人背景/目标日期、所有个人记录及由作答产生的诊断理由；保留通用课程目标、语言和教学内容。分享中的补课内容保留为可选资源节点，移除个人 epoch/cycle 门槛，不让他人的补课历史限制新学习者。

backup 模式另保存原始补丁历史、个人资料和学习状态，便于完整恢复；两种模式都不导出登录凭证、CLI 全局配置、机器绝对路径、正在运行任务或可续用的 CLI 会话标识。

backup 必须携带作答、笔记、上下文引用到的全部历史 lesson/exercise 版本及其资源，不能只导出最新正文。导出预览还应提示个性化正文可能包含学习者主动透露的信息；去掉个人数据表并不能自动保证自由文本匿名。

### 10.2 校验与导入事务

- 压缩文件最多 100 MiB，解压总量最多 500 MiB、单文件最多 20 MiB、条目最多 10,000、单条目压缩比最多 100:1；流式计算实际解压量，不能只相信 ZIP 元数据。
- 拒绝绝对路径、盘符、`..`、UNC 路径、反斜杠逃逸、Windows ADS 冒号、符号链接以及归一化后重名文件。检查最终路径仍位于专用暂存目录。
- 使用可逐条限额处理的 ZIP 库读取、写入，不将整个压缩包无界载入浏览器或 Node 内存。所有 JSON 严格校验，正文不执行；资源只接受第 5.8 节格式注册表中的图像、GLB、分子坐标、数据集、GeoJSON 和受限权重/张量数据，并应用各自数量/解码限制。SVG 由可信本地渲染器重新生成。专用 code_lab 中的源码仅是待显式运行的文本，不允许包安装脚本/运行库/自定义图形组件。
- 校验 manifest、hash、资源 MIME、所有引用、内容版本和 DAG。未知主版本拒绝；旧的已知版本只经显式迁移，不猜字段含义。
- 校验 requiredCapabilities 是否全部已注册且版本可解释。模板未知或版本不兼容时拒绝发布课程并列出缺口；模板已支持但本机运行库/WebGL 暂不可用时允许导入，显示准备状态和可读 fallback，不标为演示已验证。
- validate 阶段生成预览和短期 importId，不创建可见课程；commit 阶段始终新建课程，重映射课程/节点/目标/题目/家族/cycle/assignment/attempt/patch/session/message/demo_snapshot/asset 引用。模板和版本 ID 属于公共注册表，不重写成课程内 UUID。
- fresh 模式丢弃 personal 数据，从 available/locked 状态开始；restore_copy 只允许 backup，恢复相对一致的个人记录并重算进度，到期复习按当前时间显示。
- 源包的供应商会话 ID 即使存在也不采纳，所有恢复的导师 session 下一次都重建 CLI 上下文。
- 文件先移到应用管理的内容寻址资源区，再在单次数据库事务内创建所有引用；失败不出现半门课程。未引用文件由清理器回收，已有其他课程引用的资源不删除。
- 导入成功后与原课程独立；不会覆盖已有记录。暂存导入 24 小时过期，提交幂等结果保留在持久记录中。

### 10.3 导出一致性与降级

导出开始时固定 courseRevision 和所需个人状态的一致性快照；只引用不可变内容版本和已核对 hash 的资源。生成中的节点仍导出为 not_generated。导出不触发模型生成、不把 SSE 预览当正文。

资源没有再分发许可或未能保存时，在预览列出并允许以来源说明/alt 替代；用户确认有缺失时才完成该导出，不能悄悄宣称完整离线包。演示必需的分子坐标、模型纹理、数据集、seed/初始条件、预计算结果和快照资源都必须可追溯；应用的可信 JS/WASM 包不嵌入 `.learn`，由 capability 依赖解析到本地已验证运行库。

Markdown 导出为几何/分子/三维场景生成静态图或多视图、算法/过程导出关键步骤与表格、ML/DL 导出曲线与模型说明，并注明无法保留的交互。不得只丢下一段未知 JSON 让外部编辑器渲染。后续 HTML/PDF 需另定义字体、渲染库和资源的打包清单，一期不承诺实现这些额外交付格式。

## 11. 本地安全与运维边界

### 11.1 浏览器到本地服务

- 单监听地址为 `127.0.0.1`，每次启动生成高熵临时会话秘密；不绑定 LAN，不开启通用 CORS。
- 启动器通过 URL fragment 传一次性引导 token（256 位随机，5 分钟过期，一次消费）。页面读出后立即清除地址栏 fragment，经 `/bootstrap` 交换为 HttpOnly、SameSite=Strict 的本地会话 Cookie。token 不进 query、访问日志或持久化前端存储。
- 校验 Host 为本次确切的回环主机与端口；有 Origin 的请求必须等于应用 origin。除 bootstrap 以单次 token 及来源校验完成引导外，浏览器写操作还需同源 CSRF 令牌；无合法本地会话的业务 API/SSE/课程资源请求均拒绝，公开页面壳不得含学习数据。MCP 使用单独的内部网关与私有凭证，不复用浏览器 Cookie/CSRF 或公开 API 权限。
- 再次打开页面通过本地启动器生成新引导 token；已有同源标签页可共享浏览器会话。应用退出使会话失效。
- GET 不执行状态变更；设置 CSP，脚本只来自本地构建产物，图片与连接限制到必要来源。不得允许任意网页连接 CLI 管道。

### 11.2 CLI 权限边界

应用不读取、复制或导出 CLI 凭证，不把 CLI stderr 和内置工具列表原样暴露给网页。运行状态与权限策略如实显示，不能把 localhost 当作免鉴权理由。

一期面向用户本人已登录的 CLI，继承该 CLI 及当前 OS 用户的权限；没有实现对 CLI 所有内置工具的独立隔离。应用可以控制传入数据和自身数据库写入，但不能仅靠提示词保证 CLI 不访问其他本机资源。安装说明必须明确这一边界，导入外部内容后由用户主动发起 Agent 操作。

所有应用写入仍需领域服务验证，即使 Agent 输出“直接修改状态”也无效。未来若要求不可信课程可自动触发具备文件/命令能力的 Agent，应先增加经验证的工具限制或 OS 隔离，不在一期暗中扩大权限。

### 11.3 日志、备份与资源回收

- 普通日志记录 requestId/runId、状态、耗时、错误代码和版本，滚动保留 7 天，总量最多 50 MiB。
- 原始 stdout/stderr 仅在用户主动开启诊断时短期保存，限长、脱敏，默认不含完整提示和环境变量；报告导出可预览。
- 用户显式“重试”可能再次消耗额度；错误信息要说明是否已经启动 CLI，不伪造精确余额。
- 应用更新迁移数据库前创建一致性备份；禁止直接复制未 checkpoint 的 SQLite 主文件而遗漏 WAL。
- 定期清理无引用 assets、过期导入、已终止 jobs 临时目录，所有删除目标须验证在应用数据目录内；不清理 CLI 自己的数据目录。

## 12. 实现与验证清单

建议模块划分：`contracts`（Schema）、`runtime/antigravity`（CLI）、`mcp`（STDIO 薄适配器）、`data-root`（统一路径）、`jobs`、`events`、`curriculum`、`assessment`、`content`、`storage`、`transfer`、`ui`，以及 `capabilities`（模板注册表）、`renderers`、`compute-kernels`、`demo-runtime`、`code-sandbox`、`assets`。领域规则不得藏在 React 组件、Prompt 或某个 CLI/MCP 适配器里。

| 验证层 | 必须覆盖 | 对应 PRD |
| --- | --- | --- |
| CLI 真实联调 | 指定版本的文本流、续聊、structured_output、非零退出、无 result、取消、超时、权限交互、额度/网络错误 | A01/A02/A13 |
| 原生协议夹具 | UTF-8/JSON 跨 chunk、多个 agent_response 步骤、DONE 非终态、stderr 分离、结构化结果只读最终字段、大小限制 | A02/A13/A14 |
| 教学规则 | 每目标 1/1、2/2、2/3、3/5、4/5；家族首答、提示暴露、作废重算、周期隔离、复习日程 | A04～A09 |
| 数据事务 | 重复提交、同键异文、双标签首答竞态、取消与完成竞态、版本冲突、补丁去重/DAG/跨轮上限 | A08/A10/A15 |
| 事件恢复 | 同会话锁、跨会话过滤、重连去重、snapshot 游标竞态、过期游标、慢连接、应用重启 | A10/A12 |
| 内容与导入 | 无效块、脚本/HTML、错误公式降级、资源断链、ZIP 路径/体积、fresh/backup 往返 | A14/A16/A17 |
| 浏览器端到端 | 创建课程到补课回主线；视口状态固定；离线判分；中文输入法、键盘、窄屏；延迟基准 | A03/A11/A18～A20 |
| 学科覆盖登记 | S01～S22 全部主题对应模板；至少 44 个样例，8 条讲练路径，分别记录科学复核与缺口，不能拿引擎数量当学科覆盖 | A19/A21 |
| 科学内核 | 几何约束/截面、解析导数积分、矩阵参考解、守恒/电路解/步长稳定性、配平、遗传概率、算法不变量 | A22 |
| 演示一致性 | seed/状态/模板版本复现、同一时间轴、晚到结果丢弃、导师局部上下文、保存/恢复、播放不计掌握 | A11/A23 |
| 受限代码 | 三种语言真实运行、输入/输出/超时、Python 桥接、同源与网络访问阻断、无宿主 shell、显式启动与停止 | A17/A24 |
| ML/DL | 训练/验证无泄漏、小模型训练、有限差分梯度、手算卷积、RNN 递推、注意力掩码/归一化；预计算标签与适用参数域 | A25 |
| 全科性能与资源 | 30fps 场景、后台暂停/释放、无 WebGL 降级、分子/GLB/数据集离线往返、依赖缓存、恶意资源与未知模板拒绝 | A26～A28 |
| 数据根与实例管理 | 不同 cwd/检出目录、中文/空格 home、权限/磁盘错误、单写实例、备份资源完整性、清缓存保留课程、Git 无个人数据 | A29 |
| MCP 实际联调 | 注册/作用域、STDIO 协议、读取与保存、最终回执、重复/越界/版本冲突、取消晚到调用、无有效 scope、服务重启和避免嵌套生成 | A30 |

M0 的真实样本应脱敏后保存为测试夹具，记录 CLI 版本、OS、调用参数和观察结果；不包含用户账号、绝对用户路径或凭证。M0 还须完成 MCP 注册与课程草稿联调；M1 验证统一数据根、三维/分子/计算/代码隔离/小网络原型；M2～M4 按 PRD 覆盖学科，M5 完成 A01～A30，均属一期。只有具体的高成本能力符合 PRD 第 1.4 节并登记原因/替代方案时才可后置。

本项目目前仅完成第 2.1 节的 CLI 最小成功路径验证与第 2.4 节所述 MCP 命令帮助查询；统一数据目录、课程 MCP、全科模板和运行库均为实现设计，尚未创建运行数据或完成集成验证，不能据此声称 MCP 课程读写、科学正确性、代码隔离或整个应用已经通过验收。
