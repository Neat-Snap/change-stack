import { afterEach, expect, test } from 'bun:test';
import { analyze } from '../src/core/analysis';
import { changeUnits } from '../src/core/changes';
import { demoSession } from '../src/core/demo';
import { makePatch } from '../src/core/providers';
import type { ChangedFile } from '../src/core/types';

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
const file: ChangedFile = { path: 'src/fixture.ts', oldPath: 'src/fixture.ts', status: 'added', additions: 12, deletions: 0, incomplete: false,
  patch: makePatch('src/fixture.ts', 'src/fixture.ts', 'added', '@@ -0,0 +1,12 @@\n' + Array.from({ length: 12 }, (_, i) => `+const value${i} = ${i};`).join('\n')) };

test('repairs overlapping parts once, validates the repair, and summarizes after details finish', async () => {
  for (const repairSucceeds of [true, false]) {
    const sequence: string[] = [];
    let partCalls = 0, active = 0, peak = 0;
    const changeId = changeUnits(file)[0]!.id;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const prompt = (await request.json() as any).messages[1].content as string;
      active++; peak = Math.max(peak, active);
      await Bun.sleep(5);
      let content;
      if (prompt.startsWith('Organize these numbered')) {
        sequence.push('layers');
        content = { summary: 'Adds values.', layers: [{ title: 'Values', summary: 'Adds values.', ranges: [{ changeId, first: 1, last: 12 }] }] };
      } else if (prompt.startsWith('Break this review layer')) {
        partCalls++; sequence.push('parts');
        if (partCalls === 2) expect(prompt).toContain('previous response failed validation');
        content = { parts: [{ title: 'First', summary: 'First values.', ranges: [{ changeId, first: 1, last: 6 }] },
          { title: 'Second', summary: 'Other values.', ranges: [{ changeId, first: partCalls > 1 && repairSucceeds ? 7 : 6, last: 12 }] }] };
      } else if (prompt.startsWith('Choose useful')) {
        sequence.push('context'); content = { requests: [] };
      } else {
        expect(prompt.startsWith('Repository exploration')).toBe(true);
        sequence.push('summary'); content = { summary: 'Adds values to the project.' };
      }
      active--;
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
    } }); servers.push(server);
    const progress: string[] = [];
    const result = await analyze({ ...demoSession().review, files: [file] },
      { baseUrl: server.url.origin, model: 'fixture', apiKey: 'fake-key' }, async () => ({}), message => progress.push(message));
    expect(peak).toBe(1);
    expect(sequence).toEqual(['layers', 'parts', 'parts', 'context', 'summary']);
    expect(partCalls).toBe(2);
    expect(progress.some(message => message.includes('Correcting invalid layer details'))).toBe(true);
    expect(result.summary).toBe('Adds values to the project.');
    if (repairSucceeds) {
      expect(result.layers[0]!.parts).toHaveLength(2);
      expect(result.layers[0]!.parts![1]!.ranges[0]!.start).toBe(7);
      expect(result.warnings).toEqual([]);
    } else {
      expect(result.layers[0]!.parts).toBeUndefined();
      expect(result.layers[0]!.ranges).toEqual([{ changeId, start: 1, end: 12 }]);
      expect(result.warnings.join(' ')).toContain('1 layer breakdown could not be prepared');
    }
  }
});
