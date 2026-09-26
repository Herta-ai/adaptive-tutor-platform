import { Courses } from './courses.js';
import { now, uuid } from '../storage/database.js';
import { capability } from '../capabilities/registry.js';
import { createGeometryExample } from './examples.js';

type Question = {
  prompt: string;
  expected: number;
  unit: string;
  family: string;
  explanation: string;
};
const mechanics = [
  {
    key: 'range',
    title: '抛体运动的射程',
    goal: '用射程公式计算同高度抛体的水平位移',
    explanation:
      '忽略空气阻力，重力加速度恒定，起点与落点等高。水平速度保持不变，竖直速度受重力改变。由竖直位移为零求飞行时间，再乘水平速度，得到 $R=v_0^2\\sin(2\\theta)/g$。先预测角度从 30° 调到 60° 时射程是否相同，再拖动角度检验。单步观察飞行时间和轨迹。',
    worked:
      '取 $v_0=10\\,m/s$、$\\theta=45^\\circ$、$g=10\\,m/s^2$，射程为 $100\\sin90^\\circ/10=10\\,m$。',
    recap:
      '等高度、无阻力是此公式的前提。初速加倍使射程变为四倍；同初速下互余的发射角具有相同射程。',
    template: 'physics.projectile',
    config: { speed: 10, angle: 45, g: 10 },
    assumptions: ['忽略空气阻力', '重力恒定', '起点与落点等高'],
    units: { speed: 'm/s', g: 'm/s^2', angle: 'deg', range: 'm', time: 's' },
    questions: [
      {
        prompt: '初速 10 m/s，以 45° 发射，g=10 m/s²，落回同一高度时射程是多少米？',
        expected: 10,
        unit: 'm',
        family: 'forward-range',
        explanation: 'R=10²×sin90°/10=10 m。',
      },
      {
        prompt: '希望在同高度、45° 发射条件下射程为 40 m，g=10 m/s²，需要的初速是多少 m/s？',
        expected: 20,
        unit: 'm/s',
        family: 'inverse-speed',
        explanation: 'v=√(Rg)=√400=20 m/s，取正根。',
      },
      {
        prompt:
          '同初速、同重力下，以 30° 和 60° 发射并落回原高度，前者射程除以后者射程的比值是多少？',
        expected: 1,
        unit: '',
        family: 'complementary-angle',
        explanation: 'sin60°=sin120°，所以两射程相等，比值为1。',
      },
    ] satisfies Question[],
  },
  {
    key: 'energy',
    title: '弹簧如何储存能量',
    goal: '应用弹性势能公式及机械能守恒',
    explanation:
      '在线性弹簧、无阻尼模型中，以平衡位置为零势能点，弹性势能为 $E_p=kx^2/2$。从振幅 A 处静止释放，总机械能为 $kA^2/2$，运动中动能与势能互相转化。先预测位移为零时哪种能量最大，再单步观察 kinetic 与 potential；total 应保持不变。',
    worked:
      'k=4 N/m，振幅 A=1 m。从最大位移静止释放时，动能为0，势能及总能量均为 $4\\times1^2/2=2\\,J$。',
    recap: '势能与位移的平方成正比；负位移也有非负势能。无阻尼时动能与势能之和不随时刻改变。',
    template: 'physics.spring',
    config: { mass: 1, k: 4, amplitude: 1 },
    assumptions: ['线性胡克定律', '无阻尼', '单自由度', '平衡点为零势能'],
    units: {
      mass: 'kg',
      k: 'N/m',
      amplitude: 'm',
      position: 'm',
      kinetic: 'J',
      potential: 'J',
      total: 'J',
    },
    questions: [
      {
        prompt: '弹簧刚度 k=4 N/m，偏离平衡位置 1 m，弹性势能为多少焦耳？',
        expected: 2,
        unit: 'J',
        family: 'potential-energy',
        explanation: 'Ep=kx²/2=4×1²/2=2 J。',
      },
      {
        prompt: '刚度为 4 N/m 的弹簧在振幅处静止，总能量为 8 J；正的振幅是多少米？',
        expected: 2,
        unit: 'm',
        family: 'inverse-amplitude',
        explanation: 'A=√(2E/k)=√(16/4)=2 m。',
      },
      {
        prompt: '无阻尼振子总机械能为 8 J，在某位置势能为 2 J，此时动能是多少焦耳？',
        expected: 6,
        unit: 'J',
        family: 'energy-partition',
        explanation: '由能量守恒，Ek=E−Ep=8−2=6 J。',
      },
    ] satisfies Question[],
  },
  {
    key: 'period',
    title: '简谐振动的周期',
    goal: '用质量和刚度确定简谐振动周期',
    explanation:
      '牛顿第二定律与胡克定律给出 $m\\ddot{x}=-kx$，其解为 $x=A\\cos(\\omega t)$，其中 $\\omega=\\sqrt{k/m}$。完整振动的周期为 $T=2\\pi\\sqrt{m/k}$。本演示单步从周期的0%推进到100%；曲线横坐标为秒。保持刚度不变把质量增至四倍，比较曲线的时间跨度。',
    worked: 'm=1 kg，k=4 N/m，则角频率为2 rad/s，周期为 $2\\pi/2=\\pi\\,s$，约3.14159秒。',
    recap: '质量增大使周期变长，刚度增大使周期变短。在线性、无阻尼假设下，周期与振幅无关。',
    template: 'physics.spring',
    config: { mass: 1, k: 4, amplitude: 1 },
    assumptions: ['线性胡克定律', '无阻尼', '从最大位移静止释放'],
    units: {
      mass: 'kg',
      k: 'N/m',
      amplitude: 'm',
      position: 'm',
      kinetic: 'J',
      potential: 'J',
      total: 'J',
    },
    questions: [
      {
        prompt:
          '质量 1 kg、刚度 4 N/m 的理想弹簧振子，周期为多少秒？请输入小数，允许误差 0.00001 秒。',
        expected: Math.PI,
        unit: 's',
        family: 'forward-period',
        explanation: 'T=2π√(m/k)=2π√(1/4)=π s。',
      },
      {
        prompt: '理想振子质量不变，要让周期变为原来的一半，刚度应变为原来的几倍？',
        expected: 4,
        unit: '',
        family: 'inverse-stiffness',
        explanation: 'T与1/√k成正比，所以k需变为原来的4倍。',
      },
      {
        prompt: '保持刚度和振幅不变，将振子质量增至原来的四倍，新周期除以原周期的比值是多少？',
        expected: 2,
        unit: '',
        family: 'mass-scaling',
        explanation: 'T与√m成正比，√4=2。',
      },
    ] satisfies Question[],
  },
];

export function createMechanicsExample(courses: Courses, clientRequestId: string = uuid()) {
  const s = courses.store;
  return s.command('example.mechanics', clientRequestId, {}, () => {
    const course = s.put('course', {
      id: uuid(),
      title: '力学：从抛体到弹簧振动',
      topic: '力学：从抛体到弹簧振动',
      goal: '建立运动、能量与周期的定量联系',
      profile: { background: '代数、平方根和三角函数基础', weeklyMinutes: 60, language: '中文' },
      revision: 1,
      status: 'draft',
      createdAt: now(),
    });
    courses.publishPlan(course.id, 1, {
      schemaVersion: '1.0',
      title: course.title,
      summary: '三个理想模型，分别练习公式应用、能量守恒与比例推理。',
      concepts: mechanics.map((n) => ({ key: n.key, label: n.title })),
      nodes: mechanics.map((n) => ({
        key: n.key,
        conceptKey: n.key,
        title: n.title,
        objectives: [{ key: 'objective', description: n.goal }],
        estimatedMinutes: 10,
      })),
      edges: mechanics.slice(1).map((n, i) => ({ fromKey: mechanics[i].key, toKey: n.key })),
      sources: [],
    });
    for (const [i, node] of s.list('node', course.id).entries()) {
      const content = mechanics[i],
        cap = capability(content.template);
      courses.publishLesson(
        node.id,
        {
          schemaVersion: '1.0',
          title: node.title,
          blocks: [
            { blockId: 'goal', type: 'markdown', role: 'goal', text: content.goal },
            {
              blockId: 'explanation',
              type: 'markdown',
              role: 'explanation',
              text: content.explanation,
            },
            { blockId: 'example', type: 'markdown', role: 'worked_example', text: content.worked },
            {
              blockId: 'experiment',
              type: cap.type,
              templateId: cap.id,
              templateVersion: cap.version,
              config: content.config,
              modelInfo: {
                mode: cap.mode,
                assumptions: content.assumptions,
                units: content.units,
                sourceIds: ['openstax'],
                tolerance: 1e-8,
              },
              alt: content.title + '：使用滑块调整参数，单步观察数值变化。',
            },
            { blockId: 'recap', type: 'markdown', role: 'recap', text: content.recap },
          ],
          exercises: content.questions.map((q, j) => ({
            key: 'question-' + j,
            objectiveId: node.objectives[0].id,
            familyKey: q.family,
            kind: 'numeric',
            prompt: q.prompt,
            explanation: q.explanation,
            grading: {
              expected: q.expected,
              unit: q.unit,
              allowedUnits: [q.unit],
              absTolerance: 1e-5,
              relTolerance: 1e-8,
            },
          })),
          sources: [
            {
              id: 'openstax',
              title: 'OpenStax University Physics Volume 1：运动、势能与振动章节',
              url: 'https://openstax.org/details/books/university-physics-volume-1',
              status: 'suggested',
              supportsBlockIds: ['explanation', 'example', 'experiment'],
            },
          ],
          assetRefs: [],
        },
        { runtime: 'builtin' },
      );
    }
    return s.must('course', course.id);
  });
}

export const builtInPaths = [
  { id: 'geometry', subject: '数学', create: createGeometryExample },
  { id: 'mechanics', subject: '力学', create: createMechanicsExample },
];
