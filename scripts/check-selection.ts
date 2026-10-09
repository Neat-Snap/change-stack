import { expect, type Browser } from '@playwright/test';
import { startServer } from '../src/server';
import { demoSession } from '../src/core/demo';
import { addDiffAnchors, makePatch } from '../src/core/providers';
import { parseTarget } from '../src/core/target';
import type { Provider, ReviewThread } from '../src/core/types';

// Local provider fixtures: these checks never post to GitHub or GitLab.
export async function checkSelection(browser: Browser, provider: Provider) {
  const session = demoSession();
  session.commentsEnabled = session.conversationsEnabled = true;
  session.review.target = parseTarget(provider === 'gitlab'
    ? 'https://gitlab.example/team/repo/-/merge_requests/7' : 'https://github.com/team/repo/pull/7');
  session.review.baseSha = 'base';
  session.review.files = [{ path: 'selection.ts', oldPath: 'selection.ts', status: 'modified', incomplete: false, additions: 2, deletions: 2,
    patch: makePatch('selection.ts', 'selection.ts', 'modified', '@@ -10,3 +10,3 @@\n before();\n-old();\n+current();\n after();\n@@ -30,3 +30,3 @@\n later();\n-oldAgain();\n+currentAgain();\n end();\n') }];
  addDiffAnchors(session.review);
  session.analysis.layers = [{ id: 'selection', title: 'Selection checks', summary: 'Selection fixture.', files: ['selection.ts'] }];
  session.analysis.groups = undefined;
  const thread: ReviewThread = { id: 'selection-thread', kind: 'diff', resolved: false, resolvable: true, canResolve: true, canReply: true,
    position: { path: 'selection.ts', line: 11, side: 'current' }, comments: [{ id: 'first', author: 'reviewer', body: 'Original comment', createdAt: new Date().toISOString(), url: session.review.target.url }] };
  const source = Array.from({ length: 45 }, (_, i) => `context${i + 1}();`);
  source.splice(9, 3, 'before();', 'current();', 'after();');
  source.splice(29, 3, 'later();', 'currentAgain();', 'end();');
  const old = [...source]; old[10] = 'old();'; old[30] = 'oldAgain();';
  const { server, url } = startServer(session, undefined, 0, undefined, '127.0.0.1', {
    context: async () => ({ old: old.join('\n'), current: source.join('\n') }),
    lookup: async () => ({ symbol: '', matches: [], scanned: 0, unavailable: 0, limited: false }),
  }, async () => ({ url: session.review.target.url }), {
    load: async () => ({ threads: structuredClone([thread]), fetchedAt: new Date().toISOString(), reviewChanged: false }),
    reply: async () => {}, resolve: async () => {}, comment: async () => {},
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url);
    await page.getByRole('button', { name: /All changes/ }).click();
    const region = page.getByRole('region', { name: 'selection.ts', exact: true });
    let unified = false;
    const line = (number: number, side = 'additions') => region.locator(unified
      ? `[data-column-number="${number}"]${side === 'deletions' ? '[data-line-type="change-deletion"]' : ':not([data-line-type="change-deletion"])'}`
      : `[data-${side}] [data-column-number="${number}"]`).first();
    const actions = region.getByTestId('line-actions');
    const highlighted = (number: number, side = 'additions') => line(number, side).and(region.locator('[data-selected-line]'));
    const inline = region.locator('[data-thread-id="selection-thread"]');
    const refresh = async () => {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/conversation');
      // Start the same refresh without interrupting a held selection gesture.
      await page.getByRole('button', { name: 'Refresh conversation', exact: true }).dispatchEvent('click');
      await response;
      await expect(inline).toContainText(thread.comments.at(-1)!.body);
    };
    await expect(inline).toBeVisible();
    for (const layout of ['Split', 'Unified']) {
      await page.getByRole('tab', { name: layout, exact: true }).click();
      unified = layout === 'Unified';
      await line(12).click(); // Selecting the same single line again intentionally toggles it off.
      await line(10).click();
      await expect(actions).toBeVisible();
      await expect(highlighted(10)).toHaveCount(1);
      // A changed annotation and an unchanged poll both preserve the selection.
      thread.comments.push({ ...thread.comments[0]!, id: `update-${layout}`, body: `Updated comment ${layout}` });
      await refresh(); await refresh();
      await expect(highlighted(10)).toHaveCount(1);
      await expect(actions).toBeVisible();
      await page.keyboard.press('Escape');

      // Finish a drag over an inline thread, where pointer-up used to be swallowed.
      const start = (await line(10).boundingBox())!;
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      thread.comments.push({ ...thread.comments[0]!, id: `drag-${layout}`, body: `Changed during drag ${layout}` });
      await refresh();
      const finish = (await inline.boundingBox())!;
      await page.mouse.move(finish.x + finish.width / 2, finish.y + 15, { steps: 5 });
      await page.mouse.up();
      await expect(actions).toBeVisible();
      await page.keyboard.press('Escape');

      // A pointer release outside the patch still completes the last valid range.
      const outsideStart = (await line(10).boundingBox())!, outsideEnd = (await line(12).boundingBox())!;
      await page.mouse.move(outsideStart.x + outsideStart.width / 2, outsideStart.y + outsideStart.height / 2);
      await page.mouse.down();
      await page.mouse.move(outsideEnd.x + outsideEnd.width / 2, outsideEnd.y + outsideEnd.height / 2, { steps: 5 });
      const bounds = (await region.boundingBox())!;
      await page.mouse.move(bounds.x - 10, outsideEnd.y + outsideEnd.height / 2);
      await page.mouse.up();
      await expect(actions).toBeVisible();
      await expect(highlighted(12)).toHaveCount(1);
      await page.keyboard.press('Escape');

      // Navigation highlights must not turn subsequent mouse selections into controlled, frozen lines.
      await page.getByRole('button', { name: /^Conversation/ }).click();
      await page.getByTestId('conversation-view').getByRole('button', { name: 'View in diff', exact: true }).click();
      await expect(page.getByTestId('conversation-view')).toHaveCount(0);
      await expect(highlighted(11)).toHaveCount(1);
      await line(12).click();
      await expect(highlighted(12)).toHaveCount(1);
      await expect(highlighted(11)).toHaveCount(0);
      await expect(actions).toBeVisible();
      await expect(actions.getByRole('button', { name: 'Comment', exact: true })).toBeEnabled();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Conversation/ }).click();
      await page.getByTestId('conversation-view').getByRole('button', { name: '1. Selection checks', exact: true }).click();
      await expect(highlighted(11)).toHaveCount(1);
      await expect(actions).toHaveCount(0); // A programmatic jump offers no pointer actions.
      await line(10).click();
      await expect(highlighted(10)).toHaveCount(1);
      await expect(actions.getByRole('button', { name: 'Comment', exact: true })).toBeEnabled();
      await page.keyboard.press('Escape');
    }
    await line(11).click();
    await actions.getByRole('button', { name: 'Comment', exact: true }).click();
    await actions.getByRole('textbox', { name: 'Comment', exact: true }).fill('Draft survives an actual annotation update');
    thread.comments.push({ ...thread.comments[0]!, id: 'draft-update', body: 'Updated with draft open' });
    await refresh();
    await expect(actions.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Draft survives an actual annotation update');
    await page.keyboard.press('Escape');
    // The original hunks constrain provider comments; expose a reason instead of hiding the action.
    await line(10).click(); await line(30).click({ modifiers: ['Shift'] });
    await expect(actions).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Comment', exact: true })).toBeDisabled();
    await expect(actions).toContainText('Select lines within one diff hunk');
    await page.keyboard.press('Escape');
    await region.getByRole('button', { name: 'Collapse selection.ts' }).hover();
    await page.getByRole('button', { name: 'Expand context selection.ts' }).click();
    await line(8).click();
    await expect(actions).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Comment', exact: true })).toBeDisabled();
    await expect(actions).toContainText('Select a line in the original diff');
    await page.keyboard.press('Escape');
    await line(11, 'deletions').click();
    await expect(actions.getByRole('button', { name: 'Comment', exact: true })).toBeEnabled();
    // A read-only session should also show why commenting is unavailable.
    await page.route('**/api/review', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), commentsEnabled: false } });
    });
    await page.reload();
    await page.getByRole('tab', { name: 'Unified', exact: true }).click();
    await line(11).click();
    await expect(actions.getByRole('button', { name: 'Comment', exact: true })).toBeDisabled();
    await expect(actions).toContainText('Commenting is unavailable for this review');
    if (errors.length) throw new Error(errors.join('; '));
    console.log(`${provider}: selection survives changed/unchanged refresh, thread drag, diff jumps, and layouts; unsupported comments explain why.`);
  } finally { await page.close(); server.stop(true); }
}
