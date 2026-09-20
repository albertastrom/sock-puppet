import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Mic, MicOff, Radio } from "lucide-react";
import { config } from "@sock-puppet/robot/config";
import { paintEye } from "@sock-puppet/robot/display";
import { defaultEye, type Eye } from "@sock-puppet/robot/protocol";
import type { State } from "@sock-puppet/robot/simulator";
import { AudioIO } from "./audio";
import { OPERATOR_PROTOCOL_VERSION } from "../playback";
import { Badge } from "@ui/components/badge";
import { Button } from "@ui/components/button";
import { Input } from "@ui/components/input";
import { Textarea } from "@ui/components/textarea";
import { cn } from "@ui/lib/utils";
import "./style.css";

function EyePreview({ eye, name }: { eye: Eye; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) paintEye(ref.current, eye);
  }, [eye]);
  return (
    <figure className="m-0">
      <canvas
        aria-label={`${name} eye`}
        className="eye-preview"
        ref={ref}
        width={config.display.width}
        height={config.display.height}
      />
      <figcaption className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
        {name}
      </figcaption>
    </figure>
  );
}

function App() {
  const socket = useRef<WebSocket | null>(null),
    audio = useRef<AudioIO | null>(null);
  const [online, setOnline] = useState(false),
    [connected, setConnected] = useState(false),
    [active, setActive] = useState(false),
    [starting, setStarting] = useState(false);
  const [hasKey, setHasKey] = useState(false),
    [behavior, setBehavior] = useState("stopped"),
    [state, setState] = useState<State>();
  const [robotUrl, setRobotUrl] = useState("ws://127.0.0.1:8787");
  const [transport, setTransport] = useState("websocket"),
    [serialPath, setSerialPath] = useState(""),
    [baud, setBaud] = useState(115200),
    [ports, setPorts] = useState<string[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]),
    [mic, setMic] = useState(""),
    [muted, setMuted] = useState(false),
    [ptt, setPtt] = useState(false),
    [held, setHeld] = useState(false);
  const [error, setError] = useState(""),
    [linkMessage, setLinkMessage] = useState("Waiting for controller"),
    [pending, setPending] = useState(0);
  const [transcripts, setTranscripts] = useState<
      { role: string; text: string }[]
    >([]),
    [partial, setPartial] = useState(""),
    [logs, setLogs] = useState<string[]>([]);
  const [metrics, setMetrics] = useState({
    queuedMs: 0,
    underrun: false,
  });
  const [protocolVersion, setProtocolVersion] = useState<number | null>(null);
  const [usage, setUsage] = useState<unknown>();
  const [manual, setManual] = useState(
    JSON.stringify(
      {
        version: 2,
        type: "command",
        id: "manual-1",
        motors: { headPitch: { angleDeg: 10, speedDegPerSec: 30 } },
      },
      null,
      2,
    ),
  );
  const log = (text: string) =>
    setLogs((old) =>
      [`${new Date().toLocaleTimeString()}  ${text}`, ...old].slice(0, 50),
    );
  const send = (message: unknown) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(JSON.stringify(message));
    return true;
  };
  useEffect(() => {
    let canceled = false,
      retry: ReturnType<typeof setTimeout>;
    const io = (audio.current = new AudioIO(send, (pcm) => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > 128000) {
          setError("Microphone connection is too slow");
          send({ type: "stop" });
          void io.stop();
        } else ws.send(pcm);
      }
    }));
    const connect = () => {
      const host = import.meta.env.DEV
        ? `${location.hostname}:8788`
        : location.host;
      const ws = (socket.current = new WebSocket(`ws://${host}/operator`));
      ws.onopen = () => setOnline(true);
      ws.onmessage = ({ data }) => {
        const m = JSON.parse(data);
        io.handle(m);
        switch (m.type) {
          case "ready":
            setProtocolVersion(
              typeof m.protocolVersion === "number" ? m.protocolVersion : null,
            );
            setTransport(m.transport);
            if (m.robotUrl) setRobotUrl(m.robotUrl);
            setConnected(m.connected);
            setHasKey(m.hasApiKey);
            setState(m.state);
            setLinkMessage(m.message);
            break;
          case "session":
            setActive(m.active);
            setBehavior(m.behavior);
            setStarting(m.behavior === "starting");
            if (!m.active) {
              void io.stop();
              setHeld(false);
              setMetrics({ queuedMs: 0, underrun: false });
            }
            break;
          case "robot": {
            const e = m.event;
            if (e.type === "connection") {
              setConnected(e.connected);
              setLinkMessage(e.message);
              log(e.message);
            }
            if (e.type === "state") setState(e.state);
            if (e.type === "pending") setPending(e.count);
            if (e.type === "result")
              log(
                e.result.type === "ack"
                  ? `Accepted ${e.result.id}`
                  : `Rejected: ${e.result.message}`,
              );
            break;
          }
          case "error":
            setError(m.message);
            setStarting(false);
            log(m.message);
            break;
          case "transcript.delta":
            setTranscripts((old) => {
              const last = old.at(-1);
              return last && last.role === m.role
                ? [
                    ...old.slice(0, -1),
                    { role: m.role, text: (last.text + m.text).slice(-8000) },
                  ]
                : [...old, { role: m.role, text: m.text }].slice(-60);
            });
            break;
          case "playback.metrics":
            setMetrics({
              queuedMs: m.queuedMs,
              underrun: m.underrun,
            });
            break;
          case "usage":
            setUsage(m.value);
            break;
          case "action":
            log(`${m.status}: ${m.action?.gesture ?? "action"}`);
            break;
          case "transcript":
            if (typeof m.text !== "string") break;
            if (m.final) {
              if (m.text.trim())
                setTranscripts((t) =>
                  [...t, { role: m.role, text: m.text.trim() }].slice(-60),
                );
              if (m.role === "user") setPartial("");
            } else setPartial(m.text.trim());
            break;
          case "ports":
            setPorts(m.ports.map((p: { path: string }) => p.path));
            break;
          case "manual.result":
            log(
              m.result.type === "ack"
                ? "Manual command accepted"
                : m.result.message,
            );
            if (m.result.type === "error") setError(m.result.message);
            break;
          case "history.cleared":
            setTranscripts([]);
            setPartial("");
            break;
        }
      };
      ws.onclose = (event) => {
        setOnline(false);
        setConnected(false);
        setActive(false);
        setStarting(false);
        setProtocolVersion(null);
        void io.stop();
        if (!canceled && event.code !== 1008) retry = setTimeout(connect, 1500);
        else if (event.code === 1008) setError(event.reason);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) =>
        setMicrophones(devices.filter((d) => d.kind === "audioinput")),
      )
      .catch(() => {});
    return () => {
      canceled = true;
      clearTimeout(retry);
      socket.current?.close();
      void io.stop();
    };
  }, []);
  useEffect(() => {
    audio.current?.control(muted, ptt, held);
  }, [muted, ptt, held, active]);
  const protocolOk = protocolVersion === OPERATOR_PROTOCOL_VERSION;
  const start = async () => {
    setError("");
    if (!protocolOk) {
      setError(
        "Controller is out of date. Restart Puppeteer, then reload this page.",
      );
      return;
    }
    setStarting(true);
    try {
      if (!(await audio.current!.start(mic))) {
        setStarting(false);
        return;
      }
      audio.current!.control(muted, ptt, false);
      if (!send({ type: "start" })) {
        setError("Controller connection lost during start");
        setStarting(false);
        void audio.current?.stop();
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((d) => d.kind === "audioinput"));
    } catch (e) {
      setError(`Microphone unavailable: ${e instanceof Error ? e.message : e}`);
      setStarting(false);
      send({ type: "stop" });
    }
  };
  const stop = () => {
    audio.current?.clearPlayback();
    void audio.current?.stop();
    setStarting(false);
    setActive(false);
    send({ type: "stop" });
  };
  const release = () => {
    if (!held) return;
    setHeld(false);
  };
  const transcriptsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = transcriptsRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [transcripts, partial]);
  const creatureLine = state?.creature
    ? `${state.creature.behavior} · ${state.creature.gesture} · ${state.creature.expression} · ${state.creature.actionStatus}`
    : "—";
  return (
    <div className="relative flex h-dvh min-h-[640px] flex-col overflow-hidden bg-canvas text-ink max-[750px]:h-auto max-[750px]:overflow-visible">
      <header className="topbar flex shrink-0 items-center justify-between gap-3 overflow-hidden border-b border-oat px-5 py-3 max-[750px]:flex-wrap max-[750px]:overflow-visible">
        <div className="min-w-0 shrink-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-pink">
            Console
          </p>
          <h1 className="font-display text-[28px] leading-none italic">
            Puppeteer
          </h1>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden max-[750px]:flex-wrap max-[750px]:overflow-visible">
          <span className={`badge shrink-0 ${online ? "good" : ""}`}>
            <Badge className="min-w-[11.5rem] justify-center" tone={online ? "live" : "mute"}>
              <i className={cn("size-1.5 rounded-full", online ? "bg-glow" : "bg-current")} />
              {online ? "Controller online" : "Controller offline"}
            </Badge>
          </span>
          <span className={`badge shrink-0 ${connected ? "good" : ""}`}>
            <Badge className="min-w-[5.5rem] justify-center" tone={connected ? "ok" : "wait"}>
              {connected ? "Ready" : "Waiting"}
            </Badge>
          </span>
          <span className={`badge shrink-0 ${active ? "good" : ""}`}>
            <Badge className="min-w-[9.5rem] justify-center" tone={active ? "pink" : "mute"}>
              {behavior}
            </Badge>
          </span>
        </div>
      </header>
      <div className="relative min-h-0 flex-1 max-[750px]:min-h-0">
        {(error || (!hasKey && online) || (online && !protocolOk)) && (
          <div className="pointer-events-none absolute inset-x-0 top-14 z-10 flex flex-col gap-2 px-6 min-[751px]:right-[300px]">
            {error && (
              <div className="error pointer-events-auto flex items-center justify-between gap-3 rounded-md bg-[#fff0ec] px-4 py-3 text-[13px] text-[#9b2c18] shadow-[var(--shadow-soft)]" role="alert">
                <span>{error}</span>
                <button type="button" aria-label="Dismiss error" onClick={() => setError("")}>
                  ×
                </button>
              </div>
            )}
            {!hasKey && online && (
              <div className="notice pointer-events-auto rounded-md bg-oat px-4 py-3 text-[13px] text-mute shadow-[var(--shadow-soft)]">
                Voice unavailable: configure OPENAI_API_KEY and restart.
              </div>
            )}
            {online && !protocolOk && (
              <div className="notice pointer-events-auto rounded-md bg-oat px-4 py-3 text-[13px] text-mute shadow-[var(--shadow-soft)]">
                Controller is out of date. Restart Puppeteer, then reload this page.
              </div>
            )}
          </div>
        )}
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_300px] overflow-hidden max-[750px]:grid-cols-1 max-[750px]:overflow-visible">
        <section className="card conversation flex min-h-0 min-w-0 flex-col overflow-hidden px-5 pb-28 pt-5 max-[750px]:overflow-visible max-[750px]:pb-8">
          <div className="section-heading mb-2 flex shrink-0 items-center justify-between">
            <h3 className="font-display text-[22px] italic">Conversation</h3>
            <Button
              size="sm"
              variant="ghost"
              disabled={active}
              onClick={() => send({ type: "history.clear" })}
            >
              Clear
            </Button>
          </div>
          <div
            className="transcripts min-h-0 flex-1 overflow-auto pr-1"
            ref={transcriptsRef}
          >
            {!transcripts.length && !partial && (
              <p className="empty max-w-md pt-3 text-[17px] leading-relaxed text-mute">
                Start a session when Virtual Socky is connected. Talk here. The
                puppet answers with voice and motion.
              </p>
            )}
            {transcripts.map((t, i) => (
              <article key={i} className={t.role}>
                <span>{t.role === "user" ? "You" : "Puppet"}</span>
                <p>{t.text}</p>
              </article>
            ))}
            {partial && (
              <article className="partial">
                <span>Hearing…</span>
                <p>{partial}</p>
              </article>
            )}
          </div>
        </section>
        <aside className="panel min-h-0 w-[300px] max-w-[300px] shrink-0 overflow-x-hidden overflow-y-auto border-l border-oat bg-paper px-5 pb-36 pt-5 max-[750px]:w-auto max-[750px]:max-w-none max-[750px]:overflow-visible max-[750px]:border-l-0 max-[750px]:border-t max-[750px]:pb-40">
          <section className="eye-status" aria-label="Eye displays">
            <div className="face flex gap-4">
              <EyePreview name="Left" eye={state?.eyes.left ?? defaultEye()} />
              <EyePreview name="Right" eye={state?.eyes.right ?? defaultEye()} />
            </div>
          </section>
          <p className="mt-3 h-4 truncate font-mono text-[11px] leading-4 text-mute">
            {creatureLine}
          </p>
          <p className="live-metrics mt-3 flex h-4 items-center gap-2 overflow-hidden font-mono text-[11px] tabular-nums text-mute">
            <span className="shrink-0">
              Queue{" "}
              <span className="inline-block w-[4ch] text-right">
                {Math.round(metrics.queuedMs)}
              </span>{" "}
              ms
            </span>
            <span className={cn("truncate", metrics.underrun ? "" : "invisible")}>
              waiting for audio
            </span>
            <span className={cn("shrink-0", pending ? "" : "invisible")}>
              {pending || 0} pending
            </span>
          </p>
          <div className="section-heading mt-5">
            <h3 className="text-[15px] font-medium">Robot connection</h3>
          </div>
          <p className="muted mt-1 h-4 truncate text-[12px] leading-4 text-mute">
            {linkMessage}
          </p>
          <label className="mt-3 block text-[13px]">
            Control target
            <select
              className="mt-1 h-10 w-full rounded-md border-[1.5px] border-knit bg-paper px-2"
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
            >
              <option value="websocket">Digital twin · WebSocket</option>
              <option value="serial">Microcontroller · Serial</option>
            </select>
          </label>
          {transport === "serial" ? (
            <>
              <label className="mt-3 block text-[13px]">
                Serial port
                <div className="inline mt-1 flex gap-2">
                  <Input
                    aria-label="Serial port"
                    list="ports"
                    placeholder="/dev/cu.usbmodem…"
                    value={serialPath}
                    onChange={(e) => setSerialPath(e.target.value)}
                  />
                  <Button size="sm" variant="ghost" onClick={() => send({ type: "ports" })}>
                    Scan
                  </Button>
                </div>
                <datalist id="ports">
                  {ports.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
              <label className="mt-3 block text-[13px]">
                Baud rate
                <Input
                  type="number"
                  value={baud}
                  onChange={(e) => setBaud(Number(e.target.value))}
                />
              </label>
            </>
          ) : (
            <p className="endpoint mt-3 truncate text-[13px] leading-relaxed">
              Connect Virtual Socky to <code className="rounded bg-oat px-1">{robotUrl}</code>
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={!online}
              onClick={() => {
                setError("");
                send({ type: "transport", transport, path: serialPath, baud });
              }}
            >
              Apply connection · stop session
            </Button>
            <Button
              className="stop-motion"
              size="sm"
              variant="stop"
              disabled={!online || !connected}
              onClick={() => {
                audio.current?.clearPlayback();
                send({ type: "motion.stop" });
              }}
            >
              Stop motion
            </Button>
          </div>
          <table className="motors mt-4">
            <thead>
              <tr>
                <th>Motor</th>
                <th>Actual</th>
                <th>Target</th>
                <th>Motion</th>
              </tr>
            </thead>
            <tbody>
              {(["baseYaw", "headPitch", "jawOpen"] as const).map((j) => (
                <tr key={j}>
                  <td>{j}</td>
                  <td>{state?.motors[j].angleDeg.toFixed(1) ?? "—"}°</td>
                  <td>{state?.motors[j].targetDeg.toFixed(1) ?? "—"}°</td>
                  <td>{state?.motors[j].moving ? "Moving" : "Still"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <section className="card mt-6">
            <div className="section-heading mb-2">
              <h3 className="text-[15px] font-medium">Manual control</h3>
              <span className="muted text-[12px] text-mute">Available when stopped</span>
            </div>
            <Textarea
              aria-label="Robot command JSON"
              spellCheck={false}
              rows={8}
              disabled={active}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <Button
              className="mt-2"
              size="sm"
              variant="ink"
              disabled={active || !connected}
              onClick={() => {
                try {
                  const command = JSON.parse(manual);
                  command.id = `manual-${Date.now()}`;
                  send({ type: "command", command });
                  setError("");
                } catch {
                  setError("Command must be valid JSON");
                }
              }}
            >
              Send command
            </Button>
          </section>
          <details className="card logs mt-5 text-[13px]">
            <summary className="cursor-pointer">
              Controller events <span className="float-right text-mute">Last 50</span>
            </summary>
            <pre className="mt-2 max-h-52 overflow-auto font-mono text-[12px] leading-relaxed">
              {logs.join("\n") || "No events yet."}
            </pre>
          </details>
          <details className="mt-3 text-[12px]">
            <summary className="cursor-pointer">Session usage</summary>
            <pre className="mt-2 max-h-40 overflow-auto">
              {usage != null ? JSON.stringify(usage, null, 2) : "No usage yet."}
            </pre>
          </details>
        </aside>
      </div>
      </div>
      <div className="session-pill pointer-events-none fixed inset-x-0 bottom-5 z-20 flex justify-center px-4 max-[750px]:bottom-3">
        <div className="pointer-events-auto flex max-w-full flex-nowrap items-center justify-center gap-1 overflow-x-auto rounded-pill bg-paper p-1.5 shadow-[var(--shadow-pill)] max-[750px]:flex-wrap max-[750px]:overflow-visible">
          <label className="sr-only" htmlFor="mic-select">
            Microphone
          </label>
          <select
            id="mic-select"
            className="h-12 max-w-40 rounded-pill border-0 bg-transparent px-3 text-[13px] text-mute"
            value={mic}
            disabled={active || starting}
            onChange={(e) => setMic(e.target.value)}
          >
            <option value="">System default</option>
            {microphones.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
          <Button
            className="primary min-w-[10.5rem]"
            variant="default"
            size="pill"
            disabled={!online || !connected || !hasKey || !protocolOk || active || starting}
            onClick={() => void start()}
          >
            {starting ? "Starting…" : "Start listening"}
          </Button>
          <Button
            variant="ghost"
            size="pill"
            disabled={!active && !starting}
            onClick={stop}
          >
            Stop session
          </Button>
          <label className="flex h-12 items-center gap-2 rounded-pill px-3 text-[13px]">
            <input
              type="checkbox"
              checked={muted}
              onChange={(e) => setMuted(e.target.checked)}
            />{" "}
            Mute microphone
            {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </label>
          <label className="flex h-12 items-center gap-2 rounded-pill px-3 text-[13px]">
            <input
              type="checkbox"
              checked={ptt}
              onChange={(e) => setPtt(e.target.checked)}
            />{" "}
            Push to talk
          </label>
          <Button
            variant="ghost"
            size="pill"
            disabled={!active}
            onClick={() => {
              audio.current?.clearPlayback();
              send({ type: "interrupt" });
            }}
          >
            Interrupt response
          </Button>
          {ptt && (
            <Button
              className={held ? "primary" : ""}
              variant={held ? "default" : "live"}
              size="pill"
              disabled={!active || muted}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setHeld(true);
              }}
              onPointerUp={release}
              onPointerCancel={release}
              onKeyDown={(e) => {
                if (e.code === "Space" && !e.repeat) {
                  e.preventDefault();
                  setHeld(true);
                }
              }}
              onKeyUp={(e) => {
                if (e.code === "Space") {
                  e.preventDefault();
                  release();
                }
              }}
              onBlur={release}
            >
              <Radio className="size-4" />
              Hold to speak
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
