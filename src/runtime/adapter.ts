import { runCli, type NativeActivity } from './antigravity.js';
import { runApi, type ApiRunOptions } from './api-harness.js';

export type AgentRunRequest = ApiRunOptions & { executable?: string; cwd: string; schemaPath?: string; conversationId?: string };
export type AgentActivity = NativeActivity & { label?: string };
export interface AgentRunResult {
  result: { status: string; response?: string; structured_output?: unknown };
  conversationId?: string; permissionMode?: string; elapsedMs: number;
}
export interface AgentRuntime {
  kind: 'api' | 'antigravity';
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
export class AntigravityRuntime implements AgentRuntime {
  readonly kind = 'antigravity';
  run(request: AgentRunRequest) { return runCli({ ...request, executable: request.executable! }); }
}
export class ApiHarnessRuntime implements AgentRuntime {
  readonly kind = 'api';
  async run(request: AgentRunRequest) {
    const output = await runApi(request);
    return { result: { status: 'SUCCESS', response: output.response, structured_output: output.structured_output }, elapsedMs: output.elapsedMs };
  }
}
export const runtimes: Record<AgentRuntime['kind'], AgentRuntime> = { api: new ApiHarnessRuntime(), antigravity: new AntigravityRuntime() };
