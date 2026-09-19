import { NumberInput } from "./components/NumberInput";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Scene, EyePreview } from "./components/Scene";
import { Simulator } from "./core/simulator";
import { Connection, type ConnectionStatus } from "./core/connection";
import { config, joints, sides, type Joint, type Side } from "./core/config";
import {
  defaultEye,
  type Command,
  type ParameterEye,
  type Result,
} from "./core/protocol";
const example = JSON.stringify(
  {
    version: 1,
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
class SceneBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="scene-error">
        The 3D view requires WebGL. Enable hardware acceleration and reload.
        Controller tools remain available.
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const [simulator] = useState(() => new Simulator());
  const [state, setState] = useState(simulator.getState);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [url, setUrl] = useState("ws://localhost:8787");
  const [events, setEvents] = useState<
    { time: string; message: string; error: boolean }[]
  >([]);
  const [result, setResult] = useState("Ready to receive a command.");
  const [json, setJson] = useState(example);
  const [tab, setTab] = useState<"controls" | "protocol">("controls");
  const [eyeSide, setEyeSide] = useState<Side>("left");
  const [axes, setAxes] = useState(false),
    [reset, setReset] = useState(0);
  const [speeds, setSpeeds] = useState<Record<Joint, number>>({
    baseYaw: 90,
    headPitch: 90,
    jawOpen: 90,
  });
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
      uiTime = previous;
    const tick = (time: number) => {
      simulator.step((time - previous) / 1000);
      previous = time;
      if (time - uiTime >= 50) {
        setState(simulator.getState());
        uiTime = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      connection.disconnect();
    };
  }, [simulator, connection]);
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
      version: 1,
      type: "command",
      id: `manual-${++counter.current}`,
      ...partial,
    });
  }
  function pose(yaw: number, pitch: number, jaw: number) {
    command({
      motors: {
        baseYaw: { angleDeg: yaw, speedDegPerSec: speeds.baseYaw },
        headPitch: { angleDeg: pitch, speedDegPerSec: speeds.headPitch },
        jawOpen: { angleDeg: jaw, speedDegPerSec: speeds.jawOpen },
      },
    });
  }
  function editEye(update: Partial<ParameterEye>) {
    const eye = state.eyes[eyeSide];
    command({
      eyes: {
        [eyeSide]: {
          ...(eye.mode === "parameters" ? eye : defaultEye()),
          ...update,
        },
      },
    });
  }
  const selectedEye = state.eyes[eyeSide],
    parameterEye =
      selectedEye.mode === "parameters" ? selectedEye : defaultEye();
  const moving = joints.some((j) => state.motors[j].moving);
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Purl home">
          <span className="brand-icon">
            p<span>•</span>
          </span>
          <strong>
            purl<span className="brand-period">.</span>
          </strong>
        </a>
        <div className="project-title">
          <span className="divider" />
          SOCK PUPPET <span className="muted">/</span>{" "}
          <span className="muted">DIGITAL TWIN</span>
        </div>
        <div className="top-right">
          <span className="version">PROTOTYPE 01</span>
          <span className="live-badge">
            <i />
            SIMULATION LIVE
          </span>
        </div>
      </header>
      <main>
        <section className="viewport" aria-label="Puppet simulation">
          <div className="scene-heading">
            <div className="eyebrow">
              A LITTLE CHARACTER. A LOT OF POSSIBILITY.
            </div>
            <h1>Meet Purl.</h1>
            <p>A friendly face for your next big idea.</p>
          </div>
          <SceneBoundary>
            <Scene simulator={simulator} axes={axes} reset={reset} />
          </SceneBoundary>
          <div className="scene-tools">
            <button
              className={axes ? "active" : ""}
              onClick={() => setAxes(!axes)}
              aria-pressed={axes}
              title="Show joint axes"
            >
              ⌖ <span>Joint axes</span>
            </button>
            <button onClick={() => setReset((r) => r + 1)} title="Reset camera">
              ↺ <span>Reset view</span>
            </button>
          </div>
          <div className="spec-card">
            <span className="eyebrow">PURL / MK. 01</span>
            <div>
              <strong>03</strong>
              <span>servo joints</span>
              <span className="spec-line" />
              <strong>02</strong>
              <span>OLED eyes</span>
            </div>
            <p>45 cm tall · A soft exterior. A curious mind.</p>
          </div>
          <div className="orientation">
            <span>Y</span>
            <svg width="48" height="46" viewBox="0 0 48 46" aria-hidden="true">
              <path d="M24 27V4" stroke="#718d68" />
              <path d="M24 27L44 38" stroke="#b38171" />
              <path d="M24 27L5 38" stroke="#8297af" />
              <circle cx="24" cy="27" r="3" fill="#616b5d" />
            </svg>
            <b>X</b>
            <em>Z</em>
          </div>
          <div className="viewport-footer">
            <span>
              <i className="dot" />
              {moving ? "JOINTS IN MOTION" : "HOLDING POSITION"}
            </span>
            <span>
              DRAG TO ORBIT <b>·</b> SCROLL TO ZOOM
            </span>
            <span>GRID 10 CM</span>
          </div>
        </section>
        <aside className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DEVELOPER WORKSPACE</span>
              <h2>Control room</h2>
            </div>
            <span className="panel-mark">↗</span>
          </div>
          <div className="connection-card">
            <div className="section-title">
              <span>Controller connection</span>
              <span className={`status ${status}`}>
                <i />
                {status === "disconnected" ? "Local mode" : status}
              </span>
            </div>
            <div className="connect-row">
              <input
                aria-label="WebSocket URL"
                value={url}
                disabled={!local}
                onChange={(e) => setUrl(e.target.value)}
                spellCheck={false}
              />
              <button
                className="dark"
                onClick={() => {
                  if (!local) connection.disconnect();
                  else {
                    try {
                      connection.connect(url);
                    } catch (error) {
                      const message = (error as Error).message;
                      setResult(message);
                      log(message, {
                        version: 1,
                        type: "error",
                        id: null,
                        message,
                      });
                    }
                  }
                }}
              >
                {local ? "Connect" : "Disconnect"}
              </button>
            </div>
            <p>
              {local
                ? "Explore manually, or connect an external controller."
                : "External control active. Disconnect to use manual controls."}
            </p>
          </div>
          <div className="tabs" role="tablist" aria-label="Workspace">
            <button
              role="tab"
              aria-selected={tab === "controls"}
              className={tab === "controls" ? "selected" : ""}
              onClick={() => setTab("controls")}
            >
              Manual controls
            </button>
            <button
              role="tab"
              aria-selected={tab === "protocol"}
              className={tab === "protocol" ? "selected" : ""}
              onClick={() => setTab("protocol")}
            >
              Command console <span>{"{ }"}</span>
            </button>
          </div>
          <div className="panel-content">
            {tab === "controls" ? (
              <>
                <section className="motor-section">
                  <div className="section-title">
                    <h3>Movement</h3>
                    <span className="tag">3 SERVOS</span>
                  </div>
                  <fieldset disabled={!local}>
                    {joints.map((joint, index) => (
                      <div className="motor" key={joint}>
                        <div className="motor-title">
                          <label htmlFor={joint}>
                            <span className="number">0{index + 1}</span>
                            {config.motors[joint].label}
                          </label>
                          <div className="angle-input">
                            <NumberInput
                              id={`${joint}-number`}
                              aria-label={`${config.motors[joint].label} target`}
                              min={config.motors[joint].min}
                              max={config.motors[joint].max}
                              value={state.motors[joint].targetDeg}
                              onCommit={(angleDeg) =>
                                command({
                                  motors: {
                                    [joint]: {
                                      angleDeg,
                                      speedDegPerSec: speeds[joint],
                                    },
                                  },
                                })
                              }
                            />
                            <span>°</span>
                          </div>
                        </div>
                        <input
                          id={joint}
                          aria-label={config.motors[joint].label}
                          type="range"
                          min={config.motors[joint].min}
                          max={config.motors[joint].max}
                          step="1"
                          value={state.motors[joint].targetDeg}
                          onChange={(e) =>
                            command({
                              motors: {
                                [joint]: {
                                  angleDeg: +e.target.value,
                                  speedDegPerSec: speeds[joint],
                                },
                              },
                            })
                          }
                        />
                        <div className="motor-meta">
                          <span>{config.motors[joint].min}°</span>
                          <label>
                            Speed{" "}
                            <NumberInput
                              aria-label={`${config.motors[joint].label} speed`}
                              min="0.01"
                              value={speeds[joint]}
                              onCommit={(value) => {
                                if (value > 0)
                                  setSpeeds((s) => ({ ...s, [joint]: value }));
                              }}
                            />{" "}
                            °/s
                          </label>
                          <span>
                            ACT{" "}
                            <b data-testid={`${joint}-actual`}>
                              {state.motors[joint].angleDeg.toFixed(1)}°
                            </b>
                          </span>
                          <span>{config.motors[joint].max}°</span>
                        </div>
                      </div>
                    ))}
                    <div className="presets">
                      <span>TRY A POSE</span>
                      <button onClick={() => pose(-20, 15, 8)}>
                        Curious ↗
                      </button>
                      <button onClick={() => pose(15, 8, 30)}>Hello ♡</button>
                      <button
                        onClick={() => {
                          pose(0, 0, 0);
                          command({
                            eyes: { left: defaultEye(), right: defaultEye() },
                          });
                        }}
                      >
                        ↺ Neutral
                      </button>
                    </div>
                  </fieldset>
                </section>
                <section className="eyes-section">
                  <div className="section-title">
                    <h3>Eye displays</h3>
                    <span className="tag">80 × 80 PX</span>
                  </div>
                  <div className="eye-overview">
                    {sides.map((side) => (
                      <button
                        key={side}
                        className={`eye-card ${side === eyeSide ? "selected" : ""}`}
                        onClick={() => setEyeSide(side)}
                        aria-pressed={side === eyeSide}
                      >
                        <EyePreview eye={state.eyes[side]} />
                        <span>
                          {side} eye <i />
                        </span>
                      </button>
                    ))}
                  </div>
                  <fieldset disabled={!local}>
                    {selectedEye.mode === "pixels" ? (
                      <div className="pixel-notice">
                        RGB888 framebuffer active.
                        <button onClick={() => editEye({})}>
                          Use parameter mode
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="eye-coordinates">
                          {(["x", "y"] as const).map((axis) => (
                            <label key={axis}>
                              Pupil {axis.toUpperCase()}
                              <input
                                aria-label={`Pupil ${axis.toUpperCase()}`}
                                type="number"
                                min="0"
                                max="79"
                                value={parameterEye[axis]}
                                onChange={(e) => {
                                  if (e.target.value !== "")
                                    editEye({ [axis]: +e.target.value });
                                }}
                              />
                            </label>
                          ))}
                          <label>
                            Color
                            <input
                              aria-label="Eye color"
                              type="color"
                              value={parameterEye.color}
                              onChange={(e) =>
                                editEye({ color: e.target.value })
                              }
                            />
                          </label>
                        </div>
                        <label className="eye-slider">
                          Eyelid opening
                          <input
                            aria-label="Eyelid opening"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={parameterEye.openness}
                            onChange={(e) =>
                              editEye({ openness: +e.target.value })
                            }
                          />
                          <span>
                            {Math.round(parameterEye.openness * 100)}%
                          </span>
                        </label>
                      </>
                    )}
                    <label className="eye-slider">
                      Brightness
                      <input
                        aria-label="Brightness"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedEye.brightness}
                        onChange={(e) =>
                          command({
                            eyes: {
                              [eyeSide]: {
                                ...selectedEye,
                                brightness: +e.target.value,
                              },
                            },
                          })
                        }
                      />
                      <span>{Math.round(selectedEye.brightness * 100)}%</span>
                    </label>
                  </fieldset>
                  <p className="hint">
                    Eyes are independent. Pixel frames can be sent in the
                    console.
                  </p>
                </section>
              </>
            ) : (
              <section className="console-section">
                <div className="section-title">
                  <h3>Send a command</h3>
                  <span className="tag">JSON / V1</span>
                </div>
                <p className="hint">
                  Motor angles are in degrees. Commands update only the
                  specified parts.
                </p>
                <textarea
                  aria-label="JSON command"
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                  spellCheck={false}
                  disabled={!local}
                />
                <button
                  className="dark send-button"
                  disabled={!local}
                  onClick={() => {
                    try {
                      submit(JSON.parse(json));
                    } catch (error) {
                      const message = `Invalid JSON: ${(error as Error).message}`;
                      setResult(message);
                      log(message, {
                        version: 1,
                        type: "error",
                        id: null,
                        message,
                      });
                    }
                  }}
                >
                  Send command ↗
                </button>
                <output className="command-result" aria-live="polite">
                  {result}
                </output>
                <details>
                  <summary>Pixel-frame format</summary>
                  <p>
                    Set either eye to{" "}
                    <code>
                      {
                        '{ mode: "pixels", data: "<base64 RGB888>", brightness: 1 }'
                      }
                    </code>
                    . Each frame is 19,200 bytes: 80 × 80 RGB pixels, top-left
                    origin, row-major order.
                  </p>
                </details>
              </section>
            )}
            <section className="event-section">
              <div className="section-title">
                <h3>
                  Event log <span className="event-count">{events.length}</span>
                </h3>
                <button className="text-button" onClick={() => setEvents([])}>
                  Clear
                </button>
              </div>
              <div className="event-log" aria-label="Event log">
                {events.length ? (
                  events.map((event, i) => (
                    <div
                      className={event.error ? "error" : ""}
                      key={`${event.time}-${i}`}
                    >
                      <time>{event.time}</time>
                      <span>{event.message}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-log">
                    <i className="dot" />
                    <span>All quiet. Give Purl something to do.</span>
                  </div>
                )}
              </div>
            </section>
          </div>
          <footer className="panel-footer">
            <i className="dot" /> INPUT → SIMULATION → A LITTLE PERSONALITY
          </footer>
        </aside>
      </main>
    </div>
  );
}
