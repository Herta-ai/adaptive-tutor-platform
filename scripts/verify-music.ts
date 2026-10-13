import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(readFileSync('public/music/manifest.json', 'utf8'));
if (manifest.version !== 'vcsl-1' || manifest.license !== 'CC0-1.0')
  throw Error('音乐资源版本无效');
for (const sample of manifest.samples) {
  const bytes = readFileSync(`public/music/${sample.file}`);
  if (
    bytes.length !== sample.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== sample.sha256
  )
    throw Error(`采样校验失败: ${sample.id}`);
}
console.log(`音乐离线资源：${manifest.samples.length} 个采样校验通过。`);
