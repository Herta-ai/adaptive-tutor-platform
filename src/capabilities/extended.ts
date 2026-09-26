import type { Capability } from './registry.js';
const p = (min: number, max: number, value: number, step = 0.1) => ({ min, max, value, step });
type Spec = Omit<Capability, 'version' | 'mode' | 'type'> &
  Partial<Pick<Capability, 'mode' | 'type'>>;
const make = (s: Spec): Capability => ({ version: 1, mode: 'computed', type: 'data_chart', ...s });
const factorial = (n: number): number => (n < 2 ? 1 : n * factorial(n - 1));
function seeded(seed: number) {
  let s = seed | 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}
function softmax(values: number[]) {
  const max = Math.max(...values),
    e = values.map((x) => Math.exp(x - max)),
    sum = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / sum);
}
export const extended: Capability[] = [
  make({
    id: 'math.place_value',
    subject: 'S01',
    title: '十进制与进位',
    parameters: { a: p(0, 99, 48, 1), b: p(0, 99, 27, 1) },
    description: '逐位相加，个位满十向十位进一。',
    reference: '48 + 27 = 75，个位 8+7=15 向十位进 1。',
    compute: (q) => {
      const ones = (q.a % 10) + (q.b % 10),
        carry = Math.floor(ones / 10);
      return {
        values: { sum: q.a + q.b, carry },
        bars: [
          Math.floor((q.a + q.b) / 100),
          Math.floor(((q.a + q.b) % 100) / 10),
          (q.a + q.b) % 10,
        ],
        steps: [
          `个位：${q.a % 10}+${q.b % 10}=${ones}，写 ${ones % 10} 进 ${carry}`,
          `十位：${Math.floor(q.a / 10)}+${Math.floor(q.b / 10)}+${carry}=${Math.floor(q.a / 10) + Math.floor(q.b / 10) + carry}`,
        ],
      };
    },
  }),
  make({
    id: 'math.quadratic',
    subject: 'S02',
    title: '二次函数参数',
    parameters: { a: p(0.1, 3, 1), h: p(-3, 3, 0), k: p(-3, 3, 0) },
    description: '观察 y=a(x−h)²+k 的顶点、对称轴和开口。',
    reference: '顶点为 (h,k)，本模板限制 a>0。',
    compute: (q) => ({
      values: { vertexX: q.h, vertexY: q.k },
      points: Array.from({ length: 101 }, (_, i) => {
        const x = (i - 50) / 10;
        return [x, q.a * (x - q.h) ** 2 + q.k];
      }),
    }),
  }),
  make({
    id: 'math.geometric_sequence',
    subject: 'S02',
    title: '等比数列逐项生成',
    parameters: { initial: p(1, 5, 1), ratio: p(0.1, 2, 1.5), terms: p(1, 12, 6, 1) },
    description: '每项由前一项乘相同公比得到；观察累加和。',
    reference: '首项1、公比2、6项的和为63。',
    compute: (q) => {
      const bars = Array.from({ length: q.terms }, (_, i) => q.initial * q.ratio ** i);
      return {
        values: { sum: bars.reduce((a, b) => a + b, 0) },
        bars,
        steps: bars.map(
          (v, i) => `第 ${i + 1} 项 = ${q.initial} × ${q.ratio}^${i} = ${v.toFixed(3)}`,
        ),
      };
    },
  }),
  make({
    id: 'math.circle',
    subject: 'S03',
    title: '圆的周长与面积',
    type: 'geometry2d',
    parameters: { radius: p(0.1, 10, 3) },
    description: '所有点到圆心的距离相同；半径改变时比较周长与面积的增长。',
    reference: 'C=2πr，A=πr²。',
    compute: (q) => ({
      values: { circumference: 2 * Math.PI * q.radius, area: Math.PI * q.radius ** 2 },
      points: Array.from({ length: 101 }, (_, i) => [
        q.radius * Math.cos((i * Math.PI) / 50),
        q.radius * Math.sin((i * Math.PI) / 50),
      ]),
    }),
  }),
  make({
    id: 'calculus.secant',
    subject: 'S04',
    title: '割线趋近切线',
    parameters: { x: p(-3, 3, 1), h: p(0.01, 2, 1, 0.01) },
    description: '对 f(x)=x²，减小 h 观察差商趋近导数。',
    reference: '差商为2x+h；解析导数为2x。',
    compute: (q) => ({
      values: { secant: 2 * q.x + q.h, derivative: 2 * q.x, error: q.h },
      points: Array.from({ length: 81 }, (_, i) => {
        const x = (i - 40) / 10;
        return [x, x * x];
      }),
      steps: [
        `f(x+h)−f(x) = ${(q.x + q.h) ** 2 - q.x ** 2}`,
        `除以 h 得到 ${2 * q.x + q.h}`,
        `h→0 时趋向 ${2 * q.x}`,
      ],
    }),
  }),
  make({
    id: 'matrix.determinant2',
    subject: 'S05',
    title: '二维变换与行列式',
    type: 'geometry2d',
    parameters: { a: p(-3, 3, 2), b: p(-3, 3, 1), c: p(-3, 3, 0), d: p(-3, 3, 1) },
    description: '矩阵的两列是变换后的基向量；平行四边形面积是行列式的绝对值。',
    reference: 'det([[a,b],[c,d]])=ad−bc。零行列式表示退化。',
    compute: (q) => ({
      values: { determinant: q.a * q.d - q.b * q.c, area: Math.abs(q.a * q.d - q.b * q.c) },
      points: [
        [0, 0],
        [q.a, q.c],
        [q.a + q.b, q.c + q.d],
        [q.b, q.d],
        [0, 0],
      ],
    }),
  }),
  make({
    id: 'matrix.elimination2',
    subject: 'S05',
    title: '高斯消元两步',
    type: 'matrix_lab',
    parameters: { b: p(-4, 4, 1), c: p(-4, 4, 1), rhs1: p(-10, 10, 5), rhs2: p(-10, 10, 4) },
    description: '解方程 2x+by=r₁，cx+3y=r₂；显示消元与回代，奇异时不输出伪解。',
    reference: 'b=c=1,r₁=5,r₂=4 时 x=2.2,y=0.6。',
    compute: (q) => {
      const pivot = 3 - (q.c * q.b) / 2;
      if (Math.abs(pivot) < 1e-9)
        return {
          values: { determinant: 0 } as Record<string, number>,
          steps: ['消元后的主元为零：系统奇异，需要进一步判定解的存在性。'],
        };
      const y = (q.rhs2 - (q.c * q.rhs1) / 2) / pivot,
        x = (q.rhs1 - q.b * y) / 2;
      return {
        values: { x, y, determinant: 6 - q.b * q.c },
        bars: [x, y],
        steps: [
          `R₂ ← R₂ − ${q.c / 2}R₁`,
          `新方程：${pivot}y = ${q.rhs2 - (q.c * q.rhs1) / 2}`,
          `回代：y=${y}，x=${x}`,
        ],
      };
    },
  }),
  make({
    id: 'statistics.binomial',
    subject: 'S06',
    title: '二项分布',
    parameters: { n: p(1, 20, 10, 1), probability: p(0, 1, 0.5, 0.05) },
    description: 'n 次相互独立且成功概率相同的伯努利试验。',
    reference: '概率和为1，均值np，方差np(1−p)。',
    compute: (q) => ({
      values: { mean: q.n * q.probability, variance: q.n * q.probability * (1 - q.probability) },
      bars: Array.from(
        { length: q.n + 1 },
        (_, k) =>
          (factorial(q.n) / factorial(k) / factorial(q.n - k)) *
          q.probability ** k *
          (1 - q.probability) ** (q.n - k),
      ),
    }),
  }),
  make({
    id: 'statistics.sample_means',
    subject: 'S06',
    title: '样本均值与中心极限定理',
    parameters: { sampleSize: p(1, 100, 10, 1), seed: p(1, 10000, 42, 1) },
    description: '固定种子生成400组均匀分布样本的均值，比较其集中程度；直方图不等于理论证明。',
    reference: 'U(0,1) 的均值为0.5，样本均值方差为1/(12n)。',
    compute: (q) => {
      const rng = seeded(q.seed),
        bars = Array(20).fill(0);
      let sum = 0;
      for (let i = 0; i < 400; i++) {
        let mean = 0;
        for (let j = 0; j < q.sampleSize; j++) mean += rng() / q.sampleSize;
        sum += mean;
        bars[Math.min(19, Math.floor(mean * 20))]++;
      }
      return {
        values: { empiricalMean: sum / 400, theoreticalVariance: 1 / (12 * q.sampleSize) },
        bars,
      };
    },
  }),
  make({
    id: 'calculus.newton',
    subject: 'S07',
    title: '牛顿法求平方根',
    type: 'algorithm_trace',
    parameters: { value: p(0.1, 20, 2), initial: p(0.1, 10, 1), iterations: p(0, 8, 3, 1) },
    description: '迭代 x←(x+a/x)/2 求正数 a 的正平方根。',
    reference: 'a=2 时收敛到 √2。',
    compute: (q) => {
      let x = q.initial;
      const steps = [`初值 ${x}`],
        bars = [x];
      for (let i = 0; i < q.iterations; i++) {
        x = (x + q.value / x) / 2;
        steps.push(`第${i + 1}次：${x}`);
        bars.push(x);
      }
      return { values: { estimate: x, error: Math.abs(x - Math.sqrt(q.value)) }, steps, bars };
    },
  }),
  make({
    id: 'logic.truth_table',
    subject: 'S07',
    title: '逻辑与、或和蕴涵',
    type: 'algorithm_trace',
    parameters: { A: p(0, 1, 1, 1), B: p(0, 1, 0, 1) },
    description: '经典命题逻辑中，蕴涵 A→B 仅在 A 真 B 假时为假。',
    reference: 'A→B 等价于 ¬A∨B。',
    compute: (q) => ({
      values: {
        and: Number(!!q.A && !!q.B),
        or: Number(!!q.A || !!q.B),
        implication: Number(!q.A || !!q.B),
      },
      bars: [q.A, q.B, Number(!q.A || !!q.B)],
      steps: ['00 → 1', '01 → 1', '10 → 0', '11 → 1'],
    }),
  }),
  make({
    id: 'physics.spring',
    subject: 'S08',
    title: '理想弹簧与能量交换',
    mode: 'simplified',
    type: 'simulation',
    parameters: { mass: p(0.1, 5, 1), k: p(0.1, 20, 4), amplitude: p(0.1, 3, 1) },
    description: '无阻尼、满足胡克定律的单自由度振动；位移和能量来自同一时刻。',
    reference: 'ω=√(k/m)，总能量为kA²/2。',
    compute: (q, s) => {
      const omega = Math.sqrt(q.k / q.mass),
        x = q.amplitude * Math.cos((s / 100) * 2 * Math.PI),
        v = -q.amplitude * omega * Math.sin((s / 100) * 2 * Math.PI);
      return {
        values: {
          position: x,
          kinetic: (q.mass * v * v) / 2,
          potential: (q.k * x * x) / 2,
          total: (q.k * q.amplitude ** 2) / 2,
        },
        points: Array.from({ length: 101 }, (_, i) => [
          ((i / 100) * 2 * Math.PI) / omega,
          q.amplitude * Math.cos((i / 100) * 2 * Math.PI),
        ]),
      };
    },
  }),
  make({
    id: 'optics.interference',
    subject: 'S09',
    title: '双缝干涉强度',
    mode: 'simplified',
    parameters: { spacing: p(0.1, 5, 1), wavelength: p(0.1, 2, 0.5) },
    description: '两束同频相干等幅波的远场干涉；横轴为小角度的归一化屏幕位置。',
    reference: '归一化强度 cos²(πdx/λL)，本例 L=1。',
    compute: (q) => ({
      values: { fringeSpacing: q.wavelength / q.spacing },
      points: Array.from({ length: 201 }, (_, i) => {
        const x = (i - 100) / 100;
        return [x, Math.cos((Math.PI * q.spacing * x) / q.wavelength) ** 2];
      }),
    }),
  }),
  make({
    id: 'physics.ideal_gas',
    subject: 'S10',
    title: '理想气体等温过程',
    mode: 'simplified',
    parameters: { temperature: p(100, 600, 300, 10), moles: p(0.1, 3, 1) },
    description: '理想气体、恒温准静态变化；体积单位 L，压强单位 kPa。',
    reference: 'PV=nRT，R=8.314 J/(mol·K)。',
    compute: (q) => ({
      values: { pressureAt10L: (q.moles * 8.314 * q.temperature) / 10 },
      points: Array.from({ length: 100 }, (_, i) => [
        i + 1,
        (q.moles * 8.314 * q.temperature) / (i + 1),
      ]),
    }),
  }),
  make({
    id: 'physics.diffusion',
    subject: 'S10',
    title: '一维扩散逐步演化',
    mode: 'simplified',
    type: 'simulation',
    parameters: { alpha: p(0.01, 0.49, 0.2, 0.01) },
    description: '显式差分法、固定零边界，中央初始脉冲；无量纲稳定系数 α≤0.5。',
    reference: 'uᵢ(t+1)=uᵢ+α(uᵢ₋₁−2uᵢ+uᵢ₊₁)。',
    compute: (q, s) => {
      let a = Array(31).fill(0);
      a[15] = 1;
      for (let t = 0; t < s; t++)
        a = a.map((v, i) =>
          i === 0 || i === 30 ? 0 : v + q.alpha * (a[i - 1] - 2 * v + a[i + 1]),
        );
      return { values: { peak: Math.max(...a), remaining: a.reduce((x, y) => x + y, 0) }, bars: a };
    },
  }),
  make({
    id: 'physics.relativity',
    subject: 'S11',
    title: '时间膨胀',
    mode: 'simplified',
    parameters: { beta: p(0, 0.99, 0.5, 0.01), properTime: p(1, 10, 1) },
    description: '惯性系中的狭义相对论；β=v/c，给定同一对事件的固有时间。',
    reference: 'γ=1/√(1−β²)，Δt=γΔτ。',
    compute: (q) => ({
      values: {
        gamma: 1 / Math.sqrt(1 - q.beta * q.beta),
        coordinateTime: q.properTime / Math.sqrt(1 - q.beta * q.beta),
      },
      points: Array.from({ length: 100 }, (_, i) => [i / 100, 1 / Math.sqrt(1 - (i / 100) ** 2)]),
    }),
  }),
  make({
    id: 'physics.square_well',
    subject: 'S11',
    title: '无限深势阱概率密度',
    mode: 'simplified',
    parameters: { n: p(1, 6, 1, 1) },
    description: '一维无限深势阱 0<x<L，取无量纲 L=1；显示归一化定态概率密度。',
    reference: '|ψₙ|²=2sin²(nπx)，相对能量 Eₙ/E₁=n²。',
    compute: (q) => ({
      values: { relativeEnergy: q.n * q.n, normalization: 1 },
      points: Array.from({ length: 201 }, (_, i) => [
        i / 200,
        2 * Math.sin((q.n * Math.PI * i) / 200) ** 2,
      ]),
    }),
  }),
  make({
    id: 'chemistry.titration',
    subject: 'S12',
    title: '强酸强碱滴定',
    mode: 'simplified',
    parameters: { acidMolarity: p(0.01, 1, 0.1, 0.01), baseMl: p(0, 50, 10, 0.5) },
    description: '25°C，25 mL 强一元酸与0.1 mol/L强碱；忽略活度变化，使用水自解离求 pH。',
    reference: '等物质的量点pH=7；体积采用L参与物质的量计算。',
    compute: (q) => {
      const ph = (ml: number) => {
        const difference = (q.acidMolarity * 0.025 - (0.1 * ml) / 1000) / (0.025 + ml / 1000);
        const h =
          difference >= 0
            ? (difference + Math.sqrt(difference * difference + 4e-14)) / 2
            : 2e-14 / (Math.sqrt(difference * difference + 4e-14) - difference);
        return -Math.log10(h);
      };
      return {
        values: { pH: ph(q.baseMl), equivalenceMl: q.acidMolarity * 250 },
        points: Array.from({ length: 101 }, (_, i) => [i / 2, ph(i / 2)]),
      };
    },
  }),
  make({
    id: 'molecule.bond_angle',
    subject: 'S13',
    title: '四面体键角',
    mode: 'simplified',
    parameters: { angle: p(60, 150, 109.5, 0.5) },
    description:
      '用两个等长键向量观察夹角与端点距离。理想 sp³ 四面体键角约109.47°；这是结构示意，不预测构象能量。',
    reference: '两单位键端点距离为√(2−2cosθ)。',
    compute: (q) => {
      const a = (q.angle * Math.PI) / 180;
      return {
        values: {
          distance: Math.sqrt(2 - 2 * Math.cos(a)),
          idealAngle: (Math.acos(-1 / 3) * 180) / Math.PI,
        },
        points: [
          [1, 0],
          [0, 0],
          [Math.cos(a), Math.sin(a)],
        ],
      };
    },
  }),
  make({
    id: 'molecule.ethane_torsion',
    subject: 'S13',
    title: '乙烷扭转势能示意',
    mode: 'simplified',
    parameters: { angle: p(0, 360, 60, 1) },
    description: '三重周期经验示意势，仅解释交错与重叠构象；不作为量子化学能量预测。',
    reference: '示意 E=(1+cos3θ)/2，交错60°为极小值。',
    compute: (q) => ({
      values: { relativeEnergy: (1 + Math.cos((q.angle * Math.PI) / 60)) / 2 },
      points: Array.from({ length: 121 }, (_, i) => [
        i * 3,
        (1 + Math.cos((i * Math.PI) / 20)) / 2,
      ]),
      steps: ['0°：重叠构象（示意高能）', '60°：交错构象（示意低能）', '120°：再次重叠'],
    }),
  }),
  make({
    id: 'biology.mendel',
    subject: 'S14',
    title: '单基因杂交概率',
    parameters: { parent1: p(0, 2, 1, 1), parent2: p(0, 2, 1, 1) },
    description: '0=aa、1=Aa、2=AA；假设孟德尔分离、配子随机结合，无选择。',
    reference: 'Aa×Aa 得到 AA:Aa:aa=1:2:1。',
    compute: (q) => {
      const a = q.parent1 / 2,
        b = q.parent2 / 2;
      return {
        values: { AA: a * b, Aa: a * (1 - b) + (1 - a) * b, aa: (1 - a) * (1 - b) },
        bars: [a * b, a * (1 - b) + (1 - a) * b, (1 - a) * (1 - b)],
        steps: [
          '分别列出双亲产生 A 配子的概率',
          '配子随机结合，相乘得到各组合概率',
          '合并 Aa 与 aA 两种杂合组合',
        ],
      };
    },
  }),
  make({
    id: 'biology.transcription',
    subject: 'S14',
    title: 'DNA 模板链转录',
    type: 'algorithm_trace',
    parameters: { bases: p(1, 9, 3, 1) },
    description: '读取 DNA 模板链 3′-TACGGACTT-5′，沿模板3′→5′方向合成 RNA 5′→3′。',
    reference: '完整 RNA 为 5′-AUGCCUGAA-3′；本例只演示碱基配对，不包括启动与加工。',
    compute: (q) => {
      const dna = 'TACGGACTT',
        map: Record<string, string> = { T: 'A', A: 'U', C: 'G', G: 'C' };
      const rna = dna
        .slice(0, q.bases)
        .split('')
        .map((x) => map[x])
        .join('');
      return {
        values: { transcribed: q.bases },
        bars: ['A', 'U', 'G', 'C'].map((x) => rna.split('').filter((v) => v === x).length),
        steps: [
          `模板：3′-${dna}-5′`,
          `产物：5′-${rna}-3′`,
          ...dna
            .slice(0, q.bases)
            .split('')
            .map((x, i) => `${i + 1}: ${x} → ${map[x]}`),
        ],
      };
    },
  }),
  make({
    id: 'biology.logistic',
    subject: 'S15',
    title: '受限种群增长',
    mode: 'simplified',
    parameters: {
      rate: p(0.05, 2, 0.5, 0.05),
      capacity: p(20, 200, 100, 5),
      initial: p(1, 19, 10, 1),
    },
    description: '封闭种群、恒定环境容量和增长率；忽略年龄结构及随机扰动。',
    reference: 'N(t)=K/[1+(K/N₀−1)e⁻ʳᵗ]。',
    compute: (q, s) => {
      const at = (t: number) =>
        q.capacity / (1 + (q.capacity / q.initial - 1) * Math.exp(-q.rate * t));
      return {
        values: { population: at(s / 10) },
        points: Array.from({ length: 101 }, (_, i) => [i / 10, at(i / 10)]),
      };
    },
  }),
  make({
    id: 'algorithm.binary_search',
    subject: 'S16',
    title: '二分查找',
    type: 'algorithm_trace',
    parameters: { target: p(0, 15, 7, 1) },
    description: '在有序数组 [1,3,5,7,9,11,13,15] 中查找；每步保留可能含目标的区间。',
    reference: '最坏比较次数随数组长度呈对数增长。',
    compute: (q) => {
      const values = [1, 3, 5, 7, 9, 11, 13, 15],
        steps: string[] = [];
      let left = 0,
        right = 7,
        index = -1;
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        steps.push(`[${left},${right}]：检查 a[${mid}]=${values[mid]}`);
        if (values[mid] === q.target) {
          index = mid;
          break;
        }
        if (values[mid] < q.target) left = mid + 1;
        else right = mid - 1;
      }
      return { values: { index, comparisons: steps.length }, bars: values, steps };
    },
  }),
  make({
    id: 'systems.round_robin',
    subject: 'S17',
    title: '时间片轮转调度',
    type: 'algorithm_trace',
    parameters: { quantum: p(1, 5, 2, 1) },
    description: '三个进程同时到达，CPU需求分别5、3、1；忽略切换开销。',
    reference: '总运行时间恒为9；时间片改变响应顺序。',
    compute: (q) => {
      const remaining = [5, 3, 1],
        complete = [0, 0, 0],
        steps: string[] = [];
      let time = 0;
      while (remaining.some((v) => v > 0))
        for (let i = 0; i < 3; i++)
          if (remaining[i]) {
            const duration = Math.min(q.quantum, remaining[i]);
            steps.push(`t=${time}..${time + duration}: P${i + 1}`);
            time += duration;
            remaining[i] -= duration;
            if (!remaining[i]) complete[i] = time;
          }
      return {
        values: { totalTime: time, averageTurnaround: complete.reduce((a, b) => a + b, 0) / 3 },
        bars: complete,
        steps,
      };
    },
  }),
  make({
    id: 'systems.lru',
    subject: 'S17',
    title: 'LRU 页面替换',
    type: 'algorithm_trace',
    parameters: { frames: p(1, 5, 3, 1) },
    description: '固定访问串 [1,2,3,1,4,2,5,1]，满时淘汰最近最久未使用页。',
    reference: '统计缺页，不模拟真实主机内存。',
    compute: (q) => {
      let misses = 0;
      const cache: number[] = [],
        steps: string[] = [];
      for (const page of [1, 2, 3, 1, 4, 2, 5, 1]) {
        const at = cache.indexOf(page);
        if (at >= 0) cache.splice(at, 1);
        else {
          misses++;
          if (cache.length >= q.frames) cache.shift();
        }
        cache.push(page);
        steps.push(`${page}: ${at < 0 ? '缺页' : '命中'}，缓存 [${cache}]`);
      }
      return { values: { misses, hits: 8 - misses }, bars: [misses, 8 - misses], steps };
    },
  }),
  make({
    id: 'ml.linear_regression',
    subject: 'S18',
    title: '梯度下降拟合直线',
    type: 'ml_lab',
    parameters: { learningRate: p(0.001, 0.05, 0.01, 0.001), iterations: p(1, 200, 50, 1) },
    description: '用固定训练集拟合 y≈2x+1；验证点只用于评估，不参与梯度更新。',
    reference: '对均方误差使用解析梯度；初始 w=b=0。',
    compute: (q) => {
      const train = [
          [-2, -3],
          [-1, -1],
          [0, 1],
          [1, 3],
          [2, 5],
        ],
        losses: number[][] = [];
      let w = 0,
        b = 0;
      for (let i = 0; i < q.iterations; i++) {
        let dw = 0,
          db = 0,
          loss = 0;
        for (const [x, y] of train) {
          const e = w * x + b - y;
          dw += (2 * e * x) / 5;
          db += (2 * e) / 5;
          loss += (e * e) / 5;
        }
        w -= q.learningRate * dw;
        b -= q.learningRate * db;
        losses.push([i, loss]);
      }
      return {
        values: {
          weight: w,
          bias: b,
          validationMSE: ((3 * w + b - 7) ** 2 + (-3 * w + b + 5) ** 2) / 2,
        },
        points: losses,
      };
    },
  }),
  make({
    id: 'ml.kmeans',
    subject: 'S18',
    title: '一维 k-means 迭代',
    type: 'ml_lab',
    parameters: { iterations: p(0, 10, 2, 1) },
    description: '固定两类、固定初始中心，交替分配样本和更新均值；无监督聚类没有真实类别标签输入。',
    reference: '数据[1,2,3,8,9,10]收敛至中心2和9。',
    compute: (q) => {
      let centers = [1, 3];
      const values = [1, 2, 3, 8, 9, 10],
        steps: string[] = [];
      for (let t = 0; t < q.iterations; t++) {
        const groups: number[][] = [[], []];
        for (const x of values)
          groups[Math.abs(x - centers[0]) <= Math.abs(x - centers[1]) ? 0 : 1].push(x);
        centers = groups.map((g, i) =>
          g.length ? g.reduce((a, b) => a + b, 0) / g.length : centers[i],
        );
        steps.push(`第${t + 1}轮中心：[${centers}]`);
      }
      return { values: { center1: centers[0], center2: centers[1] }, bars: centers, steps };
    },
  }),
  make({
    id: 'neural.attention',
    subject: 'S19',
    title: '注意力归一化与掩码',
    type: 'neural_lab',
    parameters: { query: p(-3, 3, 1), maskLast: p(0, 1, 0, 1) },
    description:
      '单维 query 与三个 key=[−1,0,1] 点积，softmax 后对 value=[1,2,4] 加权；最后一项可被掩码。',
    reference: 'query=0 且无掩码时每项权重1/3；被掩码项权重为0。',
    compute: (q) => {
      const logits = [-q.query, 0, q.query],
        weights = q.maskLast ? [...softmax(logits.slice(0, 2)), 0] : softmax(logits);
      return {
        values: {
          output: weights[0] + 2 * weights[1] + 4 * weights[2],
          weightSum: weights.reduce((a, b) => a + b, 0),
        },
        bars: weights,
        steps: [
          `QKᵀ: [${logits}]`,
          q.maskLast ? '对最后一个位置施加掩码' : '无掩码',
          `softmax：[${weights.map((x) => x.toFixed(4))}]`,
        ],
      };
    },
  }),
  make({
    id: 'control.pid',
    subject: 'S20',
    title: '一阶对象的 PID 控制',
    mode: 'simplified',
    type: 'simulation',
    parameters: { kp: p(0, 5, 1), ki: p(0, 2, 0.5), kd: p(0, 1, 0) },
    description:
      '对 dy/dt=−y+u 的单位阶跃跟踪，固定步长0.02s；限制控制量在±10，不适用于真实设备控制。',
    reference: '显示误差积分与饱和约束；数值结果依赖步长。',
    compute: (q) => {
      let y = 0,
        integral = 0,
        last = 1;
      const points: number[][] = [];
      for (let i = 0; i < 500; i++) {
        const e = 1 - y;
        integral = Math.max(-10, Math.min(10, integral + e * 0.02));
        const u = Math.max(
          -10,
          Math.min(10, q.kp * e + q.ki * integral + (q.kd * (e - last)) / 0.02),
        );
        y += 0.02 * (-y + u);
        last = e;
        points.push([i * 0.02, y]);
      }
      return { values: { finalValue: y, steadyError: 1 - y }, points };
    },
  }),
  make({
    id: 'signal.aliasing',
    subject: 'S20',
    title: '采样与混叠',
    parameters: { frequency: p(1, 20, 7, 1), sampleRate: p(2, 30, 10, 1) },
    description: '对单位正弦波作均匀采样；显示折叠到Nyquist区间的频率。',
    reference: '7Hz信号以10Hz采样与3Hz混叠。',
    compute: (q) => ({
      values: {
        nyquist: q.sampleRate / 2,
        alias: Math.abs(q.frequency - Math.round(q.frequency / q.sampleRate) * q.sampleRate),
      },
      points: Array.from({ length: q.sampleRate + 1 }, (_, i) => [
        i / q.sampleRate,
        Math.sin((2 * Math.PI * q.frequency * i) / q.sampleRate),
      ]),
    }),
  }),
  make({
    id: 'earth.seasons',
    subject: 'S21',
    title: '太阳赤纬与季节',
    mode: 'simplified',
    parameters: { tilt: p(0, 30, 23.44, 0.01), day: p(0, 365, 80, 1) },
    description: '圆轨道与正弦近似，忽略偏心率；季节主要来自地轴倾斜，不是日地距离远近。',
    reference: '倾角为零时模型中的赤纬全年为零。',
    compute: (q) => ({
      values: { declination: q.tilt * Math.sin((2 * Math.PI * (q.day - 80)) / 365) },
      points: Array.from({ length: 366 }, (_, i) => [
        i,
        q.tilt * Math.sin((2 * Math.PI * (i - 80)) / 365),
      ]),
      steps: [
        '春分附近：赤纬约0°',
        '夏至附近：北半球朝向太阳',
        '秋分附近：赤纬约0°',
        '冬至附近：南半球朝向太阳',
      ],
    }),
  }),
  make({
    id: 'earth.radiative_balance',
    subject: 'S21',
    title: '行星辐射平衡',
    mode: 'simplified',
    parameters: { albedo: p(0, 0.9, 0.3, 0.01), solar: p(500, 2000, 1361, 1) },
    description: '无大气、均匀辐射的黑体平衡；不预测地表实际温度或复杂气候。',
    reference: 'T=[S(1−α)/(4σ)]^(1/4)，σ=5.670374419×10⁻⁸。',
    compute: (q) => ({
      values: { temperatureK: ((q.solar * (1 - q.albedo)) / (4 * 5.670374419e-8)) ** 0.25 },
      points: Array.from({ length: 91 }, (_, i) => [
        i / 100,
        ((q.solar * (1 - i / 100)) / (4 * 5.670374419e-8)) ** 0.25,
      ]),
    }),
  }),
  make({
    id: 'economics.supply_demand',
    subject: 'S22',
    title: '供需均衡',
    mode: 'simplified',
    parameters: { demandIntercept: p(5, 30, 20), supplyIntercept: p(0, 4, 2) },
    description: '线性需求 Qd=a−P 与供给 Qs=b+P，无其他市场摩擦。',
    reference: '均衡 P=(a−b)/2，Q=(a+b)/2。',
    compute: (q) => ({
      values: {
        price: (q.demandIntercept - q.supplyIntercept) / 2,
        quantity: (q.demandIntercept + q.supplyIntercept) / 2,
      },
      points: [
        [0, q.demandIntercept],
        [q.demandIntercept, 0],
      ],
      steps: [
        `需求：Q=${q.demandIntercept}−P`,
        `供给：Q=${q.supplyIntercept}+P`,
        '联立需求等于供给得到均衡',
      ],
    }),
  }),
  make({
    id: 'economics.prisoner',
    subject: 'S22',
    title: '囚徒困境与收益',
    type: 'algorithm_trace',
    parameters: { cooperateA: p(0, 1, 1, 1), cooperateB: p(0, 1, 1, 1) },
    description: '1=合作，0=背叛。固定收益矩阵：双方合作3，双方背叛1，单方背叛者5、合作者0。',
    reference: '背叛为严格优势策略；双方背叛的均衡不达到最大总收益。',
    compute: (q) => {
      const a = q.cooperateA,
        b = q.cooperateB,
        pa = a ? (b ? 3 : 0) : b ? 5 : 1,
        pb = b ? (a ? 3 : 0) : a ? 5 : 1;
      return {
        values: { payoffA: pa, payoffB: pb, total: pa + pb },
        bars: [pa, pb],
        steps: [
          '对方合作时：背叛5 > 合作3',
          '对方背叛时：背叛1 > 合作0',
          '分别推导最佳回应得到(背叛,背叛)均衡',
        ],
      };
    },
  }),
];
