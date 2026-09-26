'use client';
import { useEffect, useRef, useState } from 'react';
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
    <section className="panel">
      <span className="eyebrow">深度学习 · CPU 真实训练</span>
      <h2>小型 MLP 学习非线性分类</h2>
      <p>
        二维输入 → 8个 tanh 神经元 → sigmoid 输出。64个训练样本、16个独立验证样本；固定
        seed=42。验证集不参与参数更新。
      </p>
      <label>
        最多训练轮数
        <input
          aria-label="训练轮数"
          type="number"
          min={1}
          max={300}
          value={epochs}
          onChange={(e) => setEpochs(Math.max(1, Math.min(300, Number(e.target.value))))}
        />
      </label>
      <div className="toolbar">
        <button disabled={running} className="primary" onClick={start}>
          开始真实训练
        </button>
        <button
          disabled={!running}
          onClick={() => {
            worker.current?.terminate();
            runId.current = '';
            setRunning(false);
            setStatus('已停止，保留最后完成轮次');
          }}
        >
          停止训练
        </button>
        <span role="status">{status}</span>
      </div>
      <svg viewBox="0 0 520 200" aria-label="训练与验证损失曲线" role="img">
        <line x1="20" y1="180" x2="500" y2="180" stroke="#a4b3a0" />
        {['loss', 'validationLoss'].map((key, i) => (
          <polyline
            key={key}
            fill="none"
            stroke={i ? '#bb874e' : '#447a5d'}
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
      <p>
        绿色：训练损失；橙色：验证损失。
        {latest && `当前 ${latest.loss.toFixed(4)} / ${latest.validationLoss.toFixed(4)}`}
      </p>
      <small>训练完成或损失下降不会产生掌握证据；不声称此小样本实验能代表真实任务泛化。</small>
    </section>
  );
}
