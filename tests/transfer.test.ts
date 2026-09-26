import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, uuid } from '../src/storage/database.js';
import { Courses } from '../src/domain/courses.js';
import { createGeometryExample } from '../src/domain/examples.js';
import { Transfer, safeEntry } from '../src/transfer/learn.js';
import { portableCourse, validateExerciseBank } from '../src/transfer/validation.js';
const roots: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
describe('A16 内容包往返', () => {
  it('拒绝题库中跨节点引用、家族分裂和历史答案篡改', () => {
    const root = mkdtempSync(join(tmpdir(), 'tutor-bank-validation-'));
    roots.push(root);
    const s = new Store(root);
    stores.push(s);
    const c = new Courses(s),
      course = createGeometryExample(c);
    const lessons = s.list('lesson', course.id);
    const data = portableCourse.parse({
      schemaVersion: '1.0',
      course,
      concepts: s.list('concept', course.id),
      nodes: s.list('node', course.id),
      edges: s.list('edge', course.id),
      lessonIndex: lessons.map((l) => ({ nodeId: l.nodeId, version: l.version })),
      exercises: s.list('exercise', course.id),
    });
    expect(() => validateExerciseBank(data, lessons)).not.toThrow();
    const foreign = structuredClone(data);
    foreign.exercises![0].nodeId = 'nonexistent';
    expect(() => validateExerciseBank(foreign, lessons)).toThrow();
    const split = structuredClone(data);
    split.exercises!.push({ ...split.exercises![0], id: uuid(), familyId: uuid() });
    expect(() => validateExerciseBank(split, lessons)).toThrow();
    const changed = structuredClone(data);
    const e = changed.exercises![0];
    if (e.kind === 'numeric') e.grading.expected += 1;
    expect(() => validateExerciseBank(changed, lessons)).toThrow();
  });
  it.each(['fresh', 'restore_copy'] as const)(
    '补题及作废状态在 %s 导入中保留，家族身份稳定',
    async (mode) => {
      const root = mkdtempSync(join(tmpdir(), 'tutor-bank-'));
      roots.push(root);
      const s = new Store(root);
      stores.push(s);
      const c = new Courses(s),
        t = new Transfer(s, c),
        course = createGeometryExample(c);
      const n = s.list('node', course.id)[0];
      const originals = s.list('exercise', course.id, n.id);
      const supplemental = {
        ...originals[0],
        id: uuid(),
        key: 'supplemental',
        familyKey: 'supplemental-family',
        familyId: uuid(),
        prompt: '补充题：求直角三角形的高。',
      };
      s.put('exercise', supplemental, n.id);
      // Force selection of the supplemental question without changing historical documents.
      for (const e of originals)
        s.put('exercise', { ...e, status: 'invalid', invalidReason: '题目审核' }, n.id);
      const p = s.transaction(() => c.start(n.id, 'start'));
      const a = s.transaction(() => c.assign(n.id, p.cycleId, n.objectives[0].id));
      s.transaction(() => c.attempt(a.assignmentId, 'answer', { value: '12', unit: '' }));
      const exported = await t.export(course.id, 'backup', 'learn');
      const preview = await t.validate(join(root, 'exports', exported.exportId + '.learn'));
      const imported = s.transaction(() => t.commit(preview.importId, mode));
      const bank = s.list('exercise', imported.courseId);
      const restored = bank.find((e) => e.key === 'supplemental');
      expect(restored).toBeDefined();
      expect(restored.id).not.toBe(supplemental.id);
      expect(restored.familyId).not.toBe(supplemental.familyId);
      expect(c.familyId(restored.nodeId, restored.familyKey)).toBe(restored.familyId);
      expect(bank.filter((e) => e.status === 'invalid')).toHaveLength(originals.length);
      expect(s.list('attempt', imported.courseId)).toHaveLength(mode === 'fresh' ? 0 : 1);
      if (mode === 'restore_copy') {
        const assignment = s.list('assignment', imported.courseId)[0];
        expect(assignment.exerciseId).toBe(restored.id);
        expect(assignment.familyId).toBe(restored.familyId);
      }
    },
  );
  it('fresh 导入新课程，ID 重映射、答案及演示可用', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tutor-transfer-'));
    roots.push(root);
    const s = new Store(root);
    stores.push(s);
    const c = new Courses(s),
      t = new Transfer(s, c),
      course = createGeometryExample(c);
    const exported = await t.export(course.id, 'content', 'learn');
    const preview = await t.validate(join(root, 'exports', exported.exportId + '.learn'));
    const imported = s.command('import', 'i', {}, () => t.commit(preview.importId, 'fresh'));
    expect(imported.courseId).not.toBe(course.id);
    const nodes = s.list('node', imported.courseId);
    expect(nodes).toHaveLength(3);
    expect(
      c.lesson(nodes[0].id).blocks.some((b: any) => b.templateId === 'math.right_triangle'),
    ).toBe(true);
    expect(s.list('progress', imported.courseId).map((p) => p.status)).toEqual([
      'available',
      'locked',
      'locked',
    ]);
  });
  it.each(['../x', 'C:/x', '//host/a', 'a\\b', 'a:stream', 'a/../b', 'CON.json', 'a.', 'a//b'])(
    '拒绝路径 %s',
    (p) => expect(() => safeEntry(p)).toThrow(),
  );
  it('backup 恢复作答、当前学习轮、笔记且不采纳供应商会话', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tutor-backup-'));
    roots.push(root);
    const s = new Store(root);
    stores.push(s);
    const c = new Courses(s),
      t = new Transfer(s, c),
      course = createGeometryExample(c),
      n = s.list('node', course.id)[0];
    const progress = s.transaction(() => c.start(n.id, 'start')),
      a = s.transaction(() => c.assign(n.id, progress.cycleId, n.objectives[0].id));
    s.transaction(() => c.attempt(a.assignmentId, 'answer', { value: '12', unit: '' }));
    s.put('note', {
      id: n.id,
      courseId: course.id,
      text: '我的笔记',
      version: 1,
      updatedAt: new Date().toISOString(),
    });
    s.put('session', {
      id: 'session',
      courseId: course.id,
      status: 'active',
      providerConversationId: 'must-not-export',
      providerBindingValid: true,
      createdAt: new Date().toISOString(),
    });
    const exported = await t.export(course.id, 'backup', 'learn'),
      preview = await t.validate(join(root, 'exports', exported.exportId + '.learn'));
    const imported = s.command('restore', 'one', {}, () =>
      t.commit(preview.importId, 'restore_copy'),
    );
    expect(s.list('attempt', imported.courseId)).toHaveLength(1);
    expect(s.list('note', imported.courseId)[0].text).toBe('我的笔记');
    expect(s.list('session', imported.courseId)[0].providerConversationId).toBeUndefined();
    expect(s.list('session', imported.courseId)[0].providerBindingValid).toBe(false);
    const p = s.list('progress', imported.courseId).find((p) => p.cycleId);
    expect(Object.values(p.objectiveEvidence)[0]).toMatchObject({
      n: 1,
      score: 1,
      mastered: false,
    });
  });
});
