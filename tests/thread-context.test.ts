import { expect, test } from 'bun:test';
import { diffSnippet, changeUnits } from '../src/core/changes';
import { makePatch } from '../src/core/providers';
import { demoSession } from '../src/core/demo';
import { threadContext } from '../src/web/thread-context';
import type { ChangedFile, Layer, ReviewThread } from '../src/core/types';

const file: ChangedFile = { path: 'src/a.ts', oldPath: 'src/a.ts', status: 'modified', additions: 3, deletions: 2, incomplete: false,
  patch: makePatch('src/a.ts', 'src/a.ts', 'modified', '@@ -10,5 +20,6 @@\n before();\n-old();\n+renamed();\n+log();\n middle();\n-later();\n+laterNew();\n end();\n') };
const review = { ...demoSession().review, files: [file] };
const units = changeUnits(file);
const layers: Layer[] = [
  { id: 'rename', title: 'Rename', summary: '', files: [file.path], ranges: [{ changeId: units[0].id, start: 1, end: 2 }] },
  { id: 'log', title: 'Log', summary: '', files: [file.path], ranges: [{ changeId: units[0].id, start: 3, end: 3 }] },
  { id: 'later', title: 'Later', summary: '', files: [file.path], ranges: [{ changeId: units[1].id, start: 1, end: 2 }] },
];
const thread = (line: number, side: 'old' | 'current' = 'current'): ReviewThread => ({ id: 't', kind: 'diff', comments: [], resolved: false, resolvable: true, canReply: true, canResolve: true,
  position: { path: file.path, line, side } });

test('snippet aligns old/new counters, highlights the correct side, and stays within its hunk', () => {
  const old = diffSnippet(file, { start: 11, end: 11, side: 'old' })!;
  expect(old.filter(row => !('omitted' in row) && row.selected)).toEqual([{ kind: '-', old: 11, current: 21, text: 'old();', selected: true }]);
  const current = diffSnippet(file, { start: 22, end: 22, side: 'current' })!;
  expect(current.filter(row => !('omitted' in row) && row.selected)).toEqual([{ kind: '+', old: 12, current: 22, text: 'log();', selected: true }]);
  expect(diffSnippet(file, { start: 200, end: 200, side: 'current' })).toBeUndefined();
  expect(diffSnippet(file, { start: 11, side: 'old', end: 21, endSide: 'current' })!.filter(row => !('omitted' in row) && row.selected).map(row => 'text' in row ? row.text : '')).toEqual(['old();', 'renamed();']);
  const distant = { ...file, patch: file.patch + '@@ -100 +110 @@\n-last();\n+lastNew();\n' };
  expect(diffSnippet(distant, { start: 22, end: 110, side: 'current' })).toBeUndefined();
});

test('thread destinations use the exact layer rows rather than every layer in its file', () => {
  expect(threadContext(review, layers, thread(21))!.destinations.map(d => d.layer.id)).toEqual(['rename']);
  expect(threadContext(review, layers, thread(22))!.destinations.map(d => d.layer.id)).toEqual(['log']);
  expect(threadContext(review, layers, thread(11, 'old'))!.destinations.map(d => ({ id: d.layer.id, side: d.side, line: d.line }))).toEqual([{ id: 'rename', line: 11, side: 'old' }]);
  const range = thread(22); range.position!.startLine = 21;
  expect(threadContext(review, layers, range)!.destinations.map(d => ({ id: d.layer.id, line: d.line }))).toEqual([{ id: 'rename', line: 21 }, { id: 'log', line: 22 }]);
  expect(threadContext(review, layers, { ...thread(21), outdated: true })).toBeUndefined();
  const renamed = { ...file, oldPath: 'src/old.ts', status: 'renamed' as const };
  const oldThread = thread(11, 'old'); oldThread.position!.path = renamed.oldPath;
  expect(threadContext({ ...review, files: [renamed] }, layers, oldThread)!.destinations.map(d => d.layer.id)).toEqual(['rename']);
});

test('long snippets stay compact without losing layer destinations in the omitted middle', () => {
  const large = { ...file, patch: makePatch(file.path, file.path, 'added', '@@ -0,0 +1,30 @@\n' + Array.from({ length: 30 }, (_, i) => `+line${i + 1}`).join('\n') + '\n') };
  const unit = changeUnits(large)[0];
  const largeLayers = [{ ...layers[0], id: 'middle', ranges: [{ changeId: unit.id, start: 12, end: 15 }] }];
  const range = thread(30); range.position!.startLine = 1;
  const context = threadContext({ ...review, files: [large] }, largeLayers, range)!;
  expect(context.rows).toHaveLength(9); expect(context.rows[4]).toEqual({ omitted: 22 });
  expect(context.destinations.map(d => ({ id: d.layer.id, line: d.line }))).toEqual([{ id: 'middle', line: 15 }]);
});
