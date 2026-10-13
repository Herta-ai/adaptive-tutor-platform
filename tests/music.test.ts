import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  musicConfig,
  musicTutorState,
  automatedCutoff,
  buildUpAutomation,
  sequence,
  chord,
  midiFrequency,
  numberedPitch,
  performanceScore,
  gradePerformance,
} from '../src/music/model';
import { createMusicCourse, musicCourses } from '../src/music/courses';
import { capability, inspectCapability, publicCapabilities } from '../src/capabilities/registry';
import { selectCapabilities } from '../src/capabilities/select';
import { Store, uuid } from '../src/storage/database';
import { Courses } from '../src/domain/courses';
import { Transfer } from '../src/transfer/learn';
import { notationVoice } from '../src/music/notation';
import { midiFile } from '../src/music/midi';
const fixtures: { store: Store; root: string }[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tutor-music-')),
    store = new Store(root);
  fixtures.push({ root, store });
  return { store, root, courses: new Courses(store) };
}
afterEach(() => {
  for (const f of fixtures.splice(0)) {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
const notes = [0, 1, 2, 3].map((beat, i) => ({
  id: `n${i}`,
  instrument: 'piano' as const,
  pitch: [60, 62, 64, 67][i],
  beat,
  duration: 0.5,
  velocity: 96,
}));
const score = { bpm: 120, notes };
const answer = () => ({
  completed: true,
  calibrationMs: 0,
  events: notes.map((n) => ({
    pitch: n.pitch,
    instrument: n.instrument,
    velocity: 96,
    timeMs: n.beat * 500,
  })),
});
describe('音乐契约与判分', () => {
  it('谱面保留重新起音、休止、和弦、跨小节延音', () => {
    const repeated = [0, 1].map((beat, i) => ({ ...notes[0], id: `r${i}`, beat, duration: 1 }));
    expect(notationVoice(repeated, 0).slice(0, 2)).toEqual([
      { pitches: [60], ticks: 4, tie: false },
      { pitches: [60], ticks: 4, tie: false },
    ]);
    const sustained = [
      { ...notes[0], duration: 5.75 },
      { ...notes[1], beat: 0, duration: 5.75 },
    ];
    const tokens = notationVoice(sustained, 1);
    expect(tokens[0].pitches).toEqual([60, 62]);
    expect(tokens[1].tie).toBe(true);
    expect(tokens.reduce((n, t) => n + t.ticks, 0)).toBe(16);
    expect(tokens.at(-1)?.pitches).toEqual([]);
  });
  it('导师状态只包含有界选中音符与参数，参数任务注册完整', () => {
    const c = musicConfig.parse({ notes });
    const state = musicTutorState(c, ['n0']);
    expect(state.parameters).not.toHaveProperty('notes');
    expect(state.selectedNotes).toEqual([notes[0]]);
    expect(capability('music.synth').parameters.cutoff).toMatchObject({ min: 80, max: 16000 });
  });
  it('80% 门槛、慢速容差上限及描述性力度不改变分数', () => {
    const a = answer();
    a.events.push({ ...a.events[0], pitch: 80, velocity: 1 });
    expect(gradePerformance(score, a)).toMatchObject({ correct: true, rate: 0.8 });
    const slow = { bpm: 40, notes: [notes[0]] };
    expect(
      gradePerformance(slow, {
        ...answer(),
        events: [{ ...a.events[0], timeMs: -150, velocity: 1 }],
      }),
    ).toMatchObject({ correct: true, windowMs: 150, early: 1, expression: { averageVelocity: 1 } });
  });
  it('十二平均律、转位和首调音名', () => {
    expect(midiFrequency(69)).toBe(440);
    expect(midiFrequency(81)).toBe(880);
    expect(chord(60, false, 1)).toEqual([64, 67, 72]);
    expect(chord(60, true, 2)).toEqual([67, 72, 75]);
    expect(numberedPitch(64, 60)).toBe('3');
    expect(numberedPitch(72, 60)).toContain('1');
  });
  it('音乐能力优先选择且生成器可见严格配置', () => {
    expect(selectCapabilities('EDM 鼓与钢琴和弦')).toHaveLength(6);
    expect(selectCapabilities('EDM 鼓与钢琴和弦').every((c) => c.type === 'music_lab')).toBe(true);
    expect(publicCapabilities().find((c) => c.id === 'music.mixing')).toHaveProperty(
      'configSchema',
    );
  });
  it('重复事件、非法时间与未知音色被拒绝', () => {
    expect(() => musicConfig.parse({ arbitraryUrl: 'https://example.com' })).toThrow();
    expect(() => performanceScore.parse({ bpm: 120, notes: [notes[0], notes[0]] })).toThrow();
    expect(() =>
      performanceScore.parse({ bpm: 120, notes: [{ ...notes[0], beat: 17 }] }),
    ).toThrow();
    expect(() => gradePerformance(score, { ...answer(), completed: false })).toThrow();
    expect(() => gradePerformance(score, { ...answer(), calibrationMs: 999 })).toThrow();
  });
  it('漏音、错音、多弹及边界容差', () => {
    expect(gradePerformance(score, answer())).toMatchObject({
      correct: true,
      rate: 1,
      windowMs: 125,
    });
    const a = answer();
    a.events.pop();
    expect(gradePerformance(score, a)).toMatchObject({ correct: false, missed: 1 });
    const b = answer();
    b.events[1].pitch = 63;
    expect(gradePerformance(score, b)).toMatchObject({ correct: false, missed: 1, extra: 1 });
    const c = answer();
    c.events.push(...answer().events);
    expect(gradePerformance(score, c)).toMatchObject({ rate: 0.5, extra: 4 });
    const d = answer();
    d.events[0].timeMs = 125;
    expect(gradePerformance(score, d).correct).toBe(true);
    d.events[0].timeMs = 125.1;
    expect(gradePerformance(score, d).correct).toBe(false);
  });
  it('输入延迟校准和同时和弦一对一匹配', () => {
    const a = answer();
    a.events.forEach((e) => (e.timeMs += 180));
    a.calibrationMs = 180;
    expect(gradePerformance(score, a).rate).toBe(1);
    const s = { bpm: 120, notes: notes.slice(0, 3).map((n) => ({ ...n, beat: 0 })) };
    expect(
      gradePerformance(s, {
        ...answer(),
        events: answer()
          .events.slice(0, 3)
          .map((e) => ({ ...e, timeMs: 0 })),
      }).rate,
    ).toBe(1);
  });
  it('曲风、Swing、段落与状态校验可复现', () => {
    const straight = sequence(musicConfig.parse({ preset: 'bounce' })),
      swung = sequence(musicConfig.parse({ preset: 'bounce', swing: 0.3 }));
    expect(swung.find((n) => n.instrument === 'bass')!.beat).toBeGreaterThan(
      straight.find((n) => n.instrument === 'bass')!.beat,
    );
    const c = musicConfig.parse({ preset: 'dnb', arrangement: true });
    expect(sequence(c).some((n) => n.beat >= 48)).toBe(true);
    expect(
      inspectCapability(capability('music.arrangement'), c, 200, ['track:kick']).values.bar,
    ).toBe(13);
    expect(() => inspectCapability(capability('music.arrangement'), c, 0, ['foreign'])).toThrow();
    const arranged = musicConfig.parse({
      notes,
      arrangement: true,
      filterAutomation: buildUpAutomation(),
    });
    expect(sequence(arranged).some((n) => n.beat >= 48)).toBe(true);
    expect(automatedCutoff(arranged, 40)).toBe(5150);
    expect(automatedCutoff(arranged, 48)).toBe(10000);
    expect(() =>
      musicConfig.parse({
        filterAutomation: [
          { beat: 2, value: 100 },
          { beat: 1, value: 1000 },
        ],
      }),
    ).toThrow();
  });
  it('MIDI 导出带有效头、速度和结束标记', () => {
    const data = midiFile(notes, 120);
    expect(Buffer.from(data.slice(0, 4)).toString()).toBe('MThd');
    expect([...data.slice(-4)]).toEqual([0, 255, 47, 0]);
    expect(new DataView(data.buffer).getUint16(8)).toBe(1);
    expect(new DataView(data.buffer).getUint16(10)).toBe(2);
  });
});
describe('音乐课程与证据', () => {
  it.each(musicCourses)('$id 课程发布完整讲练路径', ({ id }) => {
    const { courses, store } = setup(),
      c = createMusicCourse(courses, id);
    expect(store.list('node', c.id)).toHaveLength(id === 'foundations' ? 6 : 3);
    for (const l of store.list('lesson', c.id)) {
      expect(l.document.blocks.some((b: any) => b.type === 'music_lab')).toBe(true);
      expect(l.document.exercises).toHaveLength(3);
      expect(
        l.document.blocks.some((b: any) => b.blockId === 'live' && b.text.includes('Standard')),
      ).toBe(true);
    }
  });
  it('正式演奏提交可判分，试听提示不能获得独立证据，重试不增加证据', () => {
    const { courses, store } = setup(),
      c = createMusicCourse(courses, 'foundations'),
      n = store.list('node', c.id)[0];
    const progress = courses.start(n.id, 'start');
    const first = courses.assign(n.id, progress.cycleId, n.objectives[0].id);
    courses.attempt(first.assignmentId, uuid(), { optionId: 'o0' });
    const a = courses.assign(n.id, progress.cycleId, n.objectives[0].id);
    expect(a.kind).toBe('music_performance');
    courses.reveal(a.assignmentId, 'hint');
    const result = courses.attempt(a.assignmentId, uuid(), {
      ...answer(),
      events: a.score.notes.map((n: any) => ({
        pitch: n.pitch,
        instrument: n.instrument,
        velocity: 96,
        timeMs: (n.beat * 60000) / a.score.bpm,
      })),
    });
    expect(result.correct).toBe(true);
    expect(result.performance?.rate).toBe(1);
    expect(store.must('attempt', result.attemptId).evidenceScore).toBe(0);
  });
  it.each(['fresh', 'restore_copy'] as const)(
    '音乐 .learn %s 往返含题型与版本配置',
    async (mode) => {
      const { courses, store, root } = setup(),
        c = createMusicCourse(courses, 'dnb'),
        transfer = new Transfer(store, courses);
      const node = store.list('node', c.id)[0],
        progress = courses.start(node.id, 'start');
      const concept = courses.assign(node.id, progress.cycleId, node.objectives[0].id);
      courses.attempt(concept.assignmentId, uuid(), { optionId: 'o0' });
      const exercise = courses.assign(node.id, progress.cycleId, node.objectives[0].id);
      courses.attempt(exercise.assignmentId, uuid(), {
        completed: true,
        calibrationMs: 0,
        events: [],
      });
      store.put(
        'demo_snapshot',
        {
          id: uuid(),
          courseId: c.id,
          nodeId: node.id,
          stateSchemaVersion: 1,
          lessonVersion: 1,
          blockId: 'music',
          templateId: 'music.rhythm',
          templateVersion: 1,
          parameters: musicConfig.parse({ preset: 'dnb', cutoff: 1200 }),
          selectedIds: ['track:kick'],
          step: 4,
          summary: {},
          artifactRefs: [],
          createdAt: new Date().toISOString(),
        },
        node.id,
      );
      const exported = await transfer.export(c.id, 'backup', 'learn'),
        preview = await transfer.validate(join(root, 'exports', exported.exportId + '.learn'));
      const imported = store.transaction(() => transfer.commit(preview.importId, mode));
      expect(store.list('node', imported.courseId)).toHaveLength(3);
      expect(
        store.list('exercise', imported.courseId).filter((e) => e.kind === 'music_performance'),
      ).toHaveLength(3);
      expect(store.list('attempt', imported.courseId)).toHaveLength(mode === 'fresh' ? 0 : 2);
      const snapshots = store.list('demo_snapshot', imported.courseId);
      expect(snapshots).toHaveLength(mode === 'fresh' ? 0 : 1);
      if (mode === 'restore_copy') expect(snapshots[0].parameters.cutoff).toBe(1200);
    },
  );
});
describe('离线真实采样', () => {
  it('清单完整、hash 正确且钢琴实际基频匹配 MIDI 根音', () => {
    const manifest = JSON.parse(readFileSync('public/music/manifest.json', 'utf8'));
    expect(manifest.license).toBe('CC0-1.0');
    expect(manifest.samples).toHaveLength(7);
    for (const sample of manifest.samples) {
      const data = readFileSync(`public/music/${sample.file}`);
      expect(createHash('sha256').update(data).digest('hex')).toBe(sample.sha256);
      if (!sample.id.startsWith('piano')) continue;
      const rate = data.readUInt32LE(24),
        lag = Math.round(rate / midiFrequency(sample.root)),
        start = Math.floor(rate * 0.2);
      let xx = 0,
        yy = 0,
        xy = 0;
      for (let i = 0; i < 4096; i++) {
        const x = data.readInt16LE(44 + 2 * (start + i)),
          y = data.readInt16LE(44 + 2 * (start + i + lag));
        xx += x * x;
        yy += y * y;
        xy += x * y;
      }
      expect(xy / Math.sqrt(xx * yy)).toBeGreaterThan(0.9);
      expect(sample.root).toBe((Number(sample.id.split('-')[1]) + 2) * 12);
    }
  });
});
