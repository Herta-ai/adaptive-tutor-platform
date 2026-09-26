import { z } from 'zod';
import { Store, hash, now, uuid } from '../storage/database.js';
import { draftSchemas, type Kind } from '../contracts/v1.js';
import { requireThat, AppError } from '../domain/errors.js';
import { Courses } from '../domain/courses.js';
import { validateCurriculum, validateLesson } from '../domain/content.js';
export const toolSchemas = {
  get_curriculum: z.strictObject({
    scopeId: z.string(),
    revision: z.number().int().positive().optional(),
  }),
  get_node_content: z.strictObject({
    scopeId: z.string(),
    nodeId: z.string(),
    lessonVersion: z.number().int().positive().optional(),
    blockId: z.string().optional(),
    cursor: z.string().optional(),
  }),
  get_assessment_context: z.strictObject({
    scopeId: z.string(),
    attemptIds: z.array(z.string()).max(20),
  }),
  list_course_assets: z.strictObject({
    scopeId: z.string(),
    cursor: z.string().optional(),
    filter: z.string().optional(),
  }),
  save_generation_draft: z.strictObject({
    scopeId: z.string(),
    operationId: z.string().min(1).max(160),
    kind: z.enum([
      'plan_course',
      'generate_lesson',
      'generate_exercises',
      'diagnose',
      'revise_lesson',
    ]),
    payload: z.unknown(),
  }),
};
export type ToolName = keyof typeof toolSchemas;
export class Gateway {
  constructor(
    readonly store: Store,
    readonly courses: Courses,
  ) {}
  call(name: ToolName, input: unknown) {
    requireThat(Object.hasOwn(toolSchemas, name), 'SCOPE_DENIED', '工具不存在', 403);
    const args = toolSchemas[name].parse(input) as any;
    return this.store.transaction(() => {
      const s = this.store.must('scope', args.scopeId),
        job = this.store.must('job', s.requestId);
      requireThat(
        !s.revokedAt && s.expiresAt > now() && job.state === 'running' && job.runId === s.runId,
        'SCOPE_EXPIRED',
        '任务范围已过期',
        409,
      );
      requireThat(s.allowedTools.includes(name), 'SCOPE_DENIED', '当前任务不能使用此工具', 403);
      const course = this.store.must('course', s.courseId);
      requireThat(course.revision === s.baseRevision, 'VERSION_CONFLICT', '课程版本已变化', 409);
      if (name === 'get_curriculum') {
        if (args.revision)
          requireThat(args.revision === course.revision, 'VERSION_CONFLICT', '请求版本不可用', 409);
        const data = {
          course: {
            id: course.id,
            title: course.title,
            goal: course.goal,
            revision: course.revision,
          },
          nodes: this.store.list('node', s.courseId).filter((n) => s.allowedNodeIds.includes(n.id)),
          edges: this.store
            .list('edge', s.courseId)
            .filter(
              (e) =>
                s.allowedNodeIds.includes(e.fromNodeId) && s.allowedNodeIds.includes(e.toNodeId),
            ),
          progress: this.store
            .list('progress', s.courseId)
            .filter((p) => s.allowedNodeIds.includes(p.id)),
        };
        requireThat(
          JSON.stringify(data).length <= 8000,
          'CONTEXT_TOO_LARGE',
          '课程摘要超过工具限制；请缩小任务范围',
        );
        return data;
      }
      if (name === 'get_node_content') {
        requireThat(
          s.allowedNodeIds.includes(args.nodeId),
          'SCOPE_DENIED',
          '节点超出任务范围',
          403,
        );
        const lesson = this.courses.lesson(args.nodeId, args.lessonVersion);
        if (!lesson.blocks) return lesson;
        const blocks = lesson.blocks.filter(
          (b: any) => !args.blockId || b.blockId === args.blockId,
        );
        return page(blocks, args.cursor);
      }
      if (name === 'list_course_assets')
        return page(
          this.store
            .list('asset', s.courseId)
            .map(({ id, mime, hash, size }) => ({ id, mime, hash, size })),
          args.cursor,
        );
      if (name === 'get_assessment_context') {
        requireThat(
          s.allowedKind === 'diagnose' &&
            args.attemptIds.every((id: string) => job.payload.attemptIds.includes(id)),
          'SCOPE_DENIED',
          '作答不在诊断范围',
          403,
        );
        const values = args.attemptIds.map((id: string) => {
          const a = this.store.must('attempt', id);
          requireThat(a.courseId === s.courseId, 'SCOPE_DENIED', '作答不属于课程', 403);
          const assignment = this.store.must('assignment', a.assignmentId);
          return { attempt: a, exercise: this.store.must('exercise', assignment.exerciseId) };
        });
        return page(values);
      }
      requireThat(s.allowedKind === args.kind, 'SCOPE_DENIED', '草稿类型不在范围', 403);
      requireThat(
        Buffer.byteLength(JSON.stringify(args.payload)) <= 1024 * 1024,
        'PAYLOAD_TOO_LARGE',
        '草稿超过 1 MiB',
        413,
      );
      const payload = draftSchemas[args.kind as Kind].parse(args.payload);
      if (args.kind === 'plan_course') validateCurriculum(payload);
      if (args.kind === 'generate_lesson' || args.kind === 'revise_lesson') {
        requireThat(
          job.payload.nodeId && s.allowedNodeIds.includes(job.payload.nodeId),
          'SCOPE_DENIED',
          '缺少节点范围',
          403,
        );
        validateLesson(payload, this.store.must('node', job.payload.nodeId).objectives);
      }
      const contentHash = hash(payload);
      const existing = this.store
        .list('draft', s.courseId)
        .find((d) => d.runId === s.runId && d.operationId === args.operationId);
      if (existing) {
        requireThat(
          existing.contentHash === contentHash,
          'IDEMPOTENCY_CONFLICT',
          '重复操作内容不同',
          409,
        );
        return { draftId: existing.id, kind: existing.kind, contentHash };
      }
      const d = {
        id: uuid(),
        courseId: s.courseId,
        requestId: s.requestId,
        runId: s.runId,
        nodeId: job.payload.nodeId,
        kind: args.kind,
        baseRevision: s.baseRevision,
        operationId: args.operationId,
        payload,
        contentHash,
        status: 'staged',
      };
      this.store.put('draft', d);
      return { draftId: d.id, kind: d.kind, contentHash };
    });
  }
}
function page(items: any[], cursor = '0') {
  requireThat(/^\d+$/.test(cursor), 'CURSOR_INVALID', '分页游标无效', 400);
  const offset = Number(cursor);
  requireThat(
    Number.isSafeInteger(offset) && offset <= items.length,
    'CURSOR_INVALID',
    '分页游标超出范围',
    400,
  );
  const output: any[] = [];
  let length = 0;
  for (const item of items.slice(offset, offset + 20)) {
    const size = JSON.stringify(item).length;
    requireThat(size <= 8000, 'CONTEXT_TOO_LARGE', '单项内容超过切片限制');
    if (length + size > 8000) break;
    output.push(item);
    length += size;
  }
  return {
    items: output,
    nextCursor: offset + output.length < items.length ? String(offset + output.length) : null,
  };
}
