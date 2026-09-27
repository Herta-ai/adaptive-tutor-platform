import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, uuid } from '../src/storage/database.js';
import { Courses } from '../src/domain/courses.js';
import { createGeometryExample } from '../src/domain/examples.js';
import { AppError } from '../src/domain/errors.js';
const run = vi.hoisted(() => vi.fn());
vi.mock('../src/runtime/antigravity.js', () => ({
  detectRuntime: () => ({ executable: 'synthetic-cli', version: '1.2.11', state: 'ready' }),
  runCli: run,
}));
import { Jobs } from '../src/server/jobs.js';
let root: string, store: Store, courses: Courses, jobs: Jobs, session: any, node: any;
beforeEach(() => {
  run.mockReset();
  root = mkdtempSync(join(tmpdir(), 'tutor-chat-test-'));
  store = new Store(root);
  courses = new Courses(store);
  const course = createGeometryExample(courses);
  node = store.list('node', course.id)[0];
  session = store.put('session', {
    id: uuid(),
    courseId: course.id,
    status: 'active',
    providerBindingValid: false,
  });
  jobs = new Jobs(store, courses);
});
afterEach(async () => {
  await jobs.close();
  store.close();
  rmSync(root, { recursive: true, force: true });
});
function ask(question = '你好') {
  return store.transaction(() =>
    jobs.ask(session.id, {
      clientRequestId: uuid(),
      question,
      context: {
        nodeId: node.id,
        lessonVersion: 1,
        blockId: null,
        selection: null,
        componentState: null,
        activeAssignmentId: null,
      },
    }),
  );
}
const response = (text = '你好，我们一起学习面积。') => ({
  result: { status: 'SUCCESS', response: text },
  conversationId: 'provider-session',
  elapsedMs: 10,
});
const message = (id: string) =>
  store
    .list('message', session.courseId, session.id)
    .find((m) => m.requestId === id && m.role === 'assistant');
it('导师直接问答：提交当前上下文、最终文本替换增量，后续使用指定会话', async () => {
  run.mockImplementation(async (options) => {
    options.onDelta('预览', 1);
    return response();
  });
  const first = ask();
  await vi.waitFor(() => expect(store.must('job', first.requestId).state).toBe('completed'));
  expect(message(first.requestId)).toMatchObject({
    status: 'complete',
    text: response().result.response,
  });
  expect(run.mock.calls[0][0].prompt).toContain('不要调用任何工具');
  expect(run.mock.calls[0][0].schemaPath).toBeUndefined();
  expect(run.mock.calls[0][0].timeoutMs).toBe(300000);
  expect(run.mock.calls[0][0].prompt).not.toContain('scopeId');
  const second = ask('能解释一下吗');
  await vi.waitFor(() => expect(store.must('job', second.requestId).state).toBe('completed'));
  expect(run.mock.calls[1][0].conversationId).toBe('provider-session');
});
it('聊天步骤持久化、去重、限制80步，并拒绝取消后的迟到进度', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = ask();
  await vi.waitFor(() => expect(run).toHaveBeenCalled());
  const activity = run.mock.calls[0][0].onActivity;
  for (let i = 0; i < 85; i++) {
    activity({ id: 'step-' + i, phase: 'tool', state: 'active', stepIndex: i });
    activity({ id: 'step-' + i, phase: 'tool', state: 'active', stepIndex: i });
  }
  activity({ id: 'step-84', phase: 'tool', state: 'done', stepIndex: 84 });
  const job = store.must('job', request.requestId);
  expect(job.activities).toHaveLength(80);
  expect(job.activities.at(-1).state).toBe('done');
  expect(job.timeoutMs).toBe(300000);
  expect(courses.snapshot(session.courseId, session.id).jobs[0].activities).toEqual(job.activities);
  const other = store.put('session', { ...session, id: uuid() });
  expect(courses.snapshot(session.courseId, other.id).jobs).toHaveLength(0);
  jobs.cancel(request.requestId);
  activity({ id: 'late', phase: 'result', state: 'done' });
  expect(store.must('job', request.requestId).activities).toEqual(job.activities);
  finish(response());
});
it('超时保留已流出的文本并结束占位；允许重新发送且不续用失败会话', async () => {
  run.mockImplementationOnce(async (options) => {
    options.onDelta('部分回答', 1);
    throw new AppError('CLI_TIMEOUT', 'CLI 运行超时');
  });
  const failed = ask();
  await vi.waitFor(() => expect(store.must('job', failed.requestId).state).toBe('failed'));
  expect(message(failed.requestId)).toMatchObject({ status: 'failed', text: '部分回答' });
  run.mockResolvedValueOnce(response());
  const next = ask();
  await vi.waitFor(() => expect(store.must('job', next.requestId).state).toBe('completed'));
  expect(run.mock.calls[1][0].conversationId).toBeUndefined();
});
it('取消与完成竞态不留下永久等待或覆盖取消状态', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = ask();
  await vi.waitFor(() => expect(run).toHaveBeenCalled());
  jobs.cancel(request.requestId);
  expect(message(request.requestId).status).toBe('cancelled');
  finish(response());
  await new Promise((r) => setImmediate(r));
  expect(store.must('job', request.requestId).state).toBe('cancelled');
  expect(message(request.requestId).text).toBe('');
});
it('空 SUCCESS 回答判为失败；重启修复旧版本遗留 pending 消息', async () => {
  run.mockResolvedValueOnce(response('   '));
  const request = ask();
  await vi.waitFor(() => expect(store.must('job', request.requestId).state).toBe('failed'));
  expect(message(request.requestId).status).toBe('failed');
  store.put('message', { ...message(request.requestId), status: 'pending' }, session.id);
  await jobs.close();
  jobs = new Jobs(store, courses);
  expect(message(request.requestId).status).toBe('failed');
});
it('清空仅清理当前会话，后续提问从新会话开始', async () => {
  run.mockResolvedValue(response('旧导师回复'));
  const request = ask('需要清空的问题');
  await vi.waitFor(() => expect(store.must('job', request.requestId).state).toBe('completed'));
  const other = store.put('session', { ...session, id: uuid() });
  store.put(
    'message',
    {
      id: uuid(),
      courseId: session.courseId,
      sessionId: other.id,
      role: 'user',
      text: '保留其他对话',
    },
    other.id,
  );
  store.put('note', { id: node.id, courseId: session.courseId, text: '保留笔记' });
  const clear = () =>
    store.command('session.clear:' + session.id, 'same-clear', {}, () =>
      jobs.clearSession(session.id),
    );
  expect(clear()).toMatchObject({ cleared: true });
  expect(clear()).toMatchObject({ cleared: true });
  expect(store.list('message', session.courseId, session.id)).toHaveLength(0);
  expect(store.list('context', session.courseId)).toHaveLength(0);
  expect(store.list('job', session.courseId)).toHaveLength(0);
  expect(store.list('scope', session.courseId)).toHaveLength(0);
  expect(store.list('message', session.courseId, other.id)).toHaveLength(1);
  expect(store.must('note', node.id).text).toBe('保留笔记');
  expect(store.must('session', session.id).providerConversationId).toBeUndefined();
  const next = ask('新的问题');
  await vi.waitFor(() => expect(store.must('job', next.requestId).state).toBe('completed'));
  expect(run.mock.calls[1][0].conversationId).toBeUndefined();
  expect(run.mock.calls[1][0].prompt).not.toMatch(/需要清空的问题|旧导师回复|保留其他对话/);
});
it('有运行任务及取消后进程尚未退出时，拒绝清空', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = ask();
  await vi.waitFor(() => expect(run).toHaveBeenCalled());
  expect(() => store.transaction(() => jobs.clearSession(session.id))).toThrow('请先停止回复');
  jobs.cancel(request.requestId);
  expect(() => store.transaction(() => jobs.clearSession(session.id))).toThrow('请先停止回复');
  expect(store.list('message', session.courseId, session.id)).toHaveLength(2);
  finish(response());
});
