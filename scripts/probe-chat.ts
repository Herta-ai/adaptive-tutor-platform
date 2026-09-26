// Manual real-CLI regression probe. Uses synthetic content in a temporary database.
// Never run in the default test suite: this consumes the user's CLI quota.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, uuid } from '../src/storage/database.js';
import { Courses } from '../src/domain/courses.js';
import { createGeometryExample } from '../src/domain/examples.js';
import { Jobs } from '../src/server/jobs.js';
const root = mkdtempSync(join(tmpdir(), 'tutor-live-chat-'));
const store = new Store(root),
  courses = new Courses(store),
  jobs = new Jobs(store, courses);
const report: any = {
  date: new Date().toISOString(),
  cliVersion: jobs.runtime.version,
  synthetic: true,
  turns: [],
};
try {
  const course = createGeometryExample(courses),
    node = store.list('node', course.id)[0];
  const session = store.put('session', {
    id: uuid(),
    courseId: course.id,
    status: 'active',
    providerBindingValid: false,
  });
  let priorConversation: string | undefined;
  for (const question of [
    '你好，请简单介绍这一节。',
    '请接着用底为4、高为3的例子说明为什么要除以二。',
  ]) {
    const request = store.transaction(() =>
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
    const started = Date.now();
    console.log('生产聊天队列：开始合成问答 ' + (report.turns.length + 1));
    while (
      !['completed', 'failed', 'cancelled', 'interrupted'].includes(
        store.must('job', request.requestId).state,
      )
    ) {
      await new Promise((r) => setTimeout(r, 1000));
      if (Date.now() - started > 190000) jobs.cancel(request.requestId);
    }
    const job = store.must('job', request.requestId);
    const message = store
      .list('message', course.id, session.id)
      .find((m) => m.requestId === request.requestId && m.role === 'assistant');
    const binding = store.must('session', session.id);
    report.turns.push({
      state: job.state,
      messageStatus: message.status,
      responseLength: message.text.length,
      elapsedMs: job.elapsedMs,
      error: job.error ?? null,
      conversationBound: binding.providerBindingValid,
      continuedSameConversation: priorConversation
        ? binding.providerConversationId === priorConversation
        : null,
    });
    priorConversation = binding.providerConversationId;
    console.log(JSON.stringify(report.turns.at(-1)));
    if (job.state !== 'completed' || !message.text.trim()) throw Error('CHAT_PROBE_FAILED');
  }
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.error = e instanceof Error ? e.message : String(e);
  process.exitCode = 1;
} finally {
  await jobs.close();
  store.close();
  rmSync(root, { recursive: true, force: true });
  writeFileSync('specs/phase-1/M1/live-chat.json', JSON.stringify(report, null, 2) + '\n');
}
