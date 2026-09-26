import { describe, it, expect } from 'vitest';
import { capabilities, capability, validateParameters } from '../src/capabilities/registry.js';
function run(id: string, p: Record<string, number> = {}, step = 100) {
  const c = capability(id);
  return c.compute(
    { ...Object.fromEntries(Object.entries(c.parameters).map(([k, p]) => [k, p.value])), ...p },
    step,
  );
}
describe('A22/A25 科学参考结果', () => {
  it.each(capabilities.map((c) => [c.id, c] as const))('%s 默认及边界参数计算有限', (_, c) => {
    for (const pick of ['min', 'value', 'max'] as const) {
      const p = Object.fromEntries(Object.entries(c.parameters).map(([k, v]) => [k, v[pick]]));
      validateParameters(c, p);
      const out = c.compute(p, 100);
      expect(Object.values(out.values).every(Number.isFinite)).toBe(true);
      expect(out.points?.flat().every(Number.isFinite) ?? true).toBe(true);
    }
  });
  it('黎曼和收敛，行列式参考解', () => {
    expect(Math.abs(run('calculus.riemann', { n: 100 }).values.estimate - 1 / 3)).toBeLessThan(
      0.006,
    );
    expect(run('matrix.elimination2').values).toMatchObject({ x: 2.2, y: 0.6, determinant: 5 });
  });
  it('弹簧能量守恒，RC解析时间常数', () => {
    for (const step of [0, 25, 50, 75, 100]) {
      const r = run('physics.spring', {}, step).values;
      expect(r.kinetic + r.potential).toBeCloseTo(r.total, 12);
    }
    expect(run('circuit.rc', {}, 20).values.voltage).toBeCloseTo(5 * (1 - Math.exp(-1)), 12);
  });
  it('二项分布归一化、遗传概率与种子重现', () => {
    expect(run('statistics.binomial').bars!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(run('biology.mendel').bars).toEqual([0.25, 0.5, 0.25]);
    expect(run('statistics.sample_means')).toEqual(run('statistics.sample_means'));
  });
  it('强酸强碱等当点、酶半饱和与相对论零速', () => {
    expect(run('chemistry.titration', { baseMl: 25 }).values.pH).toBeCloseTo(7);
    expect(run('biology.michaelis_menten').values.velocity).toBe(1);
    expect(run('physics.relativity', { beta: 0 }).values.gamma).toBe(1);
  });
  it('算法与 ML 真实迭代', () => {
    expect(run('algorithm.bubble_sort', { step: 10 }).bars).toEqual([1, 2, 3, 4, 5]);
    expect(run('algorithm.binary_search').values.index).toBe(3);
    expect(run('systems.round_robin').values.totalTime).toBe(9);
    expect(run('ml.kmeans').bars).toEqual([2, 9]);
    expect(
      run('ml.linear_regression', { iterations: 200, learningRate: 0.05 }).values.validationMSE,
    ).toBeLessThan(0.001);
  });
  it('梯度有限差分、注意力掩码与归一化', () => {
    const eps = 1e-5,
      r = run('neural.sigmoid').values;
    const gradient =
      (run('neural.sigmoid', { weight: 1 + eps }).values.output -
        run('neural.sigmoid', { weight: 1 - eps }).values.output) /
      (2 * eps);
    expect(r.gradientWeight).toBeCloseTo(gradient, 8);
    const attention = run('neural.attention', { query: 0, maskLast: 1 });
    expect(attention.bars).toEqual([0.5, 0.5, 0]);
    expect(attention.values.weightSum).toBe(1);
  });
});
