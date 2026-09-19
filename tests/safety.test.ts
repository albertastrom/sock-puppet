import { expect, it } from "vitest";
import { config, joints } from "@sock-puppet/robot/config";
import { Simulator } from "@sock-puppet/robot/simulator";
import { capabilitiesMessage } from "@sock-puppet/robot/protocol";
import {
  validateCapabilities,
  validateForRobot,
  validateState,
} from "../src/robot/types";
import { validatePerformance } from "../src/harness/performance";
import { Scheduler } from "../src/harness/scheduler";
import { FakeRobot, silentPlan } from "./helpers";

it.each(joints)(
  "enforces shared %s speed limits in manual and model commands",
  (joint) => {
    const caps = capabilitiesMessage(new Simulator().getState());
    const command = {
      version: 1 as const,
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
    const plan = structuredClone(silentPlan);
    plan.segments[0].actions[0].motors[joint] = command.motors[joint];
    expect(() => validatePerformance(plan, caps)).toThrow();
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
      version: 1,
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
        version: 1,
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
  const scheduler = new Scheduler(robot);
  scheduler.setBehavior("idle/listening");
  scheduler.tick(1000);
  expect(robot.commands.at(-1)?.motors?.jawOpen?.speedDegPerSec).toBe(30);
  const segment = structuredClone(silentPlan.segments[0]);
  segment.text = "Hello";
  scheduler.startSegment(segment);
  scheduler.playback(1, 1);
  scheduler.tick(1100);
  expect(robot.commands.at(-1)?.motors?.jawOpen).toEqual({
    angleDeg: 20,
    speedDegPerSec: 30,
  });
  scheduler.stop();
  expect(robot.commands.at(-1)?.motors?.jawOpen?.speedDegPerSec).toBe(30);
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
