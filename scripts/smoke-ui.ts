import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const child = Bun.spawn([resolve('dist/cstack'), '--demo', '--no-open'], { stdout: 'pipe', stderr: 'pipe', cwd: tmpdir() });
const reader = child.stdout.getReader();
let output = '';
let browser;
try {
  let url: string | undefined;
  while (!url) {
    const { done, value } = await reader.read();
    if (done) throw new Error('Binary exited before opening the review.');
    output += new TextDecoder().decode(value);
    url = output.match(/http:\/\/127\.0\.0\.1:\d+\/#session=[a-f0-9-]+/)?.[0];
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHANGE_STACK_CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark' });
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'All changes' })).toBeVisible();
  await expect(page.getByTestId('layer-button')).toHaveCount(3);
  await expect(page.locator('[data-slot="sidebar"]')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('Change Stack', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export notes' })).toHaveCount(0);
  await expect(page.getByTestId('file-diff')).toHaveCount(2);
  await page.screenshot({ path: 'dist/demo-overview.png', fullPage: true });
  const fontBefore = await page.getByTestId('layer-button').nth(1).evaluate(e => getComputedStyle(e).fontWeight);
  await page.getByTestId('layer-button').nth(1).click();
  expect(await page.getByTestId('layer-button').nth(1).evaluate(e => getComputedStyle(e).fontWeight)).toBe(fontBefore);
  await expect(page.getByTestId('layer-summary')).toContainText('Adds error state');
  await expect(page.getByTestId('file-diff')).toHaveCount(1);
  await page.getByTestId('layer-button').nth(1).hover();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.getByTestId('layer-summary').locator('ul li')).toHaveCount(2);
  await expect(page.getByTestId('layer-summary').locator('code')).toContainText('sendInvitation');
  await page.getByRole('checkbox', { name: 'Mark src/components/InviteForm.tsx as reviewed', exact: true }).check();
  await expect(page.locator('[data-testid="file-diff-content"]:visible')).toHaveCount(0);
  await expect(page.getByTestId('file-diff')).toHaveCount(1);
  await page.getByRole('button', { name: /All changes/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Mark src/components/InviteForm.tsx as reviewed', exact: true })).toBeChecked();
  await expect(page.getByTestId('file-diff')).toHaveCount(4);
  await expect(page.locator('[data-testid="file-diff-content"]:visible')).toHaveCount(3);
  await page.getByRole('button', { name: 'Expand src/components/InviteForm.tsx', exact: true }).click();
  await expect(page.locator('[data-testid="file-diff-content"]:visible')).toHaveCount(4);
  await page.getByRole('checkbox', { name: 'Mark src/components/InviteForm.tsx as reviewed', exact: true }).uncheck();
  await page.getByTestId('layer-button').nth(1).click();
  await expect(page.getByRole('region', { name: 'src/components/InviteForm.tsx' })).toBeVisible();
  // A fresh launch link must reinitialize an already-open review tab.
  await page.evaluate(hash => { location.hash = hash; }, new URL(url).hash);
  await expect(page.getByTestId('file-diff')).toHaveCount(2);
  await page.getByTestId('layer-button').nth(1).click();
  await page.getByRole('tab', { name: 'Unified', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Unified' })).toHaveAttribute('data-state', 'active');
  await page.screenshot({ path: 'dist/demo-diff.png', fullPage: true });
  const tree = page.locator('.file-tree');
  await expect(tree.getByRole('treeitem').first()).toBeVisible();
  await page.getByRole('button', { name: /All changes/ }).click();
  await expect(page.getByTestId('file-diff')).toHaveCount(4);
  await expect(page.getByTestId('pr-summary')).toBeVisible();
  await tree.getByRole('treeitem', { name: /InviteForm/ }).click({ timeout: 5000 });
  await expect(page.getByTestId('file-diff')).toHaveCount(4);
  await expect.poll(() => page.locator('[data-radix-scroll-area-viewport]').evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => page.getByRole('region', { name: 'src/components/InviteForm.tsx' }).evaluate(e => e.getBoundingClientRect().top)).toBeLessThan(860);
  await expect(page.getByRole('region', { name: 'src/components/InviteForm.tsx' })).toBeVisible();
  await expect(page.locator('diffs-container').getByText('role=', { exact: false })).toBeVisible();
  await page.locator('[data-radix-scroll-area-viewport]').evaluate(e => { e.scrollTop = 0; });
  await tree.getByRole('treeitem', { name: /InviteForm/ }).click();
  await expect.poll(() => page.locator('[data-radix-scroll-area-viewport]').evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  for (const [label, id] of [['GitLab dark', 'gitlab-dark'], ['GitLab light', 'gitlab-light'], ['GitHub light', 'github-light'], ['GitHub dark', 'github-dark']]) {
    await page.getByRole('combobox', { name: 'Theme' }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', id!);
    await expect(page.locator('diffs-container').first()).toBeAttached();
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  if (requests.some(request => new URL(request).origin !== new URL(url!).origin)) throw new Error('Demo made a request outside localhost.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('layer-button').nth(2).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'tests/invitations.test.ts' })).toBeVisible();
  await page.screenshot({ path: 'dist/demo-mobile.png', fullPage: true });
  console.log('Compiled binary UI passed: minimal shadcn layout, layers, Pierre diffs/tree, split/unified, mobile sidebar, and no external requests.');
} finally {
  await browser?.close(); child.kill();
}
