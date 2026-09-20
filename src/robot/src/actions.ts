import { config } from "./config";
import {
  expressionIds,
  sequences,
  type Expression,
  type Sequence,
} from "./expressions";
import { gestures, type Gesture } from "./gestures";
import {
  catalogToolDescription,
  getMove,
  isMoveId,
  maxActTtlMs,
  maxMoveRepetitions,
  maxMoveTtlMs,
  modelMoveIds,
  moveTtlMs,
  type Move,
} from "./move-catalog";
export { gestures, type Gesture } from "./gestures";
export type { Move } from "./move-catalog";
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
  | { kind: "move"; move: Move; ttlMs: number }
  | {
      kind: "behavior";
      behavior: Behavior;
      idleGain?: number;
      jawGain?: number;
      gaze?: { x: number; y: number; size: number; convergence: number };
      sequence?: Sequence | null;
    }
  | { kind: "speech"; rms: number; sequence: number }
  | { kind: "talking"; on: boolean }
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
  const n = bounded(a.n ?? 1, 1, maxMoveRepetitions, "repetitions");
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
export function parseMove(raw: unknown): Move {
  const a = record(raw);
  only(a, ["id", "move", "n", "yaw", "pitch", "expression"]);
  const rawId = a.id ?? a.move;
  const id = String(
    rawId != null && String(rawId) !== ""
      ? rawId
      : a.yaw != null || a.pitch != null
        ? "look"
        : "none",
  );
  if (!isMoveId(id)) throw new Error("Unknown move");
  if (a.id != null && a.move != null && String(a.id) !== String(a.move))
    throw new Error("Move id mismatch");
  const entry = getMove(id);
  const requested = bounded(a.n ?? 1, 1, maxMoveRepetitions, "repetitions");
  if (!Number.isInteger(requested)) throw new Error("Repetitions must be integer");
  const result: Move = { id, n: entry.repeatable ? requested : 1 };
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
export function parsePuppetAct(raw: unknown): Extract<
  CreatureUpdate,
  { kind: "act" | "move" }
> {
  const a = record(raw);
  if (a.gesture != null) {
    return { kind: "act", action: parseAct(a), ttlMs: maxActTtlMs };
  }
  const move = parseMove(a);
  return { kind: "move", move, ttlMs: moveTtlMs(move) };
}
export function parseCreature(raw: unknown): CreatureUpdate {
  const a = record(raw);
  switch (a.kind) {
    case "act":
      only(a, ["kind", "action", "ttlMs"]);
      return {
        kind: "act",
        action: parseAct(a.action),
        ttlMs: bounded(a.ttlMs, 100, maxActTtlMs, "action lifetime"),
      };
    case "move":
      only(a, ["kind", "move", "ttlMs"]);
      return {
        kind: "move",
        move: parseMove(a.move),
        ttlMs: bounded(a.ttlMs, 100, maxMoveTtlMs, "action lifetime"),
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
    case "talking":
      only(a, ["kind", "on"]);
      if (typeof a.on !== "boolean") throw new Error("talking must be boolean");
      return { kind: "talking", on: a.on };
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
  description: catalogToolDescription(),
  parameters: {
    type: "object",
    properties: {
      move: { type: "string", enum: modelMoveIds },
      n: { type: "integer", minimum: 1, maximum: maxMoveRepetitions },
      yaw: {
        type: "number",
        minimum: config.motors.baseYaw.min,
        maximum: config.motors.baseYaw.max,
      },
      pitch: {
        type: "number",
        minimum: config.motors.headPitch.min,
        maximum: config.motors.headPitch.max,
      },
      expression: { type: "string", enum: expressionIds },
    },
    additionalProperties: false,
  },
};
