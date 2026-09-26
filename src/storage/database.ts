import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AppError } from '../domain/errors.js';

export const dataRoot = () => join(homedir(), '.herta-ai', 'adaptive-tutor-platform');
export const uuid = () => randomUUID();
export const now = () => new Date().toISOString();
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
      .join(',') +
    '}'
  );
}
export const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
// Rows store immutable domain snapshots; keys and indexes enforce ownership and idempotency.
export class Store {
  readonly db: DatabaseSync;
  constructor(
    readonly root: string,
    private ownsLock = false,
  ) {
    mkdirSync(root, { recursive: true });
    for (const dir of [
      'assets',
      'jobs',
      'imports',
      'exports',
      'backups',
      'cache/runtimes',
      'logs',
      'runtime',
    ])
      mkdirSync(join(root, dir), { recursive: true });
    if (ownsLock) {
      const lock = join(root, 'runtime', 'writer.lock');
      try {
        writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
      } catch {
        throw new AppError(
          'APP_ALREADY_RUNNING',
          '数据目录已被应用占用；若异常退出，请确认旧实例停止后移除 writer.lock',
          409,
        );
      }
    }
    try {
      this.db = new DatabaseSync(join(root, 'tutor.sqlite'));
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
      const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version;
      if (version > 1) throw new AppError('DATABASE_VERSION', '数据库版本高于当前应用');
      this.db.exec(`
    CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,course_id TEXT,owner_id TEXT,body TEXT NOT NULL CHECK(json_valid(body)),PRIMARY KEY(kind,id));
    CREATE INDEX IF NOT EXISTS entity_course ON entities(kind,course_id);
    CREATE INDEX IF NOT EXISTS entity_owner ON entities(kind,owner_id);
    CREATE TABLE IF NOT EXISTS idempotency(scope TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(scope,key));
    CREATE TABLE IF NOT EXISTS events(event_id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT,sequence INTEGER NOT NULL,course_id TEXT,session_id TEXT,type TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(request_id,sequence));
    PRAGMA user_version=1;
   `);
    } catch (error) {
      if (ownsLock) rmSync(join(root, 'runtime', 'writer.lock'), { force: true });
      throw error;
    }
  }
  get<T = any>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind, id) as
      | { body: string }
      | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  must<T = any>(kind: string, id: string): T {
    const v = this.get<T>(kind, id);
    if (!v) throw new AppError('NOT_FOUND', '记录不存在', 404);
    return v;
  }
  list<T = any>(kind: string, courseId?: string, ownerId?: string): T[] {
    const rows = this.db
      .prepare(
        'SELECT body FROM entities WHERE kind=?' +
          (courseId ? ' AND course_id=?' : '') +
          (ownerId ? ' AND owner_id=?' : '') +
          ' ORDER BY rowid',
      )
      .all(kind, ...(courseId ? [courseId] : []), ...(ownerId ? [ownerId] : [])) as {
      body: string;
    }[];
    return rows.map((r) => JSON.parse(r.body));
  }
  put(
    kind: string,
    value: { id: string; courseId?: string; [key: string]: any },
    ownerId?: string,
  ) {
    this.db
      .prepare(
        'INSERT INTO entities(kind,id,course_id,owner_id,body) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,course_id=excluded.course_id,owner_id=excluded.owner_id',
      )
      .run(kind, value.id, value.courseId ?? null, ownerId ?? null, JSON.stringify(value));
    return value;
  }
  remove(kind: string, id: string) {
    this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, id);
  }
  deleteCourse(courseId: string) {
    const ids = (
      this.db.prepare('SELECT id FROM entities WHERE course_id=?').all(courseId) as { id: string }[]
    ).map((r) => r.id);
    ids.push(courseId);
    for (const id of ids)
      this.db
        .prepare(
          "DELETE FROM idempotency WHERE instr(scope,?)>0 OR json_extract(response,'$.id')=? OR json_extract(response,'$.courseId')=?",
        )
        .run(id, id, id);
    this.db
      .prepare("DELETE FROM entities WHERE course_id=? OR (kind='course' AND id=?)")
      .run(courseId, courseId);
    this.db.prepare('DELETE FROM events WHERE course_id=?').run(courseId);
  }
  transaction<T>(f: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const v = f();
      this.db.exec('COMMIT');
      return v;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  command<T>(scope: string, key: string, payload: unknown, f: () => T): T {
    return this.transaction(() => {
      const digest = hash(payload);
      const row = this.db
        .prepare('SELECT hash,response FROM idempotency WHERE scope=? AND key=?')
        .get(scope, key) as { hash: string; response: string } | undefined;
      if (row) {
        if (row.hash !== digest)
          throw new AppError('IDEMPOTENCY_CONFLICT', '同一请求标识不能用于不同内容', 409);
        return JSON.parse(row.response);
      }
      const result = f();
      this.db
        .prepare('INSERT INTO idempotency VALUES(?,?,?,?)')
        .run(scope, key, digest, JSON.stringify(result));
      return result;
    });
  }
  emit(
    type: string,
    payload: unknown,
    courseId?: string,
    sessionId?: string,
    requestId: string = uuid(),
  ) {
    const seq = (
      this.db
        .prepare('SELECT COALESCE(MAX(sequence),0)+1 AS seq FROM events WHERE request_id=?')
        .get(requestId) as { seq: number }
    ).seq;
    this.db
      .prepare(
        'INSERT INTO events(request_id,sequence,course_id,session_id,type,payload,created_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        requestId,
        seq,
        courseId ?? null,
        sessionId ?? null,
        type,
        JSON.stringify(payload),
        now(),
      );
  }
  events(courseId: string, sessionId: string | undefined, after: number) {
    return this.db
      .prepare(
        'SELECT * FROM events WHERE course_id=? AND (session_id IS NULL OR session_id=?) AND event_id>? ORDER BY event_id LIMIT 200',
      )
      .all(courseId, sessionId ?? null, after)
      .map((r: any) => ({
        protocolVersion: 1,
        eventId: String(r.event_id),
        requestId: r.request_id,
        sequence: r.sequence,
        courseId: r.course_id,
        sessionId: r.session_id,
        type: r.type,
        payload: JSON.parse(r.payload),
      }));
  }
  cursor() {
    return String(
      (
        this.db.prepare('SELECT COALESCE(MAX(event_id),0) AS id FROM events').get() as {
          id: number;
        }
      ).id,
    );
  }
  eventFloor(courseId: string) {
    return Number(this.get('event_floor', courseId)?.value ?? 0);
  }
  maintainEvents(time = Date.now()) {
    this.transaction(() => {
      const cutoff = new Date(time - 7 * 86400000).toISOString();
      const active = new Set(
        this.list('job')
          .filter((j) => ['queued', 'running', 'validating'].includes(j.state))
          .map((j) => j.id),
      );
      for (const course of this.list('course')) {
        const rows = this.db
          .prepare(
            'SELECT event_id,request_id,created_at FROM events WHERE course_id=? ORDER BY event_id DESC',
          )
          .all(course.id) as { event_id: number; request_id: string; created_at: string }[];
        let floor = this.eventFloor(course.id);
        const remove = this.db.prepare('DELETE FROM events WHERE event_id=?');
        for (let i = 0; i < rows.length; i++) {
          const e = rows[i];
          if ((i >= 100000 || e.created_at < cutoff) && !active.has(e.request_id)) {
            remove.run(e.event_id);
            floor = Math.max(floor, e.event_id);
          }
        }
        if (floor) this.put('event_floor', { id: course.id, courseId: course.id, value: floor });
      }
    });
  }
  close() {
    this.db.close();
    if (this.ownsLock) rmSync(join(this.root, 'runtime', 'writer.lock'), { force: true });
  }
}
