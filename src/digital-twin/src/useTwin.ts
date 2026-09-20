import { useEffect, useRef, useState } from "react";
import { defaultSpeeds, type Joint } from "@sock-puppet/robot/config";
import {
  errorResult,
  type Command,
  type Eye,
  type Result,
  type Side,
} from "@sock-puppet/robot/protocol";
import { Simulator } from "@sock-puppet/robot/simulator";
import { Connection, type ConnectionStatus } from "./core/connection";

const defaultUrl = "ws://127.0.0.1:8787";
const savedUrlKey = "sock-puppet.twin.controller";

const example = JSON.stringify(
  {
    version: 2,
    type: "command",
    id: "hello-1",
    motors: {
      baseYaw: { angleDeg: 25, speedDegPerSec: 60 },
      headPitch: { angleDeg: 10 },
      jawOpen: { angleDeg: 20 },
    },
  },
  null,
  2,
);

export function useTwin() {
  const [simulator] = useState(() => new Simulator());
  const [state, setState] = useState(simulator.getState);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [url, setUrl] = useState(defaultUrl);
  const [events, setEvents] = useState<
    { time: string; message: string; error: boolean }[]
  >([]);
  const [result, setResult] = useState("Ready to receive a command.");
  const [json, setJson] = useState(example);
  const [tab, setTab] = useState<"controls" | "protocol">("controls");
  const [speeds, setSpeeds] = useState<Record<Joint, number>>(() => ({
    ...defaultSpeeds,
  }));
  const counter = useRef(0);
  const log = (message: string, response?: Result) =>
    setEvents((previous) =>
      [
        {
          time: new Date().toLocaleTimeString("en-GB"),
          message,
          error: response?.type === "error",
        },
        ...previous,
      ].slice(0, 50),
    );
  const [connection] = useState(
    () =>
      new Connection(
        simulator,
        (nextStatus) => {
          setStatus(nextStatus);
          setState(simulator.getState());
        },
        log,
      ),
  );
  const local = status === "disconnected";
  useEffect(() => {
    let frame = 0,
      previous = performance.now(),
      uiTime = previous,
      snapshot = simulator.getState();
    const tick = (time: number) => {
      simulator.step((time - previous) / 1000);
      previous = time;
      if (time - uiTime >= 50) {
        const next = simulator.getState();
        if (next !== snapshot) {
          snapshot = next;
          setState(next);
        }
        uiTime = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const saved = sessionStorage.getItem(savedUrlKey);
    if (saved) {
      setUrl(saved);
      try {
        connection.connect(saved);
      } catch {
        sessionStorage.removeItem(savedUrlKey);
      }
    }
    return () => {
      cancelAnimationFrame(frame);
      connection.disconnect();
    };
  }, [simulator, connection]);
  function fail(message: string, response: Result) {
    setResult(message);
    log(message, response);
  }
  function submit(raw: unknown) {
    if (!local) return;
    const response = simulator.applyCommand(raw);
    const message =
      response.type === "ack" ? `Accepted ${response.id}` : response.message;
    setResult(message);
    log(message, response);
    setState(simulator.getState());
  }
  function command(partial: Pick<Command, "motors" | "eyes">) {
    submit({
      version: 2,
      type: "command",
      id: `manual-${++counter.current}`,
      ...partial,
    });
  }
  function pose(
    yaw: number,
    pitch: number,
    jaw: number,
    eyes?: Command["eyes"],
  ) {
    command({
      motors: {
        baseYaw: { angleDeg: yaw, speedDegPerSec: speeds.baseYaw },
        headPitch: { angleDeg: pitch, speedDegPerSec: speeds.headPitch },
        jawOpen: { angleDeg: jaw, speedDegPerSec: speeds.jawOpen },
      },
      eyes,
    });
  }
  function setEye(side: Side, eye: Eye) {
    command({ eyes: { [side]: eye } });
  }
  function connectOrDisconnect() {
    if (!local) {
      sessionStorage.removeItem(savedUrlKey);
      connection.disconnect();
      return;
    }
    try {
      sessionStorage.setItem(savedUrlKey, url);
      connection.connect(url);
    } catch (error) {
      sessionStorage.removeItem(savedUrlKey);
      const response = errorResult(undefined, error);
      fail(response.message, response);
    }
  }
  function sendJson() {
    try {
      submit(JSON.parse(json));
    } catch (error) {
      const message = `Invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`;
      fail(message, { version: 2, type: "error", id: null, message });
    }
  }
  return {
    simulator,
    state,
    status,
    local,
    url,
    setUrl,
    events,
    setEvents,
    result,
    json,
    setJson,
    tab,
    setTab,
    speeds,
    setSpeeds,
    command,
    pose,
    setEye,
    connectOrDisconnect,
    sendJson,
  };
}
