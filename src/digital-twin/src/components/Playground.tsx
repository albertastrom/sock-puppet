import { useState } from "react";
import { gestures, type Gesture } from "@sock-puppet/robot/actions";
import {
  expressions,
  sequences,
  type Expression,
  type Sequence,
} from "@sock-puppet/robot/expressions";
import type { Command } from "@sock-puppet/robot/protocol";
import { Button } from "@ui/components/button";

export function Playground({
  send,
  disabled,
}: {
  send: (command: Command) => void;
  disabled: boolean;
}) {
  const [expression, setExpression] = useState<Expression>("neutral");
  const [gaze, setGaze] = useState({ x: 0, y: 0, size: 1, convergence: 0 });
  const [idleGain, setIdleGain] = useState(1);
  const [jawGain, setJawGain] = useState(180);
  const command = (creature: NonNullable<Command["creature"]>) =>
    send({ version: 2, type: "command", id: crypto.randomUUID(), creature });
  const act = (gesture: Gesture) =>
    command({
      kind: "act",
      action: { gesture, n: 1, expression },
      ttlMs: 10000,
    });
  return (
    <fieldset disabled={disabled} className="playground min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          type="button"
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
          onClick={() => command({ kind: "stop", closeJaw: true })}
        >
          Pause creature
        </Button>
        {gestures
          .filter((g) => g !== "none")
          .map((g) => (
            <Button
              key={g}
              size="sm"
              variant="quiet"
              type="button"
              onClick={() => act(g)}
            >
              {g}
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
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-mute">
        <label className="flex items-center gap-2">
          Expression{" "}
          <select
            aria-label="Expression"
            className="h-9 rounded-md border-[1.5px] border-knit bg-paper px-2 text-ink"
            value={expression}
            onChange={(e) => {
              const name = e.target.value as Expression;
              setExpression(name);
              command({
                kind: "act",
                action: { gesture: "none", n: 1, expression: name },
                ttlMs: 4000,
              });
            }}
          >
            {expressions.map((e) => (
              <option key={e.id} value={e.id}>
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
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
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
