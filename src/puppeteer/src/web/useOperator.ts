import { useEffect, useRef, useState } from "react";
import type { State } from "@sock-puppet/robot/simulator";
import { AudioIO } from "./audio";
import { appendTranscript, type TranscriptRow } from "./transcripts";
import { OPERATOR_PROTOCOL_VERSION } from "../playback";

export type StartPayload = {
  mode?: "operator" | "classroom";
  notes?: string;
};

export function useOperator() {
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
    [pending, setPending] = useState(0),
    [wireStatus, setWireStatus] = useState("No firmware command sent");
  const [transcripts, setTranscripts] = useState<TranscriptRow[]>([]),
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
            if (e.type === "wire") {
              const status =
                e.phase === "ack"
                  ? `${e.line} - acknowledged in ${e.latencyMs} ms`
                  : `${e.line} - awaiting acknowledgment`;
              setWireStatus(status);
              if (e.phase === "sent") log(`Firmware TX ${e.line}`);
            }
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
            if (typeof m.text !== "string" || typeof m.role !== "string") break;
            setTranscripts((old) =>
              appendTranscript(old, {
                role: m.role,
                text: m.text,
                startMs: typeof m.startMs === "number" ? m.startMs : undefined,
                endMs: typeof m.endMs === "number" ? m.endMs : undefined,
              }),
            );
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
            log(`${m.status}: ${String(m.move?.id ?? m.action?.gesture ?? "action")}`);
            break;
          case "transcript":
            if (typeof m.text !== "string") break;
            if (m.final) {
              if (m.text.trim())
                setTranscripts((t) =>
                  [
                    ...t,
                    {
                      role: m.role,
                      text: m.text.trim(),
                      updatedAt: Date.now(),
                    },
                  ].slice(-60),
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
  const start = async (payload: StartPayload = {}) => {
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
      const message: Record<string, unknown> = { type: "start" };
      if (payload.mode) message.mode = payload.mode;
      if (payload.notes) message.notes = payload.notes;
      if (!send(message)) {
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
    ? `${state.creature.behavior} · ${state.creature.moveId ?? state.creature.gesture} · ${state.creature.expression} · ${state.creature.actionStatus}${
        state.creature.actionStatus === "running"
          ? ` · ${Math.round(state.creature.moveProgress * 100)}%`
          : ""
      }`
    : "—";
  return {
    audio,
    online,
    connected,
    active,
    starting,
    hasKey,
    behavior,
    state,
    robotUrl,
    transport,
    setTransport,
    serialPath,
    setSerialPath,
    baud,
    setBaud,
    ports,
    microphones,
    mic,
    setMic,
    muted,
    setMuted,
    ptt,
    setPtt,
    held,
    setHeld,
    error,
    setError,
    linkMessage,
    pending,
    wireStatus,
    transcripts,
    partial,
    logs,
    metrics,
    usage,
    manual,
    setManual,
    send,
    start,
    stop,
    release,
    protocolVersion,
    protocolOk,
    creatureLine,
    transcriptsRef,
  };
}
