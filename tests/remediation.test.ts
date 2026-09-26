import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage/database.js';
import { Courses } from '../src/domain/courses.js';
import { Remediation } from '../src/domain/remediation.js';
import { createGeometryExample } from '../src/domain/examples.js';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tutor-patch-')),
    s = new Store(root),
    c = new Courses(s),
    course = createGeometryExample(c),
    n = s.list('node', course.id)[0];
  cleanup.push(() => {
    s.close();
    rmSync(root, { force: true, recursive: true });
  });
  const progress = s.transaction(() => c.start(n.id, 'start')),
    cycle = s.must('cycle', progress.cycleId);
  for (let i = 0; i < 2; i++)
    s.put('attempt', {
      id: 'a' + i,
      courseId: course.id,
      nodeId: n.id,
      objectiveId: n.objectives[0].id,
      cycleId: cycle.id,
      familyId: 'f' + i,
      firstInFamily: true,
      correct: false,
      evidenceScore: 0,
      assignmentId: 'assignment' + i,
    });
  return { s, c, course, n, cycle, r: new Remediation(s, c) };
}
function diagnosis(f: ReturnType<typeof setup>, key: string, confidence = 0.9) {
  const { s, n, cycle } = f;
  const d = {
    id: 'diagnosis-' + key,
    courseId: n.courseId,
    nodeId: n.id,
    cycleId: cycle.id,
    status: 'usable',
    objectiveId: n.objectives[0].id,
    attemptIds: ['a0', 'a1'],
    errorType: 'prerequisite_gap',
    confidence,
    nextAction: 'propose_patch',
    patchProposal: {
      targetNodeId: n.id,
      objectiveId: n.objectives[0].id,
      cycleId: cycle.id,
      remediationEpochId: cycle.remediationEpochId,
      baseRevision: s.must('course', n.courseId).revision,
      reason: '重复错误提示先修概念缺口',
      evidenceAttemptIds: ['a0', 'a1'],
      prerequisiteConceptRefs: [{ newConceptKey: key, label: key }],
      newNodes: [
        {
          key: 'new',
          conceptKey: key,
          title: '补课 ' + key,
          objectives: [{ key: 'o', description: '验证先修' }],
          estimatedMinutes: 5,
        },
      ],
      reuseNodeIds: [],
      addedEdges: [{ fromRef: 'new', toRef: n.id }],
    },
  };
  s.put('diagnosis', d);
  return d;
}
describe('A07/A08 补课证据与预算', () => {
  it('单错和低置信度拒绝，撤销不返还预算', () => {
    const f = setup(),
      { s, r } = f;
    const low = diagnosis(f, 'low', 0.7);
    expect(() => s.transaction(() => r.apply(low.id))).toThrow();
    const p1 = s.transaction(() => r.apply(diagnosis(f, 'first').id));
    s.transaction(() => r.revert(p1.id, s.must('course', f.course.id).revision));
    const p2 = s.transaction(() => r.apply(diagnosis(f, 'second').id));
    expect(p2.status).toBe('applied');
    expect(() => s.transaction(() => r.apply(diagnosis(f, 'third').id))).toThrow(/两个补丁/);
    expect(s.list('patch', f.course.id)).toHaveLength(2);
    expect(s.list('attempt', f.course.id)).toHaveLength(2);
  });
  it('补课完成打开新验证轮但保留 epoch，主节点不会直接达标', () => {
    const f = setup(),
      { s, c, r, n, cycle } = f,
      p = s.transaction(() => r.apply(diagnosis(f, 'pre').id));
    const remedial = p.createdNodeIds[0];
    s.transaction(() => {
      const progress = s.must('progress', remedial);
      s.put('progress', { ...progress, status: 'mastered', masteredOnce: true });
      c.advanceRemediation(n.courseId, remedial);
    });
    const progress = s.must('progress', n.id);
    expect(progress.status).toBe('learning');
    expect(progress.cycleId).not.toBe(cycle.id);
    expect(s.must('cycle', progress.cycleId).remediationEpochId).toBe(cycle.remediationEpochId);
    expect(s.list('patch', n.courseId)).toHaveLength(1);
  });
  it('过期 revision 不修改课程图，补课节点不能递归补课', () => {
    const f = setup(),
      d = diagnosis(f, 'pre');
    f.s.put('course', { ...f.s.must('course', f.course.id), revision: 9 });
    expect(() => f.s.transaction(() => f.r.apply(d.id))).toThrow(/版本/);
    expect(f.s.list('patch', f.course.id)).toHaveLength(0);
    expect(f.s.list('node', f.course.id)).toHaveLength(3);
  });
});
