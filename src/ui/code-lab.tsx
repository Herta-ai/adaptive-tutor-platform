'use client';
import { useEffect, useRef, useState } from 'react';
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
    <section className="panel code-lab">
      <span className="eyebrow">受限代码实验 · 真实计算</span>
      <h2>修改、运行、观察结果</h2>
      <div className="toolbar">
        {(['javascript', 'python', 'sql'] as const).map((l) => (
          <button
            key={l}
            disabled={status !== 'idle'}
            className={language === l ? 'primary' : ''}
            onClick={() => {
              setLanguage(l);
              setSource(examples[l]);
            }}
          >
            {l === 'javascript' ? 'JavaScript' : l === 'python' ? 'Python' : 'SQL'}
          </button>
        ))}
      </div>
      <label>
        实验源码
        <textarea
          aria-label="实验源码"
          spellCheck={false}
          maxLength={16384}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </label>
      <div className="toolbar">
        <button className="primary" disabled={status !== 'idle'} onClick={() => void run()}>
          运行代码
        </button>
        <button
          disabled={status === 'idle'}
          onClick={() => {
            cleanup.current();
            setStatus('idle');
            setOutput('实验已停止。');
          }}
        >
          停止实验
        </button>
        <small>
          {status === 'preparing'
            ? '准备运行库'
            : status === 'running'
              ? '运行中'
              : 'JS/SQL 2 秒，Python 5 秒；最多 64 KiB 输出'}
        </small>
      </div>
      <pre aria-label="实验输出">{output}</pre>
      <p className="muted">
        不能访问课程数据库、宿主文件或网络。Python 提供标准库；NumPy 需先运行 pnpm runtimes:prepare
        准备固定版本运行库。输出仅为实验反馈，不改变掌握状态。
      </p>
    </section>
  );
}
