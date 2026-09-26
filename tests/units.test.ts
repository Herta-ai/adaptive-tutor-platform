import { describe, it, expect } from 'vitest';
import { convert } from '../src/domain/units.js';
import { grade } from '../src/domain/assessment.js';
import type { Exercise } from '../src/contracts/v1.js';
describe('A04 SI 单位及四种确定性题型', () => {
  it('复合量纲、前缀、角度、仿射温度', () => {
    expect(convert(1, 'N*m', 'J')).toBe(1);
    expect(convert(1, 'mol/L', 'mol/m^3')).toBe(1000);
    expect(convert(1, 'mF', 'F')).toBe(0.001);
    expect(convert(180, 'deg', 'rad')).toBeCloseTo(Math.PI);
    expect(convert(1, 'eV', 'J')).toBe(1.602176634e-19);
    expect(() => convert(1, '°C/s', 'K/s')).toThrow();
    expect(() => convert(1, 'rad', '')).toThrow();
    expect(() => convert(1, 'process.exit()', 'm')).toThrow();
  });
  it('单选非法 ID 不产生判分', () => {
    const e: Exercise = {
      key: 'e',
      objectiveId: 'o',
      familyKey: 'f',
      kind: 'single_choice',
      prompt: '选择',
      explanation: '说明',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      grading: { correctOptionId: 'a' },
    };
    expect(grade(e, { optionId: 'a' })).toBe(true);
    expect(grade(e, { optionId: 'b' })).toBe(false);
    expect(() => grade(e, { optionId: 'missing' })).toThrow();
  });
  it('参数题拒绝额外字段、缺失目标、越界与非有限数', () => {
    const e: Exercise = {
      key: 'e',
      objectiveId: 'o',
      familyKey: 'f',
      kind: 'parameter',
      prompt: '参数',
      explanation: '说明',
      grading: {
        template: 'parameter_targets',
        blockId: 'b',
        targets: [{ key: 'width', expected: 4, absTolerance: 0.01, relTolerance: 0 }],
      },
    };
    const ranges = { width: { min: 0.1, max: 10 } };
    expect(grade(e, { values: { width: 4 } }, ranges)).toBe(true);
    expect(grade(e, { values: { width: 5 } }, ranges)).toBe(false);
    for (const values of [{}, { width: 11 }, { width: Infinity }, { width: 4, extra: 1 }])
      expect(() => grade(e, { values }, ranges)).toThrow();
  });
});
