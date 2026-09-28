'use client';

import { useState } from 'react';
import { command, uploadLearn } from './api';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../components/ui/card';
import { Download, Upload, FileText, Archive, Undo2 } from 'lucide-react';

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
    <section className="transfer-controls my-2">
      <div className="toolbar flex items-center gap-2 flex-wrap">
        {courseId ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              className="gap-1.5 text-xs h-8"
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
              <Download className="h-3.5 w-3.5" />
              导出内容包
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              className="gap-1.5 text-xs h-8"
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
              <Archive className="h-3.5 w-3.5" />
              导出个人备份
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              className="gap-1.5 text-xs h-8"
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
              <FileText className="h-3.5 w-3.5" />
              导出 Markdown
            </Button>
          </>
        ) : (
          <label className="file-button inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground shadow-paper hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50">
            <Upload className="h-3.5 w-3.5 text-primary" />
            导入 .learn
            <input
              aria-label="导入课程包"
              type="file"
              accept=".learn"
              disabled={busy}
              className="hidden"
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
        <small className="block mt-2 text-[11px] text-muted-foreground leading-relaxed">
          内容包不含作答与笔记，但个性化正文仍可能包含你主动透露的信息。备份包含个人记录。
        </small>
      )}

      {preview && (
        <Card className="panel mt-4 border-primary/30 shadow-paper-md bg-card animate-in fade-in-0 duration-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground font-serif">{preview.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {preview.nodeCount} 个节点 · {preview.exportMode === 'backup' ? '个人备份' : '内容包'}
              。导入始终新建独立课程。
            </p>
          </CardContent>
          <CardFooter className="flex gap-2 flex-wrap pt-0">
            <Button
              size="sm"
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
            </Button>
            {preview.exportMode === 'backup' && (
              <Button
                variant="secondary"
                size="sm"
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
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
              <Undo2 className="h-3.5 w-3.5 mr-1" />
              取消
            </Button>
          </CardFooter>
        </Card>
      )}
    </section>
  );
}
