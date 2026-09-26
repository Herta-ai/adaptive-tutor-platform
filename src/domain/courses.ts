import { Store, uuid, now } from '../storage/database.js';
import { createCourse, type Exercise } from '../contracts/v1.js';
import { validateCurriculum, validateLesson } from './content.js';
import { requireThat } from './errors.js';
import { evidenceWindow, grade, nextReview } from './assessment.js';
import { capability } from '../capabilities/registry.js';

export class Courses {
  constructor(readonly store: Store) {}
  familyId(nodeId: string, familyKey: string) {
    const node = this.store.must('node', nodeId);
    return (
      this.store.list('exercise', node.courseId, nodeId).find((e) => e.familyKey === familyKey)
        ?.familyId ?? uuid()
    );
  }
  create(input: unknown) {
    const p = createCourse.parse(input);
    return this.store.command('course.create', p.clientRequestId, p, () =>
      this.store.put('course', {
        id: uuid(),
        title: p.topic,
        topic: p.topic,
        goal: p.goal,
        profile: p.profile,
        status: 'draft',
        revision: 1,
        createdAt: now(),
      }),
    );
  }
  revision(courseId: string, expected: number) {
    const c = this.store.must('course', courseId);
    requireThat(c.revision === expected, 'VERSION_CONFLICT', '课程版本已变化', 409);
    return c;
  }
  publishPlan(courseId: string, expected: number, input: unknown) {
    const p = validateCurriculum(input),
      c = this.revision(courseId, expected);
    requireThat(
      this.store.list('node', courseId).length === 0,
      'VERSION_CONFLICT',
      '已有大纲不能用初始规划覆盖',
      409,
    );
    const conceptMap = new Map(p.concepts.map((v) => [v.key, uuid()]));
    for (const x of p.concepts)
      this.store.put('concept', {
        id: conceptMap.get(x.key)!,
        courseId,
        key: x.key,
        label: x.label,
      });
    const nodeMap = new Map(p.nodes.map((v) => [v.key, uuid()]));
    for (const n of p.nodes) {
      const nodeId = nodeMap.get(n.key)!;
      this.store.put('node', {
        id: nodeId,
        courseId,
        conceptId: conceptMap.get(n.conceptKey),
        title: n.title,
        kind: 'main',
        objectives: n.objectives.map((o) => ({ id: uuid(), description: o.description })),
        estimatedMinutes: n.estimatedMinutes,
        contentStatus: 'not_generated',
        currentLessonVersion: 0,
      });
      this.store.put('progress', {
        id: nodeId,
        courseId,
        status: p.edges.some((e) => e.toKey === n.key) ? 'locked' : 'available',
        masteredOnce: false,
        reviewStage: 0,
        bypass: false,
        cycleId: null,
      });
    }
    for (const e of p.edges)
      this.store.put('edge', {
        id: uuid(),
        courseId,
        fromNodeId: nodeMap.get(e.fromKey),
        toNodeId: nodeMap.get(e.toKey),
        kind: 'prerequisite',
        active: true,
      });
    this.store.put('course', { ...c, title: p.title, status: 'active', revision: c.revision + 1 });
    this.store.emit(
      'course.updated',
      { revision: c.revision + 1, changedNodeIds: [...nodeMap.values()] },
      courseId,
    );
    return this.store.must('course', courseId);
  }
  publishLesson(
    nodeId: string,
    input: unknown,
    provenance: { runtime: string; cliVersion?: string } = { runtime: 'antigravity' },
  ) {
    const n = this.store.must('node', nodeId),
      p = validateLesson(input, n.objectives);
    requireThat(p.assetRefs.length === 0, 'RESOURCE_MISSING', '资源导入尚未验证，不能发布资源引用');
    const version = n.currentLessonVersion + 1;
    const families = new Map<string, string>();
    const exercises = p.exercises.map((e) => {
      if (!families.has(e.familyKey)) families.set(e.familyKey, this.familyId(nodeId, e.familyKey));
      return {
        ...e,
        id: uuid(),
        version: 1,
        lessonVersion: version,
        nodeId,
        courseId: n.courseId,
        familyId: families.get(e.familyKey)!,
        status: 'active',
      };
    });
    for (const e of exercises) this.store.put('exercise', e, nodeId);
    const document = {
      ...p,
      courseId: n.courseId,
      nodeId,
      lessonVersion: version,
      objectives: n.objectives,
      exercises,
      requiredCapabilities: p.blocks
        .filter((b) => 'templateId' in b)
        .map((b) => ({ capabilityId: b.templateId, version: b.templateVersion })),
      provenance: { ...provenance, schemaVersion: '1.0', createdAt: now() },
    };
    this.store.put(
      'lesson',
      {
        id: nodeId + ':' + version,
        courseId: n.courseId,
        nodeId,
        version,
        document,
        status: 'published',
      },
      nodeId,
    );
    this.store.put('node', { ...n, currentLessonVersion: version, contentStatus: 'ready' });
    const progress = this.store.get('progress', nodeId);
    if (n.currentLessonVersion > 0 && progress?.cycleId) {
      const old = this.store.must('cycle', progress.cycleId);
      this.store.put('cycle', { ...old, status: 'superseded', completedAt: now() }, nodeId);
      const cycle = {
        id: uuid(),
        courseId: n.courseId,
        nodeId,
        remediationEpochId: old.remediationEpochId,
        kind: 'verification',
        status: 'open',
        startedAt: now(),
      };
      this.store.put('cycle', cycle, nodeId);
      this.store.put('progress', {
        ...progress,
        status: 'learning',
        cycleId: cycle.id,
        objectiveEvidence: {},
      });
    }
    return document;
  }
  lesson(nodeId: string, version?: number) {
    const n = this.store.must('node', nodeId);
    if (!n.currentLessonVersion) return { contentStatus: n.contentStatus };
    const l = this.store.must('lesson', nodeId + ':' + (version ?? n.currentLessonVersion));
    return {
      ...l.document,
      exercises: l.document.exercises.map((e: any) => {
        const { grading, explanation, ...publicExercise } = e;
        return publicExercise;
      }),
    };
  }
  snapshot(courseId: string, sessionId?: string) {
    return this.store.transaction(() => {
      const course = this.store.must('course', courseId);
      if (sessionId)
        requireThat(
          this.store.must('session', sessionId).courseId === courseId,
          'SCOPE_DENIED',
          '会话不属于课程',
          403,
        );
      return {
        course,
        nodes: this.store.list('node', courseId),
        edges: this.store.list('edge', courseId),
        progress: this.store
          .list('progress', courseId)
          .map((p) =>
            p.status === 'mastered' && p.nextReviewAt && p.nextReviewAt <= now()
              ? { ...p, status: 'review_due' }
              : p,
          ),
        notes: this.store.list('note', courseId),
        diagnoses: this.store.list('diagnosis', courseId),
        patches: this.store.list('patch', courseId),
        messages: sessionId ? this.store.list('message', courseId, sessionId) : [],
        jobs: this.store
          .list('job', courseId)
          .filter((j) => !j.sessionId || j.sessionId === sessionId),
        drafts: this.store
          .list('draft', courseId)
          .filter((d) => d.status === 'pending')
          .map(({ payload, ...d }) => ({ ...d, payload })),
        eventCursor: this.store.cursor(),
      };
    });
  }
  start(nodeId: string, action: string) {
    const n = this.store.must('node', nodeId),
      p = this.store.must('progress', nodeId);
    if (action === 'bypass' || action === 'revoke_bypass') {
      this.store.put('progress', { ...p, bypass: action === 'bypass' });
      this.unlock(n.courseId);
      return this.store.must('progress', nodeId);
    }
    const prereqs = this.store
      .list('edge', n.courseId)
      .filter((e) => e.active && e.kind === 'prerequisite' && e.toNodeId === nodeId);
    requireThat(
      p.bypass || prereqs.every((e) => this.store.must('progress', e.fromNodeId).masteredOnce),
      'NODE_LOCKED',
      '请先完成先修节点或显式绕过',
      409,
    );
    if (p.cycleId && this.store.must('cycle', p.cycleId).status === 'open') return p;
    const cycle = {
      id: uuid(),
      courseId: n.courseId,
      nodeId,
      remediationEpochId: uuid(),
      kind: p.masteredOnce ? 'review' : 'initial',
      status: 'open',
      startedAt: now(),
    };
    this.store.put('cycle', cycle, nodeId);
    this.store.put('progress', { ...p, cycleId: cycle.id, status: 'learning' });
    return this.store.must('progress', nodeId);
  }
  unlock(courseId: string) {
    for (const p of this.store.list('progress', courseId)) {
      if (!['available', 'locked'].includes(p.status)) continue;
      const incoming = this.store
        .list('edge', courseId)
        .filter((e) => e.active && e.kind === 'prerequisite' && e.toNodeId === p.id);
      this.store.put('progress', {
        ...p,
        status:
          p.bypass || incoming.every((e) => this.store.must('progress', e.fromNodeId).masteredOnce)
            ? 'available'
            : 'locked',
      });
    }
  }
  assign(nodeId: string, cycleId: string, objectiveId: string) {
    const n = this.store.must('node', nodeId),
      p = this.store.must('progress', nodeId);
    requireThat(
      p.cycleId === cycleId && this.store.must('cycle', cycleId).status === 'open',
      'CYCLE_STALE',
      '学习轮已变化',
      409,
    );
    requireThat(
      n.objectives.some((o: any) => o.id === objectiveId),
      'SCOPE_DENIED',
      '目标不属于节点',
      403,
    );
    const assignments = this.store
      .list('assignment', n.courseId)
      .filter((a) => a.nodeId === nodeId);
    const existing = assignments.find(
      (a) =>
        a.cycleId === cycleId &&
        a.objectiveId === objectiveId &&
        !this.store.list('attempt', n.courseId, a.id).length,
    );
    if (existing) return this.publicAssignment(existing);
    const seen = new Set(assignments.map((a) => a.familyId));
    const lesson = this.store.must('lesson', nodeId + ':' + n.currentLessonVersion);
    const e = this.store
      .list('exercise', n.courseId, nodeId)
      .find(
        (e: any) =>
          e.objectiveId === objectiveId &&
          (e.lessonVersion ?? n.currentLessonVersion) === n.currentLessonVersion &&
          e.status === 'active' &&
          !seen.has(e.familyId),
      );
    requireThat(e, 'EXERCISES_REQUIRED', '需要联网生成新的题目家族', 409);
    const a = {
      id: uuid(),
      courseId: n.courseId,
      nodeId,
      objectiveId,
      cycleId,
      exerciseId: e.id,
      exerciseVersion: e.version,
      familyId: e.familyId,
      eligibleForEvidence: true,
      issuedAt: now(),
      hintRevealedAt: null,
      solutionRevealedAt: null,
    };
    this.store.put('assignment', a, nodeId);
    return this.publicAssignment(a);
  }
  publicAssignment(a: any) {
    const e = this.store.must('exercise', a.exerciseId);
    const { grading, explanation, ...pub } = e;
    return {
      ...pub,
      assignmentId: a.id,
      cycleId: a.cycleId,
      ...(e.kind === 'numeric' ? { allowedUnits: grading.allowedUnits } : {}),
    };
  }
  reveal(assignmentId: string, kind: string) {
    const a = this.store.must('assignment', assignmentId);
    this.store.put(
      'assignment',
      { ...a, [kind === 'hint' ? 'hintRevealedAt' : 'solutionRevealedAt']: now() },
      a.nodeId,
    );
    return { text: this.store.must('exercise', a.exerciseId).explanation };
  }
  attempt(assignmentId: string, clientRequestId: string, answer: unknown) {
    const a = this.store.must('assignment', assignmentId),
      e = this.store.must('exercise', a.exerciseId),
      p = this.store.must('progress', a.nodeId),
      cycle = this.store.must('cycle', a.cycleId);
    requireThat(
      e.status === 'active' && p.cycleId === a.cycleId && cycle.status === 'open',
      'CYCLE_STALE',
      '题目或学习轮已失效',
      409,
    );
    let ranges;
    if (e.kind === 'parameter') {
      const n = this.store.must('node', a.nodeId),
        lesson = this.store.must('lesson', n.id + ':' + n.currentLessonVersion);
      const b = lesson.document.blocks.find((b: any) => b.blockId === e.grading.blockId);
      ranges = capability(b.templateId).parameters;
    }
    const correct = grade(e as Exercise, answer, ranges);
    const first = !this.store
      .list('attempt', a.courseId)
      .some((t) => t.cycleId === a.cycleId && t.familyId === a.familyId);
    const attempt = {
      id: uuid(),
      courseId: a.courseId,
      assignmentId,
      clientRequestId,
      cycleId: a.cycleId,
      nodeId: a.nodeId,
      objectiveId: a.objectiveId,
      familyId: a.familyId,
      answer,
      correct,
      firstInFamily: first,
      evidenceScore:
        first && a.eligibleForEvidence
          ? correct && !a.hintRevealedAt && !a.solutionRevealedAt
            ? 1
            : 0
          : null,
      createdAt: now(),
      voidedAt: null,
      diagnosisState: !correct && first ? 'pending' : 'not_required',
    };
    this.store.put('attempt', attempt, assignmentId);
    // Receiving feedback exposes this assignment for all subsequent submissions.
    this.store.put(
      'assignment',
      { ...a, solutionRevealedAt: a.solutionRevealedAt ?? now() },
      a.nodeId,
    );
    const progress = this.recompute(a.nodeId);
    return {
      attemptId: attempt.id,
      correct,
      explanation: e.explanation,
      progress,
      diagnosisState: attempt.diagnosisState,
    };
  }
  recompute(nodeId: string) {
    const n = this.store.must('node', nodeId),
      p = this.store.must('progress', nodeId);
    if (!p.cycleId) return p;
    const cycle = this.store.must('cycle', p.cycleId);
    const attempts = this.store.list('attempt', n.courseId).filter((t) => t.cycleId === p.cycleId);
    const objectiveEvidence = Object.fromEntries(
      n.objectives.map((o: any) => [o.id, evidenceWindow(attempts, o.id)]),
    );
    const gates = this.store
      .list('edge', n.courseId)
      .filter((e) => e.active && e.kind === 'remediation' && e.toNodeId === nodeId);
    const mastered =
      Object.values(objectiveEvidence).every((e: any) => e.mastered) &&
      gates.every((e) => this.store.must('progress', e.fromNodeId).masteredOnce);
    let next = { ...p, objectiveEvidence };
    if (mastered && cycle.status === 'open') {
      const time = now();
      this.store.put('cycle', { ...cycle, status: 'closed', completedAt: time }, nodeId);
      next = {
        ...next,
        status: 'mastered',
        masteredOnce: true,
        masteredAt: time,
        nextReviewAt: nextReview(time, p.reviewStage),
        reviewStage: Math.min(p.reviewStage + 1, 3),
      };
    } else if (!mastered && cycle.status === 'closed')
      next = { ...next, status: 'review_due', masteredOnce: false };
    this.store.put('progress', next);
    this.unlock(n.courseId);
    this.store.emit('progress.updated', { nodeId, cycleId: p.cycleId, progress: next }, n.courseId);
    if (mastered && n.kind === 'remedial') this.advanceRemediation(n.courseId, nodeId);
    return next;
  }
  advanceRemediation(courseId: string, completedNodeId: string) {
    const outgoing = this.store
      .list('edge', courseId)
      .filter((e) => e.active && e.kind === 'remediation' && e.fromNodeId === completedNodeId);
    for (const edge of outgoing) {
      const target = this.store.must('node', edge.toNodeId);
      if (target.kind !== 'main') continue;
      const p = this.store.must('progress', target.id);
      if (!p.cycleId) continue;
      const cycle = this.store.must('cycle', p.cycleId);
      const gates = this.store
        .list('edge', courseId)
        .filter((e) => e.active && e.kind === 'remediation' && e.toNodeId === target.id);
      if (!gates.every((e) => this.store.must('progress', e.fromNodeId).masteredOnce)) continue;
      const patchIds = gates.map((e) => e.patchId);
      if (patchIds.every((id) => this.store.must('patch', id).verificationStarted)) continue;
      for (const id of patchIds) {
        const patch = this.store.must('patch', id);
        this.store.put('patch', { ...patch, verificationStarted: true });
      }
      this.store.put('cycle', { ...cycle, status: 'superseded', completedAt: now() }, target.id);
      const newCycle = {
        id: uuid(),
        courseId,
        nodeId: target.id,
        remediationEpochId: cycle.remediationEpochId,
        kind: 'verification',
        status: 'open',
        startedAt: now(),
      };
      this.store.put('cycle', newCycle, target.id);
      this.store.put('progress', {
        ...p,
        cycleId: newCycle.id,
        status: 'learning',
        objectiveEvidence: {},
        reviewStage: 0,
      });
      this.store.emit(
        'progress.updated',
        {
          nodeId: target.id,
          cycleId: newCycle.id,
          progress: this.store.must('progress', target.id),
        },
        courseId,
      );
    }
  }
  invalidate(attemptId: string, reason: string) {
    const a = this.store.must('attempt', attemptId),
      assignment = this.store.must('assignment', a.assignmentId),
      e = this.store.must('exercise', assignment.exerciseId);
    this.store.put('exercise', { ...e, status: 'invalid', invalidReason: reason }, e.nodeId);
    const ids = new Set(
      this.store
        .list('assignment', a.courseId)
        .filter((x) => x.exerciseId === e.id)
        .map((x) => x.id),
    );
    for (const t of this.store.list('attempt', a.courseId).filter((t) => ids.has(t.assignmentId)))
      this.store.put('attempt', { ...t, voidedAt: now() }, t.assignmentId);
    return this.recompute(a.nodeId);
  }
}
