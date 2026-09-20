import { expect, it } from "vitest";
import {
  TRANSCRIPT_GAP_MS,
  appendTranscript,
  type TranscriptRow,
} from "../src/web/transcripts";

function apply(
  fragments: Parameters<typeof appendTranscript>[1][],
  now = 10_000,
) {
  return fragments.reduce<TranscriptRow[]>(
    (rows, fragment) => appendTranscript(rows, fragment, now),
    [],
  );
}

it("merges consecutive fragments from the same speaker", () => {
  expect(
    apply([
      { role: "user", text: "Hello ", startMs: 0, endMs: 400 },
      { role: "user", text: "there", startMs: 400, endMs: 800 },
    ]),
  ).toMatchObject([
    { role: "user", text: "Hello there", startMs: 0, endMs: 800 },
  ]);
});

it("keeps overlapping speakers on two stable rows", () => {
  const rows = apply([
    { role: "user", text: "Socky, too", startMs: 1000, endMs: 1600 },
    { role: "assistant", text: "Mm-h", startMs: 1400, endMs: 1700 },
    { role: "user", text: " much", startMs: 1600, endMs: 2000 },
    { role: "assistant", text: "m.", startMs: 1700, endMs: 1900 },
  ]);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    role: "user",
    text: "Socky, too much",
    startMs: 1000,
    endMs: 2000,
  });
  expect(rows[1]).toMatchObject({
    role: "assistant",
    text: "Mm-hm.",
    startMs: 1400,
    endMs: 1900,
  });
});

it("starts a new row after a same-speaker gap", () => {
  const rows = apply([
    { role: "user", text: "Show me all your eyes", startMs: 0, endMs: 2000 },
    {
      role: "assistant",
      text: "I only have two!",
      startMs: 2500,
      endMs: 5000,
    },
    {
      role: "user",
      text: "Okay",
      startMs: 5000 + TRANSCRIPT_GAP_MS + 1,
      endMs: 7000,
    },
  ]);
  expect(rows.map((r) => r.text)).toEqual([
    "Show me all your eyes",
    "I only have two!",
    "Okay",
  ]);
});

it("lets a late fragment update an earlier overlapping row", () => {
  const rows = apply([
    { role: "user", text: "Nice ", startMs: 0, endMs: 800 },
    { role: "assistant", text: "Hee hee.", startMs: 2000, endMs: 2800 },
    { role: "user", text: "Show me", startMs: 400, endMs: 900 },
  ]);
  expect(rows).toHaveLength(2);
  expect(rows[0].text).toBe("Nice Show me");
  expect(rows[1].text).toBe("Hee hee.");
});

it("falls back to arrival time when Live omits timestamps", () => {
  const first = appendTranscript(
    [],
    { role: "user", text: "Socky, too" },
    1000,
  );
  const overlapped = appendTranscript(
    appendTranscript(
      first,
      { role: "assistant", text: "Mm-h" },
      1100,
    ),
    { role: "user", text: " much" },
    1200,
  );
  expect(overlapped.map((r) => r.text)).toEqual(["Socky, too much", "Mm-h"]);
  const nextTurn = appendTranscript(
    overlapped,
    { role: "user", text: "Okay" },
    1200 + TRANSCRIPT_GAP_MS + 1,
  );
  expect(nextTurn.map((r) => r.text)).toEqual([
    "Socky, too much",
    "Mm-h",
    "Okay",
  ]);
});
