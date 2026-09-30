import { expect, test } from 'bun:test';
import { changeUnits, partAnchors } from '../src/core/changes';
import { validateOrganization, validateParts, validateRangeLayers } from '../src/core/analysis';
import { makePatch } from '../src/core/providers';
import type { ChangedFile, Layer } from '../src/core/types';

const file: ChangedFile = { path: 'src/a.ts', oldPath: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, incomplete: false,
  patch: makePatch('src/a.ts', 'src/a.ts', 'modified', '@@ -2,4 +2,6 @@\n context\n-oldName();\n+newName();\n+log();\n tail\n+other();\n end\n') };
const layer = (id: string): Layer => ({ id, title: id, summary: '', files: [] });

test('layer categories are kept as short free text', () => {
  const units = changeUnits(file);
  const result = validateRangeLayers({ summary: '', layers: [{ title: 'Rename', category: '  Refactor ', summary: '', ranges: [{ changeId: units[0]!.id, start: 1, end: 3 }] }] }, units, 't');
  expect(result.layers[0]!.category).toBe('Refactor');
  expect(() => validateRangeLayers({ summary: '', layers: [{ title: 'x', category: 3, summary: '', ranges: [] }] }, units, 't')).toThrow();
});

test('organization groups layers contiguously and keeps only dependencies on earlier layers', () => {
  const layers = ['a', 'b', 'c', 'd'].map(layer);
  const result = validateOrganization({ order: ['a', 'b', 'c', 'd'],
    groups: [{ title: 'Server', layers: ['a', 'c'] }, { title: 'Client', layers: ['b', 'd'] }],
    dependencies: [{ layer: 'c', dependsOn: ['a', 'c', 'missing'] }, { layer: 'a', dependsOn: ['c'] }, { layer: 'd', dependsOn: ['b'] }] }, layers);
  expect(result.layers.map(l => l.id)).toEqual(['a', 'c', 'b', 'd']);
  expect(result.groups!.map(g => [g.title, g.layers])).toEqual([['Server', ['a', 'c']], ['Client', ['b', 'd']]]);
  expect(result.layers.map(l => l.dependsOn)).toEqual([undefined, ['a'], undefined, ['b']]);
});

test('invalid order or groups fall back to the original order without groups', () => {
  const layers = ['a', 'b', 'c'].map(layer);
  const result = validateOrganization({ order: ['c', 'a'], groups: [{ title: 'Only', layers: ['a', 'b'] }, { title: 'Dup', layers: ['b', 'c'] }] }, layers);
  expect(result.layers.map(l => l.id)).toEqual(['a', 'b', 'c']);
  expect(result.groups).toBeUndefined();
  expect(validateOrganization({ order: ['b', 'a', 'c'], groups: [{ title: 'One', layers: ['a', 'b', 'c'] }] }, layers).groups).toBeUndefined();
});

test('parts must stay within the layer rows and must not overlap', () => {
  const units = changeUnits(file), [edit, other] = units as [typeof units[0], typeof units[0]];
  const target: Layer = { ...layer('l'), ranges: [{ changeId: edit.id, start: 1, end: 3 }] };
  const parts = validateParts({ parts: [
    { title: 'Rename', summary: 'Renames the call.', ranges: [{ changeId: edit.id, start: 1, end: 2 }] },
    { title: 'Log', summary: 'Logs.', ranges: [{ changeId: edit.id, start: 3, end: 3 }] },
  ] }, target);
  expect(parts.map(p => p.title)).toEqual(['Rename', 'Log']);
  expect(() => validateParts({ parts: [{ title: 'x', summary: '', ranges: [{ changeId: other.id, start: 1, end: 1 }] }] }, target)).toThrow();
  expect(() => validateParts({ parts: [
    { title: 'x', summary: '', ranges: [{ changeId: edit.id, start: 1, end: 2 }] }, { title: 'y', summary: '', ranges: [{ changeId: edit.id, start: 2, end: 3 }] },
  ] }, target)).toThrow();
  expect(validateParts({ parts: [{ title: 'Only', summary: '', ranges: [{ changeId: edit.id, start: 1, end: 3 }] }] }, target)).toEqual([]);
});

test('part notes anchor above the first edit when unchanged code precedes it', () => {
  const [edit, other] = changeUnits(file) as [ReturnType<typeof changeUnits>[0], ReturnType<typeof changeUnits>[0]];
  expect(partAnchors(file, [
    { ranges: [{ changeId: edit.id, start: 3, end: 3 }] },
    { ranges: [{ changeId: edit.id, start: 1, end: 2 }] },
    { ranges: [{ changeId: other.id, start: 1, end: 1 }] },
  ])).toEqual([
    { part: 0, side: 'additions', lineNumber: 4 },
    { part: 1, side: 'additions', lineNumber: 2 },
    { part: 2, side: 'additions', lineNumber: 5 },
  ]);
});

test('rows the model skips inside an assigned block join that block, while untouched blocks stay separate', () => {
  const [edit, other] = changeUnits(file) as [ReturnType<typeof changeUnits>[0], ReturnType<typeof changeUnits>[0]];
  // A model reading "last" as exclusive stops one row short of the replacement.
  const result = validateRangeLayers({ summary: '', layers: [
    { title: 'Rename', summary: '', ranges: [{ changeId: edit.id, first: 1, last: 2 }] },
  ] }, [edit, other], 't');
  expect(result.layers.map(l => [l.title, l.ranges])).toEqual([
    ['Rename', [{ changeId: edit.id, start: 1, end: 2 }, { changeId: edit.id, start: 3, end: 3 }]],
    ['Additional changes', [{ changeId: other.id, start: 1, end: 1 }]],
  ]);
});
