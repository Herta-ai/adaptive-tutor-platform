'use client';
import { useEffect, useRef, useState } from 'react';
import { MusicAudio } from '../music/audio';
import { musicConfig, type PerformanceAnswer, type MusicNote } from '../music/model';
import { MusicInput, type InputEvent } from './music-input';
import { MusicScore } from './music-score';

export function MusicPerformance({
  score,
  disabled,
  onAnswer,
  onHint,
}: {
  score: { bpm: number; notes: MusicNote[] };
  disabled: boolean;
  onAnswer: (answer: string) => void;
  onHint: () => Promise<void>;
}) {
  const audio = useRef<MusicAudio | null>(null),
    events = useRef<PerformanceAnswer['events']>([]),
    start = useRef(0),
    recording = useRef(false),
    frame = useRef(0),
    alive = useRef(true);
  const held = useRef(new Map<string, { voice: { end: () => void }; event: number }>()),
    deferred = useRef(new Set<string>()),
    pedal = useRef(false);
  const [ready, setReady] = useState(false),
    [running, setRunning] = useState(false),
    [message, setMessage] = useState('先启用声音，然后跟随四拍预备开始。'),
    [position, setPosition] = useState(0),
    [calibration, setCalibration] = useState(0),
    [notation, setNotation] = useState<'staff' | 'number'>('number'),
    [busy, setBusy] = useState(false);
  const report = useRef(onAnswer);
  report.current = onAnswer;
  const duration = Math.max(...score.notes.map((n) => n.beat + n.duration)) + 1;
  const config = () =>
    musicConfig.parse({
      bpm: score.bpm,
      notes: score.notes,
      loop: false,
      reverb: 0,
      delay: 0,
      sidechain: 0,
    });
  function interrupt() {
    cancelAnimationFrame(frame.current);
    audio.current?.stop();
    held.current.clear();
    deferred.current.clear();
    pedal.current = false;
    if (recording.current) {
      recording.current = false;
      report.current('');
      setMessage('练习已中断，请重新开始；本次不会提交成绩。');
    }
    setRunning(false);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelAnimationFrame(frame.current);
      void audio.current?.close();
    };
  }, []);
  useEffect(() => {
    if (disabled) interrupt();
  }, [disabled]);
  async function prepare() {
    setBusy(true);
    try {
      const engine = audio.current ?? new MusicAudio(config());
      audio.current = engine;
      engine.onStop = () => {
        if (recording.current && alive.current) {
          recording.current = false;
          cancelAnimationFrame(frame.current);
          setRunning(false);
          report.current('');
          setMessage('声音被停止，正式练习已中断，请重新开始。');
        }
      };
      await engine.prepare();
      await engine.ensureSamples(['piano', 'kick', 'snare', 'hat']);
      if (alive.current) {
        setReady(true);
        setMessage('声音就绪；正式练习期间不能改变速度和校准。');
      }
    } catch (e) {
      if (alive.current) {
        setMessage(e instanceof Error ? e.message : '声音无法启用');
        await audio.current?.close();
        audio.current = null;
        setReady(false);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function begin(event: { currentTarget: HTMLButtonElement }) {
    // Keep focus inside the instrument when the start button becomes disabled.
    // Otherwise the browser's focusout would correctly interrupt the new take.
    event.currentTarget.closest('section')?.querySelector<HTMLButtonElement>('.music-key')?.focus();
    interrupt();
    report.current('');
    events.current = [];
    const engine = audio.current!;
    engine.apply(config());
    engine.activate();
    const beatSeconds = 60 / score.bpm;
    start.current = engine.context.currentTime + 0.15 + 4 * beatSeconds;
    recording.current = true;
    setRunning(true);
    let nextClick = -4;
    const tick = () => {
      if (!recording.current || !alive.current) return;
      const now = engine.context.currentTime,
        beat = (now - start.current) / beatSeconds;
      while (nextClick <= duration && start.current + nextClick * beatSeconds < now + 0.12) {
        engine.click(Math.max(now, start.current + nextClick * beatSeconds), nextClick % 4 === 0);
        nextClick++;
      }
      setPosition(Math.max(0, beat));
      setMessage(
        beat < 0 ? `预备 ${Math.ceil(-beat)} 拍` : `正在记录 · 第 ${Math.floor(beat) + 1} 拍`,
      );
      if (beat >= duration) {
        recording.current = false;
        setRunning(false);
        engine.stop();
        const answer: PerformanceAnswer = {
          events: events.current,
          calibrationMs: calibration,
          completed: true,
        };
        report.current(JSON.stringify(answer));
        setMessage(
          `已记录 ${events.current.length} 次起音。点击“提交答案”获取评分；提交前可重新录制。`,
        );
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  function input(e: InputEvent) {
    if (!ready || !audio.current || disabled) return;
    const engine = audio.current;
    if (e.pedal !== undefined) {
      pedal.current = e.pedal;
      if (!e.pedal) {
        for (const k of deferred.current) {
          held.current.get(k)?.voice.end();
          held.current.delete(k);
        }
        deferred.current.clear();
      }
      return;
    }
    const instrument: MusicNote['instrument'] = e.drum
      ? ({ 36: 'kick', 38: 'snare', 42: 'hat' } as const)[e.pitch as 36]
      : 'piano';
    const key = `${instrument}:${e.pitch}`,
      entry = held.current.get(key);
    const timeMs =
      (engine.context.currentTime - start.current) * 1000 +
      (e.timestamp === undefined ? 0 : e.timestamp - performance.now());
    if (!e.on) {
      if (entry && events.current[entry.event])
        events.current[entry.event].durationMs = Math.max(
          0,
          timeMs - events.current[entry.event].timeMs,
        );
      if (pedal.current && !e.drum) deferred.current.add(key);
      else {
        if (!e.drum) entry?.voice.end();
        held.current.delete(key);
      }
      return;
    }
    entry?.voice.end();
    deferred.current.delete(key);
    const v = engine.note(
      { id: 'attempt', pitch: e.pitch, instrument, velocity: e.velocity, beat: 0, duration: 0.5 },
      engine.context.currentTime,
      !e.drum,
    );
    let index = -1;
    if (recording.current && timeMs >= -150 && events.current.length < 512) {
      index = events.current.length;
      events.current.push({ pitch: e.pitch, instrument, velocity: e.velocity, timeMs });
    }
    held.current.set(key, { voice: v, event: index });
  }
  return (
    <section className="music-lab music-assessment" aria-label="正式演奏练习">
      <header>
        <span className="music-tag">独立演奏练习 · {score.bpm} BPM</span>
        <h3>看谱，听预备拍，然后演奏</h3>
      </header>
      <div className="music-controls">
        <button disabled={busy || disabled} onClick={() => void prepare()}>
          {ready ? '声音就绪' : '启用练习声音'}
        </button>
        <button disabled={!ready || running || disabled} onClick={begin}>
          开始正式练习
        </button>
        <button disabled={!running} onClick={interrupt}>
          中断重来
        </button>
        <button
          disabled={!ready || running || disabled}
          onClick={async () => {
            try {
              await onHint();
              audio.current!.apply(config());
              audio.current!.play();
              setMessage('已试听提示；本题不再计独立掌握证据。');
            } catch (e) {
              setMessage(e instanceof Error ? e.message : '提示请求失败');
            }
          }}
        >
          试听示范（提示）
        </button>
        <select
          aria-label="练习谱面"
          value={notation}
          onChange={(e) => setNotation(e.target.value as 'staff' | 'number')}
        >
          <option value="number">简谱</option>
          <option value="staff">五线谱</option>
        </select>
        <label>
          输入延迟补偿 ms
          <input
            aria-label="输入延迟补偿"
            type="number"
            min="-250"
            max="250"
            step="5"
            value={calibration}
            disabled={running || disabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= -250 && n <= 250) {
                setCalibration(n);
                report.current('');
              }
            }}
          />
        </label>
      </div>
      <p className="music-help">
        若设备输入持续偏晚，填正数补偿；先用节拍器校准。鼓题用鼓垫/电子鼓，旋律题用钢琴。谱面本身是题目；试听属于提示。
      </p>
      <MusicScore
        notes={score.notes}
        position={position}
        root={60}
        notation={notation}
        selected={[]}
        onSelect={() => {}}
      />
      <MusicInput disabled={!ready || disabled} onInput={input} onInterrupt={interrupt} />
      <p role="status">{message}</p>
    </section>
  );
}
