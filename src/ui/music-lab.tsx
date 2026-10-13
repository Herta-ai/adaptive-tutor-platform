'use client';
import { useEffect, useRef, useState } from 'react';
import { MusicAudio } from '../music/audio';
import {
  musicConfig,
  buildUpAutomation,
  musicLength,
  musicSummary,
  sequence,
  instruments,
  pitchName,
  type MusicConfig,
  type MusicNote,
} from '../music/model';
import { defaultMusicConfig, musicTitles } from '../music/capabilities';
import { download, midiFile } from '../music/midi';
import { MusicInput, type InputEvent } from './music-input';
import { MusicScore } from './music-score';

const controls: [keyof MusicConfig, string, number, number, number][] = [
  ['bpm', '速度 BPM', 40, 200, 1],
  ['root', '根音 MIDI', 48, 72, 1],
  ['inversion', '和弦转位', 0, 2, 1],
  ['swing', 'Swing', 0, 0.45, 0.01],
  ['cutoff', '滤波截止 Hz', 80, 16000, 20],
  ['resonance', '滤波共振 Q', 0.1, 12, 0.1],
  ['detune', '失谐 cents', 0, 40, 1],
  ['attack', 'Attack 秒', 0.005, 2, 0.005],
  ['decay', 'Decay 秒', 0.02, 2, 0.02],
  ['sustain', 'Sustain', 0.05, 1, 0.05],
  ['release', 'Release 秒', 0.02, 3, 0.02],
  ['lfoRate', 'LFO Hz', 0.1, 12, 0.1],
  ['lfoDepth', '滤波调制 Hz', 0, 3000, 20],
  ['eqFrequency', 'EQ 中心 Hz', 40, 12000, 20],
  ['eqGain', 'EQ 增益 dB', -18, 18, 0.5],
  ['threshold', '压缩阈值 dB', -48, 0, 1],
  ['ratio', '压缩比', 1, 12, 0.5],
  ['sidechain', '侧链深度', 0, 1, 0.05],
  ['reverb', '混响发送', 0, 0.65, 0.05],
  ['delay', '延迟发送', 0, 0.6, 0.05],
  ['pan', '声像', -1, 1, 0.1],
  ['gainDb', '总线电平 dB', -30, 0, 1],
];
const names: Record<string, string> = {
  piano: '钢琴',
  kick: '底鼓',
  snare: '军鼓',
  hat: '踩镲',
  bass: '贝斯',
  lead: '主旋律',
  pad: '氛围',
};
export function MusicLab({
  block,
  initialState,
  onContext,
  onSave,
}: {
  block: any;
  initialState?: any;
  onContext?: (state: any) => void;
  onSave?: (state: any) => Promise<void>;
}) {
  const initial = () =>
    musicConfig.parse(
      initialState?.parameters ?? block.config ?? defaultMusicConfig(block.templateId),
    );
  const [config, setConfig] = useState(initial),
    [position, setPosition] = useState((initialState?.step ?? 0) / 4),
    [selected, setSelected] = useState<string[]>(initialState?.selectedIds ?? []);
  const [enabled, setEnabled] = useState(false),
    [playing, setPlaying] = useState(false),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState(''),
    [voice, setVoice] = useState<MusicNote['instrument']>('piano');
  const engine = useRef<MusicAudio | null>(null),
    root = useRef<HTMLElement>(null),
    plot = useRef<HTMLCanvasElement>(null),
    alive = useRef(true);
  const held = useRef(new Map<string, { end: (at?: number) => void }>()),
    deferred = useRef(new Set<string>()),
    pedal = useRef(false);
  const revision = useRef(0),
    current = useRef(config);
  current.current = config;
  const [meter, setMeter] = useState({ peak: -120, reduction: 0, response: '', lfoValue: 0 });
  const notes = sequence(config),
    panel = block.templateId.split('.')[1] as keyof typeof musicTitles;
  function stop() {
    engine.current?.stop();
    held.current.clear();
    deferred.current.clear();
    pedal.current = false;
    setPlaying(false);
  }
  useEffect(() => {
    alive.current = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) stop();
    });
    if (root.current) observer.observe(root.current);
    return () => {
      alive.current = false;
      observer.disconnect();
      void engine.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0,
      lastMeter = 0;
    const update = (now: number) => {
      const audio = engine.current;
      if (!audio) return;
      if (audio.playing) setPosition(audio.position());
      if (now - lastMeter > 90) {
        const data = audio.meter();
        lastMeter = now;
        setMeter({
          peak: data.peakDb,
          reduction: data.reduction,
          response: [...data.response]
            .map((m, i) => `${20 + i * 4.7},${55 - 20 * Math.log10(Math.max(m, 0.001)) * 1.8}`)
            .join(' '),
          lfoValue: data.lfoValue,
        });
        const canvas = plot.current,
          ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = '#8dccb2';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i < 640; i++) {
            const y = 40 - data.wave[Math.floor((i * data.wave.length) / 640)] * 35;
            if (!i) ctx.moveTo(i, y);
            else ctx.lineTo(i, y);
          }
          ctx.stroke();
          ctx.fillStyle = '#ddb473';
          for (let i = 0; i < 100; i++) {
            const index = Math.floor(2 ** ((i / 100) * Math.log2(data.spectrum.length - 1)));
            const h = Math.max(0, (data.spectrum[index] + 90) * 0.6);
            ctx.fillRect(i * 6.4, 150 - h, 4, h);
          }
        }
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);
  async function enable() {
    if (loading) return;
    setLoading(true);
    setMessage('正在校验并加载本地音色…');
    try {
      const audio = engine.current ?? new MusicAudio(current.current);
      engine.current = audio;
      audio.onStop = () => {
        if (alive.current) setPlaying(false);
      };
      await audio.prepare();
      await audio.ensureSamples(['piano', 'kick', 'snare', 'hat']);
      if (!alive.current) return;
      setEnabled(true);
      setMessage('声音已启用 · VCSL CC0 真实钢琴/鼓采样 + 内置合成器');
    } catch (e) {
      if (alive.current) {
        setMessage(e instanceof Error ? e.message : '音频不可用');
        await engine.current?.close();
        engine.current = null;
        setEnabled(false);
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  function change(patch: Partial<MusicConfig>) {
    const structural = [
      'bpm',
      'root',
      'minor',
      'inversion',
      'swing',
      'preset',
      'notes',
      'arrangement',
      'solo',
      'muted',
      'loop',
      'metronome',
      'filterAutomation',
    ].some((k) => k in patch);
    if (structural) {
      stop();
      setPosition(0);
      setSelected([]);
    }
    const next = musicConfig.parse({ ...config, ...patch });
    setConfig(next);
    engine.current?.apply(next);
    revision.current++;
  }
  function input(event: InputEvent) {
    const audio = engine.current;
    if (!audio || !enabled) return;
    if (event.pedal !== undefined) {
      pedal.current = event.pedal;
      if (!event.pedal) {
        for (const key of deferred.current) {
          held.current.get(key)?.end();
          held.current.delete(key);
        }
        deferred.current.clear();
      }
      return;
    }
    const instrument = event.drum
      ? ({ 36: 'kick', 38: 'snare', 42: 'hat' } as const)[event.pitch as 36]
      : voice;
    const key = `${instrument}:${event.pitch}`;
    if (!event.on) {
      if (pedal.current && !event.drum) deferred.current.add(key);
      else {
        if (!event.drum) held.current.get(key)?.end();
        held.current.delete(key);
      }
      return;
    }
    held.current.get(key)?.end();
    deferred.current.delete(key);
    try {
      held.current.set(
        key,
        audio.note(
          {
            id: 'input',
            instrument,
            pitch: event.pitch,
            beat: 0,
            duration: 1,
            velocity: event.velocity,
          },
          audio.context.currentTime,
          !event.drum,
        ),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '发声失败');
    }
  }
  const snapshot = () => ({
    templateId: block.templateId,
    templateVersion: block.templateVersion,
    parameters: config,
    selectedIds: selected,
    step: Math.floor(position * 4),
  });
  const envelopeScale = 300 / (config.attack + config.decay + 1 + config.release);
  const selectedNote = notes.find((n) => selected.includes(n.id));
  function editNote(patch: Partial<MusicNote>) {
    if (!selectedNote || notes.length > 64) {
      setMessage('请切换音阶/和弦片段，或先独奏一个声部再编辑（最多 64 个音符）');
      return;
    }
    change({
      arrangement: false,
      notes: notes.map((n) => (n.id === selectedNote.id ? { ...n, ...patch } : n)),
    });
  }
  return (
    <section ref={root} className="music-lab" aria-label={musicTitles[panel] ?? '音乐实验'}>
      <header>
        <span className="music-tag">EDM LAB · ABLETON LIVE 12</span>
        <h3>{musicTitles[panel] ?? '音乐实验'}</h3>
        <p>看见声音的结构，再把它变成自己的作品。</p>
      </header>
      <div className="music-controls">
        <select
          aria-label="音乐示例"
          value={config.preset}
          onChange={(e) =>
            change({
              preset: e.target.value as MusicConfig['preset'],
              notes: undefined,
              bpm: e.target.value === 'dnb' ? 174 : 128,
            })
          }
        >
          {Object.entries({
            scale: '音阶',
            chords: '和弦转位',
            bigroom: 'Big Room',
            progressive: 'Progressive · Festival',
            'progressive-deep': 'Progressive · 渐进',
            bounce: 'Melbourne Bounce',
            dnb: 'DnB',
          }).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <button type="button" disabled={loading} onClick={() => void enable()}>
          {loading ? '加载音色…' : enabled ? '声音已启用' : '启用声音'}
        </button>
        <button
          type="button"
          disabled={!enabled}
          onClick={() => {
            if (playing) stop();
            else {
              engine.current!.play(position >= musicLength(config) ? 0 : position);
              setPlaying(true);
            }
          }}
        >
          {playing ? '暂停' : '播放示范'}
        </button>
        <button
          type="button"
          onClick={() => {
            stop();
            setPosition((p) => Math.min(musicLength(config) - 0.25, Math.floor(p) + 1));
          }}
        >
          逐拍
        </button>
        <button
          type="button"
          onClick={() => {
            stop();
            setConfig(initial());
            engine.current?.apply(initial());
            setPosition(0);
            setSelected([]);
          }}
        >
          复位
        </button>
        <select
          aria-label="谱面显示"
          value={config.notation}
          onChange={(e) => change({ notation: e.target.value as 'staff' | 'number' })}
        >
          <option value="number">简谱</option>
          <option value="staff">五线谱</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={!!config.minor}
            onChange={(e) => change({ minor: e.target.checked ? 1 : 0 })}
          />
          小调
        </label>
        {(['loop', 'metronome', 'arrangement'] as const).map((k, i) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={config[k]}
              onChange={(e) => change({ [k]: e.target.checked })}
            />
            {['循环', '节拍器', '段落发展'][i]}
          </label>
        ))}
      </div>
      <p role="status" className="music-help">
        {message || '先启用声音，再试听或演奏。自由实验不计入掌握证据。'}
      </p>
      <input
        className="music-seek"
        aria-label="音乐播放位置"
        type="range"
        min="0"
        max={musicLength(config) - 0.25}
        step="0.25"
        value={position}
        onChange={(e) => {
          stop();
          setPosition(Number(e.target.value));
        }}
      />
      {config.arrangement && (
        <div className="music-sections">
          {['Intro · 节奏进入', '发展 · 和声加入', 'Build-up · 留出空间', 'Drop · 完整层次'].map(
            (label, i) => (
              <button
                className={Math.floor(position / 16) === i ? 'selected' : ''}
                key={label}
                onClick={() => {
                  stop();
                  setPosition(i * 16);
                }}
              >
                {label}
              </button>
            ),
          )}
        </div>
      )}
      {config.arrangement && (
        <>
          <label className="music-help">
            <input
              type="checkbox"
              checked={config.filterAutomation.length > 0}
              onChange={(e) =>
                change({ filterAutomation: e.target.checked ? buildUpAutomation() : [] })
              }
            />
            Build-up 滤波扫频自动化（覆盖静态截止）
          </label>
          <svg viewBox="0 0 640 175" role="img" aria-label="编排轨道时间线与滤波自动化">
            {instruments.map((instrument, row) => (
              <g key={instrument}>
                <text x="0" y={14 + row * 15} fontSize="10">
                  {names[instrument]}
                </text>
                {Array.from({ length: 16 }, (_, bar) => (
                  <rect
                    key={bar}
                    x={55 + bar * 36}
                    y={5 + row * 15}
                    width="33"
                    height="10"
                    fill="#33715b"
                    opacity={Math.min(
                      1,
                      notes.filter(
                        (n) => n.instrument === instrument && Math.floor(n.beat / 4) === bar,
                      ).length / 5,
                    )}
                  />
                ))}
              </g>
            ))}
            <text x="0" y="138" fontSize="10">
              截止 Hz
            </text>
            <polyline
              points={config.filterAutomation
                .map((p) => `${55 + p.beat * 9},${165 - (p.value / 16000) * 50}`)
                .join(' ')}
              fill="none"
              stroke="#d48231"
              strokeWidth="2"
            />
            <line x1={55 + position * 9} x2={55 + position * 9} y1="0" y2="175" stroke="#d48231" />
          </svg>
        </>
      )}
      <MusicScore
        notes={notes}
        position={position}
        root={config.root}
        notation={config.notation}
        selected={selected}
        onSelect={(id) => setSelected([id])}
      />
      {selectedNote && (
        <div className="music-controls">
          <span>
            {names[selectedNote.instrument]} · {pitchName(selectedNote.pitch)} ·{' '}
            {selectedNote.duration} 拍
          </span>
          <button onClick={() => editNote({ pitch: Math.min(108, selectedNote.pitch + 1) })}>
            升半音
          </button>
          <button onClick={() => editNote({ pitch: Math.max(21, selectedNote.pitch - 1) })}>
            降半音
          </button>
          <button onClick={() => editNote({ velocity: selectedNote.velocity > 60 ? 40 : 100 })}>
            切换重音
          </button>
        </div>
      )}
      <div className="music-tracks">
        {instruments.map((i) => (
          <div key={i}>
            <div className="music-track-buttons">
              <span>{names[i]}</span>
              <button
                aria-pressed={config.muted.includes(i)}
                onClick={() =>
                  change({
                    muted: config.muted.includes(i)
                      ? config.muted.filter((x) => x !== i)
                      : [...config.muted, i],
                  })
                }
              >
                静音
              </button>
              <button
                aria-pressed={config.solo === i}
                onClick={() => change({ solo: config.solo === i ? null : i })}
              >
                独奏
              </button>
              <button
                onClick={() => {
                  const part = notes.filter((n) => n.instrument === i && n.beat < 16);
                  change({ notes: part.slice(0, 64), arrangement: false, solo: null });
                }}
              >
                编辑片段
              </button>
            </div>
            <label>
              电平 {config.trackGains[i]} dB
              <input
                aria-label={`${names[i]}电平`}
                type="range"
                min={-30}
                max={6}
                step={1}
                value={config.trackGains[i]}
                onChange={(e) =>
                  change({ trackGains: { ...config.trackGains, [i]: Number(e.target.value) } })
                }
              />
            </label>
            <label>
              声像 {config.trackPans[i]}
              <input
                aria-label={`${names[i]}声像`}
                type="range"
                min={-1}
                max={1}
                step={0.1}
                value={config.trackPans[i]}
                onChange={(e) =>
                  change({ trackPans: { ...config.trackPans, [i]: Number(e.target.value) } })
                }
              />
            </label>
          </div>
        ))}
      </div>
      <div className="music-drum-grid" aria-label="鼓机步进格">
        {(['kick', 'snare', 'hat'] as const).map((instrument, row) => (
          <div key={instrument}>
            <span>{names[instrument]}</span>
            {Array.from({ length: 16 }, (_, tick) => {
              const hit = notes.some(
                (n) => n.instrument === instrument && Math.round(n.beat * 4) === tick,
              );
              return (
                <button
                  key={tick}
                  aria-label={`${instrument} 第 ${tick + 1} 格`}
                  aria-pressed={hit}
                  onClick={() => {
                    let next = notes.filter(
                      (n) => n.beat < 4 && ['kick', 'snare', 'hat'].includes(n.instrument),
                    );
                    next = next.filter(
                      (n) => !(n.instrument === instrument && Math.round(n.beat * 4) === tick),
                    );
                    if (!hit)
                      next.push({
                        id: `edit-${instrument}-${tick}`,
                        instrument,
                        pitch: [36, 38, 42][row],
                        beat: tick / 4,
                        duration: 0.2,
                        velocity: 96,
                      });
                    change({ notes: next, arrangement: false });
                  }}
                >
                  {tick % 4 === 0 ? tick / 4 + 1 : '·'}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <details open={['synth', 'mixing'].includes(panel)}>
        <summary>音色与混音控制</summary>
        <div className="music-controls">
          <label>
            波形
            <select
              aria-label="振荡器波形"
              value={config.waveform}
              onChange={(e) => change({ waveform: e.target.value as MusicConfig['waveform'] })}
            >
              {['sine', 'triangle', 'sawtooth', 'square'].map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.bypass}
              onChange={(e) => change({ bypass: e.target.checked })}
            />
            旁通混音效果
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.matchLoudness}
              onChange={(e) => change({ matchLoudness: e.target.checked })}
            />
            RMS 响度匹配
          </label>
        </div>
        <div className="music-parameters">
          {controls.map(([key, label, min, max, step]) => (
            <label key={key}>
              {label}
              <output>{String(config[key])}</output>
              <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                step={step}
                value={config[key] as number}
                onChange={(e) => change({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
      </details>
      {!['synth', 'mixing'].includes(panel) && (
        <div className="music-controls">
          <label>
            速度 BPM
            <input
              aria-label="练习速度"
              type="number"
              min="40"
              max="200"
              value={config.bpm}
              onChange={(e) => {
                const bpm = Number(e.target.value);
                if (bpm >= 40 && bpm <= 200) change({ bpm });
              }}
            />
          </label>
        </div>
      )}
      <div className="music-analysis">
        <canvas ref={plot} width="640" height="160" aria-label="实际声音波形与对数频谱" />
        <div>
          <strong>{meter.peak.toFixed(1)} dBFS</strong>
          <span>峰值 · 压缩 {meter.reduction.toFixed(1)} dB</span>
          <span>上：时域波形　下：频谱</span>
        </div>
      </div>
      <svg
        className="music-curves"
        viewBox="0 0 640 100"
        role="img"
        aria-label="实际 EQ 响应与 LFO 信号"
      >
        <text x="20" y="14">
          EQ 响应 · 40 Hz–12 kHz
        </text>
        <line x1="20" x2="316" y1="55" y2="55" stroke="#d0dbd3" />
        <polyline points={meter.response} fill="none" stroke="#33715b" strokeWidth="2" />
        <text x="350" y="14">
          LFO 最近声部 · {config.lfoRate} Hz / {config.lfoDepth} Hz 深度
        </text>
        <polyline
          points={Array.from(
            { length: 65 },
            (_, i) => `${350 + i * 4},${55 - Math.sin((i / 64) * 2 * Math.PI) * 25}`,
          ).join(' ')}
          fill="none"
          stroke="#99b1a2"
        />
        <circle cx={478} cy={55 - meter.lfoValue * 25} r="4" fill="#d48231" />
      </svg>
      <svg
        className="music-curves"
        viewBox="0 0 640 95"
        role="img"
        aria-label="ADSR 包络与压缩曲线"
      >
        <text x="8" y="14">
          ADSR
        </text>
        <polyline
          points={`10,85 ${10 + config.attack * envelopeScale},25 ${10 + (config.attack + config.decay) * envelopeScale},${85 - config.sustain * 60} ${10 + (config.attack + config.decay + 1) * envelopeScale},${85 - config.sustain * 60} 310,85`}
          fill="none"
          stroke="#33715b"
          strokeWidth="2"
        />
        <text x="360" y="14">
          输入 / 输出压缩曲线
        </text>
        <polyline
          points={Array.from({ length: 49 }, (_, i) => {
            const db = i - 48,
              out =
                db <= config.threshold
                  ? db
                  : config.threshold + (db - config.threshold) / (config.bypass ? 1 : config.ratio);
            return `${370 + i * 5},${85 - (out + 48) * 1.3}`;
          }).join(' ')}
          fill="none"
          stroke="#d48231"
          strokeWidth="2"
        />
      </svg>
      <div className="music-controls">
        <label>
          演奏音色
          <select
            value={voice}
            onChange={(e) => {
              stop();
              setVoice(e.target.value as MusicNote['instrument']);
            }}
          >
            {['piano', 'lead', 'bass', 'pad'].map((v) => (
              <option key={v} value={v}>
                {names[v]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <MusicInput
        highlighted={
          playing
            ? notes
                .filter(
                  (n) =>
                    n.beat <= position &&
                    n.beat + n.duration > position &&
                    !config.muted.includes(n.instrument) &&
                    (!config.solo || config.solo === n.instrument),
                )
                .map((n) => n.pitch)
            : []
        }
        disabled={!enabled}
        onInput={input}
        onInterrupt={stop}
      />
      <footer className="music-controls">
        <button
          onClick={() =>
            onContext?.({
              ...snapshot(),
              runRevision: revision.current,
              observables: { values: musicSummary(config, Math.floor(position * 4)) },
            })
          }
        >
          引用音乐提问 ↗
        </button>
        {onSave && (
          <button
            onClick={() =>
              void onSave(snapshot())
                .then(() => setMessage('音乐快照已保存'))
                .catch((e) => setMessage(e.message))
            }
          >
            保存音乐快照
          </button>
        )}
        <button
          onClick={() =>
            download(
              midiFile(notes, config.bpm),
              `${config.preset}-${config.bpm}bpm.mid`,
              'audio/midi',
            )
          }
        >
          下载 MIDI
        </button>
        <button
          disabled={!enabled || loading}
          onClick={async () => {
            setLoading(true);
            try {
              await engine.current!.ensureSamples(notes.map((n) => n.instrument));
              download(
                await engine.current!.exportDry(),
                `${config.preset}-${config.bpm}bpm-dry.wav`,
                'audio/wav',
              );
              setMessage('已导出干声教学素材；混音效果请在 Live 中练习复现。');
            } catch (e) {
              setMessage(e instanceof Error ? e.message : '导出失败');
            } finally {
              setLoading(false);
            }
          }}
        >
          下载 WAV 干声
        </button>
        <a
          href="https://www.ableton.com/en/manual/welcome-to-live/"
          target="_blank"
          rel="noreferrer"
        >
          Live 12 手册
        </a>
        {['kick', 'snare', 'hat'].map((id) => (
          <a key={id} href={'/music/' + id + '.wav'} download>
            {names[id]}采样 WAV
          </a>
        ))}
      </footer>
      <p className="music-help">
        真实采样：VCSL ·
        CC0。简化的合成器与混音模型用于理解原理；参数范围不是固定混音配方。当前片段可下载到
        Live，Suite 扩展设备见课程操作卡。
      </p>
    </section>
  );
}
