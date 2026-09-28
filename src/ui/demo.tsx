'use client';

import { useEffect, useRef, useState } from 'react';
import { capability, validateParameters } from '../capabilities/registry';
import dynamic from 'next/dynamic';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Play, Pause, StepForward, RotateCcw, Bookmark, MessageSquareQuote } from 'lucide-react';

const Scene = dynamic(() => import('./scene'), {
  ssr: false,
  loading: () => <p className="text-xs text-muted-foreground p-8 text-center">正在加载三维视图…</p>,
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
    <section ref={container} className="demo rounded-2xl border border-border bg-card p-6 my-6 shadow-paper" aria-label={cap.title}>
      <div className="demo-head flex justify-between items-center mb-3">
        <span className="eyebrow text-[11px] font-semibold tracking-wider text-primary">交互实验</span>
        <Badge variant={cap.mode === 'computed' ? 'default' : 'secondary'} className="text-[11px]">
          {cap.mode === 'computed' ? '真实计算' : '简化模型'}
        </Badge>
      </div>

      <h3 className="text-base font-semibold text-foreground mb-1">{cap.title}</h3>
      <p className="muted text-xs text-muted-foreground leading-relaxed mb-4">{cap.description}</p>

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
        className="rounded-xl border border-border/80 bg-[#f7faf5] w-full max-h-[280px]"
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
        <p role="alert" className="text-xs text-destructive mt-2">
          {error} {block.alt}
        </p>
      )}

      <div className="parameters flex flex-wrap gap-4 my-5 p-4 rounded-xl bg-secondary/50 border border-border/60">
        {Object.entries(cap.parameters).map(([key, p]) => (
          <label key={key} className="flex-1 min-w-[120px] text-xs">
            <span className="flex justify-between items-center text-foreground font-medium mb-1">
              <span>{key}</span>
              <strong className="font-mono text-primary text-xs bg-card px-1.5 py-0.5 rounded border border-border/60">
                {parameters[key]}
              </strong>
            </span>
            <input
              aria-label={key}
              type="range"
              min={p.min}
              max={p.max}
              step={p.step}
              value={parameters[key]}
              className="w-full accent-primary cursor-pointer"
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

      <div className="observations flex flex-wrap gap-3 border-t border-border pt-4 my-3">
        {Object.entries(result.values).map(([key, value]) => (
          <span key={key} className="flex-1 min-w-[80px] text-[11px] text-muted-foreground">
            {key}
            <strong className="block font-serif text-primary text-xl font-normal mt-0.5">
              {Number(value.toPrecision(5))}
            </strong>
          </span>
        ))}
      </div>

      <div className="toolbar flex items-center gap-2 flex-wrap mt-4 pt-3 border-t border-border/60">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs h-8"
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {playing ? '暂停' : '播放'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs h-8"
          onClick={() => {
            setPlaying(false);
            setStep(Math.min(step + 1, 100));
            report(parameters, Math.min(step + 1, 100));
          }}
        >
          <StepForward className="h-3 w-3" />
          单步
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs h-8"
          onClick={() => {
            setPlaying(false);
            setStep(0);
            setSelectedIds([]);
            setParameters(validateParameters(cap, block.config));
            setRevision(revision + 1);
          }}
        >
          <RotateCcw className="h-3 w-3" />
          复位
        </Button>
        <span className="muted text-xs text-muted-foreground ml-1">步骤 {step}/100</span>

        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs text-primary border-primary/20 hover:bg-secondary hover:text-primary h-8 font-medium whitespace-nowrap cursor-pointer shadow-none"
            onClick={() => report()}
          >
            <MessageSquareQuote className="h-3.5 w-3.5 shrink-0" />
            <span>引用实验提问 ↗</span>
          </Button>

          {onSave && (
            <Button
              variant="secondary"
              size="sm"
              disabled={saving}
              className="gap-1.5 text-xs h-8 whitespace-nowrap"
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
              <Bookmark className="h-3.5 w-3.5" />
              {saving ? '保存中…' : '保存实验快照'}
            </Button>
          )}
        </div>
      </div>

      {selectedIds.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3">已选择：{selectedIds.join('、')}</p>
      )}

      {result.steps && (
        <ol className="mt-3 space-y-1 text-xs font-mono text-muted-foreground">
          {result.steps.map((s, i) => (
            <li key={i}>
              <code className="bg-secondary px-2 py-0.5 rounded text-[11px]">{s}</code>
            </li>
          ))}
        </ol>
      )}

      <small className="block text-[11px] text-muted-foreground/80 mt-3 pt-2 border-t border-border/40">
        {cap.reference} 实验操作不计入掌握证据。
      </small>
    </section>
  );
}
