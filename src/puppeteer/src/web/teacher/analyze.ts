import {
  demoStats,
  demoStruggles,
  demoStudents,
  demoTopics,
  struggleLexicon,
  topicLexicon,
  type SessionReport,
  type SessionStats,
  type Struggle,
  type Student,
  type Topic,
} from "./demo-data";

export type Transcript = { role: string; text: string };

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function matchTopics(blob: string) {
  return topicLexicon
    .filter((t) => t.keys.some((k) => blob.includes(k)))
    .map((t) => t.name);
}

function matchStruggles(blob: string) {
  return struggleLexicon
    .filter((s) => s.keys.some((k) => blob.includes(k)))
    .map((s) => s.title);
}

export function sessionStats(
  transcripts: Transcript[],
  startedAt: number,
  endedAt = Date.now(),
): SessionStats {
  const classTurns = transcripts.filter((t) => t.role === "user");
  const sockyTurns = transcripts.filter((t) => t.role !== "user");
  const classChars = classTurns.reduce((n, t) => n + t.text.length, 0);
  const sockyChars = sockyTurns.reduce((n, t) => n + t.text.length, 0);
  const totalChars = classChars + sockyChars;
  const classWordCounts = classTurns.map((t) => words(t.text).length);
  const sockyWordCounts = sockyTurns.map((t) => words(t.text).length);
  const avg = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
  return {
    minutes: Math.max(1, Math.round((endedAt - startedAt) / 60000)),
    turns: transcripts.length,
    classTurns: classTurns.length,
    sockyTurns: sockyTurns.length,
    classTalkPct: totalChars
      ? Math.round((classChars / totalChars) * 100)
      : 0,
    questions: classTurns.reduce(
      (n, t) => n + (t.text.match(/\?/g)?.length ?? 0),
      0,
    ),
    avgClassWords: avg(classWordCounts),
    avgSockyWords: avg(sockyWordCounts),
  };
}

export function sessionInsights(
  stats: SessionStats,
  topics: string[],
  struggles: string[],
): string[] {
  if (stats.turns === 0) {
    return [
      "No spoken turns were captured, so the class snapshot only logs that a session was opened.",
      "Start listening next time to fill in talk-time, topics, and struggles.",
    ];
  }
  const out: string[] = [
    `${stats.minutes} min with ${stats.turns} turns (${stats.classTurns} class, ${stats.sockyTurns} Socky).`,
    `The class held about ${stats.classTalkPct}% of the words.`,
  ];
  if (stats.classTalkPct < 35) {
    out.push(
      "Socky held the floor more than the class. Next time, add wait time and ask one question at a time.",
    );
  } else if (stats.classTalkPct >= 55) {
    out.push("The class did most of the talking. Strong participation.");
  }
  if (stats.questions) {
    out.push(
      `The class asked ${stats.questions} question${stats.questions === 1 ? "" : "s"}.`,
    );
  } else {
    out.push(
      "No questions from the class were heard. Socky can invite one next time.",
    );
  }
  const named = topics.filter((t) => t !== "Open conversation");
  if (named.length) out.push(`Main thread: ${named.join(", ")}.`);
  else out.push("No curriculum topic matched. Open conversation.");
  if (struggles.length) {
    out.push(`Watch next time: ${struggles.join("; ")}.`);
  }
  if (stats.avgSockyWords > 0 && stats.avgSockyWords <= 20) {
    out.push("Socky kept answers short, which matches the tutoring style.");
  }
  if (stats.minutes < 5) {
    out.push(
      "Short block. A 15-minute session usually shows clearer topic patterns.",
    );
  }
  return out;
}

export function reportFromTranscripts(
  transcripts: Transcript[],
  startedAt: number,
  endedAt = Date.now(),
): SessionReport {
  const blob = transcripts.map((t) => t.text).join(" ").toLowerCase();
  const topics = matchTopics(blob);
  const struggles = matchStruggles(blob);
  const stats = sessionStats(transcripts, startedAt, endedAt);
  const resolvedTopics = topics.length ? topics : ["Open conversation"];
  const insights = sessionInsights(stats, resolvedTopics, struggles);
  const excerpt = transcripts.filter((t) => t.role !== "user").at(-1)?.text;
  const summary =
    stats.turns === 0
      ? "Classroom session opened. No spoken turns were captured."
      : excerpt
        ? `Socky closed on: “${excerpt.slice(0, 180)}${excerpt.length > 180 ? "…" : ""}”`
        : `Classroom session with ${stats.turns} turns over about ${stats.minutes} min.`;
  return {
    id: `live-${endedAt}`,
    when: "Just now",
    minutes: stats.minutes,
    turns: stats.turns,
    student: "Classroom session",
    topics: resolvedTopics,
    struggles,
    summary,
    insights,
    stats,
    live: true,
  };
}

export function mergeDashboard(live: SessionReport[]) {
  const spoken = live.filter((r) => r.turns > 0);
  const extraMinutes = live.reduce((n, r) => n + r.minutes, 0);
  const baselineMinutes = demoStats.sessionsThisWeek * demoStats.avgMinutes;
  const sessionsThisWeek = demoStats.sessionsThisWeek + live.length;
  const avgMinutes = Math.round(
    (baselineMinutes + extraMinutes) / Math.max(1, sessionsThisWeek),
  );
  const topicHits = new Map(demoTopics.map((t) => [t.name, t.sessions]));
  for (const report of live) {
    for (const name of report.topics) {
      if (name === "Open conversation") continue;
      topicHits.set(name, (topicHits.get(name) ?? 0) + 1);
    }
  }
  const topics: Topic[] = [...topicHits.entries()]
    .map(([name, sessions]) => ({ name, sessions }))
    .sort((a, b) => b.sessions - a.sessions);
  const struggleHits = new Map(
    demoStruggles.map((s) => [s.title, s.students]),
  );
  for (const report of live) {
    for (const title of report.struggles) {
      struggleHits.set(title, (struggleHits.get(title) ?? 0) + 1);
    }
  }
  const struggles: Struggle[] = demoStruggles.map((s) => ({
    ...s,
    students: struggleHits.get(s.title) ?? s.students,
  }));
  const students: Student[] = demoStudents.map((s) =>
    spoken.length
      ? {
          ...s,
          sessions: s.sessions + spoken.length,
          lastSession: "Just now",
        }
      : s,
  );
  const namedTopics = new Set(
    [...demoTopics.map((t) => t.name), ...live.flatMap((r) => r.topics)].filter(
      (n) => n !== "Open conversation",
    ),
  );
  return {
    stats: {
      sessionsThisWeek,
      studentsReached: demoStats.studentsReached,
      avgMinutes,
      topicsCovered: Math.max(demoStats.topicsCovered, namedTopics.size),
    },
    topics,
    struggles,
    students,
    latest: live[0],
  };
}
