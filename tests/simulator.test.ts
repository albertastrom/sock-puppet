import { describe, expect, it } from "vitest";
import { Simulator } from "../src/core/simulator";
import { defaultEye, decodeFrame } from "../src/core/protocol";
import { renderEye } from "../src/core/display";
const command = (parts: object) => ({
  version: 1,
  type: "command",
  id: "test",
  ...parts,
});
describe("command validation and state", () => {
  it("updates specified joints and eyes independently and copies caller data", () => {
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
    expect(simulator.getState().eyes.right).toMatchObject({ x: 40 });
    expect(simulator.getState().motors.headPitch.targetDeg).toBe(0);
    const state = simulator.getState();
    state.motors.baseYaw.targetDeg = 88;
    expect(simulator.getState().motors.baseYaw.targetDeg).toBe(30);
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
    expect(s.getState()).toEqual(before);
  });
  it("accepts limits and rejects incomplete eye payloads", () => {
    const s = new Simulator();
    expect(
      s.applyCommand(
        command({
          motors: {
            baseYaw: { angleDeg: -90 },
            headPitch: { angleDeg: 30 },
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
    s.freeze();
    unsub();
    s.freeze();
    expect(count).toBe(1);
  });
});
describe("motor simulation", () => {
  it("produces equal movement at different frame rates and never overshoots", () => {
    for (const fps of [30, 60, 144]) {
      const s = new Simulator();
      s.applyCommand(
        command({ motors: { baseYaw: { angleDeg: 90, speedDegPerSec: 30 } } }),
      );
      for (let i = 0; i < fps; i++) s.step(1 / fps);
      expect(s.getState().motors.baseYaw.angleDeg).toBeCloseTo(30);
      s.step(20);
      expect(s.getState().motors.baseYaw).toMatchObject({
        angleDeg: 90,
        moving: false,
      });
    }
  });
  it("replaces targets from current pose and resets omitted speed to the default", () => {
    const s = new Simulator();
    s.applyCommand(
      command({ motors: { baseYaw: { angleDeg: 90, speedDegPerSec: 30 } } }),
    );
    s.step(1);
    s.applyCommand(command({ motors: { baseYaw: { angleDeg: -30 } } }));
    expect(s.getState().motors.baseYaw.angleDeg).toBe(30);
    s.step(0.5);
    expect(s.getState().motors.baseYaw.angleDeg).toBe(-15);
  });
  it("freezes at current pose, discards targets, and preserves screens", () => {
    const s = new Simulator();
    s.applyCommand(
      command({
        motors: { jawOpen: { angleDeg: 40, speedDegPerSec: 10 } },
        eyes: { right: { ...defaultEye(), x: 10 } },
      }),
    );
    s.step(1);
    s.freeze();
    s.step(10);
    expect(s.getState().motors.jawOpen).toMatchObject({
      angleDeg: 10,
      targetDeg: 10,
      moving: false,
    });
    expect(s.getState().eyes.right).toMatchObject({ x: 10 });
  });
});
describe("OLED framebuffer", () => {
  it("decodes the exact RGB888 size and scales brightness without modifying the frame", () => {
    const buffer = Buffer.alloc(19200);
    buffer[0] = 200;
    buffer[1] = 100;
    buffer[19199] = 50;
    const data = buffer.toString("base64");
    expect(decodeFrame(data)).toHaveLength(19200);
    const result = renderEye({ mode: "pixels", data, brightness: 0.5 });
    expect(Array.from(result.slice(0, 3))).toEqual([100, 50, 0]);
    expect(result[19199]).toBe(25);
    expect(decodeFrame(data)[0]).toBe(200);
  });
  it.each(["", "!", Buffer.alloc(10).toString("base64"), "=".repeat(25600)])(
    "rejects invalid frames",
    (data) => {
      expect(() => decodeFrame(data)).toThrow();
    },
  );
  it("renders black at zero brightness or closed eyelids", () => {
    expect(
      renderEye({ ...defaultEye(), openness: 0 }).every((v) => v === 0),
    ).toBe(true);
    expect(
      renderEye({ ...defaultEye(), brightness: 0 }).every((v) => v === 0),
    ).toBe(true);
    expect(renderEye(defaultEye()).some((v) => v > 0)).toBe(true);
  });
});
