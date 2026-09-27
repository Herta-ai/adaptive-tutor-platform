import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/storage/database.js';
import { installShutdown } from '../src/server/shutdown.js';
import { publishConnection } from '../src/server/connection.js';
const roots: string[] = [];
const stores: Store[] = [];
function root() {
  const r = mkdtempSync(join(tmpdir(), 'writer-test-'));
  roots.push(r);
  return r;
}
function open(r: string) {
  const s = new Store(r, true);
  stores.push(s);
  return s;
}
afterEach(() => {
  vi.useRealTimers();
  for (const s of stores.splice(0)) s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
it('excludes live writers and closes idempotently', () => {
  const r = root();
  const s = open(r);
  expect(() => open(r)).toThrow('占用');
  s.close();
  s.close();
  expect(existsSync(join(r, 'runtime/writer.lock'))).toBe(false);
  open(r);
});
it('removes writer marker and connection in a Windows Unicode data path', () => {
  const r = join(root(), '中文 用户');
  const s = open(r);
  const dispose = publishConnection(r, 'http://127.0.0.1:12345', 'synthetic-test-token');
  dispose();
  dispose();
  s.close();
  expect(existsSync(join(r, 'runtime/connection.json'))).toBe(false);
  expect(existsSync(join(r, 'runtime/writer.lock'))).toBe(false);
  open(r);
});
it('preserves a live legacy writer', () => {
  const r = root();
  open(r).close();
  const marker = join(r, 'runtime/writer.lock');
  const legacy = JSON.stringify({ pid: process.pid });
  writeFileSync(marker, legacy);
  expect(() => open(r)).toThrow('占用');
  expect(readFileSync(marker, 'utf8')).toBe(legacy);
});
it('releases lease when database initialization fails', () => {
  const r = root();
  const s = open(r);
  s.db.exec('PRAGMA user_version=99');
  s.close();
  expect(() => open(r)).toThrow('数据库版本');
  expect(existsSync(join(r, 'runtime/writer.lock'))).toBe(false);
  const repair = new DatabaseSync(join(r, 'tutor.sqlite'));
  repair.exec('PRAGMA user_version=1');
  repair.close();
  open(r);
});
it('recovers after actual process termination and handles legacy dead PID', async () => {
  const r = root();
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src/storage/database.ts')).href;
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import { DatabaseSync } from 'node:sqlite';
import { Store } from ${JSON.stringify(moduleUrl)}; new Store(${JSON.stringify(r)}, true); console.log('ready'); setInterval(()=>{}, 1000);`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let errors = '';
  child.stderr.on('data', (d) => {
    errors += d;
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
      child.once('exit', () => reject(new Error(errors)));
    });
    expect(() => open(r)).toThrow('占用');
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    expect(existsSync(join(r, 'runtime/writer.lock'))).toBe(true);
    open(r).close();
    writeFileSync(join(r, 'runtime/writer.lock'), JSON.stringify({ pid: child.pid }));
    open(r);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});
it('repeated SIGINT runs cleanup once', async () => {
  const closeAsync = vi.fn(async () => {});
  const closeSync = vi.fn();
  const exit = vi.fn();
  const handler = installShutdown({ closeAsync, closeSync, exit });
  try {
    process.emit('SIGINT');
    process.emit('SIGINT');
    await handler.stop();
    expect(closeAsync).toHaveBeenCalledTimes(1);
    expect(closeSync).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  } finally {
    handler.dispose();
  }
});
it.each(['throw', 'hang'])('cleanup survives %s during shutdown', async (mode) => {
  vi.useFakeTimers();
  const closeSync = vi.fn();
  const exit = vi.fn();
  const handler = installShutdown({
    closeAsync: () =>
      mode === 'throw' ? Promise.reject(new Error('failed')) : new Promise(() => {}),
    closeSync,
    exit,
    report: vi.fn(),
    timeoutMs: 100,
  });
  try {
    const stopped = handler.stop();
    await vi.advanceTimersByTimeAsync(101);
    await stopped;
    expect(closeSync).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  } finally {
    handler.dispose();
  }
});
