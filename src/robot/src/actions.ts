import { config } from "./config";
import {
  expressionIds,
  sequences,
  type Expression,
  type Sequence,
} from "./expressions";
export const gestures = [
  "none",
  "nod",
  "shake",
  "look",
  "bow",
  "perk",
  "sway",
  "celebrate",
] as const;
export type Gesture = (typeof gestures)[number];
export type Act = {
  gesture: Gesture;
  n: number;
  yaw?: number;
  pitch?: number;
  expression?: Expression;
};
export type Behavior = "stopped" | "idle/listening" | "thinking" | "performing";
export type CreatureUpdate =
  | { kind: "act"; action: Act; ttlMs: number }
  | {
      kind: "behavior";
      behavior: Behavior;
      idleGain?: number;
      jawGain?: number;
      gaze?: { x: number; y: number; size: number; convergence: number };
      sequence?: Sequence | null;
    }
  | { kind: "speech"; rms: number; sequence: number }
  | { kind: "stop"; closeJaw: boolean };
export function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Expected object");
  return raw as Record<string, unknown>;
}
export function bounded(
  raw: unknown,
  min: number,
  max: number,
  name: string,
): number {
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    raw < min ||
    raw > max
  )
    throw new Error(`${name} must be ${min}…${max}`);
  return raw;
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((k) => !keys.includes(k)))
    throw new Error("Unknown action field");
}
export function parseAct(raw: unknown): Act {
  const a = record(raw);
  only(a, ["gesture", "n", "yaw", "pitch", "expression"]);
  if (!gestures.includes(a.gesture as Gesture))
    throw new Error("Unknown gesture");
  const n = bounded(a.n ?? 1, 1, 3, "repetitions");
  if (!Number.isInteger(n)) throw new Error("Repetitions must be integer");
  const result: Act = { gesture: a.gesture as Gesture, n };
  if (a.yaw != null)
    result.yaw = bounded(
      a.yaw,
      config.motors.baseYaw.min,
      config.motors.baseYaw.max,
      "yaw",
    );
  if (a.pitch != null)
    result.pitch = bounded(
      a.pitch,
      config.motors.headPitch.min,
      config.motors.headPitch.max,
      "pitch",
    );
  if (a.expression != null) {
    if (!expressionIds.includes(String(a.expression)))
      throw new Error("Unknown expression");
    result.expression = a.expression as Expression;
  }
  return result;
}
export function parseCreature(raw: unknown): CreatureUpdate {
  const a = record(raw);
  switch (a.kind) {
    case "act":
      only(a, ["kind", "action", "ttlMs"]);
      return {
        kind: "act",
        action: parseAct(a.action),
        ttlMs: bounded(a.ttlMs, 100, 10000, "action lifetime"),
      };
    case "stop":
      only(a, ["kind", "closeJaw"]);
      if (typeof a.closeJaw !== "boolean")
        throw new Error("closeJaw must be boolean");
      return { kind: "stop", closeJaw: a.closeJaw };
    case "speech": {
      only(a, ["kind", "rms", "sequence"]);
      const sequence = bounded(
        a.sequence,
        0,
        Number.MAX_SAFE_INTEGER,
        "speech sequence",
      );
      if (!Number.isInteger(sequence)) throw new Error("Invalid sequence");
      return { kind: "speech", rms: bounded(a.rms, 0, 1, "RMS"), sequence };
    }
    case "behavior": {
      only(a, ["kind", "behavior", "idleGain", "jawGain", "gaze", "sequence"]);
      if (
        !["stopped", "idle/listening", "thinking", "performing"].includes(
          String(a.behavior),
        )
      )
        throw new Error("Unknown behavior");
      const result: Extract<CreatureUpdate, { kind: "behavior" }> = {
        kind: "behavior",
        behavior: a.behavior as Behavior,
      };
      if (a.idleGain !== undefined)
        result.idleGain = bounded(a.idleGain, 0, 2, "idle gain");
      if (a.jawGain !== undefined)
        result.jawGain = bounded(a.jawGain, 0, 300, "jaw gain");
      if (a.gaze !== undefined) {
        const g = record(a.gaze);
        only(g, ["x", "y", "size", "convergence"]);
        result.gaze = {
          x: bounded(g.x, -1, 1, "gaze x"),
          y: bounded(g.y, -1, 1, "gaze y"),
          size: bounded(g.size, 0.5, 1.5, "size"),
          convergence: bounded(g.convergence, -1, 1, "convergence"),
        };
      }
      if (a.sequence !== undefined) {
        if (
          a.sequence !== null &&
          !Object.hasOwn(sequences, String(a.sequence))
        )
          throw new Error("Unknown sequence");
        result.sequence = a.sequence as Sequence | null;
      }
      return result;
    }
    default:
      throw new Error("Unknown creature update");
  }
}
export const actTool = {
  type: "function" as const,
  name: "puppet_act",
  strict: false,
  description:
    "Perform a small expressive gesture and/or set portrait eye expression. Positive yaw looks to the puppet's left; positive pitch looks up. Use gesture look with yaw and/or pitch to aim the head. nod/shake/bow/perk/sway/celebrate add motion on top of the current aim. Audio drives the jaw automatically. Use sparingly alongside conversation; do not narrate routine gestures.",
  parameters: {
    type: "object",
    properties: {
      gesture: { type: "string", enum: gestures },
      n: { type: "integer", minimum: 1, maximum: 3 },
      yaw: { type: "number", minimum: -90, maximum: 90 },
      pitch: { type: "number", minimum: -45, maximum: 45 },
      expression: { type: "string", enum: expressionIds },
    },
    required: ["gesture"],
    additionalProperties: false,
  },
};
