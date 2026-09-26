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
  expect(run.mock.calls[0][0].prompt).not.toContain('scopeId');
  const second = ask('能解释一下吗');
  await vi.waitFor(() => expect(store.must('job', second.requestId).state).toBe('completed'));
  expect(run.mock.calls[1][0].conversationId).toBe('provider-session');
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
