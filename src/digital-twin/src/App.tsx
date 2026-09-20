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
import { Badge } from "@ui/components/badge";
import { Button } from "@ui/components/button";
import { Input } from "@ui/components/input";
import { Textarea } from "@ui/components/textarea";
import { cn } from "@ui/lib/utils";

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
      <div className="scene-error absolute inset-0 flex items-center p-8 text-mute">
        The 3D view requires WebGL. Enable hardware acceleration and reload.
        Controller tools remain available.
      </div>
    ) : (
      this.props.children
    );
  }
}

function statusTone(status: string) {
  if (status === "connected") return "live" as const;
  if (status === "connecting" || status === "reconnecting") return "wait" as const;
  return "mute" as const;
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
    <div className="app flex h-dvh min-h-[760px] flex-col bg-canvas text-ink">
      <header className="topbar flex flex-wrap items-center justify-between gap-3 border-b border-oat px-5 py-3">
        <div className="min-w-0 shrink-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-pink">
            Digital twin
          </p>
          <h1 className="font-display text-[28px] leading-none italic">
            Virtual Socky
          </h1>
        </div>
        <div className="connect-tools flex min-w-0 flex-1 items-center justify-end gap-3">
          <Badge
            className={`status ${status}`}
            tone={statusTone(status)}
          >
            <i
              className={cn(
                "size-1.5 rounded-full",
                status === "connected" ? "bg-glow" : "bg-current",
              )}
            />
            {status === "disconnected" ? "Local mode" : status}
            {moving ? " · moving" : ""}
          </Badge>
          <Input
            aria-label="WebSocket URL"
            className="h-10 max-w-72 font-mono text-xs"
            value={url}
            disabled={!local}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
          <Button
            className="dark shrink-0"
            variant={local ? "ink" : "ghost"}
            size="sm"
            onClick={connectOrDisconnect}
          >
            {local ? "Connect" : "Disconnect"}
          </Button>
        </div>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] max-[850px]:flex max-[850px]:flex-col">
        <div className="stage relative flex min-h-0 min-w-0 flex-col">
          <section
            className="viewport relative min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas max-[850px]:h-[420px] max-[850px]:flex-none"
            aria-label="Puppet simulation"
          >
            <SceneBoundary>
              <Scene simulator={simulator} axes={axes} reset={reset} />
            </SceneBoundary>
            <div className="scene-tools absolute top-4 right-4 flex gap-2">
              <Button
                size="sm"
                variant={axes ? "quiet" : "ghost"}
                className={axes ? "active" : ""}
                onClick={() => setAxes(!axes)}
                aria-pressed={axes}
                title="Show joint axes"
              >
                <span>Joint axes</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setReset((r) => r + 1)}
                title="Reset camera"
              >
                <span>Reset view</span>
              </Button>
            </div>
          </section>
          <div className="anim-dock pointer-events-auto absolute inset-x-4 bottom-4 z-10 rounded-[22px] bg-paper p-3 shadow-[var(--shadow-soft)]">
            <Playground
              disabled={!local}
              send={(c) => {
                simulator.applyCommand(c);
              }}
            />
          </div>
        </div>
        <aside className="panel min-w-0 overflow-y-auto border-l border-oat bg-paper max-[850px]:border-l-0 max-[850px]:border-t">
          <div className="px-5 pt-5">
            <div className="flex items-end justify-between gap-2">
              <h2 className="font-display text-[22px] italic leading-none">
                Face
              </h2>
              <span className="tag font-mono text-[11px] text-mute">
                {width} × {height}
              </span>
            </div>
            <div className="eye-overview mt-3 flex gap-2">
              {sides.map((side) => (
                <button
                  key={side}
                  type="button"
                  className={cn(
                    "eye-card flex min-w-0 flex-1 flex-col items-start gap-2 rounded-md border-[1.5px] bg-canvas p-2",
                    side === eyeSide ? "selected border-ink" : "border-oat",
                  )}
                  onClick={() => setEyeSide(side)}
                  aria-pressed={side === eyeSide}
                >
                  <EyePreview eye={state.eyes[side]} />
                  <span className="text-xs capitalize">
                    {side} eye <i />
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="px-5 pt-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              Motion
            </p>
            <div className="mt-2 grid gap-2">
              {joints.map((joint) => (
                <TelemetryRow
                  key={joint}
                  joint={joint}
                  angleDeg={state.motors[joint].angleDeg}
                  targetDeg={state.motors[joint].targetDeg}
                  moving={state.motors[joint].moving}
                />
              ))}
            </div>
          </div>
          <div
            className="tabs mt-5 flex gap-5 border-b border-oat px-5"
            role="tablist"
            aria-label="Workspace"
          >
            <button
              role="tab"
              type="button"
              aria-selected={tab === "controls"}
              className={cn(
                "border-b-2 bg-transparent px-0 py-2.5",
                tab === "controls"
                  ? "selected border-rose font-medium"
                  : "border-transparent text-mute",
              )}
              onClick={() => setTab("controls")}
            >
              Manual controls
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={tab === "protocol"}
              className={cn(
                "border-b-2 bg-transparent px-0 py-2.5",
                tab === "protocol"
                  ? "selected border-rose font-medium"
                  : "border-transparent text-mute",
              )}
              onClick={() => setTab("protocol")}
            >
              Command console <span>{"{ }"}</span>
            </button>
          </div>
          <div className="panel-content px-5 pb-8">
            {state.creature && (
              <p className="pt-3 font-mono text-[11px] text-mute">
                {state.creature.behavior} · {state.creature.gesture} ·{" "}
                {state.creature.expression} · {state.creature.actionStatus}
              </p>
            )}
            {tab === "controls" ? (
              <>
                <section className="motor-section pt-4">
                  <div className="section-title flex items-center justify-between">
                    <h3 className="text-[15px] font-medium">Movement</h3>
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
                    <div className="presets mt-4 flex flex-wrap gap-2">
                      <Button
                        className="stop"
                        variant="stop"
                        size="sm"
                        type="button"
                        onClick={() => simulator.freeze()}
                      >
                        Stop motion
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        type="button"
                        onClick={() => pose(-20, 15, 8)}
                      >
                        Curious
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        type="button"
                        onClick={() => pose(15, 8, 30)}
                      >
                        Hello
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() =>
                          pose(0, 0, 0, {
                            left: defaultEye(),
                            right: defaultEye(),
                          })
                        }
                      >
                        Neutral
                      </Button>
                    </div>
                  </fieldset>
                </section>
                <section className="eyes-section pt-6">
                  <div className="section-title">
                    <h3 className="text-[15px] font-medium">Eye displays</h3>
                  </div>
                  <fieldset disabled={!local} className="mt-3">
                    <label className="eye-mode mb-3 flex items-center justify-between text-[13px]">
                      Display
                      <select
                        aria-label="Eye display"
                        className="h-9 w-[65%] rounded-md border-[1.5px] border-knit bg-paper px-2"
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
                        <div className="eye-coordinates flex gap-4">
                          {(["x", "y"] as const).map((axis) => (
                            <label
                              key={axis}
                              className="flex items-center gap-2 text-[13px]"
                            >
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
                        <label className="eye-slider mt-3 flex items-center gap-3 text-xs">
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
                          <span className="w-9 text-right">
                            {Math.round(parameterEye.openness * 100)}%
                          </span>
                        </label>
                      </>
                    )}
                    <label className="eye-slider mt-3 flex items-center gap-3 text-xs">
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
                      <span className="w-9 text-right">
                        {Math.round(selectedEye.brightness * 100)}%
                      </span>
                    </label>
                  </fieldset>
                </section>
              </>
            ) : (
              <section className="console-section pt-4">
                <div className="section-title flex items-center justify-between">
                  <h3 className="text-[15px] font-medium">Send a command</h3>
                  <span className="tag font-mono text-[11px] text-mute">
                    JSON / V1
                  </span>
                </div>
                <Textarea
                  aria-label="JSON command"
                  className="mt-3 min-h-64"
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                  spellCheck={false}
                  disabled={!local}
                />
                <Button
                  className="dark send-button mt-3"
                  variant="ink"
                  disabled={!local}
                  onClick={sendJson}
                >
                  Send command
                </Button>
                <output className="command-result" aria-live="polite">
                  {result}
                </output>
                <details className="mt-5 text-xs leading-relaxed text-mute">
                  <summary className="cursor-pointer">Pixel-frame format</summary>
                  <p className="mt-2 overflow-wrap-anywhere">
                    Set either eye to{" "}
                    <code className="rounded bg-oat px-1">
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
            <section className="event-section pt-6">
              <div className="section-title flex items-center justify-between">
                <h3 className="text-[15px] font-medium">
                  Event log <span className="event-count font-normal text-mute">{events.length}</span>
                </h3>
                <button
                  type="button"
                  className="text-button text-xs text-mute"
                  onClick={() => setEvents([])}
                >
                  Clear
                </button>
              </div>
              <div className="event-log" aria-label="Event log">
                {events.length ? (
                  events.map((event, i) => (
                    <div
                      className={event.error ? "error text-rose" : ""}
                      key={`${event.time}-${i}`}
                    >
                      <time>{event.time}</time>
                      <span>{event.message}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-log text-mute">
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

function TelemetryRow({
  joint,
  angleDeg,
  targetDeg,
  moving,
}: {
  joint: Joint;
  angleDeg: number;
  targetDeg: number;
  moving: boolean;
}) {
  const motor = config.motors[joint];
  const span = motor.max - motor.min || 1;
  const pct = Math.max(0, Math.min(100, ((angleDeg - motor.min) / span) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span>{motor.label}</span>
        <span className="font-mono text-mute">
          <b data-testid={`${joint}-hud`} className="font-medium text-ink">
            {angleDeg.toFixed(1)}°
          </b>
          <span className="ml-1">{moving ? "moving" : "still"}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-oat">
        <div
          className="h-full rounded-pill bg-rose"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-0.5 font-mono text-[10px] text-mute">
        target {targetDeg.toFixed(1)}°
      </p>
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
    <div className="motor mt-5">
      <div className="motor-title flex items-center justify-between gap-2">
        <label htmlFor={joint} className="flex items-center gap-2">
          <span className="number font-mono text-[11px] text-mute">
            0{index + 1}
          </span>
          {motor.label}
        </label>
        <div className="angle-input flex items-center gap-1">
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
      <div className="motor-meta flex items-center justify-between gap-1 text-[11px] text-mute">
        <span>{motor.min}°</span>
        <label className="flex items-center gap-1">
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
