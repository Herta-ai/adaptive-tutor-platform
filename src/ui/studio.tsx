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
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import {
  BookOpen,
  FlaskConical,
  Settings,
  Plus,
  ArrowLeft,
  Send,
  Square,
  Trash2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  FileCheck2,
  Sparkles,
  Layers,
  ChevronRight,
  Clock,
  BookMarked,
  X,
} from 'lucide-react';

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
    [feedback, setFeedback] = useState<any>(null),
    [tutorWidth, setTutorWidth] = useState<number>(360),
    [isDragging, setIsDragging] = useState(false);

  const mounted = useRef(false);
  const courseRef = useRef(courseId);
  courseRef.current = courseId;
  const nodeRef = useRef(nodeId);
  nodeRef.current = nodeId;
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const tutorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('adaptive-tutor:sidebar-width');
      if (saved) {
        const val = parseInt(saved, 10);
        const maxW = Math.max(280, Math.min(800, window.innerWidth - 680));
        if (!isNaN(val)) {
          setTutorWidth(Math.min(maxW, Math.max(280, val)));
        }
      }
    } catch {}

    const onWindowResize = () => {
      const maxW = Math.max(280, Math.min(800, window.innerWidth - 680));
      setTutorWidth((w) => (w > maxW ? maxW : w));
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  const handleResizePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const tutorEl = tutorRef.current;
    const workspaceEl = workspaceRef.current;
    if (!tutorEl || !workspaceEl) return;

    const rightEdge = tutorEl.getBoundingClientRect().right;
    let latestWidth = tutorEl.getBoundingClientRect().width;

    setIsDragging(true);

    const onPointerMove = (ev: PointerEvent) => {
      const minW = 280;
      const maxW = Math.max(minW, Math.min(800, window.innerWidth - 680));
      const rawWidth = rightEdge - ev.clientX;
      const clamped = Math.min(maxW, Math.max(minW, Math.round(rawWidth)));
      latestWidth = clamped;
      workspaceEl.style.setProperty('--tutor-width', `${clamped}px`);
    };

    const cleanup = () => {
      setIsDragging(false);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
    };

    const onPointerUp = () => {
      cleanup();
      setTutorWidth(latestWidth);
      try {
        localStorage.setItem('adaptive-tutor:sidebar-width', String(latestWidth));
      } catch {}
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        cleanup();
        workspaceEl.style.setProperty('--tutor-width', `${tutorWidth}px`);
      }
    };

    document.body.style.setProperty('cursor', 'col-resize');
    document.body.style.setProperty('user-select', 'none');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
  };

  const handleResizeDoubleClick = () => {
    const defaultWidth = window.innerWidth >= 1600 ? 370 : 340;
    setTutorWidth(defaultWidth);
    if (workspaceRef.current) {
      workspaceRef.current.style.setProperty('--tutor-width', `${defaultWidth}px`);
    }
    try {
      localStorage.setItem('adaptive-tutor:sidebar-width', String(defaultWidth));
    } catch {}
  };

  const handleResizeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const minW = 280;
      const maxW = Math.max(minW, Math.min(800, window.innerWidth - 680));
      const delta = e.key === 'ArrowLeft' ? 20 : -20;
      const nextWidth = Math.min(maxW, Math.max(minW, tutorWidth + delta));
      setTutorWidth(nextWidth);
      if (workspaceRef.current) {
        workspaceRef.current.style.setProperty('--tutor-width', `${nextWidth}px`);
      }
      try {
        localStorage.setItem('adaptive-tutor:sidebar-width', String(nextWidth));
      } catch {}
    }
  };

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
    <div className="shell min-h-screen bg-background text-foreground flex flex-col">
      <header className="topbar">
        <a className="brand" href="/">
          知序<span>学习工作室</span>
        </a>
        <nav className="flex items-center gap-1 bg-secondary/60 p-1 rounded-xl border border-border/60">
          {(
            [
              ['courses', '我的学习', BookOpen],
              ['gallery', '实验室', FlaskConical],
              ['settings', '环境设置', Settings],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                tab === id
                  ? 'bg-card text-foreground shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab(id)}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </nav>
        <span className="local">
          <i /> 本地保存 · 个人空间
        </span>
      </header>

      {error && (
        <div
          role="alert"
          className="alert fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[calc(100%-2rem)] shadow-paper-lg rounded-xl border border-amber-300 bg-[#fff9f2] text-[#9c5c2d] px-5 py-3 flex items-center justify-between gap-3 text-xs animate-in slide-in-from-top-3 duration-200"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="font-medium text-foreground">{error}</span>
          </div>
          <button
            onClick={() => setError('')}
            aria-label="关闭错误"
            className="rounded-md p-1 hover:bg-amber-200/50 text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-base leading-none"
          >
            ×
          </button>
        </div>
      )}

      {!ready ? (
        <main className="welcome flex-1 flex flex-col justify-center items-center text-center p-12">
          <span className="eyebrow">LOCAL LEARNING STUDIO</span>
          <h1 className="text-3xl font-serif text-foreground font-normal mb-3">让理解，循序发生。</h1>
          <p className="text-sm text-muted-foreground max-w-md">
            {error ? '请通过终端启动器打印的引导链接重新连接。' : '正在连接你的本地学习空间…'}
          </p>
        </main>
      ) : tab === 'settings' ? (
        <main className="page">
          <span className="eyebrow">你的运行环境</span>
          <h1 className="font-serif">连接自己的 AI 导师</h1>
          <section className="panel rounded-2xl border border-border bg-card p-6 my-6 shadow-paper">
            <h2 className="text-lg font-serif mb-2">Antigravity CLI</h2>
            <div className="flex items-center gap-3 my-2 text-xs">
              <span className="text-muted-foreground">检测版本：{runtime?.version ?? '未安装'}</span>
              <span>·</span>
              <span className="text-muted-foreground">状态：{runtime?.state ?? '未检测'}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              应用使用你的 CLI 登录与额度。不会安装 CLI、接管登录或自动切换付费 API。
            </p>
            <Button
              disabled={busy}
              size="sm"
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
            </Button>
            {runtime?.probe && (
              <pre className="mt-4 p-3 bg-secondary rounded-xl text-xs font-mono overflow-auto max-h-60">
                {JSON.stringify(runtime.probe, null, 2)}
              </pre>
            )}

            <div className="mt-8 pt-6 border-t border-border">
              <h3 className="text-base font-serif mb-2">课程 MCP</h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                在 PowerShell 中执行下列本机注册命令。已有同名配置时请先检查，不要覆盖；移动程序目录后需要重新注册。
              </p>
              <code className="block p-3 rounded-xl bg-secondary text-xs font-mono text-foreground break-all mb-3">
                {runtime?.mcpRegistration ?? '正在读取本机注册路径…'}
              </code>
              <p className="text-xs text-muted-foreground mb-1">
                便携版未检测到 agy 时，可在程序目录 portable-settings.json 中填写 agyPath，保存后重启。
              </p>
              <p className="text-xs text-muted-foreground/75">
                CLI 继承当前用户权限；plan/sandbox 参数不代表操作系统级隔离。
              </p>
            </div>
          </section>
        </main>
      ) : tab === 'gallery' ? (
        <main className="page">
          <span className="eyebrow">在变化中，看见规律</span>
          <h1 className="font-serif">交互实验室</h1>
          <p className="muted text-xs text-muted-foreground mb-6">
            已实现模板 {capabilities.length} 个。全学科覆盖仍在开发；下列实验可直接在本机运行。
          </p>
          <CodeLab />
          <Training />
          <div className="gallery mt-6">
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
              <h1 className="font-serif">今天，想理解什么？</h1>
              <p className="muted text-xs text-muted-foreground">从一个问题出发，把知识连接成自己的体系。</p>
            </div>
            <Button className="gap-1.5" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              创建学习计划
            </Button>
          </div>

          <section className="starter">
            <div>
              <span className="eyebrow">无需联网 · 从这里开始</span>
              <h2 className="text-lg font-serif mb-1">看见几何背后的关系</h2>
              <p className="text-xs text-muted-foreground max-w-sm mb-4">
                三个短章节，一组可操作的图形。用独立练习验证理解。
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void run(async () => {
                      const c = await command('/examples/geometry');
                      await refreshList();
                      setCourseId(c.id);
                    })
                  }
                >
                  打开几何示例 →
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void run(async () => {
                      const c = await command('/examples/mechanics');
                      await refreshList();
                      setCourseId(c.id);
                    })
                  }
                >
                  打开力学示例 →
                </Button>
              </div>
            </div>
            <svg viewBox="0 0 260 170" aria-hidden="true">
              <path
                d="M45 140 L220 140 L45 25 Z"
                fill="#b4c7a944"
                stroke="#34654e"
                strokeWidth="2"
              />
              <path d="M45 120 H65 V140" fill="none" stroke="#34654e" />
              <text x="115" y="162" fill="#203027" fontSize="13">
                4
              </text>
              <text x="25" y="92" fill="#203027" fontSize="13">
                3
              </text>
              <text x="140" y="75" fill="#203027" fontSize="13">
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

          <h2 className="section-title text-base font-semibold flex items-center gap-2 mt-8 mb-4">
            我的课程 <small className="text-xs font-normal text-muted-foreground">{courses.length}</small>
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
                  <h3 className="font-serif text-base font-semibold mt-4 mb-1 text-foreground">{c.title}</h3>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-4 leading-relaxed">{c.goal}</p>
                  <span className="text-xs text-primary font-medium flex items-center gap-1">
                    进入学习 →
                  </span>
                </button>
                <div className="course-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    className="course-delete text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                    disabled={busy}
                    aria-label={`删除课程：${c.title}`}
                    onClick={() => void deleteCourse(c)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    删除课程
                  </Button>
                </div>
              </article>
            ))}
          </div>

          {!courses.length && (
            <p className="empty text-xs text-muted-foreground my-8">你的课程会保存在这台电脑上。创建计划或打开示例，开始第一步。</p>
          )}
        </main>
      ) : (
        <div
          ref={workspaceRef}
          className="workspace"
          style={{ '--tutor-width': `${tutorWidth}px` } as React.CSSProperties}
        >
          <aside className="outline outline-none">
            <button
              className="link flex items-center gap-1.5 text-xs text-primary hover:underline mb-2 cursor-pointer"
              onClick={() => {
                setCourseId('');
                void refreshList();
              }}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              所有课程
            </button>
            <h2 className="font-serif font-semibold text-foreground">{snapshot?.course.title ?? '加载中'}</h2>
            <p className="muted text-[11px] font-semibold tracking-wider text-muted-foreground">知识路径</p>
            <div className="flex-1 flex flex-col gap-1 overflow-y-auto min-h-0 pr-1">
              {snapshot?.nodes.map((n: any, i: number) => {
                const p = snapshot.progress.find((p: any) => p.id === n.id);
                return (
                  <button
                    className={'node ' + (nodeId === n.id ? 'selected' : '')}
                    key={n.id}
                    onClick={() => setNodeId(n.id)}
                  >
                    <span className="node-number">{String(i + 1).padStart(2, '0')}</span>
                    <span className="flex-1">
                      <span className="block text-xs font-medium text-foreground">{n.title}</span>
                      <small className="block text-[10px] text-muted-foreground mt-0.5">
                        {states[p?.status]} · {n.estimatedMinutes} 分钟
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="outline-footer mt-auto pt-3 border-t border-border shrink-0">
              <TransferControls courseId={courseId} onError={setError} />
              <p className="text-[11px] text-muted-foreground my-2">独立作答，才是理解的证据。</p>
              <button
                className="link text-xs text-primary hover:underline cursor-pointer"
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
                <h1 className="font-serif">{snapshot.course.title}</h1>
                <p className="text-xs text-muted-foreground leading-relaxed my-4">{snapshot.course.goal}</p>
                <Button
                  disabled={busy || activeJobs.length > 0}
                  onClick={() => void run(() => createJob('plan_course'))}
                >
                  生成大纲
                </Button>
              </>
            ) : (
              node && (
                <>
                  <div className="lesson-meta">
                    <span className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[11px]">
                        {states[progress?.status]}
                      </Badge>
                      <span>/ {node.estimatedMinutes} 分钟</span>
                    </span>
                    <span>章节 {snapshot.nodes.indexOf(node) + 1}</span>
                  </div>
                  <h1 className="font-serif text-2xl font-semibold mb-2">{node.title}</h1>
                  <p className="lead text-xs text-muted-foreground leading-relaxed">
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
                            className="cursor-pointer"
                          >
                            <Markdown text={b.text} />
                            <button
                              className="cite"
                              onClick={(e) => {
                                e.stopPropagation();
                                setContext({ blockId: b.blockId, label: '正文段落' });
                              }}
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
                    <div className="empty my-8">
                      <p className="text-xs text-muted-foreground mb-3">这一节还没有生成内容。</p>
                      <Button
                        disabled={busy || activeJobs.length > 0}
                        onClick={() => void run(() => createJob('generate_lesson', { nodeId }))}
                      >
                        生成这一节
                      </Button>
                    </div>
                  )}

                  {progress?.status === 'locked' && (
                    <div className="callout my-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex justify-between items-center">
                      <p className="mb-0">建议先完成先修章节，也可以明确选择先继续；绕过不会产生掌握证据。</p>
                      <Button
                        variant="outline"
                        size="sm"
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
                      </Button>
                    </div>
                  )}

                  {lesson?.blocks && (
                    <section className="practice">
                      <span className="eyebrow">检查你的理解</span>
                      <h2 className="font-serif">用一道题，连接刚学到的知识</h2>
                      {progress?.objectiveEvidence &&
                        Object.entries(progress.objectiveEvidence).map(([key, v]: any) => (
                          <p key={key} className="text-xs text-primary font-medium my-1 flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            独立作答证据 {v.score}/{v.n} {v.mastered ? '✓ 达标' : ''}
                          </p>
                        ))}
                      {assignment ? (
                        <>
                          <div className="my-3 text-xs leading-relaxed">
                            <Markdown text={assignment.prompt} />
                          </div>
                          {assignment.options ? (
                            <div className="choices">
                              {assignment.options.map((o: any) => (
                                <label key={o.id} className="text-xs">
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
                                  <span>{o.label}</span>
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
                              className="w-full max-w-xs h-9 px-3 text-xs rounded-lg border border-input bg-card shadow-sm focus:outline-none focus:ring-1 focus:ring-ring text-foreground my-2"
                            />
                          )}
                          <div className="toolbar flex items-center gap-2 my-3">
                            <Button
                              size="sm"
                              disabled={busy || !!feedback?.attemptId}
                              onClick={() => void run(submitAnswer)}
                            >
                              提交答案
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
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
                            </Button>
                          </div>
                          {feedback && (
                            <div className="feedback">
                              <strong className="block text-xs font-semibold text-foreground mb-1">
                                {feedback.hint
                                  ? '已查看解析'
                                  : feedback.correct
                                    ? '本次答对'
                                    : '再想一想'}
                              </strong>
                              <p className="text-xs text-muted-foreground leading-relaxed">{feedback.explanation}</p>
                              {feedback.attemptId && !feedback.correct && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="mt-2 text-xs"
                                  onClick={() =>
                                    void run(() =>
                                      command(`/attempts/${feedback.attemptId}/diagnose`),
                                    )
                                  }
                                >
                                  继续错因诊断（需要联网）
                                </Button>
                              )}
                              {feedback.attemptId && (
                                <button
                                  className="link block mt-2 text-xs text-primary hover:underline"
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
                        className="link block mt-4 text-xs font-medium text-primary hover:underline cursor-pointer"
                        disabled={busy}
                        onClick={() => void run(nextExercise)}
                      >
                        {assignment
                          ? '下一道独立练习 →'
                          : progress?.status === 'mastered'
                            ? '开始新一轮复习 →'
                            : '开始练习 →'}
                      </button>
                      {error && (
                        <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-2 animate-in fade-in-0">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                            <span>{error}</span>
                          </div>
                          <button
                            onClick={() => setError('')}
                            className="text-amber-700 hover:text-amber-950 font-bold p-1 cursor-pointer"
                            aria-label="关闭提示"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </section>
                  )}

                  <section className="diagnoses space-y-3 my-4">
                    {snapshot?.diagnoses
                      ?.filter((d: any) => d.nodeId === nodeId)
                      .map((d: any) => (
                        <div className="callout p-4 rounded-xl bg-secondary/80 border border-border text-xs" key={d.id}>
                          <h3 className="font-semibold text-foreground text-xs mb-1">错因诊断</h3>
                          <p className="text-muted-foreground">{d.explanation}</p>
                          {d.patchError && <p className="text-destructive mt-1">{d.patchError.message}</p>}
                        </div>
                      ))}
                    {snapshot?.patches
                      ?.filter((p: any) => p.targetNodeId === nodeId && p.status === 'applied')
                      .map((p: any) => (
                        <div className="callout p-4 rounded-xl bg-secondary/80 border border-border text-xs flex justify-between items-center" key={p.id}>
                          <p className="mb-0 text-foreground">补课建议：{p.proposal.reason}</p>
                          <Button
                            variant="outline"
                            size="sm"
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
                          </Button>
                        </div>
                      ))}
                  </section>

                  <section className="notes">
                    <h3 className="font-serif text-sm font-semibold mb-2">我的理解笔记</h3>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="用自己的话，记录你理解的内容…"
                      className="w-full rounded-xl border border-input bg-card p-3 text-xs text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring min-h-[90px] leading-relaxed"
                    />
                    <Button
                      size="sm"
                      disabled={busy}
                      className="mt-2 text-xs"
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
                    </Button>
                  </section>
                </>
              )
            )}

            {snapshot?.drafts.map((d: any) => (
              <section className="panel rounded-xl border border-border bg-card p-5 my-4 shadow-paper" key={d.id}>
                <h2 className="text-base font-serif mb-2">待确认：{d.payload.title ?? d.kind}</h2>
                {d.payload.nodes ? (
                  <ol className="list-decimal pl-5 space-y-1 text-xs text-muted-foreground my-3">
                    {d.payload.nodes.map((n: any) => (
                      <li key={n.key}>
                        {n.title} · {n.estimatedMinutes} 分钟
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-xs text-muted-foreground my-2">正文重写已生成。确认后发布新版本。</p>
                )}
                <Button
                  size="sm"
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
                </Button>
              </section>
            ))}

            {snapshot?.jobs
              .filter((j: any) => j.kind !== 'chat')
              .slice(-3)
              .map((j: any) => (
                <div className="job" key={j.id}>
                  <span>
                    {states[j.state]}：{j.kind}
                    {j.error && <span> · {j.error.message}</span>}
                  </span>
                  {['queued', 'running', 'validating'].includes(j.state) && (
                    <Button variant="outline" size="sm" className="h-7 text-xs ml-3" onClick={() => void run(() => command(`/jobs/${j.id}/cancel`))}>
                      取消
                    </Button>
                  )}
                </div>
              ))}
          </main>

          <aside className="tutor" ref={tutorRef}>
            <div
              className={`tutor-resize-handle ${isDragging ? 'is-dragging' : ''}`}
              onPointerDown={handleResizePointerDown}
              onDoubleClick={handleResizeDoubleClick}
              onKeyDown={handleResizeKeyDown}
              tabIndex={0}
              role="separator"
              aria-orientation="vertical"
              aria-label="拖动调整学习导师面板宽度，双击恢复默认"
              aria-valuenow={tutorWidth}
              aria-valuemin={280}
              aria-valuemax={800}
              title="拖动调整导师面板宽度，双击恢复默认"
            />
            <div className="tutor-title">
              <span className="avatar">知</span>
              <div className="min-w-0 flex-1">
                <h3 className="font-serif font-semibold text-foreground">学习导师</h3>
                <small className="text-[11px] text-muted-foreground block truncate">陪你把问题想明白</small>
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
                        <p role={stopped ? 'status' : undefined} className="text-xs text-muted-foreground italic mt-1">
                          {notice}
                        </p>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="chat-empty">
                  <span>✦</span>
                  <h3 className="font-serif">从「为什么」开始</h3>
                  <p>点击正文或操作实验，再提问。导师会看到你提交时引用的内容。</p>
                </div>
              )}
              {snapshot?.jobs
                .filter((j: any) => j.sessionId === sessionId && j.error)
                .slice(-1)
                .map((j: any) => (
                  <p className="alert text-xs text-destructive bg-destructive/10 p-2.5 rounded-lg border border-destructive/20 my-2" key={j.id}>
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
                className="w-full rounded-xl border border-input bg-secondary/50 p-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[90px] leading-relaxed resize-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void run(ask);
                  }
                }}
              />
              <div className="toolbar flex justify-between items-center mt-2">
                <small className="text-[11px] text-muted-foreground">Shift + Enter 换行</small>
                {activeJobs.find((j: any) => j.sessionId === sessionId) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() =>
                      void run(() =>
                        command(
                          `/jobs/${activeJobs.find((j: any) => j.sessionId === sessionId).id}/cancel`,
                        ),
                      )
                    }
                  >
                    <Square className="h-3 w-3 mr-1" />
                    停止
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="text-xs gap-1"
                    disabled={busy || !node || !question.trim()}
                    onClick={() => void run(ask)}
                  >
                    <Send className="h-3 w-3" />
                    发送 ↑
                  </Button>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in-0 duration-200">
          <section
            className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl text-card-foreground max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label="创建学习计划"
          >
            <button
              className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground transition-opacity hover:opacity-100 hover:bg-secondary focus:outline-none"
              onClick={() => setCreating(false)}
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
            <span className="eyebrow text-[11px] font-semibold tracking-wider text-primary">从你的目标出发</span>
            <h2 className="text-xl font-serif font-semibold text-foreground mb-4">创建学习计划</h2>
            <form
              className="space-y-4"
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
              <label className="block text-xs font-medium text-foreground">
                想学什么？
                <Input name="topic" required maxLength={200} placeholder="例如：从零理解线性代数" className="mt-1.5" />
              </label>
              <label className="block text-xs font-medium text-foreground">
                希望做到什么？
                <Textarea
                  name="goal"
                  required
                  maxLength={2000}
                  placeholder="具体的学习目标，让计划更贴合你"
                  className="mt-1.5"
                />
              </label>
              <label className="block text-xs font-medium text-foreground">
                已有基础
                <Input name="background" defaultValue="" maxLength={4000} className="mt-1.5" />
              </label>
              <label className="block text-xs font-medium text-foreground">
                每周可投入分钟数
                <Input
                  name="minutes"
                  type="number"
                  min="1"
                  max="10080"
                  defaultValue="120"
                  required
                  className="mt-1.5"
                />
              </label>
              <Button className="w-full mt-4" disabled={busy}>
                创建计划 →
              </Button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
