# EDM 教学与 Ableton Live 12

首页选择「EDM 从零开始」或四条曲风路径；实验室也可单独打开六个音乐实验。基础课程以 Live 12 Standard 共有设备为准，Wavetable、Operator、Meld、Roar、Max for Live 明确标为 Suite 扩展。吉他、麦克风拾音、浏览器 DAW 和自动读取 Live 工程不属于本版。

## 学习路径

共同基础：节拍音阶 → 和弦旋律 → 鼓与律动 → 合成音色 → 编排 → 混音。

Big Room、Progressive House、Melbourne Bounce、DnB 各有「节奏与动机」「音色与混音」「段落与成曲」三个节点，共 18 个节点。每节点含目标、解释、例题、交互、Live 操作卡、实践任务、复盘与三个题目家族。作品审美与成曲质量使用自评和导师讨论，不用演奏匹配分代替。

点击「启用声音」解锁浏览器音频。鼠标/触屏操作琴键或鼓垫；先让音乐实验获得焦点，再用 A W S E D F T G Y H U J K 演奏 C4–C5。MIDI 连接由用户主动请求，不请求 SysEx；通道 10 按鼓映射处理，其余为音高输入。支持 CC64 延音。失焦、切课、离屏、设备断连会停止发声；正式练习需重开。

Live 的 C3、本平台的 C4 和 VCSL 文件名 C3 均可指 MIDI 60；实际声音不因此移调。五线谱按声部分行、量化到十六分音符，展示休止与延音线；简谱列出首调音级、起音拍位和时值，卷帘显示实际门限和 Swing。默认 1=C4；小调采用相对主音的变化音级表达。

## 音频与资源

声音与画面共享 AudioContext 时钟；25 ms 调度间隔、120 ms 前瞻，requestAnimationFrame 只绘图。钢琴、底鼓、军鼓、踩镲来自 VCSL，源码固定提交为 `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`，CC0。七个约 1.8 MB 的本地 WAV 保留源 SHA-256 和加工后 SHA-256。声源采用单声道 PCM16、峰值归一化、截尾淡出；它是教学采样集，不声称具备完整商业钢琴的速度层与共鸣。

电子声源用 Web Audio 振荡器、滤波与包络；EQ、压缩、声像、混响发送、延迟发送实际处理声音。侧链 AudioWorklet 有独立底鼓检测输入及 attack/release 平滑，不使用与声音无关的预制动画。编排轨道时间线显示各小节的声部密度；Build-up 滤波自动化使用共享的拍位控制点，实际调度滤波频率，并随 MIDI 速度换算时间。LFO 指示器读取实际调制信号。RMS 匹配是短时试听辅助，不是 LUFS 母带测量。

`pnpm music:prepare` 可从固定提交重新准备资源；下载使用同提交的 jsDelivr 镜像，已有清单要求源 hash 一致。`pnpm music:verify` 和生产构建校验本地资源。静态导出、便携包都携带 `music/` 目录及 CC0 许可，不在运行时访问 CDN。VexFlow 5 的 Bravura/Academico 字体随前端包内嵌，SIL OFL 许可一并存放在 music/ 中；CSP 仅为内嵌字体允许 font-src data:。

下载 MIDI 为 SMF 1，包含 Tempo 与按乐器命名的独立轨道。底鼓、军鼓、踩镲采样可单独下载，用于 Live Drum Rack。下载 WAV 是**干声教学素材**，不包含混音效果或完整 Live 工程。采样采用内置银行 `vcsl-1`；音乐课程 `.learn` 通过模板与银行版本复现，不开启任意外部音频资源导入。

## 评分与存储

`music_lab` 是声明式模板，配置由 Zod 严格校验，最多编辑 64 音符的四小节片段。内置编排示例展开为十六小节。音乐快照继续绑定课程、正文版本、blockId 和模板版本；step 为十六分音符位置。导师观测由服务端重新计算，不信任客户端自行声明的结果。导师只收到当前小节、最多八个选中音符、音色/效果参数与最近三次演奏评分摘要，完整音符及作答事件不放入提示词。

`music_performance` 在现有 assignment/attempt 流程中记录起音事件。服务端按音高/鼓件一对一匹配，窗口为四分之一拍且限制 60–150 ms；匹配数除以预期与实际数量的较大值，达到 80% 为通过。力度、时值描述但不参与首版正确性判定。输入补偿范围 -250～250 ms；正式录制时锁定。中断不会形成可提交答案；试听示范先标记 hint，不能算独立作答证据。

## 验证边界

自动化覆盖音高、转位、调制/节奏数据、正式判分、课程发布、快照校验、导出与课程包往返；Edge 端到端检查实际音频输出、AudioWorklet 侧链、谱面与生命周期。

实体 MIDI 键盘/电子鼓的端到端延迟、音箱/耳机的主观音色、Live 12 Standard/Suite 逐课人工复现需要相应设备和已安装的软件。本次不将模拟 MIDI、波形分析或官方手册核对冒充硬件及 Live 实测。

资源来源：[VCSL](https://github.com/sgossner/VCSL)。DAW 来源：[Live 12 手册](https://www.ableton.com/en/manual/welcome-to-live/)、[版本对比](https://www.ableton.com/en/live/compare-editions/)。内置课程来源状态仍遵循平台的 suggested/verified 规则。

## 本次验证记录（2026-10-13）

环境：Windows 11 build 26200，Microsoft Edge（Playwright channel: msedge），Node 24.19.0、pnpm 11.19.0。

| 检查 | 结果 |
| --- | --- |
| pnpm typecheck | 通过；最终生产构建也完成 TypeScript 检查 |
| pnpm test | 16 个文件、175 项测试通过 |
| pnpm test:e2e | 15 项通过，含 6 项音乐专项及 9 项原功能回归 |
| pnpm build | 通过；采样 SHA-256 校验、静态前端、服务和 MCP 构建完成 |
| git diff --check | 通过 |
| pnpm verify:coverage | 按既有脚本返回 1：总体 phase-1 尚未验收。当前 7 条三节点以上路径（音乐 5 条），24 个课程绑定演示；总体目标 13 / 50，音乐不替代原科学覆盖要求 |

音乐专项实际运行 Web Audio，验证滤波衰减、EQ 响应、压缩增益衰减、LFO 信号及独立触发的侧链，另验证停止后立即重开没有旧混响尾音。模拟 MIDI 检查和弦、note-on 零力度、CC64、断连；拒绝 MIDI 权限和损坏采样都有明确反馈。谱面字体随包离线加载，并已查看截图核对字形及布局。正式题验证中断重来与服务端判分；单元测试覆盖提示对证据的影响、错误/漏音/多弹、时间窗、延迟补偿和带个人记录的课程包往返。

本次未重新生成或验证 Windows ZIP。发行脚本固定要求 Node 24.10.0 / pnpm 11.25.0，当前环境版本不同；现有打包流程复制整个 out/，其中已含音乐采样、Worklet 和字体许可。正式发行仍需在固定工具链下执行 package:win 与 verify:portable。

人工验收仍待进行：用实体 MIDI 键盘/电子鼓检查端到端延迟、踏板与实际热插拔；用耳机/音箱试听；在 Live 12 Standard 逐课复现并另查 Suite 扩展。以上未通过模拟输入或官方手册核对替代。
