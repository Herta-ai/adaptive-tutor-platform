import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { z } from 'zod';
import { Store, uuid, now } from '../storage/database.js';
import { Courses } from '../domain/courses.js';
import { validateLesson } from '../domain/content.js';
import { assertDag } from '../domain/assessment.js';
import { requireThat } from '../domain/errors.js';
import { capability } from '../capabilities/registry.js';
import { portableCourse, validatePersonal, validateExerciseBank } from './validation.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const jsonBuffer = (v: unknown) => Buffer.from(JSON.stringify(v));
const manifestSchema = z.strictObject({
  format: z.literal('adaptive-tutor-learn'),
  formatVersion: z.literal('1.0'),
  exportMode: z.enum(['content', 'backup']),
  exportedAt: z.string(),
  sourceCourseRevision: z.number().int().positive(),
  title: z.string(),
  files: z
    .array(
      z.strictObject({
        path: z.string(),
        size: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        mime: z.string(),
      }),
    )
    .max(9999),
  generatedNodeKeys: z.array(z.string()),
  notGeneratedNodeKeys: z.array(z.string()),
  requiredCapabilities: z.array(
    z.strictObject({ capabilityId: z.string(), version: z.number().int().positive() }),
  ),
});
export function safeEntry(name: string) {
  requireThat(
    name.length > 0 &&
      name.length <= 500 &&
      !name.startsWith('/') &&
      !name.includes('\\') &&
      !name.includes(':') &&
      !name.includes('\0') &&
      !name
        .split('/')
        .some(
          (p) =>
            p === '..' ||
            p === '.' ||
            !p ||
            /[. ]$/.test(p) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
        ),
    'ZIP_PATH',
    '课程包包含不安全路径',
  );
  return name.normalize('NFC').toLowerCase();
}
const backupKinds = [
  'progress',
  'cycle',
  'assignment',
  'attempt',
  'diagnosis',
  'patch',
  'note',
  'session',
  'message',
  'context',
  'demo_snapshot',
] as const;
export class Transfer {
  private inflight = new Map<string, Promise<{ exportId: string; downloadUrl: string }>>();
  constructor(
    readonly store: Store,
    readonly courses: Courses,
  ) {}
  export(
    courseId: string,
    mode: 'content' | 'backup',
    format: 'learn' | 'markdown',
    clientRequestId: string = uuid(),
  ) {
    const reservation = this.store.command(
      'export.reserve:' + courseId,
      clientRequestId,
      { mode, format },
      () => ({ exportId: uuid() }),
    );
    const id = reservation.exportId;
    if (this.store.get('export', id))
      return Promise.resolve({ exportId: id, downloadUrl: '/api/v1/exports/' + id });
    if (this.inflight.has(id)) return this.inflight.get(id)!;
    const task = this.buildExport(courseId, mode, format, id).finally(() =>
      this.inflight.delete(id),
    );
    this.inflight.set(id, task);
    return task;
  }
  private async buildExport(
    courseId: string,
    mode: 'content' | 'backup',
    format: 'learn' | 'markdown',
    exportId: string,
  ) {
    const files = new Map<string, Buffer>();
    const snapshot = this.store.transaction(() => {
      const course = this.store.must('course', courseId),
        nodes = this.store.list('node', courseId),
        edges = this.store.list('edge', courseId),
        lessons = this.store.list('lesson', courseId),
        concepts = this.store.list('concept', courseId);
      return {
        course,
        nodes,
        edges,
        lessons,
        concepts,
        exercises: this.store.list('exercise', courseId),
        personal:
          mode === 'backup'
            ? Object.fromEntries(
                backupKinds.map((kind) => [
                  kind,
                  this.store.list(kind, courseId).map((row) => {
                    const { providerConversationId, ...v } = row;
                    return kind === 'session' ? { ...v, providerBindingValid: false } : v;
                  }),
                ]),
              )
            : {},
      };
    });
    const { course, nodes, lessons, concepts } = snapshot;
    if (format === 'markdown') {
      const sections = [`# ${course.title}`];
      for (const n of nodes) {
        sections.push(`## ${n.title}`);
        const l = lessons.find((l) => l.nodeId === n.id && l.version === n.currentLessonVersion);
        if (!l) {
          sections.push('本节尚未生成。');
          continue;
        }
        for (const b of l.document.blocks) {
          if (b.type === 'markdown') sections.push(b.text);
          else if ('templateId' in b) {
            const c = capability(b.templateId, b.templateVersion),
              result = c.compute(b.config, 100);
            sections.push(
              `### ${c.title}\n\n${b.alt}\n\n模型：${b.modelInfo.mode}。${c.description}\n\n交互不能保留；以下为初始参数下的计算摘要。\n\n| 量 | 值 |\n| --- | --- |\n` +
                Object.entries(result.values)
                  .map(([k, v]) => `| ${k} | ${v} |`)
                  .join('\n'),
            );
            if (result.steps)
              sections.push(result.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'));
          }
        }
      }
      const output = join(this.store.root, 'exports', exportId + '.md');
      writeFileSync(output, sections.join('\n\n'));
      this.store.put('export', {
        id: exportId,
        courseId,
        format,
        path: exportId + '.md',
        createdAt: now(),
      });
      return { exportId, downloadUrl: '/api/v1/exports/' + exportId };
    }
    const publicNodes =
      mode === 'content'
        ? nodes.map((n) => ({ ...n, kind: n.kind === 'remedial' ? 'optional' : n.kind }))
        : nodes;
    const courseMeta =
      mode === 'content'
        ? { ...course, profile: { language: course.profile.language }, status: 'active' }
        : course;
    const edges =
      mode === 'content' ? snapshot.edges.filter((e) => e.kind === 'prerequisite') : snapshot.edges;
    files.set(
      'course.json',
      jsonBuffer({
        schemaVersion: '1.0',
        course: courseMeta,
        concepts,
        nodes: publicNodes,
        edges,
        lessonIndex: lessons.map((l) => ({ nodeId: l.nodeId, version: l.version })),
        exercises: snapshot.exercises,
      }),
    );
    const required = new Map<string, { capabilityId: string; version: number }>();
    for (const l of lessons) {
      requireThat(
        l.document.assetRefs.length === 0,
        'RESOURCE_MISSING',
        '资源往返尚未启用，不能导出带资源的课程',
      );
      files.set(`lessons/${l.nodeId}/${l.version}.json`, jsonBuffer(l));
      for (const c of l.document.requiredCapabilities ?? [])
        required.set(c.capabilityId + ':' + c.version, c);
    }
    if (mode === 'backup') {
      files.set('personal/progress.json', jsonBuffer({ progress: snapshot.personal.progress }));
      files.set(
        'personal/attempts.json',
        jsonBuffer(
          Object.fromEntries(
            ['cycle', 'assignment', 'attempt', 'diagnosis', 'patch'].map((k) => [
              k,
              snapshot.personal[k],
            ]),
          ),
        ),
      );
      files.set('personal/notes.json', jsonBuffer({ note: snapshot.personal.note }));
      files.set(
        'personal/conversations.json',
        jsonBuffer(
          Object.fromEntries(
            ['session', 'message', 'context'].map((k) => [k, snapshot.personal[k]]),
          ),
        ),
      );
      files.set(
        'personal/demo-snapshots.json',
        jsonBuffer({ demo_snapshot: snapshot.personal.demo_snapshot }),
      );
    }
    const manifest = {
      format: 'adaptive-tutor-learn',
      formatVersion: '1.0',
      exportMode: mode,
      exportedAt: now(),
      sourceCourseRevision: course.revision,
      title: course.title,
      files: [...files].map(([path, b]) => ({
        path,
        size: b.length,
        sha256: sha(b),
        mime: 'application/json',
      })),
      generatedNodeKeys: nodes.filter((n) => n.currentLessonVersion > 0).map((n) => n.id),
      notGeneratedNodeKeys: nodes.filter((n) => !n.currentLessonVersion).map((n) => n.id),
      requiredCapabilities: [...required.values()],
    };
    files.set('manifest.json', jsonBuffer(manifest));
    const zip = new yazl.ZipFile();
    for (const [name, data] of files) zip.addBuffer(data, name);
    zip.end();
    const temporary = join(this.store.root, 'exports', exportId + '-' + uuid() + '.tmp');
    await pipeline(zip.outputStream, createWriteStream(temporary, { flags: 'wx' }));
    renameSync(temporary, join(this.store.root, 'exports', exportId + '.learn'));
    this.store.put('export', {
      id: exportId,
      courseId,
      format,
      path: exportId + '.learn',
      createdAt: now(),
    });
    return { exportId, downloadUrl: '/api/v1/exports/' + exportId };
  }
  async validate(path: string) {
    const files = await readArchive(path);
    const manifest = manifestSchema.parse(
      JSON.parse(files.get('manifest.json')?.toString() ?? 'null'),
    );
    requireThat(
      files.size === manifest.files.length + 1 &&
        new Set(manifest.files.map((f) => f.path)).size === manifest.files.length,
      'MANIFEST_INVALID',
      '包文件与声明不一致',
    );
    for (const f of manifest.files) {
      requireThat(f.path !== 'manifest.json', 'MANIFEST_INVALID', 'manifest 不应列出自身');
      const bytes = files.get(f.path);
      requireThat(
        bytes && bytes.length === f.size && sha(bytes) === f.sha256,
        'HASH_MISMATCH',
        '课程包文件校验失败',
      );
      requireThat(
        f.mime === 'application/json',
        'FORMAT_UNSUPPORTED',
        '此版本仅接收无外部资源的课程',
      );
    }
    for (const c of manifest.requiredCapabilities) capability(c.capabilityId, c.version);
    const data = portableCourse.parse(JSON.parse(files.get('course.json')?.toString() ?? 'null'));
    requireThat(
      data?.schemaVersion === '1.0' &&
        Array.isArray(data.nodes) &&
        Array.isArray(data.edges) &&
        data.nodes.length <= 500,
      'COURSE_INVALID',
      '课程结构无效',
    );
    requireThat(
      typeof data.course?.id === 'string' &&
        typeof data.course.title === 'string' &&
        typeof data.course.goal === 'string',
      'COURSE_INVALID',
      '课程元数据不完整',
    );
    assertDag(
      data.nodes.map((n: any) => n.id),
      data.edges
        .filter((e: any) => e.active)
        .map((e: any) => ({ from: e.fromNodeId, to: e.toNodeId })),
    );
    const lessons: any[] = [];
    for (const [name, b] of files) {
      if (name.startsWith('lessons/')) {
        const l = JSON.parse(b.toString()),
          n = data.nodes.find((n: any) => n.id === l.nodeId);
        requireThat(
          n &&
            Array.isArray(n.objectives) &&
            l.courseId === data.course.id &&
            l.id === l.nodeId + ':' + l.version,
          'COURSE_INVALID',
          '正文归属不正确',
        );
        const { schemaVersion, title, blocks, exercises, sources, assetRefs } = l.document;
        validateLesson(
          {
            schemaVersion,
            title,
            blocks,
            exercises: exercises.map(
              ({ id, version, lessonVersion, nodeId, courseId, familyId, status, ...e }: any) => e,
            ),
            sources,
            assetRefs,
          },
          n.objectives,
        );
        requireThat(assetRefs.length === 0, 'RESOURCE_MISSING', '资源包导入尚未实现');
        lessons.push(l);
      }
    }
    for (const n of data.nodes)
      requireThat(
        !n.currentLessonVersion ||
          lessons.some((l) => l.nodeId === n.id && l.version === n.currentLessonVersion),
        'REFERENCE_INVALID',
        '缺少当前正文版本',
      );
    const personal: Record<string, any[]> = {};
    for (const [name, b] of files)
      if (name.startsWith('personal/')) {
        requireThat(manifest.exportMode === 'backup', 'MANIFEST_INVALID', '内容包不能携带个人记录');
        const values = JSON.parse(b.toString());
        for (const [kind, rows] of Object.entries(values)) {
          requireThat(
            backupKinds.includes(kind as any) && Array.isArray(rows),
            'PERSONAL_INVALID',
            '未知个人记录类型',
          );
          personal[kind] = rows as any[];
        }
      }
    const knownPersonal = new Set([
      'personal/progress.json',
      'personal/attempts.json',
      'personal/notes.json',
      'personal/conversations.json',
      'personal/demo-snapshots.json',
    ]);
    for (const path of files.keys())
      requireThat(
        path === 'manifest.json' ||
          path === 'course.json' ||
          knownPersonal.has(path) ||
          /^lessons\/[a-zA-Z0-9_-]+\/[1-9]\d*\.json$/.test(path),
        'MANIFEST_INVALID',
        '不支持的包文件路径',
      );
    const concepts = new Set(data.concepts.map((c) => c.id));
    for (const n of data.nodes)
      requireThat(
        n.courseId === data.course.id && concepts.has(n.conceptId),
        'REFERENCE_INVALID',
        '节点与概念归属不一致',
      );
    for (const l of lessons) {
      requireThat(
        data.lessonIndex.some((i) => i.nodeId === l.nodeId && i.version === l.version),
        'REFERENCE_INVALID',
        '正文未登记在索引',
      );
      for (const b of l.document.blocks)
        if (b.templateId)
          requireThat(
            manifest.requiredCapabilities.some(
              (c) => c.capabilityId === b.templateId && c.version === b.templateVersion,
            ),
            'CAPABILITY_UNSUPPORTED',
            'manifest 缺少实际使用的模板',
          );
    }
    requireThat(
      data.lessonIndex.length === lessons.length,
      'REFERENCE_INVALID',
      '正文索引与文件不一致',
    );
    data.exercises = validateExerciseBank(data, lessons);
    validatePersonal(personal, data, lessons);
    const importId = uuid(),
      directory = join(this.store.root, 'imports', importId);
    mkdirSync(directory);
    writeFileSync(
      join(directory, 'validated.json'),
      JSON.stringify({ manifest, data, lessons, personal }),
    );
    this.store.put('import', {
      id: importId,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      title: manifest.title,
      status: 'validated',
    });
    return {
      importId,
      title: manifest.title,
      exportMode: manifest.exportMode,
      nodeCount: data.nodes.length,
      generatedCount: lessons.length,
      warnings: ['个性化正文可能包含作者主动透露的信息。'],
    };
  }
  commit(importId: string, mode: 'fresh' | 'restore_copy') {
    const record = this.store.must('import', importId);
    requireThat(
      record.expiresAt > now() && record.status === 'validated',
      'IMPORT_EXPIRED',
      '导入预览已过期',
      409,
    );
    const { manifest, data, lessons, personal } = JSON.parse(
      readFileSync(join(this.store.root, 'imports', importId, 'validated.json'), 'utf8'),
    );
    requireThat(
      mode !== 'restore_copy' || manifest.exportMode === 'backup',
      'IMPORT_MODE',
      '只有备份支持恢复学习记录',
    );
    const map = new Map<string, string>();
    const add = (s: string) => {
      if (typeof s === 'string' && !map.has(s)) map.set(s, uuid());
    };
    add(data.course.id);
    for (const row of [
      ...data.nodes,
      ...data.concepts,
      ...data.edges,
      ...Object.values(personal).flat(),
    ]) {
      add((row as any).id);
      if ((row as any).remediationEpochId) add((row as any).remediationEpochId);
    }
    for (const n of data.nodes) for (const o of n.objectives) add(o.id);
    for (const e of data.exercises ?? []) {
      add(e.id);
      add(e.familyId);
    }
    for (const l of lessons)
      for (const e of l.document.exercises) {
        add(e.id);
        add(e.familyId);
      }
    const freeText = new Set([
      'text',
      'title',
      'description',
      'explanation',
      'reason',
      'prompt',
      'label',
      'goal',
      'background',
      'summary',
      'alt',
      'key',
      'familyKey',
      'templateId',
      'capabilityId',
    ]);
    const remap = (v: any, key = ''): any => {
      if (typeof v === 'string') return freeText.has(key) ? v : (map.get(v) ?? v);
      if (Array.isArray(v)) return v.map((x) => remap(x, key));
      if (v && typeof v === 'object')
        return Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => k !== 'providerConversationId')
            .map(([k, x]) => [map.get(k) ?? k, remap(x, k)]),
        );
      return v;
    };
    const course = remap(data.course);
    course.status = 'active';
    course.createdAt = now();
    if (mode === 'fresh')
      course.profile = {
        background: '',
        weeklyMinutes: 120,
        language: data.course.profile?.language ?? '中文',
      };
    this.store.put('course', course);
    for (const kind of ['concept', 'node', 'edge'])
      for (const raw of data[
        kind === 'concept' ? 'concepts' : kind === 'node' ? 'nodes' : 'edges'
      ]) {
        const row = remap(raw);
        requireThat(row.courseId === course.id, 'REFERENCE_INVALID', '实体不属于课程');
        if (kind === 'edge' && mode === 'fresh' && row.kind === 'remediation') continue;
        if (kind === 'node' && row.kind === 'optional') row.kind = 'remedial';
        this.store.put(kind, row);
      }
    for (const raw of lessons) {
      const l = remap(raw);
      l.id = l.nodeId + ':' + l.version;
      this.store.put('lesson', l, l.nodeId);
      for (const e of l.document.exercises) this.store.put('exercise', e, e.nodeId);
    }
    // Current statuses must override immutable historical lesson records in either mode.
    for (const raw of data.exercises ?? []) {
      const e = remap(raw);
      this.store.put('exercise', e, e.nodeId);
    }
    if (mode === 'restore_copy') {
      for (const kind of backupKinds)
        for (const raw of personal[kind] ?? []) {
          const row = remap(raw);
          requireThat(row.courseId === course.id, 'REFERENCE_INVALID', '个人记录跨课程');
          if (kind === 'progress') {
            requireThat(this.store.get('node', row.id), 'REFERENCE_INVALID', '进度节点不存在');
          }
          if (kind === 'assignment')
            requireThat(
              this.store.get('exercise', row.exerciseId) && this.store.get('cycle', row.cycleId),
              'REFERENCE_INVALID',
              '题目分配引用不完整',
            );
          if (kind === 'session') row.providerBindingValid = false;
          this.store.put(
            kind,
            row,
            kind === 'message' ? row.sessionId : kind === 'attempt' ? row.assignmentId : row.nodeId,
          );
        }
    } else
      for (const n of this.store.list('node', course.id))
        this.store.put('progress', {
          id: n.id,
          courseId: course.id,
          status: 'available',
          masteredOnce: false,
          reviewStage: 0,
          bypass: false,
          cycleId: null,
        });
    if (mode === 'restore_copy')
      for (const p of this.store.list('progress', course.id)) this.courses.recompute(p.id);
    this.courses.unlock(course.id);
    this.store.put('import', { ...record, status: 'committed', courseId: course.id });
    return { courseId: course.id, revision: course.revision };
  }
}
async function readArchive(path: string): Promise<Map<string, Buffer>> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      path,
      { lazyEntries: true, validateEntrySizes: true, decodeStrings: true },
      (e, z) => (e || !z ? reject(e) : resolve(z)),
    ),
  );
  const files = new Map<string, Buffer>(),
    names = new Set<string>();
  let total = 0,
    count = 0;
  return await new Promise((resolve, reject) => {
    const fail = (e: unknown) => {
      zip.close();
      reject(e);
    };
    zip.on('error', fail);
    zip.on('end', () => resolve(files));
    zip.on('entry', async (entry) => {
      try {
        const normalized = safeEntry(entry.fileName);
        requireThat(!names.has(normalized), 'ZIP_PATH', '归一化后文件重名');
        names.add(normalized);
        requireThat(
          ++count <= 10000 &&
            entry.uncompressedSize <= 20 * 1024 * 1024 &&
            entry.uncompressedSize / Math.max(1, entry.compressedSize) <= 100,
          'ZIP_LIMIT',
          '归档超过资源限制',
        );
        requireThat(
          ((entry.externalFileAttributes >>> 16) & 0xf000) !== 0xa000,
          'ZIP_PATH',
          '不允许符号链接',
        );
        const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) =>
          zip.openReadStream(entry, (e, s) => (e || !s ? reject(e) : resolve(s))),
        );
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          const b = Buffer.from(chunk);
          size += b.length;
          total += b.length;
          requireThat(
            size <= 20 * 1024 * 1024 && total <= 500 * 1024 * 1024,
            'ZIP_LIMIT',
            '实际解压量超过限制',
          );
          chunks.push(b);
        }
        files.set(entry.fileName, Buffer.concat(chunks));
        zip.readEntry();
      } catch (e) {
        fail(e);
      }
    });
    zip.readEntry();
  });
}
