import { z } from "zod";
import { config, joints } from "@sock-puppet/robot/config";
import {
  parseCommand,
  type Command,
  type Eye,
  eyeSymbols,
} from "@sock-puppet/robot/protocol";
import { type Capabilities, validateForRobot } from "../robot/types";

const { width, height } = config.display;
const motor = (joint: (typeof joints)[number]) =>
  z
    .object({
      angleDeg: z
        .number()
        .finite()
        .min(config.motors[joint].min)
        .max(config.motors[joint].max),
      speedDegPerSec: z
        .number()
        .finite()
        .min(1)
        .max(config.motors[joint].maxSpeed),
    })
    .strict()
    .nullable();
const eye = z
  .union([
    z
      .object({
        mode: z.literal("parameters"),
        x: z
          .number()
          .min(0)
          .max(width - 1),
        y: z
          .number()
          .min(0)
          .max(height - 1),
        openness: z.number().min(0).max(1),
        brightness: z.number().min(0).max(1),
      })
      .strict(),
    z
      .object({
        mode: z.literal("symbol"),
        name: z.enum(eyeSymbols),
        brightness: z.number().min(0).max(1),
      })
      .strict(),
  ])
  .nullable();
export const performanceSchema = z
  .object({
    segments: z
      .array(
        z
          .object({
            text: z.string().max(800),
            durationMs: z.number().int().min(100).max(45000),
            actions: z
              .array(
                z
                  .object({
                    atMs: z.number().int().min(0).max(45000),
                    motors: z
                      .object({
                        baseYaw: motor("baseYaw"),
                        headPitch: motor("headPitch"),
                        jawOpen: motor("jawOpen"),
                      })
                      .strict(),
                    eyes: z.object({ left: eye, right: eye }).strict(),
                  })
                  .strict(),
              )
              .max(32),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export type Performance = z.infer<typeof performanceSchema>;
export type Segment = Performance["segments"][number];
export type Action = Segment["actions"][number];
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const num = { type: "number" },
  str = { type: "string" };
const maybe = (value: unknown) => ({ anyOf: [value, { type: "null" }] });
const jsonMotor = (joint: (typeof joints)[number]) =>
  maybe(
    object({
      angleDeg: {
        ...num,
        minimum: config.motors[joint].min,
        maximum: config.motors[joint].max,
      },
      speedDegPerSec: {
        ...num,
        minimum: 1,
        maximum: config.motors[joint].maxSpeed,
      },
    }),
  );
const jsonEye = {
  anyOf: [
    object({
      mode: { const: "parameters", type: "string" },
      x: { ...num, minimum: 0, maximum: 127 },
      y: { ...num, minimum: 0, maximum: 63 },
      brightness: { ...num, minimum: 0, maximum: 1 },
      openness: { ...num, minimum: 0, maximum: 1 },
    }),
    object({
      mode: { const: "symbol", type: "string" },
      name: { type: "string", enum: ["heart", "star", "question", "smile"] },
      brightness: { ...num, minimum: 0, maximum: 1 },
    }),
    { type: "null" },
  ],
};
export const performanceJsonSchema = object({
  segments: {
    type: "array",
    items: object({
      text: str,
      durationMs: num,
      actions: {
        type: "array",
        items: object({
          atMs: num,
          motors: object({
            baseYaw: jsonMotor("baseYaw"),
            headPitch: jsonMotor("headPitch"),
            jawOpen: jsonMotor("jawOpen"),
          }),
          eyes: object({ left: jsonEye, right: jsonEye }),
        }),
      },
    }),
  },
});
export function compileEye(value: NonNullable<Action["eyes"]["left"]>): Eye {
  return { ...value };
}
export function compileAction(action: Action, id: string): Command {
  const motors = Object.fromEntries(
    joints
      .map((joint) => [joint, action.motors[joint]] as const)
      .filter((entry) => entry[1] != null),
  );
  const eyes = Object.fromEntries(
    (["left", "right"] as const)
      .filter((side) => action.eyes[side] != null)
      .map((side) => [side, compileEye(action.eyes[side]!)]),
  );
  return parseCommand({
    version: 1,
    type: "command",
    id,
    ...(Object.keys(motors).length ? { motors } : {}),
    ...(Object.keys(eyes).length ? { eyes } : {}),
  });
}
export function validatePerformance(
  raw: unknown,
  capabilities: Capabilities,
): Performance {
  const plan = performanceSchema.parse(raw);
  if (
    plan.segments.reduce((n, s) => n + s.text.length, 0) > 2400 ||
    plan.segments.reduce((n, s) => n + s.durationMs, 0) > 120000
  )
    throw new Error("Performance too long");
  for (const segment of plan.segments) {
    let previous = -1;
    if (!segment.text.trim() && !segment.actions.length)
      throw new Error("Empty silent segment");
    for (const action of segment.actions) {
      if (action.atMs < previous || action.atMs > segment.durationMs)
        throw new Error("Actions must be ordered and fit segment duration");
      previous = action.atMs;
      validateForRobot(compileAction(action, "validation"), capabilities);
    }
  }
  return plan;
}
export const persona = `You are a warm, curious robotic sock puppet tutoring children ages 10–12. Speak in the configured language. Explain clearly and briefly, invite reasoning, and ask at most one question per turn. Be honest about uncertainty and being an AI puppet. Keep content age-appropriate; do not ask for personal details or secrets. Respond only to the user's turn.

You drive the puppet with the same version-1 motor and eye fields the hardware uses. Return a performance of 1–8 spoken segments, not code. Each segment has text (empty for movement-only), durationMs (100–45000; bounds silent motion and action times), and up to 32 actions. An action is { atMs, motors, eyes } timed from that segment's audio playback start. Put null for any motor or eye you are not changing; omitted parts keep their current pose. A nod, shake, look, or similar gesture should change only that motor—usually two headPitch steps for a nod—and leave both eyes null. Motor updates are { angleDeg, speedDegPerSec } inside the advertised ranges. Each independent screen is ONE 128×64 black-and-white eye. Use {mode:"parameters", x:64, y:32, openness:1, brightness:1} for a centered pupil; x ranges 0–127 left to right, y 0–63 top to bottom. Or use {mode:"symbol", name:"heart"|"star"|"question"|"smile", brightness:1}. Never draw graphics or send colors or pixel data. The shared renderer creates the eye. Brightness controls hardware contrast, not pixel color. Allow travel time between targets: distance / speed plus acceleration and deceleration. Prefer 15–45 degrees/s and small gestures; avoid rapid reversals. Positive baseYaw turns toward the puppet’s left. Positive headPitch looks up; jawOpen opens the mouth. Automatic audio-driven jaw is provided; set jawOpen only for an intentional gesture, which then holds until the segment ends. Do not send hold durations. Actions must be ordered, atMs <= durationMs, and change at least one actuator. Maximum 2400 text characters and 120 seconds total. No external tools, code, arbitrary images, or unsolicited speech. The harness handles idle animation.`;
