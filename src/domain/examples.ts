import { Courses } from './courses.js';
import { uuid, now } from '../storage/database.js';
// Reference answers are hand-derived in source; external human review remains tracked separately.
export function createGeometryExample(courses: Courses, clientRequestId: string = uuid()) {
  const s = courses.store;
  return s.command('example.geometry', clientRequestId, {}, () => {
    const c = s.put('course', {
      id: uuid(),
      topic: '直角三角形：从面积到勾股定理',
      title: '直角三角形：从面积到勾股定理',
      goal: '计算直角三角形面积、斜边并区分缩放规律',
      profile: { background: '已了解乘法与平方', weeklyMinutes: 60, language: '中文' },
      revision: 1,
      status: 'draft',
      createdAt: now(),
    });
    courses.publishPlan(c.id, 1, {
      schemaVersion: '1.0',
      title: c.title,
      summary: '三个概念，逐步建立几何与代数的联系。',
      concepts: [
        { key: 'area', label: '面积' },
        { key: 'hypotenuse', label: '勾股定理' },
        { key: 'scale', label: '相似缩放' },
      ],
      nodes: [
        ['area', '直角三角形的面积', '用底和高求面积'],
        ['hypotenuse', '从两条直角边求斜边', '应用勾股定理'],
        ['scale', '长度与面积如何缩放', '区分线性与平方缩放'],
      ].map(([key, title, description]) => ({
        key,
        conceptKey: key,
        title,
        objectives: [{ key: 'objective', description }],
        estimatedMinutes: 10,
      })),
      edges: [
        { fromKey: 'area', toKey: 'hypotenuse' },
        { fromKey: 'hypotenuse', toKey: 'scale' },
      ],
      sources: [],
    });
    const lessons = [
      {
        explanation:
          '直角三角形是同底同高矩形的一半。面积公式为 $A=\\frac{1}{2}wh$。拖动下面的参数，比较宽和高各增加一倍时的变化。',
        worked: '当底为 4、高为 3 时，面积为 $4\\times3/2=6$。',
        questions: [
          ['已知底为 6、高为 4，面积是多少？', 12, 'direct_area'],
          ['面积为 15，高为 5，底是多少？', 6, 'inverse_base'],
          ['与底为 4、高为 3 的直角三角形同底同高的矩形，面积是多少？', 12, 'rectangle_relation'],
        ],
      },
      {
        explanation:
          '欧氏平面中的直角三角形满足 $c^2=a^2+b^2$，其中 $c$ 是斜边。斜边必须是最长边。',
        worked: '两直角边分别是 3 和 4，斜边为 $\\sqrt{9+16}=5$。',
        questions: [
          ['两直角边为 5 和 12，斜边为多少？', 13, 'direct_hypotenuse'],
          ['斜边为 10，一条直角边为 6，另一条直角边是多少？', 8, 'inverse_leg'],
          ['边长 6、8、10 的三角形中，最长边的平方是多少？', 100, 'identify_hypotenuse'],
        ],
      },
      {
        explanation:
          '相似图形中，所有长度乘以 $k$，面积乘以 $k^2$。面积包含两个长度因子，所以不会仅增加 $k$ 倍。',
        worked: '底和高都扩大 2 倍，原来面积 6 变为 $6\\times2^2=24$。',
        questions: [
          ['所有边长扩大 3 倍，面积扩大几倍？', 9, 'forward_area_scale'],
          ['面积扩大 16 倍，正的长度缩放倍数是多少？', 4, 'inverse_length_scale'],
          ['所有长度扩大 2 倍，周长扩大几倍？', 2, 'perimeter_scale'],
        ],
      },
    ];
    s.list('node', c.id).forEach((node, index) => {
      const content = lessons[index];
      courses.publishLesson(
        node.id,
        {
          schemaVersion: '1.0',
          title: node.title,
          blocks: [
            {
              blockId: 'goal',
              type: 'markdown',
              role: 'goal',
              text: node.objectives[0].description,
            },
            {
              blockId: 'explanation',
              type: 'markdown',
              role: 'explanation',
              text: content.explanation,
            },
            { blockId: 'example', type: 'markdown', role: 'worked_example', text: content.worked },
            {
              blockId: 'triangle',
              type: 'geometry2d',
              templateId: 'math.right_triangle',
              templateVersion: 1,
              config: { width: 4, height: 3 },
              modelInfo: {
                mode: 'computed',
                assumptions: ['欧氏平面；长度单位相同'],
                units: { length: '' },
                sourceIds: [],
                tolerance: 1e-9,
              },
              alt: '宽 4、高 3 的直角三角形，可用滑块调整尺寸。',
            },
            {
              blockId: 'recap',
              type: 'markdown',
              role: 'recap',
              text: '先预测，再调整参数检验。完成下面两道独立练习可以建立初步掌握证据。',
            },
          ],
          exercises: content.questions.map(([prompt, expected, familyKey], i) => ({
            key: 'exercise-' + i,
            objectiveId: node.objectives[0].id,
            familyKey,
            kind: 'numeric',
            prompt,
            explanation: `参考结果为 ${expected}。请结合上面的公式检查每一步。`,
            grading: {
              expected,
              unit: '',
              allowedUnits: [''],
              absTolerance: 1e-8,
              relTolerance: 1e-8,
            },
          })),
          sources: [],
          assetRefs: [],
        },
        { runtime: 'builtin' },
      );
    });
    return s.must('course', c.id);
  });
}
