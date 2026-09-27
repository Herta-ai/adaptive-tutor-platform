import { z } from 'zod';
import { id, objective, exercise } from '../contracts/v1.js';
import { requireThat } from '../domain/errors.js';
const revision = z.number().int().positive(),
  time = z.iso.datetime();
const exerciseMetadata = {
  id,
  courseId: id,
  nodeId: id,
  familyId: id,
  version: revision,
  lessonVersion: revision,
  status: z.enum(['active', 'invalid']),
  invalidReason: z.string().max(60000).optional(),
};
export const portableExercise = z.discriminatedUnion('kind', [
  exercise.options[0].extend(exerciseMetadata),
  exercise.options[1].extend(exerciseMetadata),
  exercise.options[2].extend(exerciseMetadata),
  exercise.options[3].extend(exerciseMetadata),
]);
const course = z.strictObject({
  id,
  title: z.string().min(1).max(200),
  topic: z.string().min(1).max(200),
  goal: z.string().min(1).max(2000),
  profile: z.strictObject({
    background: z.string().max(4000).optional(),
    weeklyMinutes: z.number().int().min(1).max(10080).optional(),
    language: z.string().min(1).max(40),
    targetDate: z.iso.date().optional(),
  }),
  status: z.enum(['draft', 'active', 'archived']),
  revision,
  createdAt: time,
});
const node = z.strictObject({
  id,
  courseId: id,
  conceptId: id,
  title: z.string().min(1).max(200),
  kind: z.enum(['main', 'remedial', 'optional']),
  objectives: z.array(objective).min(1).max(3),
  estimatedMinutes: z.number().int().min(5).max(15),
  contentStatus: z.enum(['not_generated', 'generating', 'ready', 'error']),
  currentLessonVersion: z.number().int().nonnegative(),
  archived: z.boolean().optional(),
});
const edge = z.strictObject({
  id,
  courseId: id,
  fromNodeId: id,
  toNodeId: id,
  kind: z.enum(['prerequisite', 'remediation']),
  patchId: id.optional(),
  active: z.boolean(),
});
export const portableCourse = z.strictObject({
  schemaVersion: z.literal('1.0'),
  course,
  concepts: z
    .array(z.strictObject({ id, courseId: id, key: id, label: z.string().min(1).max(200) }))
    .max(500),
  nodes: z.array(node).max(500),
  edges: z.array(edge).max(10000),
  lessonIndex: z.array(z.strictObject({ nodeId: id, version: revision })).max(10000),
  exercises: z.array(portableExercise).max(100000).optional(),
});
export function validateExerciseBank(data: z.infer<typeof portableCourse>, lessons: any[]) {
  const embedded = lessons.flatMap((l) =>
    l.document.exercises.map((e: unknown) => portableExercise.parse(e)),
  );
  const bank = data.exercises ?? embedded;
  const ids = new Map<string, z.infer<typeof portableExercise>>();
  const families = new Map<string, string>();
  const familyOwners = new Map<string, string>();
  for (const e of bank) {
    const node = data.nodes.find((n) => n.id === e.nodeId);
    requireThat(
      !ids.has(e.id) &&
        node &&
        e.courseId === data.course.id &&
        node.objectives.some((o) => o.id === e.objectiveId) &&
        lessons.some((l) => l.nodeId === e.nodeId && l.version === e.lessonVersion),
      'REFERENCE_INVALID',
      '题库标识或归属无效',
    );
    const key = JSON.stringify([e.nodeId, e.familyKey]);
    requireThat(
      (!families.has(key) || families.get(key) === e.familyId) &&
        (!familyOwners.has(e.familyId) || familyOwners.get(e.familyId) === key),
      'REFERENCE_INVALID',
      '题目家族映射不一致',
    );
    families.set(key, e.familyId);
    familyOwners.set(e.familyId, key);
    ids.set(e.id, e);
  }
  for (const original of embedded) {
    const current = ids.get(original.id);
    const content = (e: z.infer<typeof portableExercise>) => {
      const { status, invalidReason, ...rest } = e;
      return JSON.stringify(rest);
    };
    requireThat(
      current && content(current) === content(original),
      'REFERENCE_INVALID',
      '题库与历史正文内容不一致',
    );
  }
  return bank;
}
const personalKeys: Record<string, string[]> = {
  progress: [
    'id',
    'courseId',
    'cycleId',
    'status',
    'masteredOnce',
    'masteredAt',
    'reviewStage',
    'nextReviewAt',
    'objectiveEvidence',
    'bypass',
  ],
  cycle: [
    'id',
    'courseId',
    'nodeId',
    'remediationEpochId',
    'kind',
    'status',
    'startedAt',
    'completedAt',
  ],
  assignment: [
    'id',
    'courseId',
    'nodeId',
    'objectiveId',
    'cycleId',
    'exerciseId',
    'exerciseVersion',
    'familyId',
    'eligibleForEvidence',
    'issuedAt',
    'hintRevealedAt',
    'solutionRevealedAt',
  ],
  attempt: [
    'id',
    'courseId',
    'assignmentId',
    'clientRequestId',
    'cycleId',
    'nodeId',
    'objectiveId',
    'familyId',
    'answer',
    'correct',
    'firstInFamily',
    'evidenceScore',
    'createdAt',
    'voidedAt',
    'diagnosisState',
    'diagnosisRequestId',
  ],
  diagnosis: [
    'id',
    'courseId',
    'nodeId',
    'cycleId',
    'requestId',
    'schemaVersion',
    'objectiveId',
    'attemptIds',
    'errorType',
    'confidence',
    'explanation',
    'nextAction',
    'patchProposal',
    'status',
    'patchError',
  ],
  patch: [
    'id',
    'courseId',
    'targetNodeId',
    'cycleId',
    'remediationEpochId',
    'baseRevision',
    'diagnosisId',
    'conceptIds',
    'createdNodeIds',
    'proposal',
    'status',
    'createdAt',
    'revertedAt',
    'verificationStarted',
  ],
  note: ['id', 'courseId', 'text', 'version', 'updatedAt'],
  session: ['id', 'courseId', 'status', 'providerBindingValid', 'createdAt', 'clearedAt'],
  message: [
    'id',
    'courseId',
    'sessionId',
    'requestId',
    'role',
    'text',
    'status',
    'contextSnapshotId',
    'createdAt',
  ],
  context: [
    'id',
    'courseId',
    'nodeId',
    'lessonVersion',
    'blockId',
    'selection',
    'componentState',
    'activeAssignmentId',
    'createdAt',
  ],
  demo_snapshot: [
    'id',
    'courseId',
    'nodeId',
    'stateSchemaVersion',
    'lessonVersion',
    'blockId',
    'templateId',
    'templateVersion',
    'parameters',
    'selectedIds',
    'step',
    'summary',
    'artifactRefs',
    'createdAt',
  ],
};
export function validatePersonal(
  personal: Record<string, any[]>,
  data: z.infer<typeof portableCourse>,
  lessons: any[],
) {
  const nodes = new Set(data.nodes.map((n) => n.id)),
    exercises = new Map<string, any>();
  for (const l of lessons) for (const e of l.document.exercises) exercises.set(e.id, e);
  for (const e of data.exercises ?? []) exercises.set(e.id, e);
  const lookup = (kind: string, value: unknown) =>
    (personal[kind] ?? []).some((r) => r.id === value);
  for (const [kind, rows] of Object.entries(personal)) {
    requireThat(
      personalKeys[kind] && rows.length <= 100000,
      'PERSONAL_INVALID',
      '个人记录类型或数量无效',
    );
    const ids = new Set();
    for (const row of rows) {
      requireThat(
        row && typeof row.id === 'string' && !ids.has(row.id) && row.courseId === data.course.id,
        'PERSONAL_INVALID',
        '个人记录标识或归属无效',
      );
      ids.add(row.id);
      requireThat(
        Object.keys(row).every((k) => personalKeys[kind].includes(k)),
        'PERSONAL_INVALID',
        '个人记录包含未知字段',
      );
      if (row.nodeId)
        requireThat(nodes.has(row.nodeId), 'REFERENCE_INVALID', '个人记录的节点不存在');
      if (kind === 'progress') {
        requireThat(
          nodes.has(row.id) &&
            (!row.cycleId || lookup('cycle', row.cycleId)) &&
            typeof row.masteredOnce === 'boolean' &&
            typeof row.bypass === 'boolean' &&
            ['locked', 'available', 'learning', 'mastered', 'review_due'].includes(row.status) &&
            Number.isInteger(row.reviewStage) &&
            row.reviewStage >= 0 &&
            row.reviewStage <= 3,
          'PERSONAL_INVALID',
          '进度状态无效',
        );
      }
      if (kind === 'cycle')
        requireThat(
          ['open', 'closed', 'superseded'].includes(row.status) &&
            typeof row.remediationEpochId === 'string',
          'PERSONAL_INVALID',
          '学习轮无效',
        );
      if (kind === 'assignment') {
        const e = exercises.get(row.exerciseId);
        requireThat(
          e &&
            e.nodeId === row.nodeId &&
            e.objectiveId === row.objectiveId &&
            e.version === row.exerciseVersion &&
            e.familyId === row.familyId &&
            lookup('cycle', row.cycleId) &&
            typeof row.eligibleForEvidence === 'boolean',
          'REFERENCE_INVALID',
          '题目分配引用无效',
        );
      }
      if (kind === 'attempt') {
        requireThat(
          lookup('assignment', row.assignmentId) &&
            lookup('cycle', row.cycleId) &&
            typeof row.correct === 'boolean' &&
            typeof row.firstInFamily === 'boolean' &&
            [null, 0, 1].includes(row.evidenceScore) &&
            !(row.evidenceScore === 1 && !row.correct),
          'PERSONAL_INVALID',
          '作答证据无效',
        );
        const a = personal.assignment.find((a) => a.id === row.assignmentId);
        requireThat(
          a.nodeId === row.nodeId &&
            a.cycleId === row.cycleId &&
            a.familyId === row.familyId &&
            a.objectiveId === row.objectiveId,
          'REFERENCE_INVALID',
          '作答与题目分配不一致',
        );
      }
      if (kind === 'note')
        requireThat(
          nodes.has(row.id) &&
            typeof row.text === 'string' &&
            row.text.length <= 60000 &&
            Number.isInteger(row.version),
          'PERSONAL_INVALID',
          '笔记无效',
        );
      if (kind === 'message')
        requireThat(
          lookup('session', row.sessionId) &&
            (!row.contextSnapshotId || lookup('context', row.contextSnapshotId)) &&
            typeof row.text === 'string' &&
            row.text.length <= 100000,
          'REFERENCE_INVALID',
          '消息引用无效',
        );
      if (kind === 'context' || kind === 'demo_snapshot') {
        const l = lessons.find((l) => l.nodeId === row.nodeId && l.version === row.lessonVersion);
        requireThat(
          l && (!row.blockId || l.document.blocks.some((b: any) => b.blockId === row.blockId)),
          'REFERENCE_INVALID',
          '历史上下文不存在',
        );
      }
    }
  }
}
