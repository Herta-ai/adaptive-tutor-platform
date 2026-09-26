import type { Capability } from './registry.js';
const p = (min: number, max: number, value: number, step = 0.1) => ({ min, max, value, step });
export const spatial: Capability[] = [
  {
    id: 'scene.cube_section',
    version: 1,
    subject: 'S03',
    title: '立方体的平面截面',
    type: 'scene3d',
    mode: 'computed',
    parameters: { angle: p(0, 90, 45, 1), offset: p(-0.9, 0.9, 0) },
    description:
      '边长为2、中心在原点的立方体。改变截平面的倾角和到原点的有符号距离，交点从棱与平面方程实时计算。',
    reference: 'angle=0、offset=0 时得到边长2的正方形，面积4。',
    compute: (q) => {
      const a = (q.angle * Math.PI) / 180,
        normal = [Math.sin(a), 0, Math.cos(a)],
        points: number[][] = [];
      const vertices = Array.from({ length: 8 }, (_, i) => [
        i & 1 ? 1 : -1,
        i & 2 ? 1 : -1,
        i & 4 ? 1 : -1,
      ]);
      for (let i = 0; i < 8; i++)
        for (const bit of [1, 2, 4]) {
          const j = i ^ bit;
          if (j < i) continue;
          const v = vertices[i],
            w = vertices[j],
            d0 = normal.reduce((s, n, k) => s + n * v[k], 0) - q.offset,
            d1 = normal.reduce((s, n, k) => s + n * w[k], 0) - q.offset;
          if (Math.abs(d0 - d1) < 1e-10) continue;
          const t = d0 / (d0 - d1);
          if (t >= -1e-9 && t <= 1 + 1e-9) {
            const point = v.map((x, k) => x + t * (w[k] - x));
            if (!points.some((p) => p.every((x, k) => Math.abs(x - point[k]) < 1e-8)))
              points.push(point);
          }
        }
      const u = [Math.cos(a), 0, -Math.sin(a)],
        dot = (v: number[]) => v.reduce((s, x, k) => s + x * u[k], 0);
      points.sort((x, y) => Math.atan2(x[1], dot(x)) - Math.atan2(y[1], dot(y)));
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const x = points[i],
          y = points[(i + 1) % points.length];
        area += dot(x) * y[1] - dot(y) * x[1];
      }
      return { values: { area: Math.abs(area) / 2, vertices: points.length }, positions: points };
    },
  },
  {
    id: 'molecule.methane',
    version: 1,
    subject: 'S13',
    title: '甲烷的理想四面体结构',
    type: 'molecule',
    mode: 'simplified',
    parameters: { bondLength: p(0.8, 1.4, 1.09, 0.01) },
    description:
      '理想四面体坐标模型，中心为C、四个顶点为H；长度单位Å。可旋转并点选原子。不进行构象优化或反应预测。',
    reference: '四个C—H方向的两两夹角均为acos(−1/3)≈109.47°。',
    compute: (q) => ({
      values: { bondLength: q.bondLength, bondAngle: (Math.acos(-1 / 3) * 180) / Math.PI },
      atoms: [
        { id: 'C1', element: 'C', position: [0, 0, 0] },
        ...[
          [1, 1, 1],
          [1, -1, -1],
          [-1, 1, -1],
          [-1, -1, 1],
        ].map((v, i) => ({
          id: 'H' + (i + 1),
          element: 'H',
          position: v.map((x) => (x * q.bondLength) / Math.sqrt(3)),
        })),
      ],
    }),
  },
];
