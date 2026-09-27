'use client';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { api, command, connect, subscribe } from './api';
import { Demo } from './demo';
import { LessonDemo } from './lesson-demo';
import { capabilities } from '../capabilities/registry';
import { CodeLab } from './code-lab';
import { Training } from './training';
import { ChatProgress } from './chat-progress';
import { TransferControls } from './transfer-controls';
const states: Record<string, string> = {
  locked: '先修未完成',
  available: '可学习',
  learning: '学习中',
  mastered: '已掌握',
  review_due: '待复习',
  queued: '排队中',
  running: '生成中',
  validating: '校验中',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
  completed: '已完成',
};
function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkMath]}
      rehypePlugins={[[rehypeKatex, { trust: false, maxExpand: 1000, throwOnError: false }]]}
      components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}
    >
      {text}
    </ReactMarkdown>
  );
}
export function Studio() {
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [courses, setCourses] = useState<any[]>([]),
    [courseId, setCourseId] = useState(''),
    [snapshot, setSnapshot] = useState<any>(null),
    [nodeId, setNodeId] = useState(''),
    [lesson, setLesson] = useState<any>(null),
    [sessionId, setSessionId] = useState(''),
    [runtime, setRuntime] = useState<any>(null),
    [tab, setTab] = useState<'courses' | 'gallery' | 'settings'>('courses'),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [context, setContext] = useState<any>(null),
    [question, setQuestion] = useState(''),
    [note, setNote] = useState(''),
    [assignment, setAssignment] = useState<any>(null),
    [answer, setAnswer] = useState(''),
    [feedback, setFeedback] = useState<any>(null);
  const mounted = useRef(false);
  const courseRef = useRef(courseId);
  courseRef.current = courseId;
  const nodeRef = useRef(nodeId);
  nodeRef.current = nodeId;
  const run = async (f: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      return await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  async function refreshList() {
    setCourses(await api('/courses'));
  }
  async function deleteCourse(course: any) {
    if (
      !window.confirm(
        `确定删除「${course.title}」吗？\n\n课程内容、学习记录、笔记和导师对话将被删除，无法撤销。已导出的备份文件不会删除。`,
      )
    )
      return;
    await run(async () => {
      try {
        await command(
          `/courses/${course.id}`,
          { expectedRevision: course.revision, confirm: true },
          'DELETE',
        );
        setCourses((items) => items.filter((item) => item.id !== course.id));
      } catch (e) {
        // Refresh stale revisions so the user can review the latest course before retrying.
        await refreshList();
        throw e;
      }
    });
  }
  async function refresh(id = courseId, sid = sessionId) {
    const data = await api(`/courses/${id}/snapshot${sid ? '?sessionId=' + sid : ''}`);
    if (courseRef.current === id)
      setSnapshot((previous: any) =>
        !previous || BigInt(data.eventCursor) >= BigInt(previous.eventCursor) ? data : previous,
      );
    return data;
  }
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    void run(async () => {
      await connect();
      await refreshList();
      setRuntime(await api('/runtime'));
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (!courseId) return;
    setSnapshot(null);
    setNodeId('');
    setLesson(null);
    setContext(null);
    setAssignment(null);
    setSessionId('');
    const controller = new AbortController();
    void run(async () => {
      const sessions = await api(`/courses/${courseId}/sessions`);
      const session = sessions[0] ?? (await command(`/courses/${courseId}/sessions`));
      if (controller.signal.aborted) return;
      setSessionId(session.id);
      const data = await refresh(courseId, session.id);
      if (controller.signal.aborted) return;
      setNodeId(data.nodes[0]?.id ?? '');
      void subscribe(
        courseId,
        session.id,
        data.eventCursor,
        controller.signal,
        (event) => {
          if (event.type === 'session.cleared') {
            setContext(null);
            setQuestion('');
          }
          if (event.type.startsWith('message.'))
            setSnapshot((s: any) =>
              s
                ? {
                    ...s,
                    eventCursor: event.eventId,
                    messages: s.messages.map((m: any) =>
                      m.id === event.payload.messageId
                        ? {
                            ...m,
                            text:
                              event.type === 'message.final'
                                ? event.payload.text
                                : m.text + event.payload.text,
                            status: event.type === 'message.final' ? 'complete' : 'streaming',
                          }
                        : m,
                    ),
                  }
                : s,
            );
          else void refresh(courseId, session.id);
        },
        async () => (await refresh(courseId, session.id)).eventCursor,
      );
    });
    return () => controller.abort();
  }, [courseId]);
  useEffect(() => {
    if (!courseId || !nodeId) return;
    setLesson(null);
    setAssignment(null);
    setFeedback(null);
    setContext(null);
    const current = nodeId;
    void run(async () => {
      const result = await api(`/courses/${courseId}/nodes/${nodeId}/lesson`);
      if (nodeRef.current === current) setLesson(result);
    });
    setNote(snapshot?.notes.find((n: any) => n.id === nodeId)?.text ?? '');
  }, [nodeId, snapshot?.nodes.find((n: any) => n.id === nodeId)?.currentLessonVersion]);
  const node = snapshot?.nodes.find((n: any) => n.id === nodeId),
    progress = snapshot?.progress.find((p: any) => p.id === nodeId),
    activeJobs =
      snapshot?.jobs.filter((j: any) => ['queued', 'running', 'validating'].includes(j.state)) ??
      [];
  async function createJob(kind: string, payload: unknown = {}) {
    await command(`/courses/${courseId}/jobs`, {
      expectedRevision: snapshot.course.revision,
      kind,
      payload,
    });
    await refresh();
  }
  async function nextExercise() {
    let p = progress;
    if (!p?.cycleId || p.status !== 'learning')
      p = await command(`/nodes/${nodeId}/progress-actions`, {
        action: progress?.masteredOnce ? 'review' : 'start',
      });
    const target =
      node.objectives.find((o: any) => !p.objectiveEvidence?.[o.id]?.mastered) ??
      node.objectives[0];
    const a = await command(`/nodes/${nodeId}/assignments`, {
      cycleId: p.cycleId,
      objectiveId: target.id,
    });
    setAssignment(a);
    setFeedback(null);
    setAnswer('');
    await refresh();
  }
  async function submitAnswer() {
    let value: unknown;
    if (assignment.kind === 'numeric') value = { value: answer, unit: assignment.allowedUnits[0] };
    else if (assignment.kind === 'single_choice') value = { optionId: answer };
    else if (assignment.kind === 'multiple_choice')
      value = { optionIds: answer.split(',').filter(Boolean) };
    else value = { values: JSON.parse(answer) };
    const f = await command(`/assignments/${assignment.assignmentId}/attempts`, { answer: value });
    setFeedback(f);
    await refresh();
  }
  async function ask() {
    if (!question.trim() || !node || !lesson?.lessonVersion) return;
    await command(`/sessions/${sessionId}/turns`, {
      question,
      context: {
        nodeId,
        lessonVersion: lesson.lessonVersion,
        blockId: context?.blockId ?? null,
        selection: null,
        componentState: context?.componentState ?? null,
        activeAssignmentId: assignment?.assignmentId ?? null,
      },
    });
    setQuestion('');
    await refresh();
  }
  async function clearChat() {
    if (
      !window.confirm(
        '确定清空导师对话吗？本地消息、提问上下文和执行记录将被删除，无法撤销。下一次提问将从新对话开始。',
      )
    )
      return;
    await run(async () => {
      await command(`/sessions/${sessionId}/clear`, { confirm: true });
      setContext(null);
      setQuestion('');
      await refresh();
    });
  }
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          知序<span>学习工作室</span>
        </a>
        <nav>
          {(
            [
              ['courses', '我的学习'],
              ['gallery', '实验室'],
              ['settings', '环境设置'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? 'nav-active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <span className="local">
          <i /> 本地保存 · 个人空间
        </span>
      </header>
      {error && (
        <div role="alert" className="alert">
          {error}
          <button onClick={() => setError('')} aria-label="关闭错误">
            ×
          </button>
        </div>
      )}
      {!ready ? (
        <main className="welcome">
          <span className="eyebrow">LOCAL LEARNING STUDIO</span>
          <h1>让理解，循序发生。</h1>
          <p>{error ? '请通过终端启动器打印的引导链接重新连接。' : '正在连接你的本地学习空间…'}</p>
        </main>
      ) : tab === 'settings' ? (
        <main className="page">
          <span className="eyebrow">你的运行环境</span>
          <h1>连接自己的 AI 导师</h1>
          <section className="panel">
            <h2>Antigravity CLI</h2>
            <p>
              检测版本：{runtime?.version ?? '未安装'} · 状态：{runtime?.state ?? '未检测'}
            </p>
            <p>应用使用你的 CLI 登录与额度。不会安装 CLI、接管登录或自动切换付费 API。</p>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const j = await command('/runtime/probe');
                  setRuntime({ ...runtime, probe: { state: '检查中' } });
                  for (let i = 0; i < 190; i++) {
                    const job = await api('/jobs/' + j.requestId);
                    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.state)) {
                      setRuntime({ ...runtime, probe: job.resultRef ?? job.error });
                      return;
                    }
                    await new Promise((r) => setTimeout(r, 1000));
                  }
                })
              }
            >
              运行连通性检查（使用少量额度）
            </button>
            {runtime?.probe && <pre>{JSON.stringify(runtime.probe, null, 2)}</pre>}
            <h3>课程 MCP</h3>
            <p>
              生产构建完成后，在你自己的终端执行下列命令，将占位路径替换为绝对路径。已有同名配置时请先检查，不要覆盖。
            </p>
            <code>
              agy mcp add --type stdio adaptive-tutor &quot;Node绝对路径&quot;
              &quot;应用目录/dist/mcp/stdio.js&quot;
            </code>
            <p className="muted">CLI 继承当前用户权限；plan/sandbox 参数不代表操作系统级隔离。</p>
          </section>
        </main>
      ) : tab === 'gallery' ? (
        <main className="page">
          <span className="eyebrow">在变化中，看见规律</span>
          <h1>交互实验室</h1>
          <p className="muted">
            已实现模板 {capabilities.length} 个。全学科覆盖仍在开发；下列实验可直接在本机运行。
          </p>
          <CodeLab />
          <Training />
          <div className="gallery">
            {capabilities.map((c) => (
              <Demo
                key={c.id}
                block={{
                  blockId: c.id,
                  templateId: c.id,
                  templateVersion: c.version,
                  config: Object.fromEntries(
                    Object.entries(c.parameters).map(([k, v]) => [k, v.value]),
                  ),
                  modelInfo: { mode: c.mode },
                }}
              />
            ))}
          </div>
        </main>
      ) : !courseId ? (
        <main className="page">
          <div className="page-title">
            <div>
              <span className="eyebrow">LEARN AT YOUR OWN PACE</span>
              <h1>今天，想理解什么？</h1>
              <p className="muted">从一个问题出发，把知识连接成自己的体系。</p>
            </div>
            <button className="primary" onClick={() => setCreating(true)}>
              ＋ 创建学习计划
            </button>
          </div>
          <section className="starter">
            <div>
              <span className="eyebrow">无需联网 · 从这里开始</span>
              <h2>看见几何背后的关系</h2>
              <p>三个短章节，一组可操作的图形。用独立练习验证理解。</p>
              <button
                onClick={() =>
                  void run(async () => {
                    const c = await command('/examples/geometry');
                    await refreshList();
                    setCourseId(c.id);
                  })
                }
              >
                打开几何示例 →
              </button>
              <button
                onClick={() =>
                  void run(async () => {
                    const c = await command('/examples/mechanics');
                    await refreshList();
                    setCourseId(c.id);
                  })
                }
              >
                打开力学示例 →
              </button>
            </div>
            <svg viewBox="0 0 260 170" aria-hidden="true">
              <path
                d="M45 140 L220 140 L45 25 Z"
                fill="#b4c7a955"
                stroke="#456950"
                strokeWidth="2"
              />
              <path d="M45 120 H65 V140" fill="none" stroke="#456950" />
              <text x="115" y="162">
                4
              </text>
              <text x="25" y="92">
                3
              </text>
              <text x="140" y="75">
                5
              </text>
            </svg>
          </section>
          <TransferControls
            onError={setError}
            onImported={(id) => {
              void refreshList();
              setCourseId(id);
            }}
          />
          <h2 className="section-title">
            我的课程 <small>{courses.length}</small>
          </h2>
          <div className="course-grid">
            {courses.map((c) => (
              <article className="course-card" key={c.id}>
                <button className="course-open" onClick={() => setCourseId(c.id)}>
                  <span className="badge">
                    {c.status === 'draft'
                      ? '待规划'
                      : c.status === 'archived'
                        ? '已归档'
                        : '学习计划'}
                  </span>
                  <h3>{c.title}</h3>
                  <p>{c.goal}</p>
                  <span className="muted">进入学习 →</span>
                </button>
                <div className="course-actions">
                  <button
                    className="course-delete"
                    disabled={busy}
                    aria-label={`删除课程：${c.title}`}
                    onClick={() => void deleteCourse(c)}
                  >
                    删除课程
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!courses.length && (
            <p className="empty">你的课程会保存在这台电脑上。创建计划或打开示例，开始第一步。</p>
          )}
        </main>
      ) : (
        <div className="workspace">
          <aside className="outline">
            <button
              className="link"
              onClick={() => {
                setCourseId('');
                void refreshList();
              }}
            >
              ← 所有课程
            </button>
            <h2>{snapshot?.course.title ?? '加载中'}</h2>
            <p className="muted">知识路径</p>
            {snapshot?.nodes.map((n: any, i: number) => {
              const p = snapshot.progress.find((p: any) => p.id === n.id);
              return (
                <button
                  className={'node ' + (nodeId === n.id ? 'selected' : '')}
                  key={n.id}
                  onClick={() => setNodeId(n.id)}
                >
                  <span className="node-number">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    {n.title}
                    <small>
                      {states[p?.status]} · {n.estimatedMinutes} 分钟
                    </small>
                  </span>
                </button>
              );
            })}
            <div className="outline-footer">
              <TransferControls courseId={courseId} onError={setError} />
              <p>独立作答，才是理解的证据。</p>
              <button
                className="link"
                onClick={() =>
                  void run(async () => {
                    await command(
                      `/courses/${courseId}`,
                      {
                        expectedRevision: snapshot.course.revision,
                        status: snapshot.course.status === 'archived' ? 'active' : 'archived',
                      },
                      'PATCH',
                    );
                    await refresh();
                  })
                }
              >
                {snapshot?.course.status === 'archived' ? '恢复课程' : '归档课程'}
              </button>
            </div>
          </aside>
          <main className="lesson">
            {snapshot && !snapshot.nodes.length ? (
              <>
                <span className="eyebrow">第一步 · 确认学习路径</span>
                <h1>{snapshot.course.title}</h1>
                <p>{snapshot.course.goal}</p>
                <button
                  className="primary"
                  disabled={busy || activeJobs.length > 0}
                  onClick={() => void run(() => createJob('plan_course'))}
                >
                  生成大纲
                </button>
              </>
            ) : (
              node && (
                <>
                  <div className="lesson-meta">
                    <span>
                      {states[progress?.status]} / {node.estimatedMinutes} 分钟
                    </span>
                    <span>章节 {snapshot.nodes.indexOf(node) + 1}</span>
                  </div>
                  <h1>{node.title}</h1>
                  <p className="lead">
                    {node.objectives.map((o: any) => o.description).join(' · ')}
                  </p>
                  {lesson?.blocks ? (
                    lesson.blocks.map((b: any) => (
                      <div
                        key={b.blockId}
                        className={
                          'lesson-block ' + (context?.blockId === b.blockId ? 'referenced' : '')
                        }
                      >
                        {b.type === 'markdown' ? (
                          <div
                            onClick={() =>
                              setContext({
                                blockId: b.blockId,
                                label:
                                  b.role === 'goal'
                                    ? '学习目标'
                                    : b.role === 'recap'
                                      ? '知识回顾'
                                      : '正文段落',
                              })
                            }
                          >
                            <Markdown text={b.text} />
                            <button
                              className="cite"
                              onClick={() => setContext({ blockId: b.blockId, label: '正文段落' })}
                            >
                              引用提问 ↗
                            </button>
                          </div>
                        ) : b.type === 'exercise_ref' ? null : (
                          <LessonDemo
                            key={`${nodeId}:${lesson.lessonVersion}:${b.blockId}`}
                            nodeId={nodeId}
                            lessonVersion={lesson.lessonVersion}
                            block={b}
                            onContext={(state) =>
                              setContext({
                                blockId: b.blockId,
                                label: '实验 · ' + b.templateId,
                                componentState: state,
                              })
                            }
                          />
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="empty">
                      <p>这一节还没有生成内容。</p>
                      <button
                        disabled={busy || activeJobs.length > 0}
                        onClick={() => void run(() => createJob('generate_lesson', { nodeId }))}
                      >
                        生成这一节
                      </button>
                    </div>
                  )}
                  {progress?.status === 'locked' && (
                    <div className="callout">
                      <p>建议先完成先修章节，也可以明确选择先继续；绕过不会产生掌握证据。</p>
                      <button
                        onClick={() =>
                          void run(async () => {
                            await command(`/nodes/${nodeId}/progress-actions`, {
                              action: 'bypass',
                              reason: '用户选择先继续',
                            });
                            await refresh();
                          })
                        }
                      >
                        先继续
                      </button>
                    </div>
                  )}
                  {lesson?.blocks && (
                    <section className="practice">
                      <span className="eyebrow">检查你的理解</span>
                      <h2>用一道题，连接刚学到的知识</h2>
                      {progress?.objectiveEvidence &&
                        Object.entries(progress.objectiveEvidence).map(([key, v]: any) => (
                          <p key={key}>
                            独立作答证据 {v.score}/{v.n} {v.mastered ? '✓ 达标' : ''}
                          </p>
                        ))}
                      {assignment ? (
                        <>
                          <Markdown text={assignment.prompt} />
                          {assignment.options ? (
                            <div className="choices">
                              {assignment.options.map((o: any) => (
                                <label key={o.id}>
                                  <input
                                    type={
                                      assignment.kind === 'multiple_choice' ? 'checkbox' : 'radio'
                                    }
                                    name="answer"
                                    checked={answer.split(',').includes(o.id)}
                                    onChange={(e) =>
                                      setAnswer(
                                        assignment.kind === 'multiple_choice'
                                          ? (e.target.checked
                                              ? [...answer.split(',').filter(Boolean), o.id]
                                              : answer.split(',').filter((x) => x !== o.id)
                                            ).join(',')
                                          : o.id,
                                      )
                                    }
                                  />
                                  {o.label}
                                </label>
                              ))}
                            </div>
                          ) : (
                            <input
                              aria-label="你的答案"
                              value={answer}
                              onChange={(e) => setAnswer(e.target.value)}
                              placeholder={
                                assignment.kind === 'parameter' ? '参数 JSON' : '输入数值'
                              }
                            />
                          )}
                          <div className="toolbar">
                            <button
                              className="primary"
                              disabled={busy || !!feedback?.attemptId}
                              onClick={() => void run(submitAnswer)}
                            >
                              提交答案
                            </button>
                            <button
                              disabled={busy || !!feedback?.attemptId}
                              onClick={() =>
                                void run(async () => {
                                  const result = await command(
                                    `/assignments/${assignment.assignmentId}/reveal`,
                                    { kind: 'hint' },
                                  );
                                  setFeedback({ hint: true, explanation: result.text });
                                })
                              }
                            >
                              查看解析（不计独立证据）
                            </button>
                          </div>
                          {feedback && (
                            <div className="feedback">
                              <strong>
                                {feedback.hint
                                  ? '已查看解析'
                                  : feedback.correct
                                    ? '本次答对'
                                    : '再想一想'}
                              </strong>
                              <p>{feedback.explanation}</p>
                              {feedback.attemptId && !feedback.correct && (
                                <button
                                  onClick={() =>
                                    void run(() =>
                                      command(`/attempts/${feedback.attemptId}/diagnose`),
                                    )
                                  }
                                >
                                  继续错因诊断（需要联网）
                                </button>
                              )}
                              {feedback.attemptId && (
                                <button
                                  className="link"
                                  onClick={() =>
                                    void run(async () => {
                                      await command(`/attempts/${feedback.attemptId}/invalidate`, {
                                        reason: '学习者标记答案有争议',
                                      });
                                      await refresh();
                                    })
                                  }
                                >
                                  题目有误，排除证据
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      ) : null}
                      <button
                        className="link"
                        disabled={busy}
                        onClick={() => void run(nextExercise)}
                      >
                        {assignment
                          ? '下一道独立练习 →'
                          : progress?.status === 'mastered'
                            ? '开始新一轮复习 →'
                            : '开始练习 →'}
                      </button>
                    </section>
                  )}
                  <section className="diagnoses">
                    {snapshot?.diagnoses
                      ?.filter((d: any) => d.nodeId === nodeId)
                      .map((d: any) => (
                        <div className="callout" key={d.id}>
                          <h3>错因诊断</h3>
                          <p>{d.explanation}</p>
                          {d.patchError && <p>{d.patchError.message}</p>}
                        </div>
                      ))}
                    {snapshot?.patches
                      ?.filter((p: any) => p.targetNodeId === nodeId && p.status === 'applied')
                      .map((p: any) => (
                        <div className="callout" key={p.id}>
                          <p>补课建议：{p.proposal.reason}</p>
                          <button
                            onClick={() =>
                              void run(async () => {
                                await command(`/patches/${p.id}/revert`, {
                                  expectedRevision: snapshot.course.revision,
                                });
                                await refresh();
                              })
                            }
                          >
                            撤销补课（保留历史）
                          </button>
                        </div>
                      ))}
                  </section>
                  <section className="notes">
                    <h3>我的理解笔记</h3>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="用自己的话，记录你理解的内容…"
                    />
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await command(
                            `/nodes/${nodeId}/notes`,
                            {
                              expectedNoteVersion:
                                snapshot.notes.find((n: any) => n.id === nodeId)?.version ?? 0,
                              text: note,
                            },
                            'PUT',
                          );
                          await refresh();
                        })
                      }
                    >
                      保存笔记
                    </button>
                  </section>
                </>
              )
            )}
            {snapshot?.drafts.map((d: any) => (
              <section className="panel" key={d.id}>
                <h2>待确认：{d.payload.title ?? d.kind}</h2>
                {d.payload.nodes ? (
                  <ol>
                    {d.payload.nodes.map((n: any) => (
                      <li key={n.key}>
                        {n.title} · {n.estimatedMinutes} 分钟
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>正文重写已生成。确认后发布新版本。</p>
                )}
                <button
                  className="primary"
                  onClick={() =>
                    void run(async () => {
                      await command(`/courses/${courseId}/drafts/${d.id}/publish`, {
                        expectedRevision: snapshot.course.revision,
                      });
                      const updated = await refresh();
                      setNodeId(updated.nodes[0]?.id ?? '');
                    })
                  }
                >
                  确认并发布
                </button>
              </section>
            ))}
            {snapshot?.jobs
              .filter((j: any) => j.kind !== 'chat')
              .slice(-3)
              .map((j: any) => (
                <div className="job" key={j.id}>
                  {states[j.state]}：{j.kind}
                  {j.error && <span> · {j.error.message}</span>}
                  {['queued', 'running', 'validating'].includes(j.state) && (
                    <button onClick={() => void run(() => command(`/jobs/${j.id}/cancel`))}>
                      取消
                    </button>
                  )}
                </div>
              ))}
          </main>
          <aside className="tutor">
            <div className="tutor-title">
              <span className="avatar">知</span>
              <div>
                <h3>学习导师</h3>
                <small>陪你把问题想明白</small>
              </div>
              <button
                className="clear-chat"
                disabled={
                  busy ||
                  !sessionId ||
                  !snapshot?.messages.length ||
                  activeJobs.some((j: any) => j.sessionId === sessionId)
                }
                title="清空对话；运行中请先停止回复"
                onClick={() => void clearChat()}
              >
                清空对话
              </button>
            </div>
            <div className="chat-history">
              {snapshot?.messages.length ? (
                snapshot.messages.map((m: any) => {
                  const job = snapshot.jobs.find((j: any) => j.id === m.requestId);
                  const status =
                    m.role === 'assistant' &&
                    ['failed', 'cancelled', 'interrupted'].includes(job?.state)
                      ? job.state
                      : m.status;
                  const stopped = ['failed', 'cancelled', 'interrupted'].includes(status);
                  const notice =
                    status === 'failed'
                      ? (job?.error?.message ?? '回复失败，请重新发送')
                      : status === 'cancelled'
                        ? '回复已取消'
                        : status === 'interrupted'
                          ? '回复已中断，请重新发送'
                          : job?.state === 'queued'
                            ? '已排队，等待当前任务结束…'
                            : '导师正在回复…';
                  return (
                    <div key={m.id} className={'message ' + m.role}>
                      <small>
                        {m.role === 'user' ? '你' : '导师'}
                        {status !== 'complete' ? ' · ' + (states[status] ?? '回复中') : ''}
                      </small>
                      {m.role === 'assistant' && job && <ChatProgress job={job} />}
                      {m.text && <Markdown text={m.text} />}
                      {(!m.text || stopped) && (
                        <p role={stopped ? 'status' : undefined}>{notice}</p>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="chat-empty">
                  <span>✦</span>
                  <h3>从「为什么」开始</h3>
                  <p>点击正文或操作实验，再提问。导师会看到你提交时引用的内容。</p>
                </div>
              )}
              {snapshot?.jobs
                .filter((j: any) => j.sessionId === sessionId && j.error)
                .slice(-1)
                .map((j: any) => (
                  <p className="alert" key={j.id}>
                    {j.error.message}
                  </p>
                ))}
            </div>
            <div className="composer">
              {context && (
                <div className="context-pill">
                  引用：{context.label}
                  <button onClick={() => setContext(null)} aria-label="清除引用">
                    ×
                  </button>
                </div>
              )}
              <textarea
                value={question}
                maxLength={2000}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="这一段，我还有些疑问…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void run(ask);
                  }
                }}
              />
              <div className="toolbar">
                <small>Shift + Enter 换行</small>
                {activeJobs.find((j: any) => j.sessionId === sessionId) ? (
                  <button
                    onClick={() =>
                      void run(() =>
                        command(
                          `/jobs/${activeJobs.find((j: any) => j.sessionId === sessionId).id}/cancel`,
                        ),
                      )
                    }
                  >
                    停止
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={busy || !node || !question.trim()}
                    onClick={() => void run(ask)}
                  >
                    发送 ↑
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
      {creating && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="创建学习计划">
            <button className="modal-close" onClick={() => setCreating(false)} aria-label="关闭">
              ×
            </button>
            <span className="eyebrow">从你的目标出发</span>
            <h2>创建学习计划</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void run(async () => {
                  const c = await command('/courses', {
                    topic: data.get('topic'),
                    goal: data.get('goal'),
                    profile: {
                      background: data.get('background'),
                      weeklyMinutes: Number(data.get('minutes')),
                      language: '中文',
                    },
                  });
                  setCreating(false);
                  await refreshList();
                  setCourseId(c.id);
                });
              }}
            >
              <label>
                想学什么？
                <input name="topic" required maxLength={200} placeholder="例如：从零理解线性代数" />
              </label>
              <label>
                希望做到什么？
                <textarea
                  name="goal"
                  required
                  maxLength={2000}
                  placeholder="具体的学习目标，让计划更贴合你"
                />
              </label>
              <label>
                已有基础
                <input name="background" defaultValue="" maxLength={4000} />
              </label>
              <label>
                每周可投入分钟数
                <input
                  name="minutes"
                  type="number"
                  min="1"
                  max="10080"
                  defaultValue="120"
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                创建计划 →
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
