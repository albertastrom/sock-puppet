import { expect, it } from "vitest";
import { config, joints } from "@sock-puppet/robot/config";
import { Simulator } from "@sock-puppet/robot/simulator";
import { capabilitiesMessage } from "@sock-puppet/robot/protocol";
import {
  validateCapabilities,
  validateForRobot,
  validateState,
} from "../src/robot/types";
import { Creature } from "@sock-puppet/robot/creature";
import { FakeRobot } from "./helpers";

it.each(joints)(
  "enforces shared %s speed limits in manual and model commands",
  (joint) => {
    const caps = capabilitiesMessage(new Simulator().getState());
    const command = {
      version: 2 as const,
      type: "command" as const,
      id: "unsafe",
      motors: {
        [joint]: {
          angleDeg: 10,
          speedDegPerSec: config.motors[joint].maxSpeed + 1,
        },
      },
    };
    expect(() => validateForRobot(command, caps)).toThrow();
  },
);
it("uses narrower device limits for commands, telemetry, idle and audio jaw", async () => {
  const robot = new FakeRobot();
  const raw: any = structuredClone(robot.getCapabilities());
  raw.motors.jawOpen.max = 20;
  raw.motors.jawOpen.maxSpeed = 30;
  raw.motors.jawOpen.speed = 20;
  raw.state.motors.jawOpen.speedDegPerSec = 20;
  const caps = validateCapabilities(raw);
  robot.getCapabilities = () => caps;
  const command = validateForRobot(
    {
      version: 2,
      type: "command",
      id: "default",
      motors: { jawOpen: { angleDeg: 10 } },
    },
    caps,
  );
  expect(command.motors?.jawOpen?.speedDegPerSec).toBe(20);
  expect(() =>
    validateForRobot(
      {
        version: 2,
        type: "command",
        id: "fast",
        motors: { jawOpen: { angleDeg: 10, speedDegPerSec: 31 } },
      },
      caps,
    ),
  ).toThrow();
  const unsafeState = structuredClone(raw.state);
  unsafeState.motors.jawOpen.angleDeg = 21;
  expect(() => validateState(unsafeState, undefined, caps.motors)).toThrow();
  const creature = new Creature(7, caps.motors);
  creature.accept(
    { kind: "behavior", behavior: "idle/listening" },
    "idle",
    robot.getState(),
  );
  creature.accept(
    { kind: "speech", rms: 1, sequence: 1 },
    "audio",
    robot.getState(),
  );
  const update = creature.tick(20);
  expect(update?.motors?.jawOpen?.angleDeg).toBeLessThanOrEqual(20);
  expect(update?.motors?.jawOpen?.speedDegPerSec).toBe(30);
});
it("rejects pitch outside narrowed head calibration", () => {
  const caps: any = structuredClone(
    capabilitiesMessage(new Simulator().getState()),
  );
  caps.motors.headPitch.min = -8;
  caps.motors.headPitch.max = 8;
  expect(() =>
    validateForRobot(
      {
        version: 2,
        type: "command",
        id: "high",
        creature: {
          kind: "act",
          action: { gesture: "look", n: 1, pitch: 15 },
          ttlMs: 5000,
        },
      },
      caps,
    ),
  ).toThrow();
  const ok = validateForRobot(
    {
      version: 2,
      type: "command",
      id: "ok",
      creature: {
        kind: "act",
        action: { gesture: "look", n: 1, pitch: 6 },
        ttlMs: 5000,
      },
    },
    caps,
  );
  expect(
    ok.creature?.kind === "act" ? ok.creature.action.pitch : undefined,
  ).toBe(6);
});
it("rejects incompatible displays, excessive device limits and malformed telemetry", () => {
  const original = capabilitiesMessage(new Simulator().getState());
  for (const mutate of [
    (c: any) => {
      c.display.width = 80;
    },
    (c: any) => {
      c.display.format = "RGB888";
    },
    (c: any) => {
      c.eyeModes = ["parameters", "pixels"];
    },
    (c: any) => {
      c.motors.headPitch.maxSpeed = 1000;
    },
    (c: any) => {
      c.motors.headPitch.acceleration = 1000;
    },
    (c: any) => {
      c.state.motors.headPitch.speedDegPerSec = 1000;
    },
  ]) {
    const c = structuredClone(original);
    mutate(c);
    expect(() => validateCapabilities(c)).toThrow();
  }
});
