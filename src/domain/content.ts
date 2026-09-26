import { curriculumDraft, lessonDraft, exercise, type LessonDraft } from '../contracts/v1.js';
import { z } from 'zod';
import { capability, validateParameters } from '../capabilities/registry.js';
import { assertDag, convert } from './assessment.js';
import { requireThat } from './errors.js';
export function validateCurriculum(input: unknown) {
  const p = curriculumDraft.parse(input);
  assertDag(
    p.nodes.map((n) => n.key),
    p.edges.map((e) => ({ from: e.fromKey, to: e.toKey })),
  );
  requireThat(
    new Set(p.concepts.map((c) => c.key)).size === p.concepts.length,
    'CONTENT_INVALID',
    '概念 key 重复',
  );
  for (const n of p.nodes) {
    requireThat(
      p.concepts.some((c) => c.key === n.conceptKey),
      'CONTENT_INVALID',
      '节点概念不存在',
    );
    requireThat(
      new Set(n.objectives.map((o) => o.key)).size === n.objectives.length,
      'CONTENT_INVALID',
      '目标 key 重复',
    );
  }
  return p;
}
export function validateLesson(
  input: unknown,
  objectives: { id: string }[],
  initial = true,
): LessonDraft {
  const p = (
    initial ? lessonDraft : lessonDraft.extend({ exercises: z.array(exercise).min(1).max(18) })
  ).parse(input);
  const ids = p.blocks.map((b) => b.blockId);
  requireThat(new Set(ids).size === ids.length, 'CONTENT_INVALID', '内容块 ID 重复');
  requireThat(
    new Set(p.exercises.map((e) => e.key)).size === p.exercises.length,
    'CONTENT_INVALID',
    '题目 key 重复',
  );
  const fingerprints = new Map<string, string>();
  for (const e of p.exercises) {
    const fingerprint =
      e.objectiveId + ':' + e.prompt.normalize('NFKC').replace(/[\d\s.,，。+-]/g, '');
    const family = fingerprints.get(fingerprint);
    requireThat(!family || family === e.familyKey, 'FAMILY_DUPLICATE', '换数字题不能声明为新家族');
    fingerprints.set(fingerprint, e.familyKey);
  }
  for (const role of ['goal', 'explanation', 'worked_example', 'recap'])
    requireThat(
      p.blocks.some((b) => b.type === 'markdown' && b.role === role),
      'CONTENT_INVALID',
      '缺少必要教学段落：' + role,
    );
  requireThat(
    p.blocks.reduce((n, b) => n + (b.type === 'markdown' ? b.text.length : 0), 0) <= 60000,
    'CONTENT_INVALID',
    '正文过长',
  );
  for (const b of p.blocks) {
    if (b.type === 'markdown')
      requireThat(
        !/<\/?[a-zA-Z][^>]*>|javascript:|data:text\/html/i.test(b.text),
        'CONTENT_INVALID',
        '正文含不支持的 HTML 或链接',
      );
    else if (b.type === 'exercise_ref')
      requireThat(
        p.exercises.some((e) => e.key === b.exerciseKey),
        'CONTENT_INVALID',
        '引用的题目不存在',
      );
    else {
      const c = capability(b.templateId, b.templateVersion);
      requireThat(
        c.type === b.type && c.mode === b.modelInfo.mode,
        'CONTENT_INVALID',
        '模板类型或计算模式不符',
      );
      validateParameters(c, b.config);
    }
  }
  for (const e of p.exercises) {
    requireThat(
      objectives.some((o) => o.id === e.objectiveId),
      'CONTENT_INVALID',
      '题目目标不属于节点',
    );
    if (e.kind === 'numeric') {
      convert(1, e.grading.unit, e.grading.unit);
      for (const u of e.grading.allowedUnits) convert(1, u, e.grading.unit);
    }
    if (e.kind === 'single_choice' || e.kind === 'multiple_choice') {
      requireThat(
        new Set(e.options.map((o) => o.id)).size === e.options.length,
        'CONTENT_INVALID',
        '重复选项',
      );
      const keys =
        e.kind === 'single_choice' ? [e.grading.correctOptionId] : e.grading.correctOptionIds;
      requireThat(
        new Set(keys).size === keys.length && keys.every((k) => e.options.some((o) => o.id === k)),
        'CONTENT_INVALID',
        '答案键不存在',
      );
    }
    if (e.kind === 'parameter') {
      const b = p.blocks.find((b) => b.blockId === e.grading.blockId);
      requireThat(b && 'templateId' in b, 'CONTENT_INVALID', '参数题缺少实验');
      const c = capability(b.templateId, b.templateVersion);
      for (const t of e.grading.targets)
        requireThat(
          c.parameters[t.key] &&
            t.expected >= c.parameters[t.key].min &&
            t.expected <= c.parameters[t.key].max,
          'CONTENT_INVALID',
          '参数题目标越界',
        );
    }
  }
  if (initial)
    for (const o of objectives)
      requireThat(
        new Set(p.exercises.filter((e) => e.objectiveId === o.id).map((e) => e.familyKey)).size >=
          3,
        'CONTENT_INVALID',
        '每个目标至少需要三个题目家族',
      );
  // Model claims are not verification evidence.
  p.sources = p.sources.map((s) => ({ ...s, status: 'suggested' }));
  return p;
}
