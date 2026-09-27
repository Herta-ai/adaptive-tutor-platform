import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '../domain/errors.js';

const occupied = () =>
  new AppError('APP_ALREADY_RUNNING', '数据目录已被应用占用，请先停止旧实例再启动。', 409);

export function acquireWriterLock(root: string): () => void {
  // Never unlink this file: the OS lease, unlike a PID marker, survives races
  // and is automatically released when its owning process dies.
  const lease = new DatabaseSync(join(root, 'runtime', 'writer-lease.sqlite'));
  const marker = join(root, 'runtime', 'writer.lock');
  const token = randomUUID();
  try {
    lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
    let old: any;
    try {
      old = JSON.parse(readFileSync(marker, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (old !== undefined && old?.version !== 2) {
      if (!Number.isSafeInteger(old?.pid) || old.pid <= 0) throw occupied();
      try {
        process.kill(old.pid, 0);
        throw occupied();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    const temporary = `${marker}.${token}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ version: 2, pid: process.pid, token }), {
        flag: 'wx',
        mode: 0o600,
      });
      renameSync(temporary, marker);
    } finally {
      rmSync(temporary, { force: true });
    }
  } catch (error) {
    lease.close();
    if ([5, 6].includes((error as { errcode: number }).errcode)) throw occupied();
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      try {
        if (JSON.parse(readFileSync(marker, 'utf8')).token === token) rmSync(marker);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    } finally {
      lease.close();
    }
  };
}
