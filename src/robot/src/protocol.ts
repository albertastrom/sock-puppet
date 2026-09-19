import { parseCreature, type CreatureUpdate } from "./actions";
import type { CreatureStatus } from "./creature";
import { expressionIds, type Expression } from "./expressions";
import {
  config,
  frameBase64Length,
  frameBytes,
  joints,
  sides,
  type Joint,
  type Side,
} from "./config";

export type { Joint, Side };

export type ParameterEye = {
  mode: "parameters";
  x: number;
  y: number;
  brightness: number;
  openness: number;
};
export type PixelEye = { mode: "pixels"; data: string; brightness: number };
export const eyeSymbols = ["heart", "star", "question", "smile"] as const;
export type SymbolEye = {
  mode: "symbol";
  name: (typeof eyeSymbols)[number];
  brightness: number;
};
export type ExpressionEye = {
  mode: "expression";
  name: Expression;
  x: number;
  y: number;
  size: number;
  convergence: number;
  openness: number;
  brightness: number;
  side: Side;
};
export type Eye = ParameterEye | SymbolEye | PixelEye | ExpressionEye;
export type MotorCommand = { angleDeg: number; speedDegPerSec?: number };
export type Command = {
  version: 2;
  type: "command";
  id: string;
  creature?: CreatureUpdate;
  motors?: Partial<Record<Joint, MotorCommand>>;
  eyes?: Partial<Record<Side, Eye>>;
};
export type Result =
  | { version: 2; type: "ack"; id: string }
  | { version: 2; type: "error"; id: string | null; message: string };
export type MotorState = {
  angleDeg: number;
  targetDeg: number;
  speedDegPerSec: number;
  moving: boolean;
};
export type State = {
  creature?: CreatureStatus;
  motors: Record<Joint, MotorState>;
  eyes: Record<Side, Eye>;
};
export const eyeModes = [
  "parameters",
  "symbol",
  "pixels",
  "expression",
] as const;
export type CapabilitiesMessage = {
  version: 2;
  type: "capabilities";
  motors: typeof config.motors;
  display: typeof config.display;
  eyeModes: typeof eyeModes;
  state: State;
};
export type StateMessage = {
  version: 2;
  type: "state";
  creature?: CreatureStatus;
  motors: State["motors"];
  eyes?: State["eyes"];
};
export type WireMessage = CapabilitiesMessage | StateMessage | Result;

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) {
  requireValue(
    Object.keys(value).every((k) => allowed.includes(k)),
    `Unknown field in ${path}`,
  );
}
function number(
  v: unknown,
  min: number,
  max: number,
  name: string,
): asserts v is number {
  requireValue(
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max,
    `${name} must be between ${min} and ${max}`,
  );
}

export function decodeFrame(data: string): Uint8Array {
  requireValue(
    data.length === frameBase64Length && /^[A-Za-z0-9+/]+={0,2}$/.test(data),
    `Frame must be base64 MONO1 (${frameBytes} bytes)`,
  );
  const binary = atob(data);
  requireValue(
    binary.length === frameBytes,
    `Frame must contain ${frameBytes} bytes`,
  );
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function parseCommand(raw: unknown): Command {
  requireValue(object(raw), "Command must be an object");
  keys(raw, ["version", "type", "id", "motors", "eyes", "creature"], "command");
  requireValue(
    raw.version === 2 && raw.type === "command",
    "Expected version 2 command",
  );
  const id = raw.id;
  requireValue(
    typeof id === "string" && id.length > 0 && id.length <= 128,
    "id must be a nonempty string, at most 128 characters",
  );
  if (raw.creature !== undefined) {
    requireValue(
      raw.motors === undefined && raw.eyes === undefined,
      "Creature and manual updates cannot mix",
    );
    return {
      version: 2,
      type: "command",
      id,
      creature: parseCreature(raw.creature),
    };
  }
  let updates = 0;
  let motors: Command["motors"];
  if (raw.motors !== undefined) {
    requireValue(object(raw.motors), "motors must be an object");
    keys(raw.motors, joints, "motors");
    const parsed: NonNullable<Command["motors"]> = {};
    for (const joint of joints) {
      const motor = raw.motors[joint];
      if (motor === undefined) continue;
      requireValue(object(motor), `${joint} must be an object`);
      keys(motor, ["angleDeg", "speedDegPerSec"], joint);
      number(
        motor.angleDeg,
        config.motors[joint].min,
        config.motors[joint].max,
        `${joint}.angleDeg`,
      );
      const command: MotorCommand = { angleDeg: motor.angleDeg };
      if (motor.speedDegPerSec !== undefined) {
        requireValue(
          typeof motor.speedDegPerSec === "number" &&
            Number.isFinite(motor.speedDegPerSec) &&
            motor.speedDegPerSec >= 1 &&
            motor.speedDegPerSec <= config.motors[joint].maxSpeed,
          `speedDegPerSec must be between 1 and ${config.motors[joint].maxSpeed}`,
        );
        command.speedDegPerSec = motor.speedDegPerSec;
      }
      parsed[joint] = command;
      updates++;
    }
    motors = parsed;
  }
  let eyes: Command["eyes"];
  if (raw.eyes !== undefined) {
    requireValue(object(raw.eyes), "eyes must be an object");
    keys(raw.eyes, sides, "eyes");
    const parsed: NonNullable<Command["eyes"]> = {};
    for (const side of sides) {
      const eye = raw.eyes[side];
      if (eye === undefined) continue;
      requireValue(object(eye), `${side} eye must be an object`);
      number(eye.brightness, 0, 1, "brightness");
      if (eye.mode === "parameters") {
        keys(eye, ["mode", "x", "y", "brightness", "openness"], side);
        number(eye.x, 0, config.display.width - 1, "x");
        number(eye.y, 0, config.display.height - 1, "y");
        number(eye.openness, 0, 1, "openness");
        parsed[side] = {
          mode: "parameters",
          x: eye.x,
          y: eye.y,
          brightness: eye.brightness,
          openness: eye.openness,
        };
      } else if (eye.mode === "expression") {
        keys(
          eye,
          [
            "mode",
            "name",
            "x",
            "y",
            "size",
            "convergence",
            "openness",
            "brightness",
            "side",
          ],
          side,
        );
        requireValue(
          expressionIds.includes(String(eye.name)),
          "Unknown expression",
        );
        number(eye.x, -1, 1, "gaze x");
        number(eye.y, -1, 1, "gaze y");
        number(eye.size, 0.5, 1.5, "pupil size");
        number(eye.convergence, -1, 1, "convergence");
        number(eye.openness, 0, 1, "openness");
        requireValue(eye.side === side, "Expression side must match panel");
        parsed[side] = {
          mode: "expression",
          name: eye.name as Expression,
          x: eye.x,
          y: eye.y,
          size: eye.size,
          convergence: eye.convergence,
          openness: eye.openness,
          brightness: eye.brightness,
          side,
        };
      } else if (eye.mode === "symbol") {
        keys(eye, ["mode", "name", "brightness"], side);
        requireValue(
          eyeSymbols.includes(eye.name as SymbolEye["name"]),
          "Unknown eye symbol",
        );
        parsed[side] = {
          mode: "symbol",
          name: eye.name as SymbolEye["name"],
          brightness: eye.brightness,
        };
      } else {
        requireValue(eye.mode === "pixels", "Unknown eye mode");
        keys(eye, ["mode", "data", "brightness"], side);
        const data = eye.data;
        requireValue(typeof data === "string", "data must be base64");
        decodeFrame(data);
        parsed[side] = { mode: "pixels", data, brightness: eye.brightness };
      }
      updates++;
    }
    eyes = parsed;
  }
  requireValue(updates > 0, "Command needs at least one motor or eye update");
  return {
    version: 2,
    type: "command",
    id,
    ...(motors ? { motors } : {}),
    ...(eyes ? { eyes } : {}),
  };
}

export function errorResult(
  raw: unknown,
  error: unknown,
): Extract<Result, { type: "error" }> {
  return {
    version: 2,
    type: "error",
    id: object(raw) && typeof raw.id === "string" ? raw.id : null,
    message: error instanceof Error ? error.message : "Invalid command",
  };
}

export const defaultEye = (): ParameterEye => ({
  mode: "parameters",
  x: 32,
  y: 64,
  brightness: 1,
  openness: 1,
});

export function capabilitiesMessage(state: State): CapabilitiesMessage {
  return {
    version: 2,
    type: "capabilities",
    motors: config.motors,
    display: config.display,
    eyeModes,
    state,
  };
}

export function stateMessage(
  state: State,
  previousEyes?: State["eyes"],
): StateMessage {
  return {
    version: 2,
    type: "state",
    motors: state.motors,
    creature: state.creature,
    ...(state.eyes !== previousEyes ? { eyes: state.eyes } : {}),
  };
}
