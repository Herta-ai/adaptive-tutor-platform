import { Store, uuid, now } from '../storage/database.js';
import { diagnosisDraft, patchProposal } from '../contracts/v1.js';
import { Courses } from './courses.js';
import { requireThat } from './errors.js';
import { assertDag } from './assessment.js';

export class Remediation {
  constructor(
    readonly store: Store,
    readonly courses: Courses,
  ) {}
  diagnose(
    input: unknown,
    context: {
      courseId: string;
      nodeId: string;
      cycleId: string;
      requestId: string;
      attemptIds: string[];
    },
  ) {
    const d = diagnosisDraft.parse(input),
      node = this.store.must('node', context.nodeId),
      progress = this.store.must('progress', node.id);
    requireThat(
      node.courseId === context.courseId &&
        node.objectives.some((o: any) => o.id === d.objectiveId),
      'DIAGNOSIS_INVALID',
      '诊断目标不属于任务',
    );
    requireThat(
      d.attemptIds.every((id) => context.attemptIds.includes(id)),
      'DIAGNOSIS_INVALID',
      '诊断引用了未提供的证据',
    );
    for (const id of d.attemptIds) {
      const a = this.store.must('attempt', id);
      requireThat(
        a.nodeId === node.id && a.objectiveId === d.objectiveId && a.cycleId === context.cycleId,
        'DIAGNOSIS_INVALID',
        '诊断证据归属不匹配',
      );
    }
    const record = {
      id: uuid(),
      ...context,
      ...d,
      status:
        progress.cycleId === context.cycleId && progress.status === 'learning' ? 'usable' : 'stale',
    };
    this.store.put('diagnosis', record);
    for (const id of d.attemptIds) {
      const a = this.store.must('attempt', id);
      this.store.put(
        'attempt',
        { ...a, diagnosisState: 'completed', diagnosisRequestId: context.requestId },
        a.assignmentId,
      );
    }
    return record;
  }
  apply(diagnosisId: string) {
    const d = this.store.must('diagnosis', diagnosisId),
      proposal = patchProposal.parse(d.patchProposal),
      node = this.store.must('node', proposal.targetNodeId),
      progress = this.store.must('progress', node.id),
      cycle = this.store.must('cycle', progress.cycleId);
    requireThat(node.kind === 'main', 'PATCH_DEPTH', '补课节点不能继续递归补课');
    requireThat(
      d.status === 'usable' &&
        d.errorType === 'prerequisite_gap' &&
        d.confidence >= 0.8 &&
        d.nextAction === 'propose_patch',
      'PATCH_EVIDENCE',
      '诊断未满足补课门槛',
    );
    requireThat(
      d.nodeId === node.id &&
        d.objectiveId === proposal.objectiveId &&
        d.cycleId === proposal.cycleId &&
        cycle.id === proposal.cycleId &&
        cycle.remediationEpochId === proposal.remediationEpochId &&
        cycle.status === 'open' &&
        progress.status === 'learning',
      'STALE_DIAGNOSIS',
      '诊断已过期',
      409,
    );
    const course = this.courses.revision(node.courseId, proposal.baseRevision);
    const window = this.store
      .list('attempt', node.courseId)
      .filter(
        (a) =>
          a.cycleId === cycle.id &&
          a.objectiveId === proposal.objectiveId &&
          a.firstInFamily &&
          !a.voidedAt,
      )
      .slice(-3);
    const wrong = window.filter((a) => !a.correct);
    requireThat(
      wrong.length >= 2 &&
        new Set(proposal.evidenceAttemptIds).size >= 2 &&
        proposal.evidenceAttemptIds.every(
          (id) => wrong.some((a) => a.id === id) && d.attemptIds.includes(id),
        ),
      'PATCH_EVIDENCE',
      '最近三个家族首答中不足两个有效错误',
    );
    const history = this.store
      .list('patch', node.courseId)
      .filter(
        (p) => p.targetNodeId === node.id && p.remediationEpochId === cycle.remediationEpochId,
      );
    const concepts = proposal.prerequisiteConceptRefs.map((ref) => {
      if (typeof ref === 'string') {
        const c = this.store.must('concept', ref);
        requireThat(c.courseId === node.courseId, 'SCOPE_DENIED', '先修概念不属于课程', 403);
        return c;
      }
      const key = ref.newConceptKey.normalize('NFKC').trim().toLocaleLowerCase('en');
      requireThat(key.length > 0, 'CONCEPT_INVALID', '概念 key 为空');
      const existing = this.store
        .list('concept', node.courseId)
        .find(
          (c) =>
            c.key === key ||
            c.label.normalize('NFKC').trim() === ref.label.normalize('NFKC').trim(),
        );
      if (existing) return existing;
      return this.store.put('concept', {
        id: uuid(),
        courseId: node.courseId,
        key,
        label: ref.label,
      });
    });
    const duplicate = history.find((p) => concepts.some((c) => p.conceptIds.includes(c.id)));
    if (duplicate) return duplicate;
    requireThat(history.length < 2, 'PATCH_LIMIT', '本阶段最多提交两个补丁，撤销不返还次数');
    const existingNodes = this.store.list('node', node.courseId);
    requireThat(
      existingNodes.length + proposal.newNodes.length <= 500,
      'COURSE_LIMIT',
      '课程节点超过上限',
    );
    const local = new Map<string, string>();
    const created = proposal.newNodes.map((n) => {
      requireThat(
        !local.has(n.key) && !existingNodes.some((e) => e.id === n.key),
        'PATCH_INVALID',
        '补课局部 key 重复',
      );
      const concept = concepts.find(
        (c) => c.key === n.conceptKey.normalize('NFKC').trim().toLocaleLowerCase('en'),
      );
      requireThat(concept, 'PATCH_INVALID', '新节点必须绑定缺失概念');
      const id = uuid();
      local.set(n.key, id);
      return {
        id,
        courseId: node.courseId,
        conceptId: concept.id,
        title: n.title,
        kind: 'remedial',
        objectives: n.objectives.map((o) => ({ id: uuid(), description: o.description })),
        estimatedMinutes: n.estimatedMinutes,
        contentStatus: 'not_generated',
        currentLessonVersion: 0,
      };
    });
    for (const id of proposal.reuseNodeIds) {
      const n = this.store.must('node', id);
      requireThat(
        n.courseId === node.courseId && concepts.some((c) => c.id === n.conceptId),
        'PATCH_INVALID',
        '复用节点不符合先修概念',
      );
    }
    const allowedFrom = new Set([...created.map((n) => n.id), ...proposal.reuseNodeIds]);
    const added = proposal.addedEdges.map((e) => ({
      from: local.get(e.fromRef) ?? e.fromRef,
      to: local.get(e.toRef) ?? e.toRef,
    }));
    requireThat(
      added.some((e) => allowedFrom.has(e.from) && e.to === node.id) &&
        added.every((e) => allowedFrom.has(e.from) && (e.to === node.id || allowedFrom.has(e.to))),
      'PATCH_INVALID',
      '补课边超出目标范围',
    );
    const activeEdges = this.store
      .list('edge', node.courseId)
      .filter((e) => e.active)
      .map((e) => ({ from: e.fromNodeId, to: e.toNodeId }));
    assertDag(
      [...existingNodes.map((n) => n.id), ...created.map((n) => n.id)],
      [...activeEdges, ...added],
    );
    const patch = {
      id: uuid(),
      courseId: node.courseId,
      targetNodeId: node.id,
      cycleId: cycle.id,
      remediationEpochId: cycle.remediationEpochId,
      baseRevision: proposal.baseRevision,
      diagnosisId,
      conceptIds: concepts.map((c) => c.id),
      createdNodeIds: created.map((n) => n.id),
      proposal,
      status: 'applied',
      createdAt: now(),
    };
    this.store.put('patch', patch);
    for (const n of created) {
      this.store.put('node', n);
      this.store.put('progress', {
        id: n.id,
        courseId: n.courseId,
        status: 'available',
        masteredOnce: false,
        reviewStage: 0,
        bypass: false,
        cycleId: null,
      });
    }
    for (const e of added)
      this.store.put('edge', {
        id: uuid(),
        courseId: node.courseId,
        fromNodeId: e.from,
        toNodeId: e.to,
        kind: 'remediation',
        patchId: patch.id,
        active: true,
      });
    this.store.put('progress', { ...progress, reviewStage: 0 });
    this.store.put('course', { ...course, revision: course.revision + 1 });
    this.store.emit(
      'course.updated',
      {
        revision: course.revision + 1,
        changedNodeIds: [node.id, ...created.map((n) => n.id)],
        patchId: patch.id,
      },
      node.courseId,
    );
    return patch;
  }
  revert(patchId: string, expectedRevision: number) {
    const p = this.store.must('patch', patchId);
    const c = this.courses.revision(p.courseId, expectedRevision);
    if (p.status === 'reverted') return p;
    for (const e of this.store.list('edge', p.courseId).filter((e) => e.patchId === patchId))
      this.store.put('edge', { ...e, active: false });
    for (const id of p.createdNodeIds) {
      const referenced = this.store
        .list('edge', p.courseId)
        .some((e) => e.active && (e.fromNodeId === id || e.toNodeId === id));
      if (!referenced) {
        const node = this.store.must('node', id);
        this.store.put('node', { ...node, archived: true });
      }
    }
    this.store.put('patch', { ...p, status: 'reverted', revertedAt: now() });
    this.store.put('course', { ...c, revision: c.revision + 1 });
    this.courses.recompute(p.targetNodeId);
    this.store.emit(
      'course.updated',
      { revision: c.revision + 1, patchId, changedNodeIds: [p.targetNodeId] },
      p.courseId,
    );
    return this.store.must('patch', patchId);
  }
}
