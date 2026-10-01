import { streamText, tool, stepCountIs, type ToolSet } from 'ai';
import { z } from 'zod';
import { receipt } from '../contracts/v1.js';
import { Gateway, toolSchemas, type ToolName } from '../mcp/gateway.js';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { AppError, requireThat } from '../domain/errors.js';
import type { AgentConfig, ProviderId } from './config.js';

export interface ApiRunOptions {
  config: AgentConfig;
  prompt: string;
  kind: 'chat' | string;
  timeoutMs: number;
  signal: AbortSignal;
  gateway?: Gateway;
  scopeId?: string;
  onPreview?: (text: string) => void;
  onDelta?: (text: string) => void;
  onActivity?: (activity: { id: string; phase: string; state: string; label?: string; stepIndex?: number }) => void;
}

function modelFor(provider: ProviderId, config: AgentConfig) {
  const settings = config.providers[provider];
  requireThat(settings?.apiKey && settings.model, 'API_NOT_CONFIGURED', '请先配置 API 供应商和模型', 503);
  if (provider === 'openai') return createOpenAI({ apiKey: settings.apiKey, baseURL: settings.baseUrl })(settings.model);
  if (provider === 'anthropic') return createAnthropic({ apiKey: settings.apiKey, baseURL: settings.baseUrl })(settings.model);
  if (provider === 'google') return createGoogleGenerativeAI({ apiKey: settings.apiKey, baseURL: settings.baseUrl })(settings.model);
  return createDeepSeek({ apiKey: settings.apiKey, baseURL: settings.baseUrl })(settings.model);
}

export async function runApi(options: ApiRunOptions) {
  const started = performance.now();
  const provider = options.config.provider;
  options.onActivity?.({ id: 'api-connect', phase: 'init', state: 'done', label: '已连接 API' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const abort = () => controller.abort();
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  let text = '';
  let finalReceipt: z.infer<typeof receipt> | undefined;
  try {
    const tools: ToolSet = {};
    if (options.gateway && options.scopeId) {
      const scope = options.gateway.store.must('scope', options.scopeId);
      for (const name of scope.allowedTools as ToolName[]) {
        tools[name] = tool({
          description: name === 'save_generation_draft' ? 'Validate and save the completed draft. Return its receipt using finish_generation.' : 'Read scoped course context.',
          inputSchema: (toolSchemas as any)[name].omit({ scopeId: true }),
          execute: async (args, { toolCallId }) => {
            controller.signal.throwIfAborted();
            options.onActivity?.({ id: toolCallId, phase: 'tool', state: 'active', label: name });
            try {
              const output = options.gateway!.call(name, { ...args, scopeId: options.scopeId });
              options.onActivity?.({ id: toolCallId, phase: 'tool', state: 'done', label: name });
              if (name === 'save_generation_draft') {
                const payload = options.gateway!.store.must('draft', output.draftId).payload;
                options.onPreview?.(draftPreview(payload));
              }
              return output;
            } catch (error) {
              options.onActivity?.({ id: toolCallId, phase: 'tool', state: 'failed', label: name });
              return { error: error instanceof AppError ? error.code : 'CONTENT_INVALID', message: error instanceof z.ZodError ? error.issues.map(i => ({ path: i.path, message: i.message })) : '工具校验失败' };
            }
          },
        });
      }
      tools.finish_generation = tool({
        description: 'Finish generation by returning the exact receipt of a saved draft.',
        inputSchema: receipt,
        execute: async (input) => { controller.signal.throwIfAborted(); finalReceipt = input; return { received: true }; },
      });
    }
    options.onActivity?.({ id: 'api-response', phase: 'response', state: 'active', label: '模型生成中' });
    const result = streamText({
      model: modelFor(provider, options.config),
      prompt: options.prompt + (options.scopeId ? '\nUse the provided course tools. Tool scope is injected by the application. End with finish_generation using the exact saved draft receipt.' : ''),
      tools,
      stopWhen: [stepCountIs(12), () => !!finalReceipt],
      maxRetries: 0,
      abortSignal: controller.signal,
      maxOutputTokens: options.kind === 'chat' ? 4000 : 12000,
    });
    for await (const part of result.fullStream) {
      controller.signal.throwIfAborted();
      if (part.type === 'error') throw part.error;
      if (part.type === 'text-delta') {
        text += part.text;
        requireThat(text.length <= 200000, 'API_OUTPUT_LIMIT', '模型输出超过限制');
        options.onDelta?.(part.text);
      }
    }
    controller.signal.throwIfAborted();
    if (options.scopeId) requireThat(finalReceipt, 'RECEIPT_INVALID', '生成未返回有效回执，或已达到步骤上限');
    options.onActivity?.({ id: 'api-response', phase: 'response', state: 'done', label: '模型回复完成' });
    return { response: text, structured_output: finalReceipt, elapsedMs: performance.now() - started };
  } catch (error) {
    if (options.signal.aborted)
      throw new AppError('CANCELLED', '任务已取消');
    if (controller.signal.aborted) throw new AppError('API_TIMEOUT', 'API 调用超时');
    if (error instanceof AppError) throw error;
    throw new AppError('API_FAILED', 'API 调用失败，请检查供应商配置、额度和网络', 503);
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', abort);
  }
}

export function draftPreview(value: any): string {
  return [value.title ? `# ${value.title}` : '', value.summary ?? '',
    ...(value.nodes ?? []).map((n: any, i: number) => `${i + 1}. ${n.title}`),
    ...(value.blocks ?? []).filter((b: any) => b.type === 'markdown').map((b: any) => b.text),
    ...(value.exercises ?? []).map((e: any, i: number) => `${i + 1}. ${e.prompt}`),
    value.explanation ?? ''].filter(Boolean).join('\n\n').slice(0, 32000);
}
