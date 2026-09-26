import { z } from 'zod';
import { requireThat } from '../domain/errors.js';
import { extended } from './extended.js';
import { spatial } from './spatial.js';
import { neural } from './neural.js';
const parameter = (min: number, max: number, value: number, step = 0.1) => ({
  min,
  max,
  value,
  step,
});
export interface Capability {
  id: string;
  version: number;
  subject: string;
  title: string;
  type:
    | 'geometry2d'
    | 'simulation'
    | 'data_chart'
    | 'algorithm_trace'
    | 'matrix_lab'
    | 'neural_lab'
    | 'ml_lab'
    | 'scene3d'
    | 'molecule';
  mode: 'computed' | 'simplified';
  parameters: Record<string, { min: number; max: number; value: number; step: number }>;
  description: string;
  reference: string;
  compute: (
    p: Record<string, number>,
    step: number,
  ) => {
    values: Record<string, number>;
    points?: number[][];
    bars?: number[];
    steps?: string[];
    positions?: number[][];
    atoms?: { id: string; element: string; position: number[] }[];
  };
}
export const capabilities: Capability[] = [
  {
    id: 'math.right_triangle',
    version: 1,
    subject: 'S03',
    title: '直角三角形',
    type: 'geometry2d',
    mode: 'computed',
    parameters: { width: parameter(0.1, 10, 4), height: parameter(0.1, 10, 3) },
    description: '在欧氏平面中改变两条直角边，观察面积和斜边。',
    reference: '勾股定理：3² + 4² = 5²；面积为 6。',
    compute: (p) => ({
      values: { area: (p.width * p.height) / 2, hypotenuse: Math.hypot(p.width, p.height) },
      points: [
        [0, 0],
        [p.width, 0],
        [0, p.height],
        [0, 0],
      ],
    }),
  },
  {
    id: 'math.fraction',
    version: 1,
    subject: 'S01',
    title: '分数与面积',
    type: 'data_chart',
    mode: 'computed',
    parameters: { numerator: parameter(0, 12, 3, 1), denominator: parameter(1, 12, 4, 1) },
    description: '分子表示取出的份数，分母表示每个整体等分的份数；允许假分数。',
    reference: '3/4 = 0.75 = 75%。',
    compute: (p) => ({
      values: { ratio: p.numerator / p.denominator, percent: (100 * p.numerator) / p.denominator },
      bars: Array.from({ length: p.denominator }, (_, i) => (i < p.numerator ? 1 : 0)),
    }),
  },
  {
    id: 'calculus.riemann',
    version: 1,
    subject: 'S04',
    title: '黎曼和',
    type: 'data_chart',
    mode: 'computed',
    parameters: { n: parameter(1, 100, 10, 1) },
    description: '用左端点矩形估计 x² 在 [0,1] 上的积分；增加分割数观察收敛。',
    reference: '解析积分为 1/3。',
    compute: (p) => {
      const bars = Array.from({ length: p.n }, (_, i) => (i / p.n) ** 2);
      return { values: { estimate: bars.reduce((a, b) => a + b, 0) / p.n, exact: 1 / 3 }, bars };
    },
  },
  {
    id: 'physics.projectile',
    version: 1,
    subject: 'S08',
    title: '抛体运动',
    type: 'simulation',
    mode: 'simplified',
    parameters: {
      speed: parameter(1, 30, 10),
      angle: parameter(5, 85, 45, 1),
      g: parameter(1, 20, 9.8),
    },
    description: '忽略空气阻力，取恒定重力加速度；从地面发射并落回同一高度。',
    reference: '射程 v² sin(2θ)/g。',
    compute: (p, s) => {
      const a = (p.angle * Math.PI) / 180,
        T = (2 * p.speed * Math.sin(a)) / p.g;
      return {
        values: { range: (p.speed ** 2 * Math.sin(2 * a)) / p.g, time: (T * s) / 100 },
        points: Array.from({ length: Math.min(s, 100) + 1 }, (_, i) => {
          const t = (T * i) / 100;
          return [p.speed * Math.cos(a) * t, p.speed * Math.sin(a) * t - 0.5 * p.g * t * t];
        }),
      };
    },
  },
  {
    id: 'circuit.rc',
    version: 1,
    subject: 'S09',
    title: 'RC 充电',
    type: 'simulation',
    mode: 'simplified',
    parameters: {
      R: parameter(1, 100, 10, 1),
      C: parameter(0.01, 1, 0.1, 0.01),
      V: parameter(1, 12, 5),
    },
    description: '理想电阻电容串联，初始电容电压为零。时间常数 τ=RC。',
    reference: 't=RC 时电压为电源的 1−e⁻¹ 倍。',
    compute: (p, s) => ({
      values: { tau: p.R * p.C, voltage: p.V * (1 - Math.exp(-s / 20)) },
      points: Array.from({ length: 101 }, (_, i) => [
        (i / 20) * p.R * p.C,
        p.V * (1 - Math.exp(-i / 20)),
      ]),
    }),
  },
  {
    id: 'chemistry.decay',
    version: 1,
    subject: 'S12',
    title: '一级反应速率',
    type: 'simulation',
    mode: 'simplified',
    parameters: { initial: parameter(0.1, 10, 1), k: parameter(0.01, 2, 0.3, 0.01) },
    description: '恒温封闭体系中单一反应物遵循一级不可逆动力学。',
    reference: '浓度 c(t)=c₀e⁻ᵏᵗ；半衰期 ln(2)/k。',
    compute: (p, s) => ({
      values: { concentration: p.initial * Math.exp((-p.k * s) / 10), halfLife: Math.log(2) / p.k },
      points: Array.from({ length: 101 }, (_, i) => [
        i / 10,
        p.initial * Math.exp((-p.k * i) / 10),
      ]),
    }),
  },
  {
    id: 'biology.michaelis_menten',
    version: 1,
    subject: 'S15',
    title: '酶动力学',
    type: 'simulation',
    mode: 'simplified',
    parameters: {
      vmax: parameter(0.1, 10, 2),
      km: parameter(0.1, 10, 1),
      substrate: parameter(0, 10, 1),
    },
    description: '米氏稳态近似，不考虑抑制与协同作用。',
    reference: '底物浓度等于 Km 时速率为 Vmax/2。',
    compute: (p) => ({
      values: { velocity: (p.vmax * p.substrate) / (p.km + p.substrate) },
      points: Array.from({ length: 101 }, (_, i) => [
        i / 10,
        (p.vmax * (i / 10)) / (p.km + i / 10),
      ]),
    }),
  },
  {
    id: 'algorithm.bubble_sort',
    version: 1,
    subject: 'S16',
    title: '冒泡排序逐步比较',
    type: 'algorithm_trace',
    mode: 'computed',
    parameters: { step: parameter(0, 10, 0, 1) },
    description: '固定输入 [5,1,4,2,3]，相邻元素比较与交换，逐步检查有序后缀。',
    reference: '最终输出 [1,2,3,4,5]。',
    compute: (p) => {
      const a = [5, 1, 4, 2, 3],
        steps: string[] = [];
      let count = 0;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4 - i; j++) {
          if (count++ >= p.step) return { values: { comparisons: p.step }, bars: a, steps };
          const before = a.join(',');
          if (a[j] > a[j + 1]) [a[j], a[j + 1]] = [a[j + 1], a[j]];
          steps.push(`${before} → ${a.join(',')}`);
        }
      return { values: { comparisons: 10 }, bars: a, steps };
    },
  },
  {
    id: 'neural.sigmoid',
    version: 1,
    subject: 'S19',
    title: '单神经元前向与梯度',
    type: 'neural_lab',
    mode: 'computed',
    parameters: { x: parameter(-5, 5, 1), weight: parameter(-5, 5, 1), bias: parameter(-5, 5, 0) },
    description: '单个 sigmoid 神经元 y=σ(wx+b)，显示对权重的链式法则梯度。',
    reference: 'x=1,w=0,b=0 时 dy/dw=0.25。',
    compute: (p) => {
      const y = 1 / (1 + Math.exp(-(p.weight * p.x + p.bias)));
      return {
        values: { output: y, gradientWeight: y * (1 - y) * p.x },
        points: Array.from({ length: 101 }, (_, i) => [
          (i - 50) / 10,
          1 / (1 + Math.exp(-((p.weight * (i - 50)) / 10 + p.bias))),
        ]),
      };
    },
  },
  ...extended,
  ...spatial,
  ...neural,
];
export function capability(id: string, version = 1) {
  const c = capabilities.find((c) => c.id === id && c.version === version);
  requireThat(c, 'CAPABILITY_UNSUPPORTED', '未注册的模板或版本');
  return c;
}
export function validateParameters(c: Capability, input: unknown) {
  const shape: Record<string, z.ZodNumber> = {};
  for (const [k, p] of Object.entries(c.parameters)) {
    let value = z.number().finite().min(p.min).max(p.max);
    if (p.step === 1) value = value.int();
    shape[k] = value;
  }
  return z.strictObject(shape).parse(input);
}
export function publicCapabilities() {
  return capabilities.map(({ compute, ...c }) => ({ ...c, ready: true }));
}
