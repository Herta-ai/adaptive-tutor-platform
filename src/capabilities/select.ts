import { publicCapabilities } from './registry.js';
const hints: Record<string, RegExp> = {
  S01: /小学|分数|小数|百分|四则|比例/,
  S02: /代数|函数|方程|数列|复数|三角函数/,
  S03: /几何|三角形|圆|截面|立体/,
  S04: /微积分|极限|导数|积分|微分|梯度|热方程/,
  S05: /线性代数|矩阵|消元|行列式|特征|SVD/i,
  S06: /概率|统计|抽样|分布|检验|置信/,
  S07: /离散|逻辑|优化|数值|求根|牛顿/,
  S08: /力学|运动|抛体|能量|弹簧|振动/,
  S09: /电磁|电路|电容|光学|干涉|波动/,
  S10: /热学|气体|热力|扩散|熵/,
  S11: /相对论|量子|势阱|近代物理/,
  S12: /化学|滴定|速率|平衡|酸碱/,
  S13: /有机|分子|构象|甲烷|乙烷|键角/,
  S14: /遗传|DNA|RNA|转录|细胞/i,
  S15: /生理|生态|酶|种群|生化/,
  S16: /算法|编程|排序|搜索|递归|数据结构/,
  S17: /操作系统|调度|分页|缓存|网络|数据库|SQL/i,
  S18: /机器学习|回归|聚类|分类|PCA/i,
  S19: /深度学习|神经|卷积|循环|Attention|Transformer/i,
  S20: /控制|信号|采样|滤波|PID|工程/i,
  S21: /地理|地球|气候|行星|季节|天文/,
  S22: /经济|供需|博弈|历史|语言|论证/,
};
export function selectCapabilities(topic: string) {
  const all = publicCapabilities(),
    subjects = Object.entries(hints)
      .filter(([, pattern]) => pattern.test(topic))
      .map(([id]) => id);
  return all
    .filter((c) =>
      subjects.length
        ? subjects.includes(c.subject)
        : [
            'math.right_triangle',
            'math.quadratic',
            'algorithm.binary_search',
            'statistics.binomial',
          ].includes(c.id),
    )
    .slice(0, 6);
}
