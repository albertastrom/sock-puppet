import { afterEach, describe, expect, it, vi } from "vitest";
import type { Duplex } from "node:stream";
import { ServoSerialRobot } from "../src/robot/servo-serial";
import {
  defaultServoCalibration,
  parseServoCalibration,
} from "../src/robot/servo-calibration";
import { command, pair } from "./helpers";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function captureLines(stream: Duplex, onLine?: (line: string) => void) {
  const lines: string[] = [];
  let buffered = "";
  stream.on("data", (chunk) => {
    buffered += Buffer.from(chunk).toString("utf8");
    for (;;) {
      const end = buffered.indexOf("\n");
      if (end < 0) break;
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      if (line) {
        lines.push(line);
        onLine?.(line);
      }
    }
  });
  return lines;
}

async function setup(autoAck = true) {
  const [host, firmware] = pair();
  const lines = captureLines(firmware, () => {
    if (autoAck) firmware.write("OK\n");
  });
  const robot = new ServoSerialRobot("test", 115200, () => host);
  cleanups.push(() => {
    firmware.destroy();
    return robot.disconnect();
  });
  await robot.connect();
  firmware.write("READY\r\n");
  await vi.waitFor(() => expect(robot.connected).toBe(true));
  return { robot, firmware, lines };
}

it("maps protocol-v2 absolute joints to firmware motors", async () => {
  const { robot, lines } = await setup();
  expect(await robot.applyCommand(command("base", 20))).toEqual({
    version: 2,
    type: "ack",
    id: "base",
  });
  await vi.waitFor(() => expect(lines).toContain("1,=,110,60"));
  expect(lines.some((line) => line.startsWith("2,="))).toBe(false);
  expect(lines.some((line) => line.startsWith("3,="))).toBe(false);
});

it("coalesces changed targets while an untagged firmware reply is pending", async () => {
  const { robot, firmware, lines } = await setup(false);
  await robot.applyCommand(command("first", 10));
  await vi.waitFor(() => expect(lines).toEqual(["1,=,100,60"]));
  await robot.applyCommand(command("second", 20));
  await robot.applyCommand(command("latest", 30));
  expect(lines).toHaveLength(1);
  firmware.write("OK\n");
  await vi.waitFor(() => expect(lines).toHaveLength(2));
  expect(lines[1]).toBe("1,=,120,60");
});

it("runs Creature speech locally and drives the jaw servo", async () => {
  const { robot, lines } = await setup();
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "behavior",
    creature: { kind: "behavior", behavior: "idle/listening" },
  });
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "speech",
    creature: { kind: "speech", rms: 0.2, sequence: 1 },
  });
  await vi.waitFor(
    () =>
      expect(
        lines.some((line) => {
          const [motor, direction, angle] = line.split(",");
          return motor === "3" && direction === "=" && Number(angle) > 90;
        }),
      ).toBe(true),
    { timeout: 1000 },
  );
});

it("retargets to the estimated pose when motion is stopped", async () => {
  const { robot, lines } = await setup();
  await robot.applyCommand(command("move", 30));
  await vi.waitFor(() => expect(lines).toContain("1,=,120,60"));
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "stop",
    creature: { kind: "stop", closeJaw: false },
  });
  await vi.waitFor(() =>
    expect(
      lines.some((line) => {
        const [motor, direction, angle] = line.split(",");
        return motor === "1" && direction === "=" && Number(angle) < 120;
      }),
    ).toBe(true),
  );
});

it("disconnects on firmware errors and resets to home on READY", async () => {
  const { robot, firmware } = await setup();
  await robot.applyCommand(command("move", 25));
  await vi.waitFor(() =>
    expect(robot.getState()?.motors.baseYaw.targetDeg).toBe(25),
  );
  firmware.write("READY\n");
  await vi.waitFor(() =>
    expect(robot.getState()?.motors.baseYaw.targetDeg).toBe(0),
  );
  firmware.write("ERR direction\n");
  await vi.waitFor(() => expect(robot.connected).toBe(false));
});

describe("servo calibration", () => {
  it("supports direction, center and conservative logical limits", () => {
    const calibration = parseServoCalibration(
      JSON.stringify({
        baseYaw: {
          centerDeg: 95,
          sign: -1,
          min: -40,
          max: 50,
          maxSpeed: 100,
        },
      }),
    );
    expect(calibration.baseYaw).toMatchObject({
      motor: 1,
      centerDeg: 95,
      sign: -1,
      min: -40,
      max: 50,
      maxSpeed: 100,
    });
    expect(calibration.headPitch).toEqual(
      defaultServoCalibration.headPitch,
    );
  });

  it("rejects invalid signs and physical ranges", () => {
    expect(() =>
      parseServoCalibration('{"baseYaw":{"sign":0}}'),
    ).toThrow("sign must be 1 or -1");
    expect(() =>
      parseServoCalibration('{"jawOpen":{"centerDeg":170,"max":45}}'),
    ).toThrow("exceeds servo range");
  });
});
