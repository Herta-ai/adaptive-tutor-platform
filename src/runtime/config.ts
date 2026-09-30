import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { join } from 'node:path';

export const providers = ['openai', 'anthropic', 'google', 'deepseek'] as const;
export type ProviderId = (typeof providers)[number];
export type RuntimeKind = 'api' | 'antigravity';
export interface ProviderConfig {
  model: string;
  apiKey: string;
  baseUrl?: string;
}
export interface AgentConfig {
  chatRuntime: RuntimeKind;
  generationRuntime: RuntimeKind;
  provider: ProviderId;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  showModelOutput: boolean;
}
const defaults: AgentConfig = {
  chatRuntime: 'api',
  generationRuntime: 'api',
  provider: 'openai',
  providers: {},
  showModelOutput: true,
};
const schema = z.object({
  chatRuntime: z.enum(['api', 'antigravity']), generationRuntime: z.enum(['api', 'antigravity']),
  provider: z.enum(providers), showModelOutput: z.boolean(),
  providers: z.partialRecord(z.enum(providers), z.object({ model: z.string().trim().min(1).max(200), apiKey: z.string().trim().min(1).max(1000), baseUrl: z.url().optional() })),
});
export function configPath(root: string) {
  return join(root, 'runtime', 'agent-config.json');
}
export function loadAgentConfig(root: string): AgentConfig {
  try {
    return schema.parse(JSON.parse(readFileSync(configPath(root), 'utf8')));
  } catch {
    return { ...defaults };
  }
}
export function configured(config: AgentConfig) {
  const p = config.providers[config.provider];
  return !!p?.model?.trim() && !!p?.apiKey?.trim();
}
export function saveAgentConfig(root: string, patch: Partial<AgentConfig>) {
  mkdirSync(join(root, 'runtime'), { recursive: true });
  const current = loadAgentConfig(root);
  const next = schema.parse({
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    providers: { ...current.providers, ...(patch.providers ?? {}) },
  });
  const directory = join(root, 'runtime');
  if (process.platform === 'win32') {
    const sid = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).stdout?.match(/S-1-5-[0-9-]+/)?.[0];
    if (!sid || spawnSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true, stdio: 'pipe' }).status !== 0)
      throw new Error('无法保护模型配置目录');
  } else chmodSync(directory, 0o700);
  const temporary = configPath(root) + '.tmp';
  writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(temporary, configPath(root));
  return next;
}
