import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// PowerShell single-quoted literals do not evaluate $, backticks or ampersands.
export const psLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
export function mcpRegistrationCommand(executable = 'agy') {
  const entry = fileURLToPath(new URL('../../dist/mcp/stdio.js', import.meta.url));
  return `& ${psLiteral(executable)} mcp add --type stdio adaptive-tutor ${psLiteral(process.execPath)} ${psLiteral(entry)}`;
}

export function openBrowser(url: string) {
  const address = new URL(url);
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1')
    throw new Error('只允许打开本机引导链接');
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
    shell: false,
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  });
  child.once('error', () =>
    console.error('未能自动打开浏览器，请复制上方引导链接到 Edge/Chrome。'),
  );
  child.unref();
}
