import {
  demoReports,
  struggleLexicon,
  topicLexicon,
  type SessionReport,
} from "./demo-data";

export function reportFromTranscripts(
  transcripts: { role: string; text: string }[],
  startedAt: number,
  endedAt = Date.now(),
): SessionReport {
  const blob = transcripts.map((t) => t.text).join(" ").toLowerCase();
  const topics = topicLexicon
    .filter((t) => t.keys.some((k) => blob.includes(k)))
    .map((t) => t.name);
  const struggles = struggleLexicon
    .filter((s) => s.keys.some((k) => blob.includes(k)))
    .map((s) => s.title);
  const minutes = Math.max(1, Math.round((endedAt - startedAt) / 60000));
  const turns = transcripts.length;
  const excerpt = transcripts
    .filter((t) => t.role === "assistant")
    .at(-1)?.text;
  const summary =
    turns === 0
      ? "Classroom session opened. No spoken turns were captured, so this is a short wrap note for the teacher log."
      : excerpt
        ? `Socky closed on: “${excerpt.slice(0, 180)}${excerpt.length > 180 ? "…" : ""}”`
        : `Classroom session with ${turns} turns over about ${minutes} min.`;
  return {
    id: `live-${endedAt}`,
    when: "Just now",
    minutes,
    turns,
    student: "Classroom session",
    topics: topics.length ? topics : ["Open conversation"],
    struggles,
    summary,
    live: true,
  };
}

const NOTES_KEY = "socky.teacher.notes";
const REPORTS_KEY = "socky.teacher.reports";

export function loadNotes(fallback: string) {
  try {
    const v = localStorage.getItem(NOTES_KEY);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function saveNotes(notes: string) {
  try {
    localStorage.setItem(NOTES_KEY, notes);
  } catch {
    /* demo only */
  }
}

export function loadLiveReports(): SessionReport[] {
  try {
    const raw = localStorage.getItem(REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLiveReport(report: SessionReport) {
  const next = [report, ...loadLiveReports()].slice(0, 12);
  try {
    localStorage.setItem(REPORTS_KEY, JSON.stringify(next));
  } catch {
    /* demo only */
  }
  return next;
}

export function allReports(live: SessionReport[]) {
  return [...live, ...demoReports];
}
