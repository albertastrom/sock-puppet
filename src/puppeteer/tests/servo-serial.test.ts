import { afterEach, describe, expect, it, vi } from "vitest";
import type { Duplex } from "node:stream";
import { ServoSerialRobot } from "../src/robot/servo-serial";
import {
  defaultServoCalibration,
  parseServoCalibration,
  toServoAngle,
} from "../src/robot/servo-calibration";
import { command, pair } from "./helpers";
import type { Expression } from "@sock-puppet/robot/expressions";
import type { Command } from "@sock-puppet/robot/protocol";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function captureLines(
  stream: Duplex,
  onLine?: (line: string) => void,
  record: (line: string) => boolean = () => true,
) {
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
        if (record(line)) lines.push(line);
        onLine?.(line);
      }
    }
  });
  return lines;
}

async function setup(autoAck = true) {
  const [host, firmware] = pair();
  // These cases cover the boot path: the probe goes unanswered and the READY
  // banner below completes the handshake. The probe is not a command, so it is
  // kept out of the recorded wire lines.
  const lines = captureLines(
    firmware,
    (line) => {
      if (line !== "?" && autoAck) firmware.write("OK\n");
    },
    (line) => line !== "?",
  );
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

function expressionEyes(
  left: Expression,
  right: Expression = left,
  openness = 1,
): NonNullable<Command["eyes"]> {
  const eye = (side: "left" | "right", name: Expression) => ({
    mode: "expression" as const,
    name,
    x: 0,
    y: 0,
    size: 1,
    convergence: 0,
    openness,
    brightness: 1,
    side,
  });
  return { left: eye("left", left), right: eye("right", right) };
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
          const pwm = Number(angle);
          return (
            motor === "3" &&
            direction === "=" &&
            pwm < 180 &&
            pwm >= 150
          );
        }),
      ).toBe(true),
    { timeout: 1000 },
  );
  expect(
    lines
      .filter((line) => line.startsWith("3,="))
      .every((line) => Number(line.split(",")[2]) >= 150),
  ).toBe(true);
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

it("handshakes with a board that booted before the port was opened", async () => {
  const [host, firmware] = pair();
  // No READY: setup() ran long ago and the board does not reset on open.
  const lines = captureLines(firmware, (line) => {
    firmware.write(line === "?" ? "ERR motor\n" : "OK\n");
  });
  const robot = new ServoSerialRobot("test", 115200, () => host);
  cleanups.push(() => {
    firmware.destroy();
    return robot.disconnect();
  });
  await robot.connect();
  await vi.waitFor(() => expect(robot.connected).toBe(true));
  expect(lines[0]).toBe("?");
  // Servo positions are unknown after a silent connect, so every joint is
  // commanded to its absolute home rather than assumed to be there.
  await vi.waitFor(() => {
    for (const motor of [1, 2, 3])
      expect(lines.some((line) => line.startsWith(`${motor},=,`))).toBe(true);
  });
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

it("maps left and right expressions onto firmware eye indexes", async () => {
  const { robot, lines } = await setup();
  expect(
    await robot.applyCommand({
      version: 2,
      type: "command",
      id: "eyes",
      eyes: expressionEyes("angry", "love"),
    }),
  ).toEqual({ version: 2, type: "ack", id: "eyes" });
  await vi.waitFor(() => {
    expect(lines).toContain("eye,0,angry");
    expect(lines).toContain("eye,1,love");
  });
  expect(lines.filter((line) => line.startsWith("eye,"))).toEqual([
    "eye,0,angry",
    "eye,1,love",
  ]);
});

it("projects animated eyelid openness onto firmware blink frames", async () => {
  const { robot, lines } = await setup();
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "closing",
    eyes: expressionEyes("neutral", "neutral", 0.3),
  });
  await vi.waitFor(() => {
    expect(lines).toContain("eye,0,blink3");
    expect(lines).toContain("eye,1,blink3");
  });
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "open",
    eyes: expressionEyes("neutral"),
  });
  await vi.waitFor(() => {
    expect(lines).toContain("eye,0,neutral");
    expect(lines).toContain("eye,1,neutral");
  });
});

it("reports firmware commands and acknowledgment latency", async () => {
  const { robot } = await setup();
  const events: {
    phase: "sent" | "ack";
    line: string;
    latencyMs?: number;
  }[] = [];
  robot.subscribe((event) => {
    if (event.type === "wire") events.push(event);
  });
  await robot.applyCommand(command("move", 20));
  await vi.waitFor(() =>
    expect(events.some((event) => event.phase === "ack")).toBe(true),
  );
  expect(events[0]).toMatchObject({
    phase: "sent",
    line: "1,=,110,60",
  });
  expect(events[1]).toMatchObject({
    phase: "ack",
    line: "1,=,110,60",
  });
  expect(events[1].latencyMs).toBeGreaterThanOrEqual(0);
});

it("runs Creature expressions locally and drives both OLED panels", async () => {
  const { robot, lines } = await setup();
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "behavior",
    creature: { kind: "behavior", behavior: "idle/listening" },
  });
  await vi.waitFor(() => {
    expect(lines).toContain("eye,0,neutral");
    expect(lines).toContain("eye,1,neutral");
  });
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "act",
    creature: {
      kind: "act",
      action: { gesture: "none", n: 1, expression: "curious" },
      ttlMs: 10000,
    },
  });
  await vi.waitFor(() => {
    expect(lines).toContain("eye,0,curious");
    expect(lines).toContain("eye,1,curious");
  });
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "dance",
    creature: {
      kind: "move",
      move: { id: "dance", n: 1 },
      ttlMs: 20000,
    },
  });
  await vi.waitFor(() => {
    expect(lines.some((line) => /^eye,0,(joy|happy|love|square|focus|glitch)$/.test(line))).toBe(
      true,
    );
  });
});

it("does not resend an unchanged expression", async () => {
  const { robot, lines } = await setup();
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "first",
    eyes: expressionEyes("happy"),
  });
  await vi.waitFor(() => {
    expect(lines).toEqual(["eye,0,happy", "eye,1,happy"]);
  });
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "again",
    eyes: expressionEyes("happy"),
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(lines).toEqual(["eye,0,happy", "eye,1,happy"]);
});

it("coalesces changed expressions while an untagged firmware reply is pending", async () => {
  const { robot, firmware, lines } = await setup(false);
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "first",
    eyes: expressionEyes("angry"),
  });
  await vi.waitFor(() => expect(lines).toEqual(["eye,0,angry"]));
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "second",
    eyes: expressionEyes("love"),
  });
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "latest",
    eyes: expressionEyes("curious"),
  });
  expect(lines).toHaveLength(1);
  firmware.write("OK\n");
  await vi.waitFor(() => expect(lines).toHaveLength(2));
  firmware.write("OK\n");
  await vi.waitFor(() => {
    expect(lines).toContain("eye,0,curious");
    expect(lines).toContain("eye,1,curious");
  });
  expect(lines.some((line) => line.includes("love"))).toBe(false);
  expect(lines.filter((line) => line.startsWith("eye,"))).toEqual([
    "eye,0,angry",
    "eye,1,curious",
    "eye,0,curious",
  ]);
});

it("keeps motors ahead of eye draws on the shared acknowledgment pipeline", async () => {
  const { robot, firmware, lines } = await setup(false);
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "both",
    motors: { baseYaw: { angleDeg: 20, speedDegPerSec: 60 } },
    eyes: expressionEyes("wink"),
  });
  await vi.waitFor(() => expect(lines).toEqual(["1,=,110,60"]));
  firmware.write("OK\n");
  await vi.waitFor(() => expect(lines).toEqual(["1,=,110,60", "eye,0,wink"]));
  firmware.write("OK\n");
  await vi.waitFor(() =>
    expect(lines).toEqual(["1,=,110,60", "eye,0,wink", "eye,1,wink"]),
  );
});

it("leaves pixels and symbols on the host preview", async () => {
  const { robot, lines } = await setup();
  expect(
    await robot.applyCommand({
      version: 2,
      type: "command",
      id: "symbol",
      eyes: {
        left: { mode: "symbol", name: "heart", brightness: 1 },
        right: { mode: "symbol", name: "star", brightness: 1 },
      },
    }),
  ).toEqual({ version: 2, type: "ack", id: "symbol" });
  await robot.applyCommand(command("base", 20));
  await vi.waitFor(() => expect(lines).toContain("1,=,110,60"));
  expect(lines.some((line) => line.startsWith("eye,"))).toBe(false);
});

it("resends expressions after READY and disconnects on firmware eye errors", async () => {
  const { robot, firmware, lines } = await setup();
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "first",
    eyes: expressionEyes("sad"),
  });
  await vi.waitFor(() => {
    expect(lines).toContain("eye,0,sad");
    expect(lines).toContain("eye,1,sad");
  });
  firmware.write("READY\n");
  await vi.waitFor(() =>
    expect(robot.getState()?.eyes.left.mode).toBe("parameters"),
  );
  await robot.applyCommand({
    version: 2,
    type: "command",
    id: "again",
    eyes: expressionEyes("sad"),
  });
  await vi.waitFor(() =>
    expect(lines.filter((line) => line === "eye,0,sad")).toHaveLength(2),
  );
  firmware.write("ERR expression\n");
  await vi.waitFor(() => expect(robot.connected).toBe(false));
});

describe("servo calibration", () => {
  it("homes the base at 90, head at 120, and closed jaw at 180", () => {
    expect(defaultServoCalibration.baseYaw).toMatchObject({
      centerDeg: 90,
      sign: 1,
    });
    expect(defaultServoCalibration.headPitch).toMatchObject({
      centerDeg: 120,
      sign: 1,
    });
    expect(defaultServoCalibration.jawOpen).toMatchObject({
      centerDeg: 180,
      sign: -1,
      min: 0,
      max: 30,
    });
    expect(toServoAngle(defaultServoCalibration.baseYaw, 0)).toBe(90);
    expect(toServoAngle(defaultServoCalibration.headPitch, 0)).toBe(120);
    expect(toServoAngle(defaultServoCalibration.headPitch, 10)).toBe(130);
    expect(toServoAngle(defaultServoCalibration.headPitch, -45)).toBe(75);
    expect(toServoAngle(defaultServoCalibration.jawOpen, 0)).toBe(180);
    expect(toServoAngle(defaultServoCalibration.jawOpen, 15)).toBe(165);
    expect(toServoAngle(defaultServoCalibration.jawOpen, 30)).toBe(150);
    expect(toServoAngle(defaultServoCalibration.jawOpen, 45)).toBe(150);
  });

  it("maps protocol-v2 head and jaw onto firmware homes", async () => {
    const { robot, lines } = await setup();
    expect(
      await robot.applyCommand({
        version: 2,
        type: "command",
        id: "head",
        motors: { headPitch: { angleDeg: 10, speedDegPerSec: 30 } },
      }),
    ).toEqual({ version: 2, type: "ack", id: "head" });
    await vi.waitFor(() => expect(lines).toContain("2,=,130,30"));
    expect(
      await robot.applyCommand({
        version: 2,
        type: "command",
        id: "jaw",
        motors: { jawOpen: { angleDeg: 15, speedDegPerSec: 60 } },
      }),
    ).toEqual({ version: 2, type: "ack", id: "jaw" });
    await vi.waitFor(() => expect(lines).toContain("3,=,165,60"));
    expect(
      await robot.applyCommand({
        version: 2,
        type: "command",
        id: "wide",
        motors: { jawOpen: { angleDeg: 30, speedDegPerSec: 60 } },
      }),
    ).toEqual({ version: 2, type: "ack", id: "wide" });
    await vi.waitFor(() => expect(lines).toContain("3,=,150,60"));
    expect(
      await robot.applyCommand({
        version: 2,
        type: "command",
        id: "tooWide",
        motors: { jawOpen: { angleDeg: 35, speedDegPerSec: 60 } },
      }),
    ).toMatchObject({ type: "error", id: "tooWide" });
    expect(lines.filter((line) => line.startsWith("3,=")).at(-1)).toBe(
      "3,=,150,60",
    );
  });

  it("closes the jaw as the head looks fully down", async () => {
    const { robot, lines } = await setup();
    expect(
      await robot.applyCommand({
        version: 2,
        type: "command",
        id: "open",
        motors: { jawOpen: { angleDeg: 30, speedDegPerSec: 60 } },
      }),
    ).toEqual({ version: 2, type: "ack", id: "open" });
    await vi.waitFor(() => expect(lines).toContain("3,=,150,60"));
    expect(
      await robot.applyCommand({
        version: 2,
        type: "command",
        id: "down",
        motors: { headPitch: { angleDeg: -45, speedDegPerSec: 30 } },
      }),
    ).toEqual({ version: 2, type: "ack", id: "down" });
    await vi.waitFor(() => expect(lines).toContain("2,=,75,30"));
    await vi.waitFor(() =>
      expect(
        lines.some((line) => line.startsWith("3,=") && Number(line.split(",")[2]) >= 165),
      ).toBe(true),
    );
  });

  it("supports direction, center and conservative logical limits", () => {
    const calibration = parseServoCalibration(
      JSON.stringify({
        baseYaw: {
          centerDeg: 95,
          sign: -1,
          min: -40,
          max: 50,
          speed: 80,
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
      speed: 80,
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
    expect(() => parseServoCalibration('{"jawOpen":{"max":35}}')).toThrow(
      "exceeds servo range",
    );
  });
});
