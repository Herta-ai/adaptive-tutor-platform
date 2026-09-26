import type { Capability } from './registry.js';
const p = (min: number, max: number, value: number, step = 0.1) => ({ min, max, value, step });
export const neural: Capability[] = [
  {
    id: 'neural.convolution',
    version: 1,
    subject: 'S19',
    title: '二维卷积单步',
    type: 'neural_lab',
    mode: 'computed',
    parameters: { k00: p(-2, 2, 1), k01: p(-2, 2, 0), k10: p(-2, 2, 0), k11: p(-2, 2, -1) },
    description:
      '输入为3×3矩阵[[1,2,3],[4,5,6],[7,8,9]]，2×2核、步长1、无填充。采用深度学习库常用的互相关约定，不翻转核。',
    reference: '默认核[[1,0],[0,-1]]输出的四项均为−4。',
    compute: (q) => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9],
        bars: number[] = [],
        steps: string[] = [];
      for (let row = 0; row < 2; row++)
        for (let col = 0; col < 2; col++) {
          const i = row * 3 + col,
            result =
              values[i] * q.k00 +
              values[i + 1] * q.k01 +
              values[i + 3] * q.k10 +
              values[i + 4] * q.k11;
          bars.push(result);
          steps.push(
            `输出(${row},${col}) = ${values[i]}×${q.k00} + ${values[i + 1]}×${q.k01} + ${values[i + 3]}×${q.k10} + ${values[i + 4]}×${q.k11} = ${result}`,
          );
        }
      return { values: { outputRows: 2, outputColumns: 2 }, bars, steps };
    },
  },
  {
    id: 'neural.rnn',
    version: 1,
    subject: 'S19',
    title: '循环神经元状态递推',
    type: 'neural_lab',
    mode: 'computed',
    parameters: { inputWeight: p(-2, 2, 1), stateWeight: p(-2, 2, 0.5), bias: p(-1, 1, 0) },
    description: '输入序列[1,0,−1,1]，h₀=0，逐步计算 hₜ=tanh(wₓxₜ+wₕhₜ₋₁+b)。',
    reference: '所有参数为0时各时刻状态均为0。',
    compute: (q) => {
      let h = 0;
      const bars: number[] = [],
        steps: string[] = [];
      for (const x of [1, 0, -1, 1]) {
        const previous = h;
        h = Math.tanh(q.inputWeight * x + q.stateWeight * h + q.bias);
        bars.push(h);
        steps.push(
          `h=tanh(${q.inputWeight}×${x}+${q.stateWeight}×${previous.toFixed(4)}+${q.bias})=${h.toFixed(4)}`,
        );
      }
      return { values: { finalState: h }, bars, steps };
    },
  },
];
