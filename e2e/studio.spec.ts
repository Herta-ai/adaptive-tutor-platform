import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Store } from '../src/storage/database';
import { createApplication } from '../src/server/http';
let root: string, store: Store, app: ReturnType<typeof createApplication>, web: any;
test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tutor-e2e-'));
  store = new Store(root);
  const next = createRequire(import.meta.url)('next');
  web = next({ dev: false, dir: process.cwd() });
  await web.prepare();
  app = createApplication(store, { handlePage: web.getRequestHandler() });
  await app.listen();
});
test.afterAll(async () => {
  await app?.close();
  await web?.close();
  store?.close();
  if (root) rmSync(root, { recursive: true, force: true });
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
  await page.getByRole('button', { name: '下一道独立练习 →' }).click();
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
