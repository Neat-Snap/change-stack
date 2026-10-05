import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Session } from './types';
import { changeUnits } from './changes';
import type { ChangedFile, ChangeRange } from './types';

function sourceRanges(files: ChangedFile[], ranges: ChangeRange[] = []) {
  const units = new Map(files.flatMap(file => changeUnits(file)).map(unit => [unit.id, unit]));
  return ranges.flatMap(range => {
    const unit = units.get(range.changeId);
    if (!unit || unit.hunk < 0) return [];
    let old = unit.oldStart, current = unit.newStart;
    const result: { path: string; side: 'old' | 'current'; start: number; end: number }[] = [];
    for (const [index, text] of unit.lines.entries()) {
      const side = text.startsWith('-') ? 'old' : 'current';
      const line = side === 'old' ? old++ : current++;
      if (index + 1 < range.start || index + 1 > range.end) continue;
      const previous = result.at(-1);
      if (previous?.side === side && previous.end + 1 === line) previous.end = line;
      else result.push({ path: unit.path, side, start: line, end: line });
    }
    return result;
  });
}

// Export only review metadata and explanations. Credentials, source, patches,
// and browser-session secrets never cross the IDE import boundary.
export function ideAnalysis(session: Session, exportedAt = new Date().toISOString()) {
  const { review, analysis } = session;
  return {
    format: 'change-stack-intellij', version: 1, exportedAt, demo: session.demo,
    review: { provider: review.target.provider, url: review.target.url, project: review.target.project,
      number: review.target.number, title: review.title, headSha: review.headSha,
      baseSha: review.baseSha, startSha: review.startSha, sourceBranch: review.sourceBranch, targetBranch: review.targetBranch },
    files: review.files.map(({ path, oldPath }) => ({ path, oldPath })),
    analysis: { summary: analysis.summary, source: analysis.source, warnings: [...analysis.warnings, ...review.warnings],
      groups: analysis.groups?.map(({ id, title, layers }) => ({ id, title, layers })),
      layers: analysis.layers.map(({ id, title, summary, category, files, dependsOn, parts }) => ({ id, title, summary, category,
        files, dependsOn, parts: parts?.map(({ title, summary }) => ({ title, summary })),
        annotations: (parts?.length ? parts : [analysis.layers.find(layer => layer.id === id)!]).flatMap((part, index) =>
          sourceRanges(review.files, part.ranges).map(range => ({ ...range, partId: `${id}:part:${index}`, title: part.title, summary: part.summary }))) })) },
  };
}

export async function exportIdeAnalysis(session: Session, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(ideAnalysis(session), null, 2) + '\n', { mode: 0o600 });
}
