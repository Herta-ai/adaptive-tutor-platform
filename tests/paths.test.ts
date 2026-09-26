import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/database.js';
import { Courses } from '../src/domain/courses.js';
import { createMechanicsExample } from '../src/domain/paths.js';
import { capability } from '../src/capabilities/registry.js';
import { Transfer } from '../src/transfer/learn.js';
let store: Store | undefined, root: string;
afterEach(() => {
  store?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});
it('S08 三节点力学路径：独立手算答案、解锁、幂等及内容包往返', async () => {
  root = mkdtempSync(join(tmpdir(), 'tutor-path-'));
  const s = (store = new Store(root)),
    c = new Courses(s);
  const course = createMechanicsExample(c, 'mechanics');
  expect(createMechanicsExample(c, 'mechanics').id).toBe(course.id);
  const nodes = s.list('node', course.id);
  expect(nodes).toHaveLength(3);
  const answers = [
    [10, 20, 1],
    [2, 2, 6],
    [Math.PI, 4, 2],
  ];
  for (const [i, n] of nodes.entries()) {
    const lesson = c.lesson(n.id);
    expect(lesson.blocks.some((b: any) => b.templateId)).toBe(true);
    const exercises = s.list('exercise', course.id, n.id);
    expect(new Set(exercises.map((e) => e.familyId)).size).toBe(3);
    exercises.forEach((e, j) => expect(e.grading.expected).toBeCloseTo(answers[i][j]));
    const p = s.transaction(() => c.start(n.id, 'start-' + i));
    for (let j = 0; j < 2; j++) {
      const a = s.transaction(() => c.assign(n.id, p.cycleId, n.objectives[0].id));
      const exercise = s.must('exercise', s.must('assignment', a.assignmentId).exerciseId);
      s.transaction(() =>
        c.attempt(a.assignmentId, `a-${i}-${j}`, {
          value: String(answers[i][j]),
          unit: exercise.grading.unit,
        }),
      );
    }
    expect(s.must('progress', n.id).masteredOnce).toBe(true);
  }
  expect(
    capability('physics.projectile').compute({ speed: 10, angle: 45, g: 10 }, 100).values.range,
  ).toBeCloseTo(10);
  expect(
    capability('physics.spring').compute({ mass: 1, k: 4, amplitude: 1 }, 0).values.potential,
  ).toBeCloseTo(2);
  const t = new Transfer(s, c),
    output = await t.export(course.id, 'content', 'learn');
  const preview = await t.validate(join(root, 'exports', output.exportId + '.learn'));
  const restored = s.transaction(() => t.commit(preview.importId, 'fresh'));
  expect(s.list('exercise', restored.courseId)).toHaveLength(9);
  expect(s.list('lesson', restored.courseId)).toHaveLength(3);
});
