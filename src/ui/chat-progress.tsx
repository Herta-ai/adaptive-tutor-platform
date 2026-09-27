'use client';
import { useEffect, useState } from 'react';

const phases: Record<string, string> = {
  init: '已连接 agy',
  input: '读取提问',
  response: '生成回复',
  tool: '工具调用',
  processing: '处理中',
  result: '已收到最终结果',
};
export function ChatProgress({ job }: { job: any }) {
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
      ? '排队中，尚未启动 agy'
      : job.state === 'validating'
        ? '正在保存回复'
        : job.state === 'running'
          ? last?.phase === 'result'
            ? '等待 agy 退出'
            : last
              ? (phases[last.phase] ?? '处理中')
              : '正在启动 agy'
          : job.state === 'completed'
            ? '回复完成'
            : job.state === 'cancelled'
              ? '已停止'
              : job.state === 'interrupted'
                ? '已中断'
                : '回复失败';
  return (
    <section className="chat-progress" aria-label="agy 执行进度">
      <strong>{title}</strong>
      {job.startedAt && (
        <p className="muted">
          已用 {seconds} 秒
          {active ? ` · 最长 ${Math.round((job.timeoutMs ?? 300000) / 60000)} 分钟` : ''}
        </p>
      )}
      {active && job.state !== 'queued' && (
        <p className="muted">
          {last ? `距最近步骤更新 ${quiet} 秒` : '等待 agy 发出首个步骤'}
          {quiet >= 20 ? '；尚无新步骤，可继续等待或停止。' : ''}
        </p>
      )}
      {activities.length > 0 && (
        <details open={active}>
          <summary>
            agy 执行步骤（{activities.length}
            {activities.length >= 80 ? '，最近记录' : ''}）
          </summary>
          <ol>
            {activities.map((activity: any) => (
              <li key={activity.id}>
                <span>
                  {activity.stepIndex !== undefined ? `步骤 ${activity.stepIndex + 1} · ` : ''}
                  {phases[activity.phase] ?? '处理中'}
                </span>
                {' · '}
                {activity.state === 'done'
                  ? '完成'
                  : activity.state === 'failed'
                    ? '失败'
                    : active
                      ? '进行中'
                      : '未完成'}
                <time dateTime={activity.updatedAt}>
                  {new Date(activity.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                </time>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
