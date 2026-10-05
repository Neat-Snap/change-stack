import { expect, test } from 'bun:test';
import { demoSession } from '../src/core/demo';
import { ideAnalysis } from '../src/core/ide-export';

test('IDE export preserves memberships and snapshot identity without source or session secrets', () => {
  const session = demoSession();
  const value = ideAnalysis(session, '2026-10-01T00:00:00Z');
  expect(value.format).toBe('change-stack-intellij');
  expect(value.review.headSha).toBe(session.review.headSha);
  expect(value.analysis.layers.map(layer => layer.files)).toEqual(session.analysis.layers.map(layer => layer.files));
  expect(value.analysis.groups).toEqual(session.analysis.groups);
  expect(value.files.map(file => file.path)).toEqual(session.review.files.map(file => file.path));
  expect(value.files[0]).toEqual({ path: session.review.files[0]!.path, oldPath: session.review.files[0]!.oldPath });
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(session.review.files[0]!.patch);
  expect(serialized).not.toContain('commentsEnabled');
  expect(serialized).not.toContain('aiEnabled');
  expect(serialized).not.toContain('diffAnchor');
});

test('CLI export creates JSON and exits without starting the browser server', async () => {
  const dir = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/change-stack-ide-export-'));
  try {
    const path = `${dir}/analysis.json`;
    const child = Bun.spawn(['bun', 'src/cli.ts', '--demo', '--export-ide', path], { stdout: 'pipe', stderr: 'pipe' });
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).not.toContain('Review ready:');
    const value = await Bun.file(path).json();
    expect(value.format).toBe('change-stack-intellij');
    expect(value.demo).toBe(true);
  } finally { await import('node:fs/promises').then(fs => fs.rm(dir, { recursive: true, force: true })); }
});

test('IDE annotations identify semantic parts across fragmented old/current source ranges', () => {
  const session = demoSession();
  const value = ideAnalysis(session);
  const annotations = value.analysis.layers.flatMap(layer => layer.annotations);
  expect(annotations.length).toBeGreaterThan(0);
  for (const layer of value.analysis.layers) {
    for (const annotation of layer.annotations) {
      expect(annotation.partId).toMatch(new RegExp(`^${layer.id}:part:[0-9]+$`));
      expect(annotation.start).toBeGreaterThan(0);
      expect(annotation.end).toBeGreaterThanOrEqual(annotation.start);
    }
  }
});
