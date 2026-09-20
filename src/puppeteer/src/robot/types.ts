import { z } from "zod";
import { expressionIds, type Expression } from "@sock-puppet/robot/expressions";
import { gestures } from "@sock-puppet/robot/actions";
import { config, joints, sides } from "@sock-puppet/robot/config";
import {
  eyeModes,
  parseCommand,
  type CapabilitiesMessage,
  type Command,
  type Result,
  type State,
} from "@sock-puppet/robot/protocol";

export type Capabilities = CapabilitiesMessage;
export type { State };
export type RobotEvent =
  | { type: "connection"; connected: boolean; message: string }
  | { type: "state"; state: State }
  | { type: "result"; result: Result }
  | { type: "pending"; count: number }
  | {
      type: "wire";
      phase: "sent" | "ack" | "marker";
      line: string;
      latencyMs?: number;
    };
export interface RobotClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  applyCommand(command: Command): Promise<Result>;
  cancelPending(): void;
  getState(): State | undefined;
  getCapabilities(): Capabilities | undefined;
  subscribe(listener: (event: RobotEvent) => void): () => void;
  readonly connected: boolean;
}
export const maxSpeeds = Object.fromEntries(
  joints.map((j) => [j, config.motors[j].maxSpeed]),
) as Record<(typeof joints)[number], number>;
const motorState = z.object({
  angleDeg: z.number().finite(),
  targetDeg: z.number().finite(),
  speedDegPerSec: z.number().finite().positive(),
  moving: z.boolean(),
});
export const motorsSchema = z.object({
  baseYaw: motorState,
  headPitch: motorState,
  jawOpen: motorState,
});
const creatureSchema = z
  .object({
    behavior: z.enum(["stopped", "idle/listening", "thinking", "performing"]),
    gesture: z.enum(gestures),
    expression: z
      .string()
      .refine((v) => expressionIds.includes(v))
      .transform((v) => v as Expression),
    actionId: z.string().max(128).nullable(),
    actionStatus: z.enum([
      "idle",
      "running",
      "completed",
      "canceled",
      "expired",
    ]),
    moveId: z.string().max(128).nullable(),
    moveProgress: z.number().finite().min(0).max(1),
    movePhase: z.number().int().min(0).nullable(),
  })
  .strict();
export function validateState(
  raw: unknown,
  previous?: State,
  limits: Capabilities["motors"] = config.motors,
): State {
  const value = z
    .object({
      motors: motorsSchema,
      eyes: z.unknown().optional(),
      creature: creatureSchema.optional(),
    })
    .parse(raw);
  const incoming = value.eyes as State["eyes"] | undefined;
  const eyes = incoming ? { ...previous?.eyes, ...incoming } : previous?.eyes;
  parseCommand({ version: 2, type: "command", id: "state-validation", eyes });
  if (!eyes?.left || !eyes.right) throw new Error("Incomplete eye state");
  for (const joint of joints) {
    if (value.motors[joint].speedDegPerSec > limits[joint].maxSpeed)
      throw new Error("Telemetry exceeds speed limit");
    for (const key of ["angleDeg", "targetDeg"] as const) {
      if (
        value.motors[joint][key] < limits[joint].min ||
        value.motors[joint][key] > limits[joint].max
      )
        throw new Error("Telemetry outside joint limits");
    }
  }
  return {
    motors: value.motors,
    eyes: eyes!,
    creature: value.creature ?? previous?.creature,
  };
}
export function validateCapabilities(raw: unknown): Capabilities {
  const v = z
    .object({
      version: z.literal(2),
      type: z.literal("capabilities"),
      motors: z.record(
        z.object({
          min: z.number().finite(),
          max: z.number().finite(),
          speed: z.number().finite().min(1),
          label: z.string(),
          maxSpeed: z.number().finite().min(1),
          acceleration: z.number().finite().positive(),
        }),
      ),
      display: z.object({
        width: z.literal(config.display.width),
        height: z.literal(config.display.height),
        format: z.literal("MONO1"),
      }),
      eyeModes: z.array(z.string()),
      state: z.unknown(),
    })
    .parse(raw);
  for (const joint of joints) {
    const m = v.motors[joint];
    if (
      !m ||
      m.min > 0 ||
      m.max < 0 ||
      m.min >= m.max ||
      m.speed > m.maxSpeed ||
      m.maxSpeed > maxSpeeds[joint] ||
      m.acceleration > config.motors[joint].acceleration ||
      m.min < config.motors[joint].min ||
      m.max > config.motors[joint].max
    )
      throw new Error("Invalid joint capabilities");
  }
  if (!eyeModes.every((mode) => v.eyeModes.includes(mode)))
    throw new Error("Pupil, symbol, and pixel display modes required");
  return {
    version: 2,
    type: "capabilities",
    motors: v.motors as Capabilities["motors"],
    display: v.display,
    eyeModes,
    state: validateState(
      v.state,
      undefined,
      v.motors as Capabilities["motors"],
    ),
  };
}
export function validateForRobot(
  command: Command,
  capabilities?: Capabilities,
): Command {
  const parsed = parseCommand(command);
  if (!capabilities) throw new Error("Robot has not completed handshake");
  if (parsed.creature?.kind === "act" || parsed.creature?.kind === "move") {
    const action =
      parsed.creature.kind === "act"
        ? parsed.creature.action
        : parsed.creature.move;
    if (action.yaw !== undefined) {
      const yaw = action.yaw,
        limit = capabilities.motors.baseYaw;
      if (yaw < limit.min || yaw > limit.max)
        throw new Error("Yaw exceeds device range");
    }
    if (action.pitch !== undefined) {
      const pitch = action.pitch,
        limit = capabilities.motors.headPitch;
      if (pitch < limit.min || pitch > limit.max)
        throw new Error("Pitch exceeds device range");
    }
  }
  for (const joint of joints) {
    const m = parsed.motors?.[joint];
    if (!m) continue;
    const limits = capabilities.motors[joint];
    m.speedDegPerSec ??= Math.min(config.motors[joint].speed, limits.speed);
    if (m.angleDeg < limits.min || m.angleDeg > limits.max)
      throw new Error(`${joint} exceeds device range`);
    if (
      (m.speedDegPerSec ?? limits.speed) >
      Math.min(maxSpeeds[joint], limits.maxSpeed)
    )
      throw new Error(
        `${joint} exceeds speed limit ${Math.min(maxSpeeds[joint], limits.maxSpeed)}`,
      );
  }
  for (const side of sides)
    if (
      parsed.eyes?.[side] &&
      !capabilities.eyeModes.includes(parsed.eyes[side]!.mode)
    )
      throw new Error("Unsupported eye mode");
  return parsed;
}
