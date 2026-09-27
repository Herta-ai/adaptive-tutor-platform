import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

try {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('此便携包仅支持 Windows x64。');
  const settings = JSON.parse(
    readFileSync(new URL('./portable-settings.json', import.meta.url), 'utf8'),
  );
  if (typeof settings.agyPath !== 'string' || typeof settings.openBrowser !== 'boolean')
    throw new Error('portable-settings.json 需要 agyPath 字符串及 openBrowser 布尔值。');
  if (settings.agyPath) {
    if (
      !isAbsolute(settings.agyPath) ||
      !/\.exe$/i.test(settings.agyPath) ||
      !statSync(settings.agyPath).isFile()
    )
      throw new Error('agyPath 必须是现有 agy.exe 的绝对路径。');
    process.env.ADAPTIVE_TUTOR_AGY_PATH = settings.agyPath;
  }
  process.env.NODE_ENV = 'production';
  process.env.NEXT_TELEMETRY_DISABLED = '1';
  if (settings.openBrowser && !process.argv.includes('--no-open')) process.argv.push('--open');
  await import('./app/dist/server/main.js');
} catch (error) {
  console.error('启动失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
