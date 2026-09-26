import { describe, it, expect } from 'vitest';
import { evidenceWindow, grade, convert, nextReview, assertDag } from '../src/domain/assessment.js';
import type { Exercise } from '../src/contracts/v1.js';
describe('A04–A09 教学不变量', () => {
  it.each([
    [1, 1, false],
    [2, 2, true],
    [3, 2, false],
    [5, 3, false],
    [5, 4, true],
  ])('窗口 %i / %i', (n, score, mastered) => {
    const attempts = Array.from({ length: n }, (_, i) => ({
      id: String(i),
      objectiveId: 'o',
      familyId: String(i),
      correct: i < score,
      evidenceScore: i < score ? 1 : 0,
      firstInFamily: true,
    }));
    expect(evidenceWindow(attempts, 'o').mastered).toBe(mastered);
    expect(
      evidenceWindow([...attempts, { ...attempts[0], evidenceScore: 1, firstInFamily: false }], 'o')
        .n,
    ).toBe(n);
  });
  it('提示暴露的正确答案不能贡献独立证据', () =>
    expect(
      evidenceWindow(
        [
          {
            id: 'a',
            objectiveId: 'o',
            familyId: 'f',
            correct: true,
            evidenceScore: 0,
            firstInFamily: true,
          },
        ],
        'o',
      ).score,
    ).toBe(0));
  it('数值容差与单位换算，拒绝表达式及非有限值', () => {
    const e: Exercise = {
      key: 'e',
      objectiveId: 'o',
      familyKey: 'f',
      kind: 'numeric',
      prompt: '长度',
      explanation: '换算',
      grading: {
        expected: 1,
        unit: 'm',
        allowedUnits: ['m', 'cm'],
        absTolerance: 0.001,
        relTolerance: 0,
      },
    };
    expect(grade(e, { value: '100', unit: 'cm' })).toBe(true);
    expect(() => grade(e, { value: '1+0', unit: 'm' })).toThrow();
    expect(() => grade(e, { value: '1e999', unit: 'm' })).toThrow();
    expect(convert(0, '°C', 'K')).toBe(273.15);
    expect(() => convert(1, 'm', 's')).toThrow();
  });
  it('拒绝重复多选', () => {
    const e: Exercise = {
      key: 'e',
      objectiveId: 'o',
      familyKey: 'f',
      kind: 'multiple_choice',
      prompt: '选',
      explanation: '解释',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      grading: { correctOptionIds: ['a'] },
    };
    expect(() => grade(e, { optionIds: ['a', 'a'] })).toThrow();
  });
  it('复习使用 UTC 完成时间与阶段', () =>
    expect(nextReview('2026-01-01T00:00:00.000Z', 1)).toBe('2026-01-04T00:00:00.000Z'));
  it('拒绝成环及不存在端点', () => {
    expect(() =>
      assertDag(
        ['a', 'b'],
        [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      ),
    ).toThrow();
    expect(() => assertDag(['a'], [{ from: 'a', to: 'x' }])).toThrow();
  });
});
