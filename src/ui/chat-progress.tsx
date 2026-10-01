'use client';

import { useEffect, useState } from 'react';
import { Activity, Clock } from 'lucide-react';

const phases: Record<string, string> = {
  init: '已连接 agy',
  input: '读取提问',
  response: '生成回复',
  tool: '工具调用',
  processing: '处理中',
  result: '已收到最终结果',
  validation: '校验生成内容',
};

export function JobProgress({ job, onCancel }: { job: any; onCancel?: () => void }) {
  const active = ['queued', 'running', 'validating'].includes(job.state);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    if (!active) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const activities = job.activities ?? [];
  const end = active ? clock : Date.parse(job.finishedAt ?? job.startedAt);
  const seconds = Math.max(0, Math.floor((end - Date.parse(job.startedAt)) / 1000)) || 0;
  const last = activities.at(-1);
  const quiet =
    Math.max(0, Math.floor((clock - Date.parse(job.lastActivityAt ?? job.startedAt)) / 1000)) || 0;

  const title =
    job.state === 'queued'
      ? `排队中，尚未启动 ${job.runtimeKind === 'api' ? 'API harness' : 'agy'}`
      : job.state === 'validating'
        ? '正在保存回复'
        : job.state === 'running'
          ? last?.phase === 'result'
            ? `等待 ${job.runtimeKind === 'api' ? 'API harness' : 'agy'} 退出`
            : last
              ? (phases[last.phase] ?? '处理中')
              : `正在启动 ${job.runtimeKind === 'api' ? 'API harness' : 'agy'}`
          : job.state === 'completed'
            ? job.kind === 'chat'
              ? '回复完成'
              : `已完成：${job.kind}`
            : job.state === 'cancelled'
              ? '已停止'
              : job.state === 'interrupted'
                ? '已中断'
                : '回复失败';

  return (
    <section
      className="chat-progress rounded-xl border border-border bg-card/80 p-3.5 my-3 text-xs shadow-paper backdrop-blur-sm"
      aria-label={`${job.runtimeKind === 'api' ? 'API harness' : 'agy'} 执行进度`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        {active ? (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
          </span>
        ) : (
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <strong className="font-semibold text-foreground tracking-tight">{title}</strong>
        {onCancel && active && (
          <button type="button" className="ml-auto rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onCancel}>
            停止
          </button>
        )}
      </div>

      {job.startedAt && (
        <p className="muted text-[11px] text-muted-foreground flex items-center gap-1.5 mt-1">
          <Clock className="h-3 w-3 shrink-0 inline" />
          <span>
            已用 {seconds} 秒
            {active ? ` · 最长 ${Math.round((job.timeoutMs ?? 300000) / 60000)} 分钟` : ''}
          </span>
        </p>
      )}

      {active && job.state !== 'queued' && (
        <p className="muted text-[11px] text-muted-foreground mt-1">
          {last ? `距最近步骤更新 ${quiet} 秒` : `等待 ${job.runtimeKind === 'api' ? 'API harness' : 'agy'} 发出首个步骤`}
          {quiet >= 20 ? '；尚无新步骤，可继续等待或停止。' : ''}
        </p>
      )}

      {activities.length > 0 && (
        <details open={active} className="mt-2.5 pt-2 border-t border-border/60">
          <summary className="cursor-pointer text-xs font-medium text-primary hover:underline select-none">
            {job.runtimeKind === 'api' ? 'API harness' : 'agy'} 执行步骤（{activities.length}
            {activities.length >= 80 ? '，最近记录' : ''}）
          </summary>
          <ol className="mt-2 pl-4 max-h-[220px] overflow-y-auto space-y-1.5 text-[11px] text-muted-foreground border-l border-border/80 ml-1">
            {activities.map((activity: any) => (
              <li key={activity.id} className="relative pl-2 leading-relaxed">
                <span className="font-medium text-foreground">
                  {activity.stepIndex !== undefined ? `步骤 ${activity.stepIndex + 1} · ` : ''}
                  {phases[activity.phase] ?? '处理中'}
                </span>
                {' · '}
                <span
                  className={
                    activity.state === 'done'
                      ? 'text-emerald-700 font-medium'
                      : activity.state === 'failed'
                        ? 'text-destructive font-medium'
                        : active
                          ? 'text-primary font-medium'
                          : 'text-muted-foreground'
                  }
                >
                  {activity.state === 'done'
                    ? '完成'
                    : activity.state === 'failed'
                      ? '失败'
                      : active
                        ? '进行中'
                        : '未完成'}
                </span>
                <time dateTime={activity.updatedAt} className="block text-[10px] text-muted-foreground/80 mt-0.5">
                  {new Date(activity.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                </time>
              </li>
            ))}
          </ol>
        </details>
      )}

      {job.preview && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            生成预览
          </div>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-secondary/70 p-3 text-[11px] leading-relaxed text-muted-foreground">
            {job.preview}
          </pre>
        </div>
      )}

      {job.error?.message && (
        <p className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
          {job.error.message}
        </p>
      )}
    </section>
  );
}

export const ChatProgress = JobProgress;
