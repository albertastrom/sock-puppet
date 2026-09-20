import { useEffect, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { defaultEye } from "@sock-puppet/robot/protocol";
import { Badge } from "@ui/components/badge";
import { Button } from "@ui/components/button";
import { cn } from "@ui/lib/utils";
import { EyePreview } from "../EyePreview";
import { useOperator } from "../useOperator";
import { classroomName, demoNotes } from "./demo-data";
import { loadNotes, reportFromTranscripts, saveLiveReport } from "./storage";

export function ClassroomSession({ onExit }: { onExit: () => void }) {
  const op = useOperator();
  const startedAt = useRef(Date.now());
  const recorded = useRef(false);
  useEffect(() => {
    document.title = "Classroom session · Socky";
  }, []);
  useEffect(() => {
    if (op.active) startedAt.current = Date.now();
  }, [op.active]);
  const finish = () => {
    if (!recorded.current) {
      recorded.current = true;
      saveLiveReport(
        reportFromTranscripts(op.transcripts, startedAt.current),
      );
    }
    op.stop();
    onExit();
  };
  return (
    <div className="relative flex h-dvh min-h-[640px] flex-col bg-canvas text-ink">
      <header className="flex items-center justify-between gap-3 border-b border-oat px-6 py-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-pink">
            Classroom session
          </p>
          <h1 className="font-display text-[28px] leading-none italic">Socky</h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
            {classroomName}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tone={op.online ? "live" : "mute"}>
            {op.online ? "Controller online" : "Controller offline"}
          </Badge>
          <Badge tone={op.connected ? "ok" : "wait"}>
            {op.connected ? "Ready" : "Waiting"}
          </Badge>
          <Badge tone={op.active ? "pink" : "mute"}>{op.behavior}</Badge>
          <Button size="sm" variant="ghost" onClick={finish}>
            Back to portal
          </Button>
        </div>
      </header>
      {op.error && (
        <div
          className="error mx-6 mt-3 flex items-center justify-between gap-3 rounded-md bg-[#fff0ec] px-4 py-3 text-[13px] text-[#9b2c18]"
          role="alert"
        >
          <span>{op.error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => op.setError("")}
          >
            ×
          </button>
        </div>
      )}
      {!op.hasKey && op.online && (
        <div className="notice mx-6 mt-3 rounded-md bg-oat px-4 py-3 text-[13px] text-mute">
          Voice unavailable: configure OPENAI_API_KEY and restart. You can still
          return to the portal; a short report will be saved.
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] max-[750px]:grid-cols-1">
        <section className="card conversation flex min-h-0 flex-col px-6 pb-28 pt-4">
          <h3 className="mb-2 font-display text-[22px] italic">
            Class conversation
          </h3>
          <div className="transcripts min-h-0 flex-1 overflow-auto pr-1">
            {!op.transcripts.length && (
              <p className="empty max-w-md pt-10 text-[17px] leading-relaxed text-mute">
                Start listening when Virtual Socky is connected. Socky talks
                with the class using your saved notes. Stop to write a report
                back on the teacher portal.
              </p>
            )}
            {op.transcripts.map((t, i) => (
              <article key={i} className={t.role}>
                <span>{t.role === "user" ? "Class" : "Socky"}</span>
                <p>{t.text}</p>
              </article>
            ))}
            {op.partial && (
              <article className="partial">
                <span>Hearing…</span>
                <p>{op.partial}</p>
              </article>
            )}
          </div>
        </section>
        <aside className="min-h-0 overflow-y-auto border-l border-oat bg-paper px-5 pb-36 pt-4 max-[750px]:border-l-0 max-[750px]:border-t">
          <section className="eye-status" aria-label="Eye displays">
            <div className="face flex gap-4">
              <EyePreview
                name="Left"
                eye={op.state?.eyes.left ?? defaultEye()}
              />
              <EyePreview
                name="Right"
                eye={op.state?.eyes.right ?? defaultEye()}
              />
            </div>
          </section>
          <p className="muted mt-4 text-[13px] leading-relaxed text-mute">
            {op.linkMessage}
          </p>
          <p className="endpoint mt-3 text-[13px] leading-relaxed">
            Connect Virtual Socky to{" "}
            <code className="rounded bg-oat px-1">{op.robotUrl}</code>
          </p>
          <p className="mt-4 text-[13px] leading-relaxed text-mute">
            Classroom notes are sent with start. Serial and JSON stay on the
            operator console.
          </p>
        </aside>
      </div>
      <div className="session-pill pointer-events-none fixed inset-x-0 bottom-5 z-20 flex justify-center px-4">
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-pill bg-paper p-1.5 shadow-[var(--shadow-pill)]">
          <Button
            className="primary"
            variant="default"
            size="pill"
            disabled={
              !op.online ||
              !op.connected ||
              !op.hasKey ||
              !op.protocolOk ||
              op.active ||
              op.starting
            }
            onClick={() =>
              void op.start({
                mode: "classroom",
                notes: loadNotes(demoNotes),
              })
            }
          >
            {op.starting ? "Starting…" : "Start listening"}
          </Button>
          <Button
            variant="ghost"
            size="pill"
            disabled={!op.active && !op.starting}
            onClick={finish}
          >
            Stop and save report
          </Button>
          <label className="flex h-12 items-center gap-2 rounded-pill px-3 text-[13px]">
            <input
              type="checkbox"
              checked={op.muted}
              onChange={(e) => op.setMuted(e.target.checked)}
            />{" "}
            Mute microphone
            {op.muted ? (
              <MicOff className="size-4" />
            ) : (
              <Mic className="size-4" />
            )}
          </label>
        </div>
      </div>
    </div>
  );
}
