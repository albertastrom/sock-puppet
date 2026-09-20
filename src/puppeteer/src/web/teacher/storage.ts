import { demoReports, type SessionReport } from "./demo-data";

export { reportFromTranscripts } from "./analyze";

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
