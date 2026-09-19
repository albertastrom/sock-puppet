import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { config } from "@sock-puppet/robot/config";
import { paintEye } from "@sock-puppet/robot/display";
import { defaultEye, type Eye } from "@sock-puppet/robot/protocol";
import type { State } from "@sock-puppet/robot/simulator";
import { AudioIO } from "./audio";
import "./style.css";
function EyePreview({ eye, name }: { eye: Eye; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) paintEye(ref.current, eye);
  }, [eye]);
  return (
    <figure>
      <canvas
        aria-label={`${name} eye`}
        ref={ref}
        width={config.display.width}
        height={config.display.height}
      />
      <figcaption>{name} eye · 64 × 128</figcaption>
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
    [baud, setBaud] = useState(921600),
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
  const [metrics, setMetrics] = useState({ queuedMs: 0, underrun: false });
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
            setMetrics(m);
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
  const start = async () => {
    setError("");
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
    void audio.current?.stop();
    setStarting(false);
    setActive(false);
    send({ type: "stop" });
  };
  const release = () => {
    if (!held) return;
    setHeld(false);
  };
  return (
    <main>
      <aside className="live-metrics">
        GPT Live 1 · Queue {Math.round(metrics.queuedMs)} ms{" "}
        {metrics.underrun ? "· waiting for audio" : ""}
        {state?.creature && (
          <span>
            {" "}
            · {state.creature.behavior} · {state.creature.gesture} ·{" "}
            {state.creature.expression} · {state.creature.actionStatus}
          </span>
        )}
        {usage != null && (
          <details>
            <summary>Session usage</summary>
            <pre>{JSON.stringify(usage, null, 2)}</pre>
          </details>
        )}
      </aside>
      <header>
        <h1>Puppeteer</h1>
        <span className={`badge ${online ? "good" : ""}`}>
          <i />
          {online ? "Controller online" : "Controller offline"}
        </span>
      </header>
      <section className="eye-status" aria-label="Eye displays">
        <div className="face">
          <EyePreview name="Left" eye={state?.eyes.left ?? defaultEye()} />
          <EyePreview name="Right" eye={state?.eyes.right ?? defaultEye()} />
        </div>
      </section>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {!hasKey && online && (
        <div className="notice">
          Voice unavailable: configure OPENAI_API_KEY and restart.
        </div>
      )}
      <div className="grid">
        <section className="card">
          <div className="section-heading">
            <h3>Session</h3>
            <span className={`badge ${active ? "good" : ""}`}>{behavior}</span>
          </div>
          <label>
            Microphone
            <select
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
          </label>
          <div className="toggles">
            <label>
              <input
                type="checkbox"
                checked={muted}
                onChange={(e) => setMuted(e.target.checked)}
              />{" "}
              Mute microphone
            </label>
            <label>
              <input
                type="checkbox"
                checked={ptt}
                onChange={(e) => setPtt(e.target.checked)}
              />{" "}
              Push to talk
            </label>
          </div>
          <div className="buttons">
            <button
              className="primary"
              disabled={!online || !connected || !hasKey || active || starting}
              onClick={() => void start()}
            >
              {starting ? "Starting…" : "Start listening"}
            </button>
            <button disabled={!active && !starting} onClick={stop}>
              Stop session
            </button>
          </div>
          <div className="buttons">
            <button
              disabled={!active}
              onClick={() => {
                audio.current?.handle({ type: "audio.clear" });
                send({ type: "interrupt" });
              }}
            >
              Interrupt response
            </button>
            {ptt && (
              <button
                className={held ? "primary" : ""}
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
                Hold to speak
              </button>
            )}
          </div>
          <div className="metrics">
            <div>
              <strong>{Math.round(metrics.queuedMs)} ms</strong>
              <span>Audio queued</span>
            </div>
            <div>
              <strong>{pending}</strong>
              <span>Robot commands pending</span>
            </div>
          </div>
          <p className="small">
            AI-generated voice. Audio is sent to OpenAI while listening. No
            recordings are saved by this app.
          </p>
        </section>
        <section className="card">
          <div className="section-heading">
            <h3>Robot connection</h3>
            <span className={`badge ${connected ? "good" : ""}`}>
              {connected ? "Ready" : "Waiting"}
            </span>
          </div>
          <p className="muted">{linkMessage}</p>
          <label>
            Control target
            <select
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
            >
              <option value="websocket">Digital twin · WebSocket</option>
              <option value="serial">Microcontroller · Serial</option>
            </select>
          </label>
          {transport === "serial" ? (
            <>
              <label>
                Serial port
                <div className="inline">
                  <input
                    aria-label="Serial port"
                    list="ports"
                    placeholder="/dev/cu.usbmodem…"
                    value={serialPath}
                    onChange={(e) => setSerialPath(e.target.value)}
                  />
                  <button onClick={() => send({ type: "ports" })}>Scan</button>
                </div>
                <datalist id="ports">
                  {ports.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
              <label>
                Baud rate
                <input
                  type="number"
                  value={baud}
                  onChange={(e) => setBaud(Number(e.target.value))}
                />
              </label>
            </>
          ) : (
            <p className="endpoint">
              Connect the twin to <code>{robotUrl}</code>
            </p>
          )}
          <button
            disabled={!online}
            onClick={() => {
              setError("");
              send({ type: "transport", transport, path: serialPath, baud });
            }}
          >
            Apply connection · stop session
          </button>
          <button
            className="stop-motion"
            disabled={!online || !connected}
            onClick={() => {
              audio.current?.handle({ type: "audio.clear" });
              send({ type: "motion.stop" });
            }}
          >
            Stop motion
          </button>
          <table>
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
        </section>
        <section className="card conversation">
          <div className="section-heading">
            <h3>Conversation</h3>
            <button
              disabled={active}
              onClick={() => send({ type: "history.clear" })}
            >
              Clear
            </button>
          </div>
          <div className="transcripts">
            {!transcripts.length && (
              <p className="empty">No conversation yet.</p>
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
        <section className="card">
          <div className="section-heading">
            <h3>Manual control</h3>
            <span className="muted">Available when stopped</span>
          </div>
          <textarea
            aria-label="Robot command JSON"
            spellCheck={false}
            rows={10}
            disabled={active}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
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
          </button>
        </section>
      </div>
      <details className="card logs">
        <summary>
          Controller events <span>Last 50</span>
        </summary>
        <pre>{logs.join("\n") || "No events yet."}</pre>
      </details>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
