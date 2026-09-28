import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staticPages } from '../src/server/static-pages';
import { Store, uuid } from '../src/storage/database';
import { createGeometryExample } from '../src/domain/examples';
import { createApplication } from '../src/server/http';
let root: string, store: Store, app: ReturnType<typeof createApplication>;
test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tutor-e2e-'));
  store = new Store(root);
  app = createApplication(store, { handlePage: staticPages(join(process.cwd(), 'out')) });
  await app.listen();
});
test.afterAll(async () => {
  await app?.close();
  store?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});
test('清空导师对话支持取消确认，跨标签同步，刷新保持清空', async ({ page }) => {
  const course = createGeometryExample(app.courses);
  store.put('course', { ...course, title: '清空对话回归' });
  const session = store.put('session', {
    id: uuid(),
    courseId: course.id,
    status: 'active',
    providerBindingValid: true,
    providerConversationId: 'synthetic-old-binding',
  });
  const requestId = uuid();
  store.put('job', {
    id: requestId,
    courseId: course.id,
    sessionId: session.id,
    kind: 'chat',
    state: 'completed',
  });
  store.put(
    'message',
    {
      id: uuid(),
      courseId: course.id,
      sessionId: session.id,
      requestId,
      role: 'assistant',
      status: 'complete',
      text: '这是一条待清空的导师回答',
    },
    session.id,
  );
  await page.goto(app.origin + '/#bootstrap=' + app.mintBootstrap());
  const open = (target: typeof page) =>
    target
      .getByRole('button')
      .filter({ has: target.getByRole('heading', { name: '清空对话回归', exact: true }) })
      .click();
  await open(page);
  const other = await page.context().newPage();
  await other.goto(app.origin);
  await open(other);
  await expect(other.getByText('这是一条待清空的导师回答', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '清空对话', exact: true }).click();
  await expect(page.getByText('这是一条待清空的导师回答', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '清空对话', exact: true }).click();
  for (const target of [page, other]) {
    await expect(target.getByText('这是一条待清空的导师回答', { exact: true })).toHaveCount(0);
    await expect(
      target.getByRole('heading', { name: '从「为什么」开始', exact: true }),
    ).toBeVisible();
  }
  expect(store.must('session', session.id).providerConversationId).toBeUndefined();
  expect(store.get('course', course.id)).toBeDefined();
  await page.reload();
  await open(page);
  await expect(page.getByText('这是一条待清空的导师回答', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '清空对话', exact: true })).toBeDisabled();
  await other.close();
});
test('导师显示实时 agy 步骤、五分钟预算，刷新保留记录并可停止', async ({ page }) => {
  const course = createGeometryExample(app.courses);
  store.put('course', { ...course, title: '导师进度回归' });
  const session = store.put('session', {
    id: uuid(),
    courseId: course.id,
    status: 'active',
    providerBindingValid: false,
  });
  const requestId = uuid(),
    timestamp = new Date().toISOString();
  const init = {
    id: 'init',
    phase: 'init',
    state: 'done',
    startedAt: timestamp,
    updatedAt: timestamp,
  };
  store.put('job', {
    id: requestId,
    kind: 'chat',
    courseId: course.id,
    sessionId: session.id,
    state: 'running',
    startedAt: timestamp,
    timeoutMs: 300000,
    activities: [init],
    lastActivityAt: timestamp,
  });
  store.put(
    'message',
    {
      id: uuid(),
      courseId: course.id,
      sessionId: session.id,
      requestId,
      role: 'assistant',
      status: 'pending',
      text: '',
    },
    session.id,
  );
  await page.goto(app.origin + '/#bootstrap=' + app.mintBootstrap());
  const open = () =>
    page
      .getByRole('button')
      .filter({ has: page.getByRole('heading', { name: '导师进度回归', exact: true }) })
      .click();
  await open();
  const progress = page.getByRole('region', { name: 'agy 执行进度' });
  await expect(progress).toContainText('最长 5 分钟');
  await expect(progress).toContainText('已连接 agy');
  await expect(page.getByRole('button', { name: '清空对话', exact: true })).toBeDisabled();
  const step = {
    id: 'step-2-tool',
    phase: 'tool',
    state: 'active',
    stepIndex: 2,
    startedAt: timestamp,
    updatedAt: new Date().toISOString(),
  };
  store.transaction(() => {
    store.put('job', {
      ...store.must('job', requestId),
      activities: [init, step],
      lastActivityAt: step.updatedAt,
    });
    store.emit('job.progress', { activity: step }, course.id, session.id, requestId);
  });
  await expect(progress).toContainText('步骤 3 · 工具调用');
  await page.reload();
  await open();
  await expect(progress).toContainText('步骤 3 · 工具调用');
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(progress.locator('strong')).toHaveText('已停止');
  await expect(progress).not.toContainText('最长 5 分钟');
});
test('我的课程可确认删除：取消不删除，活动任务保护，记录清理且刷新不恢复', async ({ page }) => {
  const course = createGeometryExample(app.courses);
  store.put('course', { ...course, title: '待删除课程' });
  const keep = createGeometryExample(app.courses);
  store.put('course', { ...keep, title: '保留课程' });
  const node = store.list('node', course.id)[0];
  store.put('note', { id: node.id, courseId: course.id, text: '删除回归笔记', version: 1 });
  const job = { id: uuid(), courseId: course.id, kind: 'generate_lesson', state: 'running' };
  store.put('job', job);
  await page.goto(app.origin + '/#bootstrap=' + app.mintBootstrap());
  const remove = page.getByRole('button', { name: '删除课程：待删除课程', exact: true });
  let requests = 0;
  page.on('request', (r) => {
    if (r.method() === 'DELETE') requests++;
  });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('无法撤销');
    await dialog.dismiss();
  });
  await remove.click();
  await expect(remove).toBeVisible();
  expect(requests).toBe(0);
  page.once('dialog', (dialog) => dialog.accept());
  await remove.click();
  await expect(
    page.getByRole('alert').filter({ hasText: '请先取消当前课程的活动任务' }),
  ).toBeVisible();
  expect(store.get('course', course.id)).toBeDefined();
  store.put('job', { ...job, state: 'completed' });
  page.once('dialog', (dialog) => dialog.accept());
  await remove.click();
  await expect(remove).toHaveCount(0);
  expect(store.get('course', course.id)).toBeUndefined();
  expect(store.list('node', course.id)).toHaveLength(0);
  expect(store.list('lesson', course.id)).toHaveLength(0);
  expect(store.list('note', course.id)).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: '今天，想理解什么？' })).toBeVisible();
  await expect(remove).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '保留课程', exact: true })).toBeVisible();
});
test('长大纲不会将正文或导师列推到下方，失败消息不再等待', async ({ page }) => {
  const course = createGeometryExample(app.courses);
  store.put('course', { ...course, title: '长大纲布局回归' });
  const first = store.list('node', course.id)[0];
  for (let i = 0; i < 65; i++) {
    const node = {
      ...first,
      id: uuid(),
      title: '后续章节 ' + i,
      currentLessonVersion: 0,
      contentStatus: 'not_generated',
    };
    store.put('node', node);
    store.put('progress', {
      id: node.id,
      courseId: course.id,
      status: 'locked',
      masteredOnce: false,
      reviewStage: 0,
      bypass: false,
      cycleId: null,
    });
  }
  const session = store.put('session', {
    id: uuid(),
    courseId: course.id,
    status: 'active',
    providerBindingValid: false,
  });
  const requestId = uuid();
  store.put('job', {
    id: requestId,
    courseId: course.id,
    sessionId: session.id,
    kind: 'chat',
    state: 'failed',
    error: { code: 'CLI_TIMEOUT', message: 'CLI 运行超时' },
  });
  // Also exercise the UI fallback for legacy pending messages before server restart repair.
  store.put(
    'message',
    {
      id: uuid(),
      courseId: course.id,
      sessionId: session.id,
      requestId,
      role: 'assistant',
      status: 'pending',
      text: '',
    },
    session.id,
  );
  await page.goto(app.origin + '/#bootstrap=' + app.mintBootstrap());
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: '长大纲布局回归' }) })
    .click();
  await expect(page.getByRole('heading', { name: '直角三角形的面积', exact: true })).toBeVisible();
  const bounds = await page.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top;
    return {
      workspace: top('.workspace'),
      lesson: top('.lesson'),
      tutor: top('.tutor'),
      scroll: scrollY,
    };
  });
  expect(bounds.scroll).toBe(0);
  expect(Math.abs(bounds.lesson - bounds.workspace)).toBeLessThan(2);
  expect(Math.abs(bounds.tutor - bounds.workspace)).toBeLessThan(2);
  await expect(page.locator('.message.assistant')).toContainText('CLI 运行超时');
  await expect(page.locator('.message.assistant')).not.toContainText(/等待|回复中/);
  await page.getByPlaceholder('这一段，我还有些疑问…').fill('重新提问');
  await expect(page.getByRole('button', { name: '发送 ↑' })).toBeEnabled();
});
test('A03/A18 离线示例、实验、独立练习与笔记', async ({ page }) => {
  await page.goto(app.origin + '/#bootstrap=' + app.mintBootstrap());
  await expect(page.getByRole('heading', { name: '今天，想理解什么？' })).toBeVisible();
  await page.getByRole('button', { name: '打开几何示例 →' }).click();
  await expect(page.getByRole('heading', { name: '直角三角形的面积', exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: '宽 4、高 3 的直角三角形，可用滑块调整尺寸。' }),
  ).toBeVisible();
  const width = page.getByLabel('width', { exact: true });
  await width.focus();
  await page.keyboard.press('ArrowRight');
  const savedWidth = await width.inputValue();
  await page.getByRole('button', { name: '单步', exact: true }).click();
  await page.getByRole('button', { name: '保存实验快照', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('实验快照已保存');
  await page.getByRole('button', { name: '开始练习 →' }).click();
  await page.getByRole('textbox', { name: '你的答案' }).fill('12');
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await expect(page.getByText('本次答对', { exact: true })).toBeVisible();
  // Keep the previous input visible while the next assignment is in flight.
  await page.route('**/api/v1/nodes/*/assignments', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '下一道独立练习 →' }).click();
  await expect(page.getByText('面积为 15，高为 5，底是多少？', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '你的答案' }).fill('6');
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await expect(page.getByText('独立作答证据 2/2 ✓ 达标')).toBeVisible();
  await page.getByPlaceholder('用自己的话，记录你理解的内容…').fill('面积是同底同高矩形的一半。');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await page.screenshot({ path: 'test-results/studio-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: '今天，想理解什么？' })).toBeVisible();
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: '直角三角形：从面积到勾股定理' }) })
    .click();
  await expect(page.getByPlaceholder('用自己的话，记录你理解的内容…')).toHaveValue(
    '面积是同底同高矩形的一半。',
  );
  await page.getByLabel('恢复实验快照').selectOption({ index: 1 });
  await expect(page.getByLabel('width', { exact: true })).toHaveValue(savedWidth);
  await expect(page.getByText('步骤 1/100', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '发送 ↑' })).toBeVisible();
  await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('A24 三种语言真实运行与取消', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(app.origin + '/#bootstrap=' + app.mintBootstrap());
  await page.getByRole('button', { name: '实验室', exact: true }).click();
  const output = page.getByLabel('实验输出');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(output).toContainText('[1,2,3,4,5]', { timeout: 35000 });
  await page
    .getByLabel('实验源码')
    .fill('console.log(typeof fetch, typeof process, typeof document);');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(output).toContainText('undefined undefined undefined');
  await page.getByLabel('实验源码').fill('while(true) {}');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(output).toContainText(/超时|interrupted/, { timeout: 10000 });
  await page.getByRole('button', { name: 'SQL', exact: true }).click();
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(output).toContainText('mean', { timeout: 35000 });
  await page.getByRole('button', { name: 'Python', exact: true }).click();
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(output).toContainText('[1, 2, 3, 4, 5]', { timeout: 35000 });
  await page
    .getByLabel('实验源码')
    .fill('import js\nprint(hasattr(js, "fetch"), hasattr(js, "document"))');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(output).toContainText('False False', { timeout: 35000 });
  await page.getByLabel('实验源码').fill('import numpy as np\nprint(np.array([1, 2, 3]).sum())');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(output).toContainText('6', { timeout: 35000 });
});
test('S08 离线力学路径可打开并保存实验状态', async ({ page }) => {
  await page.goto(app.origin + '/#bootstrap=' + app.mintBootstrap());
  await page.getByRole('button', { name: '打开力学示例 →' }).click();
  await expect(page.getByRole('heading', { name: '抛体运动的射程', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '抛体运动', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '单步', exact: true }).click();
  await page.getByRole('button', { name: '保存实验快照', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('实验快照已保存');
  await page.getByRole('button', { name: '开始练习 →' }).click();
  await page.getByRole('textbox', { name: '你的答案' }).fill('10');
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await expect(page.getByText('本次答对', { exact: true })).toBeVisible();
});
test('A22/A25/A26 三维截面与真实小网络训练', async ({ page }) => {
  await page.goto(app.origin + '/#bootstrap=' + app.mintBootstrap());
  await page.getByRole('button', { name: '实验室', exact: true }).click();
  await page.getByLabel('训练轮数').fill('10');
  await page.getByRole('button', { name: '开始真实训练', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('训练完成', { timeout: 35000 });
  const section = page.getByRole('region', { name: '立方体的平面截面', exact: true });
  await section.scrollIntoViewIfNeeded();
  await expect(section.locator('canvas')).toBeVisible({ timeout: 15000 });
  await section.getByLabel('angle', { exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(section.locator('.observations')).toContainText('area4');
  const molecule = page.getByRole('region', { name: '甲烷的理想四面体结构', exact: true });
  await molecule.scrollIntoViewIfNeeded();
  await expect(molecule.locator('canvas')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'test-results/spatial-lab.png' });
});
