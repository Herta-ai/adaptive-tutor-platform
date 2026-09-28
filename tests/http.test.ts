import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/database.js';
import { createApplication } from '../src/server/http.js';
const cleanup: (() => Promise<void>)[] = [];
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tutor-http-')),
    store = new Store(root),
    app = createApplication(store);
  await app.listen();
  cleanup.push(async () => {
    await app.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { app, store, root };
}
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});
describe('A17/A30 本地服务边界', () => {
  it('关闭服务时同步清理 SSE 轮询，不依赖延迟的连接 close 事件', async () => {
    const { app, store } = await setup();
    store.put('course', { id: 'course', revision: 1 });
    const bootstrap = await fetch(app.origin + '/api/v1/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ token: app.mintBootstrap() }),
    });
    const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0];
    await bootstrap.json();
    // Suppress the response's close handler to model delayed socket cleanup.
    app.server.on('request', (req, res) => {
      if (req.url?.startsWith('/api/v1/events')) res.removeAllListeners('close');
    });
    const events = vi.spyOn(store, 'events');
    const response = await fetch(app.origin + '/api/v1/events?courseId=course', {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(events).toHaveBeenCalled();
    const disconnected = response.text().catch(() => undefined);
    await app.close();
    events.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(events).not.toHaveBeenCalled();
    await disconnected;
  });
  it('无会话拒绝，bootstrap 一次消费，写入需要 CSRF', async () => {
    const { app } = await setup();
    expect((await fetch(app.origin + '/api/v1/courses')).status).toBe(401);
    const token = app.mintBootstrap(),
      bootstrap = () =>
        fetch(app.origin + '/api/v1/bootstrap', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
    const first = await bootstrap();
    expect(first.status).toBe(200);
    expect((await bootstrap()).status).toBe(401);
    const cookie = first.headers.get('set-cookie')!.split(';')[0];
    const { csrf } = await first.json();
    expect((await fetch(app.origin + '/api/v1/courses', { headers: { cookie } })).status).toBe(200);
    expect(
      (
        await fetch(app.origin + '/api/v1/courses', {
          method: 'POST',
          headers: { cookie },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(app.origin + '/api/v1/courses', {
          headers: { cookie, origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    const c = await fetch(app.origin + '/api/v1/courses', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf },
      body: JSON.stringify({
        clientRequestId: 'create',
        topic: '数学',
        goal: '理解',
        profile: { background: '', weeklyMinutes: 60, language: '中文' },
      }),
    });
    expect(c.status).toBe(201);
  });
  it('MCP 私有凭证与 scope 都必须有效', async () => {
    const { app, store } = await setup();
    const request = (args: any, token = app.mcpToken) =>
      fetch(app.origin + '/internal/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token },
        body: JSON.stringify({ name: 'get_curriculum', args }),
      });
    expect((await request({ scopeId: 'none' }, 'bad')).status).toBe(403);
    store.put('course', { id: 'course', revision: 1 });
    store.put('job', { id: 'job', courseId: 'course', runId: 'run', state: 'running' });
    store.put('scope', {
      id: 'scope',
      courseId: 'course',
      requestId: 'job',
      runId: 'run',
      baseRevision: 1,
      allowedNodeIds: [],
      allowedTools: ['get_curriculum'],
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect((await request({ scopeId: 'scope' })).status).toBe(200);
    store.put('job', { id: 'job', courseId: 'course', runId: 'run', state: 'cancelled' });
    expect((await request({ scopeId: 'scope' })).status).toBe(409);
  });
});
