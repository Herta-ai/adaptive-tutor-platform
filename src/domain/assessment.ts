import { z } from 'zod';
import type { Exercise } from '../contracts/v1.js';
import { requireThat } from './errors.js';

import { convert } from './units.js';
export { convert } from './units.js';
export const close = (a: number, b: number, abs: number, rel: number) =>
  Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b));
export function grade(
  e: Exercise,
  input: unknown,
  parameterRanges?: Record<string, { min: number; max: number }>,
) {
  switch (e.kind) {
    case 'single_choice': {
      const a = z.strictObject({ optionId: z.string() }).parse(input);
      requireThat(
        e.options.some((o) => o.id === a.optionId),
        'ANSWER_INVALID',
        '选项不存在',
        400,
      );
      return a.optionId === e.grading.correctOptionId;
    }
    case 'multiple_choice': {
      const a = z.strictObject({ optionIds: z.array(z.string()) }).parse(input).optionIds;
      requireThat(
        new Set(a).size === a.length && a.every((v) => e.options.some((o) => o.id === v)),
        'ANSWER_INVALID',
        '重复或不存在的选项',
        400,
      );
      return (
        a.length === e.grading.correctOptionIds.length &&
        a.every((v) => e.grading.correctOptionIds.includes(v))
      );
    }
    case 'numeric': {
      const a = z
        .strictObject({
          value: z
            .string()
            .max(100)
            .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/),
          unit: z.string(),
        })
        .parse(input);
      requireThat(
        Number.isFinite(Number(a.value)) && e.grading.allowedUnits.includes(a.unit),
        'ANSWER_INVALID',
        '请输入有限数值和允许的单位',
        400,
      );
      return close(
        convert(Number(a.value), a.unit, e.grading.unit),
        e.grading.expected,
        e.grading.absTolerance,
        e.grading.relTolerance,
      );
    }
    case 'parameter': {
      const a = z
        .strictObject({ values: z.record(z.string(), z.number().finite()) })
        .parse(input).values;
      requireThat(
        Object.keys(a).length === e.grading.targets.length &&
          e.grading.targets.every((t) => Object.hasOwn(a, t.key)),
        'ANSWER_INVALID',
        '参数不完整',
        400,
      );
      requireThat(
        parameterRanges &&
          Object.entries(a).every(
            ([k, v]) =>
              parameterRanges[k] && v >= parameterRanges[k].min && v <= parameterRanges[k].max,
          ),
        'ANSWER_INVALID',
        '参数超出模板范围',
        400,
      );
      return e.grading.targets.every((t) =>
        close(a[t.key], t.expected, t.absTolerance, t.relTolerance),
      );
    }
  }
}
export interface Evidence {
  id: string;
  familyId: string;
  objectiveId: string;
  correct: boolean;
  evidenceScore: number | null;
  firstInFamily: boolean;
  voidedAt?: string | null;
}
export function evidenceWindow(attempts: Evidence[], objectiveId: string) {
  const seen = new Set<string>();
  const window = attempts
    .filter(
      (a) =>
        a.objectiveId === objectiveId && !a.voidedAt && a.firstInFamily && a.evidenceScore !== null,
    )
    .filter((a) => {
      if (seen.has(a.familyId)) return false;
      seen.add(a.familyId);
      return true;
    })
    .slice(-5);
  const score = window.reduce((n, a) => n + (a.evidenceScore ?? 0), 0);
  return {
    n: window.length,
    score,
    rate: window.length ? score / window.length : null,
    mastered: window.length >= 2 && score / window.length >= 0.8,
  };
}
export function nextReview(completedAt: string, stage: number) {
  return new Date(
    Date.parse(completedAt) + [1, 3, 7, 14][Math.min(stage, 3)] * 86400000,
  ).toISOString();
}
export function assertDag(ids: string[], edges: { from: string; to: string }[]) {
  requireThat(new Set(ids).size === ids.length, 'GRAPH_INVALID', '节点重复');
  const indegree = new Map(ids.map((i) => [i, 0]));
  const children = new Map(ids.map((i) => [i, [] as string[]]));
  for (const e of edges) {
    requireThat(
      indegree.has(e.from) && indegree.has(e.to) && e.from !== e.to,
      'GRAPH_INVALID',
      '依赖端点无效',
    );
    indegree.set(e.to, indegree.get(e.to)! + 1);
    children.get(e.from)!.push(e.to);
  }
  const queue = ids.filter((i) => indegree.get(i) === 0);
  let count = 0;
  while (queue.length) {
    const i = queue.shift()!;
    count++;
    for (const c of children.get(i)!) {
      indegree.set(c, indegree.get(c)! - 1);
      if (indegree.get(c) === 0) queue.push(c);
    }
  }
  requireThat(count === ids.length, 'GRAPH_CYCLE', '知识依赖不能成环');
}
