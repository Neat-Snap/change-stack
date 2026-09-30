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
  const page = await browser.newPage({ viewport: { width: 1440, height: 720 }, colorScheme: 'dark' });
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
  const treeHeight = await page.getByTestId('tree-panel').evaluate(e => e.getBoundingClientRect().height);
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  expect(await page.getByTestId('tree-panel').evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThan(treeHeight);
  await expect(page.getByTestId('layer-button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Previous layer' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next layer' }).click();
  await expect(page.getByTestId('layer-summary')).toContainText('Adds error state');
  await page.getByRole('button', { name: 'Next layer' }).click();
  await expect(page.getByRole('button', { name: 'Next layer' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous layer' }).click();
  await page.getByRole('button', { name: 'Previous layer' }).click();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await expect(page.getByTestId('layer-button')).toHaveCount(3);
  await expect(page.getByTestId('tree-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse file tree' }).click();
  await expect(page.getByTestId('tree-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Expand file tree' }).click();
  await expect(page.getByTestId('tree-panel')).toBeVisible();
  await expect(page.getByText('Files', { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="sidebar-content"] [data-slot="separator"]')).toHaveCount(0);
  for (const label of ['Layers', 'Files']) {
    const heading = page.getByText(label, { exact: true });
    await expect(heading).toHaveCSS('text-transform', 'none');
    await expect(heading).toHaveCSS('font-size', '13px');
  }
  const toolbarIcons = await page.locator('[data-review-toolbar] svg').evaluateAll(elements =>
    elements.map(e => e.getBoundingClientRect()).filter(r => r.width > 0).map(r => [r.width, r.height]));
  expect(toolbarIcons.length).toBe(6);
  for (const dimensions of toolbarIcons) expect(dimensions).toEqual([16, 16]);
  const headingBottom = await page.getByRole('button', { name: 'Layers', exact: true }).evaluate(e => e.getBoundingClientRect().bottom);
  expect(await page.getByTestId('layers-panel').evaluate(e => e.getBoundingClientRect().top)).toBe(headingBottom);
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
  await expect.poll(() => page.getByTestId('diff-scroll').locator('.diff-viewport').evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => page.getByRole('region', { name: 'src/components/InviteForm.tsx' }).evaluate(e => e.getBoundingClientRect().top)).toBeLessThan(680);
  await expect(page.getByRole('region', { name: 'src/components/InviteForm.tsx' })).toBeVisible();
  await expect(page.locator('diffs-container').getByText('role=', { exact: false })).toBeVisible();
  await page.getByTestId('diff-scroll').locator('.diff-viewport').evaluate(e => { e.scrollTop = 0; });
  await tree.getByRole('treeitem', { name: /InviteForm/ }).click();
  await expect.poll(() => page.getByTestId('diff-scroll').locator('.diff-viewport').evaluate(e => e.scrollTop)).toBeGreaterThan(0);
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
  // A long patch must render a bounded window, while file jumps still reach its neighbors.
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.route('**/api/review', async route => {
    const response = await route.fetch();
    const session = await response.json();
    const lines = Array.from({ length: 6_000 }, (_, i) => `+export const entry_${i + 1} = ${i + 1};`).join('\n');
    session.review.files.unshift({ path: 'src/large.ts', oldPath: 'src/large.ts', status: 'added', additions: 6_000, deletions: 0, incomplete: false,
      patch: `diff --git a/src/large.ts b/src/large.ts\n--- /dev/null\n+++ b/src/large.ts\n@@ -0,0 +1,6000 @@\n${lines}\n` });
    session.analysis.layers[0].files.unshift('src/large.ts');
    await route.fulfill({ response, json: session });
  });
  await page.evaluate(hash => { location.hash = hash; }, new URL(url).hash);
  await expect(page.getByTestId('file-diff')).toHaveCount(3);
  await page.getByRole('button', { name: /All changes/ }).click();
  await expect(page.getByTestId('file-diff')).toHaveCount(5);
  const largeDiff = page.locator('diffs-container').first();
  await expect(largeDiff.locator('[data-line="1"]').first()).toBeVisible();
  expect(await largeDiff.locator('[data-line]').count()).toBeLessThan(500);
  await page.locator('.diff-viewport').evaluate(e => { e.scrollTop = 50_000; });
  await expect.poll(() => largeDiff.locator('[data-line]').count()).toBeGreaterThan(0);
  expect(await largeDiff.locator('[data-line]').count()).toBeLessThan(500);
  await page.locator('.file-tree').getByRole('treeitem', { name: /invitations.test/ }).click();
  await expect.poll(() => page.getByRole('region', { name: 'tests/invitations.test.ts' }).evaluate(e => e.getBoundingClientRect().top)).toBeLessThan(680);
  await expect(page.getByRole('region', { name: 'tests/invitations.test.ts' }).locator('diffs-container').getByText('expired invitations cannot add members', { exact: false })).toBeVisible();
  await expect(page.getByTestId('file-diff')).toHaveCount(5);
  // A long layer list must clip directly below its fixed section heading.
  await page.unroute('**/api/review');
  await page.route('**/api/review', async route => {
    const response = await route.fetch();
    const session = await response.json();
    session.analysis.layers = Array.from({ length: 30 }, (_, i) => ({
      id: `long-${i}`, title: `Layer ${i + 1} with a longer explanation`, summary: 'Review this change.',
      files: [`src/change-${i}.ts`], questions: [],
    }));
    session.review.files = session.analysis.layers.map((layer: { files: string[] }) => ({
      path: layer.files[0], oldPath: layer.files[0], status: 'modified', additions: 0, deletions: 0, patch: '', incomplete: false,
    }));
    await route.fulfill({ response, json: session });
  });
  await page.evaluate(hash => { location.hash = hash; }, new URL(url).hash);
  await expect(page.getByTestId('layer-button')).toHaveCount(30);
  const layersHeading = page.getByRole('button', { name: 'Layers', exact: true });
  const fixedBottom = await layersHeading.evaluate(e => e.getBoundingClientRect().bottom);
  const layersViewport = page.getByTestId('layers-scroll').locator('[data-slot="scroll-area-viewport"]');
  await layersViewport.evaluate(e => { e.scrollTop = e.scrollHeight; });
  await expect.poll(() => layersViewport.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  expect(await layersHeading.evaluate(e => e.getBoundingClientRect().bottom)).toBe(fixedBottom);
  expect(await layersViewport.evaluate(e => e.getBoundingClientRect().top)).toBe(fixedBottom);
  expect(await layersHeading.evaluate(e => {
    const r = e.getBoundingClientRect();
    return e.contains(document.elementFromPoint(r.x + 12, r.bottom - 2));
  })).toBe(true);
  await page.screenshot({ path: 'dist/demo-layers-scrolled.png', fullPage: true });
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log('Compiled binary UI passed: minimal shadcn layout, layers, Pierre diffs/tree, split/unified, mobile sidebar, and no external requests.');
} finally {
  await browser?.close(); child.kill();
}
