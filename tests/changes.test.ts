import { expect, test } from 'bun:test';
import { parsePatchFiles } from '@pierre/diffs';
import { changeUnits, layerFile, wholeRanges } from '../src/core/changes';
import { validateRangeLayers } from '../src/core/analysis';
import { makePatch } from '../src/core/providers';
import type { ChangedFile } from '../src/core/types';

const file: ChangedFile = { path: 'src/a.ts', oldPath: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, incomplete: false,
  patch: makePatch('src/a.ts', 'src/a.ts', 'modified', '@@ -2,4 +2,6 @@\n context\n-oldName();\n+newName();\n+log();\n tail\n+other();\n end\n') };

test('one file and one edit block can contribute to separate layers with exact source coordinates', () => {
  const units = changeUnits(file);
  const result = validateRangeLayers({ summary: 'Two concerns', layers: [
    { title: 'Rename', summary: 'Rename call', ranges: [{ changeId: units[0].id, start: 1, end: 2 }], questions: [] },
    { title: 'Log', summary: 'Log call', ranges: [{ changeId: units[0].id, start: 3, end: 3 }], questions: [] },
  ] }, units, 'test');
  expect(result.layers.map(l => l.files)).toEqual([['src/a.ts'], ['src/a.ts'], ['src/a.ts']]);
  const rename = layerFile(file, result.layers[0].ranges!);
  const log = layerFile(file, result.layers[1].ranges!);
  expect(rename.patch).toContain('-oldName();\n+newName();'); expect(rename.patch).not.toContain('+log();'); expect(rename.patch).not.toContain('other();');
  expect(log.patch).toContain('@@ -4,1 +4,2 @@'); expect(log.patch).toContain('+log();'); expect(log.patch).not.toContain('newName();');
  expect(parsePatchFiles(rename.patch, undefined, true)[0].files[0].additionLines).toContain('newName();\n');
  expect(parsePatchFiles(log.patch, undefined, true)[0].files[0].hunks[0].additionStart).toBe(4);
  expect(result.layers[2].ranges).toEqual([{ changeId: units[1].id, start: 1, end: 1 }]);
});

test('invented, reversed, out-of-bounds and overlapping ranges are rejected', () => {
  const units = changeUnits(file);
  for (const ranges of [
    [{ changeId: 'invented', start: 1, end: 1 }], [{ changeId: units[0].id, start: 2, end: 1 }],
    [{ changeId: units[0].id, start: 0, end: 1 }], [{ changeId: units[0].id, start: 1, end: 100 }],
    [{ changeId: units[0].id, start: 1, end: 2 }, { changeId: units[0].id, start: 2, end: 3 }],
  ]) expect(() => validateRangeLayers({ summary: '', layers: [{ title: '', summary: '', questions: [], ranges }] }, units, 'test')).toThrow();
});

test('context expansion stops before an edit belonging to another layer', () => {
  const units = changeUnits(file);
  const expanded = layerFile(file, [{ changeId: units[0].id, start: 1, end: 2 }], 23, {
    old: 'before\ncontext\noldName();\ntail\nend\nafter\n', current: 'before\ncontext\nnewName();\nlog();\ntail\nother();\nend\nafter\n',
  });
  expect(expanded.patch).toContain(' before');
  expect(expanded.patch).not.toContain('log();'); expect(expanded.patch).not.toContain('other();');
  expect(parsePatchFiles(expanded.patch, undefined, true)[0].files).toHaveLength(1);
});

test('all assigned ranges preserve every edit including deletions and distant hunks', () => {
  const selected = layerFile(file, wholeRanges([file]));
  expect(selected.additions).toBe(file.additions); expect(selected.deletions).toBe(file.deletions);
  expect(parsePatchFiles(selected.patch, undefined, true)[0].files).toHaveLength(1);
  const added = { ...file, status: 'added' as const, patch: makePatch(file.path, file.path, 'added', '@@ -0,0 +1,3 @@\n+one\n+two\n+three\n') };
  const unit = changeUnits(added)[0];
  const patch = layerFile(added, [{ changeId: unit.id, start: 2, end: 2 }]).patch;
  expect(patch).toContain('@@ -0,0 +2,1 @@');
  expect(parsePatchFiles(patch, undefined, true)[0].files[0].hunks[0].additionStart).toBe(2);
});

test('analysis asks the model for row assignments and accepts multiple layers in one file', async () => {
  const { analyze } = await import('../src/core/analysis');
  const { demoSession } = await import('../src/core/demo');
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as any;
    const prompt = body.messages[1].content;
    expect(prompt).toContain('A single file can appear in multiple layers');
    const changes = JSON.parse(prompt.split('Review data:\n')[1]).changes;
    const unit = changes[0];
    return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'Rename and logging.', layers: [
      { title: 'Rename', summary: 'Rename', questions: [], ranges: [{ changeId: unit.changeId, start: 1, end: 2 }] },
      { title: 'Logging', summary: 'Logging', questions: [], ranges: [{ changeId: unit.changeId, start: 3, end: 3 }] },
    ] }) } }] });
  } });
  try {
    const result = await analyze({ ...demoSession().review, files: [file] }, { baseUrl: server.url.origin, model: 'test', apiKey: 'test' });
    expect(result.source).toBe('model'); expect(result.layers[0].files).toEqual(result.layers[1].files);
    expect(result.layers[0].ranges![0].end).toBe(2); expect(result.layers[1].ranges![0].start).toBe(3);
  } finally { server.stop(true); }
});

test('no-newline markers stay with their changed line and are not assignable as code', () => {
  const noNewline = { ...file, patch: makePatch(file.path, file.path, 'modified', '@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n') };
  const units = changeUnits(noNewline); expect(units[0].lines).toEqual(['-old', '+new']);
  const selected = layerFile(noNewline, [{ changeId: units[0].id, start: 2, end: 2 }]);
  expect(selected.patch).toContain('+new\n\\ No newline at end of file');
  expect(selected.patch).not.toContain('-old');
  expect(parsePatchFiles(selected.patch, undefined, true)[0].files).toHaveLength(1);
});

test('expanding neighboring hunks merges overlapping context instead of duplicating lines', () => {
  const distant = { ...file, patch: makePatch(file.path, file.path, 'modified', '@@ -3 +3 @@\n-old_3\n+new_3\n@@ -9 +9 @@\n-old_9\n+new_9\n') };
  const old = Array.from({ length: 30 }, (_, i) => [3, 9].includes(i + 1) ? `old_${i + 1}` : `unchanged_${i + 1}`).join('\n');
  const current = old.replace('old_3', 'new_3').replace('old_9', 'new_9');
  const expanded = layerFile(distant, wholeRanges([distant]), 23, { old, current });
  expect(expanded.patch.match(/ unchanged_5/g)).toHaveLength(1);
  expect(expanded.additions).toBe(2); expect(expanded.deletions).toBe(2);
  expect(parsePatchFiles(expanded.patch, undefined, true)[0].files[0].hunks).toHaveLength(1);
});

test('model assignment order cannot reverse the source order of rendered hunks', () => {
  const distant = { ...file, patch: makePatch(file.path, file.path, 'modified', '@@ -3 +3 @@\n-old_3\n+new_3\n@@ -9 +9 @@\n-old_9\n+new_9\n') };
  const result = layerFile(distant, wholeRanges([distant]).reverse());
  expect(parsePatchFiles(result.patch, undefined, true)[0].files[0].hunks.map(h => h.additionStart)).toEqual([3, 9]);
});
