import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startServer } from '../src/server';
import { demoSession } from '../src/core/demo';
import { addDiffAnchors, CommentError, makePatch } from '../src/core/providers';
import { originDiffUrl } from '../src/core/changes';
import { parseTarget } from '../src/core/target';
import type { CommentInput, Provider } from '../src/core/types';
import { checkSelection } from './check-selection';

// A local handler exercises the real UI and endpoint without sending service comments.
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHANGE_STACK_CHROMIUM });
const errors: string[] = [];
async function drag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const first = (await from.boundingBox())!, last = (await to.boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 6 });
  await page.mouse.up();
}
try {
  await mkdir('dist', { recursive: true });
  for (const provider of ['gitlab', 'github'] as Provider[]) {
    await checkSelection(browser, provider);
    const session = demoSession(); session.commentsEnabled = true;
    session.review.target = parseTarget(provider === 'gitlab'
      ? 'https://gitlab.example/team/repo/-/merge_requests/7' : 'https://github.com/team/repo/pull/7');
    session.review.files = ['src/first.ts', 'src/second.ts'].map(path => ({ path, oldPath: path, status: 'modified' as const,
      patch: makePatch(path, path, 'modified', '@@ -50,3 +40,4 @@\n before();\n-old();\n+current();\n+extra();\n after();\n'), additions: 2, deletions: 1, incomplete: false }));
    addDiffAnchors(session.review);
    session.analysis.layers = [
      { id: 'rename', title: 'Rename calls', summary: 'Renames the calls.', files: session.review.files.map(f => f.path), ranges: session.review.files.map(f => ({ changeId: f.path + '#0:1', start: 1, end: 2 })) },
      { id: 'extra', title: 'Add extra calls', summary: 'Adds extra calls.', files: session.review.files.map(f => f.path), ranges: session.review.files.map(f => ({ changeId: f.path + '#0:1', start: 3, end: 3 })) },
    ];
    session.analysis.groups = undefined;
    const comments: CommentInput[] = [];
    const { server, url } = startServer(session, undefined, 0, undefined, '127.0.0.1', undefined, async input => {
      comments.push(input);
      await Bun.sleep(150);
      if (input.body === 'reject') throw new CommentError('Prototype rejection');
      return { url: 'https://example.test/comment/1' };
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).origin !== server.url.origin) errors.push(`Unexpected external request: ${request.url()}`); });
    try {
      await page.goto(url);
      const region = page.getByRole('region', { name: 'src/first.ts', exact: true });
      const newLine = (line: number) => region.locator(`[data-additions] [data-column-number="${line}"]`).first();
      await newLine(41).click();
      await page.waitForTimeout(150);
      await expect(page.getByTestId('line-actions')).toHaveCount(0);
      await expect(page.getByTestId('line-actions')).toBeVisible();
      const service = provider === 'github' ? 'GitHub' : 'GitLab';
      await expect(page.getByRole('link', { name: `Open in ${service}` })).toHaveAttribute('href', originDiffUrl(session.review, session.review.files[0]!, { side: 'current', start: 41, end: 41 }));
      await page.screenshot({ path: `dist/line-actions-${provider}.png` });
      await page.getByRole('button', { name: 'Comment', exact: true }).click();
      await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('reject');
      await newLine(40).click(); // Selecting elsewhere must preserve the draft and anchor.
      await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('reject');
      const other = page.getByRole('region', { name: 'src/second.ts', exact: true });
      await other.locator('[data-deletions] [data-column-number="51"]').click();
      await expect(other.getByTestId('line-actions')).toBeVisible();
      await other.getByRole('button', { name: 'Comment', exact: true }).click();
      await other.getByRole('textbox', { name: 'Comment', exact: true }).fill('Second-file draft');
      await page.keyboard.press('Escape');
      await expect(other.getByTestId('line-actions')).toHaveCount(0);
      await expect(region.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('reject');
      await page.getByRole('button', { name: `Post to ${service}` }).click();
      await expect(page.getByRole('alert')).toHaveText('Prototype rejection');
      await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('reject');
      await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Looks good');
      // An open draft must stay usable when the viewport shrinks.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(async () => {
        const bounds = (await page.getByTestId('line-actions').boundingBox())!;
        return bounds.x >= 0 && bounds.x + bounds.width <= 390;
      }).toBe(true);
      await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Looks good');
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({ path: `dist/line-comment-${provider}.png` });
      await page.getByRole('textbox', { name: 'Comment', exact: true }).press('Control+Enter');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Cancel comment' })).toBeDisabled();
      await page.keyboard.press('Control+Enter');
      await expect(page.getByRole('link', { name: 'Posted · view' })).toHaveAttribute('href', 'https://example.test/comment/1');
      expect(comments).toHaveLength(2);
      expect(comments[1]).toMatchObject({ path: 'src/first.ts', side: 'current', start: 41, end: 41, body: 'Looks good' });
      await page.keyboard.press('Escape');
      await newLine(40).click();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1100);
      await expect(page.getByTestId('line-actions')).toHaveCount(0);
      await newLine(41).click();
      await page.getByTestId('layer-summary').click();
      await page.waitForTimeout(1100);
      await expect(page.getByTestId('line-actions')).toHaveCount(0);

      // Reusing the whole-file panel for another path must discard the first file's draft.
      await page.getByRole('button', { name: 'Show whole file src/first.ts' }).click();
      const panel = page.getByTestId('side-panel');
      await panel.locator('[data-column-number="41"][data-line-type="change-addition"]').click();
      await expect(panel.getByTestId('line-actions')).toBeVisible();
      await panel.getByRole('button', { name: 'Comment', exact: true }).click();
      await panel.getByRole('textbox', { name: 'Comment', exact: true }).fill('Panel comment');
      await panel.getByRole('button', { name: `Post to ${service}` }).click();
      await page.keyboard.press('Escape');
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Cancel comment' })).toBeDisabled();
      await expect(panel.getByRole('link', { name: 'Posted · view' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId('line-actions')).toHaveCount(0);
      await panel.locator('[data-column-number="42"][data-line-type="change-addition"]').click();
      await expect(panel.getByTestId('line-actions')).toBeVisible();
      await panel.getByRole('button', { name: 'Comment', exact: true }).click();
      await panel.getByRole('textbox', { name: 'Comment', exact: true }).fill('First-file draft');
      // The overlaid panel covers this toolbar; invoke its action to exercise reuse.
      await page.getByRole('button', { name: 'Show whole file src/second.ts' }).dispatchEvent('click');
      await expect(panel.getByTestId('line-actions')).toHaveCount(0);
      await page.getByRole('button', { name: 'Close panel' }).click();

      await page.getByRole('button', { name: /All changes/ }).click();
      await page.getByRole('tab', { name: 'Unified', exact: true }).click();
      const old = region.locator('[data-column-number="51"][data-line-type="change-deletion"]').first();
      const current = region.locator('[data-column-number="41"][data-line-type="change-addition"]').first();
      await drag(page, current, old); // Reverse cross-side drag; old/new numbers differ.
      await expect(page.getByTestId('line-actions')).toBeVisible();
      await expect(page.getByRole('link', { name: `Open in ${service}` })).toHaveAttribute('href', originDiffUrl(session.review, session.review.files[0]!, { side: 'old', start: 51, end: 41, endSide: 'current' }));
      await page.getByRole('button', { name: 'Comment', exact: true }).click();
      await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Both sides');
      await page.getByRole('button', { name: `Post to ${service}` }).click();
      await expect(page.getByRole('link', { name: 'Posted · view' })).toBeVisible();
      expect(comments[3]).toMatchObject({ path: 'src/first.ts', side: 'old', start: 51, endSide: 'current', end: 41 });
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 390, height: 844 });
      await current.click();
      await expect(page.getByTestId('line-actions')).toBeVisible();
      await page.getByRole('button', { name: 'Comment', exact: true }).click();
      const bounds = (await page.getByTestId('line-actions').boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
      console.log(`${provider}: delayed actions, links, draft preservation, rejection, posting, dismissal, file switches, and cross-side range passed.`);
    } finally { await page.close(); server.stop(true); }
  }
  if (errors.length) throw new Error(errors.join('; '));
} finally { await browser.close(); }
