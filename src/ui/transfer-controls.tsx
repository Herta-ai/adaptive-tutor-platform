'use client';
import { useState } from 'react';
import { command, uploadLearn } from './api';
export function TransferControls({
  courseId,
  onImported,
  onError,
}: {
  courseId?: string;
  onImported?: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState<any>(null),
    [busy, setBusy] = useState(false);
  async function execute(f: () => Promise<void>) {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      onError(e instanceof Error ? e.message : '文件操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="transfer-controls">
      <div className="toolbar">
        {courseId ? (
          <>
            <button
              disabled={busy}
              onClick={() =>
                void execute(async () => {
                  const r = await command(`/courses/${courseId}/exports`, {
                    mode: 'content',
                    format: 'learn',
                  });
                  location.assign(r.downloadUrl);
                })
              }
            >
              导出内容包
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void execute(async () => {
                  const r = await command(`/courses/${courseId}/exports`, {
                    mode: 'backup',
                    format: 'learn',
                  });
                  location.assign(r.downloadUrl);
                })
              }
            >
              导出个人备份
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void execute(async () => {
                  const r = await command(`/courses/${courseId}/exports`, {
                    mode: 'content',
                    format: 'markdown',
                  });
                  location.assign(r.downloadUrl);
                })
              }
            >
              导出 Markdown
            </button>
          </>
        ) : (
          <label className="file-button">
            导入 .learn
            <input
              aria-label="导入课程包"
              type="file"
              accept=".learn"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void execute(async () => setPreview(await uploadLearn(file)));
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      {courseId && (
        <small>
          内容包不含作答与笔记，但个性化正文仍可能包含你主动透露的信息。备份包含个人记录。
        </small>
      )}
      {preview && (
        <div className="panel">
          <h3>{preview.title}</h3>
          <p>
            {preview.nodeCount} 个节点 · {preview.exportMode === 'backup' ? '个人备份' : '内容包'}
            。导入始终新建独立课程。
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void execute(async () => {
                const r = await command(`/imports/${preview.importId}/commit`, { mode: 'fresh' });
                setPreview(null);
                onImported?.(r.courseId);
              })
            }
          >
            作为新课程导入
          </button>
          {preview.exportMode === 'backup' && (
            <button
              disabled={busy}
              onClick={() =>
                void execute(async () => {
                  const r = await command(`/imports/${preview.importId}/commit`, {
                    mode: 'restore_copy',
                  });
                  setPreview(null);
                  onImported?.(r.courseId);
                })
              }
            >
              恢复学习记录副本
            </button>
          )}
          <button onClick={() => setPreview(null)}>取消</button>
        </div>
      )}
    </section>
  );
}
