'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Play, Square, Terminal, Code2, Cpu, ShieldCheck } from 'lucide-react';

const examples = {
  javascript:
    'const values = [5, 1, 4, 2, 3];\nconsole.log(values.slice().sort((a, b) => a - b));\nconsole.log("平均值", values.reduce((a,b) => a+b, 0) / values.length);',
  python:
    'values = [5, 1, 4, 2, 3]\nprint(sorted(values))\nprint("平均值", sum(values) / len(values))',
  sql: 'CREATE TABLE samples (value INTEGER);\nINSERT INTO samples VALUES (5), (1), (4), (2), (3);\nSELECT value FROM samples ORDER BY value;\nSELECT AVG(value) AS mean FROM samples;',
};

type Language = keyof typeof examples;

export function CodeLab() {
  const [language, setLanguage] = useState<Language>('javascript'),
    [source, setSource] = useState(examples.javascript),
    [output, setOutput] = useState('点击运行后，代码才会进入隔离环境。'),
    [status, setStatus] = useState('idle');

  const cleanup = useRef<() => void>(() => {}),
    active = useRef<string | null>(null);

  useEffect(() => () => cleanup.current(), []);

  async function run() {
    cleanup.current();
    const runId = crypto.randomUUID();
    active.current = runId;
    setStatus('preparing');
    setOutput('正在准备固定版本运行库…');
    let frame: HTMLIFrameElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let port: MessagePort | undefined;
    const stop = () => {
      clearTimeout(timer);
      port?.postMessage({ type: 'stop' });
      port?.close();
      frame?.remove();
      if (active.current === runId) active.current = null;
    };
    cleanup.current = stop;
    try {
      const manifestResponse = await fetch('/api/v1/code-runtimes/' + language);
      if (!manifestResponse.ok) throw Error('运行库尚未构建，请执行 pnpm runtimes:build');
      const manifest = await manifestResponse.json();
      const files: Record<string, ArrayBuffer> = {};
      let worker = '';
      for (const file of manifest.files) {
        const r = await fetch(
          '/api/v1/code-runtimes/' + language + '/' + encodeURIComponent(file.name),
        );
        if (!r.ok) throw Error('运行库文件不可用');
        const b = await r.arrayBuffer();
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (v) =>
          v.toString(16).padStart(2, '0'),
        ).join('');
        if (digest !== file.sha256 || b.byteLength !== file.size) throw Error('运行库校验失败');
        if (file.name === 'worker.js') worker = new TextDecoder().decode(b);
        else files[file.name] = b;
      }
      if (active.current !== runId) return;
      frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('aria-hidden', 'true');
      frame.hidden = true;
      frame.src = '/sandbox';
      document.body.appendChild(frame);
      const channel = new MessageChannel();
      port = channel.port1;
      const finish = (text: string) => {
        setOutput(text);
        setStatus('idle');
        stop();
      };
      port.onmessage = ({ data }) => {
        if (active.current !== runId) return;
        if (data.type === 'connected') {
          port!.postMessage({
            type: 'run',
            worker,
            payload: { runId, language, source, input: '', files },
          });
          return;
        }
        if (data.runId !== runId) return;
        if (data.type === 'ready') {
          clearTimeout(timer);
          setStatus('running');
          setOutput('正在运行…');
          timer = setTimeout(
            () => finish('运行超时：已终止实验，代码已保留。'),
            language === 'python' ? 5000 : 2000,
          );
        } else if (data.type === 'result')
          finish(typeof data.output === 'string' ? data.output.slice(0, 65536) : '');
        else if (data.type === 'error')
          finish(
            '错误：' +
              String(data.message).slice(0, 4000) +
              (data.output ? '\n' + String(data.output).slice(0, 60000) : ''),
          );
      };
      frame.onload = () =>
        frame!.contentWindow!.postMessage({ type: 'initialize' }, '*', [channel.port2]);
      timer = setTimeout(() => finish('运行库初始化超时；实验未启动。'), 30000);
    } catch (e) {
      if (active.current !== runId) return;
      setOutput(e instanceof Error ? e.message : '实验失败');
      setStatus('idle');
      stop();
    }
  }

  return (
    <section className="panel code-lab rounded-2xl border border-border bg-card p-6 my-6 shadow-paper">
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className="eyebrow text-[11px] font-semibold tracking-wider text-primary">
            受限代码实验 · 真实计算
          </span>
          <h2 className="text-lg font-semibold text-foreground font-serif">修改、运行、观察结果</h2>
        </div>
        <Badge variant="outline" className="gap-1 text-xs">
          <ShieldCheck className="h-3 w-3 text-emerald-600" />
          沙箱隔离
        </Badge>
      </div>

      <div className="toolbar flex items-center gap-2 mb-3">
        {(['javascript', 'python', 'sql'] as const).map((l) => (
          <Button
            key={l}
            variant={language === l ? 'default' : 'outline'}
            size="sm"
            disabled={status !== 'idle'}
            className="text-xs h-8"
            onClick={() => {
              setLanguage(l);
              setSource(examples[l]);
            }}
          >
            {l === 'javascript' ? 'JavaScript' : l === 'python' ? 'Python' : 'SQL'}
          </Button>
        ))}
      </div>

      <label className="block text-xs font-medium text-muted-foreground my-2">
        <span className="flex items-center gap-1.5 mb-1.5 text-foreground">
          <Code2 className="h-3.5 w-3.5 text-primary" />
          实验源码
        </span>
        <textarea
          aria-label="实验源码"
          spellCheck={false}
          maxLength={16384}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full font-mono text-xs rounded-xl border border-input bg-[#fbfdf9] p-3 text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring min-h-[140px] leading-relaxed"
        />
      </label>

      <div className="toolbar flex items-center gap-3 my-3">
        <Button
          variant="default"
          size="sm"
          disabled={status !== 'idle'}
          className="gap-1.5 text-xs h-8"
          onClick={() => void run()}
        >
          <Play className="h-3 w-3" />
          运行代码
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={status === 'idle'}
          className="gap-1.5 text-xs h-8"
          onClick={() => {
            cleanup.current();
            setStatus('idle');
            setOutput('实验已停止。');
          }}
        >
          <Square className="h-3 w-3" />
          停止实验
        </Button>
        <small className="text-xs text-muted-foreground flex items-center gap-1">
          <Cpu className="h-3 w-3" />
          {status === 'preparing'
            ? '准备运行库'
            : status === 'running'
              ? '运行中'
              : 'JS/SQL 2 秒，Python 5 秒；最多 64 KiB 输出'}
        </small>
      </div>

      <div className="mt-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          控制台输出
        </div>
        <pre
          aria-label="实验输出"
          className="rounded-xl border border-border bg-[#18231d] p-3.5 text-xs text-[#d8e8dc] font-mono shadow-inner min-h-[60px] max-h-[240px] overflow-auto leading-relaxed"
        >
          {output}
        </pre>
      </div>

      <p className="muted text-xs text-muted-foreground/80 mt-3 leading-relaxed">
        不能访问课程数据库、宿主文件或网络。Python 提供标准库；便携版已包含 NumPy。
        输出仅为实验反馈，不改变掌握状态。
      </p>
    </section>
  );
}
