'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Play, Square, Network, TrendingDown } from 'lucide-react';

export function Training() {
  const worker = useRef<Worker | null>(null),
    runId = useRef(''),
    [epochs, setEpochs] = useState(100),
    [running, setRunning] = useState(false),
    [history, setHistory] = useState<any[]>([]),
    [status, setStatus] = useState('尚未运行');

  useEffect(() => () => worker.current?.terminate(), []);

  function start() {
    worker.current?.terminate();
    const id = crypto.randomUUID();
    runId.current = id;
    setHistory([]);
    setRunning(true);
    setStatus('加载计算环境…');
    const w = new Worker(new URL('../capabilities/training-worker.ts', import.meta.url));
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.runId !== runId.current) return;
      if (data.type === 'epoch') {
        setHistory((h) => [...h, data]);
        setStatus(`真实训练 · epoch ${data.epoch}`);
      } else {
        setRunning(false);
        setStatus(
          data.type === 'error'
            ? data.message
            : data.limited
              ? '达到30秒预算，保留部分结果'
              : `训练完成 · ${data.parameters} 个参数`,
        );
        w.terminate();
      }
    };
    w.onerror = () => {
      setStatus('训练环境不可用');
      setRunning(false);
      w.terminate();
    };
    w.postMessage({ runId: id, epochs });
  }

  const latest = history.at(-1),
    max = Math.max(1, ...history.map((h) => Math.max(h.loss, h.validationLoss)));

  return (
    <section className="panel rounded-2xl border border-border bg-card p-6 my-6 shadow-paper">
      <div className="flex items-center gap-2 mb-2">
        <Network className="h-4 w-4 text-primary" />
        <span className="eyebrow text-[11px] font-semibold tracking-wider text-primary !mb-0">
          深度学习 · CPU 真实训练
        </span>
      </div>

      <h2 className="text-lg font-semibold text-foreground font-serif">小型 MLP 学习非线性分类</h2>
      <p className="text-xs text-muted-foreground leading-relaxed">
        二维输入 → 8个 tanh 神经元 → sigmoid 输出。64个训练样本、16个独立验证样本；固定
        seed=42。验证集不参与参数更新。
      </p>

      <div className="my-4 max-w-xs">
        <label className="block text-xs font-medium text-foreground mb-1.5">
          最多训练轮数
          <input
            aria-label="训练轮数"
            type="number"
            min={1}
            max={300}
            value={epochs}
            onChange={(e) => setEpochs(Math.max(1, Math.min(300, Number(e.target.value))))}
            className="mt-1 flex h-8 w-full rounded-lg border border-input bg-card px-3 py-1 text-xs text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </div>

      <div className="toolbar flex items-center gap-3 my-3">
        <Button
          disabled={running}
          size="sm"
          className="gap-1.5 text-xs h-8"
          onClick={start}
        >
          <Play className="h-3 w-3" />
          开始真实训练
        </Button>
        <Button
          disabled={!running}
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs h-8"
          onClick={() => {
            worker.current?.terminate();
            runId.current = '';
            setRunning(false);
            setStatus('已停止，保留最后完成轮次');
          }}
        >
          <Square className="h-3 w-3" />
          停止训练
        </Button>
        <span role="status" className="text-xs font-medium text-primary bg-secondary px-2.5 py-1 rounded-md">
          {status}
        </span>
      </div>

      <div className="rounded-xl border border-border/80 bg-[#f7faf5] p-3 my-4">
        <svg viewBox="0 0 520 200" aria-label="训练与验证损失曲线" role="img" className="w-full max-h-[220px]">
          <line x1="20" y1="180" x2="500" y2="180" stroke="#cdd9cb" strokeWidth={1} />
          {['loss', 'validationLoss'].map((key, i) => (
            <polyline
              key={key}
              fill="none"
              stroke={i ? '#bb874e' : '#34654e'}
              strokeWidth={2}
              points={history
                .map(
                  (h, j) =>
                    `${20 + (j / Math.max(1, epochs - 1)) * 480},${180 - (h[key] / max) * 160}`,
                )
                .join(' ')}
            />
          ))}
        </svg>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-1 bg-[#34654e] rounded-full" />
          训练损失
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-1 bg-[#bb874e] rounded-full" />
          验证损失
        </span>
        {latest && (
          <span className="font-mono text-primary font-medium ml-auto flex items-center gap-1">
            <TrendingDown className="h-3 w-3" />
            当前 {latest.loss.toFixed(4)} / {latest.validationLoss.toFixed(4)}
          </span>
        )}
      </div>

      <small className="block text-[11px] text-muted-foreground/80 mt-3 pt-2 border-t border-border/40">
        训练完成或损失下降不会产生掌握证据；不声称此小样本实验能代表真实任务泛化。
      </small>
    </section>
  );
}
