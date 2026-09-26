import { requireThat } from './errors.js';
type Unit = { dimensions: number[]; scale: number; offset: number };
const dims = (m = 0, kg = 0, s = 0, A = 0, K = 0, mol = 0, cd = 0, angle = 0) => [
  m,
  kg,
  s,
  A,
  K,
  mol,
  cd,
  angle,
];
const unit = (dimensions: number[], scale = 1, offset = 0): Unit => ({ dimensions, scale, offset });
const registry: Record<string, Unit> = {
  '': unit(dims()),
  '%': unit(dims(), 0.01),
  m: unit(dims(1)),
  kg: unit(dims(0, 1)),
  g: unit(dims(0, 1), 0.001),
  s: unit(dims(0, 0, 1)),
  min: unit(dims(0, 0, 1), 60),
  h: unit(dims(0, 0, 1), 3600),
  A: unit(dims(0, 0, 0, 1)),
  K: unit(dims(0, 0, 0, 0, 1)),
  mol: unit(dims(0, 0, 0, 0, 0, 1)),
  cd: unit(dims(0, 0, 0, 0, 0, 0, 1)),
  N: unit(dims(1, 1, -2)),
  Pa: unit(dims(-1, 1, -2)),
  J: unit(dims(2, 1, -2)),
  W: unit(dims(2, 1, -3)),
  C: unit(dims(0, 0, 1, 1)),
  V: unit(dims(2, 1, -3, -1)),
  ohm: unit(dims(2, 1, -3, -2)),
  F: unit(dims(-2, -1, 4, 2)),
  H: unit(dims(2, 1, -2, -2)),
  T: unit(dims(0, 1, -2, -1)),
  Hz: unit(dims(0, 0, -1)),
  L: unit(dims(3), 0.001),
  eV: unit(dims(2, 1, -2), 1.602176634e-19),
  rad: unit(dims(0, 0, 0, 0, 0, 0, 0, 1)),
  deg: unit(dims(0, 0, 0, 0, 0, 0, 0, 1), Math.PI / 180),
  '°C': unit(dims(0, 0, 0, 0, 1), 1, 273.15),
};
const aliases: Record<string, string> = { Ω: 'ohm', '℃': '°C', '°': 'deg', percent: '%', l: 'L' };
const prefixes: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  m: 1e-3,
  c: 1e-2,
  d: 1e-1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
};
const prefixable = new Set([
  'm',
  'g',
  's',
  'A',
  'K',
  'mol',
  'cd',
  'N',
  'Pa',
  'J',
  'W',
  'C',
  'V',
  'ohm',
  'F',
  'H',
  'T',
  'Hz',
  'L',
  'eV',
]);
function atomic(name: string): Unit {
  const key = aliases[name] ?? name;
  if (registry[key]) return registry[key];
  const prefix = prefixes[key[0]],
    base = key.slice(1);
  requireThat(
    prefix && prefixable.has(base) && registry[base],
    'UNIT_UNSUPPORTED',
    '未注册的单位：' + name,
  );
  return { ...registry[base], scale: prefix * registry[base].scale };
}
export function parseUnit(expression: string): Unit {
  requireThat(expression.length <= 40, 'UNIT_UNSUPPORTED', '单位表达式过长');
  if (!expression.includes('*') && !expression.includes('/') && !expression.includes('^'))
    return atomic(expression);
  const tokens = expression.match(/[*/]|[^*/]+/g) ?? [];
  requireThat(tokens.length <= 15 && tokens.length % 2 === 1, 'UNIT_UNSUPPORTED', '单位表达式无效');
  let sign = 1;
  const result = unit(dims());
  for (let i = 0; i < tokens.length; i++) {
    if (i % 2 === 1) {
      requireThat(tokens[i] === '*' || tokens[i] === '/', 'UNIT_UNSUPPORTED', '单位运算符无效');
      sign = tokens[i] === '/' ? -1 : 1;
      continue;
    }
    const match = /^([A-Za-zµΩ°℃%]+)(?:\^(-?[1-6]))?$/.exec(tokens[i]);
    requireThat(match, 'UNIT_UNSUPPORTED', '单位幂或符号无效');
    const value = atomic(match[1]);
    requireThat(value.offset === 0, 'UNIT_UNSUPPORTED', '偏移温度单位不能参与乘除');
    const power = sign * Number(match[2] ?? 1);
    for (let j = 0; j < 8; j++) result.dimensions[j] += value.dimensions[j] * power;
    result.scale *= value.scale ** power;
  }
  requireThat(
    Number.isFinite(result.scale) &&
      result.scale > 0 &&
      result.dimensions.every((x) => Math.abs(x) <= 12),
    'UNIT_UNSUPPORTED',
    '单位表达式超出范围',
  );
  return result;
}
export function convert(value: number, from: string, to: string) {
  const a = parseUnit(from),
    b = parseUnit(to);
  requireThat(
    a.dimensions.every((v, i) => v === b.dimensions[i]),
    'UNIT_UNSUPPORTED',
    '单位量纲或角度语义不一致',
  );
  const result = (value * a.scale + a.offset - b.offset) / b.scale;
  requireThat(Number.isFinite(result), 'ANSWER_INVALID', '换算结果不是有限数值', 400);
  return result;
}
