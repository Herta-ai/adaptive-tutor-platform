'use client';

import { useEffect, useState } from 'react';
import { api, command } from './api';
import { Demo } from './demo';

export function LessonDemo({
  block,
  nodeId,
  lessonVersion,
  onContext,
}: {
  block: any;
  nodeId: string;
  lessonVersion: number;
  onContext: (state: any) => void;
}) {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [restored, setRestored] = useState<any>();
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const path = `/nodes/${nodeId}/demo-snapshots`;

  useEffect(() => {
    let active = true;
    void api(path)
      .then((rows) => {
        if (active) setSnapshots(rows);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [path]);

  const matching = snapshots.filter(
    (s) =>
      s.lessonVersion === lessonVersion &&
      s.blockId === block.blockId &&
      s.templateId === block.templateId &&
      s.templateVersion === block.templateVersion,
  );

  return (
    <>
      <Demo
        key={revision}
        block={block}
        initialState={restored}
        onContext={onContext}
        onSave={async (state) => {
          const saved = await command(path, { ...state, lessonVersion, blockId: block.blockId });
          setSnapshots((rows) => [...rows, saved]);
          setMessage('实验快照已保存');
        }}
      />
      {(matching.length > 0 || message) && (
        <div className="mt-2 mb-4 px-3.5 py-2 rounded-xl bg-card border border-border flex flex-wrap items-center gap-3 text-xs">
          {matching.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              恢复实验快照
              <select
                value=""
                onChange={(event) => {
                  const saved = matching.find((s) => s.id === event.target.value);
                  if (!saved) return;
                  setRestored(saved);
                  setRevision((r) => r + 1);
                  onContext({
                    templateId: saved.templateId,
                    templateVersion: saved.templateVersion,
                    parameters: saved.parameters,
                    selectedIds: saved.selectedIds,
                    step: saved.step ?? 0,
                    runRevision: 0,
                    observables: {},
                  });
                  setMessage('已恢复快照，实验暂停');
                }}
                className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
              >
                <option value="">选择本正文版本的快照</option>
                {matching.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    快照 {i + 1} · {new Date(s.createdAt).toLocaleString('zh-CN')}
                  </option>
                ))}
              </select>
            </label>
          )}
          {message && (
            <p role="status" className="text-xs text-primary font-medium animate-in fade-in-0">
              {message}
            </p>
          )}
        </div>
      )}
    </>
  );
}
