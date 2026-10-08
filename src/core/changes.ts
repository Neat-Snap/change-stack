import type { ChangedFile, ChangeRange, LineSide, Review } from './types';

interface Row { text: string; old: number; current: number; kind: string }
interface Hunk { rows: Row[]; label: string }
export interface ChangeUnit { id: string; path: string; oldStart: number; newStart: number; lines: string[]; context: string; hunk: number; rowStart: number; rowEnd: number; rowIndices: number[] }

function hunks(file: ChangedFile): Hunk[] {
  const result: Hunk[] = []; let hunk: Hunk | undefined, old = 0, current = 0;
  for (const text of file.patch.split('\n')) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(text);
    if (match) { old = +match[1]; current = +match[2]; hunk = { rows: [], label: match[3] }; result.push(hunk); continue; }
    if (!hunk || ![' ', '+', '-', '\\'].includes(text[0])) continue;
    hunk.rows.push({ text, old, current, kind: text[0] });
    if (text[0] === ' ' || text[0] === '-') old++;
    if (text[0] === ' ' || text[0] === '+') current++;
  }
  return result;
}

// IDs identify small, contiguous edit blocks. The model can assign any subrange
// of their numbered patch rows, including multiple concerns within one hunk.
export function changeUnits(file: ChangedFile): ChangeUnit[] {
  const units: ChangeUnit[] = [];
  for (const [hunkIndex, hunk] of hunks(file).entries()) {
    for (let i = 0; i < hunk.rows.length;) {
      if (!['+', '-'].includes(hunk.rows[i].kind)) { i++; continue; }
      const start = i;
      while (i < hunk.rows.length && ['+', '-', '\\'].includes(hunk.rows[i].kind) && i - start < 120) i++;
      const rows = hunk.rows.slice(start, i);
      units.push({ id: `${file.path}#${hunkIndex}:${start}`, path: file.path, hunk: hunkIndex, rowStart: start, rowEnd: i, rowIndices: rows.flatMap((r, n) => ['+', '-'].includes(r.kind) ? [start + n] : []),
        oldStart: rows[0].old, newStart: rows[0].current, context: [hunk.label, ...hunk.rows.slice(Math.max(0, start - 3), start).map(r => r.text), ...hunk.rows.slice(i, i + 3).map(r => r.text)].join('\n').slice(0, 1500), lines: rows.filter(r => ['+', '-'].includes(r.kind)).map(r => r.text) });
    }
  }
  if (!units.length) units.push({ id: `${file.path}#file`, path: file.path, oldStart: 0, newStart: 0, lines: [`(${file.diffNote ?? 'No textual patch available'})`], context: `File status: ${file.status}`, hunk: -1, rowStart: 0, rowEnd: 0, rowIndices: [] });
  return units;
}
export function wholeRanges(files: ChangedFile[]): ChangeRange[] {
  return files.flatMap(f => changeUnits(f).map(u => ({ changeId: u.id, start: 1, end: u.lines.length })));
}

export interface SourcePair { old: string; current: string }
// Expand only equal old/new surrounding lines. Stop at other changes so an
// expanded layer never silently incorporates edits assigned to another layer.
export function layerFile(file: ChangedFile, ranges: ChangeRange[], contextLines = 3, source?: SourcePair): ChangedFile {
  const parsed = hunks(file), units = new Map(changeUnits(file).map(u => [u.id, u]));
  const selected = new Map<number, Set<number>>();
  for (const range of ranges) {
    const u = units.get(range.changeId); if (!u || u.hunk < 0) continue;
    const rows = selected.get(u.hunk) ?? new Set<number>();
    for (let i = range.start - 1; i < range.end; i++) rows.add(u.rowIndices[i]);
    selected.set(u.hunk, rows);
  }
  if (!selected.size) return { ...file, patch: '', additions: 0, deletions: 0 };
  const oldLines = source?.old.split('\n'), newLines = source?.current.split('\n');
  const output: string[] = []; let additions = 0, deletions = 0;
  const segments: { rows: Row[]; label: string }[] = [];
  for (const [index, selection] of [...selected].sort(([a], [b]) => a - b)) {
    const hunk = parsed[index], visible = new Set(selection);
    for (const row of selection) {
      for (const direction of [-1, 1]) {
        for (let step = 1; step <= contextLines; step++) {
          const next = row + direction * step;
          if (next < 0 || next >= hunk.rows.length || hunk.rows[next].kind !== ' ') break;
          visible.add(next);
        }
      }
      if (hunk.rows[row + 1]?.kind === '\\') visible.add(row + 1);
    }
    const indices = [...visible].sort((a, b) => a - b);
    for (let i = 0; i < indices.length;) {
      const start = indices[i]; let end = start; i++;
      while (i < indices.length && indices[i] === end + 1) end = indices[i++];
      const rows = hunk.rows.slice(start, end + 1);
      if (oldLines && newLines) {
        const first = rows[0];
        let old = first.old - 1, current = first.current - 1;
        // Only extend outside the original hunk. Interior context is already included.
        if (start === 0) for (let n = 0; n < contextLines && old > 0 && current > 0; n++) {
          if (oldLines[old - 1] === undefined || oldLines[old - 1] !== newLines[current - 1]) break;
          rows.unshift({ text: ` ${oldLines[old - 1]}`, old, current, kind: ' ' }); old--; current--;
        }
        const last = rows.at(-1)!;
        old = last.old - 1 + ([' ', '-'].includes(last.kind) ? 1 : 0);
        current = last.current - 1 + ([' ', '+'].includes(last.kind) ? 1 : 0);
        if (end === hunk.rows.length - 1) for (let n = 0; n < contextLines; n++) {
          if (oldLines[old] === undefined || oldLines[old] !== newLines[current]) break;
          rows.push({ text: ` ${oldLines[old]}`, old: old + 1, current: current + 1, kind: ' ' }); old++; current++;
        }
      }
      const previous = segments.at(-1);
      const first = rows[0];
      const overlap = previous && first.kind === ' ' ? previous.rows.findIndex(r => r.kind === ' ' && r.old === first.old && r.current === first.current) : -1;
      const count = previous ? previous.rows.length - overlap : 0;
      if (previous && overlap >= 0 && count <= rows.length && previous.rows.slice(overlap).every((r, n) => r.text === rows[n].text && r.old === rows[n].old && r.current === rows[n].current)) {
        previous.rows.push(...rows.slice(count));
      } else segments.push({ rows, label: hunk.label });
    }
  }
  for (const { rows, label } of segments) {
    const oldCount = rows.filter(r => [' ', '-'].includes(r.kind)).length;
    const newCount = rows.filter(r => [' ', '+'].includes(r.kind)).length;
    const first = rows[0];
    // A zero-length side denotes the boundary before its next source line.
    output.push(`@@ -${oldCount ? first.old : Math.max(0, first.old - 1)},${oldCount} +${newCount ? first.current : Math.max(0, first.current - 1)},${newCount} @@${label}`, ...rows.map(r => r.text));
    additions += rows.filter(r => r.kind === '+').length;
    deletions += rows.filter(r => r.kind === '-').length;
  }
  const header = file.patch.slice(0, file.patch.indexOf('@@'));
  return { ...file, patch: `${header}${output.join('\n')}\n`, additions, deletions };
}

export interface PartAnchor { part: number; side: 'additions' | 'deletions'; lineNumber: number }
// Place each part's note after the unchanged row just above its first edit, so it
// reads as a heading. Without such a row, the note follows the part's last edit.
export function partAnchors(file: ChangedFile, parts: { ranges: ChangeRange[] }[]): PartAnchor[] {
  const parsed = hunks(file), units = new Map(changeUnits(file).map(u => [u.id, u]));
  const at = (row: Row) => row.kind === '-' ? { side: 'deletions' as const, lineNumber: row.old } : { side: 'additions' as const, lineNumber: row.current };
  return parts.flatMap((part, index) => {
    const rows = part.ranges.flatMap(range => {
      const unit = units.get(range.changeId);
      return unit && unit.hunk >= 0 ? unit.rowIndices.slice(range.start - 1, range.end).map(row => ({ hunk: unit.hunk, row })) : [];
    }).sort((a, b) => a.hunk - b.hunk || a.row - b.row);
    if (!rows.length) return [];
    const first = rows[0]!, last = rows.at(-1)!, before = parsed[first.hunk]!.rows[first.row - 1];
    return [{ part: index, ...at(before?.kind === ' ' ? before : parsed[last.hunk]!.rows[last.row]!) }];
  });
}

// A row of the service's own diff. `old` and `current` are the line counters at
// that row, which is what GitLab line codes and positions are built from.
export interface DiffLine { kind: ' ' | '+' | '-'; old: number; current: number }
export function findDiffLine(file: ChangedFile, line: number, side: LineSide): DiffLine | undefined {
  for (const hunk of hunks(file)) for (const row of hunk.rows) {
    if (row.kind === '\\') continue;
    if (side === 'old' ? row.kind !== '+' && row.old === line : row.kind !== '-' && row.current === line) return { kind: row.kind as DiffLine['kind'], old: row.old, current: row.current };
  }
}

export interface LineRange { side: LineSide; start: number; end: number; endSide?: LineSide }
export type SnippetRow = (DiffLine & { text: string; selected: boolean }) | { omitted: number };
// Retain both diff counters and bound large selections without joining unrelated hunks.
export function diffSnippet(file: ChangedFile, range: LineRange, maxSelectedLines = 8): SnippetRow[] | undefined {
  const matches = (row: Row, line: number, side: LineSide) => side === 'old'
    ? row.kind !== '+' && row.old === line : row.kind !== '-' && row.current === line;
  for (const hunk of hunks(file)) {
    const rows = hunk.rows.filter(row => row.kind !== '\\');
    const start = rows.findIndex(row => matches(row, range.start, range.side));
    const end = rows.findIndex(row => matches(row, range.end, range.endSide ?? range.side));
    if (start < 0 || end < 0) continue;
    const first = Math.min(start, end), last = Math.max(start, end);
    const result: SnippetRow[] = [];
    for (let i = Math.max(0, first - 2); i <= Math.min(rows.length - 1, last + 2); i++) {
      const half = Math.floor(maxSelectedLines / 2);
      if (last - first + 1 > maxSelectedLines && i === first + half) { result.push({ omitted: last - first + 1 - half * 2 }); i = last - half; continue; }
      const row = rows[i];
      result.push({ kind: row.kind as DiffLine['kind'], old: row.old, current: row.current, text: row.text.slice(1), selected: i >= first && i <= last });
    }
    return result;
  }
}
// Keep endpoint sides and order by patch rows, since old/new line numbers can differ.
// A comment range must belong to one original hunk.
export function findDiffRange(file: ChangedFile, range: LineRange): { range: LineRange; first: DiffLine; last: DiffLine; sameHunk: boolean } | undefined {
  const matches = (row: Row, line: number, side: LineSide) => side === 'old'
    ? row.kind !== '+' && row.kind !== '\\' && row.old === line
    : row.kind !== '-' && row.kind !== '\\' && row.current === line;
  const rows = hunks(file).flatMap((hunk, index) => hunk.rows.map(row => ({ row, hunk: index })));
  const start = rows.findIndex(({ row }) => matches(row, range.start, range.side));
  const end = rows.findIndex(({ row }) => matches(row, range.end, range.endSide ?? range.side));
  if (start < 0 || end < 0) return;
  const ordered = start <= end ? range : { side: range.endSide ?? range.side, start: range.end, end: range.start, endSide: range.side };
  const line = (row: Row): DiffLine => ({ kind: row.kind as DiffLine['kind'], old: row.old, current: row.current });
  return { range: ordered, first: line(rows[Math.min(start, end)]!.row), last: line(rows[Math.max(start, end)]!.row), sameHunk: rows[start]!.hunk === rows[end]!.hunk };
}
// Deep link into the service's diff page. Falls back to the file, then the diff tab.
export function originDiffUrl(review: Review, file: ChangedFile, range?: LineRange): string {
  const github = review.target.provider === 'github';
  const base = `${review.target.url}/${github ? 'files' : 'diffs'}`;
  if (!file.diffAnchor) return base;
  if (range) range = findDiffRange(file, range)?.range ?? range;
  if (github) {
    if (!range) return `${base}#diff-${file.diffAnchor}`;
    const side = range.side === 'old' ? 'L' : 'R';
    const endSide = (range.endSide ?? range.side) === 'old' ? 'L' : 'R';
    return `${base}#diff-${file.diffAnchor}${side}${range.start}${range.end !== range.start || endSide !== side ? `-${endSide}${range.end}` : ''}`;
  }
  const line = range && findDiffLine(file, range.start, range.side);
  return `${base}#${file.diffAnchor}${line ? `_${line.old}_${line.current}` : ''}`;
}
