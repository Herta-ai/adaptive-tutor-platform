import { z } from 'zod';

export const instruments = ['piano', 'kick', 'snare', 'hat', 'bass', 'lead', 'pad'] as const;
export const genres = ['bigroom', 'progressive', 'bounce', 'dnb'] as const;
export type Genre = (typeof genres)[number];
export const musicNote = z.strictObject({
  id: z.string().min(1).max(40),
  instrument: z.enum(instruments),
  pitch: z.number().int().min(21).max(108),
  beat: z.number().finite().min(0).max(255.75),
  duration: z.number().finite().min(0.125).max(16),
  velocity: z.number().int().min(1).max(127),
});
export type MusicNote = z.infer<typeof musicNote>;
export const musicConfig = z
  .strictObject({
    bank: z.literal('vcsl-1').default('vcsl-1'),
    preset: z.enum(['scale', 'chords', ...genres, 'progressive-deep']).default('bigroom'),
    bpm: z.number().min(40).max(200).default(128),
    root: z.number().int().min(48).max(72).default(60),
    minor: z.number().int().min(0).max(1).default(0),
    inversion: z.number().int().min(0).max(2).default(0),
    swing: z.number().min(0).max(0.45).default(0),
    waveform: z.enum(['sine', 'triangle', 'sawtooth', 'square']).default('sawtooth'),
    detune: z.number().min(0).max(40).default(9),
    cutoff: z.number().min(80).max(16000).default(6000),
    resonance: z.number().min(0.1).max(12).default(0.7),
    attack: z.number().min(0.005).max(2).default(0.01),
    decay: z.number().min(0.02).max(2).default(0.2),
    sustain: z.number().min(0.05).max(1).default(0.5),
    release: z.number().min(0.02).max(3).default(0.25),
    lfoRate: z.number().min(0.1).max(12).default(1),
    lfoDepth: z.number().min(0).max(3000).default(0),
    eqGain: z.number().min(-18).max(18).default(0),
    eqFrequency: z.number().min(40).max(12000).default(400),
    threshold: z.number().min(-48).max(0).default(-18),
    ratio: z.number().min(1).max(12).default(3),
    sidechain: z.number().min(0).max(1).default(0.5),
    reverb: z.number().min(0).max(0.65).default(0.15),
    delay: z.number().min(0).max(0.6).default(0.1),
    pan: z.number().min(-1).max(1).default(0),
    trackGains: z
      .record(z.enum(instruments), z.number().min(-30).max(6))
      .default({ piano: 0, kick: 0, snare: -3, hat: -6, bass: -3, lead: -3, pad: -6 }),
    trackPans: z
      .record(z.enum(instruments), z.number().min(-1).max(1))
      .default({ piano: 0, kick: 0, snare: 0, hat: 0.15, bass: 0, lead: 0, pad: -0.15 }),
    gainDb: z.number().min(-30).max(0).default(-12),
    bypass: z.boolean().default(false),
    matchLoudness: z.boolean().default(true),
    arrangement: z.boolean().default(false),
    filterAutomation: z
      .array(
        z.strictObject({ beat: z.number().min(0).max(64), value: z.number().min(80).max(16000) }),
      )
      .max(32)
      .default([]),
    loop: z.boolean().default(true),
    metronome: z.boolean().default(false),
    notation: z.enum(['staff', 'number']).default('number'),
    muted: z.array(z.enum(instruments)).max(7).default([]),
    solo: z.enum(instruments).nullable().default(null),
    notes: z.array(musicNote).max(64).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.filterAutomation.some((p, i) => i > 0 && p.beat <= c.filterAutomation[i - 1].beat))
      ctx.addIssue({
        code: 'custom',
        message: '自动化拍位必须严格递增',
        path: ['filterAutomation'],
      });
    if (c.notes && new Set(c.notes.map((n) => n.id)).size !== c.notes.length)
      ctx.addIssue({ code: 'custom', message: '音符 ID 重复', path: ['notes'] });
    if (c.notes?.some((n) => n.beat + n.duration > 16))
      ctx.addIssue({ code: 'custom', message: '练习片段限制为四小节', path: ['notes'] });
  });
export type MusicConfig = z.infer<typeof musicConfig>;
export const midiFrequency = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);
export const pitchName = (pitch: number) =>
  ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12] +
  (Math.floor(pitch / 12) - 1);
export function numberedPitch(pitch: number, root: number) {
  const semitone = (((pitch - root) % 12) + 12) % 12;
  const degree = ['1', '♯1', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'][semitone];
  const octave = Math.floor((pitch - root) / 12);
  return degree + (octave > 0 ? '̇'.repeat(octave) : octave < 0 ? '̣'.repeat(-octave) : '');
}
export function chord(root: number, minor = false, inversion = 0) {
  const notes = [root, root + (minor ? 3 : 4), root + 7];
  for (let i = 0; i < inversion; i++) notes.push(notes.shift()! + 12);
  return notes;
}
export function sequence(c: MusicConfig): MusicNote[] {
  const notes: MusicNote[] = [];
  const add = (
    instrument: MusicNote['instrument'],
    pitch: number,
    beat: number,
    duration = 0.25,
    velocity = 96,
  ) => {
    const swung = beat + (Math.round(beat * 2) % 2 === 1 ? c.swing * 0.5 : 0);
    notes.push({
      id: `${instrument}-${notes.length}`,
      instrument,
      pitch,
      beat: swung,
      duration,
      velocity,
    });
  };
  if (c.notes) notes.push(...c.notes);
  else if (c.preset === 'scale') {
    (c.minor ? [0, 2, 3, 5, 7, 8, 10, 12] : [0, 2, 4, 5, 7, 9, 11, 12]).forEach((p, i) =>
      add('piano', c.root + p, i, 0.8),
    );
  } else if (c.preset === 'chords') {
    [0, 5, 7, 0].forEach((p, i) =>
      chord(c.root + p, !!c.minor, c.inversion).forEach((n) => add('piano', n, i * 4, 3.5)),
    );
  } else {
    for (let bar = 0; bar < 4; bar++) {
      const t = bar * 4,
        dnb = c.preset === 'dnb',
        bounce = c.preset === 'bounce';
      (dnb ? [0, 2.5] : [0, 1, 2, 3]).forEach((b) => add('kick', 36, t + b));
      [1, 3].forEach((b) => add('snare', 38, t + b));
      for (let j = 0; j < 8; j++) add('hat', 42, t + j / 2, 0.15, j % 2 ? 65 : 95);
      if (dnb) add('snare', 38, t + 2.75, 0.125, 35);
      if (bar === 3) [3.5, 3.75].forEach((b) => add('snare', 38, t + b, 0.125, 70));
      const root = c.root + [0, -3, 5, 7][bar];
      (bounce ? [0.5, 1.5, 2.5, 3.5] : dnb ? [0, 1.75, 2.5] : [0, 1.5, 2, 3.5]).forEach((b) =>
        add('bass', root - 12, t + b, bounce ? 0.3 : 0.45),
      );
      chord(root, !!c.minor, c.inversion).forEach((p) => add('pad', p, t, 3.8, 55));
      const motif =
        c.preset === 'bigroom'
          ? [7, 7, 3, 0]
          : c.preset === 'progressive-deep'
            ? [0, 2, 7, 4]
            : [0, 7, 12, 7];
      motif.forEach((p, i) =>
        add(
          'lead',
          Math.min(108, c.root + p + 12),
          t + i,
          c.preset === 'progressive-deep' ? 0.7 : 0.4,
          82,
        ),
      );
    }
  }
  if (!c.arrangement) return notes;
  // Sixteen bars: the same motif develops through four four-bar sections.
  return Array.from({ length: 4 }, (_, section) =>
    notes
      .filter((n) =>
        section === 0
          ? ['kick', 'hat'].includes(n.instrument)
          : section === 1
            ? n.instrument !== 'lead'
            : section === 2
              ? n.instrument !== 'bass'
              : true,
      )
      .map((n) => ({
        ...n,
        id: `${section}:${n.id}`,
        beat: n.beat + section * 16,
        velocity: section === 2 ? Math.round(n.velocity * 0.8) : n.velocity,
      })),
  ).flat();
}
export const musicLength = (c: MusicConfig) => (c.arrangement ? 64 : 16);
export function automatedCutoff(c: MusicConfig, beat: number) {
  const points = c.filterAutomation;
  if (!points.length) return c.cutoff;
  if (beat <= points[0].beat) return points[0].value;
  const next = points.findIndex((p) => p.beat > beat);
  if (next < 0) return points.at(-1)!.value;
  const a = points[next - 1],
    b = points[next];
  return a.value + ((b.value - a.value) * (beat - a.beat)) / (b.beat - a.beat);
}
export const buildUpAutomation = () => [
  { beat: 0, value: 6000 },
  { beat: 31, value: 6000 },
  { beat: 32, value: 300 },
  { beat: 48, value: 10000 },
  { beat: 64, value: 10000 },
];
export function musicSummary(c: MusicConfig, step: number) {
  const notes = sequence(c);
  return {
    bpm: c.bpm,
    bar: Math.floor(step / 16) + 1,
    beat: ((step / 4) % 4) + 1,
    noteCount: notes.length,
    rootHz: midiFrequency(c.root),
    cutoff: automatedCutoff(c, step / 4),
    eqGain: c.eqGain,
    threshold: c.threshold,
    ratio: c.ratio,
  };
}
/** A bounded tutor view: retain editable sound controls, never serialize the score. */
export function musicTutorState(input: unknown, selectedIds: string[] = []) {
  const config = musicConfig.parse(input),
    { notes: _notes, ...parameters } = config;
  return {
    parameters,
    selectedNotes: sequence(config)
      .filter((n) => selectedIds.includes(n.id))
      .slice(0, 8),
  };
}
export const performanceScore = z
  .strictObject({
    bpm: z.number().finite().min(40).max(200),
    notes: z.array(musicNote).min(1).max(64),
  })
  .superRefine((s, ctx) => {
    if (
      s.notes.some((n) => n.beat + n.duration > 16) ||
      new Set(s.notes.map((n) => n.id)).size !== s.notes.length
    )
      ctx.addIssue({ code: 'custom', message: '正式演奏谱限制四小节，音符 ID 不可重复' });
    if (s.notes.some((n) => !['piano', 'kick', 'snare', 'hat'].includes(n.instrument)))
      ctx.addIssue({ code: 'custom', message: '正式演奏只使用钢琴或标准鼓件输入' });
  });
export const performanceAnswer = z.strictObject({
  events: z
    .array(
      z.strictObject({
        pitch: z.number().int().min(0).max(127),
        instrument: z.enum(instruments),
        timeMs: z.number().finite().min(-1000).max(120000),
        velocity: z.number().int().min(1).max(127),
        durationMs: z.number().finite().min(0).max(120000).optional(),
      }),
    )
    .max(512),
  calibrationMs: z.number().finite().min(-250).max(250),
  completed: z.literal(true),
});
export type PerformanceAnswer = z.infer<typeof performanceAnswer>;
export function gradePerformance(score: z.infer<typeof performanceScore>, input: unknown) {
  const a = performanceAnswer.parse(input),
    beatMs = 60000 / score.bpm;
  const windowMs = Math.max(60, Math.min(150, beatMs / 4));
  // Maximum-cardinality, chronological matching per pitch/voice; repeated notes cannot
  // consume two expected attacks. Rejecting surplus hits discourages key spamming.
  const used = new Set<number>(),
    offsets: number[] = [];
  for (const n of [...score.notes].sort((x, y) => x.beat - y.beat)) {
    const candidates = a.events
      .map((e, i) => ({ e, i, delta: e.timeMs - a.calibrationMs - n.beat * beatMs }))
      .filter(
        ({ e, i, delta }) =>
          !used.has(i) &&
          (['kick', 'snare', 'hat'].includes(n.instrument) || e.pitch === n.pitch) &&
          e.instrument === n.instrument &&
          Math.abs(delta) <= windowMs,
      )
      .sort((x, y) => x.e.timeMs - y.e.timeMs || x.i - y.i);
    if (candidates.length) {
      used.add(candidates[0].i);
      offsets.push(candidates[0].delta);
    }
  }
  const rate = used.size / Math.max(score.notes.length, a.events.length);
  return {
    correct: rate >= 0.8,
    rate,
    matched: used.size,
    missed: score.notes.length - used.size,
    extra: a.events.length - used.size,
    early: offsets.filter((x) => x < -30).length,
    late: offsets.filter((x) => x > 30).length,
    windowMs,
    averageOffsetMs: offsets.length ? offsets.reduce((x, y) => x + y, 0) / offsets.length : null,
    expression: {
      averageVelocity: a.events.length
        ? a.events.reduce((sum, e) => sum + e.velocity, 0) / a.events.length
        : null,
      velocityRange: a.events.length
        ? [
            Math.min(...a.events.map((e) => e.velocity)),
            Math.max(...a.events.map((e) => e.velocity)),
          ]
        : [],
      measuredDurations: a.events.filter((e) => e.durationMs !== undefined).length,
      averageDurationMs: a.events.some((e) => e.durationMs !== undefined)
        ? a.events
            .filter((e) => e.durationMs !== undefined)
            .reduce((sum, e) => sum + e.durationMs!, 0) /
          a.events.filter((e) => e.durationMs !== undefined).length
        : null,
    },
  };
}
