/** Nearby same-speaker fragments stay on one row. Sequential turns after this gap start another. */
export const TRANSCRIPT_GAP_MS = 1500;
export const TRANSCRIPT_LIMIT = 60;
export const TRANSCRIPT_TEXT_LIMIT = 8000;

export type TranscriptRow = {
  role: string;
  text: string;
  startMs?: number;
  endMs?: number;
  updatedAt: number;
};

export type TranscriptFragment = {
  role: string;
  text: string;
  startMs?: number;
  endMs?: number;
};

export function appendTranscript(
  rows: TranscriptRow[],
  fragment: TranscriptFragment,
  now = Date.now(),
  gapMs = TRANSCRIPT_GAP_MS,
): TranscriptRow[] {
  const idx = findOpenRow(rows, fragment, now, gapMs);
  if (idx >= 0) {
    const row = rows[idx];
    return [
      ...rows.slice(0, idx),
      {
        ...row,
        text: (row.text + fragment.text).slice(-TRANSCRIPT_TEXT_LIMIT),
        startMs: minMs(row.startMs, fragment.startMs),
        endMs: maxMs(row.endMs, fragment.endMs),
        updatedAt: now,
      },
      ...rows.slice(idx + 1),
    ];
  }
  return [
    ...rows,
    {
      role: fragment.role,
      text: fragment.text,
      startMs: fragment.startMs,
      endMs: fragment.endMs,
      updatedAt: now,
    },
  ].slice(-TRANSCRIPT_LIMIT);
}

function findOpenRow(
  rows: TranscriptRow[],
  fragment: TranscriptFragment,
  now: number,
  gapMs: number,
): number {
  const timed = fragment.startMs != null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].role !== fragment.role) continue;
    if (isContiguous(rows[i], fragment, now, gapMs)) return i;
    if (!timed) return -1;
  }
  return -1;
}

function isContiguous(
  row: TranscriptRow,
  fragment: TranscriptFragment,
  now: number,
  gapMs: number,
): boolean {
  const rowStart = row.startMs,
    rowEnd = row.endMs ?? row.startMs,
    fragStart = fragment.startMs,
    fragEnd = fragment.endMs ?? fragment.startMs;
  if (
    rowStart != null &&
    rowEnd != null &&
    fragStart != null &&
    fragEnd != null
  )
    return intervalGap(rowStart, rowEnd, fragStart, fragEnd) <= gapMs;
  return now - row.updatedAt <= gapMs;
}

function intervalGap(a0: number, a1: number, b0: number, b1: number): number {
  if (a1 < b0) return b0 - a1;
  if (b1 < a0) return a0 - b1;
  return 0;
}

function minMs(a?: number, b?: number): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

function maxMs(a?: number, b?: number): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}
