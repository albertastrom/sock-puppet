import { expect, it } from "vitest";
import { extraInstructionsForMode } from "../src/providers/live-prompts";
import { mergeDashboard, reportFromTranscripts } from "../src/web/teacher/analyze";
import { demoStats, demoStudents, demoTopics } from "../src/web/teacher/demo-data";

it("appends classroom notes only for classroom mode", () => {
  expect(extraInstructionsForMode("operator", "Maya needs wait time")).toBeUndefined();
  expect(extraInstructionsForMode(undefined, "x")).toBeUndefined();
  const extra = extraInstructionsForMode("classroom", "Maya needs wait time");
  expect(extra).toContain("teacher present");
  expect(extra).toContain("Maya needs wait time");
});

it("builds a live report with stats and insights from transcripts", () => {
  const report = reportFromTranscripts(
    [
      { role: "user", text: "How many thirds in a fraction pizza?" },
      { role: "assistant", text: "Let's name the question first." },
      { role: "user", text: "I don't know." },
      {
        role: "assistant",
        text: "That is okay. Tell me the story in your own words.",
      },
    ],
    Date.now() - 120000,
  );
  expect(report.live).toBe(true);
  expect(report.turns).toBe(4);
  expect(report.stats.classTurns).toBe(2);
  expect(report.stats.sockyTurns).toBe(2);
  expect(report.stats.questions).toBe(1);
  expect(report.topics).toContain("Fractions");
  expect(report.struggles).toContain("Speaking up when stuck");
  expect(report.insights.some((l) => l.includes("class held"))).toBe(true);
  expect(report.insights.some((l) => /question/i.test(l))).toBe(true);
});

it("folds a live session into dashboard stats, topics, and roster", () => {
  const live = reportFromTranscripts(
    [
      { role: "user", text: "Is a half bigger than a third?" },
      { role: "assistant", text: "Yes. Two sixths is the same as one third." },
    ],
    Date.now() - 60 * 60 * 1000,
    Date.now(),
  );
  const dash = mergeDashboard([live]);
  expect(dash.stats.sessionsThisWeek).toBe(demoStats.sessionsThisWeek + 1);
  expect(dash.stats.avgMinutes).not.toBe(demoStats.avgMinutes);
  expect(dash.topics.find((t) => t.name === "Fractions")!.sessions).toBe(
    demoTopics.find((t) => t.name === "Fractions")!.sessions + 1,
  );
  expect(dash.students[0].sessions).toBe(demoStudents[0].sessions + 1);
  expect(dash.students[0].lastSession).toBe("Just now");
  expect(dash.latest?.id).toBe(live.id);
});
