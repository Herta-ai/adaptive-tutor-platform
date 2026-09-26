import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, spawnSync: vi.fn() }));
import { CLI_EXIT_GRACE_MS, runCli } from '../src/runtime/antigravity.js';
afterEach(() => {
  vi.useRealTimers();
  mocks.spawn.mockReset();
});
function start(timeoutMs = 180000) {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: undefined,
  });
  mocks.spawn.mockReturnValue(child);
  const promise = runCli({
    executable: resolve('synthetic-agy.exe'),
    cwd: process.cwd(),
    prompt: 'synthetic',
    timeoutMs,
    signal: new AbortController().signal,
  });
  child.stdout.write('{"event":"result","result":{"status":"SUCCESS","response":"完整回答"}}\n');
  return { child, promise };
}
it('CLI 已返回结果，但超过旧 5 秒门槛后正常退出仍可完成', async () => {
  const { child, promise } = start();
  await vi.advanceTimersByTimeAsync(8000);
  child.emit('close', 0);
  expect((await promise).result.response).toBe('完整回答');
});
it('15 秒清理宽限过后仍未退出必须失败', async () => {
  const { child, promise } = start();
  const assertion = expect(promise).rejects.toMatchObject({ code: 'CLI_PROTOCOL_ERROR' });
  await vi.advanceTimersByTimeAsync(CLI_EXIT_GRACE_MS + 1);
  child.emit('close', null);
  await assertion;
});
it('最终结果不能绕过非零退出和任务总超时', async () => {
  const first = start();
  const nonzero = expect(first.promise).rejects.toMatchObject({ code: 'CLI_FAILED' });
  first.child.emit('close', 1);
  await nonzero;
  const second = start(1000);
  const timeout = expect(second.promise).rejects.toMatchObject({ code: 'CLI_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(1001);
  second.child.emit('close', null);
  await timeout;
});
