import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
export function publishConnection(root: string, origin: string, mcpToken: string) {
  if (process.platform === 'win32') {
    const who = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
    });
    const sid = who.stdout?.match(/S-1-5-[0-9-]+/)?.[0];
    if (!sid) throw Error('无法确认当前 Windows 用户 SID');
    const acl = spawnSync(
      'icacls.exe',
      [join(root, 'runtime'), '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`],
      { windowsHide: true, shell: false, stdio: 'pipe' },
    );
    if (acl.status !== 0) throw Error('无法保护 MCP 运行时凭证目录');
  }
  const path = join(root, 'runtime', 'connection.json');
  writeFileSync(path, JSON.stringify({ origin, mcpToken }), { mode: 0o600 });
  return () => {
    // Node 24.10.0 fs.rmSync can silently leave files in Windows Unicode paths.
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };
}
