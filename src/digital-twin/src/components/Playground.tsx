import { useState } from "react";
import type { CreatureStatus } from "@sock-puppet/robot/creature";
import {
  expressionDescriptions,
  gestureMoves,
  idleProfiles,
  poseMoves,
  routineMoves,
  sequenceDescriptions,
} from "@sock-puppet/robot/move-catalog";
import {
  expressions,
  sequences,
  type Expression,
  type Sequence,
} from "@sock-puppet/robot/expressions";
import type { Command } from "@sock-puppet/robot/protocol";
import { Button } from "@ui/components/button";

const gestureIds = (Object.keys(gestureMoves) as Array<keyof typeof gestureMoves>).filter(
  (id) => id !== "none",
);
const poseIds = Object.keys(poseMoves) as (keyof typeof poseMoves)[];
const routineIds = Object.keys(routineMoves) as (keyof typeof routineMoves)[];

export function Playground({
  send,
  disabled,
  status,
}: {
  send: (command: Command) => void;
  disabled: boolean;
  status?: CreatureStatus;
}) {
  const [expression, setExpression] = useState<Expression>("neutral");
  const [gaze, setGaze] = useState({ x: 0, y: 0, size: 1, convergence: 0 });
  const [idleGain, setIdleGain] = useState(1);
  const [jawGain, setJawGain] = useState(300);
  const command = (creature: NonNullable<Command["creature"]>) =>
    send({ version: 2, type: "command", id: crypto.randomUUID(), creature });
  const play = (id: string, n = 1) =>
    command({
      kind: "move",
      move: { id, n, ...(id === "none" ? { expression } : {}) },
      ttlMs: 20000,
    });
  const progress =
    status?.moveId && status.actionStatus === "running"
      ? `${status.moveId}${status.movePhase != null ? ` · step ${status.movePhase + 1}` : ""} · ${Math.round(status.moveProgress * 100)}%`
      : null;
  return (
    <fieldset disabled={disabled} className="playground min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          type="button"
          title={idleProfiles.listening.description}
          onClick={() =>
            command({
              kind: "behavior",
              behavior: "idle/listening",
              idleGain,
              jawGain,
              sequence: null,
            })
          }
        >
          Start idle
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          title={idleProfiles.thinking.description}
          onClick={() =>
            command({
              kind: "behavior",
              behavior: "thinking",
              idleGain,
              jawGain,
            })
          }
        >
          Thinking
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => command({ kind: "stop", closeJaw: true })}
        >
          Pause creature
        </Button>
        {gestureIds.map((id) => (
          <Button
            key={id}
            size="sm"
            variant="quiet"
            type="button"
            title={gestureMoves[id].description}
            onClick={() => play(id)}
          >
            {id}
          </Button>
        ))}
        <Button
          size="sm"
          variant="live"
          type="button"
          onClick={() =>
            command({ kind: "speech", rms: 0.15, sequence: Date.now() })
          }
        >
          Test jaw pulse
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {poseIds.map((id) => (
          <Button
            key={id}
            size="sm"
            variant="quiet"
            type="button"
            title={poseMoves[id].description}
            onClick={() => play(id)}
          >
            {poseMoves[id].label}
          </Button>
        ))}
        {routineIds.map((id) => (
          <Button
            key={id}
            size="sm"
            variant="live"
            type="button"
            title={routineMoves[id].description}
            aria-pressed={status?.moveId === id && status.actionStatus === "running"}
            onClick={() => play(id)}
          >
            {routineMoves[id].label}
          </Button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-mute">
        <label className="flex items-center gap-2">
          Expression{" "}
          <select
            aria-label="Expression"
            className="h-9 rounded-md border-[1.5px] border-knit bg-paper px-2 text-ink"
            value={expression}
            title={expressionDescriptions[expression]}
            onChange={(e) => {
              const name = e.target.value as Expression;
              setExpression(name);
              command({
                kind: "move",
                move: { id: "none", n: 1, expression: name },
                ttlMs: 4000,
              });
            }}
          >
            {expressions.map((e) => (
              <option
                key={e.id}
                value={e.id}
                title={expressionDescriptions[e.id]}
              >
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Eye sequence{" "}
          <select
            aria-label="Eye sequence"
            className="h-9 rounded-md border-[1.5px] border-knit bg-paper px-2 text-ink"
            defaultValue=""
            onChange={(e) =>
              command({
                kind: "behavior",
                behavior: "idle/listening",
                sequence: (e.target.value || null) as Sequence | null,
              })
            }
          >
            <option value="">None</option>
            {Object.keys(sequences).map((s) => (
              <option
                key={s}
                title={sequenceDescriptions[s as Sequence]}
              >
                {s}
              </option>
            ))}
          </select>
        </label>
        {progress && (
          <span className="font-mono text-[11px]" data-testid="move-progress">
            {progress}
          </span>
        )}
      </div>
      <details className="mt-2 text-[12px] text-mute">
        <summary className="cursor-pointer select-none">Gaze and gain</summary>
        <div className="mt-2 grid gap-1">
          {(["x", "y", "size", "convergence"] as const).map((key) => (
            <label key={key} className="flex items-center justify-between gap-3">
              Pupil {key}
              <input
                type="range"
                min={key === "size" ? 0.5 : -1}
                max={key === "size" ? 1.5 : 1}
                step={0.05}
                value={gaze[key]}
                onChange={(e) => {
                  const next = { ...gaze, [key]: Number(e.target.value) };
                  setGaze(next);
                  command({
                    kind: "behavior",
                    behavior: "idle/listening",
                    gaze: next,
                  });
                }}
              />
            </label>
          ))}
          <label className="flex items-center justify-between gap-3">
            Idle movement
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={idleGain}
              onChange={(e) => {
                setIdleGain(+e.target.value);
                command({
                  kind: "behavior",
                  behavior: "idle/listening",
                  idleGain: +e.target.value,
                });
              }}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            Jaw gain
            <input
              type="range"
              min="0"
              max="300"
              value={jawGain}
              onChange={(e) => {
                setJawGain(+e.target.value);
                command({
                  kind: "behavior",
                  behavior: "idle/listening",
                  jawGain: +e.target.value,
                });
              }}
            />
          </label>
        </div>
      </details>
    </fieldset>
  );
}
