import { Playground } from "./components/Playground";
import { NumberInput } from "./components/NumberInput";
import { Component, useState, type ReactNode } from "react";
import { Scene } from "./components/Scene";
import { EyePreview } from "./components/EyePreview";
import {
  config,
  frameBytes,
  joints,
  sides,
  type Joint,
  type Side,
} from "@sock-puppet/robot/config";
import {
  defaultEye,
  eyeSymbols,
  type ParameterEye,
  type SymbolEye,
} from "@sock-puppet/robot/protocol";
import { useTwin } from "./useTwin";

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
  const {
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
  } = useTwin();
  const [eyeSide, setEyeSide] = useState<Side>("left");
  const [axes, setAxes] = useState(false);
  const [reset, setReset] = useState(0);
  const selectedEye = state.eyes[eyeSide];
  const parameterEye: ParameterEye =
    selectedEye.mode === "parameters" ? selectedEye : defaultEye();
  const moving = joints.some((joint) => state.motors[joint].moving);
  const { width, height } = config.display;
  return (
    <div className="app">
      <header className="topbar">
        <h1>Digital twin</h1>
        <span className="status">{moving ? "Moving" : "Holding position"}</span>
      </header>
      <main>
        <section className="viewport" aria-label="Puppet simulation">
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
              <span>Joint axes</span>
            </button>
            <button onClick={() => setReset((r) => r + 1)} title="Reset camera">
              <span>Reset view</span>
            </button>
          </div>
          <div className="viewport-footer">
            <span>
              <i className="dot" />
              {moving ? "Moving" : "Holding position"}
            </span>
            <span>
              Drag to orbit <b>·</b> Scroll to zoom
            </span>
            <span>Grid 10 cm</span>
          </div>
        </section>
        <aside className="panel">
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
              <button className="dark" onClick={connectOrDisconnect}>
                {local ? "Connect" : "Disconnect"}
              </button>
            </div>
            <p>
              {local ? "Manual controls enabled." : "External control active."}
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
            <Playground
              disabled={!local}
              send={(c) => {
                simulator.applyCommand(c);
              }}
            />
            {state.creature && (
              <p>
                {state.creature.behavior} · {state.creature.gesture} ·{" "}
                {state.creature.expression} · {state.creature.actionStatus}
              </p>
            )}
            {tab === "controls" ? (
              <>
                <section className="motor-section">
                  <div className="section-title">
                    <h3>Movement</h3>
                  </div>
                  <fieldset disabled={!local}>
                    {joints.map((joint, index) => (
                      <MotorControl
                        key={joint}
                        joint={joint}
                        index={index}
                        targetDeg={state.motors[joint].targetDeg}
                        angleDeg={state.motors[joint].angleDeg}
                        speed={speeds[joint]}
                        onAngle={(angleDeg) =>
                          command({
                            motors: {
                              [joint]: {
                                angleDeg,
                                speedDegPerSec: speeds[joint],
                              },
                            },
                          })
                        }
                        onSpeed={(value) => {
                          if (
                            value >= 1 &&
                            value <= config.motors[joint].maxSpeed
                          )
                            setSpeeds((current) => ({
                              ...current,
                              [joint]: value,
                            }));
                        }}
                      />
                    ))}
                    <div className="presets">
                      <button
                        className="stop"
                        onClick={() => simulator.freeze()}
                      >
                        Stop motion
                      </button>
                      <button onClick={() => pose(-20, 15, 8)}>Curious</button>
                      <button onClick={() => pose(15, 8, 30)}>Hello</button>
                      <button
                        onClick={() =>
                          pose(0, 0, 0, {
                            left: defaultEye(),
                            right: defaultEye(),
                          })
                        }
                      >
                        Neutral
                      </button>
                    </div>
                  </fieldset>
                </section>
                <section className="eyes-section">
                  <div className="section-title">
                    <h3>Eye displays</h3>
                    <span className="tag">
                      {width} × {height} px
                    </span>
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
                    <label className="eye-mode">
                      Display
                      <select
                        aria-label="Eye display"
                        value={
                          selectedEye.mode === "symbol"
                            ? selectedEye.name
                            : selectedEye.mode
                        }
                        onChange={(e) =>
                          setEye(
                            eyeSide,
                            e.target.value === "parameters"
                              ? defaultEye()
                              : {
                                  mode: "symbol",
                                  name: e.target.value as SymbolEye["name"],
                                  brightness: selectedEye.brightness,
                                },
                          )
                        }
                      >
                        <option value="parameters">Pupil</option>
                        {eyeSymbols.map((name) => (
                          <option key={name} value={name}>
                            {name[0].toUpperCase() + name.slice(1)}
                          </option>
                        ))}
                        {selectedEye.mode === "expression" && (
                          <option value="expression" disabled>
                            {selectedEye.name}
                          </option>
                        )}
                        {selectedEye.mode === "pixels" && (
                          <option value="pixels" disabled>
                            Framebuffer
                          </option>
                        )}
                      </select>
                    </label>
                    {selectedEye.mode === "parameters" && (
                      <>
                        <div className="eye-coordinates">
                          {(["x", "y"] as const).map((axis) => (
                            <label key={axis}>
                              Pupil {axis.toUpperCase()}
                              <NumberInput
                                aria-label={`Pupil ${axis.toUpperCase()}`}
                                min={0}
                                max={axis === "x" ? width - 1 : height - 1}
                                value={parameterEye[axis]}
                                onCommit={(value) =>
                                  setEye(eyeSide, {
                                    ...parameterEye,
                                    [axis]: value,
                                  })
                                }
                              />
                            </label>
                          ))}
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
                              setEye(eyeSide, {
                                ...parameterEye,
                                openness: +e.target.value,
                              })
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
                          setEye(eyeSide, {
                            ...selectedEye,
                            brightness: +e.target.value,
                          })
                        }
                      />
                      <span>{Math.round(selectedEye.brightness * 100)}%</span>
                    </label>
                  </fieldset>
                  <p className="hint">One monochrome eye per screen.</p>
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
                  onClick={sendJson}
                >
                  Send command
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
                        '{ mode: "pixels", data: "<base64 MONO1>", brightness: 1 }'
                      }
                    </code>
                    . Each frame is {frameBytes.toLocaleString()} bytes: {width}{" "}
                    × {height} bits, top-left origin, row-major, most
                    significant bit first.
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
                    <span>No events.</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        </aside>
      </main>
    </div>
  );
}

function MotorControl({
  joint,
  index,
  targetDeg,
  angleDeg,
  speed,
  onAngle,
  onSpeed,
}: {
  joint: Joint;
  index: number;
  targetDeg: number;
  angleDeg: number;
  speed: number;
  onAngle: (angleDeg: number) => void;
  onSpeed: (speed: number) => void;
}) {
  const motor = config.motors[joint];
  return (
    <div className="motor">
      <div className="motor-title">
        <label htmlFor={joint}>
          <span className="number">0{index + 1}</span>
          {motor.label}
        </label>
        <div className="angle-input">
          <NumberInput
            id={`${joint}-number`}
            aria-label={`${motor.label} target`}
            min={motor.min}
            max={motor.max}
            value={targetDeg}
            onCommit={onAngle}
          />
          <span>°</span>
        </div>
      </div>
      <input
        id={joint}
        aria-label={motor.label}
        type="range"
        min={motor.min}
        max={motor.max}
        step="1"
        value={targetDeg}
        onChange={(e) => onAngle(+e.target.value)}
      />
      <div className="motor-meta">
        <span>{motor.min}°</span>
        <label>
          Speed{" "}
          <NumberInput
            aria-label={`${motor.label} speed`}
            min={1}
            max={motor.maxSpeed}
            value={speed}
            onCommit={onSpeed}
          />{" "}
          °/s
        </label>
        <span>
          Actual <b data-testid={`${joint}-actual`}>{angleDeg.toFixed(1)}°</b>
        </span>
        <span>{motor.max}°</span>
      </div>
    </div>
  );
}
