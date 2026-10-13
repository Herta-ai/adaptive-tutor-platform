'use client';
import { useEffect, useRef, useState } from 'react';
import { numberedPitch, pitchName, type MusicNote } from '../music/model';
import { notationVoice } from '../music/notation';
export function MusicScore({
  notes,
  position,
  root,
  notation,
  selected,
  onSelect,
}: {
  notes: MusicNote[];
  position: number;
  root: number;
  notation: 'number' | 'staff';
  selected: string[];
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    [error, setError] = useState('');
  const bar = Math.floor(position / 4),
    visible = notes.filter(
      (n) =>
        n.beat < (bar + 1) * 4 &&
        n.beat + n.duration > bar * 4 &&
        !['kick', 'snare', 'hat'].includes(n.instrument),
    );
  const signature = JSON.stringify(notes);
  useEffect(() => {
    let canceled = false;
    if (notation !== 'staff' || !container.current) return;
    void import('vexflow/bravura')
      .then(async ({ Renderer, Stave, StaveNote, Formatter, Accidental, Voice, StaveTie }) => {
        // Bravura entry bundles offline fonts; wait before measuring glyphs.
        await Promise.all([
          document.fonts.load('16px Bravura'),
          document.fonts.load('16px Academico'),
        ]);
        if (!document.fonts.check('16px Bravura')) throw Error('音乐字体未加载');
        if (canceled || !container.current) return;
        container.current.replaceChildren();
        setError('');
        const parts = [
          ...new Set(
            notes
              .filter((n) => !['kick', 'snare', 'hat'].includes(n.instrument))
              .map((n) => n.instrument),
          ),
        ];
        if (!parts.length) parts.push('piano');
        const renderer = new Renderer(container.current, Renderer.Backends.SVG);
        renderer.resize(650, parts.length * 120);
        const ctx = renderer.getContext();
        for (let part = 0; part < parts.length; part++) {
          const clef = parts[part] === 'bass' ? 'bass' : 'treble';
          const stave = new Stave(12, part * 120 + 8, 620).addClef(clef).addTimeSignature('4/4');
          stave.setContext(ctx).draw();
          ctx.fillText(parts[part], 90, part * 120 + 20);
          const tokens = notationVoice(
            notes.filter((n) => n.instrument === parts[part]),
            bar,
          );
          const accidentals = new Map<string, boolean>();
          const cells = tokens.map((token) => {
            const pitches = token.pitches;
            const keys = pitches.map(
              (p) =>
                `${['c', 'c', 'd', 'd', 'e', 'f', 'f', 'g', 'g', 'a', 'a', 'b'][p % 12]}/${Math.floor(p / 12) - 1}`,
            );
            const duration = (
              { 1: '16', 2: '8', 4: 'q', 8: 'h', 16: 'w' } as Record<number, string>
            )[token.ticks];
            const note = new StaveNote({
              clef,
              keys: keys.length ? keys : [clef === 'bass' ? 'd/3' : 'b/4'],
              duration: duration + (keys.length ? '' : 'r'),
            });
            pitches.forEach((p, i) => {
              const sharp = [1, 3, 6, 8, 10].includes(p % 12);
              if (sharp) note.addModifier(new Accidental('#'), i);
              else if (accidentals.get(keys[i])) note.addModifier(new Accidental('n'), i);
              accidentals.set(keys[i], sharp);
            });
            return note;
          });
          const voice = new Voice({ numBeats: 4, beatValue: 4 }).addTickables(cells);
          new Formatter().joinVoices([voice]).format([voice], 510);
          voice.draw(ctx, stave);
          tokens.forEach((t, i) => {
            if (t.tie && i > 0)
              new StaveTie({
                firstNote: cells[i - 1],
                lastNote: cells[i],
                firstIndexes: t.pitches.map((_, j) => j),
                lastIndexes: t.pitches.map((_, j) => j),
              })
                .setContext(ctx)
                .draw();
          });
        }
      })
      .catch(() => {
        if (!canceled) setError('五线谱加载失败；下方钢琴卷帘与音名仍可使用。');
      });
    return () => {
      canceled = true;
    };
  }, [notation, signature, bar]);
  return (
    <div className="music-score">
      <div className="music-score-heading">
        <span>
          第 {bar + 1} 小节 · 第 {((position % 4) + 1).toFixed(1)} 拍
        </span>
        <span>1 = {pitchName(root)} · 时值见卷帘长度</span>
      </div>
      {notation === 'staff' ? (
        <>
          <div ref={container} className="music-staff" />
          <p className="music-help">
            按声部分行，显示音符、休止与延音线。谱面量化到十六分音符；Swing 和门限时值见卷帘。
          </p>
          {error && <p role="alert">{error}</p>}
        </>
      ) : (
        <div className="music-number">
          {visible.map((n) => (
            <button
              type="button"
              key={n.id}
              className={selected.includes(n.id) ? 'selected' : ''}
              onClick={() => onSelect(n.id)}
              title={`${pitchName(n.pitch)} · ${n.duration} 拍`}
            >
              <strong>{numberedPitch(n.pitch, root)}</strong>
              <small>
                {((n.beat % 4) + 1).toFixed(2)} 拍 / {n.duration} 拍
              </small>
            </button>
          ))}
          {!visible.length && <span>休止 / 鼓节奏小节</span>}
        </div>
      )}
      <svg viewBox="0 0 640 180" role="img" aria-label="钢琴卷帘与当前播放位置">
        {Array.from({ length: 17 }, (_, i) => (
          <line
            key={i}
            x1={i * 40}
            x2={i * 40}
            y1="0"
            y2="180"
            stroke={i % 4 ? '#dfe8e3' : '#9aad9f'}
          />
        ))}
        {notes
          .filter((n) => n.beat < (bar + 1) * 4 && n.beat + n.duration > bar * 4)
          .map((n) => {
            const drums = ['kick', 'snare', 'hat'].includes(n.instrument),
              y = drums
                ? 135 + ['kick', 'snare', 'hat'].indexOf(n.instrument) * 13
                : 125 - (n.pitch - 36) * 1.6;
            return (
              <g
                key={n.id}
                onClick={() => onSelect(n.id)}
                role="button"
                tabIndex={0}
                aria-label={`${n.instrument} ${pitchName(n.pitch)} 第 ${n.beat + 1} 拍`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSelect(n.id);
                }}
              >
                <rect
                  x={Math.max(0, n.beat - bar * 4) * 160}
                  y={Math.max(0, y)}
                  width={Math.max(
                    4,
                    (Math.min(n.beat + n.duration, (bar + 1) * 4) - Math.max(n.beat, bar * 4)) *
                      160 -
                      2,
                  )}
                  height="10"
                  rx="3"
                  fill={selected.includes(n.id) ? '#d48231' : drums ? '#5889a3' : '#33715b'}
                />
                <title>
                  {pitchName(n.pitch)} · {n.instrument}
                </title>
              </g>
            );
          })}
        <line
          x1={(position % 4) * 160}
          x2={(position % 4) * 160}
          y1="0"
          y2="180"
          stroke="#d48231"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}
