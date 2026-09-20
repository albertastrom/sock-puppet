import { describe, expect, it } from "vitest";
import { Simulator } from "../src/simulator";
import {
  capabilitiesMessage,
  defaultEye,
  decodeFrame,
  parseCommand,
  stateMessage,
} from "../src/protocol";
import { renderEye, renderFrame } from "../src/display";
import { config, joints, frameBase64Length, frameBytes } from "../src/config";

const command = (parts: object) => ({
  version: 2,
  type: "command",
  id: "test",
  ...parts,
});

describe("command validation and state", () => {
  it("updates specified joints and eyes independently and isolates caller data", () => {
    const simulator = new Simulator(),
      eye = defaultEye();
    eye.x = 25;
    const raw = command({
      motors: { baseYaw: { angleDeg: 30 } },
      eyes: { left: eye },
    });
    expect(simulator.applyCommand(raw).type).toBe("ack");
    eye.x = 10;
    expect(simulator.getState().eyes.left).toMatchObject({ x: 25 });
    expect(simulator.getState().eyes.right).toMatchObject({ x: 32 });
    expect(simulator.getState().motors.headPitch.targetDeg).toBe(0);
    const idle = simulator.getState();
    expect(() => {
      idle.motors.baseYaw.targetDeg = 88;
    }).toThrow();
    expect(simulator.getState()).toBe(idle);
    expect(simulator.getState().motors.baseYaw.targetDeg).toBe(30);
  });
  it("keeps eye identity when only motors move", () => {
    const s = new Simulator();
    s.applyCommand(command({ eyes: { left: { ...defaultEye(), x: 12 } } }));
    const eyes = s.getState().eyes;
    s.applyCommand(
      command({ motors: { baseYaw: { angleDeg: 20, speedDegPerSec: 10 } } }),
    );
    expect(s.getState().eyes).toBe(eyes);
    const moving = s.getState();
    s.step(0.5);
    expect(s.getState()).not.toBe(moving);
    expect(s.getState().eyes).toBe(eyes);
    s.freeze();
    const held = s.getState();
    s.step(1);
    expect(s.getState()).toBe(held);
  });
  it("constructs a command instead of returning the raw object", () => {
    const raw = command({ motors: { baseYaw: { angleDeg: 10 } } });
    const parsed = parseCommand(raw);
    expect(parsed).not.toBe(raw);
    expect(parsed.motors?.baseYaw).not.toBe(
      (raw as { motors: { baseYaw: object } }).motors.baseYaw,
    );
    (
      raw as { motors: { baseYaw: { angleDeg: number } } }
    ).motors.baseYaw.angleDeg = 40;
    expect(parsed.motors?.baseYaw?.angleDeg).toBe(10);
  });
  it.each([-91, 91, NaN, Infinity, "10"])(
    "rejects invalid angle %s",
    (angle) => {
      const s = new Simulator();
      expect(
        s.applyCommand(command({ motors: { baseYaw: { angleDeg: angle } } })),
      ).toMatchObject({ type: "error", id: "test" });
    },
  );
  it.each([
    null,
    [],
    {},
    { version: 2, type: "command", id: "x" },
    command({ motors: { unknown: { angleDeg: 1 } } }),
    command({ motors: { jawOpen: { angleDeg: 1, speedDegPerSec: 0 } } }),
  ])("rejects malformed input", (raw) => {
    expect(new Simulator().applyCommand(raw).type).toBe("error");
  });
  it("rejects an entire command atomically when one eye is malformed", () => {
    const s = new Simulator(),
      before = s.getState();
    const response = s.applyCommand(
      command({
        motors: { jawOpen: { angleDeg: 30 } },
        eyes: { left: { ...defaultEye(), brightness: 2 } },
      }),
    );
    expect(response.type).toBe("error");
    expect(s.getState()).toBe(before);
  });
  it("accepts limits and rejects incomplete eye payloads", () => {
    const s = new Simulator();
    expect(
      s.applyCommand(
        command({
          motors: {
            baseYaw: { angleDeg: -90 },
            headPitch: { angleDeg: 45 },
            jawOpen: { angleDeg: 45 },
          },
        }),
      ).type,
    ).toBe("ack");
    expect(
      s.applyCommand(command({ eyes: { left: { mode: "parameters", x: 20 } } }))
        .type,
    ).toBe("error");
  });
  it("notifies subscribers and supports unsubscribe", () => {
    const s = new Simulator();
    let count = 0;
    const unsub = s.subscribe(() => count++);
    s.applyCommand(command({ motors: { jawOpen: { angleDeg: 5 } } }));
    unsub();
    s.applyCommand(command({ motors: { jawOpen: { angleDeg: 10 } } }));
    expect(count).toBe(1);
  });
  it("omits unchanged eyes from telemetry snapshots", () => {
    const s = new Simulator();
    const capabilities = capabilitiesMessage(s.getState());
    expect(capabilities.eyeModes).toEqual([
      "parameters",
      "symbol",
      "pixels",
      "expression",
    ]);
    expect(capabilities.state.eyes.left.mode).toBe("parameters");
    const first = stateMessage(s.getState());
    expect(first.eyes).toBeDefined();
    const next = stateMessage(s.getState(), first.eyes);
    expect(next.eyes).toBeUndefined();
    expect(next.motors).toBe(s.getState().motors);
  });
});

describe("motor simulation", () => {
  const advance = (s: Simulator, seconds: number, fps = 100) => {
    for (let i = 0; i < seconds * fps; i++) s.step(1 / fps);
  };
  it("ramps smoothly, stays within speed limits, and settles consistently across frame rates", () => {
    const positions: number[] = [];
    for (const fps of [30, 60, 144]) {
      const s = new Simulator();
      s.applyCommand(
        command({ motors: { baseYaw: { angleDeg: 90, speedDegPerSec: 30 } } }),
      );
      let previous = 0;
      for (let i = 0; i < fps; i++) {
        s.step(1 / fps);
        const angle = s.getState().motors.baseYaw.angleDeg;
        expect(angle - previous).toBeLessThanOrEqual(30 / fps + 1e-8);
        previous = angle;
      }
      positions.push(previous);
      expect(previous).toBeGreaterThan(25);
      expect(previous).toBeLessThan(30);
      advance(s, 4, fps);
      expect(s.getState().motors.baseYaw).toMatchObject({
        angleDeg: 90,
        moving: false,
      });
    }
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(0.02);
  });
  it.each(joints)("bounds %s during full travel and reversals", (joint) => {
    const s = new Simulator(),
      limits = config.motors[joint];
    for (const target of [limits.max, limits.min, 0]) {
      s.applyCommand(
        command({
          motors: {
            [joint]: { angleDeg: target, speedDegPerSec: limits.maxSpeed },
          },
        }),
      );
      let previous = s.getState().motors[joint].angleDeg;
      for (let i = 0; i < 1000; i++) {
        s.step(0.01);
        const angle = s.getState().motors[joint].angleDeg;
        expect(angle).toBeGreaterThanOrEqual(limits.min);
        expect(angle).toBeLessThanOrEqual(limits.max);
        expect(Math.abs(angle - previous)).toBeLessThanOrEqual(
          limits.maxSpeed * 0.01 + 1e-8,
        );
        previous = angle;
      }
      expect(s.getState().motors[joint].angleDeg).toBe(target);
    }
  });
  it("decelerates before reversing and limits movement after a stalled frame", () => {
    const s = new Simulator();
    s.applyCommand(command({ motors: { baseYaw: { angleDeg: 90 } } }));
    advance(s, 0.5);
    const before = s.getState().motors.baseYaw.angleDeg;
    s.applyCommand(command({ motors: { baseYaw: { angleDeg: -90 } } }));
    s.step(0.01);
    expect(s.getState().motors.baseYaw.angleDeg).toBeGreaterThan(before);
    advance(s, 5);
    expect(s.getState().motors.baseYaw.angleDeg).toBe(-90);
    s.applyCommand(command({ motors: { baseYaw: { angleDeg: 90 } } }));
    s.step(60);
    expect(s.getState().motors.baseYaw.angleDeg).toBeLessThan(-85);
    s.freeze();
    const held = s.getState();
    advance(s, 2);
    expect(s.getState()).toBe(held);
  });
  it.each(joints)("rejects unsafe %s speeds atomically", (joint) => {
    for (const speed of [
      0,
      -1,
      0.5,
      config.motors[joint].maxSpeed + 1,
      Infinity,
      NaN,
    ]) {
      const s = new Simulator(),
        before = s.getState();
      expect(
        s.applyCommand(
          command({
            motors: { [joint]: { angleDeg: 10, speedDegPerSec: speed } },
            eyes: { left: defaultEye() },
          }),
        ).type,
      ).toBe("error");
      expect(s.getState()).toBe(before);
    }
  });
});

describe("monochrome eyes", () => {
  it("decodes exactly 1024 bytes, MSB first with independent edge pixels", () => {
    const buffer = Buffer.alloc(frameBytes);
    buffer[0] = 128;
    buffer[frameBytes - 1] = 1;
    const data = buffer.toString("base64");
    expect(frameBytes).toBe(1024);
    expect(data.length).toBe(frameBase64Length);
    expect(decodeFrame(data)).toHaveLength(frameBytes);
    const pixels = renderEye({ mode: "pixels", data, brightness: 0.5 });
    expect([...pixels.slice(0, 6)]).toEqual([255, 255, 255, 0, 0, 0]);
    expect([...pixels.slice(-3)]).toEqual([255, 255, 255]);
    expect(pixels.every((v) => v === 0 || v === 255)).toBe(true);
  });
  it.each([
    "",
    "!",
    Buffer.alloc(10).toString("base64"),
    Buffer.alloc(19200).toString("base64"),
    "=".repeat(frameBase64Length),
  ])("rejects invalid or legacy frames", (data) => {
    expect(() => decodeFrame(data)).toThrow();
  });
  it("renders a single eye, independent gaze, closed lids and each named symbol", () => {
    const center = renderFrame(defaultEye());
    expect(center.some((v) => v > 0)).toBe(true);
    expect(renderFrame({ ...defaultEye(), x: 0 })).not.toEqual(center);
    expect(
      renderEye({ ...defaultEye(), openness: 0 }).every((v) => v === 0),
    ).toBe(true);
    expect(
      renderEye({ ...defaultEye(), brightness: 0 }).every((v) => v === 0),
    ).toBe(true);
    const frames = ["heart", "star", "question", "smile"].map((name) => {
      const parsed = parseCommand(
        command({ eyes: { left: { mode: "symbol", name, brightness: 1 } } }),
      );
      const frame = renderFrame(parsed.eyes!.left!);
      expect(frame.some((v) => v > 0)).toBe(true);
      return Buffer.from(frame).toString("base64");
    });
    expect(new Set(frames).size).toBe(4);
    expect(() =>
      parseCommand(
        command({ eyes: { left: { ...defaultEye(), color: "#ff0000" } } }),
      ),
    ).toThrow();
    expect(() =>
      parseCommand(
        command({
          eyes: { left: { mode: "symbol", name: "unknown", brightness: 1 } },
        }),
      ),
    ).toThrow();
  });
});
