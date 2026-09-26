import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Store, dataRoot, uuid, now } from '../src/storage/database.js';
import { createApplication } from '../src/server/http.js';
import { publishConnection } from '../src/server/connection.js';
import { runCli, detectRuntime } from '../src/runtime/antigravity.js';
import { receipt } from '../src/contracts/v1.js';

// Manual, explicitly authorized integration probe; never part of pnpm test or application startup.
const root = dataRoot(),
  store = new Store(root, true),
  app = createApplication(store);
let dispose = () => {};
const report: any = {
  date: now(),
  os: process.platform,
  cliVersion: detectRuntime().version,
  steps: [],
};
const evidenceDir = join(process.cwd(), 'specs', 'phase-1', 'M0');
try {
  const origin = await app.listen();
  dispose = publishConnection(root, origin, app.mcpToken);
  const cli = detectRuntime();
  if (!cli.executable) throw Error('CLI_NOT_INSTALLED');
  const course = app.courses.create({
    clientRequestId: uuid(),
    topic: 'M0 课程 MCP 联调',
    goal: '仅验证应用协议，无个人信息',
    profile: { background: '', weeklyMinutes: 5, language: '中文' },
  });
  const requestId = uuid(),
    runId = uuid(),
    scopeId = uuid(),
    cwd = join(root, 'jobs', requestId, runId);
  mkdirSync(cwd, { recursive: true });
  const schemaPath = join(cwd, 'receipt.schema.json');
  writeFileSync(schemaPath, JSON.stringify(z.toJSONSchema(receipt)));
  store.put('job', {
    id: requestId,
    requestId,
    runId,
    courseId: course.id,
    kind: 'plan_course',
    state: 'running',
    payload: {},
    baseRevision: 1,
  });
  store.put('scope', {
    id: scopeId,
    requestId,
    runId,
    courseId: course.id,
    allowedNodeIds: [],
    allowedTools: ['get_curriculum', 'save_generation_draft'],
    allowedKind: 'plan_course',
    baseRevision: 1,
    expiresAt: new Date(Date.now() + 180000).toISOString(),
  });
  const payload = {
    schemaVersion: '1.0',
    title: 'M0 协议验证课程',
    summary: '无个人信息的接入探针',
    concepts: [{ key: 'addition', label: '加法' }],
    nodes: [
      {
        key: 'node',
        conceptKey: 'addition',
        title: '加法入门',
        objectives: [{ key: 'sum', description: '计算两个小整数的和' }],
        estimatedMinutes: 5,
      },
    ],
    edges: [],
    sources: [],
  };
  const prompt =
    'Adaptive Tutor MCP integration probe. Use only the adaptive-tutor MCP tools, no shell or file tools. First call get_curriculum with scopeId below, then save_generation_draft with scopeId, operationId="probe-plan", kind="plan_course", and EXACT payload below. Finally return the JSON GenerationReceipt {schemaVersion:"1.0",delivery:"mcp_draft",kind:"plan_course",draftId,contentHash}, copying the draftId and contentHash from the tool result. Do not invent a draftId or hash.\n' +
    JSON.stringify({ scopeId, payload });
  console.log('M0: 启动真实 MCP 草稿联调（最多 180 秒）');
  const outcome = await runCli({
    executable: cli.executable,
    prompt,
    cwd,
    timeoutMs: 180000,
    schemaPath,
    signal: new AbortController().signal,
  });
  const r = receipt.parse(outcome.result.structured_output),
    d = store.must('draft', r.draftId);
  if (d.requestId !== requestId || d.contentHash !== r.contentHash) throw Error('RECEIPT_MISMATCH');
  store.transaction(() => {
    app.courses.publishPlan(course.id, 1, d.payload);
    store.put('draft', { ...d, status: 'published' });
    store.put('job', { ...store.must('job', requestId), state: 'completed' });
    store.put('scope', { ...store.must('scope', scopeId), revokedAt: now() });
    store.put('course', { ...store.must('course', course.id), status: 'archived' });
  });
  report.steps.push({
    name: 'MCP read/save/receipt/publish',
    status: 'passed',
    elapsedMs: Math.round(outcome.elapsedMs),
    permissionMode: outcome.permissionMode,
    nodes: store.list('node', course.id).length,
  });
  console.log('M0: MCP 回执发布通过，继续验证文本与续聊');
  const first = await runCli({
    executable: cli.executable,
    prompt:
      'Integration probe: remember marker TUTOR_PROBE_37. Reply exactly TUTOR_PROBE_37. Do not invoke tools.',
    cwd,
    timeoutMs: 60000,
    signal: new AbortController().signal,
  });
  if (!first.result.response?.includes('TUTOR_PROBE_37')) throw Error('TEXT_MARKER_MISSING');
  const second = await runCli({
    executable: cli.executable,
    prompt:
      'Reply with the marker I asked you to remember in the previous turn. Do not invoke tools.',
    cwd,
    timeoutMs: 60000,
    conversationId: first.conversationId,
    signal: new AbortController().signal,
  });
  report.steps.push({
    name: 'text and explicit conversation',
    status: second.result.response?.includes('TUTOR_PROBE_37') ? 'passed' : 'failed',
    elapsedMs: Math.round(first.elapsedMs + second.elapsedMs),
  });
  report.status = report.steps.every((s: any) => s.status === 'passed') ? 'partial_pass' : 'failed';
} catch (e) {
  report.status = 'failed';
  report.error = e instanceof Error ? e.message : String(e);
  console.error('M0 联调失败：' + report.error);
  process.exitCode = 1;
} finally {
  dispose();
  await app.close();
  store.close();
  writeFileSync(join(evidenceDir, 'live-probe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
