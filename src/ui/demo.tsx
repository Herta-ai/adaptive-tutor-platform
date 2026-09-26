'use client';
import { useEffect, useRef, useState } from 'react';
import { capability, validateParameters } from '../capabilities/registry';
import dynamic from 'next/dynamic';
const Scene = dynamic(() => import('./scene'), {
  ssr: false,
  loading: () => <p>正在加载三维视图…</p>,
});
export function Demo({
  block,
  onContext,
  initialState,
  onSave,
}: {
  block: any;
  onContext?: (state: any) => void;
  initialState?: any;
  onSave?: (state: any) => Promise<void>;
}) {
  const cap = capability(block.templateId, block.templateVersion);
  const [parameters, setParameters] = useState<Record<string, number>>(() =>
    validateParameters(cap, initialState?.parameters ?? block.config),
  );
  const [step, setStep] = useState<number>(initialState?.step ?? 0),
    [selectedIds, setSelectedIds] = useState<string[]>(initialState?.selectedIds ?? []),
    [saving, setSaving] = useState(false),
    [playing, setPlaying] = useState(false),
    [revision, setRevision] = useState(0),
    [visible, setVisible] = useState(false),
    [result, setResult] = useState<ReturnType<typeof cap.compute>>({ values: {} }),
    [error, setError] = useState('');
  const container = useRef<HTMLElement | null>(null),
    worker = useRef<Worker | null>(null),
    current = useRef({ revision, step });
  current.current = { revision, step };
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const show = entries[0].isIntersecting;
      setVisible(show);
      if (!show) setPlaying(false);
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const w = new Worker(new URL('../capabilities/demo-worker.ts', import.meta.url));
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.runRevision !== current.current.revision || data.step !== current.current.step)
        return;
      if (data.error) setError(data.error);
      else {
        setResult(data.result);
        setError('');
      }
    };
    w.onerror = () => setError('计算环境不可用；请阅读文字说明。');
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [visible]);
  useEffect(() => {
    worker.current?.postMessage({
      templateId: cap.id,
      templateVersion: cap.version,
      runRevision: revision,
      parameters,
      step,
    });
  }, [visible, cap.id, cap.version, parameters, step, revision]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(
      () =>
        setStep((s) => {
          if (s >= 100) {
            setPlaying(false);
            return 100;
          }
          return s + 1;
        }),
      100,
    );
    return () => clearInterval(t);
  }, [playing]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  const report = (p = parameters, s = step, r = revision) =>
    onContext?.({
      templateId: cap.id,
      templateVersion: cap.version,
      runRevision: r,
      parameters: p,
      selectedIds,
      observables:
        p === parameters && s === step
          ? { values: result.values, computationVersion: cap.version, modelInfo: block.modelInfo }
          : {},
      step: s,
    });
  const points = result.points;
  let plot = '';
  if (points?.length) {
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]),
      xmin = Math.min(0, ...xs),
      xmax = Math.max(1, ...xs),
      ymin = Math.min(0, ...ys),
      ymax = Math.max(1, ...ys);
    if (cap.type === 'geometry2d') {
      const scale = Math.min(440 / (xmax - xmin), 200 / (ymax - ymin));
      plot = points
        .map(
          ([x, y]) =>
            `${260 + (x - (xmin + xmax) / 2) * scale},${130 - (y - (ymin + ymax) / 2) * scale}`,
        )
        .join(' ');
    } else
      plot = points
        .map(
          ([x, y]) =>
            `${40 + ((x - xmin) / (xmax - xmin)) * 440},${230 - ((y - ymin) / (ymax - ymin)) * 200}`,
        )
        .join(' ');
  }
  return (
    <section ref={container} className="demo" aria-label={cap.title}>
      <div className="demo-head">
        <span className="eyebrow">交互实验</span>
        <span className="badge">{cap.mode === 'computed' ? '真实计算' : '简化模型'}</span>
      </div>
      <h3>{cap.title}</h3>
      <p className="muted">{cap.description}</p>
      {(cap.type === 'scene3d' || cap.type === 'molecule') && visible && (
        <Scene
          positions={result.positions}
          atoms={result.atoms}
          onSelect={(id) => {
            setSelectedIds([id]);
            onContext?.({
              templateId: cap.id,
              templateVersion: cap.version,
              runRevision: revision,
              parameters,
              selectedIds: [id],
              observables: {
                values: result.values,
                computationVersion: cap.version,
                modelInfo: block.modelInfo,
              },
              step,
            });
          }}
        />
      )}
      <svg
        style={{ display: cap.type === 'scene3d' || cap.type === 'molecule' ? 'none' : undefined }}
        viewBox="0 0 520 260"
        role="img"
        aria-label={block.alt ?? cap.description}
      >
        <defs>
          <pattern
            id={'grid-' + block.blockId}
            width="26"
            height="26"
            patternUnits="userSpaceOnUse"
          >
            <path d="M 26 0 L 0 0 0 26" fill="none" stroke="#dce5df" strokeWidth=".7" />
          </pattern>
        </defs>
        <rect width="520" height="260" fill={`url(#grid-${block.blockId})`} />
        <line x1="40" y1="230" x2="490" y2="230" stroke="#8ba293" />
        <line x1="40" y1="25" x2="40" y2="230" stroke="#8ba293" />
        {plot && (
          <polyline
            points={plot}
            fill={cap.type === 'geometry2d' ? '#95baaa55' : 'none'}
            stroke="#276953"
            strokeWidth="3"
          />
        )}
        {result.bars?.map((v, i) => {
          const min = Math.min(0, ...result.bars!),
            max = Math.max(1, ...result.bars!),
            baseline = 230 - (-min / (max - min)) * 180,
            height = (Math.abs(v) / (max - min)) * 180;
          return (
            <rect
              key={i}
              x={42 + (i * 440) / result.bars!.length}
              y={v >= 0 ? baseline - height : baseline}
              width={Math.max(1, 430 / result.bars!.length)}
              height={height}
              rx="2"
              fill="#51846d"
            />
          );
        })}
      </svg>
      {error && (
        <p role="alert">
          {error} {block.alt}
        </p>
      )}
      <div className="parameters">
        {Object.entries(cap.parameters).map(([key, p]) => (
          <label key={key}>
            <span>
              {key}
              <strong>{parameters[key]}</strong>
            </span>
            <input
              aria-label={key}
              type="range"
              min={p.min}
              max={p.max}
              step={p.step}
              value={parameters[key]}
              onChange={(e) => {
                const next = { ...parameters, [key]: Number(e.target.value) };
                setParameters(next);
                setRevision(revision + 1);
                report(next, step, revision + 1);
              }}
            />
          </label>
        ))}
      </div>
      <div className="observations">
        {Object.entries(result.values).map(([key, value]) => (
          <span key={key}>
            {key}
            <strong>{Number(value.toPrecision(5))}</strong>
          </span>
        ))}
      </div>
      <div className="toolbar">
        <button onClick={() => setPlaying(!playing)}>{playing ? '暂停' : '播放'}</button>
        <button
          onClick={() => {
            setPlaying(false);
            setStep(Math.min(step + 1, 100));
            report(parameters, Math.min(step + 1, 100));
          }}
        >
          单步
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            setStep(0);
            setSelectedIds([]);
            setParameters(validateParameters(cap, block.config));
            setRevision(revision + 1);
          }}
        >
          复位
        </button>
        <span className="muted">步骤 {step}/100</span>
        <button className="link" onClick={() => report()}>
          引用实验提问 ↗
        </button>
        {onSave && (
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  templateId: cap.id,
                  templateVersion: cap.version,
                  parameters,
                  selectedIds,
                  step,
                });
              } catch (e) {
                setError(e instanceof Error ? e.message : '保存失败');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? '保存中…' : '保存实验快照'}
          </button>
        )}
      </div>
      {selectedIds.length > 0 && <p>已选择：{selectedIds.join('、')}</p>}
      {result.steps && (
        <ol>
          {result.steps.map((s, i) => (
            <li key={i}>
              <code>{s}</code>
            </li>
          ))}
        </ol>
      )}
      <small>{cap.reference} 实验操作不计入掌握证据。</small>
    </section>
  );
}
