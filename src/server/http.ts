import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { Store, uuid, now, legacyDatabaseFiles, clearLegacyDatabases } from '../storage/database.js';
import { Courses } from '../domain/courses.js';
import { AppError, requireThat } from '../domain/errors.js';
import { Gateway, type ToolName } from '../mcp/gateway.js';
import { Jobs } from './jobs.js';
import { publicCapabilities, capability, validateParameters } from '../capabilities/registry.js';
import { kinds, id } from '../contracts/v1.js';
import { createGeometryExample } from '../domain/examples.js';
import { createMechanicsExample } from '../domain/paths.js';
import { Remediation } from '../domain/remediation.js';
import { Transfer } from '../transfer/learn.js';
import { frameDocument } from '../code-sandbox/frame.js';
import { mcpRegistrationCommand } from './installation.js';
import { providers, saveAgentConfig, configured } from '../runtime/config.js';

export const secret = () => randomBytes(32).toString('hex');
const commandKey = z.strictObject({ clientRequestId: id });
export function equal(a: string | undefined, b: string) {
  return (
    !!a &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
async function body(req: IncomingMessage, max = 64 * 1024) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new AppError('PAYLOAD_TOO_LARGE', '请求超过大小限制', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('JSON_INVALID', '请求不是有效 JSON', 400);
  }
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
export function createApplication(
  store: Store,
  options: {
    handlePage?: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    dev?: boolean;
  } = {},
) {
  const courses = new Courses(store),
    gateway = new Gateway(store, courses),
    jobs = new Jobs(store, courses),
    transfer = new Transfer(store, courses);
  const mcpToken = secret(),
    browserToken = secret(),
    csrf = secret();
  const bootstraps = new Map<string, number>();
  const eventStreams = new Set<() => void>();
  let origin = '';
  store.maintainEvents();
  const maintenance = setInterval(() => {
    store.maintainEvents();
    for (const [token, expiry] of bootstraps) if (expiry < Date.now()) bootstraps.delete(token);
  }, 3600000);
  maintenance.unref();
  const mintBootstrap = () => {
    const token = secret();
    bootstraps.set(token, Date.now() + 300000);
    return token;
  };
  const server = createServer(async (req, res) => {
    try {
      requireThat(req.headers.host === new URL(origin).host, 'HOST_DENIED', 'Host 不匹配', 403);
      if (req.headers.origin)
        requireThat(req.headers.origin === origin, 'ORIGIN_DENIED', 'Origin 不匹配', 403);
      const url = new URL(req.url ?? '/', origin),
        path = url.pathname;
      const method = req.method ?? 'GET';
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader(
        'Content-Security-Policy',
        `default-src 'self'; script-src 'self' 'unsafe-inline'${options.dev ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'${options.dev ? ' ws:' : ''}; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; worker-src 'self' blob:`,
      );
      if (path === '/internal/mcp') {
        requireThat(
          method === 'POST' &&
            !req.headers.origin &&
            equal(req.headers.authorization, `Bearer ${mcpToken}`),
          'SCOPE_DENIED',
          'MCP 网关认证失败',
          403,
        );
        const p = z
          .strictObject({ name: z.string(), args: z.unknown() })
          .parse(await body(req, 1024 * 1024 + 4096));
        json(res, 200, gateway.call(p.name as ToolName, p.args));
        return;
      }
      if (path === '/api/v1/bootstrap' && method === 'POST') {
        const p = z.strictObject({ token: z.string() }).parse(await body(req));
        const expires = bootstraps.get(p.token);
        requireThat(
          expires && expires > Date.now(),
          'BOOTSTRAP_INVALID',
          '引导链接过期，请从启动器重新打开',
          401,
        );
        bootstraps.delete(p.token);
        res.setHeader(
          'set-cookie',
          `tutor_session=${browserToken}; HttpOnly; SameSite=Strict; Path=/`,
        );
        json(res, 200, { csrf });
        return;
      }
      if (path === '/sandbox' && method === 'GET') {
        res.removeHeader('X-Frame-Options');
        res.setHeader(
          'Content-Security-Policy',
          "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        );
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(frameDocument);
        return;
      }
      if (!path.startsWith('/api/v1/')) {
        if (options.handlePage) {
          await options.handlePage(req, res);
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }
      const cookie = req.headers.cookie
        ?.split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('tutor_session='))
        ?.slice(14);
      requireThat(
        equal(cookie, browserToken),
        'SESSION_REQUIRED',
        '请使用本地启动器提供的链接打开应用',
        401,
      );
      if (!['GET', 'HEAD'].includes(method))
        requireThat(
          equal(
            typeof req.headers['x-csrf-token'] === 'string'
              ? req.headers['x-csrf-token']
              : undefined,
            csrf,
          ),
          'CSRF_DENIED',
          '请求缺少本地 CSRF 凭证',
          403,
        );
      const route = path.slice('/api/v1'.length);
      if (legacyDatabaseFiles(store.root).length && !['/session', '/runtime', '/runtime/config', '/data/reset/status', '/data/reset'].includes(route))
        throw new AppError('DATA_RESET_REQUIRED', '请先确认清除旧版本数据', 409);
      if (route === '/session' && method === 'GET') {
        json(res, 200, { csrf });
        return;
      }
      if (route === '/runtime' && method === 'GET') {
        const { executable, ...r } = jobs.runtime;
        json(res, 200, {
          ...r,
          executableName: executable ? 'agy' : null,
          probe:
            store
              .list('job')
              .filter((j) => j.kind === 'probe')
              .at(-1)?.resultRef ?? null,
          mcpRegistration: mcpRegistrationCommand(executable ?? undefined),
          apiConfigured: configured(jobs.config),
          provider: jobs.config.provider,
          showModelOutput: jobs.config.showModelOutput,
          dataResetRequired: legacyDatabaseFiles(store.root).length > 0,
        });
        return;
      }
      if (route === '/runtime/config' && method === 'GET') {
        json(res, 200, {
          chatRuntime: jobs.config.chatRuntime,
          generationRuntime: jobs.config.generationRuntime,
          provider: jobs.config.provider,
          showModelOutput: jobs.config.showModelOutput,
          apiSetupSkipped: jobs.config.apiSetupSkipped,
          providers: Object.fromEntries(providers.map((name) => [name, {
            configured: !!jobs.config.providers[name],
            model: jobs.config.providers[name]?.model ?? null,
          }])),
          configured: configured(jobs.config),
          setupRequired: !configured(jobs.config) && !jobs.config.apiSetupSkipped,
        });
        return;
      }
      if (route === '/runtime/config' && method === 'PUT') {
        const p = z.strictObject({
          clientRequestId: id,
          chatRuntime: z.enum(['api', 'antigravity']).optional(),
          generationRuntime: z.enum(['api', 'antigravity']).optional(),
          provider: z.enum(providers).optional(),
          showModelOutput: z.boolean().optional(),
          apiSetupSkipped: z.boolean().optional(),
          providerConfig: z.strictObject({
            provider: z.enum(providers), model: z.string().min(1).max(200), apiKey: z.string().min(1).max(1000).optional(), baseUrl: z.string().url().optional(),
          }).optional(),
        }).parse(await body(req));
        const next = saveAgentConfig(store.root, {
          chatRuntime: p.chatRuntime,
          generationRuntime: p.generationRuntime,
          provider: p.provider,
          showModelOutput: p.showModelOutput,
          apiSetupSkipped: p.providerConfig ? false : p.apiSetupSkipped,
          providers: p.providerConfig ? { [p.providerConfig.provider]: { model: p.providerConfig.model, apiKey: p.providerConfig.apiKey ?? jobs.config.providers[p.providerConfig.provider]?.apiKey ?? '', baseUrl: p.providerConfig.baseUrl } } : undefined,
        });
        jobs.updateConfig(next);
        json(res, 200, { configured: configured(next), apiSetupSkipped: next.apiSetupSkipped, provider: next.provider, showModelOutput: next.showModelOutput });
        return;
      }
      if (route === '/data/reset/status' && method === 'GET') {
        json(res, 200, { required: legacyDatabaseFiles(store.root).length > 0 });
        return;
      }
      if (route === '/data/reset' && method === 'POST') {
        const p = z.strictObject({ clientRequestId: id, confirm: z.literal(true) }).parse(await body(req));
        clearLegacyDatabases(store.root);
        json(res, 200, store.command('data.reset', p.clientRequestId, p, () => ({ cleared: true })));
        return;
      }
      if (route === '/capabilities' && method === 'GET') {
        json(res, 200, publicCapabilities());
        return;
      }
      if (route === '/examples/geometry' && method === 'POST') {
        const p = commandKey.parse(await body(req));
        json(res, 201, createGeometryExample(courses, p.clientRequestId));
        return;
      }
      if (route === '/examples/mechanics' && method === 'POST') {
        const p = commandKey.parse(await body(req));
        json(res, 201, createMechanicsExample(courses, p.clientRequestId));
        return;
      }
      if (route === '/runtime/probe' && method === 'POST') {
        const p = commandKey.parse(await body(req));
        json(
          res,
          202,
          store.command('probe', p.clientRequestId, p, () => jobs.enqueue('probe', {})),
        );
        return;
      }
      if (route === '/courses' && method === 'GET') {
        json(res, 200, store.list('course'));
        return;
      }
      if (route === '/courses' && method === 'POST') {
        json(res, 201, courses.create(await body(req)));
        return;
      }
      const parts = route.split('/').filter(Boolean);
      if (parts[0] === 'code-runtimes' && method === 'GET') {
        const language = z.enum(['javascript', 'python', 'sql']).parse(parts[1]);
        const allowed =
          language === 'javascript'
            ? ['worker.js', 'quickjs.wasm']
            : language === 'sql'
              ? ['worker.js', 'sql.wasm']
              : [
                  'worker.js',
                  'pyodide.asm.js',
                  'pyodide.asm.wasm',
                  'python_stdlib.zip',
                  'pyodide-lock.json',
                ];
        const directory = fileURLToPath(new URL('../../.runtime-build/', import.meta.url));
        requireThat(
          existsSync(join(directory, 'manifest.json')),
          'CAPABILITY_UNAVAILABLE',
          '请先构建运行库',
          503,
        );
        const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
        if (language === 'python')
          for (const name of Object.keys(manifest))
            if (/^numpy-[\w.-]+\.whl$/.test(name)) allowed.push(name);
        if (parts.length === 2) {
          json(res, 200, { language, files: allowed.map((name) => ({ name, ...manifest[name] })) });
          return;
        }
        requireThat(
          parts.length === 3 && allowed.includes(parts[2]),
          'SCOPE_DENIED',
          '运行库文件未注册',
          403,
        );
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'cache-control': 'private, max-age=3600',
        });
        await pipeline(createReadStream(join(directory, parts[2])), res);
        return;
      }
      if (route === '/imports/validate' && method === 'POST') {
        requireThat(
          req.headers['content-type'] === 'application/octet-stream',
          'CONTENT_TYPE',
          '请上传 .learn 文件二进制数据',
          400,
        );
        id.parse(req.headers['x-client-request-id']);
        const temporary = join(store.root, 'imports', uuid() + '.upload');
        let size = 0;
        try {
          await pipeline(
            req,
            new Transform({
              transform(chunk, encoding, done) {
                size += chunk.length;
                if (size > 100 * 1024 * 1024)
                  done(new AppError('ZIP_LIMIT', '压缩文件超过 100 MiB', 413));
                else done(null, chunk);
              },
            }),
            createWriteStream(temporary, { flags: 'wx' }),
          );
          json(res, 200, await transfer.validate(temporary));
        } finally {
          rmSync(temporary, { force: true });
        }
        return;
      }
      if (parts[0] === 'imports' && parts[2] === 'commit' && method === 'POST') {
        const p = z
          .strictObject({ clientRequestId: id, mode: z.enum(['fresh', 'restore_copy']) })
          .parse(await body(req));
        json(
          res,
          201,
          store.command('import:' + parts[1], p.clientRequestId, p, () =>
            transfer.commit(parts[1], p.mode),
          ),
        );
        return;
      }
      if (parts[0] === 'exports' && parts.length === 2 && method === 'GET') {
        const e = store.must('export', parts[1]);
        requireThat(/^[a-f0-9-]+\.(learn|md)$/.test(e.path), 'EXPORT_INVALID', '导出路径无效');
        res.writeHead(200, {
          'content-type':
            e.format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/octet-stream',
          'content-disposition': `attachment; filename="course.${e.format === 'markdown' ? 'md' : 'learn'}"`,
        });
        await pipeline(createReadStream(join(store.root, 'exports', e.path)), res);
        return;
      }
      if (parts[0] === 'courses' && parts.length >= 2) {
        const courseId = parts[1];
        if (parts.length === 2 && method === 'DELETE') {
          const p = z
            .strictObject({
              clientRequestId: id,
              expectedRevision: z.number().int().positive(),
              confirm: z.literal(true),
            })
            .parse(await body(req));
          json(
            res,
            200,
            store.command('course.delete:' + courseId, p.clientRequestId, p, () => {
              courses.revision(courseId, p.expectedRevision);
              requireThat(
                !store
                  .list('job', courseId)
                  .some((j) => ['queued', 'running', 'validating'].includes(j.state)),
                'COURSE_BUSY',
                '请先取消当前课程的活动任务',
                409,
              );
              store.deleteCourse(courseId);
              return { deleted: true, courseId };
            }),
          );
          return;
        }
        store.must('course', courseId);
        if (parts[2] === 'exports' && method === 'POST') {
          const p = z
            .strictObject({
              clientRequestId: id,
              mode: z.enum(['content', 'backup']),
              format: z.enum(['learn', 'markdown']),
            })
            .parse(await body(req));
          json(res, 201, await transfer.export(courseId, p.mode, p.format, p.clientRequestId));
          return;
        }
        if (parts.length === 2 && method === 'PATCH') {
          const p = z
            .strictObject({
              clientRequestId: id,
              expectedRevision: z.number().int(),
              title: z.string().min(1).max(200).optional(),
              status: z.enum(['active', 'archived']).optional(),
            })
            .parse(await body(req));
          json(
            res,
            200,
            store.command('course.update:' + courseId, p.clientRequestId, p, () => {
              const c = courses.revision(courseId, p.expectedRevision);
              const result = store.put('course', {
                ...c,
                ...(p.title ? { title: p.title } : {}),
                ...(p.status ? { status: p.status } : {}),
                revision: c.revision + 1,
              });
              store.emit('course.updated', { revision: result.revision }, courseId);
              return result;
            }),
          );
          return;
        }
        if (parts[2] === 'snapshot' && method === 'GET') {
          json(
            res,
            200,
            courses.snapshot(courseId, url.searchParams.get('sessionId') ?? undefined),
          );
          return;
        }
        if (parts[2] === 'sessions' && method === 'POST') {
          const p = commandKey.parse(await body(req));
          json(
            res,
            201,
            store.command('session.create:' + courseId, p.clientRequestId, p, () =>
              store.put('session', {
                id: uuid(),
                courseId,
                status: 'active',
                providerBindingValid: false,
                createdAt: now(),
              }),
            ),
          );
          return;
        }
        if (parts[2] === 'sessions' && method === 'GET') {
          json(
            res,
            200,
            store.list('session', courseId).map(({ providerConversationId, ...s }) => s),
          );
          return;
        }
        if (parts[2] === 'jobs' && method === 'POST') {
          const p = z
            .strictObject({
              clientRequestId: id,
              expectedRevision: z.number().int().positive(),
              kind: z.enum(kinds),
              payload: z.record(z.string(), z.unknown()),
            })
            .parse(await body(req));
          const shape =
              p.kind === 'plan_course'
              ? z.strictObject({ extraPrompt: z.string().max(4000).optional(), regenerate: z.boolean().optional(), confirm: z.literal(true).optional() })
              : p.kind === 'diagnose'
                ? z.strictObject({ nodeId: id, attemptIds: z.array(id).min(1).max(20) })
                : p.kind === 'generate_exercises'
                  ? z.strictObject({ nodeId: id, cycleId: id, objectiveId: id })
                : z.strictObject({
                      nodeId: id,
                      lessonVersion: z.number().int().nonnegative().optional(),
                      extraPrompt: z.string().max(4000).optional(),
                      regenerate: z.boolean().optional(), confirm: z.literal(true).optional(),
                    });
          const payload = shape.parse(p.payload) as any;
          json(
            res,
            202,
            store.command('job.create:' + courseId, p.clientRequestId, p, () => {
              courses.revision(courseId, p.expectedRevision);
              const active = store.list<any>('job', courseId).some((j) => ['queued', 'running', 'validating'].includes(j.state));
              requireThat(!active || !payload.regenerate, 'COURSE_BUSY', '请先停止当前任务', 409);
              if (payload.regenerate) jobs.assertCourseIdle(courseId);
              if (payload.nodeId)
                requireThat(
                  store.must('node', payload.nodeId).courseId === courseId,
                  'SCOPE_DENIED',
                  '节点不属于课程',
                  403,
                );
              if (payload.regenerate) {
                requireThat(payload.confirm === true, 'CONFIRM_REQUIRED', '请确认破坏性操作', 400);
                if (p.kind === 'plan_course') courses.resetOutline(courseId);
                else courses.resetNode(payload.nodeId);
              }
              if (payload.attemptIds)
                for (const a of payload.attemptIds)
                  requireThat(
                    store.must('attempt', a).nodeId === payload.nodeId,
                    'SCOPE_DENIED',
                    '作答不属于目标节点',
                    403,
                  );
              if (payload.extraPrompt) {
                if (p.kind === 'plan_course') store.put('course', { ...store.must('course', courseId), lastOutlinePrompt: payload.extraPrompt });
                else store.put('node', { ...store.must('node', payload.nodeId), lastLessonPrompt: payload.extraPrompt });
              }
              return jobs.enqueue(p.kind, payload, courseId);
            }),
          );
          return;
        }
        if (parts[2] === 'drafts' && parts[4] === 'publish' && method === 'POST') {
          const p = z
            .strictObject({ clientRequestId: id, expectedRevision: z.number().int().positive() })
            .parse(await body(req));
          json(
            res,
            200,
            store.command(
              'publish:' + courseId,
              p.clientRequestId,
              { ...p, draftId: parts[3] },
              () => {
                const d = store.must('draft', parts[3]);
                requireThat(
                  d.courseId === courseId && d.status === 'pending',
                  'DRAFT_INVALID',
                  '草稿不可发布',
                  409,
                );
                courses.revision(courseId, p.expectedRevision);
                requireThat(
                  d.baseRevision === p.expectedRevision,
                  'VERSION_CONFLICT',
                  '草稿基于旧版本',
                  409,
                );
                let result;
                if (d.kind === 'plan_course')
                  result = courses.publishPlan(courseId, p.expectedRevision, d.payload);
                else {
                  result = courses.publishLesson(d.nodeId, d.payload);
                  const c = store.must('course', courseId);
                  store.put('course', { ...c, revision: c.revision + 1 });
                  store.emit(
                    'course.updated',
                    { revision: c.revision + 1, changedNodeIds: [d.nodeId] },
                    courseId,
                  );
                }
                store.put('draft', { ...d, status: 'published' });
                return result;
              },
            ),
          );
          return;
        }
        if (parts[2] === 'nodes' && parts[4] === 'lesson' && method === 'GET') {
          requireThat(
            store.must('node', parts[3]).courseId === courseId,
            'SCOPE_DENIED',
            '节点不属于课程',
            403,
          );
          json(
            res,
            200,
            courses.lesson(
              parts[3],
              url.searchParams.has('version')
                ? z.coerce.number().int().positive().parse(url.searchParams.get('version'))
                : undefined,
            ),
          );
          return;
        }
      }
      if (parts[0] === 'sessions' && parts[2] === 'clear' && method === 'POST') {
        const p = z
          .strictObject({ clientRequestId: id, confirm: z.literal(true) })
          .parse(await body(req));
        json(
          res,
          200,
          store.command('session.clear:' + parts[1], p.clientRequestId, p, () =>
            jobs.clearSession(parts[1]),
          ),
        );
        return;
      }
      if (parts[0] === 'sessions' && parts[2] === 'turns' && method === 'POST') {
        const p = await body(req);
        const key = id.parse(p.clientRequestId);
        json(
          res,
          202,
          store.command('turn:' + parts[1], key, p, () => jobs.ask(parts[1], p)),
        );
        return;
      }
      if (parts[0] === 'jobs') {
        if (parts.length === 2 && method === 'GET') {
          const { payload, ...j } = store.must('job', parts[1]);
          json(res, 200, j);
          return;
        }
        if (parts[2] === 'cancel' && method === 'POST') {
          commandKey.parse(await body(req));
          json(res, 200, jobs.cancel(parts[1]));
          return;
        }
      }
      if (parts[0] === 'nodes') {
        const nodeId = parts[1],
          n = store.must('node', nodeId);
        if (parts[2] === 'progress-actions' && method === 'POST') {
          const p = z
            .strictObject({
              clientRequestId: id,
              action: z.enum(['start', 'review', 'bypass', 'revoke_bypass']),
              reason: z.string().max(2000).optional(),
            })
            .parse(await body(req));
          json(
            res,
            200,
            store.command('progress:' + nodeId, p.clientRequestId, p, () =>
              courses.start(nodeId, p.action),
            ),
          );
          return;
        }
        if (parts[2] === 'assignments' && method === 'POST') {
          const p = z
            .strictObject({ clientRequestId: id, cycleId: id, objectiveId: id })
            .parse(await body(req));
          json(
            res,
            201,
            store.command('assign:' + nodeId, p.clientRequestId, p, () =>
              courses.assign(nodeId, p.cycleId, p.objectiveId),
            ),
          );
          return;
        }
        if (parts[2] === 'notes' && method === 'PUT') {
          const p = z
            .strictObject({
              clientRequestId: id,
              expectedNoteVersion: z.number().int().nonnegative(),
              text: z.string().max(60000),
            })
            .parse(await body(req));
          json(
            res,
            200,
            store.command('note:' + nodeId, p.clientRequestId, p, () => {
              const old = store.get('note', nodeId);
              requireThat(
                (old?.version ?? 0) === p.expectedNoteVersion,
                'VERSION_CONFLICT',
                '笔记版本冲突',
                409,
              );
              return store.put('note', {
                id: nodeId,
                courseId: n.courseId,
                text: p.text,
                version: p.expectedNoteVersion + 1,
                updatedAt: now(),
              });
            }),
          );
          return;
        }
        if (parts[2] === 'demo-snapshots' && method === 'GET') {
          json(res, 200, store.list('demo_snapshot', n.courseId, nodeId));
          return;
        }
        if (parts[2] === 'demo-snapshots' && method === 'POST') {
          const p = z
            .strictObject({
              clientRequestId: id,
              lessonVersion: z.number().int().positive(),
              blockId: id,
              templateId: id,
              templateVersion: z.number().int().positive(),
              parameters: z.record(z.string(), z.number().finite()),
              selectedIds: z.array(id).max(100),
              step: z.number().int().min(0).max(100).optional(),
            })
            .parse(await body(req));
          json(
            res,
            201,
            store.command('demo.snapshot:' + nodeId, p.clientRequestId, p, () => {
              const l = store.must('lesson', nodeId + ':' + p.lessonVersion),
                b = l.document.blocks.find((b: any) => b.blockId === p.blockId);
              requireThat(
                b?.templateId === p.templateId && b.templateVersion === p.templateVersion,
                'CONTEXT_STALE',
                '模板与正文版本不一致',
                409,
              );
              const c = capability(p.templateId, p.templateVersion),
                parameters = validateParameters(c, p.parameters),
                result = c.compute(parameters, p.step ?? 0);
              requireThat(
                p.selectedIds.every((id) => result.atoms?.some((a) => a.id === id)),
                'CONTEXT_STALE',
                '所选对象不属于当前实验',
              );
              const { clientRequestId, ...state } = p;
              return store.put(
                'demo_snapshot',
                {
                  id: uuid(),
                  courseId: n.courseId,
                  nodeId,
                  stateSchemaVersion: 1,
                  ...state,
                  summary: result.values,
                  artifactRefs: [],
                  createdAt: now(),
                },
                nodeId,
              );
            }),
          );
          return;
        }
      }
      if (parts[0] === 'assignments' && method === 'POST') {
        if (parts[2] === 'attempts') {
          const p = z
            .strictObject({ clientRequestId: id, answer: z.unknown() })
            .parse(await body(req));
          const result = store.command('attempt:' + parts[1], p.clientRequestId, p, () =>
            courses.attempt(parts[1], p.clientRequestId, p.answer),
          );
          json(res, 201, result);
          if (result.diagnosisState === 'pending' && jobs.runtime.state === 'ready') {
            try {
              store.transaction(() => jobs.queueDiagnosis(result.attemptId));
            } catch {
              /* The committed answer survives a full queue or unavailable runtime. */
            }
          }
          return;
        }
        if (parts[2] === 'reveal') {
          const p = z
            .strictObject({ clientRequestId: id, kind: z.enum(['hint', 'solution']) })
            .parse(await body(req));
          json(
            res,
            200,
            store.command('reveal:' + parts[1], p.clientRequestId, p, () =>
              courses.reveal(parts[1], p.kind),
            ),
          );
          return;
        }
      }
      if (parts[0] === 'attempts' && parts[2] === 'invalidate' && method === 'POST') {
        const p = z
          .strictObject({ clientRequestId: id, reason: z.string().min(1).max(2000) })
          .parse(await body(req));
        json(
          res,
          200,
          store.command('invalidate:' + parts[1], p.clientRequestId, p, () =>
            courses.invalidate(parts[1], p.reason),
          ),
        );
        return;
      }
      if (parts[0] === 'attempts' && parts[2] === 'diagnose' && method === 'POST') {
        const p = commandKey.parse(await body(req));
        json(
          res,
          202,
          store.command('diagnose:' + parts[1], p.clientRequestId, p, () =>
            jobs.queueDiagnosis(parts[1]),
          ),
        );
        return;
      }
      if (parts[0] === 'patches' && parts[2] === 'revert' && method === 'POST') {
        const p = z
          .strictObject({ clientRequestId: id, expectedRevision: z.number().int().positive() })
          .parse(await body(req));
        json(
          res,
          200,
          store.command('patch.revert:' + parts[1], p.clientRequestId, p, () =>
            new Remediation(store, courses).revert(parts[1], p.expectedRevision),
          ),
        );
        return;
      }
      if (route === '/events' && method === 'GET') {
        const courseId = id.parse(url.searchParams.get('courseId')),
          sessionId = url.searchParams.get('sessionId') ?? undefined;
        store.must('course', courseId);
        if (sessionId)
          requireThat(
            store.must('session', sessionId).courseId === courseId,
            'SCOPE_DENIED',
            '会话不属于课程',
            403,
          );
        let cursor = z.coerce
          .number()
          .int()
          .nonnegative()
          .parse(url.searchParams.get('after') ?? '0');
        requireThat(
          cursor >= store.eventFloor(courseId),
          'EVENT_CURSOR_EXPIRED',
          '事件游标已过期，请重新加载快照',
          409,
        );
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        const poll = () => {
          for (const e of store.events(courseId, sessionId, cursor)) {
            if (res.writableLength > 1024 * 1024) {
              res.end();
              return;
            }
            res.write(`id: ${e.eventId}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
            cursor = Number(e.eventId);
          }
        };
        poll();
        const timer = setInterval(poll, 200),
          heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        const cleanup = () => {
          clearInterval(timer);
          clearInterval(heartbeat);
          eventStreams.delete(cleanup);
        };
        eventStreams.add(cleanup);
        res.on('close', cleanup);
        return;
      }
      throw new AppError('NOT_FOUND', '接口不存在', 404);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof z.ZodError) {
        json(res, 400, {
          error: {
            code: 'INPUT_INVALID',
            message: '输入不符合接口约束',
            retryable: false,
            details: error.issues.map((i) => ({ path: i.path, message: i.message })),
          },
        });
        return;
      }
      const e =
        error instanceof AppError ? error : new AppError('INTERNAL_ERROR', '应用处理失败', 500);
      json(res, e.status, {
        error: { code: e.code, message: e.message, retryable: false, details: e.details },
      });
    }
  });
  return {
    server,
    courses,
    jobs,
    gateway,
    mcpToken,
    mintBootstrap,
    get origin() {
      return origin;
    },
    listen: () =>
      new Promise<string>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (!address || typeof address === 'string') return reject(new Error('No listener'));
          origin = `http://127.0.0.1:${address.port}`;
          resolve(origin);
        });
      }),
    close: async () => {
      clearInterval(maintenance);
      // Socket close events can arrive after server.close() resolves.
      // Stop database polling before callers are allowed to close the store.
      for (const cleanup of eventStreams) cleanup();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      try {
        await jobs.close();
      } finally {
        await closed;
      }
    },
  };
}
