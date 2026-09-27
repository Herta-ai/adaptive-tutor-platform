import { createReadStream, createWriteStream, readdirSync, lstatSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';

export function filesIn(root: string): string[] {
  const files: string[] = [];
  function walk(directory: string) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`发行包不得包含文件链接：${path}`);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
      else throw new Error(`不支持的发行文件：${path}`);
    }
  }
  walk(root);
  return files;
}

export async function sha256(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function archivePath(root: string, name: string) {
  if (
    !name ||
    name.includes('\\') ||
    name.includes(':') ||
    name.startsWith('/') ||
    name.includes('\0')
  )
    throw new Error(`归档路径无效：${name}`);
  const segments = name.split('/');
  if (
    segments.some(
      (s) =>
        s === '..' ||
        s === '.' ||
        /[. ]$/.test(s) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s),
    )
  )
    throw new Error(`归档路径越界或不适用于 Windows：${name}`);
  const path = resolve(root, ...segments);
  const local = relative(resolve(root), path);
  if (!local || local.startsWith('..') || isAbsolute(local))
    throw new Error(`归档路径越界：${name}`);
  return path;
}

// Used only for checksum-verified Node archives and this build's own ZIP.
export async function extractZip(zipPath: string, target: string, include = (_: string) => true) {
  mkdirSync(target, { recursive: true });
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (error, zip) =>
      error ? reject(error) : resolve(zip!),
    ),
  );
  let bytes = 0,
    entries = 0;
  const seen = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => {
      zip.close();
      reject(error);
    };
    zip.on('error', fail);
    zip.on('end', resolve);
    zip.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        if (++entries > 100000 || (bytes += entry.uncompressedSize) > 3 * 1024 ** 3)
          throw new Error('归档超过限额');
        const path = archivePath(target, entry.fileName);
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
          throw new Error('归档含符号链接');
        const key = entry.fileName.toLowerCase();
        if (seen.has(key)) throw new Error('归档路径重复');
        seen.add(key);
        if (entry.fileName.endsWith('/') || !include(entry.fileName)) {
          zip.readEntry();
          return;
        }
        mkdirSync(dirname(path), { recursive: true });
        const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) =>
          zip.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream!))),
        );
        await pipeline(stream, createWriteStream(path, { flags: 'wx' }));
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}

export async function createZip(root: string, destination: string, prefix: string) {
  const zip = new yazl.ZipFile();
  const output = createWriteStream(destination, { flags: 'wx' });
  const completed = pipeline(zip.outputStream, output);
  // Ensure emitted errors also reject the output pipeline.
  zip.on('error', (error) => output.destroy(error));
  for (const name of filesIn(root)) zip.addFile(join(root, name), `${prefix}/${name}`);
  zip.end();
  await completed;
}
