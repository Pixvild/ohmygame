export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
  /** Line number in the text before; an added line has none. */
  before?: number;
  /** Line number in the text after; a removed line has none. */
  after?: number;
}

/** A stretch of changed lines with the unchanged lines around it. */
export type DiffHunk = DiffLine[];

const CONTEXT_LINES = 3;
/** The table has a cell for every pair of lines between the common start and the common end. */
const MAX_TABLE_CELLS = 1_000_000;

/**
 * Compares two texts line by line for a unified view. Each hunk holds changed
 * lines with three unchanged lines on either side; what lies between two hunks
 * is unchanged. Line endings and a missing final newline are not compared, so
 * texts that differ only in those give no hunks.
 */
export function lineDiff(before: string, after: string): DiffHunk[] {
  const left = splitLines(before);
  const right = splitLines(after);
  let start = 0;
  while (
    start < left.length &&
    start < right.length &&
    left[start] === right[start]
  )
    start += 1;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (
    leftEnd > start &&
    rightEnd > start &&
    left[leftEnd - 1] === right[rightEnd - 1]
  ) {
    leftEnd -= 1;
    rightEnd -= 1;
  }

  const lines: DiffLine[] = [];
  let l = 0;
  let r = 0;
  const same = () => {
    lines.push({ kind: "same", text: left[l], before: l + 1, after: r + 1 });
    l += 1;
    r += 1;
  };
  const removed = () => {
    lines.push({ kind: "removed", text: left[l], before: l + 1 });
    l += 1;
  };
  const added = () => {
    lines.push({ kind: "added", text: right[r], after: r + 1 });
    r += 1;
  };

  while (l < start) same();
  // With too many lines to compare pair by pair, the middle is shown as replaced whole.
  const common =
    (leftEnd - start) * (rightEnd - start) > MAX_TABLE_CELLS
      ? undefined
      : commonLines(left.slice(start, leftEnd), right.slice(start, rightEnd));
  const width = rightEnd - start + 1;
  while (common && l < leftEnd && r < rightEnd) {
    const cell = (l - start) * width + r - start;
    if (left[l] === right[r]) same();
    else if (common[cell + width] >= common[cell + 1]) removed();
    else added();
  }
  while (l < leftEnd) removed();
  while (r < rightEnd) added();
  while (l < left.length) same();
  return hunks(lines);
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * The longest-common-subsequence table: the cell for (i, j) holds how many
 * lines `left` from i on and `right` from j on have in common, in order.
 */
function commonLines(left: string[], right: string[]): Uint16Array {
  const width = right.length + 1;
  // No count exceeds the shorter side, which the cell limit keeps far below 65536.
  const table = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        left[i] === right[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  return table;
}

function hunks(lines: DiffLine[]): DiffHunk[] {
  const result: DiffHunk[] = [];
  let end = 0;
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    const from = Math.max(index - CONTEXT_LINES, 0);
    const to = Math.min(index + CONTEXT_LINES + 1, lines.length);
    const last = result.at(-1);
    if (last && from <= end) last.push(...lines.slice(end, to));
    else result.push(lines.slice(from, to));
    end = to;
  });
  return result;
}
