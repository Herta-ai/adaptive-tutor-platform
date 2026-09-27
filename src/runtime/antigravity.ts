import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { AppError, requireThat } from '../domain/errors.js';

export const CLI_EXIT_GRACE_MS = 15000;
export interface NativeActivity {
  id: string;
  phase: 'init' | 'input' | 'response' | 'tool' | 'processing' | 'result';
  state: 'active' | 'done' | 'failed';
  stepIndex?: number;
}

export interface NativeResult {
  status: string;
  response?: string;
  structured_output?: unknown;
  conversation_id?: string;
}
export class NativeStream {
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private total = 0;
  private lastActivity = '';
  result?: NativeResult;
  conversationId?: string;
  permissionMode?: string;
  constructor(
    private delta: (text: string, step: number) => void = () => {},
    private activity: (activity: NativeActivity) => void = () => {},
  ) {}
  private report(activity: NativeActivity) {
    const key = JSON.stringify(activity);
    if (key === this.lastActivity) return;
    this.lastActivity = key;
    this.activity(activity);
  }
  push(chunk: Buffer) {
    this.total += chunk.length;
    requireThat(this.total <= 10 * 1024 * 1024, 'CLI_OUTPUT_LIMIT', 'CLI 输出超过限制');
    this.buffer += this.decoder.write(chunk);
    this.lines();
    requireThat(
      Buffer.byteLength(this.buffer) <= 1024 * 1024,
      'CLI_OUTPUT_LIMIT',
      'CLI 记录超过限制',
    );
  }
  private lines() {
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.parse(line);
    }
  }
  private parse(line: string) {
    requireThat(Buffer.byteLength(line) <= 1024 * 1024, 'CLI_OUTPUT_LIMIT', 'CLI 记录超过限制');
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      throw new AppError('CLI_PROTOCOL_ERROR', 'CLI stdout 不是有效 JSON');
    }
    requireThat(e && typeof e.event === 'string', 'CLI_PROTOCOL_ERROR', 'CLI 事件缺少类型');
    if (e.event === 'init') {
      requireThat(typeof e.conversation_id === 'string', 'CLI_PROTOCOL_ERROR', '缺少 CLI 会话');
      this.conversationId = e.conversation_id;
      this.permissionMode = e.init?.permission_mode;
      this.report({ id: 'init', phase: 'init', state: 'done' });
    }
    if (e.event === 'step_update') {
      requireThat(
        e.step_update && typeof e.step_update.step_type === 'string',
        'CLI_PROTOCOL_ERROR',
        '步骤事件不完整',
      );
      const s = e.step_update;
      const phase: NativeActivity['phase'] =
        s.step_type === 'user_input'
          ? 'input'
          : s.step_type === 'agent_response'
            ? 'response'
            : s.step_type === 'tool'
              ? 'tool'
              : 'processing';
      const stepIndex =
        Number.isSafeInteger(s.step_index) && s.step_index >= 0 ? s.step_index : undefined;
      this.report({
        id: `step-${stepIndex ?? 'unknown'}-${phase}`,
        phase,
        stepIndex,
        state:
          s.state === 'DONE'
            ? 'done'
            : ['FAILED', 'ERROR', 'CANCELLED'].includes(s.state)
              ? 'failed'
              : 'active',
      });
      if (s.step_type === 'agent_response' && s.text_delta !== undefined) {
        requireThat(
          typeof s.text_delta === 'string' && Number.isInteger(s.step_index),
          'CLI_PROTOCOL_ERROR',
          '回答增量不完整',
        );
        this.delta(s.text_delta, s.step_index);
      }
    }
    if (e.event === 'result') {
      requireThat(
        !this.result && typeof e.result?.status === 'string',
        'CLI_PROTOCOL_ERROR',
        '重复或无效的最终结果',
      );
      this.result = e.result;
      this.report({
        id: 'result',
        phase: 'result',
        state: e.result.status === 'SUCCESS' ? 'done' : 'failed',
      });
    }
  }
  end() {
    this.buffer += this.decoder.end();
    this.lines();
    if (this.buffer.trim()) this.parse(this.buffer.trim());
    this.buffer = '';
  }
  finish(code: number | null) {
    requireThat(
      code === 0 && this.result?.status === 'SUCCESS',
      'CLI_FAILED',
      code !== 0 ? 'CLI 非零退出或进程中断' : 'CLI 没有成功的最终结果',
    );
    return this.result!;
  }
}
export function findCli() {
  // The portable launcher validates this user-selected absolute executable path.
  if (process.env.ADAPTIVE_TUTOR_AGY_PATH) {
    const path = process.env.ADAPTIVE_TUTOR_AGY_PATH;
    return isAbsolute(path) && existsSync(path) ? path : undefined;
  }
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const path = join(directory, process.platform === 'win32' ? 'agy.exe' : 'agy');
    if (existsSync(path)) return resolve(path);
  }
  return undefined;
}
export function detectRuntime() {
  const path = findCli();
  if (!path) return { state: 'not_installed', version: null, executable: null };
  const result = spawnSync(path, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    shell: false,
  });
  const version = result.stdout?.trim();
  return {
    state: result.status === 0 && version === '1.2.11' ? 'unchecked' : 'incompatible',
    version: version ?? null,
    executable: path,
  };
}
export function runCli(options: {
  executable: string;
  prompt: string;
  cwd: string;
  timeoutMs: number;
  schemaPath?: string;
  conversationId?: string;
  onDelta?: (text: string, step: number) => void;
  onActivity?: (activity: NativeActivity) => void;
  signal: AbortSignal;
}): Promise<{
  result: NativeResult;
  conversationId?: string;
  permissionMode?: string;
  elapsedMs: number;
}> {
  requireThat(isAbsolute(options.executable), 'CLI_PATH_INVALID', 'CLI 路径必须是绝对路径');
  const args = [
    '--print',
    options.prompt,
    '--output-format',
    'stream-json',
    '--mode',
    'plan',
    '--sandbox',
    '--print-timeout',
    `${Math.ceil(options.timeoutMs / 1000)}s`,
  ];
  if (options.schemaPath) args.push('--json-schema', options.schemaPath);
  if (options.conversationId) args.push('--conversation', options.conversationId);
  requireThat(
    args.reduce((n, a) => n + a.replace(/["\\]/g, '\\$&').length + 3, options.executable.length) <
      24000,
    'CONTEXT_TOO_LARGE',
    'CLI 参数超过安全长度',
  );
  return new Promise((resolvePromise, reject) => {
    const started = performance.now();
    let stopped = false;
    let error: Error | undefined;
    let resultExitTimer: ReturnType<typeof setTimeout> | undefined;
    const stream = new NativeStream(options.onDelta, options.onActivity);
    const child = spawn(options.executable, args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stop = (cause: Error) => {
      if (stopped) return;
      stopped = true;
      error = cause;
      killOwnedProcess(child);
    };
    const abort = () => stop(new AppError('CANCELLED', '任务已取消'));
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    const timeout = setTimeout(
      () => stop(new AppError('CLI_TIMEOUT', 'CLI 运行超时')),
      options.timeoutMs,
    );
    let stderrBytes = 0;
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 1024 * 1024) stop(new AppError('CLI_OUTPUT_LIMIT', 'CLI 诊断输出超限'));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (stopped) return;
      try {
        stream.push(chunk);
        if (stream.result && !resultExitTimer)
          resultExitTimer = setTimeout(
            () => stop(new AppError('CLI_PROTOCOL_ERROR', 'CLI 返回结果后未退出')),
            CLI_EXIT_GRACE_MS,
          );
      } catch (e) {
        stop(e as Error);
      }
    });
    child.on('error', (e) => {
      error = new AppError('CLI_UNAVAILABLE', e.message, 503);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      clearTimeout(resultExitTimer);
      options.signal.removeEventListener('abort', abort);
      if (error) {
        reject(error);
        return;
      }
      try {
        stream.end();
        const result = stream.finish(code);
        resolvePromise({
          result,
          conversationId: result.conversation_id ?? stream.conversationId,
          permissionMode: stream.permissionMode,
          elapsedMs: performance.now() - started,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}
function killOwnedProcess(child: ChildProcess) {
  if (!child.pid) return;
  // /PID scopes termination to the process this application spawned; never kill by image name.
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      shell: false,
      stdio: 'ignore',
    });
    killer.on('error', () => child.kill());
  } else child.kill('SIGKILL');
}
