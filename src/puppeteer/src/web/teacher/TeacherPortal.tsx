import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Upload } from "lucide-react";
import { Badge } from "@ui/components/badge";
import { Button } from "@ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ui/components/card";
import { Textarea } from "@ui/components/textarea";
import { classroomName, demoNotes, type SessionReport } from "./demo-data";
import { mergeDashboard } from "./analyze";
import { allReports, loadLiveReports, loadNotes, saveNotes } from "./storage";

const engagementTone = {
  high: "ok" as const,
  steady: "live" as const,
  low: "wait" as const,
};

function StatChips({ report }: { report: SessionReport }) {
  const s = report.stats;
  if (!s) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        ["Minutes", String(s.minutes)],
        ["Turns", `${s.classTurns} / ${s.sockyTurns}`],
        ["Class talk", `${s.classTalkPct}%`],
        ["Questions", String(s.questions)],
      ].map(([label, value]) => (
        <div key={label} className="rounded-md bg-paper px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute">
            {label}
          </p>
          <p className="font-display text-[22px] italic leading-none">{value}</p>
        </div>
      ))}
    </div>
  );
}

function ReportBody({ report }: { report: SessionReport }) {
  return (
    <>
      <p className="mt-2 text-[14px] leading-relaxed">{report.summary}</p>
      <StatChips report={report} />
      {report.insights?.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
          {report.insights.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-[12px] text-mute">
        Topics: {report.topics.join(", ") || "—"}
        {report.struggles.length
          ? ` · Struggles: ${report.struggles.join(", ")}`
          : ""}
      </p>
    </>
  );
}

export function TeacherPortal({
  onStartSession,
}: {
  onStartSession: () => void;
}) {
  const [notes, setNotes] = useState(() => loadNotes(demoNotes));
  const [saved, setSaved] = useState(false);
  const [liveReports, setLiveReports] = useState<SessionReport[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setLiveReports(loadLiveReports());
  }, []);
  const reports = useMemo(() => allReports(liveReports), [liveReports]);
  const dash = useMemo(() => mergeDashboard(liveReports), [liveReports]);
  const maxTopic = dash.topics[0]?.sessions ?? 1;
  const persist = () => {
    saveNotes(notes);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-oat bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-6 py-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-pink">
              Teacher portal
            </p>
            <h1 className="mt-1 font-display text-[36px] italic leading-none">
              Socky in the classroom
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-mute">
              An attentive learning companion and social robot. This desk shows
              how the class is doing with Socky, what to tune, and a way to run
              a classroom session instead of the operator console.
            </p>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
              {classroomName}
            </p>
          </div>
          <Button size="lg" onClick={onStartSession}>
            Start classroom session
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <section
          aria-label="Class snapshot"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {[
            ["Sessions this week", dash.stats.sessionsThisWeek],
            ["Students reached", dash.stats.studentsReached],
            ["Avg minutes", dash.stats.avgMinutes],
            ["Topics covered", dash.stats.topicsCovered],
          ].map(([label, value]) => (
            <Card key={String(label)} className="px-5 py-5">
              <CardDescription>{label}</CardDescription>
              <p className="mt-1 font-display text-[40px] italic leading-none">
                {value}
              </p>
            </Card>
          ))}
        </section>

        {dash.latest && (
          <Card className="border-pink/40">
            <CardHeader>
              <CardTitle>Latest session summary</CardTitle>
              <CardDescription>
                Built from the classroom session you just ran. Snapshot numbers
                above already include it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px] font-medium">{dash.latest.student}</p>
                <Badge tone="pink">This session</Badge>
              </div>
              <ReportBody report={dash.latest} />
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Conversation topics</CardTitle>
              <CardDescription>
                What Socky spent time on this week
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {dash.topics.map((t) => (
                <div key={t.name}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <span>{t.name}</span>
                    <span className="font-mono text-mute">{t.sessions}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-pill bg-oat">
                    <div
                      className="h-full rounded-pill bg-rose"
                      style={{ width: `${(t.sessions / maxTopic) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Common struggles</CardTitle>
              <CardDescription>
                Patterns Socky can watch for next session
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {dash.struggles.map((s) => (
                <div
                  key={s.id}
                  className="border-t border-oat pt-3 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[15px] font-medium">{s.title}</p>
                    <Badge tone="pink">{s.students} students</Badge>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-mute">
                    {s.detail}
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed">
                    <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-pink">
                      Socky move
                    </span>{" "}
                    {s.sockyMove}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Class roster</CardTitle>
            <CardDescription>Demo cohort for the judges</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="motors w-full text-left text-[13px]">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Sessions</th>
                  <th>Last seen</th>
                  <th>Engagement</th>
                  <th>Focus</th>
                </tr>
              </thead>
              <tbody>
                {dash.students.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.name}</td>
                    <td>{s.sessions}</td>
                    <td>{s.lastSession}</td>
                    <td>
                      <Badge tone={engagementTone[s.engagement]}>
                        {s.engagement}
                      </Badge>
                    </td>
                    <td className="text-mute">{s.focus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tune Socky</CardTitle>
            <CardDescription>
              Notes Socky should remember for this class. Uploaded files are
              appended. Demo-only: stored in this browser.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              aria-label="Class notes for Socky"
              className="min-h-48 font-sans text-[14px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ink" onClick={persist}>
                Save notes
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4" />
                Upload text
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const text = await file.text();
                  setNotes(
                    (old) =>
                      `${old.trim()}\n\n— From ${file.name} —\n${text.trim()}\n`,
                  );
                }}
              />
              {saved && (
                <span className="text-[13px] text-mute">
                  Saved for this browser.
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-5 text-rose" />
              Session reports
            </CardTitle>
            <CardDescription>
              Seeded examples plus any classroom session you run from this page
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {reports.map((r) => (
              <article
                key={r.id}
                className="rounded-md border border-oat bg-canvas px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[15px] font-medium">{r.student}</p>
                  <div className="flex flex-wrap gap-2">
                    {r.live && <Badge tone="pink">This session</Badge>}
                    <Badge tone="mute">{r.when}</Badge>
                    <Badge tone="live">
                      {r.minutes} min · {r.turns} turns
                    </Badge>
                  </div>
                </div>
                <ReportBody report={r} />
              </article>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
