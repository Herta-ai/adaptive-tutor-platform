import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/database';
import { createApplication } from '../src/server/http';
import { staticPages } from '../src/server/static-pages';
import { saveAgentConfig } from '../src/runtime/config';
import { buildSync } from 'esbuild';
import { musicConfig } from '../src/music/model';
let root: string, store: Store, app: ReturnType<typeof createApplication>;
test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tutor-music-e2e-'));
  store = new Store(root);
  saveAgentConfig(root, {
    chatRuntime: 'antigravity',
    generationRuntime: 'antigravity',
    provider: 'openai',
    providers: { openai: { model: 'synthetic', apiKey: 'test-key' } },
  });
  app = createApplication(store, { handlePage: staticPages(join(process.cwd(), 'out')) });
  await app.listen();
});
test.afterAll(async () => {
  await app?.close();
  store?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});
test.beforeEach(async ({ page }) => {
  await page.goto(app.origin + '/#bootstrap=' + app.mintBootstrap());
  await page
    .getByRole('region', { name: 'EDM 与 Ableton Live 课程' })
    .getByRole('button', { name: /EDM 从零开始：乐理、声音与 Live 12/ })
    .click();
  await expect(page.getByRole('region', { name: '音阶与键盘', exact: true })).toBeVisible();
});
test('真实音频、双谱面、下载、快照与停止', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const lab = page.getByRole('region', { name: '音阶与键盘', exact: true });
  await lab.getByRole('button', { name: '启用声音', exact: true }).click();
  await expect(lab.getByRole('status').first()).toContainText('声音已启用');
  await lab.getByRole('button', { name: '播放示范', exact: true }).click();
  await expect
    .poll(async () =>
      Number((await lab.locator('.music-analysis strong').innerText()).replace(' dBFS', '')),
    )
    .toBeGreaterThan(-90);
  await lab.getByRole('button', { name: '暂停', exact: true }).click();
  await lab.getByLabel('谱面显示').selectOption('staff');
  await expect(lab.locator('.music-staff svg')).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        document.fonts.check('16px Bravura') &&
        [...document.fonts].some((f) => f.family === 'Bravura' && f.status === 'loaded'),
    ),
  ).toBe(true);
  expect(await lab.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(
    true,
  );
  await expect(lab.getByText('五线谱加载失败', { exact: false })).toHaveCount(0);
  await lab.getByRole('button', { name: '保存音乐快照', exact: true }).click();
  await expect(page.getByText('音乐快照已保存', { exact: true })).toBeVisible();
  const midi = page.waitForEvent('download');
  await lab.getByRole('button', { name: '下载 MIDI', exact: true }).click();
  expect((await midi).suggestedFilename()).toMatch(/\.mid$/);
  const wav = page.waitForEvent('download');
  await lab.getByRole('button', { name: '下载 WAV 干声', exact: true }).click();
  expect((await wav).suggestedFilename()).toMatch(/-dry\.wav$/);
  await lab.getByLabel('音乐示例').selectOption('bounce');
  await lab
    .getByLabel('鼓机步进格')
    .getByRole('button', { name: 'kick 第 1 格', exact: true })
    .click();
  await expect(
    lab.getByLabel('鼓机步进格').getByRole('button', { name: 'kick 第 1 格', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await lab.getByLabel('音乐示例').selectOption('scale');
  await lab.locator('header').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('music-lab.png') });
  expect(errors).toEqual([]);
});

test('模拟 MIDI 和弦、零力度松键、踏板与热插拔，离线继续播放', async ({ page }) => {
  const lab = page.getByRole('region', { name: '音阶与键盘', exact: true });
  await lab.getByRole('button', { name: '启用声音', exact: true }).click();
  await expect(lab.getByRole('status').first()).toContainText('声音已启用');
  await page.evaluate(() => {
    const input = Object.assign(new EventTarget(), {
      id: 'test-midi',
      name: 'Test MIDI',
      state: 'connected',
      onmidimessage: (event: any) =>
        input.dispatchEvent(Object.assign(new Event('midimessage'), { data: event.data })),
    });
    const access = Object.assign(new EventTarget(), {
      inputs: new Map([[input.id, input]]),
      onstatechange: () => access.dispatchEvent(new Event('statechange')),
    });
    (window as any).testMidi = { input, access };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => access,
    });
  });
  await lab.getByRole('button', { name: '连接 MIDI', exact: true }).click();
  await expect(lab.getByLabel('MIDI 设备')).toHaveValue('test-midi');
  await page.evaluate(() => {
    const m = (window as any).testMidi;
    for (const pitch of [60, 64, 67])
      m.input.onmidimessage({ data: [0x90, pitch, 96], timeStamp: performance.now() });
  });
  for (const name of ['C4', 'E4', 'G4'])
    await expect(lab.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  await page.evaluate(() => {
    const m = (window as any).testMidi;
    m.input.onmidimessage({ data: [0xb0, 64, 127] });
    m.input.onmidimessage({ data: [0x90, 60, 0] });
  });
  await expect(lab.getByRole('button', { name: 'C4', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.evaluate(() => {
    const m = (window as any).testMidi;
    m.input.state = 'disconnected';
    m.access.onstatechange();
  });
  await expect(lab.getByText('未发现 MIDI 输入设备')).toBeVisible();
  for (const name of ['E4', 'G4'])
    await expect(lab.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  await page.context().setOffline(true);
  await lab.getByRole('button', { name: '播放示范', exact: true }).click();
  await expect
    .poll(async () =>
      Number((await lab.locator('.music-analysis strong').innerText()).replace(' dBFS', '')),
    )
    .toBeGreaterThan(-90);
  await lab.getByRole('button', { name: '暂停', exact: true }).click();
  await expect
    .poll(async () =>
      Number((await lab.locator('.music-analysis strong').innerText()).replace(' dBFS', '')),
    )
    .toBeLessThan(-90);
  await page.context().setOffline(false);
});
test('正式练习记录独立作答，中断清空提交，错误演奏由服务端判分', async ({ page }) => {
  await page.getByRole('button', { name: '开始练习 →', exact: true }).click();
  await page.getByLabel('音符对应的时间间隔', { exact: true }).check();
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await page.getByRole('button', { name: '下一道独立练习 →', exact: true }).click();
  const exercise = page.getByRole('region', { name: '正式演奏练习', exact: true });
  await exercise.getByRole('button', { name: '启用练习声音', exact: true }).click();
  await expect(exercise.getByRole('button', { name: '开始正式练习', exact: true })).toBeEnabled();
  await exercise.getByRole('button', { name: '开始正式练习', exact: true }).click();
  await exercise.getByRole('button', { name: '中断重来', exact: true }).click();
  await expect(page.getByRole('button', { name: '提交答案', exact: true })).toBeDisabled();
  await exercise.getByRole('button', { name: '开始正式练习', exact: true }).click();
  await expect(exercise.getByRole('status').last()).toContainText('点击“提交答案”', {
    timeout: 15000,
  });
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await expect(page.getByText(/演奏匹配率 0%/)).toBeVisible();
});
test('采样损坏明确提示，MIDI 权限拒绝不阻断网页输入', async ({ page }) => {
  await page.route('**/music/piano-3.wav', (route) =>
    route.fulfill({ status: 200, body: 'corrupt' }),
  );
  const lab = page.getByRole('region', { name: '音阶与键盘', exact: true });
  await lab.getByRole('button', { name: '启用声音', exact: true }).click();
  await expect(lab.getByRole('status').first()).toContainText('采样校验失败');
  await page.unroute('**/music/piano-3.wav');
  await lab.getByRole('button', { name: '启用声音', exact: true }).click();
  await expect(lab.getByRole('status').first()).toContainText('声音已启用');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: () => Promise.reject(new Error('MIDI 权限未获允许')),
    }),
  );
  await lab.getByRole('button', { name: '连接 MIDI', exact: true }).click();
  await expect(lab.getByText('MIDI 权限未获允许', { exact: true })).toBeVisible();
  const key = lab.getByRole('button', { name: 'C4', exact: true });
  await key.focus();
  await page.keyboard.down('a');
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('a');
  await expect(key).toHaveAttribute('aria-pressed', 'false');
});
test('实际 AudioWorklet 侧链以独立音频输入衰减信号', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    await ctx.audioWorklet.addModule('/music/sidechain.js');
    const sc = new AudioWorkletNode(ctx, 'tutor-sidechain', {
      numberOfInputs: 2,
      outputChannelCount: [1],
    });
    const main = ctx.createConstantSource(),
      key = ctx.createConstantSource(),
      analyser = ctx.createAnalyser(),
      silence = ctx.createGain();
    main.offset.value = 0.5;
    key.offset.value = 0.5;
    silence.gain.value = 0;
    main.connect(sc, 0, 0);
    key.connect(sc, 0, 1);
    sc.connect(analyser);
    analyser.connect(silence);
    silence.connect(ctx.destination);
    main.start();
    key.start();
    const read = async () => {
      await new Promise((r) => setTimeout(r, 350));
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      return data.reduce((n, x) => n + Math.abs(x), 0) / data.length;
    };
    sc.parameters.get('depth')!.value = 0;
    const dry = await read();
    sc.parameters.get('depth')!.value = 1;
    const wet = await read();
    key.offset.value = 0;
    await new Promise((r) => setTimeout(r, 1200));
    const recovered = await read();
    main.stop();
    key.stop();
    await ctx.close();
    return { dry, wet, recovered };
  });
  expect(result.dry).toBeGreaterThan(0.45);
  expect(result.wet).toBeLessThan(result.dry / 4);
  expect(result.recovered).toBeGreaterThan(result.dry * 0.9);
});

test('音乐引擎实际滤波、EQ、压缩与 LFO，停止并重新启用不会恢复尾音', async ({ page }) => {
  const harness = buildSync({
    entryPoints: ['src/music/audio.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'MusicTest',
    write: false,
  }).outputFiles[0].text;
  await page.addScriptTag({ content: harness });
  const result = await page.evaluate(
    async (config) => {
      const engine = new (window as any).MusicTest.MusicAudio(config);
      await engine.prepare();
      engine.analyser.smoothingTimeConstant = 0;
      engine.note(
        { id: 'held', instrument: 'lead', pitch: 60, beat: 0, duration: 4, velocity: 127 },
        engine.context.currentTime,
        true,
      );
      const read = async () => {
        await new Promise((r) => setTimeout(r, 450));
        const m = engine.meter();
        return {
          high: [...m.spectrum]
            .slice(100, 500)
            .reduce((sum: number, db) => sum + 10 ** ((db as number) / 10), 0),
          reduction: m.reduction,
          response: [...m.response],
          lfo: m.lfoValue,
          peak: m.peakDb,
        };
      };
      const open = await read();
      engine.apply({ ...config, cutoff: 100 });
      const filtered = await read();
      engine.apply({
        ...config,
        bypass: false,
        eqGain: 12,
        threshold: -40,
        ratio: 12,
        lfoDepth: 1000,
      });
      const processed = await read();
      const lfos = [processed.lfo];
      for (let i = 0; i < 3; i++) lfos.push((await read()).lfo);
      engine.stop();
      engine.activate();
      const stopped = await read();
      await engine.close();
      return { open, filtered, processed, lfos, stopped };
    },
    musicConfig.parse({
      preset: 'progressive',
      solo: 'lead',
      bypass: true,
      cutoff: 16000,
      reverb: 0.5,
      delay: 0.5,
      matchLoudness: false,
      gainDb: -6,
    }),
  );
  expect(result.open.high).toBeGreaterThan(result.filtered.high * 10);
  expect(Math.max(...(result.processed.response as number[]))).toBeGreaterThan(3);
  expect(result.processed.reduction).toBeLessThan(-5);
  expect(Math.max(...result.lfos) - Math.min(...result.lfos)).toBeGreaterThan(0.5);
  expect(result.stopped.peak).toBeLessThan(-90);
});
