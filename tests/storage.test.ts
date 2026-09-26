import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/database.js';
import { Courses } from '../src/domain/courses.js';
const roots: string[] = [];
const stores: Store[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tutor-test-'));
  roots.push(root);
  const s = new Store(root);
  stores.push(s);
  return { s, c: new Courses(s) };
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
describe('A15/A29 SQLite 事务', () => {
  it('同键同文返回原结果，异文冲突；异常回滚事件', () => {
    const { s } = setup();
    const f = () => ({ id: 'a' });
    expect(s.command('x', 'key', { a: 1 }, f)).toEqual(
      s.command('x', 'key', { a: 1 }, () => {
        throw Error('不得重做');
      }),
    );
    expect(() => s.command('x', 'key', { a: 2 }, f)).toThrow();
    expect(() =>
      s.transaction(() => {
        s.put('course', { id: 'bad' });
        s.emit('x', {}, 'bad');
        throw Error('rollback');
      }),
    ).toThrow();
    expect(s.get('course', 'bad')).toBeUndefined();
    expect(s.cursor()).toBe('0');
  });
  it('确认大纲、隐藏答案、首答、关闭轮、复习新家族', () => {
    const { s, c } = setup();
    const course = c.create({
      clientRequestId: 'create',
      topic: '测试',
      goal: '目标',
      profile: { background: '', weeklyMinutes: 30, language: '中文' },
    });
    s.transaction(() =>
      c.publishPlan(course.id, 1, {
        schemaVersion: '1.0',
        title: '测试课',
        summary: '简介',
        concepts: [{ key: 'concept', label: '概念' }],
        nodes: [
          {
            key: 'node',
            conceptKey: 'concept',
            title: '节点',
            objectives: [{ key: 'o', description: '计算' }],
            estimatedMinutes: 5,
          },
        ],
        edges: [],
        sources: [],
      }),
    );
    const n = s.list('node', course.id)[0];
    s.transaction(() =>
      c.publishLesson(n.id, {
        schemaVersion: '1.0',
        title: '学习',
        blocks: ['goal', 'explanation', 'worked_example', 'recap'].map((role) => ({
          blockId: role,
          type: 'markdown',
          role,
          text: '内容',
        })),
        exercises: Array.from({ length: 3 }, (_, i) => ({
          key: 'e' + i,
          objectiveId: n.objectives[0].id,
          familyKey: 'f' + i,
          kind: 'numeric',
          prompt: ['加法：零加一', '减法：二减一', '乘法：一乘一'][i],
          explanation: '答案是1',
          grading: { expected: 1, unit: '', allowedUnits: [''], absTolerance: 0, relTolerance: 0 },
        })),
        sources: [],
        assetRefs: [],
      }),
    );
    expect(JSON.stringify(c.lesson(n.id))).not.toContain('grading');
    const p = s.transaction(() => c.start(n.id, 'start'));
    const a = s.transaction(() => c.assign(n.id, p.cycleId, n.objectives[0].id));
    const first = s.command('answer', 'first', { value: '1' }, () =>
      c.attempt(a.assignmentId, 'first', { value: '1', unit: '' }),
    );
    expect(first.progress.status).toBe('learning');
    const a2 = s.transaction(() => c.assign(n.id, p.cycleId, n.objectives[0].id));
    const second = s.transaction(() =>
      c.attempt(a2.assignmentId, 'second', { value: '1', unit: '' }),
    );
    expect(second.progress.status).toBe('mastered');
    expect(() =>
      s.transaction(() => c.attempt(a2.assignmentId, 'third', { value: '1', unit: '' })),
    ).toThrow();
    const review = s.transaction(() => c.start(n.id, 'review'));
    expect(review.cycleId).not.toBe(p.cycleId);
    const a3 = s.transaction(() => c.assign(n.id, review.cycleId, n.objectives[0].id));
    expect(a3.familyId).not.toBe(a.familyId);
  });
  it('两个写实例互斥', () => {
    const root = mkdtempSync(join(tmpdir(), 'tutor-lock-'));
    roots.push(root);
    const s = new Store(root, true);
    stores.push(s);
    expect(() => new Store(root, true)).toThrow();
  });
  it('过期事件保留恢复下限，不清除活动任务和幂等记录', () => {
    const { s } = setup();
    s.put('course', { id: 'c' });
    s.put('job', { id: 'active', state: 'running', courseId: 'c' });
    s.emit('job.started', {}, 'c', undefined, 'active');
    s.emit('course.updated', {}, 'c', undefined, 'ended');
    s.command('op', 'id', {}, () => ({ ok: true }));
    s.maintainEvents(Date.now() + 8 * 86400000);
    expect(s.events('c', undefined, 0)).toHaveLength(1);
    expect(s.eventFloor('c')).toBe(2);
    expect(
      s.command('op', 'id', {}, () => {
        throw Error('重复执行');
      }),
    ).toEqual({ ok: true });
  });
});
