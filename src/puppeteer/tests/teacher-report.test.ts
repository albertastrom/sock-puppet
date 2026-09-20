import { expect, it } from "vitest";
import { extraInstructionsForMode } from "../src/providers/live-prompts";
import { reportFromTranscripts } from "../src/web/teacher/storage";

it("appends classroom notes only for classroom mode", () => {
  expect(extraInstructionsForMode("operator", "Maya needs wait time")).toBeUndefined();
  expect(extraInstructionsForMode(undefined, "x")).toBeUndefined();
  const extra = extraInstructionsForMode("classroom", "Maya needs wait time");
  expect(extra).toContain("teacher present");
  expect(extra).toContain("Maya needs wait time");
});

it("builds a live report from transcripts", () => {
  const report = reportFromTranscripts(
    [
      { role: "user", text: "How many thirds in a fraction pizza?" },
      { role: "assistant", text: "Let's name the question first." },
    ],
    Date.now() - 120000,
  );
  expect(report.live).toBe(true);
  expect(report.turns).toBe(2);
  expect(report.minutes).toBeGreaterThanOrEqual(1);
  expect(report.topics).toContain("Fractions");
});
